/**
 * Meme overlay FX engine — timed entrance/loop effects baked into exports.
 *
 * Pure math over (overlay, atMs): the renderer applies the result as a canvas
 * transform + alpha, and the live preview mirrors it with a CSS transform so
 * WYSIWYG holds. Effects are part of the overlay (survive remix/templates)
 * but stay optional wire data — missing `fx` means "none", forever.
 */

import type { MemeTextOverlay } from './schema';

export const MEME_FX_IDS = ['none', 'pop', 'fade', 'shake', 'spin'] as const;
export type MemeFx = (typeof MEME_FX_IDS)[number];

export interface MemeFxLabels {
	id: MemeFx;
	label: string;
	icon: string;
	hint: string;
}

export const MEME_FX_OPTIONS: MemeFxLabels[] = [
	{ id: 'none', label: 'None', icon: 'i-lucide-ban', hint: 'Static — appears instantly' },
	{ id: 'pop', label: 'Pop', icon: 'i-lucide-sparkles', hint: 'Springy scale-in on entry' },
	{ id: 'fade', label: 'Fade', icon: 'i-lucide-cloud-fog', hint: 'Soft fade-in on entry' },
	{ id: 'shake', label: 'Shake', icon: 'i-lucide-vibrate', hint: 'Loops a jittery tremble' },
	{ id: 'spin', label: 'Spin', icon: 'i-lucide-refresh-cw', hint: 'Spins forever (stickers!)' }
];

export function isMemeFx(raw: unknown): raw is MemeFx {
	return typeof raw === 'string' && (MEME_FX_IDS as readonly string[]).includes(raw);
}

/** Parse + clamp an fx value from wire data; missing/unknown → 'none'. */
export function normalizeMemeFx(raw: unknown): MemeFx {
	return isMemeFx(raw) ? raw : 'none';
}

/** Entrance effects resolve over this window (ms) from the overlay's start. */
export const FX_ENTRY_MS = 380;
/** Loop effects (shake/spin) repeat with this period (ms). */
export const FX_LOOP_MS = 900;

export interface FxTransform {
	/** Extra scale on top of the overlay's own size (1 = none). */
	scale: number;
	/** Extra rotation in radians (around the overlay center). */
	rotate: number;
	/** Extra x-offset as a fraction of canvas width. */
	dx: number;
	/** Extra y-offset as a fraction of canvas height. */
	dy: number;
	/** Opacity multiplier (1 = fully visible). */
	alpha: number;
}

const NO_FX: FxTransform = { scale: 1, rotate: 0, dx: 0, dy: 0, alpha: 1 };

function easeOutBack(t: number): number {
	// Overshooting spring settle (c1/c2 per standard easing).
	const c1 = 1.70158;
	const c3 = c1 + 1;
	return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/**
 * Compute the FX transform for an overlay at media time `atMs`.
 * `none` and out-of-window times return the identity (no work for the
 * renderer — the common case stays exactly as fast as before).
 */
export function fxTransformAt(
	overlay: Pick<MemeTextOverlay, 'fx' | 'startMs'>,
	atMs?: number
): FxTransform {
	const fx = overlay.fx ?? 'none';
	if (fx === 'none') return NO_FX;
	if (atMs === undefined) return NO_FX; // always-visible paints (posters) render untransformed
	const t = Math.max(0, atMs - (overlay.startMs ?? 0));
	switch (fx) {
		case 'pop': {
			if (t >= FX_ENTRY_MS) return NO_FX;
			const p = t / FX_ENTRY_MS;
			return { ...NO_FX, scale: easeOutBack(p) };
		}
		case 'fade': {
			if (t >= FX_ENTRY_MS) return NO_FX;
			const p = Math.min(1, t / FX_ENTRY_MS);
			return { ...NO_FX, alpha: p };
		}
		case 'shake': {
			const phase = (t % FX_LOOP_MS) / FX_LOOP_MS;
			const wave = Math.sin(phase * Math.PI * 2) * Math.cos(phase * Math.PI * 4);
			return { ...NO_FX, dx: wave * 0.008, dy: -Math.abs(wave) * 0.004 };
		}
		case 'spin': {
			const phase = (t % FX_LOOP_MS) / FX_LOOP_MS;
			return { ...NO_FX, rotate: phase * Math.PI * 2 };
		}
	}
}
