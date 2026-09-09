import { describe, expect, it } from 'vitest';
import {
	MEME_SFX_IDS,
	normalizeSfxCue,
	normalizeSfxCues,
	sfxCuesInWindow,
	type MemeSfxCue
} from './schema';
import {
	SFX_RECIPES,
	scheduleSfx,
	scheduleGainSum,
	attachCustomPcm,
	monoNormalize,
	notesWithinLimit,
	sfxCueLimitSec,
	SFX_MASTER_GAIN
} from './sfx';

describe('sfx cue schema', () => {
	it('normalizes a valid cue', () => {
		const cue = normalizeSfxCue({ sfx: 'boom', atMs: 1500, gain: 0.7 });
		expect(cue).toMatchObject({ sfx: 'boom', atMs: 1500, gain: 0.7 });
		expect(cue?.id).toBeTruthy();
	});

	it('rejects unknown sfx ids and non-object input', () => {
		expect(normalizeSfxCue({ sfx: 'not-a-sfx', atMs: 0 })).toBeNull();
		expect(normalizeSfxCue(null)).toBeNull();
		expect(normalizeSfxCue('boom')).toBeNull();
	});

	it('clamps gain into 0..1 and coerces atMs to a non-negative integer', () => {
		expect(normalizeSfxCue({ sfx: 'pop', atMs: -50, gain: 2 })?.gain).toBe(1);
		expect(normalizeSfxCue({ sfx: 'pop', atMs: -50 })?.atMs).toBe(0);
		expect(normalizeSfxCue({ sfx: 'pop', atMs: 2500.7 })?.atMs).toBe(2501);
	});

	it('caps the cue list at 16 and drops invalid rows', () => {
		const many = Array.from({ length: 30 }, (_, i) => ({ sfx: 'ding', atMs: i * 100 }));
		expect(normalizeSfxCues(many)).toHaveLength(16);
		expect(normalizeSfxCues([{ sfx: 'nope' }, { sfx: 'ding', atMs: 10 }])).toHaveLength(1);
		expect(normalizeSfxCues('nope')).toEqual([]);
	});

	it('rounds a positive play-length cut and drops junk / zero ones', () => {
		expect(normalizeSfxCue({ sfx: 'boom', atMs: 0, gain: 1, durationMs: 1234.6 })?.durationMs).toBe(
			1235
		);
		expect(normalizeSfxCue({ sfx: 'boom', atMs: 0, gain: 1, durationMs: 0 })?.durationMs).toBeUndefined();
		expect(
			normalizeSfxCue({ sfx: 'boom', atMs: 0, gain: 1, durationMs: -200 })?.durationMs
		).toBeUndefined();
		expect(
			normalizeSfxCue({ sfx: 'boom', atMs: 0, gain: 1, durationMs: 'nope' })?.durationMs
		).toBeUndefined();
		expect(normalizeSfxCue({ sfx: 'boom', atMs: 0, gain: 1 })?.durationMs).toBeUndefined();
	});

	it('windows cues to the render duration', () => {
		const cues: MemeSfxCue[] = [
			{ id: 'a', sfx: 'boom', atMs: 500, gain: 1 },
			{ id: 'b', sfx: 'ding', atMs: 2500, gain: 1 },
			{ id: 'c', sfx: 'pop', atMs: 900, gain: 1 }
		];
		const inWindow = sfxCuesInWindow(cues, 2000);
		expect(inWindow.map((c) => c.id)).toEqual(['a', 'c']);
	});

	it('rejects non-positive durations', () => {
		const cues: MemeSfxCue[] = [{ id: 'a', sfx: 'boom', atMs: 100, gain: 1 }];
		expect(sfxCuesInWindow(cues, 0)).toEqual([]);
		expect(sfxCuesInWindow(cues, Number.NaN)).toEqual([]);
	});
});

describe('sfx recipes', () => {
	it('defines a recipe for every advertised sfx id', () => {
		for (const id of MEME_SFX_IDS) {
			expect(SFX_RECIPES[id], id).toBeDefined();
			expect(SFX_RECIPES[id].notes.length).toBeGreaterThan(0);
			expect(SFX_RECIPES[id].duration).toBeGreaterThan(0);
			expect(SFX_RECIPES[id].level).toBeGreaterThan(0);
		}
	});

	it('keeps every note inside its recipe duration envelope', () => {
		for (const recipe of Object.values(SFX_RECIPES)) {
			for (const note of recipe.notes) {
				expect(note.t, recipe.id).toBeGreaterThanOrEqual(0);
				expect(note.d, recipe.id).toBeGreaterThan(0);
				expect(note.t + note.d, recipe.id).toBeLessThanOrEqual(recipe.duration + 0.001);
			}
		}
	});

	it('uses only valid oscillator waveforms', () => {
		const waveforms = new Set(['sine', 'square', 'sawtooth', 'triangle']);
		for (const recipe of Object.values(SFX_RECIPES)) {
			for (const note of recipe.notes) {
				expect(waveforms.has(note.type)).toBe(true);
			}
		}
	});
});

describe('scheduleSfx', () => {
	const cues: MemeSfxCue[] = [
		{ id: 'late', sfx: 'ding', atMs: 9000, gain: 1 },
		{ id: 'mid', sfx: 'boom', atMs: 2000, gain: 1 },
		{ id: 'early', sfx: 'pop', atMs: 500, gain: 0.5 }
	];

	it('schedules in-time cues sorted by start, dropping out-of-window ones', () => {
		const schedule = scheduleSfx(cues, 4000);
		expect(schedule.map((s) => s.cue.id)).toEqual(['early', 'mid']);
		expect(schedule[0]!.startSec).toBe(0.5);
		expect(schedule[1]!.recipe!.id).toBe('boom');
	});

	it('sums cue loudness for the mix headroom check', () => {
		const schedule = scheduleSfx(cues, 4000);
		expect(scheduleGainSum(schedule)).toBeCloseTo(0.8 * 0.5 + 0.9 * 1, 5);
	});

	it('returns an empty schedule for an empty cue list', () => {
		expect(scheduleSfx([], 4000)).toEqual([]);
	});
});

describe('SFX_MASTER_GAIN sanity', () => {
	it('leaves headroom below unity', () => {
		expect(SFX_MASTER_GAIN).toBeLessThanOrEqual(0.5);
	});
});

describe('cue play-length cut (trim)', () => {
	it('treats a missing or non-positive cut as the natural length', () => {
		expect(sfxCueLimitSec({})).toBe(Infinity);
		expect(sfxCueLimitSec({ durationMs: 0 })).toBe(Infinity);
		expect(sfxCueLimitSec({ durationMs: -5 })).toBe(Infinity);
		expect(sfxCueLimitSec({ durationMs: 1500 })).toBe(1.5);
	});

	it('drops notes past the cut and shortens straddlers', () => {
		const notes = [
			{ type: 'sine' as const, t: 0, d: 0.4, f: 200, g: 1 },
			{ type: 'sine' as const, t: 0.3, d: 0.5, f: 180, g: 0.8 },
			{ type: 'sine' as const, t: 0.9, d: 0.2, f: 90, g: 0.5 }
		];
		const cut = notesWithinLimit(notes, 0.5);
		expect(cut).toHaveLength(2);
		expect(cut[0]).toEqual(notes[0]);
		expect(cut[1]).toEqual({ ...notes[1], d: 0.2 }); // 0.5 − 0.3
	});

	it('passes notes through untouched without a finite limit', () => {
		const notes = SFX_RECIPES.boom.notes;
		expect(notesWithinLimit(notes, Infinity)).toBe(notes);
	});

	it('every recipe survives a full-length cut', () => {
		for (const recipe of Object.values(SFX_RECIPES)) {
			// +ε mirrors the envelope tolerance: t+d may sit exactly on duration.
			expect(notesWithinLimit(recipe.notes, recipe.duration + 0.001), recipe.id).toEqual(
				recipe.notes
			);
		}
	});
});

describe('custom sound cues', () => {
	it('normalizes a valid custom cue carrying a soundId', () => {
		const cue = normalizeSfxCue({ sfx: 'custom', soundId: 'snd-1', atMs: 1200, gain: 0.6 });
		expect(cue).toMatchObject({ sfx: 'custom', soundId: 'snd-1', atMs: 1200, gain: 0.6 });
	});

	it('drops custom cues without a soundId', () => {
		expect(normalizeSfxCue({ sfx: 'custom', atMs: 0, gain: 1 })).toBeNull();
		expect(normalizeSfxCue({ sfx: 'custom', soundId: '   ', atMs: 0, gain: 1 })).toBeNull();
	});

	it('schedules custom cues without a recipe and attaches PCM per soundId', () => {
		const cues: MemeSfxCue[] = [
			{ id: 'c1', sfx: 'custom', soundId: 'snd-a', atMs: 1000, gain: 1 },
			{ id: 'c2', sfx: 'custom', soundId: 'missing', atMs: 1500, gain: 1 },
			{ id: 'c3', sfx: 'boom', atMs: 2000, gain: 1 }
		];
		const schedule = scheduleSfx(cues, 4000);
		expect(schedule.map((s) => s.cue.id)).toEqual(['c1', 'c2', 'c3']);
		expect(schedule[0].recipe).toBeUndefined();
		expect(schedule[2].recipe?.id).toBe('boom');

		const pcm = new Float32Array(44100);
		pcm[0] = 0.5;
		const used = attachCustomPcm(schedule, new Map([['snd-a', { pcm, sampleRate: 44100 }]]));
		expect([...used].sort()).toEqual(['snd-a']);
		expect(schedule[0].pcm).toBe(pcm);
		expect(schedule[1].pcm).toBeUndefined();
	});

	it('counts custom sounds at full level in gain sums', () => {
		const schedule = scheduleSfx(
			[
				{ id: 'c', sfx: 'custom', soundId: 'x', atMs: 0, gain: 0.5 },
				{ id: 'b', sfx: 'pop', atMs: 100, gain: 1 }
			],
			2000
		);
		expect(scheduleGainSum(schedule)).toBeCloseTo(0.5 + 0.8, 5);
	});

	it('mono-normalizes multi-channel buffers with peak scaling', () => {
		// A fake AudioBuffer: two channels, hard L/R opposite content.
		const left = new Float32Array([0, 0.5, 0.5, 0]);
		const right = new Float32Array([0, -1, -1, 0]);
		const buffer = {
			length: 4,
			sampleRate: 44100,
			numberOfChannels: 2,
			getChannelData: (ch: number) => (ch === 0 ? left : right)
		} as unknown as AudioBuffer;
		const { pcm, sampleRate } = monoNormalize(buffer);
		expect(sampleRate).toBe(44100);
		// Mono sum: [0, -0.25, -0.25, 0]; peak ≤ 1 so no scaling applied.
		expect(Array.from(pcm)).toEqual([0, -0.25, -0.25, 0]);
	});
});
