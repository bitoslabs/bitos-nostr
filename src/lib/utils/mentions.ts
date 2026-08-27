/**
 * Shared @mention autocomplete helpers.
 *
 * Extracted from the feed Composer so every caption/description surface
 * (Composer, Meme Post caption, shared-sound form) gets the exact same
 * mention behavior: `@`-trigger detection, tracking of selected mentions,
 * and publish-time `@name` → `nostr:npub…` rewriting (NIP-27).
 */

export interface MentionCandidate {
	pubkey: string;
	name: string;
	picture?: string;
	npub: string;
}

export interface TrackedMention {
	name: string;
	npub: string;
}

export function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Match a `@name` token in content (word-boundary safe on both sides). */
export function mentionTokenRegex(name: string): RegExp {
	return new RegExp(`(^|\\s)@${escapeRegExp(name)}(?=$|\\s|[^\\p{L}\\p{N}_-])`, 'iu');
}

/**
 * Detect an in-progress `@query` at the caret: the `@` must start the text or
 * follow whitespace, and the query may not contain whitespace (max 40 chars).
 */
export function detectMentionTrigger(
	text: string,
	caret: number
): { start: number; query: string } | null {
	const before = text.slice(0, caret);
	const at = before.lastIndexOf('@');
	if (at < 0 || (at > 0 && !/\s/.test(before[at - 1]!))) return null;
	const query = before.slice(at + 1);
	return query.length <= 40 && !/\s/.test(query) ? { start: at, query } : null;
}

/**
 * Keep tracked mentions in sync with the edited content: mentions selected
 * from the listbox stay, and any known candidate name that appears as a
 * `@name` token is picked up too (covers paste / manual typing).
 */
export function ensureMentionTracking(
	content: string,
	tracked: TrackedMention[],
	candidatesList: MentionCandidate[]
): TrackedMention[] {
	const map = new Map(tracked.map((m) => [m.name, m]));
	for (const candidate of candidatesList) {
		if (map.has(candidate.name)) continue;
		if (mentionTokenRegex(candidate.name).test(content)) {
			map.set(candidate.name, { name: candidate.name, npub: candidate.npub });
		}
	}
	return [...map.values()];
}

/** Filter candidates for the active `@query` (name or npub substring), top 8. */
export function filterMentionCandidates(
	candidates: MentionCandidate[],
	query: string
): MentionCandidate[] {
	const normalized = query.toLowerCase().trim();
	return (
		normalized
			? candidates.filter(
					(c) =>
						c.name.toLowerCase().includes(normalized) || c.npub.toLowerCase().includes(normalized)
				)
			: candidates
	).slice(0, 8);
}
