/**
 * Speed-ramp track (Bitz Meme Pack V1 — docs/source/templete/tp-2.md Layer 2:
 * Slow Motion / Speed Up segments). Timed windows of playback-rate multipliers
 * riding the zoom-track covenant:
 *
 *  - windows live in MEDIA time (ms); `shiftSpeedsForExport` mirrors the cue
 *    remap convention;
 *  - one track, pure data — the studio preview advances its clock through
 *    `rateAt()` and every export path derives the same curve;
 *  - a window's rate is a multiplier ON TOP of the base export rate, clamped
 *    to the browser-safe 0.5–2 span (slower/faster element decode stays
 *    real-time-recordable — deterministic offline ramps are the V2 plan).
 */
import { MAX_ZOOM_WINDOWS } from './zoom-track';
import type { ZoomWindow } from '$lib/ai/suggest';

/** Cap mirrors the other tracks (16). */
export const MAX_SPEED_WINDOWS = MAX_ZOOM_WINDOWS;

/** Longest single ramp — beyond this, set the base rate instead. */
export const MAX_SPEED_WINDOW_MS = 4000;

/** Browser-safe rate span (matches renderVideoMeme's clamp). */
export const MIN_RATE = 0.5;
export const MAX_RATE = 2;

export interface SpeedWindow {
	/** Start inclusive, end exclusive — media time ms. */
	startMs: number;
	endMs: number;
	/** Playback-rate multiplier for the span (0.5 slow-mo … 2 speed-up). */
	rate: number;
}

/** Compact wire form: [startMs, endMs, rate(2dp)]. */
export type WireSpeed = [number, number, number];

/** Builder guard: a window is valid when it spans time and leaves rate 1. */
export function normalizeSpeedWindow(raw: unknown): SpeedWindow | null {
	if (!raw || typeof raw !== 'object') return null;
	const o = raw as Record<string, unknown>;
	const start = Number(o.startMs);
	const end = Number(o.endMs);
	const rate = Number(o.rate);
	if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(rate)) return null;
	if (end <= start) return null;
	if (Math.abs(rate - 1) < 0.01) return null; // rate 1 = no window at all
	return {
		startMs: Math.max(0, Math.round(start)),
		endMs: Math.min(Math.max(Math.round(end), Math.round(start) + 100), MAX_SPEED_WINDOW_MS),
		rate: Math.min(MAX_RATE, Math.max(MIN_RATE, rate))
	};
}

/** Sort + de-overlap like the fx track — one rate per moment. */
export function normalizeSpeedWindows(raw: unknown): SpeedWindow[] {
	if (!Array.isArray(raw)) return [];
	const rows: SpeedWindow[] = [];
	for (const item of raw.slice(0, MAX_SPEED_WINDOWS)) {
		const win = normalizeSpeedWindow(item);
		if (win) rows.push(win);
	}
	return rows
		.sort((a, b) => a.startMs - b.startMs)
		.filter((win, i, all) => (i === 0 ? true : win.startMs >= all[i - 1]!.endMs - 100));
}

export function speedActiveAt(win: SpeedWindow, atMs: number): boolean {
	return atMs >= win.startMs && atMs < win.endMs;
}

/** The effective rate at media time `atMs` (1 outside every window). */
export function rateAt(windows: SpeedWindow[], atMs: number): number {
	for (const win of windows) {
		if (speedActiveAt(win, atMs)) return win.rate;
	}
	return 1;
}

/**
 * Map an EXPORT-timeline position back to MEDIA time under the rate curve —
 * the preview + recorder paths integrate the curve the same way, so a caption
 * placed at media time T plays at the same visual moment everywhere.
 * Deterministic trapezoid sum over the windows (they never overlap).
 */
export function exportMsToMediaMs(windows: SpeedWindow[], exportMs: number): number {
	if (!windows.length || exportMs <= 0) return exportMs;
	const sorted = [...windows].sort((a, b) => a.startMs - b.startMs);
	let media = 0; // media time consumed so far
	let consumed = 0; // export time consumed so far
	for (const win of sorted) {
		if (exportMs <= consumed) break;
		// Normal-rate span before this window.
		const gapMs = Math.max(0, win.startMs - media);
		if (exportMs - consumed <= gapMs) {
			media += exportMs - consumed;
			consumed = exportMs;
			break;
		}
		media += gapMs;
		consumed += gapMs;
		// Inside the window: export time passes at `rate`× speed.
		const spanMs = win.endMs - win.startMs;
		const exportSpanMs = spanMs / win.rate;
		if (exportMs - consumed <= exportSpanMs) {
			media += (exportMs - consumed) * win.rate;
			consumed = exportMs;
			break;
		}
		media += spanMs;
		consumed += exportSpanMs;
	}
	if (exportMs > consumed) media += exportMs - consumed;
	return media;
}

/** Remap speed windows onto the EXPORT timeline (trim + base rate). */
export function shiftSpeedsForExport(
	windows: SpeedWindow[],
	trimStartSec: number,
	playbackRate: number,
	durationSec: number
): SpeedWindow[] {
	const rate = playbackRate || 1;
	return windows
		.map((win) => ({
			...win,
			startMs: (win.startMs - trimStartSec * 1000) / rate,
			endMs: (win.endMs - trimStartSec * 1000) / rate
		}))
		.filter((win) => win.endMs > 0 && win.startMs < durationSec * 1000);
}

/**
 * Map MEDIA time onto the EXPORT timeline under the rate curve — the forward
 * half of the exportMsToMediaMs pair. Drives export duration math and cue
 * remap: a cue pinned at media t fires at mediaMsToExportMs(t) (÷ base rate
 * by the caller when a global speed is also set).
 */
export function mediaMsToExportMs(windows: SpeedWindow[], mediaMs: number): number {
	if (!windows.length || mediaMs <= 0) return mediaMs;
	const sorted = [...windows].sort((a, b) => a.startMs - b.startMs);
	let exportMs = 0; // export time produced so far
	let media = 0; // media time consumed so far
	for (const win of sorted) {
		if (media >= win.startMs) continue; // clipped past (de-overlap keeps order)
		// Normal-rate span before this window.
		const gapMs = win.startMs - media;
		if (mediaMs <= win.startMs) {
			exportMs += Math.max(0, mediaMs - media);
			return exportMs;
		}
		exportMs += gapMs;
		media = win.startMs;
		// Inside the window: media passes at `rate`× speed.
		const spanMs = Math.min(win.endMs, mediaMs) - win.startMs;
		if (spanMs <= 0) continue;
		exportMs += spanMs / win.rate;
		media = Math.min(win.endMs, mediaMs);
		if (media >= mediaMs) return exportMs;
	}
	// Tail after the last window at normal rate.
	exportMs += Math.max(0, mediaMs - media);
	return exportMs;
}

/** Export-timeline length of a media span [0, mediaMs] under the curve. */
export function mediaSpanExportMs(windows: SpeedWindow[], mediaMs: number): number {
	return mediaMsToExportMs(windows, mediaMs);
}

/** Encode for the remix wire (`s`) — compact, capped. */
export function encodeSpeedWindows(windows: SpeedWindow[]): WireSpeed[] {
	return windows
		.slice(0, MAX_SPEED_WINDOWS)
		.map((win) => [win.startMs, win.endMs, Math.round(win.rate * 100) / 100]);
}

/** Tolerant decode of the wire `s` array. */
export function decodeSpeedWindows(raw: unknown): SpeedWindow[] {
	if (!Array.isArray(raw)) return [];
	const rows: SpeedWindow[] = [];
	for (const item of raw.slice(0, MAX_SPEED_WINDOWS)) {
		if (!Array.isArray(item)) continue;
		const win = normalizeSpeedWindow({
			startMs: Number(item[0]),
			endMs: Number(item[1]),
			rate: Number(item[2])
		});
		if (win) rows.push(win);
	}
	return rows;
}

/**
 * Derive slow-mo zoom hint windows from the speed track (a slow-mo punch
 * wants a face punch-in — spec pairs them). Pure helper for suggestion UX;
 * the creator edits the result like any zoom window.
 */
export function zoomHintsForSpeeds(windows: SpeedWindow[]): ZoomWindow[] {
	return windows
		.filter((win) => win.rate < 1)
		.map((win) => ({
			startMs: win.startMs,
			endMs: win.endMs,
			factor: win.rate <= 0.6 ? 2.2 : 1.6,
			cx: 0.5,
			cy: 0.42
		}));
}

/**
 * `shiftCuesForExport` under a rate curve: trim-shift the cue, integrate its
 * media position through the windows, then divide by the BASE playbackRate
 * (the ramps are multipliers on top of it). Cues outside the export window
 * drop — same contract as the flat version in export-support. Generic in the
 * cue row so callers pass their own cue type through untouched.
 */
export function shiftCuesForExportWithSpeeds<T extends { atMs: number }>(
	cues: T[],
	speedWindows: SpeedWindow[],
	trimStartSec: number,
	playbackRate: number,
	durationSec: number
): T[] {
	const rate = playbackRate || 1;
	const trimMs = trimStartSec * 1000;
	const exportEndMs = durationSec * 1000;
	return cues
		.map((c) => {
			const mediaMs = c.atMs - trimMs;
			const exportMs = mediaMsToExportMs(speedWindows, Math.max(0, mediaMs)) / rate;
			return { ...c, atMs: exportMs };
		})
		.filter((c) => c.atMs >= 0 && c.atMs <= exportEndMs);
}
