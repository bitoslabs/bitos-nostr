import type { SignalFn } from '../types';

/**
 * Novelty — a mild diversity boost for authors you have *not* just seen at the
 * top of the feed. Used to keep the surface from becoming an echo chamber.
 *
 *   author recently shown → 0 (penalize slightly)
 *   otherwise             → 1 (neutral / slight boost)
 *
 * The post-scoring `applyDiversity` pass is the hard guarantee (no author runs);
 * this signal is the soft nudge that works *with* the other weights.
 */
export const noveltyScore: SignalFn = (note, ctx) => {
	return ctx.recentAuthors.has(note.pubkey) ? 0 : 1;
};
