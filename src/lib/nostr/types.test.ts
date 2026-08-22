import { describe, expect, it } from 'vitest';
import { applyActivityToNotes } from './zaps';
import { MAX_POLL_VOTERS, NOSTR_KINDS, parsePoll, pollClosedAt, repostTags, repostTarget } from './types';
import { toFeedNote } from './feed-note';

describe('NIP-88 polls', () => {
	it('parses canonical option and endsAt tags', () => {
		expect(parsePoll([
			['option', 'a1', 'Yes'],
			['option', 'b2', 'No']
		])).toEqual([
			{ id: 'a1', label: 'Yes' },
			{ id: 'b2', label: 'No' }
		]);
		expect(pollClosedAt([['endsAt', '1720097117']])).toBe(1720097117);
		expect(NOSTR_KINDS.POLL).toBe(1068);
		expect(NOSTR_KINDS.POLL_RESPONSE).toBe(1018);
	});

	it('keeps parsing the legacy BitOS poll format', () => {
		expect(parsePoll([
			['poll_option', '0', 'A'],
			['poll_option', '1', 'B']
		])).toHaveLength(2);
	});
});

describe('NIP-18 repost interoperability', () => {
	const original = {
		id: 'ab'.repeat(32), pubkey: 'cd'.repeat(32), kind: 30023,
		content: 'image', created_at: 1, tags: [['d', 'photo-1']]
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
		expect(repostTarget(event)).toMatchObject({ eventId: original.id, pubkey: original.pubkey, kind: 1 });
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
