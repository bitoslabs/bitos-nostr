/**
 * Builds a `ScoringContext` for a ranking pass, derived from the live stores.
 * Everything here is read-only and memoized per surface so the pipeline is a
 * pure function of `(candidates, ctx, config)`.
 */
import { browser } from '$app/environment';
import { contacts } from '$lib/nostr/contacts.svelte';
import { identity } from '$lib/nostr/identity.svelte';
import { feed } from '$lib/nostr/feed.svelte';
import { NOSTR_KINDS } from '$lib/nostr/types';
import { queryPrimaryFirst } from '$lib/nostr/pool';
import { algorithmPreferences } from './preferences.svelte';
import { interactionProfile } from './interaction-profile.svelte';
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
 * Affinity map: pubkey → 0–1. Merges the *persistent* interaction profile
 * (long-term learning, survives reloads) with the *ephemeral* signal from notes
 * currently in the live feed (immediate responsiveness to a just-given ❤️).
 */
export function buildAffinity(notes: FeedNote[], me?: string): Map<string, number> {
	const scores = new Map<string, number>();

	// 1) Persistent profile (decayed, capped) — the long-term memory.
	for (const [pk] of Object.entries(interactionProfile.state.authorAffinity)) {
		scores.set(pk, interactionProfile.affinityFor(pk));
	}

	if (!me) return normalize(scores);
	const now = Math.floor(Date.now() / 1000);

	const bump = (pubkey: string, weight: number, createdAt: number) => {
		if (!pubkey || pubkey === me) return;
		// Short-term recency bias so a ❤️ you just gave matters most.
		const ageDays = Math.max(0, (now - createdAt) / 86400);
		const recency = Math.pow(0.5, ageDays / 14); // ~2-week ephemeral half-life
		scores.set(pubkey, Math.min(1, (scores.get(pubkey) ?? 0) + weight * recency * 0.3));
	};

	// 2) Ephemeral boost from this session's live reactions.
	for (const note of notes) {
		const reactedByMe = note.reactions.some((r) => r.byMe);
		if (reactedByMe) bump(note.pubkey, 1, note.createdAt);
	}

	return normalize(scores);
}

function normalize(scores: Map<string, number>): Map<string, number> {
	const out = new Map<string, number>();
	for (const [pk, value] of scores) {
		if (value > 0) out.set(pk, Math.min(1, value));
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
	// Track the persistent interaction profile so ranking re-runs on new activity.
	void interactionProfile.version;

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
