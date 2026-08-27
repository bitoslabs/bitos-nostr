import { describe, expect, it } from 'vitest';

import {
	LAYER_MOTIONS,
	LAYER_MOTION_IDS,
	layerMotionCss,
	layerMotionOf,
	layerMotionTransform
} from './layer-motion';

describe('layer-motion', () => {
	it('ships the five-spec motion set with unique ids', () => {
		expect(LAYER_MOTION_IDS).toEqual(['bounce', 'wiggle', 'spin', 'pop', 'breathe']);
		const ids = new Set(LAYER_MOTIONS.map((m) => m.id));
		expect(ids.size).toBe(LAYER_MOTIONS.length);
		for (const m of LAYER_MOTIONS) {
			expect(m.periodSec).toBeGreaterThan(0);
			expect(m.label.length).toBeGreaterThan(0);
		}
	});

	it('layerMotionOf tolerates junk and normalizes case/whitespace', () => {
		expect(layerMotionOf('bounce')).toBe('bounce');
		expect(layerMotionOf(' SPIN ')).toBe('spin');
		expect(layerMotionOf('matrix-glitch')).toBe('none');
		expect(layerMotionOf(42)).toBe('none');
		expect(layerMotionOf(undefined)).toBe('none');
		expect(layerMotionOf('')).toBe('none');
	});

	it('static layers (none) produce no transform at any time', () => {
		expect(layerMotionTransform('none', 0)).toBeNull();
		expect(layerMotionTransform('none', 5500)).toBeNull();
		expect(layerMotionTransform('junk', 100)).toBeNull();
	});

	it('bounce arcs up and settles back (periodic, |sin| shape)', () => {
		const period = LAYER_MOTIONS.find((m) => m.id === 'bounce')!.periodSec * 1000;
		const atZero = layerMotionTransform('bounce', 0);
		const atQuarter = layerMotionTransform('bounce', period * 0.25);
		const atFull = layerMotionTransform('bounce', period);
		expect(atZero!.dyNorm).toBe(0); // phase 0 → resting
		expect(atQuarter!.dyNorm).toBeCloseTo(-0.06, 5); // peak hop
		expect(atFull!.dyNorm).toBeCloseTo(0, 5); // loops seamlessly
		expect(atQuarter!.dyNorm).toBeLessThan(0); // UP is negative y
	});

	it('wiggle rocks rotation symmetrically without moving', () => {
		const period = LAYER_MOTIONS.find((m) => m.id === 'wiggle')!.periodSec * 1000;
		const q = layerMotionTransform('wiggle', period * 0.25);
		const threeQ = layerMotionTransform('wiggle', period * 0.75);
		expect(q!.rotateDeg).toBeCloseTo(6, 5);
		expect(threeQ!.rotateDeg).toBeCloseTo(-6, 5);
		expect(q!.dxNorm).toBe(0);
		expect(q!.dyNorm).toBe(0);
	});

	it('spin completes exactly 360° per period (steady)', () => {
		const period = LAYER_MOTIONS.find((m) => m.id === 'spin')!.periodSec * 1000;
		expect(layerMotionTransform('spin', period * 0.5)!.rotateDeg).toBeCloseTo(180, 5);
		// Wraps: full period ≡ identity start.
		const full = layerMotionTransform('spin', period);
		expect((full!.rotateDeg ?? 0) % 360).toBeCloseTo(0, 5);
	});

	it('pop pulses scale up to 1.14 and rests on the back half', () => {
		const period = LAYER_MOTIONS.find((m) => m.id === 'pop')!.periodSec * 1000;
		expect(layerMotionTransform('pop', 0)!.scale).toBeCloseTo(1, 5);
		expect(layerMotionTransform('pop', period * 0.25)!.scale).toBeCloseTo(1.14, 5);
		expect(layerMotionTransform('pop', period * 0.75)!.scale).toBeCloseTo(1, 5);
	});

	it('breathe waves gently and never exceeds ±6% scale', () => {
		const period = LAYER_MOTIONS.find((m) => m.id === 'breathe')!.periodSec * 1000;
		const peak = layerMotionTransform('breathe', period * 0.25)!.scale;
		const trough = layerMotionTransform('breathe', period * 0.75)!.scale;
		expect(peak).toBeCloseTo(1.06, 5);
		expect(trough).toBeCloseTo(0.94, 5);
	});

	it('startMs phases the motion so visible entry never pops', () => {
		// 500ms into a layer's life = phase of a fresh loop shifted by start.
		const a = layerMotionTransform('bounce', 1500, 1000);
		const b = layerMotionTransform('bounce', 500, 0);
		expect(a!.dyNorm).toBeCloseTo(b!.dyNorm, 5);
		// before the layer exists (atMs<startMs) clamps to phase 0.
		const early = layerMotionTransform('bounce', 500, 1000);
		expect(early!.dyNorm).toBe(0);
	});

	it('layerMotionCss mirrors the canvas numbers as a transform string', () => {
		const period = LAYER_MOTIONS.find((m) => m.id === 'bounce')!.periodSec * 1000;
		const css = layerMotionCss('bounce', period * 0.25);
		expect(css).toContain('translate(0%, -6%)');
		expect(layerMotionCss('none', 0)).toBeNull();
		expect(layerMotionCss('spin', 0)).toBeNull(); // rotate 0 → identity → null
	});
});
