import type { SignalFn } from '../types';
import { extractTags, interactionProfile } from '../interaction-profile.svelte';

/**
 * Topics — boosts notes whose #tags overlap with the user's demonstrated
 * interests (from the persistent interaction profile). A note is scored by its
 * single strongest matching tag, so a note with one loved tag isn't drowned out
 * by a note spamming many tags.
 */
export const topicsScore: SignalFn = (note) => {
	const tags = extractTags(note);
	if (!tags.length) return 0;
	let best = 0;
	for (const tag of tags) {
		const interest = interactionProfile.interestFor(tag);
		if (interest > best) best = interest;
	}
	return best;
};
