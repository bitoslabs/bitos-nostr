import { describe, expect, it } from 'vitest';
import {
	applyBeatPlan,
	captionBeatPlan,
	syncOverlayToCue,
	syncOverlaysToCues,
	CAPTION_TAIL_MS
} from './caption-sync';
import { normalizeSfxCue, makeOverlay } from './schema';

const cue = (sfx: string, atMs: number) => normalizeSfxCue({ sfx, atMs, gain: 1 })!;

describe('syncOverlayToCue', () => {
	it('starts at the cue and ends 30ms before the next cue', () => {
		const cues = [cue('boom', 2000), cue('ding', 5000)];
		const snapped = syncOverlayToCue(makeOverlay({ text: 'BOOM' }), cues);
		expect(snapped.startMs).toBe(2000);
		expect(snapped.endMs).toBe(4970);
	});

	it('holds the last cue for the tail default', () => {
		const snapped = syncOverlayToCue(makeOverlay({ text: 'LAST' }), [cue('ding', 9000)]);
		expect(snapped.endMs).toBe(9000 + CAPTION_TAIL_MS);
	});

	it('honors a custom tail', () => {
		const snapped = syncOverlayToCue(makeOverlay({}), [cue('pop', 100)], { tailMs: 500 });
		expect(snapped.endMs!).toBe(600);
	});

	it('returns the overlay untouched with no cues', () => {
		const overlay = makeOverlay({ text: 'STAY' });
		expect(syncOverlayToCue(overlay, [])).toBe(overlay);
	});

	it('never produces an empty window (min 120ms)', () => {
		const cues = [cue('boom', 1000), cue('pop', 1050)];
		const snapped = syncOverlayToCue(makeOverlay({}), cues);
		expect(snapped.endMs! - snapped.startMs!).toBeGreaterThanOrEqual(120);
	});
});

describe('syncOverlaysToCues', () => {
	it('maps overlays onto cues in order; extras keep their windows', () => {
		const cues = [cue('boom', 1000), cue('ding', 3000)];
		const a = makeOverlay({ text: 'A' });
		const b = makeOverlay({ text: 'B' });
		const untouched = makeOverlay({ text: 'EXTRA', startMs: 9, endMs: 99 });
		const out = syncOverlaysToCues([a, b, untouched], cues);
		expect(out[0]!.startMs).toBe(1000);
		expect(out[1]!.startMs).toBe(3000);
		expect(out[2]).toBe(untouched);
	});

	it('is a no-op with no cues', () => {
		const overlays = [makeOverlay({ text: 'X' })];
		expect(syncOverlaysToCues(overlays, [])).toBe(overlays);
	});
});

describe('captionBeatPlan', () => {
	it('builds half-open windows ending 30ms before the next cue', () => {
		const plan = captionBeatPlan([cue('boom', 1000), cue('ding', 4000), cue('pop', 8000)]);
		expect(plan.map((b) => b.startMs)).toEqual([1000, 4000, 8000]);
		expect(plan[0]!.endMs).toBe(3970);
		expect(plan[1]!.endMs).toBe(7970);
		expect(plan[2]!.endMs).toBe(8000 + CAPTION_TAIL_MS);
	});

	it('sorts unsorted cues', () => {
		const plan = captionBeatPlan([cue('ding', 5000), cue('boom', 1000)]);
		expect(plan[0]!.atMs).toBe(1000);
	});

	it('returns [] for no cues', () => {
		expect(captionBeatPlan([])).toEqual([]);
	});
});

describe('applyBeatPlan', () => {
	it('writes windows onto overlays by index and leaves extras', () => {
		const plan = captionBeatPlan([cue('boom', 1000), cue('ding', 4000)]);
		const a = makeOverlay({ text: 'FIRST' });
		const b = makeOverlay({ text: 'SECOND' });
		const c = makeOverlay({ text: 'NO CUE' });
		const out = applyBeatPlan([a, b, c], plan);
		expect(out[0]!.startMs).toBe(1000);
		expect(out[0]!.endMs).toBe(3970);
		expect(out[1]!.startMs).toBe(4000);
		expect(out[2]!.startMs).toBeUndefined();
	});
});
