/**
 * Meme "look" presets — one-tap color filters applied to the source media
 * (never the captions). User request 2026-08-23 ("button options: sticker |
 * gif | ...etc").
 *
 * One string, two renderers: every preset's `css` is a standard CSS filter
 * chain used BOTH as the DOM preview (`style="filter:…"`) and the export
 * (`ctx.filter = …` before drawing the media) — so what you see is exactly
 * what gets burned in.
 *
 * IDs (not raw CSS) ride the project schema and drafts; unknown ids degrade
 * to `none`. Browsers without canvas `ctx.filter` (old Safari) get the Look
 * picker disabled rather than a preview/export mismatch.
 */

export interface MemeLook {
	id: string;
	label: string;
	/** CSS filter chain — valid as element style AND CanvasRenderingContext2D.filter. */
	css: string;
}

export const MEME_LOOKS: readonly MemeLook[] = [
	{ id: 'none', label: 'None', css: 'none' },
	{ id: 'mono', label: 'B&W', css: 'grayscale(1)' },
	{ id: 'noir', label: 'Noir', css: 'grayscale(1) contrast(1.35) brightness(0.92)' },
	{ id: 'sepia', label: 'Sepia', css: 'sepia(0.85) saturate(1.2)' },
	{ id: 'vhs', label: 'VHS', css: 'hue-rotate(-12deg) saturate(1.6) contrast(1.12)' },
	{ id: 'deepfry', label: 'Deep fry', css: 'saturate(3.2) contrast(1.6)' },
	{ id: 'dream', label: 'Dream', css: 'blur(1.2px) brightness(1.12) saturate(1.25)' },
	{ id: 'invert', label: 'Invert', css: 'invert(1)' }
] as const;

export type MemeLookId =
	'none' | 'mono' | 'noir' | 'sepia' | 'vhs' | 'deepfry' | 'dream' | 'invert';

const LOOK_IDS = new Set<string>(MEME_LOOKS.map((look) => look.id));

/** Tolerant reader for schema/draft/relay data — unknown ⇒ `none`. */
export function memeLookOf(raw: unknown): MemeLookId {
	return typeof raw === 'string' && LOOK_IDS.has(raw) ? (raw as MemeLookId) : 'none';
}

/** The CSS filter chain for an id (always non-empty; `none` for no filter). */
export function memeLookCss(raw: unknown): string {
	const id = memeLookOf(raw);
	return MEME_LOOKS.find((look) => look.id === id)?.css ?? 'none';
}

/** Can this browser burn looks into exports? (canvas filter support) */
export function canvasFiltersSupported(): boolean {
	if (typeof document === 'undefined' && typeof OffscreenCanvas === 'undefined') return false;

	try {
		const canvas =
			typeof OffscreenCanvas !== 'undefined'
				? new OffscreenCanvas(1, 1)
				: document.createElement('canvas');
		const context = canvas.getContext('2d');
		if (!context) return false;

		// `filter` is an accessor in some browsers. Reading it from
		// CanvasRenderingContext2D.prototype causes an Illegal invocation;
		// always probe it on a real context instead.
		const previous = context.filter;
		context.filter = 'grayscale(1)';
		const supported = context.filter === 'grayscale(1)';
		context.filter = previous;
		return supported;
	} catch {
		return false;
	}
}
