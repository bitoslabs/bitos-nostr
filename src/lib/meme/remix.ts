/**
 * Template remix chain — the "use this sound + layout" loop (plan §17 creator
 * economy, recommendation #1). A published meme can be remixed by cloning its
 * overlay layout + SFX cue sheet onto new media.
 *
 * Nostr transport: publishes carry a `remix` tag pointing at the source event
 * (`["remix", "<event-id>", "<relay-url>", ...]`) — NIP-style inline, no
 * custom kinds, so every client that understands `e` tags renders the chain.
 * The overlay/cue payload itself travels in an `alt`-adjacent `meme` tag as
 * compact JSON (schema `com.bitos.bitz.meme`, versioned, tolerant parse).
 */
import {
	MEME_SCHEMA_VERSION,
	normalizeOverlay,
	normalizeSfxCues,
	type MemeSfxCue,
	type MemeTextOverlay
} from './schema';
import {
	decodeImageOverlay,
	encodeImageOverlay,
	normalizeImageOverlay,
	MAX_IMAGE_OVERLAYS,
	type MemeImageOverlay,
	type WireImageOverlay
} from './image-overlay';
import { MAX_ZOOM_WINDOWS, normalizeZoomWindows } from './zoom-track';
import {
	decodeFxWindows,
	encodeFxWindows,
	normalizeFxWindows,
	MAX_FX_WINDOWS as WIRE_FX_CAP
} from './fx-track';
import type { FrameFxWindow, WireFx } from './fx-track';
import {
	decodeSpeedWindows,
	encodeSpeedWindows,
	normalizeSpeedWindows,
	MAX_SPEED_WINDOWS as WIRE_SPEED_CAP
} from './speed-track';
import type { SpeedWindow } from './speed-track';
import type { ZoomWindow } from '$lib/ai/suggest';
import { eventRefFor, eventRefKey } from '$lib/nostr/event-ref';

/** Wire cap for `g` (graphics) — tighter than the editor's 6 because the meme
 *  tag caps at 700 chars total; URLs alone can eat 100+ chars each. */
export const MAX_IMAGE_OVERLAYS_ON_WIRE = Math.min(MAX_IMAGE_OVERLAYS, 3);

/** Max serialized remix payload — relays cap tags at ~180 chars by convention
 *  but most accept more; we compact + cap hard to stay relay-friendly. */
export const MAX_MEME_TAG_CHARS = 700;

export interface RemixSource {
	/** Event id of the meme being remixed. */
	eventId: string;
	/** Author pubkey of the source (for the p-tag attribution). */
	pubkey: string;
	/** Relay hints for the source event. */
	relays?: string[];
}

export interface RemixPayload {
	overlays: MemeTextOverlay[];
	sfxCues: MemeSfxCue[];
	/** Raster image layers (2026-08-23): ordered bottom-to-top, capped. */
	imageLayers?: MemeImageOverlay[];
	/** Punch-in zoom windows (compact-wire): media-timed like sfxCues. */
	zoomWindows?: ZoomWindow[];
	/** Frame-FX windows (glitch/flash/shake/…) — media-timed like zooms. */
	fxWindows?: FrameFxWindow[];
	/** Speed-ramp windows (slow-mo / speed-up) — media-timed like zooms.
	 *  Studio UI consumption ships in V2; the wire codec keeps round-trips
	 *  lossless so remixed memes don't lose the author's ramps. */
	speedWindows?: SpeedWindow[];
}

/** Compact wire format — ids stripped (fresh ids on apply), booleans packed. */
interface WireOverlay {
	t: string;
	x: number;
	y: number;
	s: number;
	c?: string;
	f?: string;
	k?: boolean; // caps default true
	o?: boolean; // stroke default true
	b?: boolean; // bar default false
	w?: [number, number]; // [startMs, endMs]
}

interface WireCue {
	s: string; // sfx id or 'custom'
	i?: string; // soundId for custom
	a: number; // atMs
	g: number; // gain
	l?: number; // mixer lane
}

/** Compact zoom window: [startMs, endMs, factor(2dp), cx(2dp), cy(2dp)]. */
type WireZoom = [number, number, number, number, number];

/** Serialize overlays + cues into the compact `meme` tag payload. */
export function encodeRemixPayload(payload: RemixPayload): string {
	const wire: {
		v: number;
		o: WireOverlay[];
		c: WireCue[];
		g?: WireImageOverlay[];
		z?: WireZoom[];
		f?: WireFx[];
	} = {
		v: MEME_SCHEMA_VERSION,
		o: payload.overlays.map((ol) => {
			const w: WireOverlay = { t: ol.text, x: round2(ol.x), y: round2(ol.y), s: round2(ol.size) };
			if (ol.color && ol.color !== '#ffffff') w.c = ol.color;
			if (ol.font && ol.font !== 'impact') w.f = ol.font;
			if (ol.caps === false) w.k = false;
			if (ol.stroke === false) w.o = false;
			if (ol.bar) w.b = true;
			if (ol.startMs !== undefined && ol.endMs !== undefined) w.w = [ol.startMs, ol.endMs];
			return w;
		}),
		c: payload.sfxCues.map((cue) =>
			cue.sfx === 'custom'
				? {
						s: cue.sfx,
						...(cue.soundId ? { i: cue.soundId } : {}),
						a: cue.atMs,
						g: cue.gain,
						...(cue.lane ? { l: cue.lane } : {})
					}
				: { s: cue.sfx, a: cue.atMs, g: cue.gain, ...(cue.lane ? { l: cue.lane } : {}) }
		),
		// Image layers ride as `g` ("graphics") — omitted entirely when none,
		// and hard-capped so a collage never blows the 700-char tag limit.
		...(payload.imageLayers?.length
			? {
					g: payload.imageLayers.slice(0, MAX_IMAGE_OVERLAYS_ON_WIRE).map(encodeImageOverlay)
				}
			: {}),
		// Zoom windows ride as `z` — same covenant: omitted when the track is
		// empty, capped, media-timed milliseconds like the cue sheet.
		...(payload.zoomWindows?.length
			? {
					z: payload.zoomWindows
						.slice(0, MAX_ZOOM_WINDOWS)
						.map((w): WireZoom => [
							w.startMs,
							w.endMs,
							round2(w.factor),
							round2(w.cx),
							round2(w.cy)
						])
				}
			: {}),
		// Frame-FX windows ride as `f` — same covenant: omitted when empty,
		// capped by the fx-track limit, media-timed like the zooms.
		...(payload.fxWindows?.length
			? { f: encodeFxWindows(payload.fxWindows).slice(0, WIRE_FX_CAP) }
			: {}),
		// Speed-ramp windows ride as `s` — same covenant again.
		...(payload.speedWindows?.length
			? { s: encodeSpeedWindows(payload.speedWindows).slice(0, WIRE_SPEED_CAP) }
			: {})
	};
	return JSON.stringify(wire);
}

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

/** Tolerant parse of a `meme` tag payload; null when unusable. */
export function decodeRemixPayload(raw: string | undefined): RemixPayload | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as {
			v?: number;
			o?: WireOverlay[];
			c?: WireCue[];
			g?: unknown[];
			z?: unknown[];
			f?: unknown[];
			s?: unknown[];
		};
		if (!parsed || typeof parsed !== 'object') return null;
		if (!Array.isArray(parsed.o)) return null;
		const overlays = parsed.o
			.map((w) =>
				normalizeOverlay({
					text: w.t,
					x: w.x,
					y: w.y,
					size: w.s,
					color: w.c,
					font: w.f,
					caps: w.k === undefined ? true : w.k,
					stroke: w.o === undefined ? true : w.o,
					bar: !!w.b,
					startMs: w.w?.[0],
					endMs: w.w?.[1]
				})
			)
			.filter((o): o is MemeTextOverlay => !!o)
			.slice(0, 12);
		const cues = normalizeSfxCues(
			(parsed.c ?? []).map((w) => ({
				sfx: w.s,
				soundId: w.i,
				atMs: w.a,
				gain: w.g,
				lane: w.l
			}))
		);
		const imageLayers = (parsed.g ?? [])
			.map(decodeImageOverlay)
			.filter((l): l is MemeImageOverlay => !!l)
			.slice(0, MAX_IMAGE_OVERLAYS_ON_WIRE);
		const zoomWindows = normalizeZoomWindows(parsed.z ?? []);
		const fxWindows = decodeFxWindows(parsed.f ?? []);
		const speedWindows = normalizeSpeedWindows(decodeSpeedWindows(parsed.s ?? []));
		return {
			overlays,
			sfxCues: cues,
			...(imageLayers.length ? { imageLayers } : {}),
			...(zoomWindows.length ? { zoomWindows } : {}),
			...(fxWindows.length ? { fxWindows } : {}),
			...(speedWindows.length ? { speedWindows } : {})
		};
	} catch {
		return null;
	}
}

/** Build the `remix` + `meme` tags for a publish that derives from a source. */
export function remixTagsFor(source: RemixSource, payload: RemixPayload): string[][] {
	const tags: string[][] = [];
	const encoded = encodeRemixPayload(payload);
	const remix: string[] = ['remix', source.eventId];
	for (const relay of (source.relays ?? []).slice(0, 3)) remix.push(relay);
	tags.push(remix);
	tags.push(['meme', encoded.slice(0, MAX_MEME_TAG_CHARS)]);
	// Attribution: the source author is a first-class p-tag (NIP-27 notify).
	if (source.pubkey) tags.push(['p', source.pubkey]);
	return tags;
}

/** Read the remix lineage off an event's tags. */
export function remixOf(tags: string[][]): RemixSource | null {
	const remix = tags.find((t) => ['remix', 'bitz:edge'].includes(t[0]) && t[1]);
	if (!remix) return null;
	// `bitz:edge` form: ["bitz:edge", "remix", "event:<id>", "1"]
	const eventId = remix[0] === 'bitz:edge' ? (remix[2] ?? '').replace(/^event:/, '') : remix[1];
	if (!eventId) return null;
	const p = tags.find((t) => t[0] === 'p' && t[1])?.[1] ?? '';
	const relays = remix[0] === 'bitz:edge' ? [] : remix.slice(2);
	return { eventId, pubkey: p, relays };
}

/* ------------------------- remix rights (S-013, §17.3) ------------------------- */

/** Advisory license codes a publisher may stamp on a bitz (plan §17). */
export const REMIX_LICENSES = [
	'CC0-1.0',
	'CC-BY-4.0',
	'CC-BY-NC-4.0',
	'bitz/source-permission',
	'bitz/all-reserved'
] as const;

export type RemixLicense = (typeof REMIX_LICENSES)[number];

/** Anything unknown a reader finds in a `license` tag — surfaced, not trusted. */
export interface RemixRights {
	/** License code from the `license` tag ('' when absent). */
	license: string;
	/** True when the code is in our known advisory vocabulary. */
	known: boolean;
	/** True when the license permits derivative bitz (CC0/CC-BY/CC-BY-NC). */
	remixable: boolean;
	/** Free-text credit from the `attribution` tag, '' when absent. */
	attribution: string;
}

export function isRemixLicense(code: string): code is RemixLicense {
	return (REMIX_LICENSES as readonly string[]).includes(code);
}

/**
 * Build the rights tags for a publish. `license` must be a known code —
 * unknown codes throw so typos never masquerade as policy. Attribution text
 * is capped to keep tags relay-friendly.
 */
export function rightsTagsFor(license: RemixLicense, attribution = ''): string[][] {
	const tags: string[][] = [['license', license]];
	const credit = attribution.trim().slice(0, MAX_ATTRIBUTION_CHARS);
	if (credit) tags.push(['attribution', credit]);
	return tags;
}

/** Max attribution text length (relay tag friendliness). */
export const MAX_ATTRIBUTION_CHARS = 140;

/**
 * Tolerant read of a bitz's declared rights. Absent tags ⇒ permissive default
 * (license '', remixable true): the open network is advisory-only (§17.3), so
 * missing metadata must never hide or block a reel — the UI separates
 * protocol provenance from legal permission.
 */
export function rightsOf(tags: string[][]): RemixRights {
	const code = tags.find((t) => t[0] === 'license' && t[1])?.[1] ?? '';
	const attribution = tags.find((t) => t[0] === 'attribution' && t[1])?.[1] ?? '';
	const known = isRemixLicense(code);
	const remixable = known
		? code === 'bitz/all-reserved'
			? false
			: code === 'bitz/source-permission'
				? false
				: true
		: true;
	return { license: code, known, remixable, attribution };
}

/**
 * Advisory remix policy for the UI: whether to offer "Remix this meme"
 * without an extra confirmation. Always advisory — readers stay free to
 * create what they want; `all-reserved`/`source-permission` sources get a
 * "creator hasn't allowed remixes" prompt instead of a hidden feature.
 */
export function canRemix(rights: RemixRights): { allowed: boolean; requiresAsk: boolean } {
	if (rights.remixable) return { allowed: true, requiresAsk: false };
	return { allowed: true, requiresAsk: true };
}

/** Extract the remixed layout from an event (meme tag → overlays + cues). */
export function remixLayoutOf(tags: string[][]): RemixPayload | null {
	const meme = tags.find((t) => t[0] === 'meme');
	if (!meme?.[1]) return null;
	return decodeRemixPayload(meme[1]);
}

/** Identity key for "same source" checks (remix feeds, dedupe). */
export function remixSourceKey(event: {
	id?: string;
	pubkey?: string;
	kind: number;
	tags: string[][];
}): string {
	return eventRefKey(eventRefFor(event) ?? { variant: 'event', id: '' });
}

/** Clone a payload with fresh overlay/cue ids so each remix is independently
 *  editable (mirrors memeTemplates.apply semantics). */
export function applyRemixPayload(payload: RemixPayload): {
	overlays: MemeTextOverlay[];
	sfxCues: MemeSfxCue[];
	imageLayers: MemeImageOverlay[];
	zoomWindows: ZoomWindow[];
	fxWindows: FrameFxWindow[];
	speedWindows: SpeedWindow[];
} {
	// Strip ids first — normalizeOverlay/normalizeSfxCues keep valid ids, and a
	// remix must be an independent clone (mirrors memeTemplates.apply).
	const overlays = payload.overlays
		.map((o) => normalizeOverlay({ ...o, id: undefined }))
		.filter((o): o is MemeTextOverlay => !!o);
	const sfxCues = normalizeSfxCues(payload.sfxCues.map((c) => ({ ...c, id: undefined })));
	const imageLayers = (payload.imageLayers ?? [])
		.map((l) => normalizeImageOverlay({ ...l, id: undefined }))
		.filter((l): l is MemeImageOverlay => !!l)
		.slice(0, MAX_IMAGE_OVERLAYS_ON_WIRE);
	const zoomWindows = normalizeZoomWindows(payload.zoomWindows ?? []);
	const fxWindows = normalizeFxWindows(payload.fxWindows ?? []);
	const speedWindows = normalizeSpeedWindows(payload.speedWindows ?? []);
	return { overlays, sfxCues, imageLayers, zoomWindows, fxWindows, speedWindows };
}

// ---- Remix DAG (plan §17 / ledger CRE-006, S-014) ----------------------------
//
// Lineage is a directed chain: event → remix source → its source → … The plan
// requires cycle protection during projection and a bounded walk (readers must
// never chase an infinite chain). Two layers:
//   • `remixChainOf` — walks fetched ancestors via an injected loader, stops
//     at MAX_REMIX_DEPTH, detects local cycles and malformed steps.
//   • `wouldCycle`   — publish-time guard: the new event's id must not appear
//     in its own ancestry (a malicious/self-referential fork).

/** Hard cap on lineage walks — beyond this the tail is dropped. */
export const MAX_REMIX_DEPTH = 32;

export interface RemixAncestor {
	eventId: string;
	pubkey: string;
	depth: number;
}

export type RemixChainResult =
	| { ok: true; chain: RemixAncestor[]; truncated: boolean }
	| { ok: false; reason: 'cycle' | 'loader-error' };

/**
 * Walk the remix ancestry of an event. `load` receives an event id and returns
 * its tags (or null when unknown — treated as the chain's natural end, so a
 * pruned relay history degrades gracefully instead of erroring).
 */
export async function remixChainOf(
	tags: string[][],
	load: (eventId: string) => Promise<string[][] | null>
): Promise<RemixChainResult> {
	const chain: RemixAncestor[] = [];
	const seen = new Set<string>();
	let current = remixOf(tags);
	let truncated = false;
	while (current) {
		if (chain.length >= MAX_REMIX_DEPTH) {
			truncated = true;
			break;
		}
		if (seen.has(current.eventId)) return { ok: false, reason: 'cycle' };
		seen.add(current.eventId);
		chain.push({ eventId: current.eventId, pubkey: current.pubkey, depth: chain.length });
		let parentTags: string[][] | null;
		try {
			parentTags = await load(current.eventId);
		} catch {
			return { ok: false, reason: 'loader-error' };
		}
		current = parentTags ? remixOf(parentTags) : null;
	}
	return { ok: true, chain, truncated };
}

/**
 * Publish-time cycle guard: chaining `newEventId` onto `source` must never
 * create a loop. Walks the source's ancestry with `load` exactly like
 * `remixChainOf` and fails if the new id (or any repetition) shows up.
 */
export async function wouldCycle(
	newEventId: string,
	source: RemixSource,
	load: (eventId: string) => Promise<string[][] | null>
): Promise<boolean> {
	// An event referencing itself directly is malformed regardless of loader.
	if (newEventId === source.eventId) return true;
	const seen = new Set<string>([newEventId]);
	let current: RemixSource | null = source;
	let steps = 0;
	while (current) {
		if (++steps > MAX_REMIX_DEPTH) return true; // unbounded => treat as cyclic
		if (seen.has(current.eventId)) return true;
		seen.add(current.eventId);
		let parentTags: string[][] | null;
		try {
			parentTags = await load(current.eventId);
		} catch {
			return true; // unknown history — refuse rather than risk a loop
		}
		current = parentTags ? remixOf(parentTags) : null;
	}
	return false;
}
