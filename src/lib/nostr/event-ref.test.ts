import { describe, expect, it } from 'vitest';
import {
	addressableEventRef,
	coordinateOf,
	eventRefFor,
	eventRefKey,
	parseEventRef,
	regularEventRef,
	sameEventRef
} from './event-ref';
import { NOSTR_KINDS } from './types';

const ID = 'ab'.repeat(32);
const PUBKEY = 'cd'.repeat(32);
const D = 'profile-reel';

describe('regularEventRef', () => {
	it('accepts and normalizes 64-hex ids', () => {
		const ref = regularEventRef(`  ${ID.toUpperCase()} `);
		expect(ref).toEqual({ variant: 'event', id: ID });
	});

	it('rejects non-hex / wrong-length ids', () => {
		expect(regularEventRef('nope')).toBeNull();
		expect(regularEventRef('ab'.repeat(31))).toBeNull();
		expect(regularEventRef('')).toBeNull();
	});
});

describe('addressableEventRef', () => {
	it('parses and canonicalizes a kind:pubkey:d coordinate', () => {
		const ref = addressableEventRef(`034236:${PUBKEY}:${D}`);
		expect(ref).toEqual({ variant: 'address', coordinate: `34236:${PUBKEY}:${D}` });
	});

	it('preserves the case-sensitive d-tag verbatim', () => {
		const ref = addressableEventRef(`34236:${PUBKEY}:My_Case-Sensitive.Tag`);
		expect(ref?.coordinate.endsWith(':My_Case-Sensitive.Tag')).toBe(true);
	});

	it('rejects malformed coordinates', () => {
		expect(addressableEventRef(`${PUBKEY}`)).toBeNull();
		expect(addressableEventRef(`34236:zz:${D}`)).toBeNull();
		expect(addressableEventRef('')).toBeNull();
	});
});

describe('eventRefFor', () => {
	it('prefers the addressable coordinate for 34235/34236 with a d-tag', () => {
		const ref = eventRefFor({
			id: ID,
			pubkey: PUBKEY,
			kind: NOSTR_KINDS.ADDRESSABLE_SHORT_VIDEO,
			tags: [['d', D]]
		});
		expect(ref).toEqual({ variant: 'address', coordinate: `34236:${PUBKEY}:${D}` });
	});

	it('falls back to the regular ref without a d-tag or for regular kinds', () => {
		expect(
			eventRefFor({
				id: ID,
				pubkey: PUBKEY,
				kind: NOSTR_KINDS.ADDRESSABLE_SHORT_VIDEO,
				tags: []
			})
		).toEqual({ variant: 'event', id: ID });
		expect(
			eventRefFor({
				id: ID,
				pubkey: PUBKEY,
				kind: NOSTR_KINDS.SHORT_VIDEO,
				tags: [['d', D]]
			})
		).toEqual({ variant: 'event', id: ID });
	});

	it('returns null when neither coordinate nor id is usable', () => {
		expect(eventRefFor({ kind: NOSTR_KINDS.SHORT_VIDEO, tags: [] })).toBeNull();
		expect(
			eventRefFor({ id: 'bad', pubkey: PUBKEY, kind: NOSTR_KINDS.SHORT_VIDEO, tags: [] })
		).toBeNull();
	});
});

describe('eventRefKey / sameEventRef / coordinateOf', () => {
	it('serializes both variants with the §6.1 prefixes', () => {
		expect(eventRefKey(regularEventRef(ID)!)).toBe(`event:${ID}`);
		expect(eventRefKey(addressableEventRef(`34236:${PUBKEY}:${D}`)!)).toBe(
			`addr:34236:${PUBKEY}:${D}`
		);
	});

	it('treats replacement versions of one addressable as the same domain object', () => {
		const v1 = eventRefFor({
			id: '11'.repeat(32),
			pubkey: PUBKEY,
			kind: 34236,
			tags: [['d', D]]
		})!;
		const v2 = eventRefFor({
			id: '22'.repeat(32),
			pubkey: PUBKEY,
			kind: 34236,
			tags: [['d', D]]
		})!;
		expect(v1.variant).toBe('address');
		expect(sameEventRef(v1, v2)).toBe(true);
		expect(sameEventRef(v1, regularEventRef(ID)!)).toBe(false);
	});

	it("exposes the bare coordinate for addressable refs, '' for regular", () => {
		expect(coordinateOf(addressableEventRef(`34236:${PUBKEY}:${D}`)!)).toBe(`34236:${PUBKEY}:${D}`);
		expect(coordinateOf(regularEventRef(ID)!)).toBe('');
	});
});

describe('parseEventRef round-trip', () => {
	it('round-trips both canonical keys', () => {
		for (const raw of [`event:${ID}`, `addr:34236:${PUBKEY}:${D}`]) {
			const parsed = parseEventRef(raw);
			expect(parsed).not.toBeNull();
			expect(eventRefKey(parsed!)).toBe(raw);
		}
	});

	it('returns null for foreign strings', () => {
		expect(parseEventRef(ID)).toBeNull();
		expect(parseEventRef('note1something')).toBeNull();
		expect(parseEventRef('addr:')).toBeNull();
	});
});
