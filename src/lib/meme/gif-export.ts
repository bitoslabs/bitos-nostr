/**
 * True-GIF export planning — decides WHICH moments the offline encoder paints
 * and how long each encoded frame holds. Pure math so the timeline rules are
 * unit-testable without a canvas.
 *
 * The composition's natural length is the LONGEST of its moving parts — base
 * GIF, sound-cue track, animated layers. Animated layers used to be ignored
 * (a static base + GIF layer exported a single frozen frame), and fixed-12fps
 * sampling resampled the base GIF's own cadence. The planner now steps at the
 * source's real frame boundaries, so an exported loop plays the original
 * frames at the original holds.
 */

/** Frame timing slice — DecodedGif frames carry more, the planner needs less. */
export interface FrameTiming {
	/** Frame start in source-local seconds. */
	timestamp: number;
	/** Hold time in seconds. */
	duration: number;
}

export interface GifExportPlanStep {
	/** Composition time to paint (seconds from loop start). */
	atSec: number;
	/** Encoded hold for the painted frame (ms, ≥20 — the GIF centisecond floor). */
	delayMs: number;
}

export interface GifExportPlan {
	steps: GifExportPlanStep[];
	/** Total loop length in seconds (sum of holds). */
	durationSec: number;
	/** True when the 360-frame guard trimmed the loop (callers warn). */
	capped: boolean;
}

/** GIF centisecond floor: delays under 20ms can't be expressed (and browsers
 *  re-clamp sub-2cs delays to 10cs anyway). */
const MIN_STEP_SEC = 0.02;
/** Lightness guard carried over from the studio's GIF export. */
export const MAX_GIF_EXPORT_FRAMES = 360;

/** Total single-pass duration of a frame list (clamped ≥ 0). */
function trackDuration(frames: FrameTiming[]): number {
	return Math.max(
		0,
		frames.reduce((sum, f) => sum + f.duration, 0)
	);
}

/**
 * Plan the export loop.
 *
 * @param baseFrames   decoded BASE gif frames (undefined for image/blank bases)
 * @param layerFrames  decoded frames per animated layer (may be empty)
 * @param cueTrackSec  sound-cue track length (0 when the meme is silent)
 * @param pinnedSec    creator's Length pick — only ever TRIMS (null = auto)
 */
export function planGifExport(
	baseFrames: FrameTiming[] | undefined,
	layerFrames: FrameTiming[][],
	cueTrackSec = 0,
	pinnedSec: number | null = null
): GifExportPlan {
	const baseDur = baseFrames ? trackDuration(baseFrames) : 0;
	// The longest layer defines the loop when nothing else moves longer — its
	// frames become the cadence so the layer plays its ORIGINAL frames.
	let leadLayer: FrameTiming[] | null = null;
	for (const frames of layerFrames) {
		if (!frames.length) continue;
		if (trackDuration(frames) > trackDuration(leadLayer ?? [])) leadLayer = frames;
	}
	const layerDur = trackDuration(leadLayer ?? []);
	const natural = Math.max(baseDur, layerDur, cueTrackSec);
	// A pinned length only trims — a longer pick can't extend the material
	// (the NETSCAPE loop tag handles repetition), matching the old semantics.
	const pinned = pinnedSec !== null && Number.isFinite(pinnedSec) ? Math.max(0, pinnedSec) : null;
	const duration = Math.min(pinned ?? Infinity, natural);

	if (!(duration > 0)) {
		// Nothing animated and no cue clock: a still exports as one frame.
		return { steps: [{ atSec: 0, delayMs: 100 }], durationSec: 0.1, capped: false };
	}

	// Cadence source: the base GIF's own frames when present (exact original
	// timing), else the lead layer's (tiled when the composition runs longer),
	// else uniform 12fps over the cue-driven window.
	const cadence: FrameTiming[] = [];
	if (baseFrames?.length && baseDur > 0) {
		cadence.push(...baseFrames);
	} else if (leadLayer && layerDur > 0) {
		cadence.push(...leadLayer);
	}
	const times: number[] = [];
	if (cadence.length) {
		const passDur = trackDuration(cadence);
		for (let pass = 0; pass * passDur < duration; pass++) {
			for (const f of cadence) {
				const t = pass * passDur + f.timestamp;
				if (t < duration) times.push(t);
			}
		}
	} else {
		for (let t = 0; t < duration; t += 1 / 12) times.push(t);
	}
	times.sort((a, b) => a - b);

	// Collect boundaries, collapsing clusters closer than the centisecond
	// floor so dense cadences can't produce sub-20ms frames. The epsilon keeps
	// exactly-20ms gaps alive (0.02 accumulates FP error either way).
	const kept: number[] = [];
	for (const t of times) {
		if (kept.length && t - kept[kept.length - 1]! < MIN_STEP_SEC - 1e-9) continue;
		kept.push(t);
	}
	// Holds span to the NEXT KEPT boundary (or the loop end) — a collapsed
	// boundary's frame is dropped, so its time folds into the previous hold.
	const steps: GifExportPlanStep[] = kept.map((t, i) => ({
		atSec: t,
		delayMs: Math.round(
			Math.max(MIN_STEP_SEC, Math.min((kept[i + 1] ?? duration) - t, duration - t)) * 1000
		)
	}));
	if (!steps.length) steps.push({ atSec: 0, delayMs: Math.round(duration * 1000) });

	const capped = steps.length > MAX_GIF_EXPORT_FRAMES;
	if (capped) steps.length = MAX_GIF_EXPORT_FRAMES;
	return {
		steps,
		durationSec: steps.reduce((sum, s) => sum + s.delayMs, 0) / 1000,
		capped
	};
}
