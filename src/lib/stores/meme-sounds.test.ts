import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_LIBRARY_SOUNDS, SOUND_LIBRARY_KEY, soundLibrary } from './meme-sounds.svelte';

// The store no-ops load/persist when not in a browser; module singleton —
// mock the environment flag BEFORE import and reset via load() against a
// cleared fake localStorage (same pattern as meme-templates.test.ts).
const memory = new Map<string, string>();
const storage = {
	getItem: (key: string) => memory.get(key) ?? null,
	setItem: (key: string, value: string) => void memory.set(key, value),
	removeItem: (key: string) => void memory.delete(key)
};

vi.mock('$app/environment', () => ({ browser: true }));
vi.stubGlobal('localStorage', storage);

// Minimal fake IndexedDB: open + put/get/delete + tx-complete, all resolved
// via queueMicrotask so handlers are assigned before events fire (mirrors the
// real async contract). One shared blob store across opens.
class FakeRequest<T> {
	result!: T;
	onsuccess: (() => void) | null = null;
	onerror: (() => void) | null = null;
	constructor(run: () => T) {
		queueMicrotask(() => {
			try {
				this.result = run();
				this.onsuccess?.();
			} catch {
				this.onerror?.();
			}
		});
	}
}
const fakeStore = new Map<string, unknown>();
const fakeDb = {
	close() {
		/* noop */
	},
	transaction() {
		const store = {
			put: (v: unknown, k: string) => void fakeStore.set(k, v),
			get: (k: string) => new FakeRequest(() => fakeStore.get(k)),
			delete: (k: string) => void fakeStore.delete(k)
		};
		const tx = {
			objectStore: () => store,
			oncomplete: null as (() => void) | null,
			onerror: null as (() => void) | null
		};
		queueMicrotask(() => tx.oncomplete?.());
		return tx;
	}
};
vi.stubGlobal('indexedDB', { open: () => new FakeRequest(() => fakeDb) });

function resetStore() {
	memory.clear();
	soundLibrary.list = [];
	soundLibrary.load();
}

afterEach(() => {
	resetStore();
});

describe('soundLibrary store', () => {
	it('starts empty', () => {
		expect(soundLibrary.list).toEqual([]);
	});

	it('rejects oversized / empty / overlong additions', async () => {
		await expect(
			soundLibrary.add({ source: 'device', blob: new Blob(['x']), durationSec: 1 })
		).resolves.toBeDefined();
		resetStore();
		await expect(
			soundLibrary.add({ source: 'device', blob: new Blob([new Uint8Array(0)]), durationSec: 1 })
		).rejects.toThrow(/empty/);
		await expect(
			soundLibrary.add({
				source: 'device',
				blob: new Blob(['x'.repeat(9 * 1024 * 1024)]),
				durationSec: 1
			})
		).rejects.toThrow(/8 MB/);
		await expect(
			soundLibrary.add({ source: 'mic', blob: new Blob(['x']), durationSec: 30 })
		).rejects.toThrow(/15s/);
	});

	it('adds a sound, persists meta and returns the stored blob', async () => {
		const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' });
		const saved = await soundLibrary.add({
			label: 'Boom mic check',
			source: 'mic',
			blob,
			durationSec: 0.9
		});
		expect(saved.label).toBe('Boom mic check');
		expect(saved.source).toBe('mic');
		expect(soundLibrary.list).toHaveLength(1);

		const back = await soundLibrary.getBlob(saved.id);
		expect(back).not.toBeNull();
		expect(back?.size).toBe(3);

		const raw = memory.get(SOUND_LIBRARY_KEY);
		expect(raw).toBeTruthy();
		expect(JSON.parse(raw!).list[0].label).toBe('Boom mic check');
	});

	it('removes sounds and prunes orphaned custom cues', async () => {
		const a = await soundLibrary.add({ source: 'device', blob: new Blob(['a']), durationSec: 1 });
		const b = await soundLibrary.add({ source: 'mic', blob: new Blob(['b']), durationSec: 1 });
		expect(soundLibrary.list).toHaveLength(2);

		const cues = [
			{ id: 'k1', sfx: 'custom' as const, soundId: a.id, atMs: 0, gain: 1 },
			{ id: 'k2', sfx: 'boom' as const, atMs: 100, gain: 1 }
		];
		await soundLibrary.remove(a.id);
		expect(soundLibrary.list.map((s) => s.id)).toEqual([b.id]);
		const kept = soundLibrary.pruneOrphanCues(cues);
		expect(kept.map((c) => c.id)).toEqual(['k2']);
	});

	it('caps the library at MAX_LIBRARY_SOUNDS', async () => {
		for (let i = 0; i < MAX_LIBRARY_SOUNDS; i++) {
			await soundLibrary.add({ source: 'device', blob: new Blob(['x']), durationSec: 1 });
		}
		expect(soundLibrary.list).toHaveLength(MAX_LIBRARY_SOUNDS);
		// Further adds are rejected (the UI surfaces the message as a toast).
		let rejected = false;
		try {
			await soundLibrary.add({ source: 'device', blob: new Blob(['x']), durationSec: 1 });
		} catch {
			rejected = true;
		}
		expect(rejected).toBe(true);
	});
});
