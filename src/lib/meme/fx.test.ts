import { describe, expect, it } from 'vitest';
import { fxTransformAt, FX_ENTRY_MS, FX_LOOP_MS, normalizeMemeFx, type MemeFx } from './fx';

const at = (fx: MemeFx, tMs: number | undefined, startMs?: number) =>
	fxTransformAt({ fx, startMs }, tMs);

describe('normalizeMemeFx', () => {
	it('keeps known ids', () => {
		for (const id of ['none', 'pop', 'fade', 'shake', 'spin'] as const) {
			expect(normalizeMemeFx(id)).toBe(id);
		}
	});
	it('unknown/missing → none', () => {
		expect(normalizeMemeFx(undefined)).toBe('none');
		expect(normalizeMemeFx('zoom')).toBe('none');
		expect(normalizeMemeFx(42)).toBe('none');
	});
});

describe('fxTransformAt', () => {
	it('none and timeless paints are identity', () => {
		expect(at('none', 100)).toEqual({ scale: 1, rotate: 0, dx: 0, dy: 0, alpha: 1 });
		expect(at('spin', undefined)).toEqual({ scale: 1, rotate: 0, dx: 0, dy: 0, alpha: 1 });
	});

	it('pop springs past 1 then settles', () => {
		const early = at('pop', 50).scale;
		const mid = at('pop', FX_ENTRY_MS / 2).scale;
		const done = at('pop', FX_ENTRY_MS).scale;
		expect(early).toBeGreaterThan(0);
		expect(early).toBeLessThan(1);
		expect(mid).toBeGreaterThan(1); // overshoot
		expect(done).toBe(1);
	});

	it('fade ramps alpha to 1 by FX_ENTRY_MS', () => {
		expect(at('fade', 0).alpha).toBe(0);
		expect(at('fade', FX_ENTRY_MS / 2).alpha).toBeCloseTo(0.5);
		expect(at('fade', FX_ENTRY_MS).alpha).toBe(1);
	});

	it('shake jitters but stays tiny and loops', () => {
		const a = at('shake', 0);
		const b = at('shake', FX_LOOP_MS / 4);
		expect(Math.abs(a.dx)).toBeLessThanOrEqual(0.0081);
		expect(Math.abs(b.dx)).toBeLessThanOrEqual(0.0081);
		expect(at('shake', FX_LOOP_MS)).toEqual(at('shake', 0)); // loops
	});

	it('spin completes a full turn per loop period', () => {
		const quarter = at('spin', FX_LOOP_MS / 4).rotate;
		expect(quarter).toBeCloseTo(Math.PI / 2);
		expect(at('spin', FX_LOOP_MS).rotate).toBeCloseTo(0, 5);
	});

	it('entrance waits for the overlay window (startMs)', () => {
		// fade scheduled at 500ms: before it → alpha clamped to the t=0 state.
		expect(at('fade', 400, 500).alpha).toBe(0);
		expect(at('fade', 500 + FX_ENTRY_MS / 2, 500).alpha).toBeCloseTo(0.5);
	});
});
