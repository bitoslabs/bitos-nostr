/**
 * Meme Studio draft persistence (plan Phase-1 F-010 "draft recovery").
 *
 * A meme in progress is more than text — it is { source media, overlay
 * project, caption/destination }. Drafts survive accidental closes, crashes
 * and refreshes by storing:
 *
 *   • the media bytes as a data URL (bounded — see MAX_DRAFT_BYTES, because
 *     localStorage caps out around 5 MB),
 *   • the versioned `com.bitos.bitz.meme` overlay project,
 *   • caption / sensitivity / destination / timing selection.
 *
 * Pure localStorage with debounced writes, mirroring `stores/drafts.ts`.
 */
import { browser } from '$app/environment';
import { normalizeOverlay, type MemeTextOverlay } from '$lib/meme/schema';

export type MemeDraftOverlay = MemeTextOverlay;

export const MEME_DRAFT_KEY = 'bitos:draft:meme-studio';
export const MEME_DRAFT_VERSION = 1;

/** localStorage-safe cap (data URLs inflate bytes ~33%). */
export const MAX_DRAFT_BYTES = 3.5 * 1024 * 1024;

export interface MemeDraftData {
	version: number;
	savedAt: number;
	/** Source media serialized as a data URL (small files only). */
	media: { dataUrl: string; name: string; mimeType: string } | null;
	/** Overlay positions/text — the expensive-to-recreate part. */
	overlays: unknown[];
	caption: string;
	sensitive: boolean;
	destination: 'bitz' | 'story' | 'note';
	/** Selected overlay when the draft was saved. */
	selectedId: string | null;
	/** Source-media color look id (meme/look.ts). */
	lookId?: string;
}

/** Parse + validate localStorage contents; null when absent or foreign. */
export function readMemeDraft(): MemeDraftData | null {
	if (!browser) return null;
	try {
		const raw = localStorage.getItem(MEME_DRAFT_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as MemeDraftData;
		if (!parsed || parsed.version !== MEME_DRAFT_VERSION) return null;
		if (typeof parsed.caption !== 'string') return null;
		if (
			parsed.destination !== 'bitz' &&
			parsed.destination !== 'story' &&
			parsed.destination !== 'note'
		) {
			return null;
		}
		const hasWork =
			(parsed.media?.dataUrl && typeof parsed.media.dataUrl === 'string') ||
			(Array.isArray(parsed.overlays) && parsed.overlays.length > 0) ||
			parsed.caption.trim().length > 0;
		if (!hasWork) return null;
		return parsed;
	} catch {
		return null;
	}
}

export function clearMemeDraft(): void {
	if (!browser) return;
	try {
		localStorage.removeItem(MEME_DRAFT_KEY);
	} catch {
		/* ignore */
	}
}

function persist(data: MemeDraftData): boolean {
	if (!browser) return false;
	try {
		localStorage.setItem(MEME_DRAFT_KEY, JSON.stringify(data));
		return true;
	} catch {
		// Quota exceeded — most likely a huge video. Drop the media, keep the
		// text/overlay work so the user loses as little as possible.
		try {
			const lighter: MemeDraftData = { ...data, media: null };
			localStorage.setItem(MEME_DRAFT_KEY, JSON.stringify(lighter));
			return true;
		} catch {
			return false;
		}
	}
}

/** Debounced writer — every drag/keystroke must not hit storage. */
export function createMemeDraftWriter(): {
	write: (input: Omit<MemeDraftData, 'savedAt' | 'version'>) => void;
	flush: () => void;
	clear: () => void;
} {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let pending: Omit<MemeDraftData, 'savedAt' | 'version'> | null = null;

	const writeNow = () => {
		timer = undefined;
		if (!pending) return;
		const data: MemeDraftData = { ...pending, version: MEME_DRAFT_VERSION, savedAt: Date.now() };
		pending = null;
		persist(data);
	};

	return {
		write(input) {
			pending = input;
			if (timer !== undefined) clearTimeout(timer);
			timer = setTimeout(writeNow, 500);
		},
		flush() {
			if (timer !== undefined) clearTimeout(timer);
			writeNow();
		},
		clear() {
			if (timer !== undefined) clearTimeout(timer);
			pending = null;
			clearMemeDraft();
		}
	};
}

/** Rehydrate draft overlays through the tolerant schema parser. */
export function draftOverlays(draft: MemeDraftData): MemeDraftOverlay[] {
	if (!Array.isArray(draft.overlays)) return [];
	const restored: MemeDraftOverlay[] = [];
	for (const raw of draft.overlays) {
		try {
			const overlay = normalizeOverlay(raw);
			if (overlay) restored.push(overlay);
		} catch {
			/* drop corrupted rows */
		}
	}
	return restored;
}

/** Restore the source media as a File (null when the draft skipped it). */
export async function draftMediaFile(
	draft: MemeDraftData
): Promise<{ file: File; previewUrl: string } | null> {
	if (!draft.media?.dataUrl) return null;
	try {
		const res = await fetch(draft.media.dataUrl);
		const blob = await res.blob();
		const file = new File([blob], draft.media!.name || 'meme', {
			type: draft.media!.mimeType || blob.type || 'application/octet-stream'
		});
		return { file, previewUrl: URL.createObjectURL(file) };
	} catch {
		return null;
	}
}

/** Serialize media bytes when small enough to fit a draft. */
export async function mediaToDraftDataUrl(
	file: File
): Promise<{ dataUrl: string; name: string; mimeType: string } | null> {
	if (file.size > MAX_DRAFT_BYTES) return null; // too big for localStorage
	try {
		const buffer = await file.arrayBuffer();
		let binary = '';
		const bytes = new Uint8Array(buffer);
		const chunk = 0x8000;
		for (let i = 0; i < bytes.length; i += chunk) {
			binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
		}
		return {
			dataUrl: `data:${file.type || 'application/octet-stream'};base64,${btoa(binary)}`,
			name: file.name,
			mimeType: file.type
		};
	} catch {
		return null;
	}
}
