import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

import { MEME_SLOTS_KEY, MAX_MEME_SLOTS, MemeSlotsStore } from './meme-slots.svelte';

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (k: string) => memory.get(k) ?? null,
	setItem: (k: string, v: string) => void memory.set(k, v),
	removeItem: (k: string) => memory.delete(k),
	clear: () => memory.clear()
});

function slot(overrides: Record<string, unknown> = {}) {
	return {
		label: 'WIP meme',
		media: null,
		mediaKindValue: 'image' as const,
		overlays: [],
		sfxCues: [],
		imageLayers: [],
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

describe('meme slots', () => {
	beforeEach(() => {
		memory.clear();
	});

	it('round-trips a slot through storage', () => {
		const store = new MemeSlotsStore();
		const saved = store.save(
			slot({
				caption: 'caption A',
				overlays: [{ id: 'o1', text: 'top', x: 0.5, y: 0.08, size: 0.08, bar: true, caps: true }]
			})
		);
		const reopened = new MemeSlotsStore();
		expect(reopened.list).toHaveLength(1);
		expect(reopened.list[0]?.caption).toBe('caption A');
		expect(reopened.list[0]?.overlays[0]?.text).toBe('top');
		expect(reopened.list[0]?.id).toBe(saved.id);
	});

	it('rejects foreign schema and malformed rows', () => {
		memory.set(MEME_SLOTS_KEY, '{not json');
		expect(new MemeSlotsStore().list).toHaveLength(0);
		memory.set(MEME_SLOTS_KEY, JSON.stringify({ schema: 'other.app', version: 1, list: [slot()] }));
		expect(new MemeSlotsStore().list).toHaveLength(0);
		// Empty-work slot rows are dropped.
		memory.set(
			MEME_SLOTS_KEY,
			JSON.stringify({
				schema: 'bitos.meme.slots',
				version: 1,
				list: [slot({ caption: '', media: null }), slot({ caption: 'keep' })]
			})
		);
		const store = new MemeSlotsStore();
		expect(store.list).toHaveLength(1);
		expect(store.list[0]?.caption).toBe('keep');
	});

	it('caps stored slots at the budget, freshest first', () => {
		const store = new MemeSlotsStore();
		for (let i = 0; i < MAX_MEME_SLOTS + 3; i++) {
			store.save(slot({ caption: `slot ${i}` }));
		}
		expect(store.list).toHaveLength(MAX_MEME_SLOTS);
		expect(store.list[0]?.caption).toBe(`slot ${MAX_MEME_SLOTS + 2}`);
		const reopened = new MemeSlotsStore();
		expect(reopened.list).toHaveLength(MAX_MEME_SLOTS);
	});

	it('overwrites by id instead of appending', () => {
		const store = new MemeSlotsStore();
		const saved = store.save(slot({ caption: 'first' }));
		store.save({ ...slot({ caption: 'second' }), id: saved.id });
		expect(store.list).toHaveLength(1);
		expect(store.list[0]?.caption).toBe('second');
	});

	it('removes slots and persists removals', () => {
		const store = new MemeSlotsStore();
		const saved = store.save(slot());
		new MemeSlotsStore();
		store.remove(saved.id);
		expect(new MemeSlotsStore().list).toHaveLength(0);
	});

	it('normalizes cues/layers and clamps rate + trim on parse', () => {
		const store = new MemeSlotsStore();
		store.save(
			slot({
				sfxCues: [
					{ id: 'c1', sfx: 'boom', atMs: -50, gain: 5 },
					{ id: 'c2', sfx: 'custom', atMs: 100, gain: 1 }
				],
				playbackRate: 9,
				trimStartSec: -3,
				trimEndSec: Number.NaN
			})
		);
		const reopened = new MemeSlotsStore();
		const parsed = reopened.list[0];
		// Negative time coerces to 0, custom-without-soundId drops, gain clamps.
		expect(parsed?.sfxCues).toHaveLength(1);
		expect(parsed?.sfxCues[0]?.atMs).toBe(0);
		expect(parsed?.sfxCues[0]?.gain).toBe(1);
		expect(parsed?.playbackRate).toBe(2);
		expect(parsed?.trimStartSec).toBe(0);
		expect(parsed?.trimEndSec).toBeNull();
	});
});
