import { describe, expect, it } from 'vitest';
import { rankTrendingSounds, trendingScore, TREND_HALF_LIFE_DAYS } from './trending';
import { makeClassicPair } from './schema';
import { encodeRemixPayload } from './remix';
import { normalizeSfxCue } from './schema';

function memeTag(cues: { s: string; a: number }[]): string[][] {
	const sfxCues = cues.map((c) => normalizeSfxCue({ sfx: c.s as 'boom', atMs: c.a, gain: 1 })!);
	return [['meme', encodeRemixPayload({ overlays: makeClassicPair(), sfxCues })]];
}

describe('rankTrendingSounds', () => {
	it('counts distinct events per sfx and ranks by score', () => {
		const now = 1_800_000_000;
		const pk = (n: number) => String(n).padStart(64, 'a');
		const boom = memeTag([{ s: 'boom', a: 100 }]);
		const ding = memeTag([{ s: 'ding', a: 100 }]);
		const ranked = rankTrendingSounds(
			[
				{ created_at: now - 1000, pubkey: pk(1), tags: boom },
				{ created_at: now - 2000, pubkey: pk(2), tags: boom },
				{ created_at: now, pubkey: pk(3), tags: ding }
			],
			{ nowSec: now }
		);
		expect(ranked.map((r) => r.sfx)).toEqual(['boom', 'ding']);
		expect(ranked[0]!.uses).toBe(2);
		expect(ranked[0]!.authors).toBe(2);
	});

	it('ignores custom sounds (device-local ids never trend)', () => {
		const now = 1_800_000_000;
		const sfxCues = [normalizeSfxCue({ sfx: 'custom', soundId: 'snd-x', atMs: 1, gain: 1 })!];
		const tags = [['meme', encodeRemixPayload({ overlays: makeClassicPair(), sfxCues })]];
		const ranked = rankTrendingSounds([{ created_at: now, pubkey: 'a'.repeat(64), tags }], {
			nowSec: now
		});
		expect(ranked).toHaveLength(0);
	});

	it('skips events without a meme tag and malformed payloads', () => {
		const now = 1_800_000_000;
		const ranked = rankTrendingSounds(
			[
				{ created_at: now, pubkey: 'a'.repeat(64), tags: [['t', 'bitz']] },
				{ created_at: now, pubkey: 'b'.repeat(64), tags: [['meme', 'not json']] }
			],
			{ nowSec: now }
		);
		expect(ranked).toHaveLength(0);
	});

	it('decays old usage below fresh single use with equal counts', () => {
		const now = 1_800_000_000;
		const old = memeTag([{ s: 'boom', a: 1 }]);
		const fresh = memeTag([{ s: 'ding', a: 1 }]);
		const ranked = rankTrendingSounds(
			[
				{ created_at: now - 86400 * 10, pubkey: 'a'.repeat(64), tags: old },
				{ created_at: now, pubkey: 'b'.repeat(64), tags: fresh }
			],
			{ nowSec: now }
		);
		expect(ranked[0]!.sfx).toBe('ding');
	});

	it('a meme with the same sfx twice counts once', () => {
		const now = 1_800_000_000;
		const double = memeTag([
			{ s: 'boom', a: 100 },
			{ s: 'boom', a: 900 }
		]);
		const ranked = rankTrendingSounds([{ created_at: now, pubkey: 'a'.repeat(64), tags: double }], {
			nowSec: now
		});
		expect(ranked).toHaveLength(1);
		expect(ranked[0]!.uses).toBe(1);
	});
});

describe('trendingScore', () => {
	it('halves every half-life', () => {
		const now = 1_800_000_000;
		const fresh = trendingScore(10, now, now);
		const aged = trendingScore(10, now - TREND_HALF_LIFE_DAYS * 86400, now);
		expect(aged).toBeCloseTo(fresh / 2, 5);
	});
});
