/**
 * Emoji-pack builder — the pure model behind the studio's "My pack" flow
 * (mass production: curate many emojis/stickers/GIFs → export once).
 *
 * A built pack publishes as a NIP-30 kind-30030 addressable event — the exact
 * shape `emoji-packs.ts` parses — and round-trips through a portable JSON
 * file (`com.bitos.emoji-pack`) for offline sharing. Pure data only: relay
 * calls, signing and downloads live in the hub dialog component.
 */

export interface PackEntry {
	/** Shortcode (no colons) — label + dedupe key. */
	name: string;
	/** Remote https image URL (png/gif/webp/jpeg/svg). */
	url: string;
}

export const MAX_PACK_EMOJIS = 60;
export const MAX_PACK_TITLE = 80;
export const MAX_SHORTCODE_LEN = 64;
export const PACK_JSON_SCHEMA = 'com.bitos.emoji-pack';
export const PACK_JSON_VERSION = 1;

const HTTP_RE = /^https:\/\/\S+$/i;

/** Shortcode hygiene: lowercase, underscore-separated, [a-z0-9_], ≤64 chars. */
export function normalizeShortcode(raw: string): string {
	const code = raw
		.trim()
		.replace(/^:+|:+$/g, '')
		.toLowerCase()
		.replace(/[\s-]+/g, '_')
		.replace(/[^a-z0-9_]/g, '')
		.replace(/_{2,}/g, '_')
		.slice(0, MAX_SHORTCODE_LEN)
		.replace(/^_+|_+$/g, '');
	return code;
}

/** Keep only usable entries: normalized name + https url, deduped, capped. */
export function sanitizePackEntries(entries: PackEntry[]): PackEntry[] {
	const seen = new Set<string>();
	const out: PackEntry[] = [];
	for (const entry of entries) {
		if (out.length >= MAX_PACK_EMOJIS) break;
		const name = normalizeShortcode(entry?.name ?? '');
		const url = typeof entry?.url === 'string' ? entry.url.trim().slice(0, 512) : '';
		if (!name || !HTTP_RE.test(url)) continue;
		if (seen.has(name)) continue;
		seen.add(name);
		out.push({ name, url });
	}
	return out;
}

/** Addressable `d` tag from the title: lowercase slug, ≤32 chars, stable. */
export function slugifyPackD(title: string): string {
	const slug = normalizeShortcode(title)
		.replace(/_/g, '-')
		.slice(0, 32)
		.replace(/^-+|-+$/g, '');
	return slug || 'pack';
}

/** Pack title hygiene: single-spaced, ≤80 chars. */
export function packTitle(raw: string): string {
	return raw.trim().replace(/\s+/g, ' ').slice(0, MAX_PACK_TITLE);
}

export interface PackEventInput {
	title: string;
	emojis: PackEntry[];
	/** Cover image; falls back to the first emoji's URL. */
	cover?: string | null;
	/** App/client tag rows to prepend (see `clientTag()`). */
	clientTag?: string[][];
}

/** d + tags for a kind-30030 event (content stays empty — NIP-30 is tags-only). */
export function packEventParts(input: PackEventInput): {
	d: string;
	title: string;
	tags: string[][];
} {
	const emojis = sanitizePackEntries(input.emojis);
	const title = packTitle(input.title) || 'My pack';
	const cover = typeof input.cover === 'string' ? input.cover.trim() : '';
	const coverUrl = HTTP_RE.test(cover) ? cover.slice(0, 512) : (emojis[0]?.url ?? '');
	const tags: string[][] = [
		...(input.clientTag ?? []),
		['d', slugifyPackD(title)],
		['title', title]
	];
	if (coverUrl) tags.push(['image', coverUrl]);
	for (const emoji of emojis) tags.push(['emoji', emoji.name, emoji.url]);
	return { d: slugifyPackD(title), title, tags };
}

export interface PortablePack {
	schema: string;
	version: number;
	title: string;
	cover?: string;
	emojis: [string, string][];
}

/** Portable JSON export — same wire pairs as the install cache. */
export function packToJson(input: {
	title: string;
	emojis: PackEntry[];
	cover?: string | null;
}): string {
	const emojis = sanitizePackEntries(input.emojis);
	const title = packTitle(input.title) || 'My pack';
	const cover = typeof input.cover === 'string' ? input.cover.trim() : '';
	const pack: PortablePack = {
		schema: PACK_JSON_SCHEMA,
		version: PACK_JSON_VERSION,
		title,
		cover: HTTP_RE.test(cover) ? cover.slice(0, 512) : (emojis[0]?.url ?? undefined),
		emojis: emojis.map((e) => [e.name, e.url])
	};
	return JSON.stringify(pack, null, 2);
}

/** Tolerant import: accepts `[name, url]` pairs or `{name, url}` objects. */
export function parsePackJson(
	raw: unknown
): { title: string; emojis: PackEntry[]; cover: string | null } | null {
	if (!raw || typeof raw !== 'object') return null;
	const p = raw as Partial<PortablePack>;
	if (p.schema !== PACK_JSON_SCHEMA) return null;
	const entries: PackEntry[] = Array.isArray(p.emojis)
		? p.emojis.map((item) => {
				if (Array.isArray(item)) return { name: String(item[0] ?? ''), url: String(item[1] ?? '') };
				if (item && typeof item === 'object') {
					const o = item as Partial<PackEntry>;
					return { name: String(o.name ?? ''), url: String(o.url ?? '') };
				}
				return { name: '', url: '' };
			})
		: [];
	const emojis = sanitizePackEntries(entries);
	if (!emojis.length) return null;
	return {
		title: typeof p.title === 'string' && p.title.trim() ? packTitle(p.title) : 'My pack',
		emojis,
		cover: typeof p.cover === 'string' && HTTP_RE.test(p.cover) ? p.cover : null
	};
}
