import type { SignalFn } from '../types';

/**
 * Engagement — reactions + reposts, normalized via a soft log curve and a
 * lightweight age adjustment so old viral notes do not dominate forever. For
 * reels, the watch-time proxy (dwell) is folded in as an extra, capped boost.
 *
 * The curve is `log10(1 + value) / log10(1 + CAP)` so:
 *   0 engagements → 0,  CAP engagements → 1,  beyond CAP → saturated near 1.
 */
const REACTION_CAP = 12;
const REPOST_WEIGHT = 1.5; // a repost is worth ~1.5 reactions
const DAY_SECONDS = 86_400;

function normalize(value: number, cap: number): number {
	if (value <= 0) return 0;
	return Math.min(1, Math.log10(1 + value) / Math.log10(1 + cap));
}

export const engagementScore: SignalFn = (note, ctx) => {
	const reactionCount = note.reactions.reduce((sum, reaction) => sum + reaction.count, 0);
	const raw = reactionCount + note.repostCount * REPOST_WEIGHT;
	const ageDays = Math.max(0, ctx.now - note.createdAt) / DAY_SECONDS;
	// Measure engagement velocity rather than lifetime totals. The floor keeps
	// proven evergreen posts discoverable while preventing old virality from
	// overwhelming fresh, relevant notes.
	const velocity = raw / Math.max(1, ageDays + 1);
	let score = normalize(velocity, REACTION_CAP);

	// Reels: fold in the dwell-time proxy as a soft extra signal.
	if (ctx.dwell && note.id) {
		const dwell = ctx.dwell.get(note.id);
		if (dwell !== undefined) {
			// Blend: 70% engagement, 30% dwell — capped.
			score = Math.min(1, score * 0.7 + Math.min(1, dwell) * 0.3);
		}
	}
	return score;
};
