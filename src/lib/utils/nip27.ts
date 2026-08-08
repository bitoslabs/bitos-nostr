/**
 * NIP-27 mention helpers.
 *
 * NIP-27 says an inline mention is a `nostr:` bech32 entity in the content
 * (e.g. `nostr:npub1…`, `nostr:nprofile1…`, `nostr:nevent1…`) that is backed by
 * a matching `p` / `e` tag on the event. This module scans note content and
 * returns the pubkeys / event-ids that should be tagged, so publishing code can
 * derive NIP-27 tags from the actual content instead of tracking mentions by
 * hand (which drifts when the user edits the text).
 */
import { decode } from 'nostr-tools/nip19';

/** Matches inline `nostr:` entities (npub / nprofile / note / nevent / naddr). */
const ENTITY_RE = /nostr:(npub1|nprofile1|note1|nevent1|naddr1)[a-z0-9]+/giu;

export interface NostrEntities {
	/** Hex pubkeys referenced by npub / nprofile mentions (for `p` tags). */
	pubkeys: string[];
	/** Hex event ids referenced by note / nevent mentions (for `e` tags). */
	noteIds: string[];
}

/**
 * Extract every inline `nostr:` mention from a note's content, decoding each to
 * its hex pubkey / event id. Results are de-duplicated and order-preserved.
 */
export function extractMentionEntities(content: string): NostrEntities {
	const pubkeys = new Set<string>();
	const noteIds = new Set<string>();

	for (const match of content.matchAll(ENTITY_RE)) {
		const raw = match[0].slice('nostr:'.length);
		let decoded: ReturnType<typeof decode>;
		try {
			decoded = decode(raw);
		} catch {
			continue;
		}
		switch (decoded.type) {
			case 'npub':
				pubkeys.add(decoded.data as string);
				break;
			case 'nprofile':
				pubkeys.add((decoded.data as { pubkey: string }).pubkey);
				break;
			case 'note':
				noteIds.add(decoded.data as string);
				break;
			case 'nevent':
				noteIds.add((decoded.data as { id: string }).id);
				break;
			// naddr (parameterized/replaceable) intentionally skipped — it would
			// need an `a` tag, not a `p` / `e` tag.
		}
	}

	return { pubkeys: [...pubkeys], noteIds: [...noteIds] };
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function rewriteMentions<T extends { name: string; npub: string }>(
	content: string,
	tracked: T[]
): string {
	let out = content;
	for (const item of tracked) {
		const target = `@${item.name}`;
		if (!target) continue;
		const regex = new RegExp(`${escapeRegExp(target)}(?=$|\\s|[^\\p{L}\\p{N}_-])`, 'gu');
		out = out.replace(regex, `nostr:${item.npub}`);
	}
	return out;
}
