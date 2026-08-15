import { describe, expect, it } from 'vitest';
import { mergeNip65Recommendations, parseNip65RelayList } from './nip65';

describe('parseNip65RelayList', () => {
	it('uses an unmarked relay for both reads and writes', () => {
		expect(parseNip65RelayList({ tags: [['r', 'wss://relay.example/']] })).toEqual([
			{ url: 'wss://relay.example', read: true, write: true }
		]);
	});

	it('combines read and write tags and ignores invalid relays', () => {
		expect(
			parseNip65RelayList({
				tags: [
					['r', 'wss://relay.example', 'read'],
					['r', 'wss://relay.example/', 'write'],
					['r', 'https://not-a-relay.example'],
					['p', 'not-a-relay-tag']
				]
			})
		).toEqual([{ url: 'wss://relay.example', read: true, write: true }]);
	});
});

describe('mergeNip65Recommendations', () => {
	it('preserves defaults and appends unique NIP-65 relay URLs', () => {
		const defaults = [{ url: 'wss://default.example', name: 'Default', description: 'Curated' }];
		const result = mergeNip65Recommendations(defaults, [
			{ url: 'wss://default.example', read: true, write: true },
			{ url: 'wss://listed.example', read: true, write: false }
		]);

		expect(result).toEqual([
			defaults[0],
			{
				url: 'wss://listed.example',
				name: 'listed.example',
				description: 'From your NIP-65 relay list · read'
			}
		]);
	});
});

import { buildNip65Tags, relayListSignature } from './nip65';

describe('buildNip65Tags (publishing)', () => {
	it('emits bare r tags for read/write relays and marked tags otherwise', () => {
		const tags = buildNip65Tags([
			{ url: 'wss://both.example/', read: true, write: true },
			{ url: 'wss://read.example', read: true, write: false },
			{ url: 'wss://write.example', read: false, write: true },
			{ url: 'wss://none.example', read: false, write: false }
		]);
		expect(tags).toContainEqual(['r', 'wss://both.example']); // trailing slash normalized
		expect(tags).toContainEqual(['r', 'wss://read.example', 'read']);
		expect(tags).toContainEqual(['r', 'wss://write.example', 'write']);
		expect(tags.find((t) => t[1]?.includes('none'))).toBeUndefined();
	});

	it('signature is order-independent and ignores disabled relays only by flags', () => {
		const a = relayListSignature([
			{ url: 'wss://x.example', read: true, write: true },
			{ url: 'wss://y.example', read: true, write: false }
		]);
		const b = relayListSignature([
			{ url: 'wss://y.example', read: true, write: false },
			{ url: 'wss://x.example', read: true, write: true }
		]);
		expect(a).toBe(b);
		const c = relayListSignature([{ url: 'wss://x.example', read: true, write: true }]);
		expect(a).not.toBe(c);
	});
});
