import { describe, expect, it } from 'vitest';
import { encodeWav, monoMix, trimTo } from './sound-from-video';

/** Ramp signal 0..n so byte values are predictable in assertions. */
function ramp(n: number): Float32Array {
	return Float32Array.from({ length: n }, (_, i) => i / n);
}

describe('monoMix', () => {
	it('passes a single channel through unchanged', () => {
		const ch = ramp(8);
		expect(monoMix([ch])).toEqual(ch);
	});

	it('averages stereo into mono', () => {
		const left = Float32Array.from([1, 0.5, -1]);
		const right = Float32Array.from([0, 0.5, 1]);
		const mono = monoMix([left, right]);
		expect(mono[0]).toBeCloseTo(0.5);
		expect(mono[1]).toBeCloseTo(0.5);
		expect(mono[2]).toBeCloseTo(0);
	});

	it('clamps mixed output to [-1, 1]', () => {
		const mono = monoMix([
			Float32Array.from([1, -1]),
			Float32Array.from([1, -1]),
			Float32Array.from([1, -1])
		]);
		expect([...mono]).toEqual([1, -1]);
	});
});

describe('trimTo', () => {
	it('keeps everything under the cap', () => {
		const ch = ramp(100);
		expect(trimTo(ch, 10, 15)).toHaveLength(100);
	});

	it('slices to sampleRate × maxSeconds', () => {
		const ch = ramp(1000);
		const out = trimTo(ch, 100, 2); // 100 Hz × 2s = 200 samples
		expect(out).toHaveLength(200);
		expect(out[0]).toBe(ch[0]);
		expect(out[199]).toBe(ch[199]);
	});
});

describe('encodeWav', () => {
	it('writes a canonical 16-bit PCM mono RIFF header', () => {
		const bytes = encodeWav(Float32Array.from([0, 0.5, -0.5, 1, -1]), 48_000);
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		// RIFF header
		expect(String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!)).toBe('RIFF');
		expect(String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!)).toBe('WAVE');
		expect(String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!)).toBe('fmt ');
		expect(view.getUint32(16, true)).toBe(16); // PCM chunk size
		expect(view.getUint16(20, true)).toBe(1); // PCM format
		expect(view.getUint16(22, true)).toBe(1); // mono
		expect(view.getUint32(24, true)).toBe(48_000); // sample rate
		expect(view.getUint16(32, true)).toBe(16); // bits per sample
		expect(String.fromCharCode(bytes[36]!, bytes[37]!, bytes[38]!, bytes[39]!)).toBe('data');
		expect(view.getUint32(40, true)).toBe(10); // 5 samples × 2 bytes
		expect(bytes).toHaveLength(44 + 10);
	});

	it('quantizes float samples to int16 with clamping', () => {
		const bytes = encodeWav(Float32Array.from([0, 0.5, -0.5, 2]), 8000);
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		expect(view.getInt16(44, true)).toBe(0);
		expect(view.getInt16(46, true)).toBe(16_384); // 0.5 × 32768 → 16384
		expect(view.getInt16(48, true)).toBe(-16_383); // -0.5 × 32767 rounds half-up
		expect(view.getInt16(50, true)).toBe(32_767); // clamped, not wrapped
	});
});
