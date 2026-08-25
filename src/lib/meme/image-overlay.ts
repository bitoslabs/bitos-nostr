/**
 * Image overlays — PNG/GIF/JPEG stickers dropped onto the stage as movable,
 * resizable layers (user request 2026-08-23: "image overlays", rec #1).
 *
 * Model rules (mirrors schema.ts conventions):
 *   • coordinates are normalized 0–1 so a draft restores onto any media
 *   • `src` is http(s), or a bundled same-origin sticker path (`/bitz-buddy/*`
 *     mascot pack + `/bitzverse/*` world props — never uploaded, always
 *     available offline) — base64 never rides the localStorage draft or
 *     the `meme` wire tag (size + relay caps); blobs are uploaded to the
 *     media provider first and the returned URL is what persists
 *   • time windows reuse the overlay timing model (startMs/endMs, integer ms)
 *   • tolerant parsing: unknown fields ignored, junk dropped (old clients
 *     keep working — they simply never see the image layer)
 */

import { isBuddySrc } from './bitz-buddy';
import { isBitzverseSrc } from './bitzverse';
import { layerMotionOf } from './layer-motion';
import { memeLookOf } from './look';

const SRC_RE = /^https:\/\/\S+$/i;

/** Hard cap — image layers are accents, not a collage tool. */
export const MAX_IMAGE_OVERLAYS = 6;
/** Overlay source cap (bytes) before upload — 8 MB keeps renders snappy. */
export const MAX_IMAGE_OVERLAY_BYTES = 8 * 1024 * 1024;
/** Height footprint on the stage (fraction of stage height). */
export const MIN_IMAGE_SIZE = 0.05;
export const MAX_IMAGE_SIZE = 0.9;

export interface MemeImageOverlay {
	id: string;
	/** Image src (https or bundled `/bitz-buddy|bitzverse/*` — never base64). */
	src: string;
	/** Natural aspect (w/h) captured at add time; reused for draft restore. */
	aspect: number;
	/** Center position, normalized to stage width/height (0–1). */
	x: number;
	y: number;
	/** Layer height relative to stage height (0.05–0.9). */
	size: number;
	/** Visibility window in media time (ms). Missing = always visible. */
	startMs?: number;
	endMs?: number;
	/** Opacity 0.05–1. Missing = opaque. */
	opacity?: number;
	/** Rotation in degrees (−180…180, 90 is common). Missing = upright. */
	rotate?: number;
	/** Mirror flips. Missing = false. */
	flipH?: boolean;
	flipV?: boolean;
	/** Per-layer color look (id from meme/look.ts). Missing/none = as-is. */
	lookId?: string;
	/** Ambient motion preset (layer-motion.ts). Missing/none = static. */
	motionId?: string;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function num(raw: unknown, fallback: number): number {
	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function newId(): string {
	return `img-${Math.random().toString(36).slice(2, 10)}`;
}

export function isHttpUrl(raw: string): boolean {
	return SRC_RE.test(raw.trim());
}

/** Layer-legal src: remote https URL or a bundled sticker path. */
export function layerSrcOk(raw: string): boolean {
	return isHttpUrl(raw) || isBuddySrc(raw) || isBitzverseSrc(raw);
}

/** Tolerant parser: coerces, clamps and drops unknown fields. */
export function normalizeImageOverlay(raw: unknown): MemeImageOverlay | null {
	if (!raw || typeof raw !== 'object') return null;
	const o = raw as Record<string, unknown>;
	const src = typeof o.src === 'string' ? o.src.trim() : '';
	if (!layerSrcOk(src)) return null;
	const aspect = clamp(num(o.aspect, 1), 0.05, 20);
	const lookId = memeLookOf(o.lookId);
	const motionId = layerMotionOf(o.motionId);
	const overlay: MemeImageOverlay = {
		id: typeof o.id === 'string' && o.id.trim() ? o.id.slice(0, 64) : newId(),
		src: src.slice(0, 512),
		aspect,
		x: clamp(num(o.x, 0.5), 0, 1),
		y: clamp(num(o.y, 0.5), 0, 1),
		size: clamp(num(o.size, 0.25), MIN_IMAGE_SIZE, MAX_IMAGE_SIZE),
		startMs: o.startMs === undefined ? undefined : Math.max(0, Math.round(Number(o.startMs))),
		endMs: o.endMs === undefined ? undefined : Math.max(0, Math.round(Number(o.endMs))),
		opacity: o.opacity === undefined ? undefined : clamp(num(o.opacity, 1), 0.05, 1),
		rotate:
			o.rotate === undefined || !Number.isFinite(Number(o.rotate))
				? undefined
				: clamp(Math.round(Number(o.rotate)), -180, 180),
		flipH: o.flipH === true ? true : undefined,
		flipV: o.flipV === true ? true : undefined,
		...(lookId !== 'none' ? { lookId } : {}),
		...(motionId !== 'none' ? { motionId } : {})
	};
	if (
		overlay.startMs !== undefined &&
		overlay.endMs !== undefined &&
		overlay.endMs <= overlay.startMs
	) {
		overlay.startMs = undefined;
		overlay.endMs = undefined;
	}
	return overlay;
}

/** Whether a layer is on screen at media time `atMs` (undefined = always). */
export function imageOverlayVisibleAt(overlay: MemeImageOverlay, atMs: number): boolean {
	if (overlay.startMs === undefined && overlay.endMs === undefined) return true;
	if (overlay.startMs !== undefined && atMs < overlay.startMs) return false;
	if (overlay.endMs !== undefined && atMs !== undefined && atMs >= overlay.endMs) return false;
	return true;
}

/** Rotate through anchor spots so consecutive drops don't stack. */
export function makeImageOverlay(
	src: string,
	aspect: number,
	options: { index?: number } = {}
): MemeImageOverlay | null {
	if (!layerSrcOk(src)) return null;
	const i = options.index ?? 0;
	const anchors = [
		{ x: 0.5, y: 0.35 },
		{ x: 0.3, y: 0.6 },
		{ x: 0.7, y: 0.6 },
		{ x: 0.5, y: 0.75 },
		{ x: 0.28, y: 0.3 },
		{ x: 0.72, y: 0.3 }
	];
	const spot = anchors[i % anchors.length]!;
	return normalizeImageOverlay({
		src,
		aspect,
		x: spot.x,
		y: spot.y,
		size: aspect >= 1 ? 0.35 : 0.25
	});
}

/** Serialize for the compact wire `meme` tag; image layers ride the same caps. */
export interface WireImageOverlay {
	u: string; // remote src
	x: number;
	y: number;
	s: number;
	a?: number; // aspect
	w?: [number, number]; // [startMs, endMs]
	o?: number; // opacity (0–1, only when < 1)
	r?: number; // rotation degrees (only when ≠ 0)
	fh?: 1; // horizontal flip (only when true)
	fv?: 1; // vertical flip (only when true)
	k?: string; // per-layer look id (only when set)
	m?: string; // ambient motion preset id (only when set)
}

export function encodeImageOverlay(overlay: MemeImageOverlay): WireImageOverlay {
	const w: WireImageOverlay = {
		u: overlay.src,
		x: round2(overlay.x),
		y: round2(overlay.y),
		s: round2(overlay.size)
	};
	if (overlay.aspect !== 1) w.a = round2(overlay.aspect);
	if (overlay.startMs !== undefined && overlay.endMs !== undefined)
		w.w = [overlay.startMs, overlay.endMs];
	if (overlay.opacity !== undefined && overlay.opacity < 1)
		w.o = Math.round(overlay.opacity * 20) / 20;
	if (overlay.rotate) w.r = overlay.rotate;
	if (overlay.flipH) w.fh = 1;
	if (overlay.flipV) w.fv = 1;
	if (overlay.lookId && overlay.lookId !== 'none') w.k = overlay.lookId;
	if (overlay.motionId && overlay.motionId !== 'none') w.m = overlay.motionId;
	return w;
}

export function decodeImageOverlay(w: unknown): MemeImageOverlay | null {
	if (!w || typeof w !== 'object') return null;
	const raw = w as Partial<WireImageOverlay>;
	return normalizeImageOverlay({
		src: raw.u,
		aspect: raw.a ?? 1,
		x: raw.x,
		y: raw.y,
		size: raw.s,
		startMs: raw.w?.[0],
		endMs: raw.w?.[1],
		opacity: raw.o,
		rotate: raw.r,
		flipH: raw.fh === 1,
		flipV: raw.fv === 1,
		lookId: raw.k,
		motionId: raw.m
	});
}

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}
