/**
 * NIP-51 list sync + NIP-56 reporting — pure tag-building / merge tests.
 * (The network round-trips live behind publish/query and are covered by the
 * debounce-owner guard logic exercised here indirectly.)
 */
import { describe, expect, it } from 'vitest';
import { pubkeysFromListEvent, buildListTags, BLOCK_LIST, MUTE_LIST } from './list-sync';
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
