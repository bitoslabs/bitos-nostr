import { describe, expect, it } from 'vitest';
import { parseSvgSize, rasterSize, SVG_MAX_EDGE, SVG_MIN_EDGE } from './svg-layer';

describe('parseSvgSize', () => {
	it('reads explicit pixel width/height', () => {
		const s = parseSvgSize('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">…');
		expect(s.w).toBe(640);
		expect(s.h).toBe(480);
	});

	it('falls back to viewBox when w/h are missing', () => {
		const s = parseSvgSize('<svg viewBox="0 0 24 24" fill="none">…');
		expect(s.w).toBeNull();
		expect(s.h).toBeNull();
		expect(s.vbW).toBe(24);
		expect(s.vbH).toBe(24);
	});

	it('accepts viewBox with commas and decimals', () => {
		const s = parseSvgSize("<svg viewBox='0,0, 512.5, 512.5'>");
		expect(s.vbW).toBe(512.5);
		expect(s.vbH).toBe(512.5);
	});

	it('ignores percent dimensions', () => {
		const s = parseSvgSize('<svg width="100%" height="100%">');
		expect(s.w).toBeNull();
		expect(s.h).toBeNull();
	});

	it('ignores junk viewBox', () => {
		const s = parseSvgSize('<svg viewBox="jumped the fence">');
		expect(s.vbW).toBeNull();
		expect(s.vbH).toBeNull();
	});

	it('single-quoted attributes parse too', () => {
		const s = parseSvgSize("<svg width='300' height='200'>");
		expect(s.w).toBe(300);
		expect(s.h).toBe(200);
	});
});

describe('rasterSize', () => {
	it('derives from viewBox even without w/h', () => {
		expect(rasterSize({ w: null, h: null, vbW: 24, vbH: 24 })).toEqual({ w: 64, h: 64 });
	});

	it('caps the long edge', () => {
		const out = rasterSize({ w: 4000, h: 2000, vbW: null, vbH: null });
		expect(Math.max(out!.w, out!.h)).toBeLessThanOrEqual(SVG_MAX_EDGE);
		expect(out!.w / out!.h).toBeCloseTo(2, 1);
	});

	it('preserves aspect ratio when downscaling', () => {
		const out = rasterSize({ w: null, h: null, vbW: 5000, vbH: 1000 });
		expect(out!.w / out!.h).toBeCloseTo(5, 1);
	});

	it('returns null when no usable size exists', () => {
		expect(rasterSize({ w: null, h: null, vbW: null, vbH: null })).toBeNull();
	});

	it('never rasterizes below the floor or above the cap', () => {
		const tiny = rasterSize({ w: 8, h: 8, vbW: null, vbH: null })!;
		expect(Math.min(tiny.w, tiny.h)).toBeGreaterThanOrEqual(SVG_MIN_EDGE);
		const huge = rasterSize({ w: 5000, h: 5000, vbW: null, vbH: null })!;
		expect(Math.max(huge.w, huge.h)).toBeLessThanOrEqual(SVG_MAX_EDGE);
	});
});
