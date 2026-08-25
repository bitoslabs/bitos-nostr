import { describe, expect, it } from 'vitest';
import {
	MAX_PUBLISH_SECONDS,
	MIN_TRIM_SECONDS,
	adjustTrim,
	coverScrubBounds,
	defaultTrim,
	isTrimmlable,
	normalizeTrim,
	validateTrim
} from './video-trim';

describe('normalizeTrim', () => {
	it('fills missing points with 0 and the source duration', () => {
		expect(normalizeTrim({}, 8.4)).toEqual({ inSeconds: 0, outSeconds: 8.4 });
	});

	it('clamps points to the source bounds', () => {
		expect(normalizeTrim({ inSeconds: -2, outSeconds: 99 }, 10)).toEqual({
			inSeconds: 0,
			outSeconds: 10
		});
	});

	it('swaps inverted points instead of producing a negative range', () => {
		expect(normalizeTrim({ inSeconds: 7, outSeconds: 3 }, 10)).toEqual({
			inSeconds: 3,
			outSeconds: 7
		});
	});

	it('rounds to millisecond precision', () => {
		const range = normalizeTrim({ inSeconds: 0.12345, outSeconds: 1.99999 }, 3);
		expect(range.inSeconds).toBe(0.123);
		expect(range.outSeconds).toBe(2);
	});

	it('treats non-finite source durations as zero-length', () => {
		expect(normalizeTrim({ inSeconds: 1, outSeconds: 2 }, Number.NaN)).toEqual({
			inSeconds: 0,
			outSeconds: 0
		});
	});
});

describe('defaultTrim', () => {
	it('uses the full source when within the publish cap', () => {
		expect(defaultTrim(8.4)).toEqual({ inSeconds: 0, outSeconds: 8.4 });
		expect(defaultTrim(MAX_PUBLISH_SECONDS)).toEqual({
			inSeconds: 0,
			outSeconds: MAX_PUBLISH_SECONDS
		});
	});

	it('pre-cuts longer sources to the publish cap', () => {
		expect(defaultTrim(120)).toEqual({ inSeconds: 0, outSeconds: MAX_PUBLISH_SECONDS });
	});
});

describe('validateTrim', () => {
	it('accepts a normal range and reports its duration', () => {
		expect(validateTrim({ inSeconds: 2, outSeconds: 10 })).toEqual({
			valid: true,
			durationSeconds: 8
		});
	});

	it('rejects inverted and zero-length ranges with a fix suggestion', () => {
		const inverted = validateTrim({ inSeconds: 5, outSeconds: 5 });
		expect(inverted.valid).toBe(false);
		expect(inverted.reason).toBe('inverted');
		expect(inverted.suggested).toEqual({ inSeconds: 5, outSeconds: 5 + MIN_TRIM_SECONDS });
	});

	it('rejects sub-second slivers', () => {
		const tiny = validateTrim({ inSeconds: 1, outSeconds: 1.4 });
		expect(tiny.valid).toBe(false);
		expect(tiny.reason).toBe('too-short');
	});

	it('flags publish-cap overruns and shortens from the tail', () => {
		const over = validateTrim({ inSeconds: 10, outSeconds: 90 });
		expect(over.valid).toBe(false);
		expect(over.reason).toBe('over-publish-cap');
		expect(over.suggested).toEqual({ inSeconds: 10, outSeconds: 10 + MAX_PUBLISH_SECONDS });
	});

	it('skips the publish cap when the range is draft-only', () => {
		expect(validateTrim({ inSeconds: 0, outSeconds: 200 }, { forPublish: false })).toEqual({
			valid: true,
			durationSeconds: 200
		});
	});
});

describe('adjustTrim', () => {
	it('moves the in-edge while keeping the out-edge stable', () => {
		expect(adjustTrim({ inSeconds: 0, outSeconds: 10 }, 'in', 4, 10)).toEqual({
			inSeconds: 4,
			outSeconds: 10
		});
	});

	it('moves the out-edge similarly', () => {
		expect(adjustTrim({ inSeconds: 2, outSeconds: 10 }, 'out', 5, 10)).toEqual({
			inSeconds: 2,
			outSeconds: 5
		});
	});

	it('clamps the requested value into the source', () => {
		expect(adjustTrim({ inSeconds: 0, outSeconds: 10 }, 'out', 55, 10)).toEqual({
			inSeconds: 0,
			outSeconds: 10
		});
	});

	it('lets an edge cross its partner (roles swap)', () => {
		expect(adjustTrim({ inSeconds: 0, outSeconds: 10 }, 'in', 15, 10)).toEqual({
			inSeconds: 10,
			outSeconds: 10
		});
	});
});

describe('isTrimmlable', () => {
	it('requires a known duration longer than the minimum cut', () => {
		expect(isTrimmlable(undefined)).toBe(false);
		expect(isTrimmlable(0.5)).toBe(false);
		expect(isTrimmlable(8.4)).toBe(true);
	});
});

describe('coverScrubBounds', () => {
	it('bounds cover scrubbing to the trim range', () => {
		expect(coverScrubBounds({ inSeconds: 2, outSeconds: 9 })).toEqual({ min: 2, max: 9 });
	});
});
