/**
 * Bitz comment-thread helpers shared by the Bitz page (action-rail counters)
 * and the comments panel component (thread layout, pagination). Everything
 * reads the feed store, so values derived from these update as replies
 * stream in from relays.
 */
import { SvelteMap } from 'svelte/reactivity';
import { feed } from './feed.svelte';
import type { FeedNote } from './types';

export type CommentPage = {
	loaded: boolean;
	oldestCreatedAt: number;
	hasMore: boolean;
};

/** Comment pagination cursors, keyed by reel id. Module-level so they survive
 *  closing and reopening the panel — a thread that already loaded paints
 *  instantly from the feed store without another relay round trip. */
export const commentPages = $state<Record<string, CommentPage>>({});

/** Optimistic zap totals for comments (sats added before the relay echo
 *  reconciles the authoritative count). Module-level for the same
 *  survive-panel-close reason as `commentPages`. */
export const optimisticCommentZaps = $state<Record<string, number>>({});

/** Every reply in the reel's thread: top-level comments carry the reel as
 *  their reply tag, nested replies carry it as their NIP-10 root tag. NIP-22
 *  comments reference the reel via the uppercase E root tag instead. Powers
 *  the comment counters. */
export function commentsFor(reelId: string) {
	return feed.notes
		.filter(
			(note) =>
				note.id !== reelId &&
				note.tags.some((tag) => (tag[0] === 'e' || tag[0] === 'E') && tag[1] === reelId)
		)
		.sort((a, b) => a.createdAt - b.createdAt);
}

/** Two-level thread layout, same as feed cards: top-level comments reply
 *  directly to the reel; everything else nests under its top-level ancestor
 *  (a reply to a level-2 comment renders flat beside it — never a third
 *  indent). Orphans whose parent sits behind the pagination cut, and cyclic
 *  replyTo chains, fall back to top-level so nothing ever vanishes. */
export function commentTree(reelId: string): {
	top: FeedNote[];
	children: SvelteMap<string, FeedNote[]>;
} {
	const thread = commentsFor(reelId);
	// Transient lookup index — discarded per call.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const byId = new Map(thread.map((note) => [note.id, note]));
	const isTopLevel = (note: FeedNote) => !note.replyTo || note.replyTo === reelId;
	/** The top-level comment this note nests under, or null = render top-level. */
	const parentGroupId = (note: FeedNote): string | null => {
		let current = note;
		// Guard against cyclic replyTo chains: stop after thread.length hops.
		for (let hops = 0; hops < thread.length; hops += 1) {
			if (isTopLevel(current)) return null;
			const parent = byId.get(current.replyTo!);
			if (!parent) return null; // orphan — keep it visible at top level
			if (isTopLevel(parent)) return parent.id;
			current = parent;
		}
		return null; // cycle — bail out as top-level
	};
	const top: FeedNote[] = [];
	const children = new SvelteMap<string, FeedNote[]>();
	for (const note of thread) {
		const pid = parentGroupId(note);
		if (pid === null) top.push(note);
		else children.set(pid, [...(children.get(pid) ?? []), note]);
	}
	return { top, children };
}
