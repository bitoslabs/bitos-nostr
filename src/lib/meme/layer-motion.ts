/**
 * Layer motion presets (tp-bitcoin.md §15 "creator-friendly motion"):
 * one-tap ambient animation for image layers — bounce, wiggle, spin, pop,
 * breathe — so a dropped Bitz Buddy sticker feels alive without keyframes.
 *
 * Design mirrors the track covenants:
 *  - a preset rides the layer as DATA (wire field `m` — one short id, dead
 *    cheap on the `meme` tag / drafts); old clients just ignore it;
 *  - pure functions: preview (CSS keyframes via the same numbers) and
 *    export (canvas transform per frame) share ONE math source — WYSIWYG
 *    by construction;
 *  - media-time based like every timed thing (looping forever, phase from
 *    the layer's own startMs so entry mid-loop never pops).
 */

export interface LayerMotionPreset {
	id: string;
	label: string;
	/** Icon hint for picker UIs. */
	icon: string;
	/** Motion period seconds (loop length). */
	periodSec: number;
}

export const LAYER_MOTIONS: readonly LayerMotionPreset[] = [
	{ id: 'bounce', label: 'Bounce', icon: 'i-lucide-arrow-up', periodSec: 1.1 },
	{ id: 'wiggle', label: 'Wiggle', icon: 'i-lucide-iteration-cw', periodSec: 1.6 },
	{ id: 'spin', label: 'Spin', icon: 'i-lucide-refresh-cw', periodSec: 2.4 },
	{ id: 'pop', label: 'Pop', icon: 'i-lucide-sparkles', periodSec: 1.4 },
	{ id: 'breathe', label: 'Breathe', icon: 'i-lucide-wind', periodSec: 3 }
];

export const LAYER_MOTION_IDS: readonly string[] = LAYER_MOTIONS.map((m) => m.id);

/** Tolerant parse — unknown/junk motion ids read as "none". */
export function layerMotionOf(raw: unknown): string {
	if (typeof raw !== 'string') return 'none';
	const trimmed = raw.trim().toLowerCase();
	return trimmed && LAYER_MOTION_IDS.includes(trimmed) ? trimmed : 'none';
}

export const MOTION_WIRE_FIELD = 'm';

/**
 * Transform for one layer at media time `atMs`, under motion `motionId`.
 * Returns null when there is nothing to apply (static layer, or a motion
 * whose phase is identity at t). Pure — callers (CSS preview + canvas
 * export) both consume it so framing never diverges.
 */
export function layerMotionTransform(
	motionId: string,
	atMs: number,
	startMs?: number
): { dxNorm: number; dyNorm: number; scale: number; rotateDeg: number } | null {
	const motion = layerMotionOf(motionId);
	if (motion === 'none') return null;
	const origin = startMs ?? 0;
	const t = Math.max(0, atMs - origin) / 1000;
	const period = LAYER_MOTIONS.find((m) => m.id === motion)?.periodSec ?? 1;
	const phase = (t % period) / period; // 0..1
	switch (motion) {
		case 'bounce': {
			// |sin| arc — up fast, settle down; amplitude 6% of layer height.
			// (+0 normalization: |sin| yields -0 at wrap points, keep identity
			//  phases canonical so CSS/canvas see exactly 0.)
			const hop = Math.abs(Math.sin(phase * Math.PI * 2));
			return { dxNorm: 0, dyNorm: -(hop * 0.06) + 0, scale: 1, rotateDeg: 0 };
		}
		case 'wiggle':
			// Rock ±6° like a wind-up toy.
			return {
				dxNorm: 0,
				dyNorm: 0,
				scale: 1,
				rotateDeg: Math.sin(phase * Math.PI * 2) * 6
			};
		case 'spin': {
			// Full 360° per period — steady rotation.
			return { dxNorm: 0, dyNorm: 0, scale: 1, rotateDeg: phase * 360 };
		}
		case 'pop': {
			// Pulse 1 → 1.14 with an ease-out snap at each beat.
			const pulse = phase < 0.5 ? 1 + 0.14 * Math.sin(phase * 2 * Math.PI) : 1;
			return { dxNorm: 0, dyNorm: 0, scale: pulse, rotateDeg: 0 };
		}
		case 'breathe': {
			// Slow 1 ↔ 1.06 scale wave + faint 2% drift.
			const wave = 1 + 0.06 * Math.sin(phase * Math.PI * 2);
			return { dxNorm: 0, dyNorm: -(phase - 0.5) * 0.02, scale: wave, rotateDeg: 0 };
		}
		default:
			return null;
	}
}

/** CSS `transform` snippet for a motion at a phase — mirrors
 *  layerMotionTransform for DOM previews (Svelte style=). */
export function layerMotionCss(motionId: string, atMs: number, startMs?: number): string | null {
	const t = layerMotionTransform(motionId, atMs, startMs);
	if (!t) return null;
	const parts: string[] = [];
	if (t.dxNorm || t.dyNorm) parts.push(`translate(${t.dxNorm * 100}%, ${t.dyNorm * 100}%)`);
	if (t.rotateDeg) parts.push(`rotate(${t.rotateDeg}deg)`);
	if (t.scale !== 1) parts.push(`scale(${t.scale})`);
	return parts.join(' ') || null;
}
