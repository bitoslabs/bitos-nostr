/**
 * NIP-51 list sync + NIP-56 reporting — pure tag-building / merge tests.
 * (The network round-trips live behind publish/query and are covered by the
 * debounce-owner guard logic exercised here indirectly.)
 */
import { describe, expect, it } from 'vitest';
import {
	pubkeysFromListEvent,
	valuesFromListEvent,
	buildListTags,
	BLOCK_LIST,
	MUTE_LIST,
	INTEREST_SET_LIST
} from './list-sync';
import { buildReportTags, REPORT_REASONS } from './reports';
import type { Event } from 'nostr-tools/pure';

const PK_A = 'a'.repeat(64);
const PK_B = 'b'.repeat(64);

function fakeEvent(partial: Partial<Event>): Event {
	return {
		id: partial.id ?? 'e1',
		pubkey: partial.pubkey ?? PK_A,
		created_at: partial.created_at ?? 0,
		kind: partial.kind ?? 10_000,
		content: '',
		tags: partial.tags ?? [],
		sig: ''
	} as Event;
}

describe('list-sync', () => {
	it('extracts lowercased, valid, deduped p-tag pubkeys', () => {
		const ev = fakeEvent({
			tags: [
				['p', PK_B.toUpperCase()],
				['p', PK_B], // dup after lowering
				['p', 'not-a-pubkey'],
				['p', ''],
				['e', '1234']
			]
		});
		expect(pubkeysFromListEvent(ev)).toEqual([PK_B]);
	});

	it('builds mute list tags with client tag, preserving unknown tags', () => {
		const tags = buildListTags(
			[PK_B],
			[
				['word', 'scam'],
				['expiration', '99']
			],
			MUTE_LIST
		);
		expect(tags).toContainEqual(['p', PK_B]);
		expect(tags).toContainEqual(['word', 'scam']); // preserved verbatim
		expect(tags.find((t) => t[0] === 'expiration')).toBeUndefined(); // stripped
		expect(tags.find((t) => t[0] === 'd')).toBeUndefined(); // plain replaceable
		expect(tags.some((t) => t[0] === 'client')).toBe(true);
	});

	it('builds block list tags with the d=block marker', () => {
		const tags = buildListTags([PK_B], [], BLOCK_LIST);
		expect(tags[0]).toEqual(['d', 'block']);
		expect(tags).toContainEqual(['p', PK_B]);
	});

	it('preserves NIP-01 t-tag (hashtag) mutes on a p-tag mute list', () => {
		const tags = buildListTags([PK_B], [['t', 'spam']], MUTE_LIST);
		expect(tags).toContainEqual(['p', PK_B]);
		expect(tags).toContainEqual(['t', 'spam']); // kept verbatim — not ours to own
	});
});

describe('list-sync interest set (followed hashtags)', () => {
	it('extracts normalized, valid, deduped t-tag hashtags', () => {
		const ev = fakeEvent({
			kind: 30_015,
			tags: [
				['t', 'Bitcoin'],
				['t', '#bitcoin'], // hash-stripped + lowered → dup
				['t', 'nostr'],
				['t', 'x'], // too short
				['t', ''],
				['p', PK_B], // wrong tag type
				['d', 'interest']
			]
		});
		expect(valuesFromListEvent(ev, 't')).toEqual(['bitcoin', 'nostr']);
	});

	it('builds interest set tags with d=interest and t entries', () => {
		const tags = buildListTags(
			['bitcoin', 'nostr'],
			[
				['t', 'stale'], // regenerated — must not duplicate
				['p', PK_B], // unknown tag — preserved verbatim
				['title', 'My interests']
			],
			INTEREST_SET_LIST
		);
		expect(tags[0]).toEqual(['d', 'interest']);
		expect(tags.filter((t) => t[0] === 't')).toEqual([
			['t', 'bitcoin'],
			['t', 'nostr']
		]);
		expect(tags).toContainEqual(['p', PK_B]);
		expect(tags).toContainEqual(['title', 'My interests']);
		expect(tags.some((t) => t[0] === 'client')).toBe(true);
	});
});

describe('reports (NIP-56)', () => {
	it('targets a note with p + e + report tags', () => {
		const tags = buildReportTags({ pubkey: PK_B, noteId: 'note123', reason: 'spam' });
		expect(tags).toContainEqual(['p', PK_B]);
		expect(tags).toContainEqual(['e', 'note123']);
		expect(tags).toContainEqual(['report', 'note123', 'spam']);
	});

	it('targets an account (no e tag) when no note id is given', () => {
		const tags = buildReportTags({ pubkey: PK_B, reason: 'impersonation' });
		expect(tags).toContainEqual(['p', PK_B]);
		expect(tags).not.toContainEqual(['e', PK_B]);
		expect(tags).toContainEqual(['report', PK_B, 'impersonation']);
	});

	it('curated reason ids map 1:1 to NIP-56 values', () => {
		for (const r of REPORT_REASONS) expect(r.value).toBe(r.id);
		expect(REPORT_REASONS.some((r) => r.value === 'other')).toBe(true);
	});
});
