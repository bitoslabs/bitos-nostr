import { describe, expect, it } from 'vitest';
import {
	DEFAULT_PROBE_LIMITS,
	probeMediaLimits,
	probeToImetaInputs,
	type ProbeLimits
} from './video-probe';

/* --------------------------------------------------------------------------
   Probe limit checks — plan PUB-007 / §11 security caps
---------------------------------------------------------------------------- */

const tightLimits: ProbeLimits = { maxBytes: 1000, maxDurationSeconds: 10, maxMegapixels: 1 };

describe('DEFAULT_PROBE_LIMITS', () => {
	it('matches the V1 plan values', () => {
		expect(DEFAULT_PROBE_LIMITS.maxBytes).toBe(200 * 1024 * 1024);
		expect(DEFAULT_PROBE_LIMITS.maxDurationSeconds).toBe(60);
		expect(DEFAULT_PROBE_LIMITS.maxMegapixels).toBe(50);
	});
});

describe('probeMediaLimits', () => {
	it('accepts metadata within every limit', () => {
		expect(probeMediaLimits({ width: 1080, height: 1920, duration: 59.9 })).toBeNull();
		expect(probeMediaLimits({ width: 1000, height: 1000 }, tightLimits)).toBeNull();
	});

	it('flags over-long durations with the limit in the detail', () => {
		const err = probeMediaLimits({ width: 1080, height: 1920, duration: 61 });
		expect(err).toMatchObject({ ok: false, reason: 'too-long' });
		expect(err?.detail).toContain('60s');
	});

	it('flags decompression-bomb dimensions', () => {
		// 12000×12000 = 144 MP ≫ the 50 MP cap.
		const err = probeMediaLimits({ width: 12000, height: 12000 });
		expect(err).toMatchObject({ ok: false, reason: 'too-many-megapixels' });
		expect(err?.detail).toContain('MP');
	});

	it('flags non-positive durations as track problems', () => {
		expect(probeMediaLimits({ width: 1080, height: 1920, duration: 0 })).toMatchObject({
			ok: false,
			reason: 'no-tracks'
		});
	});

	it('leaves unknown durations alone (streamed files report Infinity)', () => {
		expect(probeMediaLimits({ width: 1080, height: 1920 })).toBeNull();
	});

	it('evaluates limits against the provided limit set', () => {
		// 1001×1001 > 1 MP under the tight set, fine under defaults.
		expect(probeMediaLimits({ width: 1001, height: 1001 }, tightLimits)).toMatchObject({
			reason: 'too-many-megapixels'
		});
		expect(probeMediaLimits({ width: 1001, height: 1001 })).toBeNull();
	});
});

describe('probeToImetaInputs', () => {
	it('maps video probes to dim + duration for postBitz', () => {
		expect(
			probeToImetaInputs({ ok: true, kind: 'video', width: 1080, height: 1920, duration: 8.4 })
		).toEqual({ dim: '1080x1920', duration: 8.4 });
	});

	it('omits duration for image probes', () => {
		expect(probeToImetaInputs({ ok: true, kind: 'image', width: 1080, height: 1350 })).toEqual({
			dim: '1080x1350',
			duration: undefined
		});
	});
});
