import type { SignalFn } from '../types';

/**
 * Web of trust — quality gate based on graph distance, not popularity.
 *
 *   distance 0 (you follow)   → 1.0
 *   distance ≤ 2 (friend-of)  → 0.6
 *   anyone else               → 0.0   ← Discover uses this as a floor filter
 *
 * The second-hop set (`ctx.wotSet`) is populated lazily + cached so it never
 * blocks ranking or fires storms of relay queries.
 */
export const wotScore: SignalFn = (note, ctx) => {
	if (note.pubkey === ctx.me) return 1;
	if (ctx.followingSet.has(note.pubkey)) return 1;
	if (ctx.wotSet.has(note.pubkey)) return 0.6;
	return 0;
};
