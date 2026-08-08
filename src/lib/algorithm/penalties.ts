import type { FeedNote } from '$lib/nostr/types';
import { extractTags, interactionProfile } from './interaction-profile.svelte';

/**
 * Negative-feedback penalties — applied as a multiplier to a note's final score
 * AFTER the weighted sum. Unlike hard blocks (handled in the feed store), these
 * are soft: they push notes down the ranking without hiding them, so the user
 * can still discover them if nothing else is available.
 *
 * Returns a multiplier in [0, 1]:
 *   • dismissed note (recently "Not interested")     → 0   (effectively hidden)
 *   • soft-muted author ("Show less from @x")        → 0.25
 *   • soft-muted tag ("Show less about #x")           → 0.4
 * Penalties stack multiplicatively.
 */
export function negativePenalty(note: FeedNote): number {
	let multiplier = 1;

	if (interactionProfile.isDismissed(note.id)) return 0;

	if (interactionProfile.isAuthorMuted(note.pubkey)) multiplier *= 0.25;

	for (const tag of extractTags(note)) {
		if (interactionProfile.isTagMuted(tag)) {
			multiplier *= 0.4;
			break; // one muted tag is enough
		}
	}

	return multiplier;
}
