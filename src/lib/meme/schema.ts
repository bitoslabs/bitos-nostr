/**
 * Meme project schema — the portable, versioned data model for the Meme Studio.
 *
 * Mirrors the plan's edit-timeline rules (docs/source/plan-bitz-implelemt.md §6.3):
 *   • namespaced schema id + integer version, bumped only on breaking changes
 *   • unknown fields are ignored (old clients keep working)
 *   • time units are integer milliseconds
 *   • coordinates are normalized 0–1 so a draft restores onto any media
 *
 * The rendered *output* is always a standard Nostr media event (NIP-68/71/92
 * for the Bitz feed, NIP-38 status + NIP-40 expiration for stories) — the meme
 * itself is burned into the pixels at export time, so it renders in every
 * Nostr client with zero custom-kind adoption required.
 */

import { memeLookOf } from './look';
import { normalizeMemeFx, type MemeFx } from './fx';

export const MEME_SCHEMA = 'com.bitos.bitz.meme';
export const MEME_SCHEMA_VERSION = 1;

/** Longest single overlay text — meme captions are punchy, not essays. */
export const MAX_OVERLAY_CHARS = 300;
/** Overlay font size measured against stage height, clamped to sane memes. */
export const MIN_OVERLAY_SIZE = 0.03;
export const MAX_OVERLAY_SIZE = 0.22;
export const MAX_OVERLAYS = 12;

export const MEME_FONTS = ['impact', 'sans', 'serif', 'mono'] as const;
export type MemeFont = (typeof MEME_FONTS)[number];

export const MEME_COLORS = [
	'#ffffff',
	'#000000',
	'#fde047',
	'#f97316',
	'#22d3ee',
	'#a3e635',
	'#f472b6'
] as const;

export interface MemeTextOverlay {
	id: string;
	/** Multiline caption text (plain — rendered with fillText, never HTML). */
	text: string;
	/** Center position, normalized to stage width/height (0–1). */
	x: number;
	y: number;
	/** Font size relative to stage height (0.03–0.22). */
	size: number;
	color: string;
	font: MemeFont;
	caps: boolean;
	/** Classic meme outline around the glyphs. */
	stroke: boolean;
	/** Contrast pill behind each line ("subtitle bar" look). */
	bar: boolean;
	/** Visibility window in media time (ms). Missing = always visible. */
	startMs?: number;
	endMs?: number;
	/** Burned-in motion effect (pop/fade/shake/spin). Missing = none. */
	fx?: MemeFx;
}

export interface MemeProject {
	schema: string;
	version: number;
	overlays: MemeTextOverlay[];
	/** Synthesized sound-effect cues scheduled against media time (ms). */
	sfxCues?: MemeSfxCue[];
	caption?: string;
	mediaKind?: 'image' | 'video';
	/** Source-media color look (id from meme/look.ts). Missing = none. */
	lookId?: string;
	createdAt: number;
	updatedAt: number;
}

const COLOR_RE = /^#[0-9a-f]{3,8}$/i;

function newId(): string {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
	return `o-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function num(raw: unknown, fallback: number): number {
	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalMs(raw: unknown): number | undefined {
	if (raw === undefined || raw === null || raw === '') return undefined;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < 0) return undefined;
	return Math.round(parsed);
}

function cleanColor(raw: unknown, fallback = '#ffffff'): string {
	return typeof raw === 'string' && COLOR_RE.test(raw.trim()) ? raw.trim() : fallback;
}

/** Tolerant overlay parser: coerces, clamps and drops unknown fields. */
export function normalizeOverlay(raw: unknown): MemeTextOverlay | null {
	if (!raw || typeof raw !== 'object') return null;
	const o = raw as Record<string, unknown>;
	const text =
		typeof o.text === 'string' ? o.text.replace(/\r/g, '').slice(0, MAX_OVERLAY_CHARS) : '';
	if (!text.trim()) return null;
	const font = MEME_FONTS.includes(o.font as MemeFont) ? (o.font as MemeFont) : 'impact';
	const overlay: MemeTextOverlay = {
		id: typeof o.id === 'string' && o.id.trim() ? o.id.slice(0, 64) : newId(),
		text,
		x: clamp(num(o.x, 0.5), 0, 1),
		y: clamp(num(o.y, 0.5), 0, 1),
		size: clamp(num(o.size, 0.09), MIN_OVERLAY_SIZE, MAX_OVERLAY_SIZE),
		color: cleanColor(o.color),
		font,
		caps: o.caps === undefined ? true : !!o.caps,
		stroke: o.stroke === undefined ? true : !!o.stroke,
		bar: o.bar === undefined ? false : !!o.bar,
		startMs: optionalMs(o.startMs),
		endMs: optionalMs(o.endMs),
		fx: normalizeMemeFx(o.fx)
	};
	// Defensive: a nonsensical window means "always visible".
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

/** Synthesized comedy SFX ids (recipes live in meme/sfx.ts — pure data). */
export const MEME_SFX_IDS = [
	'boom',
	'bruh',
	'laugh',
	'whoosh',
	'pop',
	'boing',
	'drumroll',
	'ding',
	'sad-trombone'
] as const;
export type MemeSfxId = (typeof MEME_SFX_IDS)[number];

/** Sentinel cue key for user-imported sounds (sound library id in `soundId`). */
export const CUSTOM_SOUND_KEY = 'custom' as const;
export type MemeSoundKey = MemeSfxId | typeof CUSTOM_SOUND_KEY;

export interface MemeSfxCue {
	id: string;
	sfx: MemeSoundKey;
	/** Cue point in media time (integer ms, ≥ 0). */
	atMs: number;
	/** Master gain multiplier 0–1 (recipe envelope is scaled by this). */
	gain: number;
	/** Custom sound-library id — required when sfx === 'custom'. */
	soundId?: string;
}

/** Tolerant cue parser — mirrors normalizeOverlay's coerce/clamp/drop rules. */
export function normalizeSfxCue(raw: unknown): MemeSfxCue | null {
	if (!raw || typeof raw !== 'object') return null;
	const c = raw as Record<string, unknown>;
	const soundId =
		typeof c.soundId === 'string' && c.soundId.trim() ? c.soundId.slice(0, 64) : undefined;
	if (c.sfx === CUSTOM_SOUND_KEY) {
		if (!soundId) return null; // custom cues must reference a library sound
	} else if (!MEME_SFX_IDS.includes(c.sfx as MemeSfxId)) return null;
	const at = Number(c.atMs);
	const gain = Number(c.gain);
	return {
		id: typeof c.id === 'string' && c.id.trim() ? c.id.slice(0, 64) : newId(),
		sfx: c.sfx === CUSTOM_SOUND_KEY ? CUSTOM_SOUND_KEY : (c.sfx as MemeSfxId),
		...(c.sfx === CUSTOM_SOUND_KEY && soundId ? { soundId } : {}),
		atMs: Number.isFinite(at) && at > 0 ? Math.round(at) : 0,
		gain: Number.isFinite(gain) ? clamp(gain, 0, 1) : 1
	};
}

const MAX_SFX_CUES = 16;

export function normalizeSfxCues(raw: unknown): MemeSfxCue[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.map(normalizeSfxCue)
		.filter((c): c is MemeSfxCue => !!c)
		.slice(0, MAX_SFX_CUES);
}

/** Cues whose point falls inside the render window [0, durationMs]. */
export function sfxCuesInWindow(cues: MemeSfxCue[], durationMs: number): MemeSfxCue[] {
	if (!Number.isFinite(durationMs) || durationMs <= 0) return [];
	return cues.filter((cue) => cue.atMs < durationMs).sort((a, b) => a.atMs - b.atMs);
}

/** Tolerant project parser — unknown schema ids / too-new majors are rejected. */
export function normalizeProject(raw: unknown): MemeProject | null {
	if (!raw || typeof raw !== 'object') return null;
	const p = raw as Record<string, unknown>;
	if (p.schema !== MEME_SCHEMA) return null;
	const version = num(p.version, MEME_SCHEMA_VERSION);
	if (version < 1 || version > MEME_SCHEMA_VERSION) return null;
	const rawOverlays = Array.isArray(p.overlays) ? p.overlays : [];
	const overlays = rawOverlays
		.map(normalizeOverlay)
		.filter((o): o is MemeTextOverlay => !!o)
		.slice(0, MAX_OVERLAYS);
	const mediaKind = p.mediaKind === 'video' || p.mediaKind === 'image' ? p.mediaKind : undefined;
	const sfxCues = normalizeSfxCues(p.sfxCues);
	const lookId = memeLookOf(p.lookId);
	return {
		schema: MEME_SCHEMA,
		version: MEME_SCHEMA_VERSION,
		overlays,
		...(sfxCues.length ? { sfxCues } : {}),
		caption: typeof p.caption === 'string' ? p.caption.slice(0, 1000) : undefined,
		mediaKind,
		...(lookId !== 'none' ? { lookId } : {}),
		createdAt: num(p.createdAt, Date.now()),
		updatedAt: Date.now()
	};
}

export function buildProject(
	overlays: MemeTextOverlay[],
	options: {
		caption?: string;
		mediaKind?: 'image' | 'video';
		sfxCues?: MemeSfxCue[];
		/** Source-media color look (id from meme/look.ts). */
		lookId?: string;
	} = {}
): MemeProject {
	const sfxCues = normalizeSfxCues(options.sfxCues);
	return {
		schema: MEME_SCHEMA,
		version: MEME_SCHEMA_VERSION,
		overlays: overlays
			.map((o) => normalizeOverlay(o)!)
			.filter(Boolean)
			.slice(0, MAX_OVERLAYS),
		...(sfxCues.length ? { sfxCues } : {}),
		caption: options.caption?.slice(0, 1000),
		mediaKind: options.mediaKind,
		createdAt: Date.now(),
		updatedAt: Date.now()
	};
}

/** Is the overlay on screen at media time `atMs`? Windows are [start, end). */
export function overlayVisibleAt(overlay: MemeTextOverlay, atMs: number): boolean {
	if (overlay.startMs !== undefined && atMs < overlay.startMs) return false;
	if (overlay.endMs !== undefined && atMs >= overlay.endMs) return false;
	return true;
}

/** Fresh overlay with sensible meme defaults. */
export function makeOverlay(partial: Partial<MemeTextOverlay> = {}): MemeTextOverlay {
	return normalizeOverlay({ x: 0.5, y: 0.5, size: 0.09, ...partial })!;
}

export function makeClassicPair(): MemeTextOverlay[] {
	return [
		makeOverlay({ text: 'TOP TEXT', y: 0.12 }),
		makeOverlay({ text: 'BOTTOM TEXT', y: 0.86 })
	];
}
