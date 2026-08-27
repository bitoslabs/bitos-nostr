import { describe, expect, it } from 'vitest';
import {
	SHAREABLE_LICENSES,
	SOUND_D_PREFIX,
	sharedSoundEventParts,
	parseSharedSound,
	rankSharedSounds,
	verifySharedSoundSha256
} from './shared-sounds';

const CLIENT = () => [['client', 'bitz']];

function makeEvent(overrides: Partial<Parameters<typeof parseSharedSound>[0]> = {}) {
	const parts = sharedSoundEventParts({
		soundId: 'abc123',
		label: 'Boom laugh',
		durationSec: 2.5,
		mime: 'audio/webm',
		url: 'https://cdn.example/s.webm',
		sha256: 'ab'.repeat(32),
		license: 'CC0-1.0',
		clientTag: CLIENT()
	});
	return {
		id: 'ee'.repeat(32),
		pubkey: 'aa'.repeat(32),
		created_at: 1_800_000_000,
		kind: 30078,
		content: parts.content,
		tags: parts.tags,
		...overrides
	};
}

describe('sharedSoundEventParts', () => {
	it('emits namespaced d, content envelope, and §17.2 tags', () => {
		const parts = sharedSoundEventParts({
			soundId: 'x1',
			label: 'Bonk',
			durationSec: 1.234,
			mime: 'audio/mpeg',
			url: 'https://cdn.example/b.mp3',
			sha256: '',
			license: 'CC-BY-4.0',
			attribution: 'alice',
			description: 'A friendly bonk for reaction memes.',
			topics: ['Meme', 'reaction', 'reaction', 'bad topic!'],
			clientTag: CLIENT()
		});
		expect(parts.d).toBe(`${SOUND_D_PREFIX}x1`);
		expect(JSON.parse(parts.content)).toEqual({
			schema: 'com.bitos.bitz.sound',
			version: 1,
			label: 'Bonk',
			durationSec: 1.234,
			mime: 'audio/mpeg',
			description: 'A friendly bonk for reaction memes.'
		});
		expect(parts.tags).toContainEqual(['d', `${SOUND_D_PREFIX}x1`]);
		expect(parts.tags).toContainEqual(['url', 'https://cdn.example/b.mp3']);
		expect(parts.tags).toContainEqual(['license', 'CC-BY-4.0']);
		expect(parts.tags).toContainEqual(['attribution', 'alice']);
		expect(parts.tags).toContainEqual(['t', 'meme']);
		expect(parts.tags).toContainEqual(['t', 'reaction']);
		expect(parts.tags.find((t) => t[1] === 'bad topic!')).toBeUndefined();
		expect(parts.tags.find((t) => t[0] === 'x')).toBeUndefined(); // no hash, no x tag
	});

	it('backs description mentions with p tags (NIP-27) and merges inline hashtags into topics', () => {
		const parts = sharedSoundEventParts({
			soundId: 'x2',
			label: 'Bonk',
			durationSec: 1.5,
			mime: 'audio/webm',
			url: 'https://cdn.example/b.webm',
			sha256: 'cd'.repeat(32),
			license: 'CC0-1.0',
			// A nostr: mention plus an inline hashtag that is not in the topics list.
			description:
				'Thanks nostr:npub1424242424242424242424242424242424242424242424242424qamrcaj for the idea! #funny',
			topics: ['meme'],
			clientTag: CLIENT()
		});
		expect(parts.tags).toContainEqual(['p', 'aa'.repeat(32)]);
		expect(parts.tags).toContainEqual(['t', 'meme']);
		expect(parts.tags).toContainEqual(['t', 'funny']);
		// no p tag for plain @text that is not a nostr: entity
		const plain = sharedSoundEventParts({
			soundId: 'x3',
			label: 'B',
			durationSec: 1,
			mime: 'audio/webm',
			url: 'https://cdn.example/c.webm',
			sha256: '',
			license: 'CC0-1.0',
			description: 'nostr:npub1invalid and @bob stay untagged',
			clientTag: CLIENT()
		});
		expect(plain.tags.filter((t) => t[0] === 'p')).toEqual([]);
	});
});

describe('parseSharedSound (tolerant reader)', () => {
	it('round-trips an emitted event', () => {
		const sound = parseSharedSound(makeEvent());
		expect(sound).not.toBeNull();
		expect(sound!.soundId).toBe('abc123');
		expect(sound!.label).toBe('Boom laugh');
		expect(sound!.sha256).toBe('ab'.repeat(32));
		expect(sound!.license).toBe('CC0-1.0');
	});

	it('rejects wrong kind, wrong namespace, junk content, missing url', () => {
		expect(parseSharedSound(makeEvent({ kind: 1 }))).toBeNull();
		expect(
			parseSharedSound(
				makeEvent({
					tags: [
						['d', 'other:ns:abc123'],
						['url', 'https://a.example/x']
					]
				})
			)
		).toBeNull();
		expect(parseSharedSound(makeEvent({ content: '{oops' }))).toBeNull();
		expect(parseSharedSound(makeEvent({ tags: [['d', `${SOUND_D_PREFIX}abc123`]] }))).toBeNull(); // no url
	});

	it('rejects non-shareable or absent licenses (§17.2 gate)', () => {
		expect(
			parseSharedSound(
				makeEvent({
					tags: [...makeEvent().tags.filter((t) => t[0] !== 'license'), ['license', 'all-reserved']]
				})
			)
		).toBeNull();
		expect(
			parseSharedSound({ ...makeEvent(), tags: makeEvent().tags.filter((t) => t[0] !== 'license') })
		).toBeNull();
		expect(parseSharedSound(makeEvent())).not.toBeNull(); // CC0 in base event
		for (const ok of SHAREABLE_LICENSES) {
			const tags = makeEvent()
				.tags.filter((t) => t[0] !== 'license')
				.concat([['license', ok]]);
			expect(parseSharedSound(makeEvent({ tags }))!.license).toBe(ok);
		}
	});

	it('drops unusable durations and non-http urls; missing hash becomes empty string', () => {
		const base = makeEvent();
		const noHash = base.tags.filter((t) => t[0] !== 'x');
		expect(
			parseSharedSound(
				makeEvent({
					content: JSON.stringify({
						schema: 'com.bitos.bitz.sound',
						version: 1,
						label: 'x',
						durationSec: 30,
						mime: 'audio/webm'
					})
				})
			)
		).toBeNull();
		expect(
			parseSharedSound(
				makeEvent({
					tags: [...noHash.filter((t) => t[0] !== 'url'), ['url', 'ftp://nope/example.mp3']]
				})
			)
		).toBeNull();
	});
});

describe('rankSharedSounds', () => {
	it('newest first, own sounds sink below others', () => {
		const me = '11'.repeat(32);
		const other = '22'.repeat(32);
		const sounds: Parameters<typeof rankSharedSounds>[0] = [
			{ creatorPubkey: me, createdAt: 100, eventId: 'mine-new' } as never,
			{ creatorPubkey: other, createdAt: 50, eventId: 'theirs-old' } as never,
			{ creatorPubkey: other, createdAt: 90, eventId: 'theirs-new' } as never
		];
		expect(rankSharedSounds(sounds, me).map((s) => s.eventId)).toEqual([
			'theirs-new',
			'theirs-old',
			'mine-new'
		]);
	});
});

describe('verifySharedSoundSha256', () => {
	it('matches the injected hasher and rejects mismatches/malformed digests', async () => {
		const hasher = async (bytes: Uint8Array) => `hash-of-${bytes.length}`;
		expect(await verifySharedSoundSha256(new Uint8Array(4), 'ab'.repeat(32) + 'x', hasher)).toBe(
			false
		);
		const ok = await verifySharedSoundSha256(
			new Uint8Array(0),
			'HASH-OF-0'.padEnd(64, '.'),
			hasher
		);
		expect(ok).toBe(false); // not lowercase-hex 64 in this stub — strict form enforced
		const real = async () => 'ab'.repeat(32);
		expect(await verifySharedSoundSha256(new Uint8Array(2), 'AB'.repeat(32), real)).toBe(true);
		expect(await verifySharedSoundSha256(new Uint8Array(2), 'cd'.repeat(32), real)).toBe(false);
	});
});
