import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { visibleInsertIndex, feed } from './feed.svelte';
import { NOSTR_KINDS } from './types';
import { toFeedNote } from './feed-note';

// feed.comment() publishes through the pool and needs an identity; mock both
// so the publisher test stays hermetic (no network, no localStorage writes).
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('./pool', () => ({
	subscribe: vi.fn(() => () => {}),
	publish: vi.fn(async () => []),
	queryPrimaryFirst: vi.fn(async () => []),
	queryUrls: vi.fn(async () => []),
	queryOnce: vi.fn(async () => []),
	publishUrls: vi.fn(async () => []),
	subscribeUrls: vi.fn(() => () => {})
}));
vi.mock('./identity.svelte', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./identity.svelte')>();
	return actual;
});

describe('visibleInsertIndex', () => {
	it('keeps equal timestamps after existing notes by default', () => {
		const notes = [{ createdAt: 100 }, { createdAt: 100 }, { createdAt: 99 }];
		expect(visibleInsertIndex(notes, { createdAt: 100 })).toBe(2);
	});

	it('places optimistic local notes before equal timestamps when requested', () => {
		const notes = [{ createdAt: 100 }, { createdAt: 100 }, { createdAt: 99 }];
		expect(visibleInsertIndex(notes, { createdAt: 100 }, { preferNewestOnEqual: true })).toBe(0);
	});
});

describe('NIP-22 comment publishing (ADR-003)', () => {
	const target = {
		id: '11'.repeat(32),
		pubkey: '22'.repeat(32),
		kind: NOSTR_KINDS.SHORT_VIDEO
	};
	const parentComment = {
		id: '33'.repeat(32),
		pubkey: '44'.repeat(32),
		kind: NOSTR_KINDS.COMMENT
	};

	beforeEach(() => {
		vi.stubGlobal('localStorage', {
			getItem: vi.fn(() => null),
			setItem: vi.fn(),
			removeItem: vi.fn()
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('rejects comments targeting kind-1 notes (those must use NIP-10 replies)', async () => {
		const { identity } = await import('./identity.svelte');
		identity.importSecret('ab'.repeat(32));
		await expect(
			feed.comment({ ...target, kind: NOSTR_KINDS.TEXT_NOTE }, 'hi', undefined)
		).rejects.toThrow(/reply\(\)/);
	});

	it('builds E/K/P root + e/k/p parent tags per plan §6.5', async () => {
		const { identity } = await import('./identity.svelte');
		const { publish } = await import('./pool');
		identity.importSecret('ab'.repeat(32));
		const note = await feed.comment(target, 'Great edit!', undefined);

		expect(note.replyTo).toBe(target.id);
		const event = vi.mocked(publish).mock.calls.at(-1)![0];
		expect(event.kind).toBe(NOSTR_KINDS.COMMENT);

		const tag = (name: string) => event.tags.find((t) => t[0] === name);
		// Uppercase root profile anchored to the video.
		expect(tag('E')).toEqual(['E', target.id, 'wss://relay.damus.io', target.pubkey]);
		expect(tag('K')).toEqual(['K', String(NOSTR_KINDS.SHORT_VIDEO)]);
		expect(tag('P')).toEqual(['P', target.pubkey, 'wss://relay.damus.io']);
		// Top-level comment: the parent IS the target (e + k mirror E + K).
		expect(tag('e')).toEqual(['e', target.id, 'wss://relay.damus.io', target.pubkey]);
		expect(tag('k')).toEqual(['k', String(NOSTR_KINDS.SHORT_VIDEO)]);
		// Author p-tag for notifications.
		expect(event.tags).toContainEqual(['p', target.pubkey, 'wss://relay.damus.io']);
	});

	it('points lowercase parent tags at the answered comment when nesting', async () => {
		const { identity } = await import('./identity.svelte');
		const { publish } = await import('./pool');
		identity.importSecret('ab'.repeat(32));
		await feed.comment(target, 'Agreed', parentComment);

		const event = vi.mocked(publish).mock.calls.at(-1)![0];
		const tag = (name: string) => event.tags.find((t) => t[0] === name);
		// Root stays anchored to the video…
		expect(tag('E')![1]).toBe(target.id);
		expect(tag('K')).toEqual(['K', String(NOSTR_KINDS.SHORT_VIDEO)]);
		// …but the parent e/k/p now reference the kind-1111 comment.
		expect(tag('e')).toEqual(['e', parentComment.id, 'wss://relay.damus.io', parentComment.pubkey]);
		expect(tag('k')).toEqual(['k', String(NOSTR_KINDS.COMMENT)]);
		expect(event.tags).toContainEqual(['p', parentComment.pubkey, 'wss://relay.damus.io']);
	});
});

describe('addressable video update replacement (F-016)', () => {
	const pubkey = 'ab'.repeat(32);
	const d = 'summer-edit';
	const v1: {
		id: string;
		pubkey: string;
		kind: number;
		content: string;
		created_at: number;
		tags: string[][];
		sig: string;
	} = {
		id: '11'.repeat(32),
		pubkey,
		kind: NOSTR_KINDS.ADDRESSABLE_VIDEO,
		content: 'https://cdn.example/v1.mp4',
		created_at: 1_700_000_000,
		tags: [
			['d', d],
			['imeta', 'url https://cdn.example/v1.mp4', 'm video/mp4']
		],
		sig: 'ff'.repeat(64)
	};
	const v2 = {
		...v1,
		id: '22'.repeat(32),
		content: 'https://cdn.example/v2-hevc.mp4',
		created_at: 1_700_000_500,
		tags: [
			['d', d],
			['imeta', 'url https://cdn.example/v2-hevc.mp4', 'm video/mp4']
		]
	};

	beforeEach(() => {
		feed.clear();
	});

	it('a newer same-address version replaces the stored reel in place', () => {
		feed.upsertNote(toFeedNote(v1));
		feed.upsertNote(toFeedNote(v2));
		// Replacement, not duplication: one slot, newest content/id/address.
		expect(feed.notes).toHaveLength(1);
		expect(feed.notes[0].id).toBe(v2.id);
		expect(feed.notes[0].content).toBe(v2.content);
	});

	it('a stale same-address version is ignored', () => {
		feed.upsertNote(toFeedNote(v2));
		feed.upsertNote(toFeedNote(v1));
		expect(feed.notes).toHaveLength(1);
		expect(feed.notes[0].id).toBe(v2.id);
	});

	it('different d tags and regular kinds stay separate notes', () => {
		feed.upsertNote(toFeedNote(v1));
		feed.upsertNote(toFeedNote({ ...v2, tags: [['d', 'other-edit']] }));
		const regular = { ...v1, id: '33'.repeat(32), kind: NOSTR_KINDS.VIDEO, tags: [] };
		feed.upsertNote(toFeedNote(regular));
		expect(feed.notes).toHaveLength(3);
	});
});

describe('NIP-18 repost kind selection (S-002/SOC-007)', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', {
			getItem: vi.fn(() => null),
			setItem: vi.fn(),
			removeItem: vi.fn()
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	async function repostedEvent(kind: number, tags: string[][] = []) {
		const { identity } = await import('./identity.svelte');
		const { publish } = await import('./pool');
		identity.importSecret('ab'.repeat(32));
		const original = {
			id: '44'.repeat(32),
			pubkey: '55'.repeat(32),
			kind,
			content: 'https://cdn.example/video.mp4',
			created_at: 1_700_000_000,
			tags,
			sig: 'ee'.repeat(64)
		};
		const note = toFeedNote(original);
		await feed.repost(note);
		return vi.mocked(publish).mock.calls.at(-1)![0];
	}

	it('reposts kind-1 notes as kind 6 (NIP-18 classic)', async () => {
		const event = await repostedEvent(NOSTR_KINDS.TEXT_NOTE);
		expect(event.kind).toBe(NOSTR_KINDS.REPOST);
		expect(event.tags).toContainEqual(['e', '44'.repeat(32)]);
	});

	it('reposts videos (21/22/34235/34236) as kind 16 generic reposts', async () => {
		for (const kind of [
			NOSTR_KINDS.VIDEO,
			NOSTR_KINDS.SHORT_VIDEO,
			NOSTR_KINDS.ADDRESSABLE_VIDEO,
			NOSTR_KINDS.ADDRESSABLE_SHORT_VIDEO
		]) {
			const event = await repostedEvent(kind, [['d', 'edit-1']]);
			expect(event.kind, `kind ${kind}`).toBe(NOSTR_KINDS.GENERIC_REPOST);
			// Interoperable tag profile: e/p/k for every client, plus the stable
			// a-coordinate for addressable videos.
			expect(event.tags).toContainEqual(['e', '44'.repeat(32)]);
			expect(event.tags).toContainEqual(['p', '55'.repeat(32)]);
			expect(event.tags).toContainEqual(['k', String(kind)]);
			if (kind === NOSTR_KINDS.ADDRESSABLE_VIDEO || kind === NOSTR_KINDS.ADDRESSABLE_SHORT_VIDEO) {
				expect(event.tags).toContainEqual(['a', `${kind}:${'55'.repeat(32)}:edit-1`]);
			}
			// Embedded JSON keeps full fidelity for clients that only read content.
			expect(JSON.parse(event.content).id).toBe('44'.repeat(32));
		}
	});
});
