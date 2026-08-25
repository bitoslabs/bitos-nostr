import { describe, expect, it } from 'vitest';
import {
	composeZoomWithFraming,
	normalizeZoomWindow,
	normalizeZoomWindows,
	shiftZoomsForExport,
	zoomActiveAt,
	zoomFrameCss,
	zoomTransformAt
} from './zoom-track';

describe('normalizeZoomWindow', () => {
	it('accepts a well-formed window and rounds ms', () => {
		expect(normalizeZoomWindow({ startMs: 100.6, endMs: 900.4, factor: 1.6, cx: 0.4, cy: 0.3 }))
			.toEqual({ startMs: 101, endMs: 900, factor: 1.6, cx: 0.4, cy: 0.3 });
	});

	it('drops malformed rows (never throws)', () => {
		expect(normalizeZoomWindow(null)).toBeNull();
		expect(normalizeZoomWindow('zoom')).toBeNull();
		expect(normalizeZoomWindow({ startMs: 500, endMs: 400, factor: 2 })).toBeNull();
		expect(normalizeZoomWindow({ startMs: 0, endMs: 500, factor: 1 })).toBeNull();
		expect(normalizeZoomWindow({ startMs: NaN, endMs: 500, factor: 2 })).toBeNull();
	});

	it('clamps pan anchors and caps the window length', () => {
		const win = normalizeZoomWindow({
			startMs: 0,
			endMs: 99999,
			factor: 9,
			cx: 5,
			cy: -5
		});
		expect(win?.factor).toBe(4);
		expect(win?.cx).toBe(1);
		expect(win?.cy).toBe(0);
		expect(win?.endMs).toBeLessThanOrEqual(4000);
	});
});

describe('normalizeZoomWindows', () => {
	it('caps, sorts and tolerates junk mixed in', () => {
		const rows = normalizeZoomWindows([
			{ startMs: 2000, endMs: 2600, factor: 2.5, cx: 0.5, cy: 0.5 },
			'junk',
			{ startMs: 500, endMs: 1200, factor: 1.6, cx: 0.5, cy: 0.5 },
			null
		]);
		expect(rows.map((r) => r.startMs)).toEqual([500, 2000]);
	});

	it('slices to the cap', () => {
		const many = Array.from({ length: 30 }, (_, i) => ({
			startMs: i * 500,
			endMs: i * 500 + 300,
			factor: 1.5,
			cx: 0.5,
			cy: 0.5
		}));
		expect(normalizeZoomWindows(many)).toHaveLength(16);
	});
});

describe('zoomActiveAt / zoomTransformAt', () => {
	const zooms = [
		{ startMs: 1000, endMs: 2000, factor: 2.5, cx: 0.7, cy: 0.3 }
	];

	it('start-inclusive, end-exclusive', () => {
		expect(zoomActiveAt(zooms[0]!, 999)).toBe(false);
		expect(zoomActiveAt(zooms[0]!, 1000)).toBe(true);
		expect(zoomActiveAt(zooms[0]!, 1999)).toBe(true);
		expect(zoomActiveAt(zooms[0]!, 2000)).toBe(false);
	});

	it('eases from identity at the window start to the full factor', () => {
		expect(zoomTransformAt(zooms, 1000)?.scale).toBeCloseTo(1, 5);

		// The ease spans 140ms — sample at 1050ms for a mid-flight value.
		const mid = zoomTransformAt(zooms, 1050);
		expect(mid!.scale).toBeGreaterThan(1);
		expect(mid!.scale).toBeLessThan(2.5);
		const outside = zoomTransformAt(zooms, 4000);
		expect(outside).toBeUndefined();
		const peak = zoomTransformAt(zooms, 1999);
		expect(peak!.scale).toBeCloseTo(2.5, 1);
		// Pan aims at the face anchor in the eased direction.
		expect(peak!.x).toBeGreaterThan(0);
		expect(peak!.y).toBeLessThan(0);
	});

	it('returns undefined outside every window', () => {
		expect(zoomTransformAt(zooms, 0)).toBeUndefined();
		expect(zoomTransformAt(zooms, 5000)).toBeUndefined();
	});
});

describe('zoomFrameCss', () => {
	it('mirrors coverRect percentages for a square-in-square fit', () => {
		const frame = zoomFrameCss(1080, 1080, 540, 540, { scale: 2, x: 0, y: 0 });
		expect(frame).toEqual({ left: '-50.000', top: '-50.000', width: '200.000', height: '200.000' });
	});

	it('returns null for a degraded canvas', () => {
		expect(zoomFrameCss(100, 100, 0, 0)).toBeNull();
	});
});

describe('composeZoomWithFraming', () => {
	it('multiples scales and sums pans, clamped', () => {
		expect(composeZoomWithFraming({ scale: 1.5, x: 0.2, y: -0.2 }, { scale: 2, x: 0.6, y: -0.6 }))
			.toEqual({ scale: 3, x: 0.8, y: -0.8 });
		expect(composeZoomWithFraming({ scale: 3.5, x: 0, y: 0 }, { scale: 2, x: 0, y: 0 }).scale).toBe(4);
	});

	it('passes the framing through when no zoom is active', () => {
		expect(composeZoomWithFraming({ scale: 1.25, x: 0.1, y: 0 }, undefined)).toEqual({
			scale: 1.25,
			x: 0.1,
			y: 0
		});
	});
});

describe('shiftZoomsForExport', () => {
	const zooms = [
		{ startMs: 2000, endMs: 3000, factor: 2, cx: 0.5, cy: 0.5 },
		{ startMs: 9000, endMs: 9500, factor: 1.6, cx: 0.5, cy: 0.5 }
	];

	it('remaps media time onto the trimmed + sped export timeline', () => {
		const shifted = shiftZoomsForExport(zooms, 1, 2, 10);
		expect(shifted).toEqual([
			{ startMs: 500, endMs: 1000, factor: 2, cx: 0.5, cy: 0.5 },
			{ startMs: 4000, endMs: 4250, factor: 1.6, cx: 0.5, cy: 0.5 }
		]);
	});

	it('drops windows outside the export window', () => {
		expect(shiftZoomsForExport(zooms, 0, 1, 5)).toHaveLength(1);
	});
});
