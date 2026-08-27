/**
 * Unified sound catalog for the Meme Studio sound picker (pure core — the
 * dialog supplies the browser bits). Every place a cue can come from —
 * the synth recipes, the personal sound library, or shared sounds — maps
 * onto one `SoundEntry` so the picker can preview/filter/stage uniformly,
 * and so cue→entry resolution (for re-timing or deleting from the dialog)
 * never depends on which source produced the cue.
 */

import { CUSTOM_SOUND_KEY, MEME_SFX_IDS, type MemeSfxCue, type MemeSfxId } from '$lib/meme/schema';
import { SFX_RECIPES } from '$lib/meme/sfx';

export type SoundSource = 'synth' | 'library' | 'shared';

export interface SoundEntry {
	id: string;
	source: SoundSource;
	label: string;
	/** Playback length in seconds (synth recipes expose theirs here). */
	durationSec: number;
	/** Custom-sound id when source === 'library'/'shared' (cue soundId). */
	soundId?: string;
}

/** Grouping keys for the picker sections. */
/** Picker group ids — `synth-<bucket>` covers the Meme Pack V1 buckets. */
export type SoundGroupId = 'synth' | `synth-${string}` | 'library' | 'shared';

export interface SoundGroup {
	id: SoundGroupId;
	label: string;
	entries: SoundEntry[];
}

/** Human labels for the synth soundboard (display copy, single source). */
export const SFX_LABELS: Record<MemeSfxId, string> = {
	boom: 'Boom',
	bruh: 'Bruh',
	laugh: 'Laugh',
	'crowd-laugh': 'Crowd laugh',
	gasp: 'Gasp',
	'sad-trombone': 'Sad trombone',
	'awkward-silence': 'Awkward silence',
	'bass-hit': 'Bass hit',
	whoosh: 'Whoosh',
	slam: 'Slam',
	explosion: 'Explosion',
	punch: 'Punch',
	'anime-slash': 'Anime slash',
	error: 'Error',
	success: 'Success',
	notification: 'Notification',
	loading: 'Loading',
	'game-over': 'Game over',
	coin: 'Coin',
	cash: 'Cash',
	jackpot: 'Jackpot',
	'lightning-zap': 'Lightning zap',
	pop: 'Pop',
	boing: 'Boing',
	drumroll: 'Drumroll',
	ding: 'Ding',
	swipe: 'Swipe',
	click: 'Click',
	snap: 'Snap',
	'record-scratch': 'Record scratch',
	'reverse-whoosh': 'Reverse whoosh'
};

/** Playback length per synth recipe in seconds (single source). */
export const SFX_DURATIONS: Record<MemeSfxId, number> = Object.fromEntries(
	MEME_SFX_IDS.map((id) => [id, SFX_RECIPES[id].duration])
) as Record<MemeSfxId, number>;

/** Build the synth group from recipe ids + label/duration maps. */
export function synthEntries(
	labels: Record<MemeSfxId, string>,
	durations: Record<MemeSfxId, number>
): SoundEntry[] {
	return MEME_SFX_IDS.map((sfx) => ({
		id: `synth:${sfx}`,
		source: 'synth' as const,
		label: labels[sfx] ?? sfx,
		durationSec: durations[sfx] ?? 1
	}));
}

/** Meme Pack V1 buckets (docs/source/templete/tp-2.md) — display grouping
 *  for the soundboard; every id must land in exactly one bucket. */
export const SFX_BUCKETS: { id: string; label: string; ids: readonly string[] }[] = [
	{
		id: 'funny',
		label: 'Funny',
		ids: ['boom', 'bruh', 'laugh', 'crowd-laugh', 'gasp', 'sad-trombone', 'awkward-silence']
	},
	{
		id: 'impact',
		label: 'Impact',
		ids: ['bass-hit', 'whoosh', 'slam', 'explosion', 'punch', 'anime-slash']
	},
	{
		id: 'system',
		label: 'System',
		ids: ['error', 'success', 'notification', 'loading', 'game-over']
	},
	{ id: 'money', label: 'Money', ids: ['coin', 'cash', 'jackpot', 'lightning-zap'] },
	{
		id: 'transitions',
		label: 'Transitions',
		ids: [
			'pop',
			'boing',
			'drumroll',
			'ding',
			'swipe',
			'click',
			'snap',
			'record-scratch',
			'reverse-whoosh'
		]
	}
];

/** Derive a playable entry from an existing cue (synth id or library ref). */
export function entryForCue(
	cue: MemeSfxCue,
	labels: Record<MemeSfxId, string>,
	durations: Record<MemeSfxId, number>,
	libraryLabel: (soundId: string) => string | undefined,
	libraryDuration: (soundId: string) => number | undefined
): SoundEntry | null {
	if (cue.sfx === CUSTOM_SOUND_KEY) {
		const soundId = cue.soundId ?? '';
		if (!soundId) return null;
		const label = libraryLabel(soundId);
		if (!label) return null; // orphaned custom cue (sound deleted)
		return {
			id: `library:${soundId}`,
			source: 'library',
			label,
			durationSec: libraryDuration(soundId) ?? 1,
			soundId
		};
	}
	if (!MEME_SFX_IDS.includes(cue.sfx)) return null;
	return {
		id: `synth:${cue.sfx}`,
		source: 'synth',
		label: labels[cue.sfx] ?? cue.sfx,
		durationSec: durations[cue.sfx] ?? 1
	};
}

/** Case-insensitive substring match over labels, diacritic-folded. */
export function filterEntries(entries: SoundEntry[], query: string): SoundEntry[] {
	const q = query
		.trim()
		.toLocaleLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
	if (!q) return entries;
	return entries.filter((entry) =>
		entry.label
			.toLocaleLowerCase()
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.includes(q)
	);
}

/** Segment a duration into picker-friendly groups (empty groups dropped).
 *  The synth soundboard is split into its Meme Pack buckets so a 31-sound
 *  board stays scannable; searching still flattens everything. */
export function groupEntries(
	synth: SoundEntry[],
	library: SoundEntry[],
	shared: SoundEntry[]
): SoundGroup[] {
	const groups: SoundGroup[] = [];
	const synthLeft = new Set(synth.map((e) => e.id));
	for (const bucket of SFX_BUCKETS) {
		const entries = synth.filter(
			(e) => bucket.ids.some((id) => `synth:${id}` === e.id) && synthLeft.delete(e.id)
		);
		if (entries.length) groups.push({ id: `synth-${bucket.id}`, label: bucket.label, entries });
	}
	// Ids not in any bucket (or from a different catalog build) keep the
	// classic Soundboard group so nothing ever disappears from the picker.
	if (synthLeft.size) {
		groups.push({
			id: 'synth',
			label: 'Soundboard',
			entries: synth.filter((e) => synthLeft.has(e.id))
		});
	}
	groups.push(
		{ id: 'library', label: 'My sounds', entries: library },
		{ id: 'shared', label: 'Shared', entries: shared }
	);
	return groups.filter((g) => g.entries.length > 0);
}

/**
 * Re-time cues for the value-editing UX: nudge a cue by delta ms, clamped
 * to ≥ 0 and the cap, keeping one decimal of precision at most (cue points
 * are integer ms on the wire — round here so UI steppers match the schema).
 */
export function retimeCue(cues: MemeSfxCue[], cueId: string, deltaMs: number): MemeSfxCue[] {
	return cues.map((cue) =>
		cue.id === cueId ? { ...cue, atMs: Math.max(0, Math.round(cue.atMs + deltaMs)) } : cue
	);
}

/** Set a cue's absolute point (clamped ≥ 0, ms-integer). */
export function setCueAt(cues: MemeSfxCue[], cueId: string, atMs: number): MemeSfxCue[] {
	const next = Number.isFinite(atMs) ? Math.max(0, Math.round(atMs)) : 0;
	return cues.map((cue) => (cue.id === cueId ? { ...cue, atMs: next } : cue));
}

/** Sort cues chronologically for display. */
export function sortCues(cues: MemeSfxCue[]): MemeSfxCue[] {
	return [...cues].sort((a, b) => a.atMs - b.atMs);
}
