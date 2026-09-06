import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (key: string) => memory.get(key) ?? null,
	setItem: (key: string, value: string) => void memory.set(key, value),
	removeItem: (key: string) => void memory.delete(key)
});

const { recentHashtags, RECENT_HASHTAGS_KEY } = await import('./recent-hashtags.svelte');

describe('recentHashtags cache', () => {
	beforeEach(() => {
		memory.clear();
		recentHashtags.clear();
	});

	it('records hashtags from posted content, most-recent-first', () => {
		recentHashtags.record('hello #Nostr world');
		expect(recentHashtags.tags).toEqual(['nostr']);

		recentHashtags.record('again with #bitcoin and #nostr');
		expect(recentHashtags.tags).toEqual(['bitcoin', 'nostr']);
	});

	it('deduplicates within a single post', () => {
		recentHashtags.record('#meme #Meme #memes');
		expect(recentHashtags.tags).toEqual(['meme', 'memes']);
	});

	it('moves a reused tag to the front instead of duplicating it', () => {
		recentHashtags.record('#aa #bb');
		recentHashtags.record('#cc #aa');
		expect(recentHashtags.tags).toEqual(['cc', 'aa', 'bb']);
	});

	it('ignores content without hashtags', () => {
		recentHashtags.record('just a plain note');
		expect(recentHashtags.tags).toEqual([]);
		expect(memory.get(RECENT_HASHTAGS_KEY)).toBeUndefined();
	});

	it('caps the history length', () => {
		recentHashtags.record('#t01 #t02 #t03 #t04 #t05 #t06 #t07 #t08 #t09 #t10 #t11 #t12 #t13');
		expect(recentHashtags.tags).toHaveLength(12);
		expect(recentHashtags.tags[0]).toBe('t01');
		expect(recentHashtags.tags).not.toContain('t13');
	});

	it('persists and reloads from localStorage', () => {
		recentHashtags.record('#persisted #gone');
		const fresh = memory.get(RECENT_HASHTAGS_KEY)!;
		expect(JSON.parse(fresh)).toEqual(['persisted', 'gone']);

		recentHashtags.clear();
		memory.set(RECENT_HASHTAGS_KEY, fresh);
		recentHashtags.load();
		expect(recentHashtags.tags).toEqual(['persisted', 'gone']);
	});

	it('drops malformed entries on load', () => {
		memory.set(RECENT_HASHTAGS_KEY, JSON.stringify(['ok', 'x', 42, null, '#spaced tag']));
		recentHashtags.load();
		expect(recentHashtags.tags).toEqual(['ok']);
	});

	it('removes a single tag and clears everything', () => {
		recentHashtags.record('#aa #bb #cc');
		recentHashtags.remove('BB');
		expect(recentHashtags.tags).toEqual(['aa', 'cc']);

		recentHashtags.clear();
		expect(recentHashtags.tags).toEqual([]);
		expect(memory.get(RECENT_HASHTAGS_KEY)).toBeUndefined();
	});
});
