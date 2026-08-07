import type { FeedNote } from '$lib/nostr/types';

/**
 * Diversity pass — applied *after* scoring. Prevents a single prolific author
 * from owning the top of the feed by deferring same-author notes outside a
 * sliding window.
 *
 * Algorithm (requeue, not drop):
 *   Walk the ranked list. If the next item's author appeared within the last
 *   `WINDOW` accepted slots, push it onto a deferred queue; otherwise accept it.
 *   When the main list is drained, flush the queue (still newest-first), which
 *   guarantees no note is ever dropped — only reordered.
 */
export function applyDiversity<T extends { note: FeedNote; score: number }>(
	scored: T[],
	windowSize = 3
): T[] {
	const result: T[] = [];
	const recentAuthors: string[] = [];
	const deferred: T[] = [];

	const pushResult = (item: T) => {
		result.push(item);
		recentAuthors.push(item.note.pubkey);
		if (recentAuthors.length > windowSize) recentAuthors.shift();
	};

	for (const item of scored) {
		const blocked = recentAuthors.includes(item.note.pubkey);
		if (blocked) deferred.push(item);
		else pushResult(item);
	}

	// Flush deferred items (still score-descending); the window still applies.
	for (const item of deferred) pushResult(item);
	return result;
}
