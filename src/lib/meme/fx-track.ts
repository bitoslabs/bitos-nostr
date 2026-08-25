/**
 * Frame-level FX track (Bitz Meme Pack V1 — docs/source/templete/tp-2.md
 * Layer 2 "เอฟเฟกต์"). Timed windows of whole-frame canvas effects — flash,
 * glitch, RGB split, shake, pixelate, vignette, spotlight, strobe, zoom blur,
 * color flash — riding the exact same covenant as the zoom track:
 *
 *  - windows live in MEDIA time (ms), like `MemeSfxCue.atMs` / zoom windows,
 *    so the trim/speed remap convention (`shiftFxForExport`) applies 1:1;
 *  - the track rides the render paths as pure data — one `paintFxFrame()`
 *    pass after the base-media draw, before layers/captions (text stays
 *    readable above the effect), with zero per-path code branches;
 *  - the DOM stage preview derives from the SAME math via `fxPreviewStyle()`
 *    (CSS mirror), so the studio is WYSIWYG with every export surface.
 */
import { MAX_ZOOM_WINDOWS } from './zoom-track';

/** Cap mirrors zoom/sfx windows (16) — fx spam reads as noise, not a gag. */
export const MAX_FX_WINDOWS = MAX_ZOOM_WINDOWS;

/** Longest fx window — beyond this a "flash" becomes a whole-clip look. */
export const MAX_FX_WINDOW_MS = 4000;

/** Default strength when a window carries none. */
export const DEFAULT_FX_INTENSITY = 0.7;

/** The frame-FX vocabulary. Each id maps to a canvas painter below plus a
 *  CSS preview mirror in `fxPreviewStyle`. */
export const FRAME_FX_IDS = [
	'flash',
	'glitch',
	'rgb-split',
	'shake',
	'pixelate',
	'vignette',
	'spotlight',
	'strobe',
	'zoom-blur',
	'color-flash'
] as const;

export type FrameFxId = (typeof FRAME_FX_IDS)[number];

export interface FrameFxWindow {
	/** Start inclusive, end exclusive — media time ms like zoom windows. */
	startMs: number;
	endMs: number;
	fx: FrameFxId;
	/** 0.05–1 strength; painters clamp internally. */
	intensity: number;
}

/** Human labels for the picker + timeline rows (single source of truth). */
export const FRAME_FX_LABELS: Record<FrameFxId, string> = {
	flash: 'Flash',
	glitch: 'Glitch',
	'rgb-split': 'RGB Split',
	shake: 'Shake',
	pixelate: 'Pixelate',
	vignette: 'Vignette',
	spotlight: 'Spotlight',
	strobe: 'Strobe',
	'zoom-blur': 'Zoom Blur',
	'color-flash': 'Color Flash'
};

/** Compact wire form: [fx, startMs, endMs, intensity(2dp)]. */
export type WireFx = [FrameFxId, number, number, number];

export function isFrameFxId(value: unknown): value is FrameFxId {
	return typeof value === 'string' && (FRAME_FX_IDS as readonly string[]).includes(value);
}

export function normalizeFxWindow(raw: unknown): FrameFxWindow | null {
	if (!raw || typeof raw !== 'object') return null;
	const o = raw as Record<string, unknown>;
	if (!isFrameFxId(o.fx)) return null;
	const start = Number(o.startMs);
	const end = Number(o.endMs);
	const intensity = Number(o.intensity ?? DEFAULT_FX_INTENSITY);
	if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
	if (end <= start) return null;
	// Same soft caps as zoom windows: a long window still exports, never throws.
	return {
		fx: o.fx,
		startMs: Math.max(0, Math.round(start)),
		endMs: Math.min(Math.max(Math.round(end), Math.round(start) + 100), MAX_FX_WINDOW_MS),
		intensity: Number.isFinite(intensity)
			? Math.min(1, Math.max(0.05, intensity))
			: DEFAULT_FX_INTENSITY
	};
}

/** Sort + de-overlap like `normalizeZoomWindows` — an ordered track so the
 *  preview and every export paint the same (at most one fx per moment). */
export function normalizeFxWindows(raw: unknown): FrameFxWindow[] {
	if (!Array.isArray(raw)) return [];
	const rows: FrameFxWindow[] = [];
	for (const item of raw.slice(0, MAX_FX_WINDOWS)) {
		const win = normalizeFxWindow(item);
		if (win) rows.push(win);
	}
	return rows
		.sort((a, b) => a.startMs - b.startMs)
		.filter((win, i, all) => (i === 0 ? true : win.startMs >= all[i - 1]!.endMs - 100));
}

/** True when media time `atMs` sits inside the window (start inclusive). */
export function fxActiveAt(win: FrameFxWindow, atMs: number): boolean {
	return atMs >= win.startMs && atMs < win.endMs;
}

/** Normalized phase 0→1 through the window (for painters that ramp). */
export function fxPhase(win: FrameFxWindow, atMs: number): number {
	const span = Math.max(1, win.endMs - win.startMs);
	return Math.min(1, Math.max(0, (atMs - win.startMs) / span));
}

/** Remap fx windows onto the EXPORT timeline (trim + speed), mirroring
 *  `shiftCuesForExport` / `shiftZoomsForExport` — same convention, same
 *  filtering (windows that fall outside the export span drop). */
export function shiftFxForExport(
	windows: FrameFxWindow[],
	trimStartSec: number,
	playbackRate: number,
	durationSec: number
): FrameFxWindow[] {
	const rate = playbackRate || 1;
	return windows
		.map((win) => ({
			...win,
			startMs: (win.startMs - trimStartSec * 1000) / rate,
			endMs: (win.endMs - trimStartSec * 1000) / rate
		}))
		.filter((win) => win.endMs > 0 && win.startMs < durationSec * 1000);
}

/** Encode windows for the remix wire (`f`) — compact, capped, ordered. */
export function encodeFxWindows(windows: FrameFxWindow[]): WireFx[] {
	return windows
		.slice(0, MAX_FX_WINDOWS)
		.map((win) => [win.fx, win.startMs, win.endMs, Math.round(win.intensity * 100) / 100]);
}

/** Tolerant decode of the wire `f` array — unknown fx ids drop (a newer
 *  client's rows never break an older reader). */
export function decodeFxWindows(raw: unknown): FrameFxWindow[] {
	if (!Array.isArray(raw)) return [];
	const rows: FrameFxWindow[] = [];
	for (const item of raw.slice(0, MAX_FX_WINDOWS)) {
		if (!Array.isArray(item)) continue;
		const win = normalizeFxWindow({
			fx: item[0],
			startMs: Number(item[1]),
			endMs: Number(item[2]),
			intensity: item[3] === undefined ? undefined : Number(item[3])
		});
		if (win) rows.push(win);
	}
	return rows;
}

// ---- painters ------------------------------------------------------------------

/** Deterministic pseudo-random 0…1 — the SAME seed math runs in the canvas
 *  painters and the CSS preview, so jitter never flickers out of sync. */
function srand(seed: number): number {
	const x = Math.sin(seed * 12.9898) * 43758.5453;
	return x - Math.floor(x);
}

/** Full-size scratch canvas (snapshot source for redraw-based painters). */
let scratch: HTMLCanvasElement | null = null;
/** Small scratch for the pixelate downsample. */
let tiny: HTMLCanvasElement | null = null;

function getScratch(w: number, h: number): HTMLCanvasElement {
	if (!scratch) scratch = document.createElement('canvas');
	if (scratch.width !== w || scratch.height !== h) {
		scratch.width = w;
		scratch.height = h;
	}
	return scratch;
}

function getTiny(w: number, h: number): HTMLCanvasElement {
	if (!tiny) tiny = document.createElement('canvas');
	if (tiny.width !== w || tiny.height !== h) {
		tiny.width = w;
		tiny.height = h;
	}
	return tiny;
}

/** Snapshot the frame into the scratch canvas. Tainted canvases (CORS-less
 *  remote media) throw on readback — painters that need pixels simply skip,
 *  the rest of the export proceeds unaffected. */
function snapshot(
	ctx: CanvasRenderingContext2D,
	canvas: { width: number; height: number }
): HTMLCanvasElement | null {
	try {
		const s = getScratch(canvas.width, canvas.height);
		const sctx = s.getContext('2d');
		if (!sctx) return null;
		sctx.clearRect(0, 0, s.width, s.height);
		sctx.drawImage(ctx.canvas, 0, 0);
		return s;
	} catch {
		return null;
	}
}

/**
 * The ONE paint entry: apply every fx active at `atMs` onto the ctx. Pure
 * canvas ops that composite OVER the painted base frame — call it right
 * after the base media draw (media + look + zoom), BEFORE layers/captions,
 * in every render path (still export, GIF frames, recorder loops, the video
 * export paint pass, the GIF canvas stage preview). `atMs` doubles as the
 * jitter seed so fx like shake/glitch animate per frame yet deterministically
 * across preview and export.
 */
export function paintFxFrame(
	ctx: CanvasRenderingContext2D,
	windows: FrameFxWindow[],
	atMs: number,
	canvas: { width: number; height: number }
): void {
	if (!windows.length || canvas.width <= 0 || canvas.height <= 0) return;
	for (const win of windows) {
		if (!fxActiveAt(win, atMs)) continue;
		const phase = fxPhase(win, atMs);
		switch (win.fx) {
			case 'flash':
				paintFlash(ctx, canvas, win.intensity, phase);
				break;
			case 'color-flash':
				paintColorFlash(ctx, canvas, win.intensity, phase);
				break;
			case 'strobe':
				paintStrobe(ctx, canvas, win.intensity, atMs);
				break;
			case 'glitch':
				paintGlitch(ctx, canvas, win.intensity, atMs, phase);
				break;
			case 'rgb-split':
				paintRgbSplit(ctx, canvas, win.intensity);
				break;
			case 'shake':
				paintShake(ctx, canvas, win.intensity, atMs);
				break;
			case 'pixelate':
				paintPixelate(ctx, canvas, win.intensity);
				break;
			case 'zoom-blur':
				paintZoomBlur(ctx, canvas, win.intensity);
				break;
			case 'vignette':
				paintVignette(ctx, canvas, win.intensity);
				break;
			case 'spotlight':
				paintSpotlight(ctx, canvas, win.intensity);
				break;
		}
	}
}

function paintFlash(
	ctx: CanvasRenderingContext2D,
	canvas: { width: number; height: number },
	intensity: number,
	phase: number
): void {
	ctx.save();
	ctx.globalAlpha = intensity * (1 - phase) * 0.9;
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.restore();
}

function paintColorFlash(
	ctx: CanvasRenderingContext2D,
	canvas: { width: number; height: number },
	intensity: number,
	phase: number
): void {
	ctx.save();
	ctx.globalAlpha = intensity * 0.45;
	ctx.fillStyle = `hsl(${Math.round(phase * 360)} 100% 50%)`;
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.restore();
}

function paintStrobe(
	ctx: CanvasRenderingContext2D,
	canvas: { width: number; height: number },
	intensity: number,
	atMs: number
): void {
	// ~100ms on/off alternation — reads as a rapid photo-flash chain.
	if (Math.floor(atMs / 100) % 2 !== 0) return;
	ctx.save();
	ctx.globalAlpha = intensity * 0.8;
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.restore();
}

function paintGlitch(
	ctx: CanvasRenderingContext2D,
	canvas: { width: number; height: number },
	intensity: number,
	atMs: number,
	phase: number
): void {
	const snap = snapshot(ctx, canvas);
	if (!snap) return;
	const w = canvas.width;
	const h = canvas.height;
	// Strips re-roll every 80ms — a seizure of horizontal bands, not a smear.
	const step = Math.floor(atMs / 80);
	const strips = 2 + Math.round(4 * intensity);
	for (let i = 0; i < strips; i++) {
		const y = Math.floor(srand(step + i * 7.3) * Math.max(1, h - 8));
		const hh = 4 + Math.floor(srand(step + i * 3.1) * h * 0.06 * intensity) + 2;
		const dx = (srand(step + i * 11.7) - 0.5) * w * 0.14 * intensity;
		ctx.drawImage(snap, 0, y, w, hh, dx, y, w, hh);
	}
	// Occasional tinted band — the classic VHS chroma tear.
	if (srand(step) > 1 - intensity * 0.6) {
		const y = Math.floor(srand(step + 99) * Math.max(1, h - 8));
		const hh = 6 + Math.floor(h * 0.02 * intensity);
		ctx.save();
		ctx.globalCompositeOperation = 'screen';
		ctx.globalAlpha = 0.25 + 0.2 * intensity;
		ctx.fillStyle = srand(step + 5) > 0.5 ? '#ff0033' : '#00ffee';
		ctx.fillRect(0, y, w, hh);
		ctx.restore();
	}
	// Enter/exit flicker keeps the window edges reading as a hit.
	if (phase < 0.15 || phase > 0.85) {
		ctx.save();
		ctx.globalAlpha = 0.15 * intensity;
		ctx.drawImage(snap, 0, 0, w, h, -w * 0.01, 0, w * 1.02, h);
		ctx.restore();
	}
}

function paintRgbSplit(
	ctx: CanvasRenderingContext2D,
	canvas: { width: number; height: number },
	intensity: number
): void {
	const snap = snapshot(ctx, canvas);
	if (!snap) return;
	const d = Math.max(2, Math.round(Math.min(canvas.width, canvas.height) * 0.012 * intensity));
	ctx.save();
	ctx.globalCompositeOperation = 'screen';
	ctx.globalAlpha = 0.55 * intensity;
	// Channel isolation via ctx.filter (sepia→saturate→hue-rotate splits red
	// vs cyan); browsers without canvas filters fall back to ghosting, which
	// still reads as the split.
	ctx.filter = 'sepia(1) saturate(12) hue-rotate(-50deg)';
	ctx.drawImage(snap, d, 0);
	ctx.filter = 'sepia(1) saturate(12) hue-rotate(150deg)';
	ctx.drawImage(snap, -d, 0);
	ctx.restore();
	ctx.filter = 'none';
}

function paintShake(
	ctx: CanvasRenderingContext2D,
	canvas: { width: number; height: number },
	intensity: number,
	atMs: number
): void {
	const snap = snapshot(ctx, canvas);
	if (!snap) return;
	const w = canvas.width;
	const h = canvas.height;
	const amp = Math.max(2, Math.round(Math.min(w, h) * 0.02 * intensity));
	const step = Math.floor(atMs / 50);
	const dx = (srand(step) * 2 - 1) * amp;
	const dy = (srand(step + 42) * 2 - 1) * amp;
	// Redraw slightly oversized so the jitter never exposes empty edges.
	ctx.drawImage(snap, dx - amp, dy - amp, w + amp * 2, h + amp * 2);
}

function paintPixelate(
	ctx: CanvasRenderingContext2D,
	canvas: { width: number; height: number },
	intensity: number
): void {
	const snap = snapshot(ctx, canvas);
	if (!snap) return;
	const w = canvas.width;
	const h = canvas.height;
	// Fewer blocks = chunkier mosaic: 28 blocks (weak) → 8 blocks (max).
	const blocks = Math.max(8, Math.round(28 - 20 * intensity));
	const s = Math.max(2, Math.round(Math.min(w, h) / blocks));
	const sw = Math.max(1, Math.floor(w / s));
	const sh = Math.max(1, Math.floor(h / s));
	const small = getTiny(sw, sh);
	const sctx = small.getContext('2d');
	if (!sctx) return;
	sctx.clearRect(0, 0, sw, sh);
	sctx.imageSmoothingEnabled = true;
	sctx.drawImage(snap, 0, 0, w, h, 0, 0, sw, sh);
	ctx.imageSmoothingEnabled = false;
	ctx.drawImage(small, 0, 0, sw, sh, 0, 0, w, h);
	ctx.imageSmoothingEnabled = true;
}

function paintZoomBlur(
	ctx: CanvasRenderingContext2D,
	canvas: { width: number; height: number },
	intensity: number
): void {
	const snap = snapshot(ctx, canvas);
	if (!snap) return;
	const w = canvas.width;
	const h = canvas.height;
	ctx.save();
	ctx.globalAlpha = Math.min(0.6, intensity * 0.5);
	// Radial-blur approximation: stacked self-copies scaled about center.
	for (let i = 1; i <= 3; i++) {
		const grow = 1 + 0.03 * intensity * i;
		const nw = w * grow;
		const nh = h * grow;
		ctx.drawImage(snap, (w - nw) / 2, (h - nh) / 2, nw, nh);
	}
	ctx.restore();
}

function paintVignette(
	ctx: CanvasRenderingContext2D,
	canvas: { width: number; height: number },
	intensity: number
): void {
	const w = canvas.width;
	const h = canvas.height;
	const r = Math.max(w, h) * 0.75;
	const grad = ctx.createRadialGradient(w / 2, h / 2, r * 0.35, w / 2, h / 2, r);
	grad.addColorStop(0, 'rgba(0,0,0,0)');
	grad.addColorStop(1, `rgba(0,0,0,${(0.85 * intensity).toFixed(3)})`);
	ctx.save();
	ctx.fillStyle = grad;
	ctx.fillRect(0, 0, w, h);
	ctx.restore();
}

function paintSpotlight(
	ctx: CanvasRenderingContext2D,
	canvas: { width: number; height: number },
	intensity: number
): void {
	const w = canvas.width;
	const h = canvas.height;
	const core = Math.min(w, h) * 0.28;
	const rim = Math.max(w, h) * 0.8;
	const grad = ctx.createRadialGradient(w / 2, h / 2, core * 0.4, w / 2, h / 2, rim);
	grad.addColorStop(0, 'rgba(0,0,0,0)');
	grad.addColorStop(0.4, `rgba(0,0,0,${(0.35 * intensity).toFixed(3)})`);
	grad.addColorStop(1, `rgba(0,0,0,${(0.9 * intensity).toFixed(3)})`);
	ctx.save();
	ctx.fillStyle = grad;
	ctx.fillRect(0, 0, w, h);
	ctx.restore();
}

// ---- DOM preview mirror --------------------------------------------------------

export interface FxPreviewStyle {
	/** Extra CSS `filter` fragment for the media box. */
	mediaFilter?: string;
	/** Extra CSS `transform` fragment for the media box. */
	mediaTransform?: string;
	/** A full CSS `background` for a pointer-transparent overlay div. */
	overlayBackground?: string;
	overlayOpacity?: number;
}

/**
 * CSS mirror of `paintFxFrame` for the DOM stage (<video>/<img> previews —
 * the GIF canvas stage runs the REAL painter, exact by construction).
 * Approximations (pixelate/glitch) are documented per-case; everything else
 * is the same math expressed as CSS.
 */
export function fxPreviewStyle(windows: FrameFxWindow[], atMs: number): FxPreviewStyle {
	if (!windows.length) return {};
	const filters: string[] = [];
	const transforms: string[] = [];
	let overlayBackground: string | undefined;
	let overlayOpacity: number | undefined;
	for (const win of windows) {
		if (!fxActiveAt(win, atMs)) continue;
		const phase = fxPhase(win, atMs);
		switch (win.fx) {
			case 'flash':
				overlayBackground = '#ffffff';
				overlayOpacity = win.intensity * (1 - phase) * 0.9;
				break;
			case 'color-flash':
				overlayBackground = `hsl(${Math.round(phase * 360)} 100% 50%)`;
				overlayOpacity = win.intensity * 0.45;
				break;
			case 'strobe':
				if (Math.floor(atMs / 100) % 2 === 0) {
					overlayBackground = '#ffffff';
					overlayOpacity = win.intensity * 0.8;
				}
				break;
			case 'vignette':
				overlayBackground = `radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 35%, rgba(0,0,0,${(
					0.85 * win.intensity
				).toFixed(2)}) 100%)`;
				break;
			case 'spotlight':
				overlayBackground = `radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 12%, rgba(0,0,0,${(
					0.35 * win.intensity
				).toFixed(2)}) 40%, rgba(0,0,0,${(0.9 * win.intensity).toFixed(2)}) 100%)`;
				break;
			case 'rgb-split': {
				const d = (1 + Math.round(win.intensity * 4)) * 1.2;
				filters.push(
					`drop-shadow(${d}px 0 rgba(255,0,60,${(0.55 * win.intensity).toFixed(2)}))`,
					`drop-shadow(-${d}px 0 rgba(0,255,255,${(0.5 * win.intensity).toFixed(2)}))`
				);
				break;
			}
			case 'shake': {
				const amp = 0.8 + win.intensity * 1.7;
				const step = Math.floor(atMs / 50);
				const dx = (srand(step) * 2 - 1) * amp;
				const dy = (srand(step + 42) * 2 - 1) * amp;
				transforms.push(`translate(${dx.toFixed(2)}%, ${dy.toFixed(2)}%)`);
				break;
			}
			case 'glitch': {
				// Approximation: chroma push + deterministic jitter (the export
				// does real strip slicing; CSS has no slice primitive).
				filters.push('contrast(1.25)', 'saturate(1.3)');
				const step = Math.floor(atMs / 80);
				const dx = (srand(step + 7) - 0.5) * 1.6 * win.intensity;
				transforms.push(`translate(${dx.toFixed(2)}%, 0)`);
				break;
			}
			case 'pixelate':
				// Approximation only — the export downsamples for true blocks.
				filters.push('blur(3px)', 'contrast(1.3)');
				break;
			case 'zoom-blur':
				transforms.push(`scale(${(1 + 0.04 * win.intensity).toFixed(3)})`);
				filters.push('blur(1.5px)');
				break;
		}
	}
	const style: FxPreviewStyle = {};
	if (filters.length) style.mediaFilter = filters.join(' ');
	if (transforms.length) style.mediaTransform = transforms.join(' ');
	if (overlayBackground !== undefined && overlayOpacity !== undefined) {
		style.overlayBackground = overlayBackground;
		style.overlayOpacity = overlayOpacity;
	}
	return style;
}
