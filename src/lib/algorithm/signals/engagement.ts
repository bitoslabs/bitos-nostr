import type { SignalFn } from '../types';

/**
 * Engagement — reactions + reposts, normalized via a soft log curve so a single
 * viral note doesn't dominate. For reels, the watch-time proxy (dwell) is folded
 * in as an extra, capped boost.
 *
 * The curve is `log10(1 + value) / log10(1 + CAP)` so:
 *   0 engagements → 0,  CAP engagements → 1,  beyond CAP → saturated near 1.
 */
const REACTION_CAP = 12;
const REPOST_WEIGHT = 1.5; // a repost is worth ~1.5 reactions
const REPLY_GUESS_WEIGHT = 0.5; // we don't always have reply counts; presence counts mildly

function normalize(value: number, cap: number): number {
	if (value <= 0) return 0;
	return Math.min(1, Math.log10(1 + value) / Math.log10(1 + cap));
}

export const engagementScore: SignalFn = (note, ctx) => {
	const reactionCount = note.reactions.reduce((sum, reaction) => sum + reaction.count, 0);
	const raw =
		reactionCount + note.repostCount * REPOST_WEIGHT + (note.replyTo ? 0 : REPLY_GUESS_WEIGHT * 0);
	let score = normalize(raw, REACTION_CAP);

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
