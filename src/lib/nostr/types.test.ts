import { describe, expect, it } from 'vitest';
import { applyActivityToNotes } from './zaps';
import {
	MAX_POLL_VOTERS,
	NOSTR_KINDS,
	addressKey,
	parsePoll,
	pollClosedAt,
	repostTags,
	repostTarget
} from './types';
import { toFeedNote } from './feed-note';

describe('NIP-88 polls', () => {
	it('parses canonical option and endsAt tags', () => {
		expect(
			parsePoll([
				['option', 'a1', 'Yes'],
				['option', 'b2', 'No']
			])
		).toEqual([
			{ id: 'a1', label: 'Yes' },
			{ id: 'b2', label: 'No' }
		]);
		expect(pollClosedAt([['endsAt', '1720097117']])).toBe(1720097117);
		expect(NOSTR_KINDS.POLL).toBe(1068);
		expect(NOSTR_KINDS.POLL_RESPONSE).toBe(1018);
	});

	it('keeps parsing the legacy BitOS poll format', () => {
		expect(
			parsePoll([
				['poll_option', '0', 'A'],
				['poll_option', '1', 'B']
			])
		).toHaveLength(2);
	});
});

describe('NIP-18 repost interoperability', () => {
	const original = {
		id: 'ab'.repeat(32),
		pubkey: 'cd'.repeat(32),
		kind: 30023,
		content: 'image',
		created_at: 1,
		tags: [['d', 'photo-1']]
	};

	it('builds generic repost tags with relay, kind, and address', () => {
		expect(repostTags(original, 'wss://relay.example')).toEqual([
			['e', original.id, 'wss://relay.example'],
			['p', original.pubkey],
			['k', '30023'],
			['a', `30023:${original.pubkey}:photo-1`]
		]);
	});

	it('falls back to embedded JSON when another client omits e/p tags', () => {
		const event = { kind: 6, content: JSON.stringify({ ...original, kind: 1 }), tags: [] };
		expect(repostTarget(event)).toMatchObject({
			eventId: original.id,
			pubkey: original.pubkey,
			kind: 1
		});
	});
});

describe('NIP-22 comment reading (ADR-003 migration)', () => {
	const videoId = '11'.repeat(32);
	const videoAuthor = '22'.repeat(32);
	const commentId = '33'.repeat(32);

	it('resolves replyTo from a kind-1111 top-level comment via lowercase e tag', () => {
		const event = {
			id: commentId,
			pubkey: '44'.repeat(32),
			kind: NOSTR_KINDS.COMMENT,
			content: 'Great edit!',
			created_at: 1_700_000_000,
			tags: [
				['E', videoId, 'wss://relay.example', videoAuthor],
				['K', '22'],
				['P', videoAuthor, 'wss://relay.example'],
				['e', videoId, 'wss://relay.example', videoAuthor],
				['k', '22'],
				['p', videoAuthor, 'wss://relay.example']
			]
		};
		const note = toFeedNote(event as never);
		expect(note.replyTo).toBe(videoId);
	});

	it('falls back to the uppercase E root when no lowercase e tag exists', () => {
		const event = {
			id: commentId,
			pubkey: '44'.repeat(32),
			kind: NOSTR_KINDS.COMMENT,
			content: 'Great edit!',
			created_at: 1_700_000_000,
			tags: [
				['E', videoId, 'wss://relay.example', videoAuthor],
				['K', '22']
			]
		};
		const note = toFeedNote(event as never);
		expect(note.replyTo).toBe(videoId);
	});

	it('prefers the lowercase parent e tag over the uppercase root on nested replies', () => {
		const event = {
			id: '55'.repeat(32),
			pubkey: '44'.repeat(32),
			kind: NOSTR_KINDS.COMMENT,
			content: 'Agreed',
			created_at: 1_700_000_050,
			tags: [
				['E', videoId, '', videoAuthor],
				['K', '22'],
				['e', commentId, '', '44'.repeat(32)],
				['k', '1111']
			]
		};
		const note = toFeedNote(event as never);
		// The parent comment id wins: nesting stays intact for the tree view.
		expect(note.replyTo).toBe(commentId);
	});
});

const POLL_EVENT = {
	id: 'aa'.repeat(32),
	pubkey: 'bb'.repeat(32),
	content: 'Best relays?',
	created_at: 1_700_000_000,
	tags: [
		['option', '0', 'Nos.lol'],
		['option', '1', 'relay.damus.io'],
		['polltype', 'singlechoice']
	]
};

function voteEvent(pubkey: string, optionId: string, at = 1_700_000_100) {
	return {
		id: pubkey.slice(0, 4) + optionId + at,
		pubkey,
		kind: NOSTR_KINDS.POLL_RESPONSE,
		content: '',
		created_at: at,
		tags: [
			['e', POLL_EVENT.id],
			['response', optionId]
		],
		sig: 'ff'.repeat(64)
	};
}

describe('poll voters via applyActivityToNotes', () => {
	it('tallies kind-1018 responses into counts, myVote and a voter list', () => {
		const alice = 'a1'.repeat(32);
		const bob = 'b2'.repeat(32);
		const [note] = applyActivityToNotes(
			[toFeedNote(POLL_EVENT)],
			[voteEvent(alice, '0'), voteEvent(bob, '1'), voteEvent(alice, '1', 1_700_000_200)],
			bob
		);
		expect(note.poll?.totalVotes).toBe(2);
		expect(note.poll?.votes).toEqual({ '1': 2 });
		expect(note.poll?.myVote).toBe('1');
		expect(note.poll?.voters).toHaveLength(2);
		// latest vote wins per pubkey, newest first
		expect(note.poll?.voters?.[0]).toMatchObject({ pubkey: alice, optionId: '1' });
	});

	it('ignores responses that do not match a poll option', () => {
		const [note] = applyActivityToNotes(
			[toFeedNote(POLL_EVENT)],
			[voteEvent('c3'.repeat(32), '999')]
		);
		expect(note.poll?.totalVotes).toBe(0);
		expect(note.poll?.voters).toBeUndefined();
	});

	it('caps the voter list at MAX_POLL_VOTERS', () => {
		const voters = Array.from({ length: MAX_POLL_VOTERS + 20 }, (_, i) =>
			voteEvent((i % 256).toString(16).padStart(2, '0').repeat(32), '0', 1_700_000_000 + i)
		);
		const [note] = applyActivityToNotes([toFeedNote(POLL_EVENT)], voters);
		expect(note.poll?.totalVotes).toBe(MAX_POLL_VOTERS + 20);
		expect(note.poll?.voters).toHaveLength(MAX_POLL_VOTERS);
	});
});

describe('addressable video coordinates (F-016 / ADR-002)', () => {
	const pubkey = 'ab'.repeat(32);

	it('builds kind:pubkey:d coordinates for 34235/34236', () => {
		expect(addressKey(NOSTR_KINDS.ADDRESSABLE_VIDEO, pubkey, [['d', 'summer-edit']])).toBe(
			`34235:${pubkey}:summer-edit`
		);
		expect(addressKey(NOSTR_KINDS.ADDRESSABLE_SHORT_VIDEO, pubkey, [['d', 'reel-7']])).toBe(
			`34236:${pubkey}:reel-7`
		);
	});

	it('returns "" for non-addressable kinds and missing d tags', () => {
		expect(addressKey(NOSTR_KINDS.SHORT_VIDEO, pubkey, [['d', 'x']])).toBe('');
		expect(addressKey(NOSTR_KINDS.VIDEO, pubkey, [['e', 'id']])).toBe('');
		expect(addressKey(NOSTR_KINDS.ADDRESSABLE_VIDEO, pubkey, [['e', 'id']])).toBe('');
	});
});
