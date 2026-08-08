import type { SignalFn } from '../types';

/**
 * Recency — exponential time-decay. Half-life is taken from the context so the
 * global "freshness" control in settings can stretch or compress it without
 * touching each surface's weight.
 *
 * `score = 0.5 ^ (ageSeconds / halfLifeSeconds)`
 */
export const recencyScore: SignalFn = (note, ctx) => {
	const ageSeconds = Math.max(0, ctx.now - note.createdAt);
	const halfLife = ctx.recencyHalfLifeSeconds || 6 * 3600;
	return Math.pow(0.5, ageSeconds / halfLife);
};
