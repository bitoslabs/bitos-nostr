/**
 * Sound-timed captions (user concept #2). Two helpers link SFX cue points and
 * overlay visibility windows without new schema: `syncOverlaysToCues` snaps a
 * caption's [startMs, endMs] window onto cue points (start at the cue, end at
 * the next cue or a fixed tail), and `captionBeatPlan` derives a full
 * karaoke-style plan from a cue sheet — one caption window per cue.
 */
import { normalizeOverlay, type MemeSfxCue, type MemeTextOverlay } from './schema';

/** Default caption visibility tail after a cue fires (ms). */
export const CAPTION_TAIL_MS = 1200;

/** Snap one overlay's window to the nearest cue point. Returns the same
 *  overlay when no usable cue exists (caller keeps control). */
export function syncOverlayToCue(
	overlay: MemeTextOverlay,
	cues: MemeSfxCue[],
	options: { tailMs?: number } = {}
): MemeTextOverlay {
	if (!cues.length) return overlay;
	const sorted = [...cues].sort((a, b) => a.atMs - b.atMs);
	const at = sorted[0]!.atMs;
	const next = sorted.find((c) => c.atMs > at);
	const end = next ? next.atMs - 30 : at + (options.tailMs ?? CAPTION_TAIL_MS);
	return {
		...overlay,
		startMs: at,
		endMs: Math.max(at + 120, end)
	};
}

/** Snap overlays onto cues in order: overlay i ↔ cue i (extras untouched).
 *  Each window starts at its cue and ends 30ms before the next cue (last one
 *  holds for the tail) — a caption cascade that lights up with the beat. */
export function syncOverlaysToCues(
	overlays: MemeTextOverlay[],
	cues: MemeSfxCue[],
	options: { tailMs?: number } = {}
): MemeTextOverlay[] {
	if (!cues.length) return overlays;
	const sorted = [...cues].sort((a, b) => a.atMs - b.atMs);
	const tail = options.tailMs ?? CAPTION_TAIL_MS;
	return overlays.map((overlay, i) => {
		const cue = sorted[i];
		if (!cue) return overlay; // more captions than cues — keep as-is
		const next = sorted[i + 1];
		const end = next ? Math.max(cue.atMs + 120, next.atMs - 30) : cue.atMs + tail;
		return { ...overlay, startMs: cue.atMs, endMs: end };
	});
}

/** One beat plan entry: the cue and the caption window it drives. */
export interface CaptionBeat {
	cueId: string;
	atMs: number;
	startMs: number;
	endMs: number;
}

/** Karaoke plan: each cue gets a caption window [at, next-at) with the last
 *  one held for `tailMs`. Cues must not overlap — windows are half-open. */
export function captionBeatPlan(
	cues: MemeSfxCue[],
	options: { tailMs?: number } = {}
): CaptionBeat[] {
	const tail = options.tailMs ?? CAPTION_TAIL_MS;
	const sorted = [...cues].sort((a, b) => a.atMs - b.atMs);
	return sorted.map((cue, i) => {
		const next = sorted[i + 1];
		const end = next ? Math.max(cue.atMs + 120, next.atMs - 30) : cue.atMs + tail;
		return { cueId: cue.id, atMs: cue.atMs, startMs: cue.atMs, endMs: end };
	});
}

/** Apply a beat plan to caption overlays by index (plan[i] → overlays[i]). */
export function applyBeatPlan(overlays: MemeTextOverlay[], plan: CaptionBeat[]): MemeTextOverlay[] {
	return overlays.map((overlay, i) => {
		const beat = plan[i];
		if (!beat) return overlay;
		return { ...overlay, startMs: beat.startMs, endMs: beat.endMs };
	});
}

/** Normalize a beat-plan output overlay (defensive round-trip). */
export function normalizeTimedOverlay(overlay: MemeTextOverlay): MemeTextOverlay | null {
	return normalizeOverlay(overlay);
}
