/**
 * Bitz composer draft persistence (plan PUB-010, §11.3).
 *
 * "App killed during upload → restore draft + uploaded-part state and retry
 * idempotently." Web has no upload-part journal (single-PUT providers), but
 * the same contract maps onto localStorage: persist the edit timeline
 * (trim/cover choice), caption/sensitivity, and the UPLOAD CHECKPOINT — the
 * provider descriptor of an already-uploaded asset — so a crash after upload
 * never re-uploads bytes, and a crash before publish resumes at "verify then
 * sign".
 *
 * Source video bytes are deliberately NOT stored (a 60s clip dwarfs the
 * ~5 MB localStorage budget); the draft records the file reference fields
 * needed to re-probe once the user re-picks the file. Everything else —
 * trim window, cover URL, uploaded URL/hash — survives intact.
 */
import { browser } from '$app/environment';
import {
	MAX_DRAFT_SECONDS,
	type TrimRange,
	normalizeTrim,
	validateTrim
} from '$lib/media/video-trim';

export const BITZ_DRAFT_KEY = 'bitos:draft:bitz-composer';
export const BITZ_DRAFT_VERSION = 1;

/**
 * Upload checkpoint (§11.3 "persist checkpoint locally"). The descriptor is
 * what a re-publish needs: never re-PUT bytes the provider already holds.
 */
export interface BitzUploadCheckpoint {
	/** Provider id that accepted the bytes ('server' | 'blossom' | ...). */
	providerId: string;
	/** Remote URL of the uploaded asset. */
	url: string;
	/** SHA-256 of the uploaded bytes, when the chain verified it (PUB-006). */
	sha256?: string;
	/** MIME type reported at upload time. */
	mimeType: string;
	/** Byte size at upload time. */
	bytes: number;
	/** When the provider acknowledged the upload. */
	uploadedAt: number;
}

/** Metadata restored alongside the draft so limits/UI need no re-probe. */
export interface BitzDraftMeta {
	width: number;
	height: number;
	duration?: number;
}

export interface BitzDraftData {
	version: number;
	savedAt: number;
	mediaKind: 'video' | 'image';
	/** File reference for the "re-pick the same file" restore path. */
	file: { name: string; size: number; mimeType: string } | null;
	/** Probed metadata (PUB-007). */
	meta: BitzDraftMeta | null;
	/** Versioned edit timeline: the trim window (ms in storage per §6.3). */
	trim: { in_ms: number; out_ms: number };
	/** Uploaded cover-frame URL (imeta `thumb`). */
	cover: string | null;
	caption: string;
	sensitive: boolean;
	/** Checkpoint of the completed media upload, when it got that far. */
	upload: BitzUploadCheckpoint | null;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function parseCheckpoint(raw: unknown): BitzUploadCheckpoint | null {
	if (!isPlainObject(raw)) return null;
	if (typeof raw.providerId !== 'string' || typeof raw.url !== 'string') return null;
	if (!/^https?:\/\//i.test(raw.url)) return null;
	if (typeof raw.mimeType !== 'string' || !isFiniteNumber(raw.bytes)) return null;
	return {
		providerId: raw.providerId,
		url: raw.url,
		sha256:
			typeof raw.sha256 === 'string' && /^[0-9a-f]{64}$/.test(raw.sha256) ? raw.sha256 : undefined,
		mimeType: raw.mimeType,
		bytes: raw.bytes,
		uploadedAt: isFiniteNumber(raw.uploadedAt) ? raw.uploadedAt : Date.now()
	};
}

/**
 * Parse + validate localStorage contents.
 * Foreign versions, corrupted rows, and no-work drafts return null; watchers
 * and stride — never a throw — so restore is always best-effort.
 */
export function readBitzDraft(): BitzDraftData | null {
	if (!browser) return null;
	try {
		const raw = localStorage.getItem(BITZ_DRAFT_KEY);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		if (!isPlainObject(parsed)) return null;
		if (parsed.version !== BITZ_DRAFT_VERSION) return null;
		if (parsed.mediaKind !== 'video' && parsed.mediaKind !== 'image') return null;
		if (typeof parsed.caption !== 'string' || typeof parsed.sensitive !== 'boolean') return null;
		const hasWork =
			(parsed.caption ?? '').trim().length > 0 ||
			!!parsed.upload ||
			!!parsed.cover ||
			parsed.mediaKind === 'video';
		if (!hasWork) return null;

		const rawMeta = isPlainObject(parsed.meta) ? parsed.meta : null;
		const duration = isFiniteNumber(rawMeta?.duration) ? rawMeta.duration : undefined;
		const rawTrim = isPlainObject(parsed.trim) ? parsed.trim : {};
		const inSeconds = (isFiniteNumber(rawTrim.in_ms) ? rawTrim.in_ms : 0) / 1000;
		// Missing out-point defaults to the in-point (normalizeTrim widens it
		// to a minimal window below the source duration clamp).
		const outMs = isFiniteNumber(rawTrim.out_ms)
			? rawTrim.out_ms
			: isFiniteNumber(rawTrim.in_ms)
				? rawTrim.in_ms
				: 0;
		const outSeconds = outMs / 1000;
		const sourceDuration =
			duration ?? Math.max(MAX_DRAFT_SECONDS, Math.ceil(Math.max(inSeconds, outSeconds)));
		const trim = normalizeTrim({ inSeconds, outSeconds }, sourceDuration);

		const meta: BitzDraftMeta | null =
			rawMeta && isFiniteNumber(rawMeta.width) && isFiniteNumber(rawMeta.height)
				? {
						width: rawMeta.width,
						height: rawMeta.height,
						duration
					}
				: null;

		return {
			version: BITZ_DRAFT_VERSION,
			savedAt: isFiniteNumber(parsed.savedAt) ? parsed.savedAt : Date.now(),
			mediaKind: parsed.mediaKind,
			file:
				isPlainObject(parsed.file) &&
				typeof parsed.file.name === 'string' &&
				isFiniteNumber(parsed.file.size)
					? {
							name: parsed.file.name,
							size: parsed.file.size,
							mimeType: typeof parsed.file.mimeType === 'string' ? parsed.file.mimeType : ''
						}
					: null,
			meta,
			trim: {
				in_ms: Math.round(trim.inSeconds * 1000),
				out_ms: Math.round(trim.outSeconds * 1000)
			},
			cover:
				typeof parsed.cover === 'string' && /^https?:\/\//i.test(parsed.cover)
					? parsed.cover
					: null,
			caption: parsed.caption,
			sensitive: parsed.sensitive,
			upload: parseCheckpoint(parsed.upload)
		};
	} catch {
		return null;
	}
}

/** Convert a draft's ms timeline (§6.3) into the seconds model the UI uses. */
export function draftTrimToSeconds(trim: { in_ms: number; out_ms: number }): TrimRange {
	return { inSeconds: trim.in_ms / 1000, outSeconds: trim.out_ms / 1000 };
}

/** Whether a restored trim differs from the full-source default enough to matter. */
export function draftHasEdit(trim: { in_ms: number; out_ms: number }): boolean {
	// A draft that never touched trim stores 0..0 (no meta) or the full span.
	return trim.in_ms > 0 || (trim.out_ms > 0 && trim.in_ms !== 0);
}

export function clearBitzDraft(): void {
	if (!browser) return;
	try {
		localStorage.removeItem(BITZ_DRAFT_KEY);
	} catch {
		/* ignore */
	}
}

export function validateDraftForPublish(draft: BitzDraftData): {
	valid: boolean;
	reason?: 'missing-meta' | 'invalid-trim';
	trimValidation?: ReturnType<typeof validateTrim>;
} {
	if (!draft.meta || !draft.meta.duration) {
		return { valid: false, reason: 'missing-meta' };
	}
	const range = draftTrimToSeconds(draft.trim);
	const validation = validateTrim(range, { forPublish: true });
	if (!validation.valid) {
		return { valid: false, reason: 'invalid-trim', trimValidation: validation };
	}
	return { valid: true, trimValidation: validation };
}

function persist(data: BitzDraftData): boolean {
	if (!browser) return false;
	try {
		localStorage.setItem(BITZ_DRAFT_KEY, JSON.stringify(data));
		return true;
	} catch {
		return false;
	}
}

export interface BitzDraftInput {
	mediaKind: 'video' | 'image';
	file: { name: string; size: number; mimeType: string } | null;
	meta: BitzDraftMeta | null;
	trim: TrimRange;
	cover: string | null;
	caption: string;
	sensitive: boolean;
	upload: BitzUploadCheckpoint | null;
}

/** Debounced writer — typing/dragging must not hit storage per keystroke. */
export function createBitzDraftWriter(): {
	write: (input: BitzDraftInput) => void;
	flush: () => void;
	clear: () => void;
} {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let pending: BitzDraftInput | null = null;

	const writeNow = () => {
		timer = undefined;
		if (!pending) return;
		const input = pending;
		pending = null;
		persist({
			version: BITZ_DRAFT_VERSION,
			savedAt: Date.now(),
			mediaKind: input.mediaKind,
			file: input.file,
			meta: input.meta,
			trim: {
				in_ms: Math.round(input.trim.inSeconds * 1000),
				out_ms: Math.round(input.trim.outSeconds * 1000)
			},
			cover: input.cover,
			caption: input.caption,
			sensitive: input.sensitive,
			upload: input.upload
		});
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
			clearBitzDraft();
		}
	};
}
