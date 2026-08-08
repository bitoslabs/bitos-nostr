import { describe, it, expect, beforeEach } from 'vitest';
import type { FeedNote } from '$lib/nostr/types';
import { algorithmPreferences } from './preferences.svelte';
import { applyDiversity } from './diversity';
import { buildAffinity } from './context';
import { rankNotes, rankNotesWithBreakdown } from './pipeline';
import {
	interactionProfile,
	extractTags
} from './interaction-profile.svelte';
import { negativePenalty } from './penalties';
import type { ScoringContext } from './types';

function note(id: string, pubkey: string, createdAt: number, over: Partial<FeedNote> = {}): FeedNote {
	return {
		id,
		pubkey,
		content: '',
		createdAt,
		tags: [],
		reactions: [],
		repostCount: 0,
		zapCount: 0,
		zapTotalSats: 0,
		...over
	};
}

function ctx(over: Partial<ScoringContext> = {}): ScoringContext {
	return {
		now: 10_000_000,
		followingSet: new Set(),
		affinity: new Map(),
		wotSet: new Set(),
		recentAuthors: new Set(),
		recencyHalfLifeSeconds: 6 * 3600,
		...over
	};
}

describe('algorithm pipeline', () => {
	beforeEach(() => {
		algorithmPreferences.load();
		algorithmPreferences.resetAll();
	});

	it('falls back to reverse-chronological when the surface master switch is off', () => {
		algorithmPreferences.toggleSurface('feed', false);
		const candidates = [
			note('old', 'a', 1000),
			note('new', 'a', 9000),
			note('mid', 'a', 5000)
		];
		const ranked = rankNotes('feed', candidates, ctx());
		expect(ranked.map((n) => n.id)).toEqual(['new', 'mid', 'old']);
	});

	it('ranks higher-engagement notes above newer-but-quiet ones when engagement is on', () => {
		// Engagement-heavy config: disable recency/affinity so engagement dominates.
		algorithmPreferences.resetSurface('feed');
		algorithmPreferences.config.feed.signals.recency.enabled = false;
		algorithmPreferences.config.feed.signals.affinity.enabled = false;
		algorithmPreferences.config.feed.signals.zaps.enabled = false;

		const candidates = [
			note('fresh-quiet', 'a', 9_999_000),
			note('older-popular', 'b', 1_000_000, {
				reactions: [{ emoji: '❤️', count: 50, byMe: false }]
			})
		];
		const ranked = rankNotes('feed', candidates, ctx());
		expect(ranked[0].id).toBe('older-popular');
	});

	it('breakdown exposes the dominant contributing signal', () => {
		algorithmPreferences.config.feed.signals.recency.enabled = false;
		algorithmPreferences.config.feed.signals.affinity.enabled = false;
		algorithmPreferences.config.feed.signals.zaps.enabled = false;

		const popular = note('zapped', 'a', 5_000_000, {
			zapTotalSats: 100_000
		});
		// Re-enable zaps only for this assertion.
		algorithmPreferences.config.feed.signals.zaps.enabled = true;
		algorithmPreferences.config.feed.signals.engagement.enabled = false;

		const { breakdown } = rankNotesWithBreakdown('feed', [popular], ctx());
		expect(breakdown.get('zapped')?.topSignal?.signalId).toBe('zaps');
	});
});

describe('diversity pass', () => {
	it('spreads same-author runs without dropping notes', () => {
		const a = note('1', 'alice', 5);
		const b = note('2', 'alice', 4);
		const c = note('3', 'bob', 3);
		const d = note('4', 'alice', 2);
		const scored = [
			{ note: a, score: 0.9 },
			{ note: b, score: 0.8 },
			{ note: c, score: 0.7 },
			{ note: d, score: 0.6 }
		];
		const result = applyDiversity(scored, 2);
		expect(result.map((item) => item.note.id)).toEqual(['1', '3', '2', '4']);
		expect(result).toHaveLength(4); // nothing dropped
	});
});

describe('affinity map', () => {
	const recent = Math.floor(Date.now() / 1000) - 3600; // 1h ago, inside the recency window

	it('rewards authors the user has reacted to', () => {
		const me = 'me';
		const reacted = note('r', 'creator', recent, {
			reactions: [{ emoji: '❤️', count: 1, byMe: true }]
		});
		const quiet = note('q', 'stranger', recent);
		const map = buildAffinity([reacted, quiet], me);
		expect(map.get('creator')).toBeGreaterThan(0);
		expect(map.get('stranger') ?? 0).toBe(0);
	});

	it('ignores the user themself', () => {
		const me = 'me';
		const own = note('o', me, recent, {
			reactions: [{ emoji: '❤️', count: 1, byMe: true }]
		});
		const map = buildAffinity([own], me);
		expect(map.has(me)).toBe(false);
	});
});

describe('dynamic from user activity', () => {
	beforeEach(() => {
		algorithmPreferences.load();
		algorithmPreferences.resetAll();
	});

	it('promotes authors you have reacted to above newer strangers (end-to-end)', () => {
		// Isolate affinity: turn every other signal off so only user activity moves the needle.
		for (const id of Object.keys(algorithmPreferences.config.feed.signals)) {
			algorithmPreferences.config.feed.signals[id].enabled = id === 'affinity';
		}

		const me = 'me';
		// A fresh note from someone you've never interacted with...
		const strangerNote = note('fresh-stranger', 'stranger', 9_999_999);
		// ...and an older note from an author whose work you've reacted to.
		const creatorNote = note('older-creator', 'creator', 1_000_000);
		const affinity = new Map([['creator', 1]]); // built earlier from your ❤️

		const ranked = rankNotes(
			'feed',
			[strangerNote, creatorNote],
			ctx({ me, affinity })
		);
		expect(ranked[0].id).toBe('older-creator');
	});

	it('re-ranks live as bookmarks/affinity change (the feed re-derives reactively)', () => {
		// Same inputs, but no affinity yet → chronology wins (stranger is fresher).
		// Affinity is the only active signal; an empty map ties both scores at 0.
		for (const id of Object.keys(algorithmPreferences.config.feed.signals)) {
			algorithmPreferences.config.feed.signals[id].enabled = id === 'affinity';
		}
		const strangerNote = note('fresh-stranger', 'stranger', 9_999_999);
		const creatorNote = note('older-creator', 'creator', 1_000_000);

		const before = rankNotes('feed', [strangerNote, creatorNote], ctx({ affinity: new Map() }));
		expect(before[0].id).toBe('fresh-stranger');

		// User now bookmarks / interacts with the creator → affinity appears.
		const after = rankNotes(
			'feed',
			[strangerNote, creatorNote],
			ctx({ affinity: new Map([['creator', 1]]) })
		);
		expect(after[0].id).toBe('older-creator');
	});
});

describe('negative feedback (topics / penalties / dismissal)', () => {
	beforeEach(() => {
		algorithmPreferences.load();
		algorithmPreferences.resetAll();
		interactionProfile.clear();
	});

	it('extracts hashtags from tags and inline text', () => {
		const tags = extractTags({
			content: 'loving #bitcoin today',
			tags: [['t', 'Nostr'], ['t', 'bitcoin']]
		});
		expect(tags).toContain('bitcoin');
		expect(tags).toContain('nostr');
	});

	it('hides dismissed notes from the ranked output', () => {
		interactionProfile.dismissNote('dismissed');
		const candidates = [
			note('dismissed', 'a', 9_000_000, {
				reactions: [{ emoji: '❤️', count: 10, byMe: false }]
			}),
			note('kept', 'a', 1_000)
		];
		const ranked = rankNotes('feed', candidates, ctx());
		expect(ranked.map((n) => n.id)).not.toContain('dismissed');
		expect(ranked.map((n) => n.id)).toContain('kept');
	});

	it('penalizes soft-muted authors (still visible, pushed down)', () => {
		interactionProfile.toggleMutedAuthor('noisy');
		// noisier note would otherwise win on engagement, but the penalty pushes it down.
		const noisy = note('n', 'noisy', 5_000_000, {
			reactions: [{ emoji: '❤️', count: 50, byMe: false }]
		});
		const quiet = note('q', 'friend', 4_999_000);
		const penalty = negativePenalty(noisy);
		expect(penalty).toBeLessThan(1);
		expect(negativePenalty(quiet)).toBe(1);
	});

	it('topics signal rewards a tag the user has engaged with', () => {
		// Record interest in #bitcoin by "interacting" with a tagged note.
		interactionProfile.recordInteraction(
			{ pubkey: 'creator', content: '#bitcoin', tags: [['t', 'bitcoin']] },
			1
		);
		const interest = interactionProfile.interestFor('bitcoin');
		expect(interest).toBeGreaterThan(0);

		// Disable everything but topics.
		for (const id of Object.keys(algorithmPreferences.config.feed.signals)) {
			algorithmPreferences.config.feed.signals[id].enabled = id === 'topics';
		}
		const withTag = note('tagged', 'stranger', 1_000, { tags: [['t', 'bitcoin']] });
		const noTag = note('plain', 'stranger', 9_999_999);
		const ranked = rankNotes('feed', [noTag, withTag], ctx());
		expect(ranked[0].id).toBe('tagged');
	});

	it('persists interactions into the profile state the ranker reads', () => {
		interactionProfile.recordInteraction(
			{ pubkey: 'creator', content: '#bitcoin', tags: [['t', 'bitcoin']] },
			2
		);
		interactionProfile.toggleMutedAuthor('spam');
		expect(interactionProfile.state.authorAffinity.creator).toBeGreaterThan(0);
		expect(interactionProfile.state.tagInterest.bitcoin).toBeGreaterThan(0);
		expect(interactionProfile.isAuthorMuted('spam')).toBe(true);
		expect(interactionProfile.affinityFor('creator')).toBeGreaterThan(0);
	});
});
