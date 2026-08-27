import { describe, expect, it } from 'vitest';
import {
	detectMentionTrigger,
	ensureMentionTracking,
	filterMentionCandidates,
	mentionTokenRegex
} from './mentions';

const candidates = [
	{ pubkey: 'aa'.repeat(32), name: 'Alice', npub: 'npub1alice...' },
	{ pubkey: 'bb'.repeat(32), name: 'Bob ✨', npub: 'npub1bob...' },
	{ pubkey: 'cc'.repeat(32), name: 'carol', npub: 'npub1carol...' }
];

describe('detectMentionTrigger', () => {
	it('detects a fresh @ at the start', () => {
		expect(detectMentionTrigger('@', 1)).toEqual({ start: 0, query: '' });
	});

	it('detects an in-progress query after whitespace', () => {
		expect(detectMentionTrigger('hey @al', 7)).toEqual({ start: 4, query: 'al' });
	});

	it('ignores @ glued to a word (email-style)', () => {
		expect(detectMentionTrigger('mail@host', 9)).toBeNull();
	});

	it('ignores queries containing whitespace', () => {
		expect(detectMentionTrigger('hi @a b', 8)).toBeNull();
	});

	it('caps query length at 40 chars', () => {
		expect(detectMentionTrigger(`@${'a'.repeat(41)}`, 42)).toBeNull();
		expect(detectMentionTrigger(`@${'a'.repeat(40)}`, 41)).toEqual({
			start: 0,
			query: 'a'.repeat(40)
		});
	});
});

describe('mentionTokenRegex', () => {
	it('matches whole-name tokens with boundaries', () => {
		expect(mentionTokenRegex('Bob ✨').test('cc @Bob ✨ later')).toBe(true);
		expect(mentionTokenRegex('alice').test('@alice')).toBe(true);
	});

	it('does not match substrings of longer names', () => {
		expect(mentionTokenRegex('alice').test('@alicia')).toBe(false);
		expect(mentionTokenRegex('alice').test('mail@alice')).toBe(false);
	});

	it('escapes regex metacharacters in names', () => {
		expect(mentionTokenRegex('a.b*c').test('@a.b*c')).toBe(true);
	});
});

describe('filterMentionCandidates', () => {
	it('filters by name (case-insensitive) and npub', () => {
		expect(filterMentionCandidates(candidates, 'AL')).toHaveLength(1);
		expect(filterMentionCandidates(candidates, 'npub1bob')).toHaveLength(1);
	});

	it('returns all (max 8) for an empty query', () => {
		expect(filterMentionCandidates(candidates, ' ')).toHaveLength(3);
	});
});

describe('ensureMentionTracking', () => {
	it('keeps tracked mentions and picks up typed candidate names', () => {
		const tracked = [{ name: 'Alice', npub: 'npub1alice...' }];
		const next = ensureMentionTracking('cc @Alice and @carol', tracked, candidates);
		expect(next).toContainEqual({ name: 'Alice', npub: 'npub1alice...' });
		expect(next).toContainEqual({ name: 'carol', npub: 'npub1carol...' });
		expect(next).not.toContainEqual(expect.objectContaining({ name: 'Bob ✨' }));
	});

	it('does not fabricate mentions for unknown names', () => {
		expect(ensureMentionTracking('@ghost', [], candidates)).toEqual([]);
	});
});
