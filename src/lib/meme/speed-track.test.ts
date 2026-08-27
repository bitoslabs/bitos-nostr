/**
 * speed-track contract tests — media-timed windows, normalize/sort/de-overlap,
 * rate lookup, the export↔media time mapping (trapezoid integration), the
 * trim/rate shift, and the wire codec round-trip.
 */
import { describe, expect, it } from 'vitest';
import {
	MAX_RATE,
	MIN_RATE,
	decodeSpeedWindows,
	encodeSpeedWindows,
	exportMsToMediaMs,
	mediaMsToExportMs,
	normalizeSpeedWindow,
	normalizeSpeedWindows,
	rateAt,
	shiftCuesForExportWithSpeeds,
	shiftSpeedsForExport,
	speedActiveAt,
	zoomHintsForSpeeds
} from './speed-track';

const slow = (over: Partial<{ startMs: number; endMs: number; rate: number }> = {}) =>
	normalizeSpeedWindow({ startMs: 1000, endMs: 2000, rate: 0.5, ...over })!;

describe('normalizeSpeedWindow', () => {
	it('keeps a valid window', () => {
		const w = slow();
		expect(w.startMs).toBe(1000);
		expect(w.endMs).toBe(2000);
		expect(w.rate).toBeCloseTo(0.5);
	});

	it('rejects no-op rates, bad spans, junk', () => {
		expect(normalizeSpeedWindow({ startMs: 0, endMs: 500, rate: 1 })).toBeNull();
		expect(normalizeSpeedWindow({ startMs: 500, endMs: 500, rate: 0.5 })).toBeNull();
		expect(normalizeSpeedWindow(null)).toBeNull();
		expect(normalizeSpeedWindow('slow')).toBeNull();
	});

	it('clamps rate into the browser-safe span', () => {
		expect(normalizeSpeedWindow({ startMs: 0, endMs: 500, rate: 9 })!.rate).toBe(MAX_RATE);
		expect(normalizeSpeedWindow({ startMs: 0, endMs: 500, rate: 0.1 })!.rate).toBe(MIN_RATE);
	});
});

describe('normalizeSpeedWindows', () => {
	it('sorts + keeps one rate per moment', () => {
		const rows = normalizeSpeedWindows([
			{ startMs: 2000, endMs: 2600, rate: 2 },
			{ startMs: 0, endMs: 500, rate: 0.5 },
			{ startMs: 300, endMs: 900, rate: 2 } // overlaps the 0–500 — dropped
		]);
		expect(rows).toHaveLength(2);
		expect(rows[0]!.startMs).toBe(0);
	});

	it('tolerates non-arrays', () => {
		expect(normalizeSpeedWindows(undefined)).toEqual([]);
	});
});

describe('rateAt + speedActiveAt', () => {
	it('returns the window rate inside, 1 outside', () => {
		const windows = normalizeSpeedWindows([{ startMs: 1000, endMs: 2000, rate: 0.5 }]);
		expect(rateAt(windows, 0)).toBe(1);
		expect(rateAt(windows, 1500)).toBeCloseTo(0.5);
		expect(rateAt(windows, 2000)).toBe(1); // end exclusive
		expect(speedActiveAt(windows[0]!, 1000)).toBe(true);
		expect(speedActiveAt(windows[0]!, 2000)).toBe(false);
	});
});

describe('exportMsToMediaMs', () => {
	it('identity with no windows', () => {
		expect(exportMsToMediaMs([], 4000)).toBe(4000);
	});

	it('stretches export time inside a slow-mo window', () => {
		// Window: media 1000–2000 at 0.5× → export span 1000–3000 (2000 ms).
		const windows = normalizeSpeedWindows([{ startMs: 1000, endMs: 2000, rate: 0.5 }]);
		// Before the window: 1:1.
		expect(exportMsToMediaMs(windows, 500)).toBe(500);
		// 500 export ms into the span consumed 500×0.5 = 250 media ms → 1250.
		expect(exportMsToMediaMs(windows, 1500)).toBe(1250);
		// The window's full export span ends at 3000 (media fully at 2000).
		expect(exportMsToMediaMs(windows, 3000)).toBe(2000);
		// Past the window: normal rate resumes (media = 2000 + excess).
		expect(exportMsToMediaMs(windows, 3500)).toBe(2500);
	});

	it('compresses export time inside a speed-up window', () => {
		const windows = normalizeSpeedWindows([{ startMs: 1000, endMs: 2000, rate: 2 }]);
		// At 2× each export ms eats 2 media ms: export 1500 → media 1000+1000.
		expect(exportMsToMediaMs(windows, 1500)).toBe(2000);
	});
});

describe('shiftSpeedsForExport', () => {
	it('remaps by trim + rate and drops outside windows', () => {
		const shifted = shiftSpeedsForExport([slow()], 1, 2, 10);
		expect(shifted[0]!.startMs).toBe(0);
		expect(shifted[0]!.endMs).toBe(500);
		expect(shiftSpeedsForExport([slow()], 3, 1, 10)).toHaveLength(0);
	});
});

describe('wire codec', () => {
	it('round-trips', () => {
		const windows = normalizeSpeedWindows([
			{ startMs: 0, endMs: 800, rate: 0.5 },
			{ startMs: 2000, endMs: 2600, rate: 1.75 }
		]);
		expect(decodeSpeedWindows(encodeSpeedWindows(windows))).toEqual(windows);
	});

	it('drops junk rows', () => {
		expect(decodeSpeedWindows([['x'], null, [0, 100, 1]])).toEqual([]);
	});
});

describe('zoomHintsForSpeeds', () => {
	it('hints zooms for slow-mo windows only, scale by slowness', () => {
		const hints = zoomHintsForSpeeds(
			normalizeSpeedWindows([
				{ startMs: 0, endMs: 800, rate: 0.5 },
				{ startMs: 2000, endMs: 2600, rate: 2 }
			])
		);
		expect(hints).toHaveLength(1);
		expect(hints[0]!.factor).toBeCloseTo(2.2);
	});
});

describe('mediaMsToExportMs (forward integration)', () => {
	it('identity with no windows', () => {
		expect(mediaMsToExportMs([], 4000)).toBe(4000);
	});

	it('compresses a slow-mo window, keeps gaps 1:1', () => {
		// Window: media 1000–2000 at 0.5× → export span 2000 ms.
		const windows = normalizeSpeedWindows([{ startMs: 1000, endMs: 2000, rate: 0.5 }]);
		expect(mediaMsToExportMs(windows, 500)).toBe(500);
		// Mid-window: 1000 gap + 250 media ÷ 0.5.
		expect(mediaMsToExportMs(windows, 1250)).toBe(1500);
		// Window end: the full span compressed.
		expect(mediaMsToExportMs(windows, 2000)).toBe(3000);
		// Tail after resumes 1:1.
		expect(mediaMsToExportMs(windows, 2500)).toBe(3500);
	});

	it('round-trips with exportMsToMediaMs across the curve', () => {
		const windows = normalizeSpeedWindows([
			{ startMs: 400, endMs: 1000, rate: 0.5 },
			{ startMs: 2000, endMs: 2600, rate: 2 }
		]);
		for (const t of [0, 250, 400, 700, 1000, 1500, 2000, 2300, 2600, 3200]) {
			const round = exportMsToMediaMs(windows, mediaMsToExportMs(windows, t));
			expect(round).toBe(t);
		}
	});
});

describe('shiftCuesForExportWithSpeeds', () => {
	const cue = (atMs: number) => ({ atMs, sfx: 'boom' });

	it('falls back to flat behavior with no ramps', () => {
		const out = shiftCuesForExportWithSpeeds([cue(5000)], [], 2, 2, 10);
		expect(out[0]!.atMs).toBe(1500); // (5000-2000)/2
	});

	it('integrates the ramp then divides by base rate', () => {
		const windows = normalizeSpeedWindows([{ startMs: 1000, endMs: 2000, rate: 0.5 }]);
		// Cue at media 1250 (mid-ramp) with base rate 1: export 1500.
		const out = shiftCuesForExportWithSpeeds([cue(1250)], windows, 0, 1, 10);
		expect(out).toHaveLength(1);
		expect(out[0]!.atMs).toBe(1500);
		// Base rate 2 on top: halves again.
		const fast = shiftCuesForExportWithSpeeds([cue(1250)], windows, 0, 2, 10);
		expect(fast[0]!.atMs).toBe(750);
	});

	it('drops cues past the export window', () => {
		const out = shiftCuesForExportWithSpeeds([cue(9500), cue(4000)], [], 0, 1, 8);
		expect(out).toHaveLength(1);
		expect(out[0]!.atMs).toBe(4000);
	});
});
