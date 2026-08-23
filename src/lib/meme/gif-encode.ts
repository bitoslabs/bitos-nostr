/**
 * Animated GIF encoder — pure TS, no dependencies.
 *
 * The mirror of gif.ts's decoder: per-frame median-cut quantization (local
 * color tables) + the GIF LZW variant. Compositions are opaque full frames,
 * so no transparency/disposal tricks — every frame is a complete picture.
 * Powers the studio's "GIF" export format (and could round-trip our own
 * decoder: encodeAnimatedGif output decodes with decodeGif).
 */

export interface GifEncodeFrame {
	/** Anything drawImage accepts (ImageBitmap, canvas, img…). */
	source: CanvasImageSource;
	/** Frame hold time (ms) — stored as centiseconds, min 20. */
	delayMs: number;
}

/** GIF LZW compression (omggif-style code-size cadence). Exported for tests. */
export function gifLzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array {
	const clearCode = 1 << minCodeSize;
	const endCode = clearCode + 1;
	let codeSize = minCodeSize + 1;
	let next = endCode + 1;
	let dict = new Map<number, number>();

	const bytes: number[] = [];
	let bitBuf = 0;
	let bitCnt = 0;
	const emit = (code: number) => {
		bitBuf |= code << bitCnt;
		bitCnt += codeSize;
		while (bitCnt >= 8) {
			bytes.push(bitBuf & 0xff);
			bitBuf >>= 8;
			bitCnt -= 8;
		}
	};

	emit(clearCode);
	let prefix = indices[0] ?? 0;
	for (let i = 1; i < indices.length; i++) {
		const k = indices[i]!;
		const key = (prefix << 8) | k;
		const cur = dict.get(key);
		if (cur !== undefined) {
			prefix = cur;
			continue;
		}
		emit(prefix);
		if (next === 4096) {
			emit(clearCode);
			dict = new Map();
			next = endCode + 1;
			codeSize = minCodeSize + 1;
		} else {
			if (next >= 1 << codeSize && codeSize < 12) codeSize++;
			dict.set(key, next++);
		}
		prefix = k;
	}
	emit(prefix);
	emit(endCode);
	if (bitCnt > 0) bytes.push(bitBuf & 0xff);
	return new Uint8Array(bytes);
}

interface ColorBox {
	/** Histogram keys in this box. */
	keys: number[];
	/** Weighted channel sums + count for the box average. */
	rs: number;
	gs: number;
	bs: number;
	n: number;
	/** Min/max per channel (for the longest-axis split). */
	min: [number, number, number];
	max: [number, number, number];
}

/** 5-bit-per-channel histogram key (fits a Map comfortably). */
function colorKey(r: number, g: number, b: number): number {
	return ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
}

/**
 * Median-cut quantization over a 5-bit histogram of the frame. Returns a
 * ≤maxColors palette (RGB triplets) + per-pixel palette indices. Keys map
 * straight to their box, so mapping is O(1) per pixel after the cut.
 * Exported for tests.
 */
export function medianCut(
	data: Uint8ClampedArray,
	maxColors: number
): { palette: Uint8Array; indices: Uint8Array } {
	const hist = new Map<number, { r: number; g: number; b: number; n: number }>();
	for (let i = 0; i < data.length; i += 4) {
		if (data[i + 3]! < 128) continue;
		const r = data[i]!;
		const g = data[i + 1]!;
		const b = data[i + 2]!;
		const key = colorKey(r, g, b);
		const e = hist.get(key);
		if (e) {
			e.r += r;
			e.g += g;
			e.b += b;
			e.n++;
		} else {
			hist.set(key, { r, g, b, n: 1 });
		}
	}

	const keyOf = (k: number) =>
		[((k >> 10) & 31) << 3, ((k >> 5) & 31) << 3, (k & 31) << 3] as const;

	const boxOf = (keys: number[]): ColorBox => {
		const box: ColorBox = {
			keys,
			rs: 0,
			gs: 0,
			bs: 0,
			n: 0,
			min: [255, 255, 255],
			max: [0, 0, 0]
		};
		for (const k of keys) {
			const e = hist.get(k)!;
			box.rs += e.r;
			box.gs += e.g;
			box.bs += e.b;
			box.n += e.n;
			const c = keyOf(k);
			for (let ch = 0; ch < 3; ch++) {
				if (c[ch]! < box.min[ch]!) box.min[ch] = c[ch]!;
				if (c[ch]! > box.max[ch]!) box.max[ch] = c[ch]!;
			}
		}
		return box;
	};

	let boxes: ColorBox[] = [boxOf([...hist.keys()])];
	while (boxes.length < maxColors) {
		// Split the box with the largest (pixel-weighted) channel range.
		let best: ColorBox | null = null;
		let bestRange = -1;
		let bestCh = 0;
		for (const box of boxes) {
			if (box.keys.length < 2) continue;
			for (let ch = 0; ch < 3; ch++) {
				const range = (box.max[ch]! - box.min[ch]!) * box.n;
				if (range > bestRange) {
					bestRange = range;
					best = box;
					bestCh = ch;
				}
			}
		}
		if (!best) break;
		const sorted = [...best.keys].sort((a, b) => keyOf(a)[bestCh]! - keyOf(b)[bestCh]!);
		const mid = sorted.length >> 1;
		const replacement = [boxOf(sorted.slice(0, mid)), boxOf(sorted.slice(mid))];
		boxes = boxes.flatMap((b) => (b === best ? replacement : [b]));
	}

	// palette + key → index
	const palette = new Uint8Array(boxes.length * 3);
	const keyIndex = new Map<number, number>();
	boxes.forEach((box, i) => {
		palette[i * 3] = Math.round(box.rs / box.n);
		palette[i * 3 + 1] = Math.round(box.gs / box.n);
		palette[i * 3 + 2] = Math.round(box.bs / box.n);
		for (const k of box.keys) keyIndex.set(k, i);
	});

	const indices = new Uint8Array(data.length / 4);
	for (let i = 0, p = 0; i < data.length; i += 4, p++) {
		const alpha = data[i + 3]!;
		const idx =
			alpha < 128 ? 0 : (keyIndex.get(colorKey(data[i]!, data[i + 1]!, data[i + 2]!)) ?? 0);
		indices[p] = idx;
	}
	return { palette, indices };
}

/** Encode frames as a looping animated GIF. */
export async function encodeAnimatedGif(
	frames: GifEncodeFrame[],
	size: { width: number; height: number }
): Promise<Blob> {
	if (!frames.length) throw new Error('Nothing to encode — the frame list is empty');
	const { width, height } = size;
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas is not available in this browser');

	const out: number[] = [];
	const push = (...b: number[]) => out.push(...b);
	const push16 = (v: number) => push(v & 0xff, (v >> 8) & 0xff);

	// Header + logical screen (no global table — frames carry local ones).
	push(...[0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // "GIF89a"
	push16(width);
	push16(height);
	push(0x70, 0, 0); // no GCT, color resolution, aspect
	// NETSCAPE loop-forever extension.
	push(0x21, 0xff, 0x0b);
	for (const ch of 'NETSCAPE2.0') push(ch.charCodeAt(0));
	push(0x03, 0x01, 0x00, 0x00, 0x00);

	for (const frame of frames) {
		ctx.clearRect(0, 0, width, height);
		ctx.drawImage(frame.source, 0, 0, width, height);
		const { data } = ctx.getImageData(0, 0, width, height);
		const { palette, indices } = medianCut(data, 256);

		// Graphic control: disposal 0, delay in centiseconds.
		const delayCs = Math.max(2, Math.round(frame.delayMs / 10));
		push(0x21, 0xf9, 0x04, 0x00);
		push16(delayCs);
		push(0x00, 0x00);

		// Image descriptor + local color table.
		const bits = Math.max(1, Math.ceil(Math.log2(Math.max(2, palette.length / 3))));
		const tableEntries = 1 << bits;
		push(0x2c);
		push16(0);
		push16(0);
		push16(width);
		push16(height);
		push(0x80 | (bits - 1));
		for (let i = 0; i < tableEntries; i++) {
			push(palette[i * 3] ?? 0, palette[i * 3 + 1] ?? 0, palette[i * 3 + 2] ?? 0);
		}

		// LZW data as ≤255-byte sub-blocks.
		const minCodeSize = Math.max(2, bits);
		const lzw = gifLzwEncode(indices, minCodeSize);
		push(minCodeSize);
		for (let i = 0; i < lzw.length; i += 255) {
			const chunk = lzw.subarray(i, i + 255);
			push(chunk.length, ...chunk);
		}
		push(0x00);
	}

	push(0x3b); // trailer
	const bytes = new Uint8Array(out);
	return new Blob([bytes], { type: 'image/gif' });
}
