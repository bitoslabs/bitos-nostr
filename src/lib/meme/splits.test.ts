import { describe, expect, it } from 'vitest';
import {
	MAX_BASIS_POINTS,
	SPLIT_ROLES,
	TOTAL_BASIS_POINTS,
	splitsOf,
	splitsTagsFor,
	validateSplits
} from './splits';

const row = (role: (typeof SPLIT_ROLES)[number], basisPoints: number, beneficiary?: string) =>
	beneficiary === undefined ? { role, basisPoints } : { role, basisPoints, beneficiary };

describe('validateSplits (10,000-bps domain guard, §7.2)', () => {
	it('accepts a manifest summing to exactly 10,000 bps', () => {
		expect(
			validateSplits([
				row('video_creator', 7_000),
				row('original_creator', 1_000),
				row('sound_creator', 800),
				row('curator', 200),
				row('platform', 500),
				row('effect_creator', 250),
				row('template_creator', 250)
			])
		).toEqual({ ok: true });
	});

	it('accepts a single creator taking 100%', () => {
		expect(validateSplits([row('video_creator', TOTAL_BASIS_POINTS)])).toEqual({ ok: true });
	});

	it('rejects an empty manifest', () => {
		expect(validateSplits([])).toEqual({
			ok: false,
			error: expect.stringContaining('at least one')
		});
	});

	it('rejects sums below and above 10,000 — the exact-total rule from §7.2', () => {
		const under = validateSplits([row('video_creator', 9_999), row('platform', 0)]);
		expect(under.ok).toBe(false);
		if (!under.ok) expect(under.error).toContain('9,999');
		const over = validateSplits([row('video_creator', MAX_BASIS_POINTS), row('platform', 1)]);
		expect(over.ok).toBe(false);
		if (!over.ok) expect(over.error).toContain('10,001');
	});

	it('rejects non-integer and out-of-range basis points (CHECK bounds)', () => {
		expect(validateSplits([row('video_creator', 9_999.5)]).ok).toBe(false);
		expect(validateSplits([row('video_creator', -1), row('platform', 10_001)]).ok).toBe(false);
	});

	it('rejects unknown roles so typos never masquerade as policy', () => {
		// @ts-expect-error deliberate invalid role for the tolerant guard
		const bad = validateSplits([row('videa_creator', 10_000)]);
		expect(bad.ok).toBe(false);
		if (!bad.ok) expect(bad.error).toContain('Unknown role');
	});

	it('rejects duplicate role/beneficiary pairs but allows a role with different beneficiaries', () => {
		const dup = validateSplits([
			row('original_creator', 5_000, 'npub1aa'),
			row('original_creator', 5_000, 'npub1aa')
		]);
		expect(dup.ok).toBe(false);
		if (!dup.ok) expect(dup.error).toContain('Duplicate');
		expect(
			validateSplits([
				row('original_creator', 5_000, 'npub1aa'),
				row('original_creator', 5_000, 'npub1bb')
			])
		).toEqual({ ok: true });
	});
});

describe('splitsTagsFor (wire form)', () => {
	it('emits one value_split tag per row, beneficiary slot optional', () => {
		const tags = splitsTagsFor([row('video_creator', 9_000, 'npub1me'), row('platform', 1_000)]);
		expect(tags).toEqual([
			['value_split', 'video_creator', '9000', 'npub1me'],
			['value_split', 'platform', '1000']
		]);
	});

	it('refuses to serialize an invalid manifest', () => {
		expect(() => splitsTagsFor([row('video_creator', 5_000)])).toThrow(/Refusing/);
	});

	it('rejects overlong beneficiary refs so policy is explicit, not truncated', () => {
		const long = 'x'.repeat(300);
		const result = validateSplits([row('video_creator', 10_000, long)]);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain('too long');
		// The tolerant reader is where capping happens (hostile tags never crash it).
		const parsed = splitsOf([['value_split', 'video_creator', '10000', long]]);
		expect(parsed?.rows[0].beneficiary).toHaveLength(128);
	});
});

describe('splitsOf (tolerant reader, S-013 contract)', () => {
	it('round-trips a serialized manifest', () => {
		const manifest = [row('video_creator', 7_000, 'npub1me'), row('original_creator', 3_000)];
		const parsed = splitsOf(splitsTagsFor(manifest));
		expect(parsed?.rows).toEqual(manifest);
		expect(parsed?.total).toBe(TOTAL_BASIS_POINTS);
		expect(parsed?.droppedMalformed).toBe(false);
	});

	it('returns null for events with no split tags — missing metadata never breaks the reel', () => {
		expect(
			splitsOf([
				['license', 'CC-BY-4.0'],
				['p', 'abc']
			])
		).toBeNull();
		expect(splitsOf([])).toBeNull();
	});

	it('drops malformed rows but keeps the parseable ones, flagging the drop', () => {
		const parsed = splitsOf([
			['value_split', 'video_creator', '9000'],
			['value_split', 'wizard', '1000'], // unknown role → dropped
			['value_split', 'platform', 'not-a-number'], // dropped
			['value_split'], // too short → dropped
			['value_split', 'curator', '500'] // kept
		]);
		expect(parsed?.droppedMalformed).toBe(true);
		expect(parsed?.rows).toEqual([row('video_creator', 9_000), row('curator', 500)]);
		expect(parsed?.total).toBe(9_500);
	});

	it('never returns an over-range row even from hostile tags', () => {
		const parsed = splitsOf([
			['value_split', 'video_creator', String(MAX_BASIS_POINTS)],
			['value_split', 'platform', '9999']
		]);
		// 10000 is within per-row bounds; total over-run is a presentation concern
		// (reader stays tolerant) — rows survive, sum is reported honestly.
		expect(parsed?.rows).toHaveLength(2);
		expect(parsed?.total).toBe(19_999);
	});
});
