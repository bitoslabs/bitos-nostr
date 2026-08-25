import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	MAX_SAVED_TEMPLATES,
	MEME_TEMPLATES_KEY,
	memeTemplates,
	type SavedMemeTemplate
} from './meme-templates.svelte';
import { makeClassicPair, makeOverlay } from '$lib/meme/schema';

// The store no-ops load/persist when not in a browser, and it is a module
// singleton — mock the environment flag BEFORE importing, and reset its state
// between tests via load() against a cleared fake localStorage.
const memory = new Map<string, string>();
const storage = {
	getItem: (key: string) => memory.get(key) ?? null,
	setItem: (key: string, value: string) => void memory.set(key, value),
	removeItem: (key: string) => void memory.delete(key)
};

vi.mock('$app/environment', () => ({ browser: true }));
vi.stubGlobal('localStorage', storage);

function resetStore() {
	memory.clear();
	memeTemplates.list = [];
	memeTemplates.load();
}

afterEach(() => {
	resetStore();
});

describe('memeTemplates.save', () => {
	it('saves a labeled layout and re-applies it with fresh overlay ids', () => {
		const saved = memeTemplates.save('My classic', makeClassicPair());
		expect(saved.label).toBe('My classic');
		expect(memeTemplates.list).toHaveLength(1);
		expect(saved.overlays).toHaveLength(2);

		const applied = memeTemplates.apply(saved);
		expect(applied.map((o) => o.text)).toEqual(saved.overlays.map((o) => o.text));
		// Fresh ids keep applied overlays independently editable/draggable.
		expect(applied.map((o) => o.id)).not.toEqual(saved.overlays.map((o) => o.id));
	});

	it('defaults the label when blank and caps the stored list', () => {
		const saved = memeTemplates.save('   ', [makeOverlay({ text: 'gm' })]);
		expect(saved.label).toMatch(/^Template \d+$/);

		for (let i = 0; i < MAX_SAVED_TEMPLATES + 5; i++) {
			memeTemplates.save(`t${i}`, [makeOverlay({ text: `v${i}` })]);
		}
		expect(memeTemplates.list.length).toBe(MAX_SAVED_TEMPLATES);
		expect(memeTemplates.list[0].label).toBe(`t${MAX_SAVED_TEMPLATES + 4}`); // freshest first
	});

	it('rejects layouts with no usable captions', () => {
		expect(() => memeTemplates.save('empty', [])).toThrow();
		expect(() => memeTemplates.save('blank', [makeOverlay({ text: '   ' })])).toThrow();
	});

	it('normalizes overlay values on save', () => {
		const saved = memeTemplates.save('clamp', [
			{ ...makeOverlay({ text: 'x', x: 9, y: -4, size: 5 }) }
		]);
		const o = saved.overlays[0];
		expect(o.x).toBe(1);
		expect(o.y).toBe(0);
		expect(o.size).toBe(0.22);
	});
});

describe('memeTemplates persistence', () => {
	it('round-trips through localStorage', () => {
		memeTemplates.save('kept', makeClassicPair());
		const raw = memory.get(MEME_TEMPLATES_KEY);
		expect(raw).toBeTruthy();

		// Fresh boot: empty storage + a reset in-memory list starts clean (load
		// early-returns when nothing is stored, so reset the field explicitly).
		memory.clear();
		memeTemplates.list = [];
		memeTemplates.load();
		expect(memeTemplates.list).toHaveLength(0);

		memory.set(MEME_TEMPLATES_KEY, raw!);
		memeTemplates.load();
		expect(memeTemplates.list).toHaveLength(1);
		expect(memeTemplates.list[0].label).toBe('kept');
	});

	it('ignores malformed or foreign-schema storage', () => {
		memory.set(MEME_TEMPLATES_KEY, 'not json{');
		memeTemplates.load();
		expect(memeTemplates.list).toHaveLength(0);

		memory.set(
			MEME_TEMPLATES_KEY,
			JSON.stringify({ schema: 'com.other.thing', version: 1, list: [{ label: 'x' }] })
		);
		memeTemplates.load();
		expect(memeTemplates.list).toHaveLength(0);
	});

	it('drops corrupted rows instead of failing the whole load', () => {
		const good = memeTemplates.save('good', [makeOverlay({ text: 'ok' })]);
		const stored = {
			schema: 'com.bitos.bitz.meme',
			version: 1,
			list: [
				null,
				'junk',
				{ label: 'no overlays', overlays: [] },
				{ label: 'bad row', overlays: [{ text: 'fine' }] },
				good
			]
		};
		memory.set(MEME_TEMPLATES_KEY, JSON.stringify(stored));
		memeTemplates.load();
		const labels = memeTemplates.list.map((t: SavedMemeTemplate) => t.label).sort();
		expect(labels).toEqual(['bad row', 'good']);
	});
});

describe('memeTemplates remove/rename', () => {
	it('removes by id', () => {
		const a = memeTemplates.save('a', [makeOverlay({ text: 'a' })]);
		const b = memeTemplates.save('b', [makeOverlay({ text: 'b' })]);
		memeTemplates.remove(a.id);
		expect(memeTemplates.list.map((t) => t.id)).toEqual([b.id]);
	});

	it('renames with trimming and ignores blank names', () => {
		const a = memeTemplates.save('a', [makeOverlay({ text: 'a' })]);
		memeTemplates.rename(a.id, '  renamed  ');
		expect(memeTemplates.list[0].label).toBe('renamed');
		memeTemplates.rename(a.id, '   ');
		expect(memeTemplates.list[0].label).toBe('renamed');
	});
});
