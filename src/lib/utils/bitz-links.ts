/**
 * Published bitz deep link / share reference (plan PUB-014, §S-015).
 *
 * "Add published video deep link/share reference — portable Nostr
 * event/address link." Every share target is portable across clients:
 *
 *   • `nostr:nevent1…` — the NIP-19/NIP-21 entity other Nostr clients open
 *     natively (with relays + author hints when known).
 *   • `https://<origin>/note/<nevent|hex>` — a web link any browser opens;
 *     BitOS resolves it through the note route into the Bitz player.
 *   • `#reel=<hex>` — the in-app deep link the Bitz route itself consumes
 *     (already used by the post-success "View in Bitz" toast, PUB-013).
 *
 * Pure string/URL logic only — no DOM/browser APIs beyond origin injection —
 * so it is fully unit-testable in the server project.
 */
import { neventEncode } from 'nostr-tools/nip19';

/** Relay hints embedded in shared nevents so foreign clients can resolve the
 *  event without knowing the user's relay set (bounded — NIP-19 payloads grow
 *  fast and some clients truncate very long bech32 strings). */
export const MAX_SHARE_RELAY_HINTS = 4;

export interface DeepLinkInput {
	/** 32-byte hex event id of the published bitz. */
	eventId: string;
	/** Author pubkey hint (improves resolution in foreign clients). */
	author?: string;
	/** Best-effort relay URLs the event was published to. */
	relays?: string[];
}

/** `nostr:nevent1…` — the canonical cross-client Nostr share entity. */
export function shareEntity(input: DeepLinkInput): string {
	const relays = [...new Set(input.relays ?? [])].slice(0, MAX_SHARE_RELAY_HINTS);
	const nevent = neventEncode({
		id: input.eventId,
		...(input.author ? { author: input.author } : {}),
		...(relays.length ? { relays } : {})
	});
	return `nostr:${nevent}`;
}

/** Web link any browser opens: the BitOS note route accepts nevent paths. */
export function shareWebLink(input: DeepLinkInput, origin: string): string {
	return `${origin.replace(/\/+$/, '')}/note/${encodeURIComponent(
		shareEntity(input).replace(/^nostr:/, '')
	)}`;
}

/** In-app player deep link consumed by the Bitz route hash handler. */
export function bitzHashLink(eventId: string): string {
	return `#reel=${eventId}`;
}

/** Web Share API payload for published bitz — text carries the nostr entity
 *  so Nostr-native share targets surface the event, url carries the web link. */
export function sharePayload(
	input: DeepLinkInput,
	origin: string
): {
	title: string;
	text: string;
	url: string;
} {
	return {
		title: 'Bitz on BitOS',
		text: shareEntity(input),
		url: shareWebLink(input, origin)
	};
}

/**
 * Default `t` tags for a published bitz (user question: "can use #bitz?").
 *
 * YES — and the composer already does it implicitly: any `#bitz` typed in the
 * caption becomes a normalized `t` tag via extractHashtagTags. This helper
 * goes one step further for *discoverability*: bitz published WITHOUT any
 * hashtag still get the community tag so hashtag feeds (D-006) and muted-tag
 * filters (§13.3) treat bitz as a first-class topic. Only added when the
 * caption carries no hashtag at all — an explicit tag set is never overridden.
 */
export const BITZ_DEFAULT_TAG = 'bitz';

export function defaultBitzTags(hashtags: string[][]): string[][] {
	if (hashtags.some((tag) => tag[0] === 't' && tag[1] === BITZ_DEFAULT_TAG)) return hashtags;
	return [...hashtags, ['t', BITZ_DEFAULT_TAG]];
}
