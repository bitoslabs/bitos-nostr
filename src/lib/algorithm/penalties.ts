import type { FeedNote } from '$lib/nostr/types';
import { extractTags, interactionProfile } from './interaction-profile.svelte';

/**
 * Negative-feedback penalties — applied as a multiplier to a note's final score
 * AFTER the weighted sum. Unlike hard blocks (handled in the feed store), these
 * are soft: they push notes down the ranking without hiding them, so the user
 * can still discover them if nothing else is available.
 *
 * Three layers combine multiplicatively:
 *   • dismissed note (recently "Not interested")     → 0   (effectively hidden)
 *   • learned disfavor — each "Not interested" on the same author/topic adds
 *     decaying pressure that scales this multiplier down toward ~0.15
 *   • explicit soft mutes ("Show less from @x" / "about #x") → 0.25 / 0.4
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

	// Learned "not interested" pressure. A single dismissal nudges similar
	// notes down gently; repeated dismissals converge toward a near-mute
	// (~0.15 at the ledger ceiling) that still decays away if the user
	// stops dismissing — softer and more reversible than the explicit mutes.
	const authorDisfavor = interactionProfile.disfavorFor(note.pubkey);
	let tagDisfavor = 0;
	for (const tag of extractTags(note)) {
		tagDisfavor = Math.max(tagDisfavor, interactionProfile.tagDisfavorFor(tag));
		if (tagDisfavor >= 1) break;
	}
	const learned = Math.max(authorDisfavor, tagDisfavor);
	if (learned > 0) multiplier *= 1 - 0.85 * learned;

	return Math.max(0, multiplier);
}
