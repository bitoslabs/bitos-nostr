import { beforeEach, describe, expect, it } from 'vitest';

import { MEME_SLOTS_KEY, MemeSlotsStore } from './meme-slots.svelte';

/**
 * Browser-only slot mechanics (IndexedDB media): the resume loop's core
 * promise — a slot saved by ANY surface restores its media bytes. The node
 * suite covers the localStorage schema; this one exercises the real
 * `saveMediaFile` → `slotMediaFile` IndexedDB round-trip plus the
 * `previewDataUrl` thumbnail field.
 */

function pngFile(bytes = 64, name = 'pic.png', type = 'image/png'): File {
	const body = new Uint8Array(bytes);
	for (let i = 0; i < bytes; i++) body[i] = i % 251;
	return new File([body], name, { type });
}

function slot(overrides: Record<string, unknown> = {}) {
	return {
		label: 'WIP meme',
		media: null,
		mediaKindValue: 'image' as const,
		overlays: [],
		sfxCues: [],
		imageLayers: [],
		drawingGroups: [],
		caption: 'hello',
		sensitive: false,
		destination: 'bitz' as const,
		lookId: 'none',
		trimStartSec: 0,
		trimEndSec: null,
		playbackRate: 1,
		...overrides
	};
}

describe('meme slot media (browser: IndexedDB)', () => {
	beforeEach(() => {
		localStorage.removeItem(MEME_SLOTS_KEY);
	});

	it(
		'saves media bytes to IndexedDB and restores them as a File (the resume loop)',
		{ timeout: 20_000 },
		async () => {
			const store = new MemeSlotsStore();
			const file = pngFile();
			const media = await store.saveMediaFile(file);
			expect(media.blobId).toBeTruthy();
			// blobId media carries NO inline bytes — the restore must go through
			// IndexedDB, which is exactly what the old mobile resume missed.
			expect(media.dataUrl).toBeUndefined();

			const saved = store.save(slot({ media, mediaKindValue: 'image' }));
			// Round-trip through storage (parse) like a real relaunch.
			const relaunched = new MemeSlotsStore();
			const restored = relaunched.list.find((s) => s.id === saved.id);
			expect(restored?.media?.blobId).toBe(media.blobId);

			const back = await relaunched.slotMediaFile(restored!);
			expect(back).not.toBeNull();
			expect(back!.name).toBe('pic.png');
			expect(back!.type).toBe('image/png');
			expect(back!.size).toBe(64);
			const bytes = new Uint8Array(await back!.arrayBuffer());
			expect(bytes[0]).toBe(0);
			expect(bytes[63]).toBe(63 % 251);
		}
	);

	it('falls back to the inline data URL when a slot has no blobId', async () => {
		const store = new MemeSlotsStore();
		const bytes = new Uint8Array([1, 2, 3, 4]);
		const dataUrl = `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
		const saved = store.save(slot({ media: { dataUrl, name: 'tiny.png', mimeType: 'image/png' } }));
		const back = await store.slotMediaFile(saved);
		expect(back).not.toBeNull();
		expect(back!.size).toBe(4);
	});

	it('returns null (not a throw) when the blob vanished from IndexedDB', async () => {
		const store = new MemeSlotsStore();
		const saved = store.save(
			slot({ media: { blobId: 'project-media:gone', name: 'x', mimeType: 'image/png' } })
		);
		expect(await store.slotMediaFile(saved)).toBeNull();
	});

	it('keeps the draft thumbnail (previewDataUrl) through the storage round-trip', () => {
		const store = new MemeSlotsStore();
		const preview = 'data:image/jpeg;base64,cHJldmlldw==';
		const saved = store.save(
			slot({
				media: {
					dataUrl: 'data:image/png;base64,eA==',
					previewDataUrl: preview,
					name: 'p',
					mimeType: 'image/png'
				}
			})
		);
		const relaunched = new MemeSlotsStore();
		const restored = relaunched.list.find((s) => s.id === saved.id);
		expect(restored?.media?.previewDataUrl).toBe(preview);
	});
});
