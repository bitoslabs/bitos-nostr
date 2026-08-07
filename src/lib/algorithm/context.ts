/**
 * Builds a `ScoringContext` for a ranking pass, derived from the live stores.
 * Everything here is read-only and memoized per surface so the pipeline is a
 * pure function of `(candidates, ctx, config)`.
 */
import { browser } from '$app/environment';
import { contacts } from '$lib/nostr/contacts.svelte';
import { identity } from '$lib/nostr/identity.svelte';
import { bookmarks } from '$lib/stores/bookmarks.svelte';
import { feed } from '$lib/nostr/feed.svelte';
import { NOSTR_KINDS } from '$lib/nostr/types';
import { queryPrimaryFirst } from '$lib/nostr/pool';
import { algorithmPreferences } from './preferences.svelte';
import type { FeedNote } from '$lib/nostr/types';
import type { ScoringContext, SurfaceId } from './types';

/**
 * Lazily-built web-of-trust second-hop set, keyed by the active user. Cached in
 * memory with a TTL so we never refetch per render and never fire query storms.
 */
const wotCache = new Map<string, { set: Set<string>; at: number; fetching: Promise<void> | null }>();
const WOT_TTL_MS = 5 * 60 * 1000;
const WOT_FETCH_BATCH = 40; // cap relay queries per refresh

/** Schedule a background refresh of the second-hop set for this user. */
function scheduleWotRefresh(me: string, following: string[]) {
	const entry = wotCache.get(me);
	if (entry?.fetching) return;
	if (entry && Date.now() - entry.at < WOT_TTL_MS) return;

	const fetchPromise = (async () => {
		try {
			// Query a capped slice of kind-3 contact lists from the people you follow.
			const sample = following.slice(0, WOT_FETCH_BATCH);
			if (!sample.length) {
				wotCache.set(me, { set: new Set(), at: Date.now(), fetching: null });
				algorithmPreferences.bumpWotVersion();
				return;
			}
			const lists = await queryPrimaryFirst([
				{ kinds: [NOSTR_KINDS.CONTACT_LIST], authors: sample, limit: sample.length }
			]);
			const set = new Set<string>();
			for (const event of lists) {
				for (const tag of event.tags) {
					if (tag[0] === 'p' && /^[0-9a-fA-F]{64}$/.test(tag[1] ?? '')) {
						const pk = tag[1].toLowerCase();
						if (pk !== me && !following.includes(pk)) set.add(pk);
					}
				}
			}
			wotCache.set(me, { set, at: Date.now(), fetching: null });
			// Signal any reactive surface depending on WoT to re-rank now that the
			// second-hop set is populated.
			algorithmPreferences.bumpWotVersion();
		} catch {
			/* WoT is best-effort; ranking proceeds with whatever we have. */
			const prev = wotCache.get(me);
			wotCache.set(me, { set: prev?.set ?? new Set(), at: Date.now(), fetching: null });
		}
	})();

	wotCache.set(me, {
		set: entry?.set ?? new Set(),
		at: entry?.at ?? 0,
		fetching: fetchPromise
	});
}

/**
 * Affinity map: pubkey → 0–1. Built from the notes already in the live feed that
 * the user has reacted to or that carry zaps attributed to them, plus bookmarked
 * authors. A light recency bias keeps it from fossilizing.
 */
export function buildAffinity(notes: FeedNote[], me?: string): Map<string, number> {
	const scores = new Map<string, number>();
	if (!me) return scores;
	const now = Math.floor(Date.now() / 1000);

	const bump = (pubkey: string, weight: number, createdAt: number) => {
		if (!pubkey || pubkey === me) return;
		// Recency bias: interactions with recent notes weigh more.
		const ageDays = Math.max(0, (now - createdAt) / 86400);
		const recency = Math.pow(0.5, ageDays / 30); // ~1 month half-life
		scores.set(pubkey, (scores.get(pubkey) ?? 0) + weight * recency);
	};

	for (const note of notes) {
		const reactedByMe = note.reactions.some((r) => r.byMe);
		if (reactedByMe) bump(note.pubkey, 1, note.createdAt);
		if (note.zapTotalSats > 0 && note.reactions.some((r) => r.byMe)) {
			// We can't attribute zaps to *me* precisely here; treat reacted notes as
			// a proxy for stronger affinity.
			bump(note.pubkey, 0.5, note.createdAt);
		}
	}

	for (const bookmark of bookmarks.items) {
		bump(bookmark.note.pubkey, 0.8, bookmark.note.createdAt);
	}

	// Normalize to 0–1 via a soft log curve so power-interactors don't dominate.
	let max = 0;
	for (const value of scores.values()) if (value > max) max = value;
	const norm = Math.log10(1 + max) || 1;
	const out = new Map<string, number>();
	for (const [pubkey, value] of scores) {
		out.set(pubkey, Math.min(1, Math.log10(1 + value) / norm));
	}
	return out;
}

/** Authors featured at the top of the current surface (for the novelty input). */
function recentAuthorsFrom(notes: FeedNote[], count: number): Set<string> {
	const set = new Set<string>();
	for (const note of notes.slice(0, count)) set.add(note.pubkey);
	return set;
}

/**
 * Compose a scoring context for the given surface + candidate notes. Reads the
 * live stores; the WoT refresh is fired async and won't block this call.
 */
export function buildScoringContext(
	surface: SurfaceId,
	candidates: FeedNote[],
	options: { dwell?: Map<string, number>; topWindow?: number } = {}
): ScoringContext {
	const me = identity.current?.pk;
	const following = contacts.following;
	const followingSet = contacts.followingSet;
	const now = Math.floor(Date.now() / 1000);

	// Kick off a background WoT refresh (no-op if cached/fresh).
	if (me && following.length) scheduleWotRefresh(me, following);
	const wotSet = me ? (wotCache.get(me)?.set ?? new Set<string>()) : new Set<string>();

	// Track WoT freshness so ranked surfaces re-run when the second-hop set lands.
	void algorithmPreferences.wotVersion;

	const affinity = buildAffinity(feed.notes, me);
	const recentAuthors = recentAuthorsFrom(candidates, options.topWindow ?? 6);

	return {
		now,
		me,
		followingSet,
		affinity,
		wotSet,
		recentAuthors,
		dwell: options.dwell,
		recencyHalfLifeSeconds: algorithmPreferences.recencyHalfLifeSeconds
	};
}

/** Exposed for tests / settings preview so they can observe the WoT state. */
export function getWotSet(me?: string): Set<string> {
	if (!me) return new Set();
	return wotCache.get(me)?.set ?? new Set();
}

export function refreshWot(me?: string) {
	if (!browser || !me) return;
	const following = contacts.following;
	if (!following.length) return;
	// Force a refresh by clearing the timestamp.
	const entry = wotCache.get(me);
	if (entry) entry.at = 0;
	scheduleWotRefresh(me, following);
}
