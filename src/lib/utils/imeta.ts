/**
 * NIP-92 `imeta` media parsing + notification media extraction.
 *
 * `imeta` tags carry rich per-attachment metadata (thumb, blurhash, dimensions,
 * mime, sha) that clients like YakiHonne emit alongside image links. Parsing it
 * lets us paint instant blurhash placeholders, load thumbnails first, and avoid
 * layout shift by reserving the real aspect-ratio up front.
 */
import type { Event } from '$lib/nostr/types';

export interface ImageMeta {
	/** Full-resolution source URL. */
	url: string;
	/** Smaller preview URL (NIP-92 `thumb`). */
	thumb?: string;
	/** BlurHash string (NIP-92 `blurhash` / `bh`). */
	blurhash?: string;
	/** Pixel dimensions (NIP-92 `dim`). */
	dim?: { w: number; h: number };
	/** MIME type (NIP-92 `m`). */
	mime?: string;
	/** sha256 (NIP-92 `ox` / `x`). */
	sha?: string;
	/** Byte size (NIP-92 `size`). */
	size?: number;
	/** alt text (NIP-92 `alt`). */
	alt?: string;
	/** Detected kind. */
	kind: 'image' | 'video' | 'gif';
	/** True when the attachment is animated (gif / video). */
	animated: boolean;
}

const URL_RE = /https?:\/\/[^\s<>()]+/giu;
const IMG_EXT_RE = /\.(?:apng|avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i;
const VID_EXT_RE = /\.(?:m3u8|m4v|mov|mp4|webm)(?:[?#].*)?$/i;
const IMG_FORMAT_RE = /(?:[?&](?:ext|fm|format)=)(?:apng|avif|gif|jpe?g|png|webp)\b/i;

/** Trailing punctuation that often clings to URLs pasted in prose. */
function splitTrailingPunctuation(value: string): string {
	const match = value.match(/^(.+?)([.,!?;:)]+)?$/);
	return match?.[1] ?? value;
}

function isImageish(url: string): boolean {
	return IMG_EXT_RE.test(url) || IMG_FORMAT_RE.test(url);
}

function isVideoish(url: string): boolean {
	return VID_EXT_RE.test(url);
}

function isGif(url: string, mime?: string): boolean {
	return mime === 'image/gif' || /\.gif(?:[?#].*)?$/i.test(url);
}

function classify(url: string, mime?: string): ImageMeta['kind'] {
	if (isVideoish(url) || mime?.startsWith('video/')) return 'video';
	if (isGif(url, mime)) return 'gif';
	return 'image';
}

function isMediaUrl(url: string, meta?: Partial<ImageMeta>): boolean {
	if (meta?.mime) return /^(image|video)\//.test(meta.mime);
	return isImageish(url) || isVideoish(url);
}

/**
 * Parse every `imeta` tag into a url → metadata map. Multiple `imeta` tags are
 * supported (one per attachment), matching NIP-92.
 */
export function parseImeta(tags: string[][]): Map<string, ImageMeta> {
	const map = new Map<string, ImageMeta>();
	for (const tag of tags) {
		if (tag[0] !== 'imeta') continue;
		let url = '';
		const meta: Partial<ImageMeta> = {};

		for (let i = 1; i < tag.length; i++) {
			const segment = tag[i];
			const space = segment.indexOf(' ');
			if (space <= 0) continue;
			const key = segment.slice(0, space);
			const value = segment.slice(space + 1);
			switch (key) {
				case 'url':
					url = value;
					break;
				case 'thumb':
					meta.thumb = value;
					break;
				case 'blurhash':
				case 'bh':
					meta.blurhash = value;
					break;
				case 'dim': {
					const match = value.match(/^(\d+)x(\d+)$/);
					if (match) meta.dim = { w: Number(match[1]), h: Number(match[2]) };
					break;
				}
				case 'm':
					meta.mime = value;
					break;
				case 'ox':
				case 'x':
					meta.sha = value;
					break;
				case 'size': {
					const n = Number(value);
					if (Number.isFinite(n)) meta.size = n;
					break;
				}
				case 'alt':
					meta.alt = value;
					break;
			}
		}

		if (!url) continue;
		const kind = classify(url, meta.mime);
		map.set(url, { url, kind, animated: kind !== 'image', ...meta });
	}
	return map;
}

/**
 * Extract renderable media from an event: imeta-described attachments first
 * (richest metadata), then any remaining image/video URLs found in the content
 * (covers giphy links etc. that have no imeta). De-duplicated by URL.
 */
export function extractNotificationMedia(ev: Pick<Event, 'content' | 'tags'>): ImageMeta[] {
	const imeta = parseImeta(ev.tags);
	const seen = new Set<string>();
	const out: ImageMeta[] = [];

	for (const meta of imeta.values()) {
		if (!isMediaUrl(meta.url, meta)) continue;
		seen.add(meta.url);
		out.push(meta);
	}

	for (const match of ev.content.matchAll(URL_RE)) {
		const core = splitTrailingPunctuation(match[0]);
		if (seen.has(core) || imeta.has(core)) continue;
		if (!isMediaUrl(core)) continue;
		seen.add(core);
		const kind = classify(core);
		out.push({ url: core, kind, animated: kind !== 'image' });
	}

	return out.slice(0, 9);
}

/**
 * Remove every media URL referenced by imeta or content from a string, then
 * collapse whitespace. Used to turn `"❤️ https://x.png \n https://y.gif"` into
 * `"❤️"` for clean notification previews.
 */
export function stripMediaUrls(content: string, urls: string[]): string {
	let out = content;
	for (const url of urls) out = out.split(url).join('');
	return out
		.replace(/\u00a0/g, ' ')
		.replace(/[ \t]+/g, ' ')
		.replace(/\n[ \t]+/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/** Convenience: clean prose preview with all attachment URLs stripped. */
export function cleanNotificationPreview(ev: Pick<Event, 'content' | 'tags'>): string {
	const urls = extractNotificationMedia(ev).map((media) => media.url);
	return stripMediaUrls(ev.content, urls);
}
