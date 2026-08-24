import { describe, expect, it } from 'vitest';
import { parseGce } from '$lib/meme/gif';

/** GCE body: [size=4][packed][delay lo][delay hi][transparentIdx][terminator]. */
function gce(packed: number, delayCs: number, transparentIdx: number): Uint8Array {
	return new Uint8Array([4, packed, delayCs & 0xff, (delayCs >> 8) & 0xff, transparentIdx, 0]);
}

describe('parseGce', () => {
	it('reads the transparent index from pos+4 (regression: pos+3 read the delay high byte)', () => {
		// Real-world shape: transparency flag set, index 255, delay 7cs.
		// The buggy read returned bytes[3] (delay high = 0) and transparent
		// pixels rendered as palette color 0 instead of staying see-through.
		const bytes = gce(0b0000_0101, 7, 255);
		expect(parseGce(bytes, 0)).toEqual({ delayCs: 7, disposal: 1, transparentIdx: 255 });
	});

	it('returns -1 when the transparency flag is clear', () => {
		const bytes = gce(0b0000_0100, 20, 114);
		expect(parseGce(bytes, 0).transparentIdx).toBe(-1);
	});

	it('parses offsets relative to pos (mid-stream extensions)', () => {
		const bytes = new Uint8Array([0xff, 0xff, 0xff, ...gce(0b0000_1001, 300, 66)]);
		expect(parseGce(bytes, 3)).toEqual({ delayCs: 300, disposal: 2, transparentIdx: 66 });
	});

	it('extracts every disposal code', () => {
		for (const disposal of [0, 1, 2, 3]) {
			const bytes = gce(disposal << 2, 0, 9);
			expect(parseGce(bytes, 0).disposal).toBe(disposal);
		}
	});

	it('reads multi-byte delays little-endian', () => {
		const bytes = gce(0, 0x0102, 0);
		expect(parseGce(bytes, 0).delayCs).toBe(0x0102);
	});
});
