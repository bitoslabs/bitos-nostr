/**
 * SVG layer support (user report 2026-08-25: "why cannot support preview svg").
 *
 * An `<svg>` loads into an <img> fine, but one without intrinsic
 * width/height attributes (only a viewBox — the common export from design
 * tools) decodes to a 0×0 bitmap:
 *   • probeAspect() reads naturalWidth 0 → null → the layer is forced square
 *     and the stage shows a dashed placeholder;
 *   • canvas exports draw NOTHING (drawImage of a no-intrinsic-size image
 *     paints empty) — the layer silently vanishes from published memes.
 *
 * Rather than special-casing SVG at every paint site, layers rasterize ONCE
 * at add time: parse the root tag for a pixel size, draw to an offscreen
 * canvas at up to 1024px long edge, and keep the PNG bytes. Every downstream
 * path (aspect probe, same-origin render blob, export drawImage, drafts via
 * the provider URL) then behaves exactly like a PNG upload. Vector fidelity
 * at sticker scale is visually identical.
 *
 * Safety: SVG-as-image never executes scripts, and the image loader blocks
 * external subresources inside SVG documents — object-URL rasterization is
 * the standard safe path (no canvas taint, no script execution).
 */

/** Rasterization long-edge cap (px). Stickers never need more on a 1080p+ stage. */
export const SVG_MAX_EDGE = 1024;
/** Long-edge floor (px) — tiny icons upscale losslessly (vector source). */
export const SVG_MIN_EDGE = 64;

/** Dimensions parsed off the root <svg> tag (null when absent/junk/percent). */
export interface SvgSize {
	w: number | null;
	h: number | null;
	vbW: number | null;
	vbH: number | null;
}

/** Read one attribute off the root tag — double or single quoted. */
function attr(text: string, name: string): string | null {
	const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(text);
	if (!match) return null;
	return (match[1] ?? match[2] ?? '').trim();
}

/** Pixel length only — percentages/units other than px are ignored. */
function px(raw: string | null): number | null {
	if (!raw) return null;
	const match = /^([0-9]*\.?[0-9]+)\s*(?:px)?$/i.exec(raw.trim());
	if (!match) return null;
	const value = Number(match[1]);
	return Number.isFinite(value) && value > 0 ? value : null;
}

/** Tolerant root-tag parse. Only the first 4 KB are inspected — attributes
 *  live on the <svg …> tag in every real-world file. */
export function parseSvgSize(text: string): SvgSize {
	const head = text.slice(0, 4096);
	const viewBox = attr(head, 'viewBox');
	let vbW: number | null = null;
	let vbH: number | null = null;
	if (viewBox) {
		const parts = viewBox.split(/[\s,]+/).map(Number);
		if (
			parts.length === 4 &&
			parts.every((n) => Number.isFinite(n)) &&
			parts[2]! > 0 &&
			parts[3]! > 0
		) {
			vbW = parts[2]!;
			vbH = parts[3]!;
		}
	}
	return { w: px(attr(head, 'width')), h: px(attr(head, 'height')), vbW, vbH };
}

/** Target raster dimensions: clamp the long edge into [minEdge, maxEdge].
 *  Downscaling bounds memory; upscaling tiny icons is lossless (vector).
 *  Null when no usable dimensions at all. */
export function rasterSize(
	size: SvgSize,
	maxEdge = SVG_MAX_EDGE,
	minEdge = SVG_MIN_EDGE
): { w: number; h: number } | null {
	const w = size.w ?? size.vbW;
	const h = size.h ?? size.vbH;
	if (!w || !h) return null;
	const longest = Math.max(w, h);
	let scale = 1;
	if (longest > maxEdge) scale = maxEdge / longest;
	else if (longest < minEdge) scale = minEdge / longest;
	return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

/** Does this blob look like an SVG? Content type wins; typeless files (some
 *  OS pickers) get a `<svg` markup sniff. */
export async function looksLikeSvg(blob: Blob): Promise<boolean> {
	if (blob.type.includes('svg')) return true;
	try {
		return (await blob.text()).slice(0, 2048).toLowerCase().includes('<svg');
	} catch {
		return false;
	}
}

/** Rasterize an SVG blob to PNG bytes (add-time, one-shot). Null on any
 *  failure or non-browser environment — callers keep the flow moving with a
 *  clear message instead of a broken layer. */
export async function rasterizeSvgBlob(blob: Blob, maxEdge = SVG_MAX_EDGE): Promise<Blob | null> {
	if (typeof document === 'undefined') return null;
	try {
		const target = rasterSize(parseSvgSize(await blob.text()), maxEdge);
		if (!target) return null;
		const url = URL.createObjectURL(blob);
		try {
			const img = await new Promise<HTMLImageElement>((resolve, reject) => {
				const el = new Image();
				el.onload = () => resolve(el);
				el.onerror = () => reject(new Error('svg decode failed'));
				el.src = url;
			});
			const canvas = document.createElement('canvas');
			canvas.width = target.w;
			canvas.height = target.h;
			const ctx = canvas.getContext('2d');
			if (!ctx) return null;
			ctx.drawImage(img, 0, 0, target.w, target.h);
			return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
		} finally {
			URL.revokeObjectURL(url);
		}
	} catch {
		return null;
	}
}
