import { describe, expect, it } from 'vitest';
import { decodeEmojiPack, encodeEmojiPack, parseEmojiPack, rankEmojiPacks } from './emoji-packs';

const SAMPLE = {
	id: 'd5e57e00a4abb9e7215e6a1fa85d467c01a5d6374e60b1c02d5140fbaae748b1',
	pubkey: '53bd158b004046a0e095cfe86d3daacef3c6d704ce7a424c4002149ca44822fa',
	kind: 30030,
	tags: [
		['d', 'BOnh7zvRMRMd'],
		['client', 'vector'],
		['title', 'Wokemojis'],
		['image', 'https://blossom.primal.net/cover.png'],
		['emoji', 'woke', 'https://nostr.download/f4042aae.webp'],
		['emoji', 'wokeroll', 'https://nostr.download/edd027cf.gif'],
		['emoji', 'woke', 'https://nostr.download/duplicate.webp'],
		['emoji', '', 'https://nostr.download/noname.webp'],
		['emoji', 'bad', 'http://insecure.example.com/x.png'],
		['emoji', 'kek', 'https://blossom.ditto.pub/a8157679.gif']
	]
};

describe('emoji-packs', () => {
	it('parses the Wokemojis-style kind-30030 event', () => {
		const pack = parseEmojiPack(SAMPLE)!;
		expect(pack).not.toBeNull();
		expect(pack.title).toBe('Wokemojis');
		expect(pack.d).toBe('BOnh7zvRMRMd');
		expect(pack.cover).toBe('https://blossom.primal.net/cover.png');
		expect(pack.emojis).toHaveLength(3);
		expect(pack.emojis[0]).toEqual({ name: 'woke', url: 'https://nostr.download/f4042aae.webp' });
	});

	it('drops duplicates, nameless and non-https emoji tags', () => {
		const pack = parseEmojiPack(SAMPLE)!;
		const names = pack.emojis.map((e) => e.name);
		expect(names).toEqual(['woke', 'wokeroll', 'kek']);
	});

	it('rejects wrong kinds, bad ids and emoji-less packs', () => {
		expect(parseEmojiPack({ ...SAMPLE, kind: 30078 })).toBeNull();
		expect(parseEmojiPack({ ...SAMPLE, id: 'nope' })).toBeNull();
		expect(
			parseEmojiPack({
				...SAMPLE,
				tags: [
					['d', 'x'],
					['title', 'empty']
				]
			})
		).toBeNull();
	});

	it('falls back to the name tag and first emoji for the cover', () => {
		const pack = parseEmojiPack({
			...SAMPLE,
			tags: [
				['d', 'xyz'],
				['name', 'Named Pack'],
				['emoji', 'a', 'https://cdn.example.com/a.png']
			]
		})!;
		expect(pack.title).toBe('Named Pack');
		expect(pack.cover).toBe('https://cdn.example.com/a.png');
	});

	it('round-trips the install-cache wire form', () => {
		const pack = parseEmojiPack(SAMPLE)!;
		const back = decodeEmojiPack(JSON.parse(JSON.stringify(encodeEmojiPack(pack))))!;
		expect(back.title).toBe(pack.title);
		expect(back.emojis).toEqual(pack.emojis);
		expect(back.cover).toBe(pack.cover);
		expect(decodeEmojiPack({ e: 'x' })).toBeNull();
	});

	it('ranks discovery first, own packs last, bigger packs first', () => {
		const own = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
		const a = parseEmojiPack({ ...SAMPLE, id: 'a'.repeat(64), pubkey: own })!;
		const b = parseEmojiPack({
			...SAMPLE,
			id: 'b'.repeat(64),
			pubkey: 'b'.repeat(64),
			tags: [...SAMPLE.tags.slice(0, 8)]
		})!;
		const ranked = rankEmojiPacks([a, b], own);
		expect(ranked[0]!.pubkey).toBe('b'.repeat(64));
	});
});
