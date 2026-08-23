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
	/** Decoded VideoFrame - call `.close()` after painting. */
	frame: VideoFrame;
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

interface DecoderLike {
	completed: Promise<void>;
	tracks?: DecoderTrack[];
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

/** Can this browser decode GIFs frame-by-frame? */
export function canDecodeGif(): boolean {
	return decoderCtor() !== null;
}

/**
 * Decode an animated GIF into timestamped frames (one full pass; loop counts
 * are ignored - the export records a single pass by design).
 */
export async function decodeGif(data: ArrayBuffer): Promise<DecodedGif> {
	const Ctor = decoderCtor();
	if (!Ctor) throw new Error('This browser cannot decode animated GIFs frame by frame');
	const decoder = new Ctor({ data, type: 'image/gif', preferAnimation: true });
	const frames: GifFrame[] = [];
	try {
		await decoder.completed;
		const frameCount = decoder.tracks?.[0]?.frameCount ?? 0;
		if (!frameCount) throw new Error('The GIF has no frames');
		let timestamp = 0;
		for (let index = 0; index < frameCount; index++) {
			const frame = await decoder.decode({ frameIndex: index, completeFramesOnly: true });
			const micros = frame.duration ?? 0;
			const dur = micros / 1_000_000; // us -> s
			frames.push({ timestamp, duration: dur, frame });
			timestamp += dur;
		}
		if (!frames.length) throw new Error('The GIF decoded to zero frames');
		return {
			width: frames[0].frame.displayWidth,
			height: frames[0].frame.displayHeight,
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

/** Paint the frame active at `timeSec` onto a 2D context (cover-fit). */
export function paintGifFrameAt(
	ctx: CanvasRenderingContext2D,
	gif: DecodedGif,
	timeSec: number,
	canvas: { width: number; height: number }
): void {
	const clamped = Math.max(0, Math.min(timeSec, gif.duration));
	let active = gif.frames[0];
	for (const f of gif.frames) {
		if (f.timestamp <= clamped) active = f;
		else break;
	}
	if (!active) return;
	// Cover-fit like every other meme source so overlays stay aligned.
	const cw = canvas.width;
	const ch = canvas.height;
	const scale = Math.max(cw / active.frame.displayWidth, ch / active.frame.displayHeight);
	const dw = active.frame.displayWidth * scale;
	const dh = active.frame.displayHeight * scale;
	ctx.drawImage(active.frame as unknown as CanvasImageSource, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
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
			sctx.clearRect(0, 0, scratch.width, scratch.height);
			paintGifFrameAt(sctx, gif, timeSec, scratch);
			ctx.drawImage(scratch, x, y);
		},
		close: () => {
			scratch.width = 0;
			scratch.height = 0;
		}
	};
}
