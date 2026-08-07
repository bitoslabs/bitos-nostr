import type { SignalFn } from '../types';

/**
 * Zaps — log-scaled sats received. We read the aggregate already maintained on
 * each FeedNote (`zapTotalSats`), so no extra relay queries are needed.
 *
 * `score = log10(1 + sats) / 5` capped at 1 (≈ 100k sats saturates the signal).
 */
const SAT_SATURATION = 5; // log10 scale: 10^5 = 100k sats → score 1.0

export const zapScore: SignalFn = (note) => {
	const sats = Math.max(0, note.zapTotalSats);
	if (!sats) return 0;
	return Math.min(1, Math.log10(1 + sats) / SAT_SATURATION);
};
