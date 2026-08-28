/**
 * Trim draft state for the Bitz composer (plan PUB-008).
 *
 * V1 keeps trim as DRAFT state: in/out points bound scrubbing, drive limit
 * re-validation after the cut, and persist with the draft (PUB-010). The
 * actual cut is a render-time concern (PUB-009 `VideoOutputPolicy`) — the
 * bytes uploaded today are still the full-length file, so published metadata
 * must keep reflecting the whole file until the renderer exists.
 *
 * All rules here are pure functions so they can be unit-tested in the server
 * project and reused by whatever UI (or future headless flow) edits drafts.
 */

/** How short a cut may be — below this a "trim" is just a seek. */
export const MIN_TRIM_SECONDS = 1;

/** Published-reel cap: Bitz support videos up to ten minutes. */
export const MAX_PUBLISH_SECONDS = 10 * 60;

/** Draft ceiling used while restoring a video whose source duration is unknown. */
export const MAX_DRAFT_SECONDS = MAX_PUBLISH_SECONDS;

export interface TrimRange {
	/** Cut start in seconds (inclusive). */
	inSeconds: number;
	/** Cut end in seconds (exclusive). */
	outSeconds: number;
}

export interface TrimValidation {
	valid: boolean;
	/** Why the range is unusable, keyed for UI copy. */
	reason?: 'inverted' | 'too-short' | 'over-publish-cap';
	/** Seconds covered by the range (`0` when invalid). */
	durationSeconds: number;
	/** Clamp target that WOULD be valid, for "fix it" affordances. */
	suggested?: TrimRange;
}

/** Clamp arbitrary in/out points to a well-formed range inside [0, duration]. */
export function normalizeTrim(
	points: Partial<TrimRange>,
	sourceDurationSeconds: number
): TrimRange {
	const duration = Number.isFinite(sourceDurationSeconds) ? Math.max(0, sourceDurationSeconds) : 0;
	let inSeconds = Math.min(Math.max(points.inSeconds ?? 0, 0), duration);
	let outSeconds = Math.min(Math.max(points.outSeconds ?? duration, 0), duration);
	if (outSeconds < inSeconds) [inSeconds, outSeconds] = [outSeconds, inSeconds];
	return {
		inSeconds: round3(inSeconds),
		outSeconds: round3(outSeconds)
	};
}

function round3(value: number) {
	return Math.round(value * 1000) / 1000;
}

/** Default range for a source: full length, or the publish cap when shorter. */
export function defaultTrim(sourceDurationSeconds: number): TrimRange {
	const duration = Number.isFinite(sourceDurationSeconds) ? Math.max(0, sourceDurationSeconds) : 0;
	if (duration <= MAX_PUBLISH_SECONDS) {
		return { inSeconds: 0, outSeconds: round3(duration) };
	}
	return { inSeconds: 0, outSeconds: MAX_PUBLISH_SECONDS };
}

/** Validate a range against draft/publish rules. */
export function validateTrim(
	range: TrimRange,
	options: { forPublish?: boolean } = {}
): TrimValidation {
	const durationSeconds = round3(Math.max(0, range.outSeconds - range.inSeconds));
	if (range.outSeconds <= range.inSeconds) {
		return {
			valid: false,
			reason: 'inverted',
			durationSeconds: 0,
			suggested: {
				inSeconds: range.inSeconds,
				outSeconds: round3(range.inSeconds + MIN_TRIM_SECONDS)
			}
		};
	}
	if (durationSeconds < MIN_TRIM_SECONDS) {
		return {
			valid: false,
			reason: 'too-short',
			durationSeconds,
			suggested: {
				inSeconds: range.inSeconds,
				outSeconds: round3(range.inSeconds + MIN_TRIM_SECONDS)
			}
		};
	}
	if (options.forPublish !== false && durationSeconds > MAX_PUBLISH_SECONDS) {
		return {
			valid: false,
			reason: 'over-publish-cap',
			durationSeconds,
			// Shorten from the tail: keep the in-point (usually deliberate).
			suggested: {
				inSeconds: range.inSeconds,
				outSeconds: round3(range.inSeconds + MAX_PUBLISH_SECONDS)
			}
		};
	}
	return { valid: true, durationSeconds };
}

/**
 * Move one edge of an existing range, keeping the other edge Stable and the
 * result inside the source. Dragging an edge past its partner swaps roles,
 * matching how dual-handle timelines behave.
 */
export function adjustTrim(
	range: TrimRange,
	edge: 'in' | 'out',
	value: number,
	sourceDurationSeconds: number
): TrimRange {
	const clamped = Math.min(Math.max(round3(value), 0), Math.max(0, sourceDurationSeconds || 0));
	return edge === 'in'
		? normalizeTrim({ inSeconds: clamped, outSeconds: range.outSeconds }, sourceDurationSeconds)
		: normalizeTrim({ inSeconds: range.inSeconds, outSeconds: clamped }, sourceDurationSeconds);
}

/** Whether a picked source is trimmable at all (needs a known duration). */
export function isTrimmlable(durationSeconds: number | undefined): boolean {
	return (
		durationSeconds !== undefined &&
		Number.isFinite(durationSeconds) &&
		durationSeconds > MIN_TRIM_SECONDS
	);
}

/** The timeline segment the cover-frame scrubber may roam (PUB-008 coupling). */
export function coverScrubBounds(range: TrimRange): { min: number; max: number } {
	return { min: range.inSeconds, max: Math.max(range.inSeconds, range.outSeconds) };
}
