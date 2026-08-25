/**
 * Nostr emoji packs — kind 30030 (NIP-30 custom emoji collections).
 *
 * A pack is an addressable event (d tag) with a title/name/cover and any
 * number of `["emoji", <shortcode>, <https url>]` tags. Parsers are tolerant:
 * junk tags, non-https urls and duplicates are dropped; a pack needs at least
 * one valid emoji to count. Pure data — the studio turns picks into image
 * layers (custom emojis are pictures, not glyphs).
 */

export interface NostrEmoji {
	/** Shortcode (no colons) — label + dedupe key. */
	name: string;
	/** Remote image URL (png/gif/webp/jpeg). */
	url: string;
}

export interface NostrEmojiPack {
	/** Event id — install/cache key + dedupe. */
	eventId: string;
	pubkey: string;
	/** Addressable `d` tag. */
	d: string;
	title: string;
	/** Cover image url (optional). */
	cover: string | null;
	emojis: NostrEmoji[];
	/** Event created_at (seconds) — pagination cursor for Load more. Not
	 *  persisted in the install cache (only live discovery needs it). */
	createdAt?: number;
}

const HTTP_RE = /^https:\/\/\S+$/i;

function tags(event: { tags?: string[][] }): string[][] {
	return Array.isArray(event.tags) ? event.tags : [];
}

function firstTag(event: { tags?: string[][] }, name: string): string | null {
	for (const t of tags(event)) {
		if (t?.[0] === name && typeof t[1] === 'string' && t[1].trim()) return t[1].trim();
	}
	return null;
}

/** Tolerant kind-30030 parser — null when the event isn't a usable pack. */
export function parseEmojiPack(event: {
	id?: string;
	pubkey?: string;
	kind?: number;
	tags?: string[][];
}): NostrEmojiPack | null {
	if (event.kind !== 30030) return null;
	const eventId = typeof event.id === 'string' ? event.id : '';
	const pubkey = typeof event.pubkey === 'string' ? event.pubkey : '';
	if (!/^[0-9a-f]{64}$/i.test(eventId) || !/^[0-9a-f]{64}$/i.test(pubkey)) return null;

	const seen = new Set<string>();
	const emojis: NostrEmoji[] = [];
	for (const t of tags(event)) {
		if (t?.[0] !== 'emoji' || t.length < 3) continue;
		const name = typeof t[1] === 'string' ? t[1].trim().replace(/^:|:$/g, '').slice(0, 64) : '';
		const url = typeof t[2] === 'string' ? t[2].trim().slice(0, 512) : '';
		if (!name || !HTTP_RE.test(url)) continue;
		const key = name.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		emojis.push({ name, url });
	}
	if (!emojis.length) return null;

	const d = firstTag(event, 'd') ?? '';
	const title =
		firstTag(event, 'title') ?? firstTag(event, 'name') ?? (d ? d : `Pack ${eventId.slice(0, 6)}`);
	const coverRaw = firstTag(event, 'image') ?? firstTag(event, 'picture');
	const cover = coverRaw && HTTP_RE.test(coverRaw) ? coverRaw : (emojis[0]?.url ?? null);
	const createdAt =
		'created_at' in event && Number.isFinite(Number((event as { created_at?: unknown }).created_at))
			? Number((event as { created_at?: unknown }).created_at)
			: undefined;
	return {
		eventId,
		pubkey,
		d,
		title: title.slice(0, 80),
		cover,
		emojis,
		...(createdAt !== undefined ? { createdAt } : {})
	};
}

/** Newest first; own packs sink (like rankSharedSounds — discovery first). */
export function rankEmojiPacks(packs: NostrEmojiPack[], ownPubkey = ''): NostrEmojiPack[] {
	return [...packs].sort((a, b) => {
		const aOwn = a.pubkey === ownPubkey ? 1 : 0;
		const bOwn = b.pubkey === ownPubkey ? 1 : 0;
		if (aOwn !== bOwn) return aOwn - bOwn;
		return b.emojis.length - a.emojis.length;
	});
}

/** Wire form for the local install cache (localStorage). */
export interface WireEmojiPack {
	e: string; // eventId
	p: string; // pubkey
	d?: string;
	t: string; // title
	c?: string; // cover
	m: [string, string][]; // [name, url]
}

export function encodeEmojiPack(pack: NostrEmojiPack): WireEmojiPack {
	const w: WireEmojiPack = {
		e: pack.eventId,
		p: pack.pubkey,
		t: pack.title,
		m: pack.emojis.map((em) => [em.name, em.url])
	};
	if (pack.d) w.d = pack.d;
	if (pack.cover) w.c = pack.cover;
	return w;
}

export function decodeEmojiPack(raw: unknown): NostrEmojiPack | null {
	if (!raw || typeof raw !== 'object') return null;
	const w = raw as Partial<WireEmojiPack>;
	if (typeof w.e !== 'string' || typeof w.p !== 'string') return null;
	const emojis: NostrEmoji[] = Array.isArray(w.m)
		? w.m
				.filter(
					(pair): pair is [string, string] =>
						Array.isArray(pair) &&
						typeof pair[0] === 'string' &&
						typeof pair[1] === 'string' &&
						!!pair[0].trim() &&
						HTTP_RE.test(pair[1])
				)
				.map(([name, url]) => ({ name: name.slice(0, 64), url: url.slice(0, 512) }))
		: [];
	if (!emojis.length) return null;
	return {
		eventId: w.e,
		pubkey: w.p,
		d: typeof w.d === 'string' ? w.d : '',
		title: typeof w.t === 'string' && w.t.trim() ? w.t.slice(0, 80) : `Pack ${w.e.slice(0, 6)}`,
		cover: typeof w.c === 'string' && HTTP_RE.test(w.c) ? w.c : null,
		emojis
	};
}
