/**
 * Animated-GIF engine for Meme Studio - decodes a GIF into canvas-friendly
 * frames using WebCodecs ImageDecoder (Chromium; other browsers fall back to
 * the plain <img> preview), extends the meme timeline to full GIF duration,
 * and reuses the canvas-capture recorder for export.
 *
 * Why frames instead of a looping <img>? Frame accuracy: overlays and SFX cues
 * schedule against decoded timestamps, and the export paints exact frames -
 * a looping <img> cannot be scrubbed or sampled deterministically.
 */

export interface GifFrame {
	/** Frame paint time in GIF-local time (seconds). */
	timestamp: number;
	/** Frame duration (seconds). */
	duration: number;
	/** Decoded pixels as an ImageBitmap — a STABLE CanvasImageSource. Raw
	 *  VideoFrames are lifetime-coupled to the decoder and can be invalidated
	 *  while cached (closed frames crash drawImage mid-export with "not of
	 *  type CanvasImageSource"); bitmaps outlive the decoder. */
	frame: ImageBitmap;
}

export interface DecodedGif {
	width: number;
	height: number;
	/** Total single-pass duration in seconds. */
	duration: number;
	frames: GifFrame[];
	/** Release decoder resources. */
	close: () => void;
}

interface DecoderTrack {
	frameCount?: number;
}

interface DecoderTrackList extends Array<DecoderTrack> {
	/** Resolves when track metadata (frameCount) is populated. */
	ready?: Promise<void>;
}

interface DecoderLike {
	completed: Promise<void>;
	tracks?: DecoderTrackList;
	decode: (options?: { frameIndex?: number; completeFramesOnly?: boolean }) => Promise<VideoFrame>;
	close: () => void;
}

type ImageDecoderCtor = new (init: {
	data: BufferSource;
	type: string;
	preferAnimation: boolean;
}) => DecoderLike;

function decoderCtor(): ImageDecoderCtor | null {
	const w = globalThis as unknown as { ImageDecoder?: ImageDecoderCtor };
	return w.ImageDecoder ?? null;
}

/** Can this browser decode GIFs frame-by-frame? (native WebCodecs OR the
 *  pure-JS fallback — the latter needs only createImageBitmap, which every
 *  current browser ships.) */
export function canDecodeGif(): boolean {
	return decoderCtor() !== null || typeof createImageBitmap === 'function';
}

/**
 * Decode an animated GIF into timestamped frames (one full pass; loop counts
 * are ignored - the export records a single pass by design).
 *
 * Native WebCodecs first; ANY native failure (missing API, metadata races,
 * stubbed decoders that return non-VideoFrame objects — seen in embedded
 * browsers) falls through to the pure-JS decoder, so animated layers work
 * everywhere createImageBitmap does.
 */
export async function decodeGif(data: ArrayBuffer): Promise<DecodedGif> {
	const Ctor = decoderCtor();
	if (Ctor) {
		try {
			return await decodeGifNative(Ctor, data);
		} catch {
			/* broken native decoder — the JS path below handles it */
		}
	}
	return decodeGifJs(data);
}

async function decodeGifNative(
	Ctor: new (init: { data: BufferSource; type: string; preferAnimation: boolean }) => DecoderLike,
	data: ArrayBuffer
): Promise<DecodedGif> {
	const decoder = new Ctor({ data, type: 'image/gif', preferAnimation: true });
	const frames: GifFrame[] = [];
	try {
		await decoder.completed;
		// Track metadata lands on the track list's OWN ready promise —
		// `completed` alone can resolve before frameCount is populated, which
		// made perfectly valid GIFs throw "The GIF has no frames" (and layers
		// froze at frame 1 in exports).
		if (decoder.tracks?.ready) await decoder.tracks.ready;
		const frameCount = decoder.tracks?.[0]?.frameCount ?? 0;
		if (!frameCount) throw new Error('The GIF has no frames');
		let timestamp = 0;
		for (let index = 0; index < frameCount; index++) {
			const frame = await decoder.decode({ frameIndex: index, completeFramesOnly: true });
			const micros = frame.duration ?? 0;
			const dur = micros / 1_000_000; // us -> s
			// Snapshot to an ImageBitmap immediately and release the VideoFrame —
			// held-long-term frames must not depend on decoder/frame lifetime.
			const bitmap = await createImageBitmap(frame);
			frame.close();
			frames.push({ timestamp, duration: dur, frame: bitmap });
			timestamp += dur;
		}
		if (!frames.length) throw new Error('The GIF decoded to zero frames');
		return {
			width: frames[0].frame.width,
			height: frames[0].frame.height,
			duration: Math.max(timestamp, 0.1),
			frames,
			close: () => frames.forEach((f) => f.frame.close())
		};
	} catch (e) {
		frames.forEach((f) => f.frame.close());
		decoder.close();
		throw e;
	}
}

// ---- pure-JS GIF89a decoder (fallback; no WebCodecs needed) ---------------
// Parses header/color tables/LZW image blocks and composites each frame onto
// a canvas (honoring interlacing, transparency and disposal methods), then
// snapshots ImageBitmaps — the same GifFrame contract as the native path.

/** GIF LZW decompression → color indices for one image block. */
function gifLzw(minCodeSize: number, bytes: Uint8Array): number[] {
	const clearCode = 1 << minCodeSize;
	const endCode = clearCode + 1;
	let codeSize = minCodeSize + 1;
	// Dictionary entry i = byte sequence; stored as {start,len} into a growing
	// byte buffer would be tighter, but plain arrays are fast enough here.
	let dict: number[][] = [];
	const resetDict = () => {
		dict = [];
		for (let i = 0; i < clearCode; i++) dict.push([i]);
		dict.push([]); // clear
		dict.push([]); // end
		codeSize = minCodeSize + 1;
	};
	resetDict();

	const out: number[] = [];
	let prev: number[] | null = null;
	let bitPos = 0;
	const readCode = (): number => {
		let code = 0;
		for (let i = 0; i < codeSize; i++) {
			const byte = bytes[bitPos >> 3] ?? 0;
			if (byte & (1 << (bitPos & 7))) code |= 1 << i;
			bitPos++;
		}
		return code;
	};
	while (true) {
		const code = readCode();
		if (bitPos > bytes.length * 8 + codeSize) break; // truncated stream guard
		if (code === clearCode) {
			resetDict();
			prev = null;
			continue;
		}
		if (code === endCode) break;
		let entry: number[];
		if (code < dict.length) {
			entry = dict[code]!;
		} else if (prev) {
			entry = [...prev, prev[0]!];
		} else {
			break; // corrupt stream
		}
		for (const b of entry) out.push(b);
		if (prev) {
			dict.push([...prev, entry[0]!]);
			if (dict.length === 1 << codeSize && codeSize < 12) codeSize++;
		}
		prev = entry;
	}
	return out;
}

/** Interlaced GIF rows arrive in 4 passes (0/8, 4/8, 2/4, 1/2) — this maps
 *  decoded row index → display row. */
function interlaceRowOrder(height: number): number[] {
	const passes = [
		{ start: 0, step: 8 },
		{ start: 4, step: 8 },
		{ start: 2, step: 4 },
		{ start: 1, step: 2 }
	];
	const out: number[] = [];
	for (const { start, step } of passes) {
		for (let y = start; y < height; y += step) out.push(y);
	}
	return out;
}

/** Parse a Graphic Control Extension body. `pos` points at the size byte
 *  (always 4): [size][packed][delay lo][delay hi][transparentIdx][terminator].
 *  The transparent index is at pos+4 — reading pos+3 (the delay high byte,
 *  almost always 0) once painted see-through pixels with palette color 0,
 *  turning transparent GIF frames into green garbage in exports. */
export function parseGce(
	bytes: Uint8Array,
	pos: number
): { delayCs: number; disposal: number; transparentIdx: number } {
	const packed = bytes[pos + 1] ?? 0;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return {
		delayCs: view.getUint16(pos + 2, true),
		disposal: (packed >> 2) & 7,
		transparentIdx: packed & 1 ? (bytes[pos + 4] ?? -1) : -1
	};
}

async function decodeGifJs(data: ArrayBuffer): Promise<DecodedGif> {
	const view = new DataView(data);
	const bytes = new Uint8Array(data);
	if (bytes.length < 13) throw new Error('Truncated GIF');
	const sig = String.fromCharCode(...bytes.subarray(0, 6));
	if (!/^GIF8[79]a$/.test(sig)) throw new Error('Not a GIF');
	const width = view.getUint16(6, true);
	const height = view.getUint16(8, true);
	const packed = bytes[10]!;
	let pos = 13;
	let gct: Uint8Array | null = null;
	if (packed & 0x80) {
		const size = 2 << (packed & 7);
		gct = bytes.subarray(pos, pos + size * 3);
		pos += size * 3;
	}

	const composite = document.createElement('canvas');
	composite.width = width;
	composite.height = height;
	const cctx = composite.getContext('2d');
	if (!cctx) throw new Error('Canvas is not available in this browser');

	const frames: GifFrame[] = [];
	let timestamp = 0;
	// Pending graphic-control values (apply to the NEXT image block).
	let gceDelayCs = 0;
	let gceDisposal = 0;
	let gceTransparent = -1;

	const trailer = 0x3b;
	while (pos < bytes.length) {
		const block = bytes[pos]!;
		if (block === trailer) break;
		if (block === 0x21) {
			// Extension
			const label = bytes[pos + 1]!;
			pos += 2;
			if (label === 0xf9 && bytes[pos] === 4) {
				const gce = parseGce(bytes, pos);
				gceDelayCs = gce.delayCs;
				gceDisposal = gce.disposal;
				gceTransparent = gce.transparentIdx;
			}
			// Skip the extension's sub-blocks (length-prefixed, 0-terminated).
			while (pos < bytes.length && bytes[pos] !== 0) pos += bytes[pos]! + 1;
			pos++;
			continue;
		}
		if (block !== 0x2c) {
			pos++; // unknown block — resync one byte at a time
			continue;
		}
		// Image descriptor
		pos++;
		const left = view.getUint16(pos, true);
		const top = view.getUint16(pos + 2, true);
		const iw = view.getUint16(pos + 4, true);
		const ih = view.getUint16(pos + 6, true);
		const ip = bytes[pos + 8]!;
		pos += 9;
		let table = gct;
		if (ip & 0x80) {
			const size = 2 << (ip & 7);
			table = bytes.subarray(pos, pos + size * 3);
			pos += size * 3;
		}
		if (!table) throw new Error('The GIF has no color table');
		const minCodeSize = bytes[pos]!;
		pos++;
		// Concatenate LZW sub-blocks.
		let lzwLen = 0;
		let scan = pos;
		while (scan < bytes.length && bytes[scan] !== 0) {
			lzwLen += bytes[scan]!;
			scan += bytes[scan]! + 1;
		}
		const lzw = new Uint8Array(lzwLen);
		let write = 0;
		while (pos < bytes.length && bytes[pos] !== 0) {
			const len = bytes[pos]!;
			lzw.set(bytes.subarray(pos + 1, pos + 1 + len), write);
			write += len;
			pos += len + 1;
		}
		pos++; // terminator

		const indices = gifLzw(minCodeSize, lzw);
		// Paint the patch into an ImageData (transparent index → alpha 0).
		const patch = new ImageData(iw, ih);
		const px = patch.data;
		const rows = ip & 0x40 ? interlaceRowOrder(ih) : null;
		for (let y = 0; y < ih; y++) {
			const destY = rows ? rows[y]! : y;
			for (let x = 0; x < iw; x++) {
				const idx = indices[y * iw + x];
				if (idx === undefined) continue;
				if (idx === gceTransparent) continue;
				const c = idx * 3;
				const o = (destY * iw + x) * 4;
				px[o] = table[c]!;
				px[o + 1] = table[c + 1]!;
				px[o + 2] = table[c + 2]!;
				px[o + 3] = 255;
			}
		}

		// Disposal 3 restores the PREVIOUS canvas state after this frame.
		let saved: ImageData | null = null;
		if (gceDisposal === 3) {
			saved = cctx.getImageData(0, 0, width, height);
		}
		const patchCanvas = document.createElement('canvas');
		patchCanvas.width = iw;
		patchCanvas.height = ih;
		patchCanvas.getContext('2d')!.putImageData(patch, 0, 0);
		cctx.drawImage(patchCanvas, left, top);

		const bitmap = await createImageBitmap(composite);
		// Browsers render delays under 2cs as 10cs (Chrome's heuristic).
		const delayCs = gceDelayCs < 2 ? 10 : gceDelayCs;
		const dur = Math.max(delayCs / 100, 0.02);
		frames.push({ timestamp, duration: dur, frame: bitmap });
		timestamp += dur;

		if (gceDisposal === 2) {
			cctx.clearRect(left, top, iw, ih);
		} else if (gceDisposal === 3 && saved) {
			cctx.putImageData(saved, 0, 0);
		}
		// Reset per-frame GCE for the next block.
		gceDelayCs = 0;
		gceDisposal = 0;
		gceTransparent = -1;
	}

	if (!frames.length) throw new Error('The GIF has no frames');
	return {
		width,
		height,
		duration: Math.max(timestamp, 0.1),
		frames,
		close: () => frames.forEach((f) => f.frame.close())
	};
}

/** Paint the frame active at `timeSec` onto a 2D context (cover-fit, with
 *  optional crop/zoom framing so GIF bases frame like every other media). */
export function paintGifFrameAt(
	ctx: CanvasRenderingContext2D,
	gif: DecodedGif,
	timeSec: number,
	canvas: { width: number; height: number },
	transform?: { scale: number; x: number; y: number }
): void {
	const clamped = Math.max(0, Math.min(timeSec, gif.duration));
	let active = gif.frames[0];
	for (const f of gif.frames) {
		if (f.timestamp <= clamped) active = f;
		else break;
	}
	if (!active) return;
	// Cover-fit like every other meme source so overlays stay aligned.
	// A closed/invalid bitmap must never kill the export's paint loop —
	// skip the frame instead of throwing through requestAnimationFrame.
	try {
		const cw = canvas.width;
		const ch = canvas.height;
		const fw = active.frame.width || 1;
		const fh = active.frame.height || 1;
		const zoom = Math.min(4, Math.max(1, transform?.scale ?? 1));
		const scale = Math.max(cw / fw, ch / fh) * zoom;
		const w = fw * scale;
		const h = fh * scale;
		const maxX = Math.max(0, (w - cw) / 2);
		const maxY = Math.max(0, (h - ch) / 2);
		const dx = Math.min(1, Math.max(-1, transform?.x ?? 0)) * maxX;
		const dy = Math.min(1, Math.max(-1, transform?.y ?? 0)) * maxY;
		ctx.drawImage(active.frame, (cw - w) / 2 + dx, (ch - h) / 2 + dy, w, h);
	} catch {
		/* frame invalidated mid-session — the next paint picks another */
	}
}

/**
 * Frame source for an ANIMATED image layer: given the layer's natural size
 * (w/h of its landed box on the export canvas), paint the layer's GIF frame
 * active at `timeSec` into that box. Static paints use a shared 1×1 offscreen
 * so layers never fight over one canvas.
 */
export function gifLayerPainter(
	gif: DecodedGif,
	box: { w: number; h: number }
): {
	paint: (ctx: CanvasRenderingContext2D, x: number, y: number, timeSec: number) => void;
	close: () => void;
} {
	const scratch = document.createElement('canvas');
	scratch.width = Math.max(2, Math.round(box.w) & ~1);
	scratch.height = Math.max(2, Math.round(box.h) & ~1);
	const sctx = scratch.getContext('2d');
	return {
		paint: (ctx, x, y, timeSec) => {
			if (!sctx) return;
			// Layers LOOP for as long as the export runs — the paint clock is
			// media time (tens of seconds), while the clip itself is ~1-3s.
			// paintGifFrameAt clamps past-the-end times to the final frame,
			// which would freeze the layer after its first pass (the "GIF
			// stopped moving in my video" bug) — wrap instead.
			const loopsIn = gif.duration > 0 ? timeSec % gif.duration : 0;
			sctx.clearRect(0, 0, scratch.width, scratch.height);
			paintGifFrameAt(sctx, gif, loopsIn, scratch);
			ctx.drawImage(scratch, x, y);
		},
		close: () => {
			scratch.width = 0;
			scratch.height = 0;
		}
	};
}
