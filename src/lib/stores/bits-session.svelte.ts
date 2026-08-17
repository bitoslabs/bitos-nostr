import type { FeedNote } from '$lib/nostr/types';

export type BitsMode = 'explore' | 'following' | 'foryou';

export type ReelNote = FeedNote & { mediaUrl: string; mediaType: 'video' | 'image' };

/**
 * In-memory Bits session — survives route switches (Feed ↔ Bits ↔ …) for as
 * long as the app tab is open. The route component hydrates from it on mount
 * so returning to Bits is instant: loaded reels, active tab, grid/player
 * position, revealed tiles, and the pagination cursor all persist without a
 * refetch. A background refresh only fires when the session is stale.
 *
 * This is deliberately NOT reactive module state: the page owns reactivity
 * locally and mirrors values in here, so async relay loads can keep writing
 * to the session even after the route has unmounted.
 */
export const bitsSession = {
	reels: [] as ReelNote[],
	bitsMode: 'foryou' as BitsMode,
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
export const BITS_SESSION_REFRESH_MS = 60_000;
