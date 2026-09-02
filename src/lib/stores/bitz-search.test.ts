import { describe, expect, it } from 'vitest';
import type { ReelNote } from '$lib/stores/bitz-session.svelte';
import {
	BitzSearchStore,
	BITZ_SEARCH_DEBOUNCE_MS,
	highlightSegments,
	matchBitz,
	tokenizeQuery
} from './bitz-search.svelte';

function reel(partial: Partial<ReelNote> & { id: string }): ReelNote {
	return {
		pubkey: 'author-pubkey',
		content: '',
		createdAt: 1000,
		tags: [],
		reactions: [],
		repostCount: 0,
		zapCount: 0,
		zapTotalSats: 0,
		mediaUrl: 'https://cdn.example/video.mp4',
		mediaType: 'video',
		...partial
	} as ReelNote;
}

const matchOpts = {
	captionOf: (r: ReelNote) => r.content.replace('CAPTION:', ''),
	authorOf: () => 'Satoshi Vision'
};

describe('tokenizeQuery', () => {
	it('splits and lowercases words, dropping empties', () => {
		expect(tokenizeQuery('  Bitcoin   LIGHTNING ')).toEqual(['bitcoin', 'lightning']);
	});
});

describe('highlightSegments', () => {
	it('marks the matched span and keeps surroundings plain', () => {
		expect(highlightSegments('Love lightning', ['lightning'])).toEqual([
			{ text: 'Love ', match: false },
			{ text: 'lightning', match: true }
		]);
	});

	it('marks multiple matches across the string', () => {
		const segments = highlightSegments('zap zap sat', ['zap']);
		expect(segments.filter((s) => s.match).length).toBe(2);
	});

	it('returns one plain segment when nothing matches', () => {
		expect(highlightSegments('nope', ['zap'])).toEqual([{ text: 'nope', match: false }]);
	});
});

describe('matchBitz', () => {
	it('matches caption, content, and author fields', () => {
		const hit = matchBitz(
			reel({ id: 'm1', content: 'CAPTION: lightning zaps' }),
			['zap'],
			matchOpts
		);
		expect(hit?.content).toBeGreaterThanOrEqual(0);
	});

	it('requires every token to be present', () => {
		const bitz = reel({ id: 'm2', content: 'CAPTION: lightning only' });
		expect(matchBitz(bitz, ['lightning', 'missing'], matchOpts)).toBeNull();
	});

	it('returns -1 indexes for fields that did not match', () => {
		const hit = matchBitz(reel({ id: 'm3', content: 'CAPTION: zap roundup' }), ['zap'], matchOpts);
		expect(hit?.caption).toBeGreaterThanOrEqual(0);
		expect(hit?.author).toBe(-1);
	});

	it('treats the author name as a matchable field', () => {
		const hit = matchBitz(
			reel({ id: 'm4', content: 'CAPTION: unrelated' }),
			['satoshi'],
			matchOpts
		);
		expect(hit?.author).toBeGreaterThanOrEqual(0);
	});
});

describe('BitzSearchStore', () => {
	function makeStore(overrides: Partial<ConstructorParameters<typeof BitzSearchStore>[0]> = {}) {
		return new BitzSearchStore({
			relaySearch: async () => [],
			eventsToReels: async () => [],
			captionOf: (r: ReelNote) => r.content.replace('CAPTION:', ''),
			authorOf: () => 'Satoshi Vision',
			profileEnsure: () => {},
			mediaKinds: [20, 21, 22],
			videoKinds: [21, 22],
			imageKinds: [20],
			...overrides
		});
	}

	it('matches from the local pool instantly', () => {
		const store = makeStore();
		store.setLocalPool([reel({ id: 'a', content: 'CAPTION: lightning round' })]);
		store.setQuery('lightning');
		expect(store.matches.map((m) => m.id)).toEqual(['a']);
	});

	it('dedupes remote hits against local matches by id', () => {
		const store = makeStore({
			eventsToReels: async () => [reel({ id: 'a', content: 'CAPTION: lightning again' })]
		});
		store.setLocalPool([reel({ id: 'a', content: 'CAPTION: lightning local' })]);
		store.setQuery('lightning');
		return store.searchNow().then(() => {
			expect(store.matches.length).toBe(1);
			// the local copy wins the merge order
			expect(store.matches[0].content).toContain('local');
		});
	});

	it('queries only the configured standard media kinds', async () => {
		let requests: { kinds: number[]; limit: number; search: string }[] = [];
		const store = makeStore({
			mediaKinds: [20, 21, 22, 34235, 34236],
			relaySearch: async (nextRequests) => {
				requests = nextRequests;
				return [];
			}
		});
		store.setQuery('lightning');
		await store.searchNow();
		expect(requests).toEqual([
			{ kinds: [20, 21, 22, 34235, 34236], limit: 80, search: 'lightning' }
		]);
	});

	it('uses only NIP-71 video kinds when the Videos filter is selected', async () => {
		let requests: { kinds: number[]; limit: number; search: string }[] = [];
		const store = makeStore({
			mediaKinds: [20, 21, 22, 34235, 34236],
			videoKinds: [21, 22, 34235, 34236],
			relaySearch: async (nextRequests) => {
				requests = nextRequests;
				return [];
			}
		});
		store.filter = 'video';
		store.setQuery('lightning');
		await store.searchNow();
		expect(requests).toEqual([
			{ kinds: [21, 22, 34235, 34236], limit: 80, search: 'lightning' }
		]);
	});

	it('applies the media filter to results', () => {
		const store = makeStore();
		store.setLocalPool([
			reel({ id: 'v', content: 'CAPTION: clip', mediaType: 'video' }),
			reel({ id: 'i', content: 'CAPTION: clip', mediaType: 'image' })
		]);
		store.setQuery('clip');
		store.filter = 'image';
		expect(store.matches.map((m) => m.id)).toEqual(['i']);
	});

	it('filters to creator matches only when author matched', () => {
		const names: Record<string, string> = {
			'by-author': 'Satoshi Vision',
			'by-caption': 'Random Person'
		};
		const store = makeStore({ authorOf: (r) => names[r.id] ?? 'Anonymous' });
		store.setLocalPool([
			reel({ id: 'by-author', content: 'CAPTION: something' }),
			reel({ id: 'by-caption', content: 'CAPTION: satoshi notes' })
		]);
		store.setQuery('satoshi');
		// Both match, but via different fields.
		expect(store.counts.creator).toBe(1);
		store.filter = 'creator';
		// Only the reel whose *author name* contains the token passes the chip.
		expect(store.matches.map((m) => m.id)).toEqual(['by-author']);
	});

	it('sorts by engagement when requested', () => {
		const store = makeStore();
		store.setLocalPool([
			reel({ id: 'quiet', content: 'CAPTION: zap', createdAt: 2000 }),
			reel({
				id: 'loud',
				content: 'CAPTION: zap',
				createdAt: 1000,
				reactions: [{ emoji: '❤️', count: 50, byMe: false }],
				zapCount: 10
			})
		]);
		store.setQuery('zap');
		store.sort = 'engagement';
		expect(store.matches.map((m) => m.id)).toEqual(['loud', 'quiet']);
	});

	it('counts matches per filter for the toolbar chips', () => {
		const store = makeStore();
		store.setLocalPool([
			reel({ id: 'v', content: 'CAPTION: clip', mediaType: 'video' }),
			reel({ id: 'i', content: 'CAPTION: clip', mediaType: 'image' })
		]);
		store.setQuery('clip');
		expect(store.counts).toEqual({ all: 2, video: 1, image: 1, creator: 0 });
	});

	it('debounces the relay round: no query fires before the timer', async () => {
		let calls = 0;
		const store = makeStore({ relaySearch: async () => (calls++, []) });
		store.setQuery('lightning');
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(calls).toBe(0);
		store.setQuery('lightning!');
		await new Promise((resolve) => setTimeout(resolve, BITZ_SEARCH_DEBOUNCE_MS + 80));
		expect(calls).toBe(1);
	});

	it('clears results when the query is emptied', () => {
		const store = makeStore();
		store.setLocalPool([reel({ id: 'a', content: 'CAPTION: lightning' })]);
		store.setQuery('lightning');
		expect(store.matches.length).toBe(1);
		store.setQuery('   ');
		expect(store.matches).toEqual([]);
		expect(store.remote).toEqual([]);
	});

	it('keeps stale relay rounds from overwriting fresher results', async () => {
		const store = makeStore({
			relaySearch: async (requests) => {
				const term = requests[0].search;
				// The "slow" round resolves last but started first.
				if (term === 'slow') await new Promise((resolve) => setTimeout(resolve, 60));
				const event = {
					id: `evt-${term}`,
					pubkey: 'pk',
					kind: 1,
					content: term,
					tags: [] as string[][],
					created_at: 1,
					sig: 'sig'
				};
				return [event];
			},
			eventsToReels: async (events) =>
				events.map((e) => reel({ id: e.id, content: `CAPTION: ${e.content}` }))
		});
		store.setQuery('slow');
		const slowRound = store.searchNow();
		store.setQuery('fast');
		await store.searchNow();
		await slowRound;
		// Only the latest round's events survive the token guard.
		expect(store.remote.map((r) => r.id)).toEqual(['evt-fast']);
	});
});
