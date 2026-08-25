/**
 * Named meme draft slots (user request 2026-08-23) — "save WIP, resume later"
 * on top of the single auto-recovery draft (stores/meme-drafts.ts, F-010).
 *
 * A slot snapshots everything the creator considers work-in-progress:
 * media bytes (bounded data URL), the full overlay + cue + layer project,
 * trim/speed, caption, destination, look. Slots live in localStorage under
 * `bitos:meme-slots` (label list + payloads), freshest first, capped so a
 * slot can never wedge the 5 MB budget.
 *
 * The autosave draft stays untouched — slots are explicit save points.
 */
import { browser } from '$app/environment';
import { normalizeOverlay, type MemeTextOverlay, type MemeSfxCue } from '$lib/meme/schema';
import { normalizeSfxCues } from '$lib/meme/schema';
import { normalizeImageOverlay, type MemeImageOverlay } from '$lib/meme/image-overlay';
import { normalizeDrawingGroups, type DrawingGroup } from '$lib/meme/drawing';

export const MEME_SLOTS_KEY = 'bitos:meme-slots';
export const MEME_SLOTS_VERSION = 1;
/** Slot count + per-slot bytes both capped — see MAX_SLOT_BYTES. */
export const MAX_MEME_SLOTS = 6;
/** localStorage-safe media budget per slot (data URLs inflate ~33%). */
export const MAX_SLOT_BYTES = 1.5 * 1024 * 1024;
const PROJECT_MEDIA_DB = 'bitos-meme-project-media';
const PROJECT_MEDIA_STORE = 'files';

export interface MemeSlotMedia {
	dataUrl?: string;
	blobId?: string;
	name: string;
	mimeType: string;
}

export interface MemeSlot {
	id: string;
	label: string;
	savedAt: number;
	media: MemeSlotMedia | null;
	mediaKindValue: 'image' | 'video' | null;
	overlays: MemeTextOverlay[];
	sfxCues: MemeSfxCue[];
	imageLayers: MemeImageOverlay[];
	/** Draw & Record layers are part of the editable work-in-progress. */
	drawingGroups: DrawingGroup[];
	caption: string;
	sensitive: boolean;
	destination: 'bitz' | 'story' | 'note';
	lookId: string;
	/** Video window settings (ignored by image media on restore). */
	trimStartSec: number;
	trimEndSec: number | null;
	playbackRate: number;
}

interface StoredSlots {
	schema: string;
	version: number;
	list: MemeSlot[];
}

function newId(): string {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
	return `slot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function clampRate(value: unknown): number {
	const n = Number(value);
	return Number.isFinite(n) ? Math.min(2, Math.max(0.5, n)) : 1;
}

function openProjectMediaDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(PROJECT_MEDIA_DB, 1);
		request.onupgradeneeded = () => request.result.createObjectStore(PROJECT_MEDIA_STORE);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

/** Tolerant parse of one stored slot — drop bad pieces, keep the rest. */
function parseSlot(raw: unknown): MemeSlot | null {
	if (!raw || typeof raw !== 'object') return null;
	const s = raw as Record<string, unknown>;
	const mediaRaw = s.media && typeof s.media === 'object' ? (s.media as MemeSlotMedia) : null;
	const mediaDataUrl = typeof mediaRaw?.dataUrl === 'string' ? mediaRaw.dataUrl : null;
	const mediaBlobId = typeof mediaRaw?.blobId === 'string' ? mediaRaw.blobId : null;
	const media =
		mediaDataUrl || mediaBlobId
			? {
					...(mediaDataUrl ? { dataUrl: mediaDataUrl.slice(0, MAX_SLOT_BYTES * 2) } : {}),
					...(mediaBlobId ? { blobId: mediaBlobId.slice(0, 96) } : {}),
					name: typeof mediaRaw?.name === 'string' ? mediaRaw.name.slice(0, 80) : 'meme',
					mimeType:
						typeof mediaRaw?.mimeType === 'string'
							? mediaRaw.mimeType.slice(0, 64)
							: 'application/octet-stream'
				}
			: null;
	const kind =
		s.mediaKindValue === 'image' || s.mediaKindValue === 'video' ? s.mediaKindValue : null;
	const destination =
		s.destination === 'story' || s.destination === 'note' ? s.destination : 'bitz';
	const hasWork =
		!!media ||
		(Array.isArray(s.overlays) && s.overlays.length > 0) ||
		(Array.isArray(s.sfxCues) && s.sfxCues.length > 0) ||
		(typeof s.caption === 'string' && s.caption.trim().length > 0);
	if (!hasWork) return null;
	const trimStart = Number(s.trimStartSec);
	const trimEnd = s.trimEndSec === null ? null : Number(s.trimEndSec);
	return {
		id: typeof s.id === 'string' && s.id.trim() ? s.id.slice(0, 64) : newId(),
		label: typeof s.label === 'string' && s.label.trim() ? s.label.trim().slice(0, 40) : 'Untitled',
		savedAt:
			Number.isFinite(Number(s.savedAt)) && Number(s.savedAt) > 0 ? Number(s.savedAt) : Date.now(),
		media,
		mediaKindValue: kind,
		overlays: (Array.isArray(s.overlays) ? s.overlays : [])
			.map(normalizeOverlay)
			.filter((o): o is MemeTextOverlay => !!o),
		sfxCues: normalizeSfxCues(s.sfxCues),
		imageLayers: (Array.isArray(s.imageLayers) ? s.imageLayers : [])
			.map((l) => normalizeImageOverlay(l))
			.filter((l): l is MemeImageOverlay => l !== null),
		drawingGroups: normalizeDrawingGroups(s.drawingGroups),
		caption: typeof s.caption === 'string' ? s.caption.slice(0, 2000) : '',
		sensitive: s.sensitive === true,
		destination,
		lookId: typeof s.lookId === 'string' ? s.lookId.slice(0, 32) : 'none',
		trimStartSec: Number.isFinite(trimStart) && trimStart > 0 ? trimStart : 0,
		trimEndSec: trimEnd !== null && Number.isFinite(trimEnd) && trimEnd > 0 ? trimEnd : null,
		playbackRate: clampRate(s.playbackRate)
	};
}

export class MemeSlotsStore {
	list = $state<MemeSlot[]>([]);

	constructor() {
		this.load();
	}

	load = () => {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(MEME_SLOTS_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw) as Partial<StoredSlots>;
			if (parsed.schema !== 'bitos.meme.slots' || parsed.version !== MEME_SLOTS_VERSION) return;
			this.list = (Array.isArray(parsed.list) ? parsed.list : [])
				.map(parseSlot)
				.filter((s): s is MemeSlot => !!s)
				.slice(0, MAX_MEME_SLOTS);
		} catch {
			/* ignore malformed storage */
		}
	};

	private persist = () => {
		if (!browser) return;
		try {
			const stored: StoredSlots = {
				schema: 'bitos.meme.slots',
				version: MEME_SLOTS_VERSION,
				list: this.list
			};
			localStorage.setItem(MEME_SLOTS_KEY, JSON.stringify(stored));
		} catch {
			/* storage full / private mode — slots stay in-memory */
		}
	};

	/** Save (or overwrite when `id` matches) a slot. Returns the stored slot. */
	save(input: Omit<MemeSlot, 'id' | 'savedAt'> & { id?: string }): MemeSlot {
		const trimmed = input.label.trim().slice(0, 40) || `Slot ${this.list.length + 1}`;
		const existing = input.id ? this.list.find((s) => s.id === input.id) : undefined;
		const slot: MemeSlot = {
			...input,
			id: existing?.id ?? newId(),
			label: trimmed,
			savedAt: Date.now()
		};
		this.list = existing
			? this.list.map((s) => (s.id === existing.id ? slot : s))
			: [slot, ...this.list].slice(0, MAX_MEME_SLOTS);
		this.persist();
		return slot;
	}

	remove(id: string) {
		this.list = this.list.filter((s) => s.id !== id);
		this.persist();
	}

	rename(id: string, label: string): MemeSlot | null {
		const clean = label.trim().slice(0, 40);
		if (!clean) return null;
		const current = this.list.find((slot) => slot.id === id);
		if (!current) return null;
		const renamed = { ...current, label: clean, savedAt: Date.now() };
		this.list = this.list.map((slot) => (slot.id === id ? renamed : slot));
		this.persist();
		return renamed;
	}

	/** Create an independent saved-project copy. The editable arrays are copied
	 * when restored; this method gives the copy its own id and save timestamp. */
	duplicate(id: string): MemeSlot | null {
		const source = this.list.find((slot) => slot.id === id);
		if (!source) return null;
		return this.save({
			...source,
			id: undefined,
			label: `Copy of ${source.label}`.slice(0, 40)
		});
	}

	/** Full project sources live in IndexedDB, not the tiny localStorage budget. */
	async saveMediaFile(file: File): Promise<MemeSlotMedia> {
		if (!browser || typeof indexedDB === 'undefined')
			throw new Error('Project media storage is unavailable');
		const blobId = `project-media:${newId()}`;
		const db = await openProjectMediaDb();
		await new Promise<void>((resolve, reject) => {
			const request = db
				.transaction(PROJECT_MEDIA_STORE, 'readwrite')
				.objectStore(PROJECT_MEDIA_STORE)
				.put(file, blobId);
			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});
		db.close();
		return { blobId, name: file.name, mimeType: file.type };
	}

	/** Restore a slot's media as a File (null when the slot skipped media). */
	async slotMediaFile(slot: MemeSlot): Promise<File | null> {
		if (!slot.media) return null;
		try {
			if (slot.media.blobId && browser && typeof indexedDB !== 'undefined') {
				const db = await openProjectMediaDb();
				const blob = await new Promise<Blob | undefined>((resolve, reject) => {
					const request = db
						.transaction(PROJECT_MEDIA_STORE)
						.objectStore(PROJECT_MEDIA_STORE)
						.get(slot.media!.blobId!);
					request.onsuccess = () => resolve(request.result as Blob | undefined);
					request.onerror = () => reject(request.error);
				});
				db.close();
				if (!blob) return null;
				return new File([blob], slot.media.name || 'meme', {
					type: slot.media.mimeType || blob.type
				});
			}
			if (!slot.media.dataUrl) return null;
			const res = await fetch(slot.media.dataUrl);
			const blob = await res.blob();
			return new File([blob], slot.media.name || 'meme', {
				type: slot.media.mimeType || blob.type || 'application/octet-stream'
			});
		} catch {
			return null;
		}
	}
}

export const memeSlots = new MemeSlotsStore();
