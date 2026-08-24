import { describe, expect, it } from 'vitest';
import { planGifExport, type FrameTiming } from './gif-export';

function frames(...holdsMs: number[]): FrameTiming[] {
	let t = 0;
	return holdsMs.map((ms) => {
		const f = { timestamp: t, duration: ms / 1000 };
		t += ms / 1000;
		return f;
	});
}

describe('planGifExport', () => {
	it('gives an animated LAYER the loop when the base is static and the meme is silent (regression: frozen single-frame export)', () => {
		// The reported bug: GIF picked as the 2nd artboard item (a layer) over a
		// still base, no sound cues — the export derived durationSec=0 and
		// encoded ONE frame, freezing the layer. The layer must drive the loop.
		const plan = planGifExport(undefined, [frames(100, 100, 100)], 0, null);
		expect(plan.steps.map((s) => s.atSec).map((t) => Math.round(t * 1000))).toEqual([0, 100, 200]);
		expect(plan.steps.map((s) => s.delayMs)).toEqual([100, 100, 100]);
		expect(plan.durationSec).toBeCloseTo(0.3, 6);
		expect(plan.capped).toBe(false);
	});

	it('picks the LONGEST layer when several are animated', () => {
		const plan = planGifExport(undefined, [frames(50, 50), frames(200, 200)], 0, null);
		expect(plan.steps.map((s) => s.delayMs)).toEqual([200, 200]);
	});

	it('tiles the lead layer when the cue track runs longer', () => {
		const plan = planGifExport(undefined, [frames(100, 100, 100)], 0.45, null);
		expect(plan.steps.map((s) => s.atSec).map((t) => Math.round(t * 1000))).toEqual([
			0, 100, 200, 300, 400
		]);
		expect(plan.durationSec).toBeCloseTo(0.45, 6);
	});

	it('keeps the BASE gif’s original variable frame timing (regression: fixed 12fps resample)', () => {
		const plan = planGifExport(frames(30, 120, 50), [], 0, null);
		expect(plan.steps.map((s) => s.atSec).map((t) => Math.round(t * 1000))).toEqual([0, 30, 150]);
		expect(plan.steps.map((s) => s.delayMs)).toEqual([30, 120, 50]);
	});

	it('extends the loop when a layer outlasts the base gif', () => {
		const plan = planGifExport(frames(100), [frames(100, 100)], 0, null);
		expect(plan.durationSec).toBeCloseTo(0.2, 6);
		expect(plan.steps).toHaveLength(2);
	});

	it('a pinned length only TRIMS — a longer pick never extends the material', () => {
		expect(planGifExport(frames(100, 100), [], 0, 1).durationSec).toBeCloseTo(0.2, 6);
		const trimmed = planGifExport(frames(100, 100, 100), [], 0, 0.15);
		expect(trimmed.durationSec).toBeCloseTo(0.15, 6);
		expect(trimmed.steps.map((s) => s.delayMs)).toEqual([100, 50]);
	});

	it('a silent static composition still exports a single frame', () => {
		const plan = planGifExport(undefined, [], 0, null);
		expect(plan.steps).toHaveLength(1);
		expect(plan.durationSec).toBeCloseTo(0.1, 6);
	});

	it('falls back to uniform 12fps when only cues move the timeline', () => {
		const plan = planGifExport(undefined, [], 0.25, null);
		expect(plan.steps.map((s) => s.atSec).map((t) => Math.round(t * 1000))).toEqual([0, 83, 167]);
		// The final step stretches to the composition end so the loop is exact
		// (to the millisecond — the encoder quantizes to centiseconds anyway).
		expect(plan.steps.map((s) => s.delayMs)).toEqual([83, 83, 83]);
		expect(plan.durationSec).toBeCloseTo(0.25, 2);
	});

	it('collapses boundaries closer than the 20ms centisecond floor', () => {
		const plan = planGifExport(frames(10, 10, 10, 80), [], 0, null);
		expect(plan.steps.map((s) => s.atSec).map((t) => Math.round(t * 1000))).toEqual([0, 20]);
		// The collapsed frames' time folds into the previous hold.
		expect(plan.steps.map((s) => s.delayMs)).toEqual([20, 90]);
		expect(plan.durationSec).toBeCloseTo(0.11, 6);
	});

	it('caps at 360 frames and reports it', () => {
		const dense = frames(...new Array(400).fill(20));
		const plan = planGifExport(dense, [], 0, null);
		expect(plan.capped).toBe(true);
		expect(plan.steps).toHaveLength(360);
	});
});
