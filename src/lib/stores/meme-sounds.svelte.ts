import { browser } from '$app/environment';
import { CUSTOM_SOUND_KEY, type MemeSfxCue } from '$lib/meme/schema';

/**
 * User sound library — device-imported / mic-recorded sounds that can be cued
 * like the synthesized SFX pack. Phase-1 storage keeps meta (labels, ids,
 * durations) in localStorage and the audio bytes in IndexedDB — meta stays
 * sync-loaded for the picker UI while blobs never bloat localStorage.
 *
 * Cues reference sounds by id (MemeSfxCue.soundId); deleting a sound only
 * affects future renders — `pruneOrphanCues` drops cue rows whose soundId is
 * no longer in the library.
 */

export const SOUND_LIBRARY_KEY = 'bitos:meme-sounds';
export const SOUND_LIBRARY_VERSION = 1;
/** Sounds are short one-shots; keep the library snappy. */
export const MAX_LIBRARY_SOUNDS = 30;
export const MAX_SOUND_BYTES = 8 * 1024 * 1024; // 8 MB per sound
export const MAX_SOUND_SECONDS = 15;

/** Decoded metadata for one library sound. */
export interface LibrarySound {
	id: string;
	label: string;
	/** Source: device file import or mic recording. */
	source: 'device' | 'mic';
	/** Playback duration in seconds (integer ms precision). */
	durationSec: number;
	createdAt: number;
	/** Mime of the stored blob (audio/webm, audio/mp4, audio/mpeg, …). */
	mime: string;
}

interface StoredLibrary {
	schema: string;
	version: number;
	list: LibrarySound[];
}

function newId(): string {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
	return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function parseSound(raw: unknown): LibrarySound | null {
	if (!raw || typeof raw !== 'object') return null;
	const s = raw as Record<string, unknown>;
	const label = typeof s.label === 'string' && s.label.trim() ? s.label.trim().slice(0, 40) : '';
	const durationSec = Number(s.durationSec);
	return {
		id: typeof s.id === 'string' && s.id.trim() ? s.id.slice(0, 64) : newId(),
		label: label || 'My sound',
		source: s.source === 'mic' ? 'mic' : 'device',
		durationSec:
			Number.isFinite(durationSec) && durationSec > 0
				? Math.min(Math.round(durationSec * 1000) / 1000, MAX_SOUND_SECONDS)
				: 0,
		createdAt:
			Number.isFinite(Number(s.createdAt)) && Number(s.createdAt) > 0
				? Number(s.createdAt)
				: Date.now(),
		mime: typeof s.mime === 'string' && s.mime ? s.mime.slice(0, 64) : 'audio/webm'
	};
}

const DB_NAME = 'bitos-meme-sounds';
const STORE = 'blobs';

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, 1);
		request.onupgradeneeded = () => request.result.createObjectStore(STORE);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'));
	});
}

async function blobPut(db: IDBDatabase, id: string, blob: Blob): Promise<void> {
	const tx = db.transaction(STORE, 'readwrite');
	tx.objectStore(STORE).put(blob, id);
	await new Promise<void>((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error('Sound storage failed'));
	});
}

async function blobDelete(db: IDBDatabase, ids: string[]): Promise<void> {
	if (!ids.length) return;
	const tx = db.transaction(STORE, 'readwrite');
	for (const id of ids) tx.objectStore(STORE).delete(id);
	await new Promise<void>((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error('Sound delete failed'));
	});
}

class SoundLibraryStore {
	list = $state<LibrarySound[]>([]);

	constructor() {
		this.load();
	}

	load = () => {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(SOUND_LIBRARY_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw) as Partial<StoredLibrary>;
			if (parsed.schema !== 'bitos.meme.sounds') return;
			const version = Number(parsed.version);
			if (!Number.isFinite(version) || version < 1 || version > SOUND_LIBRARY_VERSION) return;
			this.list = (Array.isArray(parsed.list) ? parsed.list : [])
				.map(parseSound)
				.filter((s): s is LibrarySound => !!s)
				.slice(0, MAX_LIBRARY_SOUNDS);
		} catch {
			/* ignore malformed storage */
		}
	};

	private persist = () => {
		if (!browser) return;
		try {
			const stored: StoredLibrary = {
				schema: 'bitos.meme.sounds',
				version: SOUND_LIBRARY_VERSION,
				list: this.list
			};
			localStorage.setItem(SOUND_LIBRARY_KEY, JSON.stringify(stored));
		} catch {
			/* storage full / private mode — library stays in-memory */
		}
	};

	/** Import a device file or finished mic recording into the library. */
	async add(input: {
		label?: string;
		source: 'device' | 'mic';
		blob: Blob;
		durationSec: number;
		mime?: string;
	}): Promise<LibrarySound> {
		if (!browser) throw new Error('Sounds can only be added in the browser');
		if (this.list.length >= MAX_LIBRARY_SOUNDS) {
			throw new Error(`The sound library tops out at ${MAX_LIBRARY_SOUNDS} sounds`);
		}
		if (input.blob.size <= 0) throw new Error('That sound is empty');
		if (input.blob.size > MAX_SOUND_BYTES) throw new Error('That sound is larger than 8 MB');
		if (!(input.durationSec > 0)) throw new Error('That sound has no duration');
		if (input.durationSec > MAX_SOUND_SECONDS) {
			throw new Error(`Sounds top out at ${MAX_SOUND_SECONDS}s — trim it first`);
		}
		const sound = parseSound({
			label: input.label,
			source: input.source,
			durationSec: input.durationSec,
			mime: input.mime ?? input.blob.type
		})!;
		const db = await openDb();
		try {
			await blobPut(db, sound.id, input.blob);
			this.list = [sound, ...this.list];
			this.persist();
			return sound;
		} finally {
			db.close();
		}
	}

	/** Fetch the stored bytes for one sound (for preview / export mixing). */
	async getBlob(id: string): Promise<Blob | null> {
		if (!browser) return null;
		const db = await openDb();
		try {
			return await new Promise<Blob | null>((resolve, reject) => {
				const tx = db.transaction(STORE, 'readonly');
				const request = tx.objectStore(STORE).get(id);
				request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null);
				request.onerror = () => reject(request.error ?? new Error('Sound read failed'));
			});
		} finally {
			db.close();
		}
	}

	/** Drop a sound from the library. Idempotent for unknown ids. */
	async remove(id: string): Promise<void> {
		if (!browser) return;
		const before = this.list.length;
		this.list = this.list.filter((s) => s.id !== id);
		if (this.list.length === before) return;
		this.persist();
		const db = await openDb();
		try {
			await blobDelete(db, [id]);
		} catch {
			/* meta already removed — blob cleanup is best-effort */
		} finally {
			db.close();
		}
	}

	/** Drop cue rows whose custom soundId is no longer in the library. */
	pruneOrphanCues(cues: MemeSfxCue[]): MemeSfxCue[] {
		return cues.filter(
			(cue) => cue.sfx !== CUSTOM_SOUND_KEY || this.list.some((s) => s.id === cue.soundId)
		);
	}
}

export const soundLibrary = new SoundLibraryStore();
