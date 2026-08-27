import type { FeedNote } from '$lib/nostr/types';
import { eventRefFor, eventRefKey } from '$lib/nostr/event-ref';
import { toFeedNote } from '$lib/nostr/feed-note';
import { parseBitz, type BitzRendition } from '$lib/nostr/bitz-codec';

export type BitzMode = 'explore' | 'following' | 'foryou' | 'trending' | 'zapped';

/**
 * A reel's media source chain: the primary URL plus ordered fallbacks
 * (NIP-92 `fallback` mirrors, extra same-type URLs from the note). The
 * player walks this chain automatically when a URL dies.
 */
export type ReelNote = FeedNote & {
	mediaUrl: string;
	mediaType: 'video' | 'image';
	/** Ordered alternate URLs for the same media. */
	mediaFallbacks?: string[];
	/** Alternate quality renditions (READ-002), high→low. The player may
	 * swap `mediaUrl` for one of these to match the viewport. */
	mediaRenditions?: BitzRendition[];
};

/**
 * In-memory Bitz session — survives route switches (Feed ↔ Bitz ↔ …) for as
 * long as the app tab is open. The route component hydrates from it on mount
 * so returning to Bitz is instant: loaded reels, active tab, grid/player
 * position, revealed tiles, and the pagination cursor all persist without a
 * refetch. A background refresh only fires when the session is stale.
 *
 * This is deliberately NOT reactive module state: the page owns reactivity
 * locally and mirrors values in here, so async relay loads can keep writing
 * to the session even after the route has unmounted.
 */
export const bitzSession = {
	reels: [] as ReelNote[],
	bitzMode: 'foryou' as BitzMode,
	exploreVisible: 0,
	renderedReelCount: 0,
	revealedSensitiveReels: {} as Record<string, boolean>,
	oldestReelEventCreatedAt: 0,
	hasMoreReels: true,
	exploreScrollTop: 0,
	activeReelIndex: 0,
	lastRefreshedAt: 0
};

/** Hydrated sessions older than this refresh from relays in the background. */
export const BITZ_SESSION_REFRESH_MS = 60_000;

/**
 * Reconcile an optimistic reel with relay echoes, idempotently (PUB-013,
 * §21.4 "optimistic event reconciles relay echo").
 *
 * The relay echo of a just-published bitz carries the same event id as the
 * optimistic local copy — dedup is BY ID, never a second entry. When the id
 * already exists, the confirmed event merges into its slot (fresh `raw`,/
 * activity counts) without reordering the reel list. When it is absent, the
 * optimistic reel is prepended so the player shows it immediately (deep link
 * / "View in Bitz" no longer waits for relay round-trips).
 *
 * Addressable echoes (same `kind:pubkey:d`) also reconcile: the newest
 * `created_at` wins; ties keep the existing entry.
 */
export function reconcileOptimisticReel(
	reels: ReelNote[],
	incoming: ReelNote
): { reels: ReelNote[]; inserted: boolean; replaced: boolean } {
	const incomingKey = reelKey(incoming);
	for (const [index, existing] of reels.entries()) {
		if (reelKey(existing) !== incomingKey) continue;
		// Same id (or same addressable coordinate): merge into the existing
		// slot. The optimistic copy keeps its position; the echo upgrades it
		// with the confirmed raw event. Older addressable echoes are ignored.
		if (incoming.id === existing.id || incoming.createdAt >= existing.createdAt) {
			const merged: ReelNote =
				incoming.id === existing.id ? incoming : { ...existing, ...incoming };
			if (sameReel(merged, existing)) return { reels, inserted: false, replaced: false };
			const next = reels.slice();
			next[index] = merged;
			return { reels: next, inserted: false, replaced: true };
		}
		return { reels, inserted: false, replaced: false };
	}
	return { reels: [incoming, ...reels], inserted: true, replaced: false };
}

/** Identity: the addressable coordinate when present, else the event id. */
function reelKey(reel: ReelNote): string {
	const ref = eventRefFor({
		id: reel.id,
		pubkey: reel.pubkey,
		kind: typeof reel.raw?.kind === 'number' ? reel.raw.kind : 0,
		tags: reel.tags
	});
	// reel.id is a relay-provided event id; fall back to the raw `event:<id>`
	// key if it ever fails hex validation so identity stays string-stable.
	return ref ? eventRefKey(ref) : `event:${reel.id}`;
}

/**
 * Repository conversion (READ-001): relay event -> ReelNote domain object.
 * All NIP-71/imeta parsing lives here — route components consume ReelNotes
 * and never parse raw events in markup (plan §6.2/§13 'BitzController
 * consumes BitzVideo, not NostrEvent in the widget').
 *
 * Returns null when the event carries no reel-renderable media (parseBitz
 * is the single source of media truth — imeta first, content URLs fallback
 * — so optimistic and confirmed reels agree by construction).
 */
export function toReelNote(
	event: Parameters<typeof parseBitz>[0] & Parameters<typeof toFeedNote>[0]
): ReelNote | null {
	{
		const media = parseBitz(event);
		if (!media) return null;
		return {
			...toFeedNote(event),
			mediaUrl: media.url,
			mediaType: media.type,
			mediaFallbacks: media.fallbacks,
			mediaRenditions: media.renditions
		};
	}
}

/**
 * Build the optimistic reel for a just-published bitz event (PUB-013).
 *
 * Returns null when the event carries no reel-renderable media (parseBitz
 * is the single source of media truth — imeta first, content URLs fallback
 * — exactly what the relay echo will be parsed with, so optimistic and
 * confirmed reels agree by construction).
 */
export function optimisticReelFromEvent(event: NonNullable<FeedNote['raw']>): ReelNote | null {
	return toReelNote(event);
}

function sameReel(a: ReelNote, b: ReelNote): boolean {
	return (
		a.id === b.id &&
		a.createdAt === b.createdAt &&
		a.content === b.content &&
		a.mediaUrl === b.mediaUrl &&
		a.raw === b.raw &&
		a.reactions.length === b.reactions.length &&
		a.repostCount === b.repostCount &&
		a.zapTotalSats === b.zapTotalSats
	);
}
