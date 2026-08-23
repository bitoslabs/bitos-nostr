/**
 * Trending sounds (user concept #4). Pure ranking over relay events: count cue
 * usage per SFX id across recent `meme`-tagged bitz events, score by usage ×
 * recency decay, expose a previewable ranked list. Custom (device-local) cues
 * never trend — only the nine synth recipes do.
 */
import type { MemeSfxId } from './schema';

export interface TrendingSound {
	sfx: MemeSfxId;
	/** Distinct events using this sound. */
	uses: number;
	/** Distinct authors using this sound. */
	authors: number;
	/** Most recent event created_at (seconds). */
	lastSeen: number;
	/** uses × recency weight (computed at rank time). */
	score: number;
}

/** Half-life for recency decay (days) — a 3-day-old meme counts half. */
export const TREND_HALF_LIFE_DAYS = 3;

export function trendingScore(uses: number, lastSeenSec: number, nowSec: number): number {
	const ageDays = Math.max(0, (nowSec - lastSeenSec) / 86400);
	const decay = Math.pow(0.5, ageDays / TREND_HALF_LIFE_DAYS);
	return uses * decay;
}

/** Rank synth cues used across events. Each event contributes once per sfx. */
export function rankTrendingSounds(
	events: { created_at: number; pubkey: string; tags?: string[][] }[],
	options: { nowSec?: number; minUses?: number } = {}
): TrendingSound[] {
	const now = options.nowSec ?? Math.floor(Date.now() / 1000);
	const minUses = options.minUses ?? 1;
	const bySfx = new Map<MemeSfxId, { uses: number; authors: Set<string>; lastSeen: number }>();
	for (const event of events) {
		const tags = event.tags ?? [];
		const memeTag = tags.find((t) => t[0] === 'meme' && typeof t[1] === 'string');
		if (!memeTag) continue;
		let cues: { s: string }[];
		try {
			const parsed = JSON.parse(memeTag[1]!) as { c?: { s: string }[] };
			cues = Array.isArray(parsed.c) ? parsed.c : [];
		} catch {
			continue;
		}
		const seen = new Set<string>();
		for (const cue of cues) {
			if (!cue || typeof cue.s !== 'string' || seen.has(cue.s)) continue;
			seen.add(cue.s);
			const entry = bySfx.get(cue.s as MemeSfxId) ?? {
				uses: 0,
				authors: new Set<string>(),
				lastSeen: 0
			};
			entry.uses += 1;
			entry.authors.add(event.pubkey);
			entry.lastSeen = Math.max(entry.lastSeen, event.created_at);
			bySfx.set(cue.s as MemeSfxId, entry);
		}
	}
	return [...bySfx.entries()]
		.filter(([sfx]) => SYNTH_IDS.has(sfx))
		.filter(([, e]) => e.uses >= minUses)
		.map(([sfx, e]) => {
			const authors = e.authors.size;
			return {
				sfx,
				uses: e.uses,
				authors,
				lastSeen: e.lastSeen,
				score: trendingScore(e.uses, e.lastSeen, now)
			};
		})
		.sort((a, b) => b.score - a.score);
}

const SYNTH_IDS: Set<string> = new Set([
	'boom',
	'bruh',
	'laugh',
	'whoosh',
	'pop',
	'boing',
	'drumroll',
	'ding',
	'sad-trombone'
]);
