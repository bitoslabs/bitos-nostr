import { describe, expect, it } from 'vitest';
import { gifLzwEncode, medianCut } from './gif-encode';

/** Independent GIF-LZW decoder (written from the spec) — validates the
 *  encoder by round-trip instead of trusting shared code. */
function referenceLzwDecode(bytes: Uint8Array, minCodeSize: number): number[] {
	const clear = 1 << minCodeSize;
	const end = clear + 1;
	let codeSize = minCodeSize + 1;
	const dict: number[][] = [];
	const reset = () => {
		dict.length = 0;
		for (let i = 0; i < clear; i++) dict.push([i]);
		dict.push([]);
		dict.push([]);
		codeSize = minCodeSize + 1;
	};
	reset();
	const out: number[] = [];
	let bitPos = 0;
	const read = () => {
		let code = 0;
		for (let i = 0; i < codeSize; i++) {
			const byte = bytes[bitPos >> 3] ?? 0;
			if (byte & (1 << (bitPos & 7))) code |= 1 << i;
			bitPos++;
		}
		return code;
	};
	let prev: number[] | null = null;
	for (;;) {
		const code = read();
		if (code === clear) {
			reset();
			prev = null;
			continue;
		}
		if (code === end) break;
		let entry: number[];
		if (code < dict.length) {
			entry = dict[code]!;
		} else if (prev) {
			entry = [...prev, prev[0]!];
		} else {
			throw new Error(`bad code ${code}`);
		}
		out.push(...entry);
		if (prev) {
			dict.push([...prev, entry[0]!]);
			if (dict.length === 1 << codeSize && codeSize < 12) codeSize++;
		}
		prev = entry;
	}
	return out;
}

describe('gif-encode', () => {
	it('LZW round-trips random index streams at several code sizes', () => {
		for (const minCodeSize of [2, 3, 8]) {
			const alphabet = 1 << Math.min(minCodeSize, 8);
			for (let trial = 0; trial < 5; trial++) {
				const len = 500 + trial * 137;
				const indices = new Uint8Array(len);
				for (let i = 0; i < len; i++) {
					// Mix runs and noise so the dictionary actually exercises.
					indices[i] =
						i % 7 === 0 ? Math.floor(Math.random() * alphabet) : indices[Math.max(0, i - 1)]!;
				}
				const encoded = gifLzwEncode(indices, minCodeSize);
				const decoded = referenceLzwDecode(encoded, minCodeSize);
				expect(decoded).toEqual([...indices]);
			}
		}
	});

	it('LZW survives dictionary overflow (4096 codes → clear + reset)', () => {
		// High-entropy data with a large alphabet forces the 12-bit ceiling.
		const indices = new Uint8Array(60_000);
		let x = 12345;
		for (let i = 0; i < indices.length; i++) {
			x = (x * 1103515245 + 12345) & 0x7fffffff;
			indices[i] = x & 0xff;
		}
		const decoded = referenceLzwDecode(gifLzwEncode(indices, 8), 8);
		expect(decoded.length).toBe(indices.length);
		expect(decoded).toEqual([...indices]);
	});

	it('medianCut caps the palette and indexes every pixel', () => {
		// A smooth 3-channel gradient quantizes to a compact palette.
		const data = new Uint8ClampedArray(64 * 64 * 4);
		for (let y = 0; y < 64; y++) {
			for (let x = 0; x < 64; x++) {
				const o = (y * 64 + x) * 4;
				data[o] = x * 4;
				data[o + 1] = y * 4;
				data[o + 2] = (x + y) * 2;
				data[o + 3] = 255;
			}
		}
		const { palette, indices } = medianCut(data, 256);
		expect(palette.length).toBeGreaterThan(0);
		expect(palette.length % 3).toBe(0);
		expect(palette.length / 3).toBeLessThanOrEqual(256);
		expect(indices.length).toBe(64 * 64);
		for (const idx of indices) expect(idx).toBeLessThan(palette.length / 3);
	});

	it('medianCut maps near-black pixels to a dark palette entry', () => {
		const data = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 250, 250, 250, 255]);
		const { palette, indices } = medianCut(data, 4);
		const [r, g, b] = [
			palette[indices[0]! * 3]!,
			palette[indices[0]! * 3 + 1]!,
			palette[indices[0]! * 3 + 2]!
		];
		expect(r + g + b).toBeLessThan(60);
		const [r2, g2, b2] = [
			palette[indices[2]! * 3]!,
			palette[indices[2]! * 3 + 1]!,
			palette[indices[2]! * 3 + 2]!
		];
		expect(r2 + g2 + b2).toBeGreaterThan(600);
	});
});
