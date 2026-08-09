/**
 * BitOS Algorithm — core types.
 *
 * The ranking system is a pure, client-side pipeline:
 *   rankNotes(surface, candidates, ctx) -> ranked FeedNote[]
 *
 * All persisted state (which signals are on, their weights) lives in the
 * `preferences.svelte.ts` runes singleton. The scoring functions themselves are
 * stateless: they read everything they need from the note and a `ScoringContext`.
 */
import type { FeedNote } from '$lib/nostr/types';

export type SurfaceId = 'feed' | 'reels' | 'discover';

/** A signal = one normalized scoring input (recency, engagement, …). */
export interface SignalDefinition {
	id: string;
	/** Short label shown in the settings UI. */
	label: string;
	/** One-line description of what it rewards. */
	description: string;
	/** Lucide icon name used in the UI. */
	icon: string;
}

/** Per-signal toggle + weight inside a surface. */
export interface SignalState {
	enabled: boolean;
	/** 0–1 relative weight within its surface. */
	weight: number;
}

/** Per-surface configuration. */
export interface SurfaceConfig {
	/** Master switch — off = strict reverse-chronological. */
	enabled: boolean;
	/** Avoid runs of the same author near the top of the ranked output. */
	diversityEnabled: boolean;
	signals: Record<string, SignalState>;
}

/** Full persisted preferences, one entry per surface. */
export interface AlgorithmPreferences {
	feed: SurfaceConfig;
	reels: SurfaceConfig;
	discover: SurfaceConfig;
	/** Optional public-only discovery per surface. */
	relayDiscovery: Record<SurfaceId, boolean>;
}

/** Named preset that applies a full SurfaceConfig in one tap. */
export type PresetId = 'latest' | 'balanced' | 'engagement' | 'trust' | 'custom';

/**
 * The read-only context passed to every signal. It carries the things a signal
 * needs but should not own (the user's follow graph, an interaction-history
 * cache, the current time). Built once per ranking pass from the live stores.
 */
export interface ScoringContext {
	now: number;
	/** Pubkeys the active user follows (distance 0). */
	followingSet: Set<string>;
	/** The active user's own pubkey (excluded from wot). */
	me?: string;
	/** Affinity score 0–1 per author (how much you usually engage with them). */
	affinity: Map<string, number>;
	/**
	 * Pubkeys at web-of-trust distance ≤ 2 (your follows + their follows).
	 * Lazily populated + cached; never blocks ranking.
	 */
	wotSet: Set<string>;
	/**
	 * Authors of the notes currently visible near the top of the feed, used by
	 * the novelty/diversity input to avoid author runs.
	 */
	recentAuthors: Set<string>;
	/**
	 * Dwell-time signal for reels: noteId → 0–1 watch ratio. Folded into the
	 * engagement signal as a soft proxy (Nostr has no native watch event).
	 */
	dwell?: Map<string, number>;
	/** Per-surface recency half-life in seconds (tunable via global freshness). */
	recencyHalfLifeSeconds: number;
}

/** A signal scoring function returns a normalized 0–1 score for one note. */
export type SignalFn = (note: FeedNote, ctx: ScoringContext) => number;

/** The breakdown of why a single note ranked where it did. */
export interface ScoreBreakdown {
	note: FeedNote;
	score: number;
	/** Per-signal contribution (already multiplied by weight). */
	contributions: { signalId: string; label: string; contribution: number; raw: number }[];
	/** The single strongest signal — used for the "why am I seeing this" chip. */
	topSignal?: { signalId: string; label: string };
}
