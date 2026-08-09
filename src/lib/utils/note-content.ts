/**
 * Shared note-content tokenizer.
 *
 * Splits a kind-1 note body into renderable tokens (text / url / nostr mention /
 * hashtag) so both the main feed card and threaded comments render links,
 * mentions and tags consistently. Extracted verbatim from PostCard so the two
 * surfaces never drift apart.
 */

export type ContentToken =
	| { type: 'text'; value: string }
	| { type: 'url'; value: string; host: string }
	| { type: 'nostr'; value: string }
	| { type: 'hashtag'; value: string; tag: string };

/** Matches bare URLs, `nostr:` entities, and #hashtags inside note content. */
const contentPattern =
	/(https?:\/\/[^\s<>()]+|nostr:(?:note1|nevent1|npub1|nprofile1|naddr1)[a-z0-9]+|#[\p{L}\p{N}_-]{2,60})/giu;

/** Peel trailing punctuation (e.g. a `.` or `)`) off a matched URL/entity. */
export function splitTrailingPunctuation(value: string): { core: string; suffix: string } {
	const match = value.match(/^(.+?)([.,!?;:)]+)?$/);
	return {
		core: match?.[1] ?? value,
		suffix: match?.[2] ?? ''
	};
}

/** Human-readable hostname for a URL, falling back to the raw string. */
export function hostFromUrl(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return url;
	}
}

export function parseContent(content: string): ContentToken[] {
	const tokens: ContentToken[] = [];
	let lastIndex = 0;

	for (const match of content.matchAll(contentPattern)) {
		const value = match[0];
		const index = match.index ?? 0;
		if (index > lastIndex) tokens.push({ type: 'text', value: content.slice(lastIndex, index) });

		if (value.startsWith('#')) {
			tokens.push({ type: 'hashtag', value, tag: value.slice(1).toLowerCase() });
		} else if (value.toLowerCase().startsWith('nostr:')) {
			const { core, suffix } = splitTrailingPunctuation(value);
			tokens.push({ type: 'nostr', value: core });
			if (suffix) tokens.push({ type: 'text', value: suffix });
		} else {
			const { core, suffix } = splitTrailingPunctuation(value);
			tokens.push({ type: 'url', value: core, host: hostFromUrl(core) });
			if (suffix) tokens.push({ type: 'text', value: suffix });
		}

		lastIndex = index + value.length;
	}

	if (lastIndex < content.length) tokens.push({ type: 'text', value: content.slice(lastIndex) });
	return tokens;
}
