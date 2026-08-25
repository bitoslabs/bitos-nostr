/**
 * BitzEventCodec — NIP-71 event parsing/building isolated in one place
 * (plan §6.2 / ADR-002) because NIP-71 is still a draft/optional NIP.
 *
 * `parse` accepts every reel-compatible event shape we read today:
 *   - kind 20     NIP-68 picture (image reels)
 *   - kind 21     NIP-71 regular video
 *   - kind 22     NIP-71 short-form video (our publish target)
 *   - kind 34235  NIP-71 addressable regular video (kind:pubkey:d versions)
 *   - kind 34236  NIP-71 addressable short video
 *   - kind 1      legacy video-bearing notes (URL-only compatibility)
 *
 * Media extraction order follows ADR-002: `imeta` is the authoritative media
 * source; bare content URLs are the legacy fallback (kind-1 notes, older
 * clients). `fallback` mirrors and extra same-type URLs become the ordered
 * fallback chain consumed by MediaPlayer (F-017).
 */
import { NOSTR_KINDS, addressKey, type Event } from './types';

/** Media kinds that carry reel-renderable video. */
export const BITZ_VIDEO_KINDS: readonly number[] = [
	NOSTR_KINDS.VIDEO,
	NOSTR_KINDS.SHORT_VIDEO,
	NOSTR_KINDS.ADDRESSABLE_VIDEO,
	NOSTR_KINDS.ADDRESSABLE_SHORT_VIDEO
];

/** Every kind the codec can parse into a reel candidate. */
export const BITZ_MEDIA_KINDS: readonly number[] = [NOSTR_KINDS.PICTURE, ...BITZ_VIDEO_KINDS];

/** One alternate rendition of the same media (ADR-002 / F-019).
 *
 * NIP-71 encoders emit each variant as an imeta `fallbackrendition`
 * segment prefixed `variant:` — `url m x dim duration bitrate` fields
 * after the prefix mirror the primary's segment fields. */
export interface BitzRendition {
	url: string;
	/** Pixels on the long edge; 0 when the variant carries no dims. */
	height: number;
	/** Bits per second when declared, else 0. */
	bitrate: number;
}

export interface BitzMedia {
	/** Primary media URL ('' when the event carries no renderable media). */
	url: string;
	/** Alternate renditions parsed from imeta `fallbackrendition` variants
	 * (ADR-002), ordered high-to-low quality. Key present only when at
	 * least one variant parsed — absence means no ladder, like hash/dim. */
	renditions?: BitzRendition[];
	type: 'video' | 'image';
	/** Ordered fallback URLs (imeta `fallback` mirrors + extra same-type URLs). */
	fallbacks: string[];
	/** Stable coordinate for addressable events (34235/34236), '' otherwise. */
	address: string;
	/** SHA-256 blob hash from the imeta `x` segment, when present. */
	hash?: string;
	/** Dimensions `WxH` from the imeta `dim` segment, when present. */
	dim?: string;
	/** Duration in seconds from the imeta `duration` segment, when present. */
	duration?: number;
}

type ParseableEvent = Pick<Event, 'kind' | 'content' | 'tags'> & {
	id?: string;
	pubkey?: string;
};

const URL_RE = /https?:\/\/[^\s<>()]+/gi;
const IMAGE_EXT_RE = /\.(?:apng|avif|gif|jpe?g|png|webp)$/i;
const VIDEO_EXT_RE = /\.(?:m3u8|m4v|mov|mp4|webm)$/i;
const VIDEO_FORMAT_RE = /(?:[?&](?:ext|fm|format)=)(?:m3u8|m4v|mov|mp4|webm)\b/i;
const VIDEO_PATH_RE = /(?:^|\/)(?:video|videos|reel|reels)(?:\/|$|:|-|_)/i;
/** SHA-256 blob hashes are 64-char lowercase hex (plan §6.4). */
const HASH_RE = /^[0-9a-f]{64}$/;
/** Dimensions are `WxH` with non-zero positive integers. */
const DIM_RE = /^[1-9]\d{0,9}x[1-9]\d{0,9}$/;

/** Trailing punctuation that often clings to URLs pasted in prose. */
export function splitTrailingPunctuation(raw: string) {
	let core = raw;
	while (/[),.!?;:\]]$/.test(core)) core = core.slice(0, -1);
	return core;
}

function looksLikeVideoUrl(url: string) {
	try {
		const parsed = new URL(url);
		const pathname = decodeURIComponent(parsed.pathname);
		return (
			VIDEO_EXT_RE.test(pathname) ||
			VIDEO_FORMAT_RE.test(parsed.search) ||
			VIDEO_PATH_RE.test(pathname) ||
			parsed.searchParams.get('resource_type') === 'video'
		);
	} catch {
		return VIDEO_EXT_RE.test(url);
	}
}

function imetaValue(tag: string[], key: string) {
	const line = tag.find((segment) => segment.startsWith(`${key} `));
	return line?.slice(key.length + 1).trim();
}

function isVideoImeta(tag: string[]) {
	const url = imetaValue(tag, 'url');
	if (!url) return false;
	const mime = imetaValue(tag, 'm');
	// NIP-92 metadata is authoritative: an explicit image/* MIME must never
	// classify as video even when the URL path looks video-ish (some CDNs
	// serve /upload/ paths for images).
	return mime ? mime.startsWith('video/') : looksLikeVideoUrl(url);
}

function isImageImeta(tag: string[]) {
	const url = imetaValue(tag, 'url');
	if (!url) return false;
	const mime = imetaValue(tag, 'm');
	return mime ? mime.startsWith('image/') : IMAGE_EXT_RE.test(url);
}

function contentUrls(content: string) {
	const urls: string[] = [];
	for (const match of content.matchAll(URL_RE)) {
		const core = splitTrailingPunctuation(match[0]);
		if (core && !urls.includes(core)) urls.push(core);
	}
	return urls;
}

function imetaValues(tag: string[], key: string) {
	const values: string[] = [];
	for (const segment of tag) {
		if (segment.startsWith(`${key} `)) {
			const value = segment.slice(key.length + 1).trim();
			if (value) values.push(value);
		}
	}
	return values;
}

/** Parse one `fallbackrendition variant:<url> <fields…>` segment into a
 * rendition. Returns null for anything without a usable URL. */
function parseRenditionVariant(raw: string): BitzRendition | null {
	const fields = raw.split(/\s+/).filter(Boolean);
	const url = fields.find((f) => /^https?:\/\//.test(f));
	if (!url) return null;
	let height = 0;
	let bitrate = 0;
	for (const field of fields) {
		const dim = field.match(/^(\d+)x(\d+)$/);
		if (dim) height = Math.max(Number(dim[1]), Number(dim[2]));
		const rate = field.match(/^(\d+(?:\.\d+)?)(k|bps)$/i);
		if (rate) bitrate = Math.round(Number(rate[1]) * (rate[2].toLowerCase() === 'k' ? 1000 : 1));
	}
	return { url, height, bitrate };
}

/** All rendition variants on an imeta tag, high-quality first, deduped. */
function renditionsFromImeta(tag: string[], primary: string): BitzRendition[] {
	const out: BitzRendition[] = [];
	for (const raw of imetaValues(tag, 'fallbackrendition')) {
		const body = raw.startsWith('variant:') ? raw.slice('variant:'.length) : raw;
		const rendition = parseRenditionVariant(body);
		// Same-URL variants are mirrors, not renditions — the fallback chain owns them.
		if (!rendition || rendition.url === primary) continue;
		if (out.some((r) => r.url === rendition.url)) continue;
		out.push(rendition);
	}
	return out.sort((a, b) => b.height - a.height || b.bitrate - a.bitrate);
}

function mediaFromImeta(event: ParseableEvent): BitzMedia | null {
	for (const tag of event.tags) {
		if (tag[0] !== 'imeta') continue;
		if (isVideoImeta(tag)) {
			const url = imetaValue(tag, 'url')!;
			// NIP-92 allows several `fallback` mirrors; keep order, drop dupes.
			const fallbacks = imetaValues(tag, 'fallback').filter(
				(core, index, all) => core !== url && all.indexOf(core) === index
			);
			return withOptionalMeta(tag, {
				url,
				type: 'video',
				fallbacks,
				...(renditionsFromImeta(tag, url).length
					? { renditions: renditionsFromImeta(tag, url) }
					: {}),
				address: ''
			});
		}
		if (isImageImeta(tag)) {
			const url = imetaValue(tag, 'url')!;
			return withOptionalMeta(tag, {
				url,
				type: 'image',
				fallbacks: [],
				address: ''
			});
		}
	}
	return null;
}

/** Attach validated optional imeta metadata (x/dim/duration) to a descriptor. */
function withOptionalMeta(tag: string[], media: BitzMedia): BitzMedia {
	const hash = imetaValue(tag, 'x');
	if (hash && HASH_RE.test(hash)) media.hash = hash;
	const dim = imetaValue(tag, 'dim');
	if (dim && DIM_RE.test(dim)) media.dim = dim;
	const duration = Number(imetaValue(tag, 'duration'));
	if (Number.isFinite(duration) && duration > 0) media.duration = duration;
	return media;
}

function videoFromContent(content: string): BitzMedia | null {
	const videoUrls = contentUrls(content).filter(looksLikeVideoUrl);
	if (!videoUrls.length) return null;
	const [url, ...fallbacks] = videoUrls;
	// Bare content URLs are same-media mirrors (READ-003), never renditions —
	// quality metadata only exists on imeta variants, so no renditions key.
	return { url, type: 'video', fallbacks, address: '' };
}

/**
 * Parse any reel-compatible event into its media descriptor. Returns null for
 * events with no renderable media (pure text, audio-only, etc.).
 */
export function parseBitz(event: ParseableEvent): BitzMedia | null {
	const address = event.id && event.pubkey ? addressKey(event.kind, event.pubkey, event.tags) : '';

	if (event.kind === NOSTR_KINDS.PICTURE) {
		const urls = contentUrls(event.content).filter((core) => IMAGE_EXT_RE.test(core));
		const primary = mediaFromImeta(event);
		const url = primary?.type === 'image' ? primary.url : urls[0];
		if (!url) return null;
		// Multi-photo notes: extra content image URLs act as image fallbacks.
		const fallbacks = [...new Set(urls)].filter((core) => core !== url);
		// Pictures carry no rendition ladder (F-019 is video-only).
		return { url, type: 'image', fallbacks, address };
	}

	if (BITZ_VIDEO_KINDS.includes(event.kind) || event.kind === NOSTR_KINDS.TEXT_NOTE) {
		const fromTags = mediaFromImeta(event);
		if (fromTags?.type === 'video') return { ...fromTags, address };
		// ADR-002: imeta is authoritative. When a video-kind event declares
		// imeta media that is NOT video (e.g. an image CDN URL that merely
		// looks video-ish), it must not become a reel via the content fallback.
		if (event.tags.some((tag) => tag[0] === 'imeta')) return null;
		const fromContent = videoFromContent(event.content);
		if (fromContent) return { ...fromContent, address };
		return null;
	}
	return null;
}

/**
 * Build the unsigned NIP-71 kind-22 event body (PUB-002). `imeta` carries the
 * authoritative media metadata; the primary URL is duplicated in content for
 * NIP-92/legacy-client compatibility (ADR-002).
 */
export function buildKind22(params: {
	pubkey: string;
	caption: string;
	media: {
		url: string;
		mimeType?: string;
		bytes?: number;
		dim?: string;
		thumb?: string;
		fallback?: string;
		/** SHA-256 blob hash (imeta `x`) — publish after verifying bytes. */
		hash?: string;
		/** Duration in seconds (NIP-71 `duration`, fractional allowed). */
		duration?: number;
		/** Average bitrate in bits per second (imeta `bitrate`). */
		bitrate?: number;
	};
	sensitive?: boolean;
	/** Extra tags (client tag, hashtags, NIP-27 mentions) merged ahead of imeta. */
	prefixTags?: string[][];
	created_at?: number;
}): { pubkey: string; kind: number; content: string; created_at: number; tags: string[][] } {
	const caption = params.caption.trim();
	const imeta = [`url ${params.media.url}`];
	if (params.media.mimeType) imeta.push(`m ${params.media.mimeType}`);
	if (params.media.bytes && params.media.bytes > 0) imeta.push(`size ${params.media.bytes}`);
	if (params.media.dim) imeta.push(`dim ${params.media.dim}`);
	if (params.media.thumb) imeta.push(`thumb ${params.media.thumb}`);
	if (params.media.fallback) imeta.push(`fallback ${params.media.fallback}`);
	if (params.media.hash) imeta.push(`x ${params.media.hash}`);
	const duration = params.media.duration;
	if (duration !== undefined && Number.isFinite(duration) && duration > 0) {
		imeta.push(`duration ${duration.toFixed(3)}`);
	}
	if (params.media.bitrate && params.media.bitrate > 0) {
		imeta.push(`bitrate ${Math.round(params.media.bitrate)}`);
	}
	const tags: string[][] = [...(params.prefixTags ?? [])];
	tags.push(['imeta', ...imeta]);
	if (params.sensitive) tags.push(['content-warning', 'Sensitive content']);
	return {
		pubkey: params.pubkey,
		kind: NOSTR_KINDS.SHORT_VIDEO,
		// ADR-002: caption + primary URL keeps legacy clients rendering the video.
		content: [caption, params.media.url].filter(Boolean).join('\n\n'),
		created_at: params.created_at ?? Math.floor(Date.now() / 1000),
		tags
	};
}

/** What `validateBitzMedia` found wrong with a publish candidate. */
export type BitzMediaValidationIssue =
	| { field: 'url'; reason: string }
	| { field: 'hash'; reason: string }
	| { field: 'duration'; reason: string }
	| { field: 'dim'; reason: string }
	| { field: 'fallback'; reason: string };

export interface BitzMediaConstraints {
	/** Hard cap on duration in seconds (plan: product limit, initially 60). */
	maxDurationSeconds?: number;
	/** Require https:// URLs (plan §6.4: HTTPS-only in production). */
	httpsOnly?: boolean;
}

/**
 * Pre-signing validation (plan §6.4 "Validation before signing"). Returns the
 * list of problems; an empty array means the candidate may be signed.
 * Malformed optional fields never pass through into the signed event.
 */
export function validateBitzMedia(
	media: {
		url: string;
		hash?: string;
		duration?: number;
		dim?: string;
		fallback?: string;
	},
	constraints: BitzMediaConstraints = {}
): BitzMediaValidationIssue[] {
	const issues: BitzMediaValidationIssue[] = [];
	const { maxDurationSeconds, httpsOnly } = constraints;
	let parsed: URL | null = null;
	try {
		parsed = new URL(media.url);
	} catch {
		// flagged below
	}
	if (!parsed) {
		issues.push({ field: 'url', reason: 'not a valid absolute URL' });
	} else if (httpsOnly && parsed.protocol !== 'https:') {
		issues.push({ field: 'url', reason: 'production URLs must be https' });
	}
	if (media.hash !== undefined && !HASH_RE.test(media.hash)) {
		issues.push({ field: 'hash', reason: 'must be 64-char lowercase hex' });
	}
	if (media.duration !== undefined) {
		if (!Number.isFinite(media.duration) || media.duration <= 0) {
			issues.push({ field: 'duration', reason: 'must be greater than zero' });
		} else if (maxDurationSeconds !== undefined && media.duration > maxDurationSeconds) {
			issues.push({ field: 'duration', reason: `exceeds the ${maxDurationSeconds}s limit` });
		}
	}
	if (media.dim !== undefined && !DIM_RE.test(media.dim)) {
		issues.push({ field: 'dim', reason: 'must be `WxH` with positive integers' });
	}
	if (media.fallback !== undefined) {
		if (!/^https?:\/\//.test(media.fallback)) {
			issues.push({ field: 'fallback', reason: 'not a valid absolute URL' });
		} else if (httpsOnly && !media.fallback.startsWith('https://')) {
			issues.push({ field: 'fallback', reason: 'production URLs must be https' });
		}
	}
	return issues;
}

// ---- Rendition selection (READ-002 / F-019) ---------------------------------

/** Pick the rendition closest to `targetHeight` without grossly exceeding
 * it — the classic "serve at-or-below display size" rule. Falls back to
 * the primary URL when no rendition fits. When the primary itself declares
 * `primaryHeight` and a smaller rendition better matches the target, prefer
 * the rendition (adaptive downscale saves bandwidth; upscale never helps). */
export function selectRendition(
	media: Pick<BitzMedia, 'url' | 'renditions'>,
	targetHeight: number,
	options: { primaryHeight?: number } = {}
): { url: string; isRendition: boolean; height: number } {
	const renditions = media.renditions;
	if (!renditions?.length)
		return { url: media.url, isRendition: false, height: options.primaryHeight ?? 0 };
	// Candidates that do not exceed the target by more than 25% (a 1080p
	// rendition on a 720p-class viewport wastes bytes; 25% headroom tolerates
	// DPR rounding and minor dim omissions).
	const cap = targetHeight * 1.25;
	const fitting = renditions.filter((r) => r.height > 0 && r.height <= cap);
	if (!fitting.length) {
		// Everything is bigger than the display — take the smallest available;
		// the browser downscales for free.
		const smallest = renditions.reduce((a, b) =>
			a.height && (!b.height || a.height <= b.height) ? a : b
		);
		return { url: smallest.url, isRendition: true, height: smallest.height };
	}
	const best = fitting.reduce((a, b) => (a.height >= b.height ? a : b));
	return { url: best.url, isRendition: true, height: best.height };
}

// ---- Addressable replacement selection (READ-004 / F-016, plan §12.1) ------

type AddressableLike = Pick<Event, 'kind' | 'tags'> & {
	id?: string;
	pubkey?: string;
	created_at?: number;
};

/**
 * Resolve addressable video events (34235/34236) to their newest version per
 * `(kind, pubkey, d)` coordinate (plan §12.1: "for addressable events keep
 * newest valid event by (kind, pubkey, d) semantics"). Non-addressable events
 * pass through untouched and keep their relative order.
 *
 * Ties on `created_at` break by the lexicographically larger event id so the
 * winner is deterministic across relays. Deletion (NIP-09) handling is a
 * separate pipeline stage and deliberately out of scope here.
 */
export function latestAddressableEvents<T extends AddressableLike>(events: T[]): T[] {
	// Newest event per (kind, pubkey, d) coordinate, remembering where the
	// winner first appeared so output order mirrors input order.
	const winner = new Map<string, { event: T; index: number }>();
	events.forEach((event, index) => {
		const coordinate =
			event.id && event.pubkey ? addressKey(event.kind, event.pubkey, event.tags) : '';
		if (!coordinate) return;
		const incumbent = winner.get(coordinate);
		if (!incumbent || isNewerReplacement(event, incumbent.event)) {
			winner.set(coordinate, { event, index });
		}
	});
	const emitted: Array<{ event: T; index: number }> = [];
	events.forEach((event, index) => {
		const coordinate =
			event.id && event.pubkey ? addressKey(event.kind, event.pubkey, event.tags) : '';
		if (!coordinate) {
			emitted.push({ event, index });
			return;
		}
		const champ = winner.get(coordinate);
		if (champ && champ.index === index) emitted.push(champ);
	});
	return emitted.map((entry) => entry.event);
}

function isNewerReplacement<T extends AddressableLike>(candidate: T, incumbent: T): boolean {
	const a = candidate.created_at ?? 0;
	const b = incumbent.created_at ?? 0;
	if (a !== b) return a > b;
	const idA = candidate.id ?? '';
	const idB = incumbent.id ?? '';
	return idA > idB;
}
