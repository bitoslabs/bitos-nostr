import { describe, expect, it } from 'vitest';

import { MEME_SFX_IDS, type MemeSfxCue, type MemeSfxId } from '$lib/meme/schema';

import {
	entryForCue,
	filterEntries,
	groupEntries,
	retimeCue,
	setCueAt,
	sortCues,
	synthEntries,
	SFX_BUCKETS,
	SFX_DURATIONS,
	SFX_LABELS,
	type SoundEntry
} from '$lib/meme/sound-catalog';
import { SFX_RECIPES } from '$lib/meme/sfx';

const labels = Object.fromEntries(MEME_SFX_IDS.map((id, i) => [id, `Sound ${i}`])) as Record<
	MemeSfxId,
	string
>;
const durations = Object.fromEntries(MEME_SFX_IDS.map((id) => [id, 1])) as Record<
	MemeSfxId,
	number
>;
labels.boom = 'Boom';
durations.boom = 0.8;
labels.bruh = 'Bruh';
durations.bruh = 1.2;

function cue(partial: Partial<MemeSfxCue>): MemeSfxCue {
	return { id: 'c1', sfx: 'boom', atMs: 1000, gain: 1, ...partial };
}

describe('sound catalog', () => {
	it('builds the synth group from recipe ids', () => {
		const entries = synthEntries(labels, durations);
		expect(entries.length).toBe(31); // MEME_SFX_IDS
		expect(entries[0]).toMatchObject({ id: 'synth:boom', label: 'Boom', durationSec: 0.8 });
	});

	it('resolves synth cues back to entries', () => {
		const entry = entryForCue(
			cue({}),
			labels,
			durations,
			() => undefined,
			() => undefined
		);
		expect(entry?.id).toBe('synth:boom');
	});

	it('resolves custom cues via the library and drops orphans', () => {
		const lib = entryForCue(
			cue({ sfx: 'custom', soundId: 's1' }),
			labels,
			durations,
			(id) => (id === 's1' ? 'My clap' : undefined),
			(id) => (id === 's1' ? 0.5 : undefined)
		);
		expect(lib).toMatchObject({ id: 'library:s1', source: 'library', label: 'My clap' });
		const orphan = entryForCue(
			cue({ sfx: 'custom', soundId: 'gone' }),
			labels,
			durations,
			() => undefined,
			() => undefined
		);
		expect(orphan).toBeNull();
	});

	it('filters diacritic- and case-insensitively', () => {
		const entries: SoundEntry[] = [
			{ id: 'a', source: 'synth', label: 'Sad Trombone', durationSec: 2 },
			{ id: 'b', source: 'library', label: 'Băss drop', durationSec: 1 }
		];
		expect(filterEntries(entries, 'sad trombone').map((e) => e.id)).toEqual(['a']);
		expect(filterEntries(entries, 'bass').map((e) => e.id)).toEqual(['b']);
		expect(filterEntries(entries, '  ')).toHaveLength(2);
		expect(filterEntries(entries, 'zzz')).toHaveLength(0);
	});

	it('groups and drops empty sections in display order', () => {
		const synth = synthEntries(labels, durations).slice(0, 1); // boom → funny bucket
		const groups = groupEntries(
			synth,
			[{ id: 'l1', source: 'library', label: 'clap', durationSec: 0.4 }],
			[]
		);
		expect(groups.map((g) => g.id)).toEqual(['synth-funny', 'library']);
		expect(groupEntries([], [], [])).toEqual([]);
	});

	it('buckets every sfx id exactly once and covers the whole pack', () => {
		const bucketed = SFX_BUCKETS.flatMap((b) => b.ids).sort();
		expect(bucketed).toEqual([...MEME_SFX_IDS].sort());
		const groups = groupEntries(synthEntries(labels, durations), [], []);
		// Five spec buckets, nothing left over in the fallback Soundboard group.
		expect(groups.map((g) => g.id)).toEqual(SFX_BUCKETS.map((b) => `synth-${b.id}`));
	});

	it('retimes by delta clamped at zero', () => {
		const cues = [cue({ id: 'a', atMs: 100 }), cue({ id: 'b', atMs: 5000 })];
		const moved = retimeCue(cues, 'a', -300);
		expect(moved[0]?.atMs).toBe(0);
		expect(moved[1]?.atMs).toBe(5000);
	});

	it('sets absolute cue points as ms integers', () => {
		const cues = [cue({ id: 'a', atMs: 100 })];
		expect(setCueAt(cues, 'a', 2345.6)[0]?.atMs).toBe(2346);
		expect(setCueAt(cues, 'a', -5)[0]?.atMs).toBe(0);
		expect(setCueAt(cues, 'miss', 10)).toEqual(cues);
	});

	it('sorts cues chronologically without mutating input', () => {
		const cues = [cue({ id: 'a', atMs: 900 }), cue({ id: 'b', atMs: 100 })];
		const sorted = sortCues(cues);
		expect(sorted.map((c) => c.id)).toEqual(['b', 'a']);
		expect(cues[0]?.id).toBe('a');
	});
});

describe('SFX_LABELS / SFX_DURATIONS (single source)', () => {
	it('labels every synth id with human copy', () => {
		for (const id of MEME_SFX_IDS) {
			expect(SFX_LABELS[id]).toBeTruthy();
			expect(SFX_LABELS[id]).not.toBe(id);
		}
	});

	it('durations match the recipe table exactly', () => {
		for (const id of MEME_SFX_IDS) {
			expect(SFX_DURATIONS[id]).toBe(SFX_RECIPES[id].duration);
		}
	});

	it('resolve a synth cue via the canonical maps', () => {
		const entry = entryForCue(
			cue({ sfx: 'boom' }),
			SFX_LABELS,
			SFX_DURATIONS,
			() => undefined,
			() => undefined
		);
		expect(entry).toMatchObject({ id: 'synth:boom', label: 'Boom' });
	});
});
