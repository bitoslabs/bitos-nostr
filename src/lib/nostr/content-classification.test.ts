import { describe, expect, it } from 'vitest';
import {
	isProtocolPayload,
	isMachineTag,
	humanTags,
	isMachineEnvelope
} from './content-classification';

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
		expect(isMachineTag('udal-peer-2348e984dab2c63dfbdab100aa1a3974')).toBe(true);		expect(isMachineTag('aegismixv2')).toBe(true);
		expect(isMachineTag('aegis50442a25bdbd01aa')).toBe(true);
		expect(isMachineTag('skillmsg-s5')).toBe(true);	});

	it('keeps human hashtags', () => {
		expect(isMachineTag('nostr')).toBe(false);
		expect(isMachineTag('bitcoin-price')).toBe(false);
		expect(isMachineTag('udal')).toBe(false);
		expect(isMachineTag('udal-friend-abc')).toBe(false); // too short → not a bot id
		expect(isMachineTag('aegis')).toBe(false);
	});
});

describe('humanTags', () => {
	it('filters machine tags out of a mixed list', () => {
		expect(
			humanTags(['nostr', 'udal-friend-aede0a98e7fd3ffef77db169c0ccaaa1', 'asknostr'])
		).toEqual(['nostr', 'asknostr']);
	});
});

describe('isMachineEnvelope', () => {
	it('recognizes swarm handshakes (protocol vocab + key material)', () => {
		expect(
			isMachineEnvelope(
				`{"v":1,"t":"hello","to":"*","from":"peer_3260ec0a6d58e3c72f76","hello":{"peerId":"peer_3260ec0a6d58e3c72f76","nym":"Ksi-31d5","room":"2g6vezd4","kemPub":"${'A'.repeat(400)}"}}`
			)
		).toBe(true);
	});

	it('recognizes mix beacons', () => {
		expect(
			isMachineEnvelope('{"v":1,"to":"*","from":"peer_3260ec0a6d58e3c72f76","t":"mixbeacon"}')
		).toBe(true);
	});

	it('recognizes encrypted transport frames (cipher + iv)', () => {
		expect(
			isMachineEnvelope('{"cipher":"Lc8ZigdCWs7cw9Lt12IBhnEPalwQ4eB9","iv":"NXF293Ay/U1QXK2z"}')
		).toBe(true);
	});

	it('recognizes telemetry probes', () => {
		expect(isMachineEnvelope('{"sonda":"s5","seq":71,"enviado_ms":1788667475935}')).toBe(true);
	});

	it('keeps prose notes untouched', () => {
		expect(isMachineEnvelope('gm nostr, having a great day')).toBe(false);
		expect(isMachineEnvelope('#bitcoin to the moon')).toBe(false);
	});

	it('keeps JSON a human pasted to talk about', () => {
		expect(
			isMachineEnvelope('{"message": "here is the API response I promised you yesterday"}')
		).toBe(false);
	});

	it('keeps empty and malformed payloads out', () => {
		expect(isMachineEnvelope('')).toBe(false);
		expect(isMachineEnvelope('{}')).toBe(false);
		expect(isMachineEnvelope('{"unclosed": ')).toBe(false);
		expect(isMachineEnvelope('[1,2,3]')).toBe(false);
	});
});
