import { describe, expect, it } from 'vitest';
import { decode } from 'nostr-tools/nip19';
import {
	MAX_SHARE_RELAY_HINTS,
	BITZ_DEFAULT_TAG,
	bitzHashLink,
	defaultBitzTags,
	shareEntity,
	sharePayload,
	shareWebLink
} from './bitz-links';

const EVENT_ID = 'f'.repeat(64);
const AUTHOR = 'b'.repeat(64);

describe('shareEntity', () => {
	it('builds a decodable nostr:nevent with author and relay hints', () => {
		const entity = shareEntity({
			eventId: EVENT_ID,
			author: AUTHOR,
			relays: ['wss://one.example', 'wss://two.example']
		});
		expect(entity.startsWith('nostr:nevent1')).toBe(true);
		const decoded = decode(entity.slice('nostr:'.length));
		expect(decoded.type).toBe('nevent');
		const data = decoded.data as { id: string; author?: string; relays?: string[] };
		expect(data.id).toBe(EVENT_ID);
		expect(data.author).toBe(AUTHOR);
		expect(data.relays).toEqual(['wss://one.example', 'wss://two.example']);
	});

	it('omits author/relays when unknown', () => {
		const decoded = decode(shareEntity({ eventId: EVENT_ID }).slice('nostr:'.length));
		const data = decoded.data as { id: string; author?: string; relays?: string[] };
		expect(data.id).toBe(EVENT_ID);
		expect(data.author).toBeUndefined();
		// nostr-tools round-trips absent relays as an empty list — never hints.
		expect(data.relays ?? []).toEqual([]);
	});

	it('caps relay hints and dedupes', () => {
		const relays = Array.from({ length: 8 }, (_, i) => `wss://${i}.example`);
		const decoded = decode(
			shareEntity({ eventId: EVENT_ID, relays: [...relays, 'wss://0.example'] }).slice(
				'nostr:'.length
			)
		);
		const data = decoded.data as { relays?: string[] };
		expect(data.relays).toHaveLength(MAX_SHARE_RELAY_HINTS);
		expect(new Set(data.relays).size).toBe(MAX_SHARE_RELAY_HINTS);
	});
});

describe('shareWebLink', () => {
	it('links to the note route with the bare nevent path', () => {
		const link = shareWebLink(
			{ eventId: EVENT_ID, relays: ['wss://one.example'] },
			'https://bitos.space/'
		);
		expect(link.startsWith('https://bitos.space/note/nevent1')).toBe(true);
		expect(link).not.toContain('%3A'); // bech32 body must survive unescaped
		expect(link).not.toContain('wss%3A');
	});

	it('strips trailing slashes from the origin', () => {
		expect(shareWebLink({ eventId: EVENT_ID }, 'https://x.example///')).toBe(
			`https://x.example/note/${shareEntity({ eventId: EVENT_ID }).slice('nostr:'.length)}`
		);
	});
});

describe('bitzHashLink', () => {
	it('targets the Bitz route hash handler', () => {
		expect(bitzHashLink(EVENT_ID)).toBe(`#reel=${EVENT_ID}`);
	});
});

describe('sharePayload', () => {
	it('carries the entity in text and the web link in url', () => {
		const payload = sharePayload({ eventId: EVENT_ID, author: AUTHOR }, 'https://bitos.space');
		expect(payload.text).toBe(shareEntity({ eventId: EVENT_ID, author: AUTHOR }));
		expect(payload.url).toBe(
			shareWebLink({ eventId: EVENT_ID, author: AUTHOR }, 'https://bitos.space')
		);
		expect(payload.title).toBe('Bitz on BitOS');
	});
});

describe('defaultBitzTags (#bitz)', () => {
	it('appends the community tag when the caption has no hashtags', () => {
		expect(defaultBitzTags([])).toEqual([['t', BITZ_DEFAULT_TAG]]);
	});

	it('does not duplicate an existing explicit #bitz', () => {
		const tags = [
			['t', 'funny'],
			['t', BITZ_DEFAULT_TAG]
		];
		expect(defaultBitzTags(tags)).toEqual(tags);
	});

	it('never overrides an explicit tag set', () => {
		const tags = [['t', 'developer']];
		const out = defaultBitzTags(tags);
		expect(out).toEqual([
			['t', 'developer'],
			['t', BITZ_DEFAULT_TAG]
		]);
		expect(tags).toEqual([['t', 'developer']]); // input untouched
	});
});
