/**
 * Punchline zoom track (Auto Meme follow-through). Suggestions already emit
 * face-anchored zoom windows (ai/suggest `ZoomWindow`); this module turns
 * them into a live, editable timeline track the studio + every export path
 * can consume — closing the "advertised zooms never render" gap.
 *
 * Design mirrors the SFX cue sheet:
 *  - windows live in MEDIA time (ms), exactly like `MemeSfxCue.atMs`, so the
 *    same trim/speed remap (`shiftCuesForExport` convention) applies;
 *  - the track rides RenderOptions as data (no per-path code branches);
 *  - preview derives a CSS-frame (same math as coverRect) so the stage is
 *    WYSIWYG with every export surface.
 */
import type { MediaTransform } from './render';
import type { ZoomWindow } from '$lib/ai/suggest';

/** Cap mirrors sfx cues (16) — zoom spam reads as a glitch, not a gag. */
export const MAX_ZOOM_WINDOWS = 16;

/** Longest zoom window — beyond this the "punch" becomes a permanent crop. */
export const MAX_ZOOM_WINDOW_MS = 4000;

export function normalizeZoomWindow(raw: unknown): ZoomWindow | null {
	if (!raw || typeof raw !== 'object') return null;
	const o = raw as Record<string, unknown>;
	const start = Number(o.startMs);
	const end = Number(o.endMs);
	const factor = Number(o.factor);
	if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(factor)) return null;
	if (end <= start || factor <= 1.001) return null;
	const cx = Number(o.cx);
	const cy = Number(o.cy);
	return {
		startMs: Math.max(0, Math.round(start)),
		// Same soft cap as cue windows: a long hold still exports, never throws.
		endMs: Math.min(Math.max(Math.round(end), Math.round(start) + 100), MAX_ZOOM_WINDOW_MS),
		factor: Math.min(4, Math.max(1.001, factor)),
		cx: Number.isFinite(cx) ? Math.min(1, Math.max(0, cx)) : 0.5,
		cy: Number.isFinite(cy) ? Math.min(1, Math.max(0, cy)) : 0.5
	};
}

export function normalizeZoomWindows(raw: unknown): ZoomWindow[] {
	if (!Array.isArray(raw)) return [];
	const rows: ZoomWindow[] = [];
	for (const item of raw.slice(0, MAX_ZOOM_WINDOWS)) {
		const win = normalizeZoomWindow(item);
		if (win) rows.push(win);
	}
	// Sequential, non-overlapping-ish ordered track (stable preview + export).
	return rows
		.sort((a, b) => a.startMs - b.startMs)
		.filter((win, i, all) => {
			if (i === 0) return true;
			return win.startMs >= all[i - 1]!.startMs;
		});
}

/** True when media time `atMs` sits inside the window (start inclusive). */
export function zoomActiveAt(win: ZoomWindow, atMs: number): boolean {
	return atMs >= win.startMs && atMs < win.endMs;
}

/**
 * The media transform a zoom window implies at media time `atMs`: the zoom
 * factor multiplies the cover fit (same as a manual crop/zoom) and the pan
 * aims at the face anchor instead of the frame center. Eases in/out over
 * `easeMs` so the punch reads as motion, not a cut.
 */
export function zoomTransformAt(
	zooms: ZoomWindow[],
	atMs: number,
	easeMs = 140
): MediaTransform | undefined {
	for (const win of zooms) {
		if (!zoomActiveAt(win, atMs)) continue;
		const span = Math.max(200, win.endMs - win.startMs);
		const raw = Math.min(1, Math.max(0, (atMs - win.startMs) / Math.min(easeMs, span)));
		const eased = raw * raw * (3 - 2 * raw); // smoothstep
		const factor = 1 + (win.factor - 1) * eased;
		// Pan in MediaTransform units: −1…1 of the per-axis overflow. Aiming at
		// an off-center face needs at most half the overflow past center.
		const tx = (win.cx - 0.5) * 2 * eased;
		const ty = (win.cy - 0.5) * 2 * eased;
		return { scale: factor, x: tx, y: ty };
	}
	return undefined;
}

/** Frame-level preview: the stage computes the SAME rect as coverRect via
 *  CSS. Returns percentages relative to the stage box (like mediaFrame). */
export function zoomFrameCss(
	sourceW: number,
	sourceH: number,
	canvasW: number,
	canvasH: number,
	transform?: MediaTransform
): { left: string; top: string; width: string; height: string } | null {
	if (canvasW <= 0 || canvasH <= 0) return null;
	const scale = Math.max(canvasW / (sourceW || 1), canvasH / (sourceH || 1));
	const zoom = Math.min(4, Math.max(1, transform?.scale ?? 1));
	const w = (sourceW || canvasW) * scale * zoom;
	const h = (sourceH || canvasH) * scale * zoom;
	const maxX = Math.max(0, (w - canvasW) / 2);
	const maxY = Math.max(0, (h - canvasH) / 2);
	const dx = Math.min(1, Math.max(-1, transform?.x ?? 0)) * maxX;
	const dy = Math.min(1, Math.max(-1, transform?.y ?? 0)) * maxY;
	return {
		left: ((((canvasW - w) / 2 + dx) / canvasW) * 100).toFixed(3),
		top: ((((canvasH - h) / 2 + dy) / canvasH) * 100).toFixed(3),
		width: ((w / canvasW) * 100).toFixed(3),
		height: ((h / canvasH) * 100).toFixed(3)
	};
}

/** Combine the creator's manual framing with a live zoom window: the zoom
 *  multiplies on top of the manual scale; pans sum (manual rides as bias). */
export function composeZoomWithFraming(
	framing: MediaTransform | undefined,
	zoom: MediaTransform | undefined
): MediaTransform {
	const base = framing ?? { scale: 1, x: 0, y: 0 };
	if (!zoom) return base;
	return {
		scale: Math.min(4, base.scale * zoom.scale),
		x: Math.min(1, Math.max(-1, base.x + zoom.x)),
		y: Math.min(1, Math.max(-1, base.y + zoom.y))
	};
}

/** Remap zoom windows onto the EXPORT timeline (trim + speed), mirroring
 *  `shiftCuesForExport` — same media-time convention, same filtering. */
export function shiftZoomsForExport(
	zooms: ZoomWindow[],
	trimStartSec: number,
	playbackRate: number,
	durationSec: number
): ZoomWindow[] {
	const rate = playbackRate || 1;
	return zooms
		.map((z) => ({
			...z,
			startMs: (z.startMs - trimStartSec * 1000) / rate,
			endMs: (z.endMs - trimStartSec * 1000) / rate
		}))
		.filter((z) => z.endMs > 0 && z.startMs < durationSec * 1000);
}
