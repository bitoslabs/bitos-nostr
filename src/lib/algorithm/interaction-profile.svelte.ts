/**
 * Persistent interaction profile — the algorithm's long-term memory.
 *
 * Without this the ranking is amnesiac: affinity was rebuilt each render from
 * the ~1000 notes currently in the live feed and thrown away on reload. This
 * store persists, decays, and grows with the user's real activity:
 *
 *   • authorAffinity  — who you react to / zap / bookmark (decayed, ~30d half-life)
 *   • tagInterest     — #topics you engage with
 *   • authorDisfavor  — "Not interested" pressure per author (learned, decays)
 *   • tagDisfavor     — "Not interested" pressure per topic (learned, decays)
 *   • dismissedNotes  — "Not interested" (hidden + scored against)
 *   • mutedAuthors    — soft "Show less from" (penalty, NOT a hard block)
 *   • mutedTags       — soft "Show less about" (penalty)
 *
 * Everything is local-first (localStorage), per the project model, and included
 * in the encrypted NIP-30078 settings backup so it roams across devices.
 */
import { browser } from '$app/environment';
import { bookmarks } from '$lib/stores/bookmarks.svelte';
import { humanTags, isMachineEnvelope } from '$lib/nostr/content-classification';
import type { FeedNote } from '$lib/nostr/types';

export const PROFILE_STORAGE_KEY = 'bitos:algorithm-interaction-profile';

function scheduleSettingsSync() {
	if (!browser) return;
	void import('$lib/stores/settings-sync.svelte')
		.then(({ settingsSync }) => settingsSync.schedulePublish())
		.catch(() => {
			/* Sync is best-effort and must never block local interactions. */
		});
}
const DECAY_HALF_LIFE_DAYS = 30;
const MAX_AUTHORS = 400;
const MAX_TAGS = 120;
const MAX_DISMISSED = 1000;

const hashtagPattern = /(?:^|\s)#([\p{L}\p{N}_-]{2,60})/gu;

export function extractTags(note: Pick<FeedNote, 'content' | 'tags'>): string[] {
	// Machine envelopes (encrypted-mesh handshakes, mix beacons, telemetry
	// probes) carry no human topic — their tags are protocol routing ids, not
	// #hashtags. Returning [] here keeps the Topics signal, tag mutes, and tag
	// chips from learning/boosting machine coordination tags in one place.
	if (isMachineEnvelope(note.content)) return [];
	const declared = note.tags
		.filter((tag) => tag[0] === 't' && tag[1])
		.map((tag) => tag[1].toLowerCase());
	// Machine coordination tags (e.g. `udal-friend-<hex>`) are structurally
	// valid hashtags but carry no human topic. Keeping them out here means the
	// Topics signal, tag mutes, and card chips all agree they are not topics.
	const inline = humanTags(
		[...note.content.matchAll(hashtagPattern)].map((match) => match[1].toLowerCase())
	);
	const unique: string[] = [];
	for (const tag of humanTags(declared)) {
		if (tag && !unique.includes(tag)) unique.push(tag);
	}
	for (const tag of inline) {
		if (!unique.includes(tag)) unique.push(tag);
	}
	return unique;
}

export interface InteractionProfileState {
	authorAffinity: Record<string, number>;
	tagInterest: Record<string, number>;
	/** "Not interested" ledger — how often the user has dismissed content from
	 *  each author / topic. Kept separate from the mute lists (which act
	 *  immediately) so the two can evolve independently. */
	authorDisfavor: Record<string, number>;
	tagDisfavor: Record<string, number>;
	dismissedNotes: string[];
	mutedAuthors: string[];
	mutedTags: string[];
	updatedAt: number;
}

const DEFAULT_STATE: InteractionProfileState = {
	authorAffinity: {},
	tagInterest: {},
	authorDisfavor: {},
	tagDisfavor: {},
	dismissedNotes: [],
	mutedAuthors: [],
	mutedTags: [],
	updatedAt: 0
};

function decayedValue(value: number, elapsedDays: number): number {
	return value * Math.pow(0.5, elapsedDays / DECAY_HALF_LIFE_DAYS);
}

/** Bound on the "Not interested" ledger so it can never fossilize into a
 *  permanent shadow-mute. Each disfavor unit decays with the same ~30d
 *  half-life as affinity; the caps keep a single trigger-happy session from
 *  burying an author forever. */
const DISFAVOR_MAX_AUTHORS = 400;
const DISFAVOR_MAX_TAGS = 120;
const DISFAVOR_CEILING = 8;

class InteractionProfileStore {
	state = $state<InteractionProfileState>(structuredClone(DEFAULT_STATE));
	/** Bumped on every write so ranked surfaces can cheaply re-run. */
	version = $state(0);
	loaded = $state(false);

	load = () => {
		if (!browser || this.loaded) return;
		this.loaded = true;
		try {
			const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
			if (raw) {
				const parsed = JSON.parse(raw) as Partial<InteractionProfileState>;
				const now = Date.now();
				const updatedAt = parsed.updatedAt ?? now;
				const elapsedDays = Math.max(0, (now - updatedAt) / 86_400_000);
				// Apply catch-up decay so a profile loaded after weeks isn't stale-weighted.
				const authorAffinity: Record<string, number> = {};
				for (const [pk, value] of Object.entries(parsed.authorAffinity ?? {})) {
					const decayed = decayedValue(Number(value) || 0, elapsedDays);
					if (decayed > 0.01) authorAffinity[pk] = decayed;
				}
				const tagInterest: Record<string, number> = {};
				for (const [tag, value] of Object.entries(parsed.tagInterest ?? {})) {
					const decayed = decayedValue(Number(value) || 0, elapsedDays);
					if (decayed > 0.01) tagInterest[tag] = decayed;
				}
				// Disfavor decays like affinity, so an old "not interested" fades
				// unless the user keeps dismissing similar content.
				const disfavorDecay = {
					authorDisfavor: {} as Record<string, number>,
					tagDisfavor: {} as Record<string, number>
				};
				for (const [pk, value] of Object.entries(parsed.authorDisfavor ?? {})) {
					const decayed = decayedValue(Number(value) || 0, elapsedDays);
					if (decayed > 0.01) disfavorDecay.authorDisfavor[pk] = decayed;
				}
				for (const [tag, value] of Object.entries(parsed.tagDisfavor ?? {})) {
					const decayed = decayedValue(Number(value) || 0, elapsedDays);
					if (decayed > 0.01) disfavorDecay.tagDisfavor[tag] = decayed;
				}
				this.state = {
					authorAffinity,
					tagInterest,
					authorDisfavor: disfavorDecay.authorDisfavor,
					tagDisfavor: disfavorDecay.tagDisfavor,
					dismissedNotes: (parsed.dismissedNotes ?? []).slice(0, MAX_DISMISSED),
					mutedAuthors: parsed.mutedAuthors ?? [],
					mutedTags: parsed.mutedTags ?? [],
					updatedAt: now
				};
				this.trim();
			}
		} catch {
			this.state = structuredClone(DEFAULT_STATE);
		}
	};

	reload = () => {
		this.loaded = false;
		this.state = structuredClone(DEFAULT_STATE);
		this.load();
	};

	private persist() {
		if (!browser) return;
		this.state.updatedAt = Date.now();
		localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(this.state));
		this.version++;
		scheduleSettingsSync();
	}

	private bump() {
		this.persist();
	}

	/** Keep the ledgers bounded (drop weakest entries past the cap). */
	private trim() {
		const trimRecord = (record: Record<string, number>, cap: number) => {
			const entries = Object.entries(record);
			if (entries.length <= cap) return record;
			return Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, cap));
		};
		this.state.authorAffinity = trimRecord(this.state.authorAffinity, MAX_AUTHORS);
		this.state.tagInterest = trimRecord(this.state.tagInterest, MAX_TAGS);
		this.state.authorDisfavor = trimRecord(this.state.authorDisfavor, DISFAVOR_MAX_AUTHORS);
		this.state.tagDisfavor = trimRecord(this.state.tagDisfavor, DISFAVOR_MAX_TAGS);
	}

	// --- positive signals -------------------------------------------------

	/** Reward an author (+ their topics) for a reaction, zap, or bookmark. */
	recordInteraction(note: Pick<FeedNote, 'pubkey' | 'content' | 'tags'>, weight = 1) {
		const pk = note.pubkey;
		if (!pk) return;
		this.state.authorAffinity = {
			...this.state.authorAffinity,
			[pk]: (this.state.authorAffinity[pk] ?? 0) + weight
		};
		for (const tag of extractTags(note).slice(0, 5)) {
			this.state.tagInterest = {
				...this.state.tagInterest,
				[tag]: (this.state.tagInterest[tag] ?? 0) + weight * 0.8
			};
		}
		this.trim();
		this.bump();
	}

	/** Reverse a previously-recorded interaction (e.g. un-react). */
	recordInteractionRemoved(note: Pick<FeedNote, 'pubkey' | 'content' | 'tags'>, weight = 1) {
		const pk = note.pubkey;
		const next = { ...this.state.authorAffinity };
		if (next[pk] !== undefined) {
			next[pk] = Math.max(0, next[pk] - weight);
			if (next[pk] <= 0) delete next[pk];
		}
		this.state.authorAffinity = next;
		for (const tag of extractTags(note).slice(0, 5)) {
			const current = this.state.tagInterest[tag] ?? 0;
			const reduced = Math.max(0, current - weight * 0.8);
			const nextTags = { ...this.state.tagInterest };
			if (reduced <= 0) delete nextTags[tag];
			else nextTags[tag] = reduced;
			this.state.tagInterest = nextTags;
		}
		this.bump();
	}

	// --- negative signals -------------------------------------------------

	/** "Not interested" — hide this note AND learn from it, so *future* notes
	 *  from the same author / about the same topics rank lower. Pure id-hiding
	 *  is useless against id-rotating swarm traffic (each protocol message is a
	 *  brand-new event id), which is exactly what "show less like this" must
	 *  catch. Weights are small, capped, and decay (~30d half-life) like the
	 *  positive ledger so an accidental tap never fossilizes. */
	dismissNote(noteId: string, note?: Pick<FeedNote, 'pubkey' | 'content' | 'tags'>) {
		if (!noteId) return;
		if (note) {
			const pk = note.pubkey;
			if (pk) {
				this.state.authorDisfavor = {
					...this.state.authorDisfavor,
					[pk]: Math.min(DISFAVOR_CEILING, (this.state.authorDisfavor[pk] ?? 0) + 1)
				};
			}
			for (const tag of extractTags(note).slice(0, 5)) {
				this.state.tagDisfavor = {
					...this.state.tagDisfavor,
					[tag]: Math.min(DISFAVOR_CEILING, (this.state.tagDisfavor[tag] ?? 0) + 0.8)
				};
			}
			this.trim();
		}
		if (this.state.dismissedNotes.includes(noteId)) {
			this.bump();
			return;
		}
		this.state.dismissedNotes = [noteId, ...this.state.dismissedNotes].slice(0, MAX_DISMISSED);
		this.bump();
	}

	isDismissed(noteId: string): boolean {
		return this.state.dismissedNotes.includes(noteId);
	}

	toggleMutedAuthor(pubkey: string): boolean {
		const muted = this.state.mutedAuthors.includes(pubkey);
		this.state.mutedAuthors = muted
			? this.state.mutedAuthors.filter((pk) => pk !== pubkey)
			: [...this.state.mutedAuthors, pubkey];
		this.bump();
		return !muted;
	}

	isAuthorMuted(pubkey: string): boolean {
		return this.state.mutedAuthors.includes(pubkey);
	}

	toggleMutedTag(tag: string): boolean {
		const t = tag.toLowerCase();
		const muted = this.state.mutedTags.includes(t);
		this.state.mutedTags = muted
			? this.state.mutedTags.filter((x) => x !== t)
			: [...this.state.mutedTags, t];
		this.bump();
		return !muted;
	}

	isTagMuted(tag: string): boolean {
		return this.state.mutedTags.includes(tag.toLowerCase());
	}

	// --- read helpers -----------------------------------------------------

	/** Normalized "not interested" pressure 0–1 for an author. Capped at 1 at
	 *  the DISFAVOR_CEILING, log-scaled so the first dismissals matter most. */
	disfavorFor(pubkey: string): number {
		const raw = this.state.authorDisfavor[pubkey];
		if (!raw) return 0;
		return Math.min(1, Math.log10(1 + raw) / Math.log10(1 + DISFAVOR_CEILING));
	}

	/** Normalized "not interested" pressure 0–1 for a topic. */
	tagDisfavorFor(tag: string): number {
		const raw = this.state.tagDisfavor[tag.toLowerCase()];
		if (!raw) return 0;
		return Math.min(1, Math.log10(1 + raw) / Math.log10(1 + DISFAVOR_CEILING));
	}

	/** Normalized affinity 0–1 for an author (log-scaled against the max). */
	affinityFor(pubkey: string): number {
		const raw = this.state.authorAffinity[pubkey];
		if (!raw) return 0;
		const max = this.maxAffinityRaw() || 1;
		return Math.min(1, Math.log10(1 + raw) / Math.log10(1 + max));
	}

	maxAffinityRaw(): number {
		let max = 0;
		for (const value of Object.values(this.state.authorAffinity)) if (value > max) max = value;
		return max;
	}

	/** Normalized interest 0–1 for a tag. */
	interestFor(tag: string): number {
		const raw = this.state.tagInterest[tag.toLowerCase()];
		if (!raw) return 0;
		const max = this.maxTagInterestRaw() || 1;
		return Math.min(1, Math.log10(1 + raw) / Math.log10(1 + max));
	}

	maxTagInterestRaw(): number {
		let max = 0;
		for (const value of Object.values(this.state.tagInterest)) if (value > max) max = value;
		return max;
	}

	topTags(limit = 8): { tag: string; score: number }[] {
		return Object.entries(this.state.tagInterest)
			.map(([tag, score]) => ({ tag, score }))
			.sort((a, b) => b.score - a.score)
			.slice(0, limit);
	}

	/** Re-seed the profile from current bookmarks (run once on first load). */
	hydrateFromBookmarks(notes: FeedNote[]) {
		const byId = new Map(notes.map((n) => [n.id, n]));
		let changed = false;
		for (const bookmark of bookmarks.items) {
			if (this.state.authorAffinity[bookmark.note.pubkey] === undefined) {
				const note = byId.get(bookmark.id) ?? bookmark.note;
				this.state.authorAffinity = {
					...this.state.authorAffinity,
					[bookmark.note.pubkey]: (this.state.authorAffinity[bookmark.note.pubkey] ?? 0) + 0.8
				};
				for (const tag of extractTags(note).slice(0, 5)) {
					this.state.tagInterest = {
						...this.state.tagInterest,
						[tag]: (this.state.tagInterest[tag] ?? 0) + 0.6
					};
				}
				changed = true;
			}
		}
		if (changed) {
			this.trim();
			this.bump();
		}
	}

	clear = (sync = true) => {
		this.state = structuredClone(DEFAULT_STATE);
		if (sync) {
			this.bump();
		} else {
			this.version++;
			if (browser) localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(this.state));
		}
	};
}

export const interactionProfile = new InteractionProfileStore();
