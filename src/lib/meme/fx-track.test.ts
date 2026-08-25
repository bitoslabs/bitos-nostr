/**
 * fx-track contract tests — same covenant as zoom-track: windows in media
 * time, normalize clamps/sorts, export shift mirrors the cue convention, the
 * wire codec round-trips, and painters run without touching DOM APIs beyond
 * canvas (jsdom canvas is stubbed via a mock ctx where needed).
 */
import { describe, expect, it } from 'vitest';
import {
	DEFAULT_FX_INTENSITY,
	FRAME_FX_IDS,
	FRAME_FX_LABELS,
	MAX_FX_WINDOW_MS,
	MAX_FX_WINDOWS,
	decodeFxWindows,
	encodeFxWindows,
	fxActiveAt,
	fxPhase,
	fxPreviewStyle,
	isFrameFxId,
	normalizeFxWindow,
	normalizeFxWindows,
	paintFxFrame,
	shiftFxForExport
} from './fx-track';

const win = (over: Partial<Parameters<typeof normalizeFxWindow>[0]> = {}) =>
	normalizeFxWindow({
		fx: 'glitch',
		startMs: 1000,
		endMs: 2000,
		intensity: 0.8,
		...over
	})!;

describe('normalizeFxWindow', () => {
	it('keeps a valid window', () => {
		const w = win();
		expect(w.fx).toBe('glitch');
		expect(w.startMs).toBe(1000);
		expect(w.endMs).toBe(2000);
		expect(w.intensity).toBeCloseTo(0.8);
	});

	it('rejects unknown fx ids, bad spans, non-objects', () => {
		expect(normalizeFxWindow({ fx: 'nope', startMs: 0, endMs: 500 })).toBeNull();
		expect(normalizeFxWindow({ fx: 'flash', startMs: 500, endMs: 500 })).toBeNull();
		expect(normalizeFxWindow(null)).toBeNull();
		expect(normalizeFxWindow('flash')).toBeNull();
	});

	it('clamps intensity and end, floors start at 0', () => {
		const hot = normalizeFxWindow({ fx: 'flash', startMs: -50, endMs: 99999, intensity: 9 })!;
		expect(hot.intensity).toBe(1);
		expect(hot.startMs).toBe(0);
		expect(hot.endMs).toBe(MAX_FX_WINDOW_MS);
		const cold = normalizeFxWindow({ fx: 'flash', startMs: 0, endMs: 900, intensity: 0.001 })!;
		expect(cold.intensity).toBe(0.05);
	});

	it('defaults intensity', () => {
		const w = normalizeFxWindow({ fx: 'vignette', startMs: 0, endMs: 500 })!;
		expect(w.intensity).toBe(DEFAULT_FX_INTENSITY);
	});
});

describe('normalizeFxWindows', () => {
	it('caps at MAX_FX_WINDOWS', () => {
		const many = Array.from({ length: MAX_FX_WINDOWS + 10 }, (_, i) => ({
			fx: 'flash',
			startMs: i * 500,
			endMs: i * 500 + 400,
			intensity: 0.5
		}));
		expect(normalizeFxWindows(many)).toHaveLength(MAX_FX_WINDOWS);
	});

	it('sorts by start and drops overlaps', () => {
		const sorted = normalizeFxWindows([
			{ fx: 'flash', startMs: 2000, endMs: 2600, intensity: 0.5 },
			{ fx: 'glitch', startMs: 0, endMs: 500, intensity: 0.5 }
		]);
		expect(sorted.map((w) => w.fx)).toEqual(['glitch', 'flash']);
		// A window starting inside the previous one's span is dropped.
		const overlapped = normalizeFxWindows([
			{ fx: 'flash', startMs: 0, endMs: 1000, intensity: 0.5 },
			{ fx: 'shake', startMs: 400, endMs: 900, intensity: 0.5 }
		]);
		expect(overlapped).toHaveLength(1);
		expect(overlapped[0]!.fx).toBe('flash');
	});

	it('returns [] for non-arrays', () => {
		expect(normalizeFxWindows(undefined)).toEqual([]);
		expect(normalizeFxWindows('flash')).toEqual([]);
	});
});

describe('active/phase', () => {
	it('brackets like zoom windows (start inclusive, end exclusive)', () => {
		const w = win();
		expect(fxActiveAt(w, 999)).toBe(false);
		expect(fxActiveAt(w, 1000)).toBe(true);
		expect(fxActiveAt(w, 1999)).toBe(true);
		expect(fxActiveAt(w, 2000)).toBe(false);
	});

	it('phase ramps 0→1', () => {
		const w = win();
		expect(fxPhase(w, 1000)).toBe(0);
		expect(fxPhase(w, 1500)).toBeCloseTo(0.5);
		expect(fxPhase(w, 2000)).toBe(1);
	});
});

describe('shiftFxForExport', () => {
	it('remaps by trim + rate and drops outside windows', () => {
		const shifted = shiftFxForExport([win()], 1, 2, 10);
		expect(shifted[0]!.startMs).toBe(0);
		expect(shifted[0]!.endMs).toBe(500);
		const dropped = shiftFxForExport([win()], 3, 1, 10);
		expect(dropped).toHaveLength(0);
	});
});

describe('wire codec', () => {
	it('round-trips encode → decode', () => {
		const windows = normalizeFxWindows([
			{ fx: 'flash', startMs: 0, endMs: 300, intensity: 0.9 },
			{ fx: 'vignette', startMs: 1200, endMs: 2600 }
		])!;
		const wire = encodeFxWindows(windows);
		expect(decodeFxWindows(wire)).toEqual(windows);
	});

	it('drops unknown ids and non-array rows', () => {
		expect(decodeFxWindows([['nope', 0, 100], 'flash', null])).toEqual([]);
		expect(decodeFxWindows(null)).toEqual([]);
	});
});

describe('labels + ids', () => {
	it('labels every fx id', () => {
		for (const id of FRAME_FX_IDS) expect(FRAME_FX_LABELS[id]).toBeTruthy();
	});

	it('isFrameFxId narrows', () => {
		expect(isFrameFxId('flash')).toBe(true);
		expect(isFrameFxId('nope')).toBe(false);
		expect(isFrameFxId(7)).toBe(false);
	});
});

describe('paintFxFrame', () => {
	it('is a no-op with no windows / empty canvas', () => {
		const ctx = makeCtx();
		expect(() =>
			paintFxFrame(ctx as unknown as CanvasRenderingContext2D, [], 0, { width: 0, height: 0 })
		).not.toThrow();
	});

	it('runs every fx through the ctx without throwing', () => {
		const ctx = makeCtx();
		for (const [i, fx] of FRAME_FX_IDS.entries()) {
			const windows = normalizeFxWindows([{ fx, startMs: 0, endMs: 2000, intensity: 0.8 }])!;
			expect(() =>
				paintFxFrame(ctx as unknown as CanvasRenderingContext2D, windows, 500 + i, {
					width: 64,
					height: 64
				})
			).not.toThrow();
		}
	});
});

describe('fxPreviewStyle', () => {
	it('returns {} when nothing is active', () => {
		expect(fxPreviewStyle([win()], 0)).toEqual({});
		expect(fxPreviewStyle([], 500)).toEqual({});
	});

	it('mirrors flash as an overlay background', () => {
		const style = fxPreviewStyle(
			normalizeFxWindows([{ fx: 'flash', startMs: 0, endMs: 1000, intensity: 1 }])!,
			0
		);
		expect(style.overlayBackground).toBe('#ffffff');
		expect(style.overlayOpacity).toBeGreaterThan(0.8);
	});

	it('mirrors shake + zoom-blur as transforms', () => {
		const shake = fxPreviewStyle(
			normalizeFxWindows([{ fx: 'shake', startMs: 0, endMs: 1000 }])!,
			520
		);
		expect(shake.mediaTransform).toMatch(/translate\(/);
		const blur = fxPreviewStyle(
			normalizeFxWindows([{ fx: 'zoom-blur', startMs: 0, endMs: 1000 }])!,
			500
		);
		expect(blur.mediaTransform).toMatch(/scale\(/);
	});

	it('mirrors rgb-split as filters', () => {
		const style = fxPreviewStyle(
			normalizeFxWindows([{ fx: 'rgb-split', startMs: 0, endMs: 1000 }])!,
			500
		);
		expect(style.mediaFilter).toContain('drop-shadow');
	});
});

/** Minimal canvas-2d stand-in: records calls, hands out a scratch canvas for
 *  snapshot() (jsdom has no real canvas). */
function makeCtx() {
	const scratchCanvas = {
		width: 64,
		height: 64,
		getContext: () => ctx
	};
	const ctx = {
		canvas: scratchCanvas,
		save: () => {},
		restore: () => {},
		clearRect: () => {},
		fillRect: () => {},
		drawImage: () => {},
		createRadialGradient: () => ({ addColorStop: () => {} }),
		getContext: () => null,
		filter: 'none',
		globalAlpha: 1,
		globalCompositeOperation: 'source-over',
		fillStyle: '#000',
		imageSmoothingEnabled: true
	};
	return { ...ctx, canvas: undefined, getContext: undefined };
}
