/**
 * Pipeline orchestrator — `rankNotes(surface, candidates, ctx)`.
 *
 * Pure function of `(candidates, config, ctx)`:
 *  1. If the surface's master switch is off → strict reverse-chronological.
 *  2. Otherwise score every candidate (Σ signal × weight), normalize weights,
 *     sort descending.
 *  3. Optionally run the diversity pass to avoid author runs.
 *
 * `rankNotesWithBreakdown` additionally returns a per-note explanation used by
 * the "why am I seeing this?" trust feature.
 */
import type { FeedNote } from '$lib/nostr/types';
import { algorithmPreferences } from './preferences.svelte';
import { resolveSignal } from './registry';
import { applyDiversity } from './diversity';
import { negativePenalty } from './penalties';
import { SIGNAL_BY_ID } from './definitions';
import type { ScoringContext, ScoreBreakdown, SurfaceId } from './types';

type Scored<T extends FeedNote> = { note: T; score: number };

/**
 * Main-feed thread treatment. Replies remain discoverable, but original posts
 * should own the top-level feed. A nested reply gets a progressively smaller
 * multiplier instead of being removed outright.
 */
export function threadMultiplier<T extends FeedNote>(
	note: T,
	candidates: Pick<FeedNote, 'id' | 'replyTo'>[],
	surface: SurfaceId
): number {
	if (surface !== 'feed' || !note.replyTo) return 1;

	const parentById = new Map(candidates.map((candidate) => [candidate.id, candidate.replyTo]));
	let depth = 1;
	let parentId: string | undefined = note.replyTo;
	const seen = new Set<string>();
	while (parentId && !seen.has(parentId) && depth < 3) {
		seen.add(parentId);
		const grandParent = parentById.get(parentId);
		if (!grandParent) break;
		depth++;
		parentId = grandParent;
	}

	return depth === 1 ? 0.65 : 0.4;
}

/** Rank candidates for a surface, returning just the reordered notes. */
export function rankNotes<T extends FeedNote>(
	surface: SurfaceId,
	candidates: T[],
	ctx: ScoringContext
): T[] {
	if (!candidates.length) return candidates;

	const cfg = algorithmPreferences.config[surface];

	// Off = chronological, never hidden.
	if (!cfg.enabled) return [...candidates].sort((a, b) => b.createdAt - a.createdAt);

	// Hard-filter notes the user explicitly dismissed, then score the rest.
	const eligible = candidates.filter((n) => negativePenalty(n) > 0);
	if (!eligible.length) return eligible;

	// Total active weight for normalization (so turning signals off re-balances).
	const entries = Object.entries(cfg.signals).filter(([, state]) => state.enabled && state.weight > 0);
	const totalWeight = entries.reduce((sum, [, state]) => sum + state.weight, 0);
	if (totalWeight <= 0) {
		return [...candidates].sort((a, b) => b.createdAt - a.createdAt);
	}

	const scored: Scored<T>[] = eligible.map((note) => {
		let score = 0;
		for (const [id, state] of entries) {
			const fn = resolveSignal(id);
			if (!fn) continue;
			score += (fn(note, ctx) * state.weight) / totalWeight;
		}
		// Soft negative-feedback multiplier (muted author/tag) — pushes down, never hides.
		score *= threadMultiplier(note, candidates, surface) * negativePenalty(note);
		return { note, score };
	});

	scored.sort((a, b) => b.score - a.score);

	const finalScored = cfg.diversityEnabled ? applyDiversity(scored) : scored;
	return finalScored.map((item) => item.note);
}

/**
 * Same as `rankNotes` but also returns a breakdown explaining each note's score.
 * Used by the UI's "why am I seeing this?" explainer. Slightly more work, so the
 * hot render path uses `rankNotes`.
 */
export function rankNotesWithBreakdown<T extends FeedNote>(
	surface: SurfaceId,
	candidates: T[],
	ctx: ScoringContext
): { notes: T[]; breakdown: Map<string, ScoreBreakdown> } {
	if (!candidates.length) return { notes: candidates, breakdown: new Map() };

	const cfg = algorithmPreferences.config[surface];
	if (!cfg.enabled) {
		const notes = [...candidates].sort((a, b) => b.createdAt - a.createdAt);
		return { notes, breakdown: new Map() };
	}
	const eligible = candidates.filter((n) => negativePenalty(n) > 0);
	if (!eligible.length) return { notes: eligible, breakdown: new Map() };

	const entries = Object.entries(cfg.signals).filter(([, state]) => state.enabled && state.weight > 0);
	const totalWeight = entries.reduce((sum, [, state]) => sum + state.weight, 0);
	if (totalWeight <= 0) {
		const notes = [...candidates].sort((a, b) => b.createdAt - a.createdAt);
		return { notes, breakdown: new Map() };
	}

	const withBreakdown: (Scored<T> & { breakdown: ScoreBreakdown })[] = eligible.map((note) => {
		let score = 0;
		const contributions: ScoreBreakdown['contributions'] = [];
		for (const [id, state] of entries) {
			const fn = resolveSignal(id);
			if (!fn) continue;
			const raw = fn(note, ctx);
			const contribution = (raw * state.weight) / totalWeight;
			score += contribution;
			const label = SIGNAL_BY_ID[id]?.label ?? id;
			contributions.push({ signalId: id, label, contribution, raw });
		}
		// Reflect thread position and negative feedback in the final score.
		score *= threadMultiplier(note, candidates, surface) * negativePenalty(note);
		contributions.sort((a, b) => b.contribution - a.contribution);
		const top = contributions[0];
		return {
			note,
			score,
			breakdown: {
				note,
				score,
				contributions,
				topSignal: top ? { signalId: top.signalId, label: top.label } : undefined
			}
		};
	});

	withBreakdown.sort((a, b) => b.score - a.score);
	const finalScored = cfg.diversityEnabled ? applyDiversity(withBreakdown) : withBreakdown;
	const breakdown = new Map<string, ScoreBreakdown>();
	for (const item of finalScored) breakdown.set(item.note.id, item.breakdown);
	return { notes: finalScored.map((item) => item.note), breakdown };
}
