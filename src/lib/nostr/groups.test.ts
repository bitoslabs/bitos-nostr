/**
 * NIP-29 group chat helpers — pure parsing tests.
 */
import { describe, expect, it } from 'vitest';
import {
	normalizeGroupId,
	normalizeGroupRelay,
	groupIdFromAddress,
	parseGroupMetadata,
	parseGroupMessage,
	parseMessageMedia,
	attachmentKind,
	buildGroupMessageTags,
	rosterFromEvent,
	mergeRosterEvents,
	buildAdminActionTags,
	buildGroupDeleteTags,
	DEFAULT_GROUP_RELAYS
} from './groups.svelte';

describe('NIP-09 unsend tags', () => {
	it('targets the message id and the group', () => {
		expect(buildGroupDeleteTags('msg-1', 'general')).toEqual([
			['e', 'msg-1'],
			['h', 'general']
		]);
	});
});

describe('DEFAULT_GROUP_RELAYS', () => {
	it('contains only real, known relays (no placeholders)', () => {
		expect(DEFAULT_GROUP_RELAYS).toEqual(['wss://groups.0x.chat']);
	});
});
import type { Event } from 'nostr-tools/pure';

const HEX_ID = 'a'.repeat(64);

function fakeEvent(partial: Partial<Event>): Event {
	return {
		id: partial.id ?? 'e1',
		pubkey: partial.pubkey ?? 'b'.repeat(64),
		created_at: partial.created_at ?? 0,
		kind: partial.kind ?? 9,
		content: partial.content ?? '',
		tags: partial.tags ?? [],
		sig: ''
	} as Event;
}

describe('normalizeGroupId', () => {
	it('accepts hex32 ids and name-style ids', () => {
		expect(normalizeGroupId(HEX_ID)).toBe(HEX_ID);
		expect(normalizeGroupId('  Cheerful-Straw-Lotus ')).toBe('cheerful-straw-lotus');
	});
	it('rejects garbage', () => {
		expect(normalizeGroupId('')).toBeNull();
		expect(normalizeGroupId('has space')).toBeNull();
		expect(normalizeGroupId('x'.repeat(101))).toBeNull();
	});
});

describe('normalizeGroupRelay', () => {
	it('normalizes host case and strips trailing slashes', () => {
		expect(normalizeGroupRelay('wss://Groups.0x.chat/')).toBe('wss://groups.0x.chat');
		expect(normalizeGroupRelay('wss://relay.example.com/path/')).toBe(
			'wss://relay.example.com/path'
		);
	});
	it('rejects non-relay strings', () => {
		expect(normalizeGroupRelay('not a url')).toBeNull();
		expect(normalizeGroupRelay('http://insecure.example')).toBeNull(); // must be ws(s)
		expect(normalizeGroupRelay('')).toBeNull();
	});
});

describe('groupIdFromAddress', () => {
	it('parses a 39000 address into the group id', () => {
		expect(groupIdFromAddress(`39000:${'c'.repeat(64)}:${HEX_ID}`)).toBe(HEX_ID);
		expect(groupIdFromAddress(`39000:pk:cheerful-straw-lotus`)).toBe('cheerful-straw-lotus');
	});
	it('rejects other kinds / malformed addresses', () => {
		expect(groupIdFromAddress(`1:pk:${HEX_ID}`)).toBeNull();
		expect(groupIdFromAddress('nonsense')).toBeNull();
	});
});

describe('parseGroupMetadata', () => {
	it('reads JSON metadata and prefers the h tag for the id', () => {
		const meta = parseGroupMetadata({
			content: JSON.stringify({ name: 'Nostr', about: 'General chat', picture: 'https://x/y.png' }),
			tags: [['h', HEX_ID]]
		});
		expect(meta).toEqual({
			id: HEX_ID,
			name: 'Nostr',
			about: 'General chat',
			picture: 'https://x/y.png'
		});
	});
	it('falls back to the id as name for non-JSON content', () => {
		const meta = parseGroupMetadata({ content: '', tags: [['h', 'general']] });
		expect(meta?.name).toBe('general');
	});
	it('returns null without an h tag or usable d address', () => {
		expect(parseGroupMetadata({ content: '{}', tags: [] })).toBeNull();
	});
});

describe('parseGroupMessage', () => {
	it('parses a kind 9 message with its h tag', () => {
		const ev = fakeEvent({ kind: 9, content: 'gm', tags: [['h', HEX_ID]] });
		const msg = parseGroupMessage(ev);
		expect(msg?.groupId).toBe(HEX_ID);
		expect(msg?.content).toBe('gm');
		expect(msg?.replyTo).toBeUndefined();
	});
	it('captures the reply target on kind 10 thread replies', () => {
		const ev = fakeEvent({
			kind: 10,
			content: '+1',
			tags: [
				['h', HEX_ID],
				['e', 'root-id', '', 'root'],
				['e', 'reply-id', '', 'reply']
			]
		});
		expect(parseGroupMessage(ev)?.replyTo).toBe('reply-id');
	});
	it('ignores untagged chat events', () => {
		expect(parseGroupMessage(fakeEvent({ kind: 9, content: 'x', tags: [] }))).toBeNull();
		expect(parseGroupMessage(fakeEvent({ kind: 1, tags: [['h', HEX_ID]] }))).toBeNull();
	});
});

describe('parseMessageMedia', () => {
	it('extracts imeta + bare media URLs and strips them from the text', () => {
		const { text, media } = parseMessageMedia(
			'check this https://cdn.example.com/pic.png and https://cdn.example.com/doc.pdf',
			[['imeta', 'url https://cdn.example.com/pic.png']]
		);
		expect(media).toHaveLength(2);
		expect(media[0]).toMatchObject({ url: 'https://cdn.example.com/pic.png', kind: 'image' });
		expect(media[1]).toMatchObject({ url: 'https://cdn.example.com/doc.pdf', kind: 'file' });
		expect(text).toBe('check this and');
	});

	it('classifies videos and ignores non-media URLs', () => {
		expect(attachmentKind('https://x.example/clip.MP4?x=1')).toBe('video');
		expect(attachmentKind('https://x.example/a.webp')).toBe('image');
		expect(attachmentKind('https://x.example/page')).toBe('file');
		const { media } = parseMessageMedia('see https://x.example/page', []);
		expect(media).toHaveLength(0);
	});
});

describe('buildGroupMessageTags (NIP-10 threading)', () => {
	it('top-level message carries only the h tag', () => {
		expect(buildGroupMessageTags('general')).toEqual([['h', 'general']]);
	});

	it('a reply to a top-level message gets one reply marker', () => {
		const tags = buildGroupMessageTags('general', { replyTo: 'abc', rootId: 'abc' });
		expect(tags).toContainEqual(['e', 'abc', '', 'reply']);
		expect(tags.find((t) => t[3] === 'root')).toBeUndefined();
	});

	it('a reply to a reply carries root + reply markers', () => {
		const tags = buildGroupMessageTags('general', { replyTo: 'child', rootId: 'root' });
		expect(tags).toContainEqual(['e', 'root', '', 'root']);
		expect(tags).toContainEqual(['e', 'child', '', 'reply']);
	});
});

describe('parseGroupMessage threading + media', () => {
	it('captures root and reply targets on kind 10 events', () => {
		const ev = fakeEvent({
			kind: 10,
			tags: [
				['h', 'g'],
				['e', 'root-id', '', 'root'],
				['e', 'parent-id', '', 'reply']
			]
		});
		const msg = parseGroupMessage(ev);
		expect(msg?.replyTo).toBe('parent-id');
		expect(msg?.rootId).toBe('root-id');
	});

	it('exposes clean text + parsed attachments', () => {
		const ev = fakeEvent({
			kind: 9,
			content: 'look https://cdn.example.com/dog.jpg',
			tags: [
				['h', 'g'],
				['imeta', 'url https://cdn.example.com/dog.jpg']
			]
		});
		const msg = parseGroupMessage(ev);
		expect(msg?.text).toBe('look');
		expect(msg?.media[0]?.kind).toBe('image');
	});
});

describe('roster (kinds 39001/39002)', () => {
	it('extracts deduped lowercased p-tag pubkeys', () => {
		const roster = rosterFromEvent({
			tags: [
				['p', 'B'.repeat(64).toUpperCase()],
				['p', 'b'.repeat(64)],
				['p', 'bad'],
				['h', 'g']
			]
		});
		expect(roster).toEqual(['b'.repeat(64)]);
	});

	it('merges the newest member + admin state events', () => {
		const old = fakeEvent({ kind: 39001, created_at: 100, tags: [['p', '1'.repeat(64)]] });
		const latest = fakeEvent({
			kind: 39001,
			created_at: 300,
			tags: [['p', '2'.repeat(64)]]
		});
		const admins = fakeEvent({ kind: 39002, created_at: 50, tags: [['p', 'a'.repeat(64)]] });
		const roster = mergeRosterEvents([old, latest, admins]);
		expect(roster.members).toEqual(['2'.repeat(64)]); // newest wins
		expect(roster.admins).toEqual(['a'.repeat(64)]);
	});
});

describe('buildAdminActionTags', () => {
	it('add-user / remove-user target one pubkey', () => {
		expect(buildAdminActionTags('g', 'remove-user', { pubkey: 'p'.repeat(64) })).toEqual([
			['h', 'g'],
			['p', 'p'.repeat(64)]
		]);
	});
	it('permission actions add the P permission tag', () => {
		const tags = buildAdminActionTags('g', 'add-permission', {
			pubkey: 'p'.repeat(64),
			permission: 'admin'
		});
		expect(tags).toEqual([
			['h', 'g'],
			['p', 'p'.repeat(64)],
			['P', 'admin']
		]);
	});
});
