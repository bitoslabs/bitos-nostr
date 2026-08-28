import { describe, expect, it } from 'vitest';
import { isAnimatedWebp } from '$lib/meme/gif';

function webp(...chunks: Array<[string, number]>): ArrayBuffer {
	const size = 4 + chunks.reduce((total, [, length]) => total + 8 + length + (length & 1), 0);
	const bytes = new Uint8Array(8 + size);
	bytes.set([...new TextEncoder().encode('RIFF')], 0);
	new DataView(bytes.buffer).setUint32(4, size, true);
	bytes.set([...new TextEncoder().encode('WEBP')], 8);
	let pos = 12;
	for (const [name, length] of chunks) {
		bytes.set([...new TextEncoder().encode(name)], pos);
		new DataView(bytes.buffer).setUint32(pos + 4, length, true);
		pos += 8 + length + (length & 1);
	}
	return bytes.buffer;
}

describe('isAnimatedWebp', () => {
	it('recognizes animation chunks and leaves static WebP alone', () => {
		expect(isAnimatedWebp(webp(['VP8 ', 10]))).toBe(false);
		expect(isAnimatedWebp(webp(['VP8X', 10], ['ANIM', 6], ['ANMF', 20]))).toBe(true);
	});

	it('rejects non-WebP data', () => {
		expect(isAnimatedWebp(new ArrayBuffer(16))).toBe(false);
	});
});
