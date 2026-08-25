import { browser } from '$app/environment';

/**
 * Media source library — the studio's "recently used" browser: every URL
 * that actually loaded (base GIFs, image/GIF layers, pasted links) is
 * remembered so mass production can re-pick sources in one tap instead of
 * re-browsing Giphy / the device / the clipboard.
 *
 * Storage (localStorage, key `bitos:media-library`):
 *   { schema, version, list: [{ id, kind, url, label, addedAt }] }
 * URL-keyed dedupe, freshest first, capped.
 */

export const MEDIA_LIBRARY_KEY = 'bitos:media-library';
export const MEDIA_LIBRARY_VERSION = 1;
export const MAX_MEDIA_SOURCES = 60;

export type MediaSourceKind = 'image' | 'gif' | 'video';

export interface MediaSource {
	id: string;
	kind: MediaSourceKind;
	url: string;
	label: string;
	addedAt: number;
}

interface StoredLibrary {
	schema: string;
	version: number;
	list: MediaSource[];
}

const HTTP_RE = /^https:\/\/\S+$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v)(\?|$)/i;
const GIF_EXT = /\.gif(\?|$)/i;

function kindOf(url: string, mime?: string): MediaSourceKind | null {
	if (mime?.startsWith('video/')) return 'video';
	if (mime === 'image/gif') return 'gif';
	if (mime?.startsWith('image/')) return 'image';
	if (VIDEO_EXT.test(url)) return 'video';
	if (GIF_EXT.test(url)) return 'gif';
	return null;
}

/** Tolerant row parse — junk rows drop, never throw. */
function parseSource(raw: unknown): MediaSource | null {
	if (!raw || typeof raw !== 'object') return null;
	const s = raw as Record<string, unknown>;
	const url = typeof s.url === 'string' ? s.url.trim() : '';
	if (!HTTP_RE.test(url)) return null;
	const kind = kindOf(url, typeof s.kind === 'string' ? `${s.kind}/` : undefined) ?? 'image';
	const label =
		typeof s.label === 'string' && s.label.trim() ? s.label.trim().slice(0, 60) : url.slice(0, 60);
	return {
		id: typeof s.id === 'string' && s.id ? s.id.slice(0, 64) : url,
		kind: (typeof s.kind === 'string' && ['image', 'gif', 'video'].includes(s.kind)
			? s.kind
			: kind) as MediaSourceKind,
		url: url.slice(0, 512),
		label,
		addedAt: Number.isFinite(Number(s.addedAt)) ? Number(s.addedAt) : Date.now()
	};
}

function normalizeSources(list: MediaSource[]): MediaSource[] {
	const seenUrls = new Set<string>();
	const normalized: MediaSource[] = [];
	for (const source of list) {
		if (seenUrls.has(source.url)) continue;
		seenUrls.add(source.url);
		normalized.push({
			...source,
			// Keep DOM keys unique even if older persisted rows reused URL/id values.
			id: `${source.url}#${source.addedAt}`
		});
		if (normalized.length >= MAX_MEDIA_SOURCES) break;
	}
	return normalized;
}

class MediaLibraryStore {
	list = $state<MediaSource[]>([]);

	constructor() {
		if (browser) this.read();
	}

	private read() {
		try {
			const raw = localStorage.getItem(MEDIA_LIBRARY_KEY);
			if (!raw) return;
			const stored = JSON.parse(raw) as StoredLibrary;
			if (stored?.schema !== MEDIA_LIBRARY_KEY) return;
			this.list = normalizeSources(
				(Array.isArray(stored.list) ? stored.list : [])
					.map(parseSource)
					.filter((s): s is MediaSource => s !== null)
			);
			this.write();
		} catch {
			this.list = [];
		}
	}

	private write() {
		try {
			const stored: StoredLibrary = {
				schema: MEDIA_LIBRARY_KEY,
				version: MEDIA_LIBRARY_VERSION,
				list: this.list.slice(0, MAX_MEDIA_SOURCES)
			};
			localStorage.setItem(MEDIA_LIBRARY_KEY, JSON.stringify(stored));
		} catch {
			/* quota/private mode — history just won't persist */
		}
	}

	/** Record a source that loaded (URL-keyed, bumps to the top). */
	remember(url: string, label = '', mime?: string) {
		const clean = url.trim();
		if (!HTTP_RE.test(clean)) return;
		const kind = kindOf(clean, mime) ?? 'image';
		const addedAt = Date.now();
		const row: MediaSource = {
			id: `${clean}#${addedAt}`,
			kind,
			url: clean.slice(0, 512),
			label: (label.trim() || clean.split('/').pop()?.split('?')[0] || clean).slice(0, 60),
			addedAt
		};
		this.list = normalizeSources([row, ...this.list]);
		this.write();
	}

	remove(id: string) {
		this.list = this.list.filter((s) => s.id !== id);
		this.write();
	}

	clear() {
		this.list = [];
		this.write();
	}
}

export const mediaLibrary = new MediaLibraryStore();
