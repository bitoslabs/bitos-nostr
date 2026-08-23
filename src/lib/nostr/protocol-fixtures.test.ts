import { describe, expect, it } from 'vitest';
import { buildKind22, latestAddressableEvents, parseBitz } from './bitz-codec';
import { loadProtocolFixtures } from './protocol-fixtures';

const corpora = loadProtocolFixtures();
const allFixtures = corpora.flatMap((corpus) =>
	corpus.fixtures.map((fixture) => ({ ...fixture, provenance: corpus.meta.provenance }))
);

describe('protocol fixture corpus (CORE-010, §21.1)', () => {
	it('loads both corpora with reviewed-spec metadata', () => {
		expect(corpora).toHaveLength(2);
		const provenances = corpora.map((c) => c.meta.provenance).sort();
		expect(provenances).toEqual(['generated', 'public-shaped']);
		for (const corpus of corpora) {
			expect(corpus.meta.schemaVersion).toBe(1);
			expect(corpus.meta.reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect(corpus.meta.anonymized).toBe(true);
			expect(corpus.meta.specRefs.length).toBeGreaterThan(0);
			expect(corpus.meta.reviewNotes.length).toBeGreaterThan(0);
			expect(corpus.fixtures.length).toBeGreaterThan(0);
		}
	});

	it('covers both generated and public-shaped fixtures', () => {
		const ids = allFixtures.map((f) => f.id);
		expect(new Set(ids).size).toBe(ids.length);
		const provenances = new Set(allFixtures.map((f) => f.provenance));
		expect(provenances).toContain('generated');
		expect(provenances).toContain('public-shaped');
	});

	it('rejects corrupt fixture directories loudly', () => {
		expect(() => loadProtocolFixtures('/nonexistent-protocol-dir')).toThrow();
	});
});

describe('golden decode: parseBitz over the fixture corpus', () => {
	for (const fixture of allFixtures) {
		it(`${fixture.provenance}:${fixture.id}`, () => {
			const media = parseBitz(fixture.event);
			if (fixture.expect === null) {
				expect(media).toBeNull();
				return;
			}
			expect(media).not.toBeNull();
			// Exact-shape match: absent optional keys must stay absent so the
			// corpus doubles as a codec-drift tripwire.
			expect(media).toEqual(fixture.expect.media);
		});
	}
});

describe('golden encode: buildKind22 against the checked-in golden', () => {
	it('reproduces the generated corpus goldenEncode byte-for-byte', () => {
		const golden = corpora.find((c) => c.meta.provenance === 'generated')?.goldenEncode;
		expect(golden).toBeDefined();
		const built = buildKind22(golden!.params);
		expect(built).toEqual(golden!.expected);
	});
});

describe('golden selection: latestAddressableEvents over multi-event fixtures (READ-004)', () => {
	const multi = allFixtures.filter((f) => f.events?.length);
	if (!multi.length) it.todo('no multi-event fixtures checked in');
	for (const fixture of multi) {
		it(`${fixture.provenance}:${fixture.id}`, () => {
			const resolved = latestAddressableEvents(fixture.events!);
			expect(resolved.map((e) => e.id)).toEqual(fixture.expectSelection?.winnerIds);
			for (const want of fixture.expectSelection?.winnerMedia ?? []) {
				const winner = resolved.find((e) => e.id === want.id);
				expect(winner).toBeDefined();
				const media = parseBitz(winner!);
				expect(media?.url).toBe(want.url);
				expect(media?.address).toBe(want.address);
			}
		});
	}
});
