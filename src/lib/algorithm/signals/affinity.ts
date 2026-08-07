import type { SignalFn } from '../types';

/**
 * Affinity — how much the active user historically interacts with this author.
 * Read straight from the precomputed `ctx.affinity` map (0–1).
 *
 * The map is built once per ranking pass from: authors of notes the user has
 * reacted to / zapped, plus bookmarked authors, with a light recency bias.
 */
export const affinityScore: SignalFn = (note, ctx) => {
	return ctx.affinity.get(note.pubkey) ?? 0;
};
