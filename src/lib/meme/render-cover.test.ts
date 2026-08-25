import { describe, expect, it } from 'vitest';
import { coverRect } from './render';

describe('coverRect (crop & zoom framing math)', () => {
	it('cover-fits by the longer axis and centers', () => {
		// 2:1 source into a square box → height fills, width overflows centered.
		const r = coverRect(200, 100, 100, 100);
		expect(r.h).toBeCloseTo(100);
		expect(r.w).toBeCloseTo(200);
		expect(r.x).toBeCloseTo(-50); // centered overflow
		expect(r.y).toBeCloseTo(0);
	});

	it('identity framing matches the classic cover fit', () => {
		const base = coverRect(1920, 1080, 1080, 1080);
		const withDefault = coverRect(1920, 1080, 1080, 1080, { scale: 1, x: 0, y: 0 });
		expect(withDefault).toEqual(base);
		expect(base.w).toBeCloseTo(1920);
	});

	it('zoom magnifies around the center', () => {
		const r = coverRect(100, 100, 100, 100, { scale: 2, x: 0, y: 0 });
		expect(r.w).toBeCloseTo(200);
		expect(r.x).toBeCloseTo(-50);
		expect(r.y).toBeCloseTo(-50);
	});

	it('pan travels the overflow and clamps at the edges', () => {
		// 200% zoom → 50px overflow per side at this size; full pan uses it all.
		const full = coverRect(100, 100, 100, 100, { scale: 2, x: 1, y: -1 });
		expect(full.x).toBeCloseTo(0); // right edge
		expect(full.y).toBeCloseTo(-100); // top edge
		// Over-driven values clamp to the same extremes.
		const over = coverRect(100, 100, 100, 100, { scale: 2, x: 5, y: -9 });
		expect(over).toEqual(full);
	});

	it('pan is inert on axes with no overflow (zoom 1)', () => {
		const r = coverRect(200, 100, 100, 100, { scale: 1, x: 1, y: 1 });
		// Height fills exactly → no vertical overflow to travel.
		expect(r.y).toBeCloseTo(0);
		expect(r.h).toBeCloseTo(100);
		// Width overflow exists even at zoom 1 → full pan reaches the edge.
		expect(r.x).toBeCloseTo(0);
		expect(r.w).toBeCloseTo(200);
	});

	it('clamps zoom to 1–4', () => {
		const tiny = coverRect(100, 100, 100, 100, { scale: 0.1, x: 0, y: 0 });
		expect(tiny.w).toBeCloseTo(100);
		const huge = coverRect(100, 100, 100, 100, { scale: 99, x: 0, y: 0 });
		expect(huge.w).toBeCloseTo(400);
	});
});
