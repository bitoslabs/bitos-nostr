import { describe, expect, it } from 'vitest';
import { NOSTR_KINDS, parsePoll, pollClosedAt } from './types';

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
