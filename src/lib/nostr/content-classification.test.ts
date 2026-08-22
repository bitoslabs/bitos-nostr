import { describe, expect, it } from 'vitest';
import { isProtocolPayload, isMachineTag, humanTags } from './content-classification';

describe('isProtocolPayload', () => {
	it('recognizes serialized channel rosters', () => {
		expect(isProtocolPayload(`channel:__roster\n${'ab'.repeat(80)}`)).toBe(true);
	});

	it('does not hide prose that mentions a channel or a hash', () => {
		expect(isProtocolPayload('channel: __roster\nWelcome to the group.')).toBe(false);
		expect(isProtocolPayload(`The build hash is ${'ab'.repeat(32)}`)).toBe(false);
	});
});

describe('isMachineTag', () => {
	it('recognizes bot coordination tags', () => {
		expect(isMachineTag('udal-friend-aede0a98e7fd3ffef77db169c0ccaaa1')).toBe(true);
		expect(isMachineTag('udal-peer-2348e984dab2c63dfbdab100aa1a3974')).toBe(true);
	});

	it('keeps human hashtags', () => {
		expect(isMachineTag('nostr')).toBe(false);
		expect(isMachineTag('bitcoin-price')).toBe(false);
		expect(isMachineTag('udal')).toBe(false);
		expect(isMachineTag('udal-friend-abc')).toBe(false); // too short → not a bot id
	});
});

describe('humanTags', () => {
	it('filters machine tags out of a mixed list', () => {
		expect(
			humanTags(['nostr', 'udal-friend-aede0a98e7fd3ffef77db169c0ccaaa1', 'asknostr'])
		).toEqual(['nostr', 'asknostr']);
	});
});
