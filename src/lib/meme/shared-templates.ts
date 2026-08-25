import {
	MAX_OVERLAYS,
	MAX_SFX_CUES,
	normalizeOverlay,
	normalizeSfxCues,
	type MemeSfxCue,
	type MemeTextOverlay
} from '$lib/meme/schema';
import { MAX_IMAGE_OVERLAYS, normalizeImageOverlay, type MemeImageOverlay } from './image-overlay';
import { MAX_FX_WINDOWS, normalizeFxWindows, type FrameFxWindow } from './fx-track';
import { MAX_ZOOM_WINDOWS, normalizeZoomWindows } from './zoom-track';
import type { ZoomWindow } from '$lib/ai/suggest';
import { normalizeSpeedWindows, type SpeedWindow } from './speed-track';

/**
 * Shared meme templates over Nostr (audit gap #8 / CRE-004 Phase 6).
 *
 * A shared template is a NIP-78 `kind:30078` addressable event carrying a
 * caption layout — the same portable overlay list the local template store
 * persists, published to relays so other bitz creators can remix it.
 *
 *   d  = com.bitos.bitz:template:<id>   (namespaced, mirrors shared-sounds)
 *   content = {"schema":"com.bitos.bitz.template","version":1,
 *              "label":..., "icon":..., "overlays":[...]}
 *   tags = client / attribution?
 *
 * Overlays are already normalized coordinates (x/y/size in 0..1) so a layout
 * re-applies onto any media; normalizeOverlay re-validates every foreign row
 * (readers must never trust remote JSON). No media bytes are involved, so
 * unlike shared sounds there is no url/hash/upload path — the layout IS the
 * payload.
 */

export const TEMPLATE_SCHEMA = 'com.bitos.bitz.template';
export const TEMPLATE_SCHEMA_VERSION = 2;

/** d-tag namespace prefix for shared templates (mirrors SOUND_D_PREFIX). */
export const TEMPLATE_D_PREFIX = 'com.bitos.bitz:template:';

/** Icon allowlist — remote icons can't inject arbitrary icon names. */
export const TEMPLATE_ICONS = [
	'i-lucide-bookmark',
	'i-lucide-clapperboard',
	'i-lucide-circle-dot-dashed',
	'i-lucide-message-square-text',
	'i-lucide-letter-text',
	'i-lucide-captions',
	'i-lucide-columns-2',
	'i-lucide-zap'
] as const;

export function isTemplateIcon(icon: string): icon is (typeof TEMPLATE_ICONS)[number] {
	return (TEMPLATE_ICONS as readonly string[]).includes(icon);
}

export interface SharedTemplate {
	eventId: string;
	/** Library-facing stable id (the d-tag suffix). */
	templateId: string;
	label: string;
	icon: string;
	overlays: MemeTextOverlay[];
	/** Timed extras (wire v2, all optional — absent on v1 layouts):
	 *  sounds, zoom punches, frame-fx windows, speed ramps and sticker
	 *  layers riding the template, mirroring the studio template shape. */
	sfxCues?: MemeSfxCue[];
	zoomWindows?: ZoomWindow[];
	fxWindows?: FrameFxWindow[];
	speedWindows?: SpeedWindow[];
	imageLayers?: MemeImageOverlay[];
	creatorPubkey: string;
	createdAt: number;
}

interface TemplateContent {
	label: string;
	icon: string;
	overlays: unknown[];
	sfxCues?: unknown[];
	zoomWindows?: unknown[];
	fxWindows?: unknown[];
	speedWindows?: unknown[];
	imageLayers?: unknown[];
}

/** Sanitize timed extras (v2 content). Every row re-validates — readers
 *  never trust remote JSON — and each track clamps to its own cap. */
function normalizeTimedExtras(content: TemplateContent) {
	const sfxCues = normalizeSfxCues(content.sfxCues ?? []).slice(0, MAX_SFX_CUES);
	const zoomWindows = normalizeZoomWindows(content.zoomWindows ?? []).slice(0, MAX_ZOOM_WINDOWS);
	const fxWindows = normalizeFxWindows(content.fxWindows ?? []).slice(0, MAX_FX_WINDOWS);
	const speedWindows = normalizeSpeedWindows(content.speedWindows ?? []).slice(0, MAX_FX_WINDOWS);
	const imageLayers = (content.imageLayers ?? [])
		.map((l) => normalizeImageOverlay(l as Record<string, unknown>))
		.filter((l): l is MemeImageOverlay => l !== null)
		.slice(0, MAX_IMAGE_OVERLAYS);
	return {
		...(sfxCues.length ? { sfxCues } : {}),
		...(zoomWindows.length ? { zoomWindows } : {}),
		...(fxWindows.length ? { fxWindows } : {}),
		...(speedWindows.length ? { speedWindows } : {}),
		...(imageLayers.length ? { imageLayers } : {})
	};
}

/** Build the d-tag + content + tags for publishing a saved template. */
export function sharedTemplateEventParts(input: {
	templateId: string;
	label: string;
	icon: string;
	overlays: MemeTextOverlay[];
	sfxCues?: MemeSfxCue[];
	zoomWindows?: ZoomWindow[];
	fxWindows?: FrameFxWindow[];
	speedWindows?: SpeedWindow[];
	imageLayers?: MemeImageOverlay[];
	clientTag: string[][];
}): { d: string; content: string; tags: string[][] } {
	const overlays = input.overlays
		.map((o) => normalizeOverlay(o))
		.filter((o): o is MemeTextOverlay => o !== null)
		.slice(0, MAX_OVERLAYS);
	if (!overlays.length) throw new Error('Add at least one caption before sharing a template');
	const content: TemplateContent = {
		label: input.label.trim().slice(0, 40) || 'Shared template',
		icon: isTemplateIcon(input.icon) ? input.icon : 'i-lucide-bookmark',
		overlays,
		...(input.sfxCues?.length ? { sfxCues: input.sfxCues } : {}),
		...(input.zoomWindows?.length ? { zoomWindows: input.zoomWindows } : {}),
		...(input.fxWindows?.length ? { fxWindows: input.fxWindows } : {}),
		...(input.speedWindows?.length ? { speedWindows: input.speedWindows } : {}),
		...(input.imageLayers?.length ? { imageLayers: input.imageLayers } : {})
	};
	const tags: string[][] = [
		...input.clientTag,
		['d', `${TEMPLATE_D_PREFIX}${input.templateId}`],
		['label', content.label]
	];
	return {
		d: `${TEMPLATE_D_PREFIX}${input.templateId}`,
		content: JSON.stringify({
			schema: TEMPLATE_SCHEMA,
			version: TEMPLATE_SCHEMA_VERSION,
			...content
		}),
		tags
	};
}

/**
 * Tolerant parse of one candidate event into a SharedTemplate. Returns null
 * for anything malformed (wrong schema, empty overlays, oversized payloads…)
 * so foreign junk never crashes the picker.
 */
export function parseSharedTemplate(event: {
	id: string;
	pubkey: string;
	created_at: number;
	kind: number;
	content: string;
	tags: string[][];
}): SharedTemplate | null {
	if (event.kind !== 30078) return null;
	const d = event.tags.find((t) => t[0] === 'd' && typeof t[1] === 'string');
	if (!d || !d[1]!.startsWith(TEMPLATE_D_PREFIX)) return null;
	let content: TemplateContent;
	try {
		const parsed = JSON.parse(event.content) as Record<string, unknown>;
		if (parsed.schema !== TEMPLATE_SCHEMA) return null;
		content = parsed as unknown as TemplateContent;
	} catch {
		return null;
	}
	const overlays = (Array.isArray(content.overlays) ? content.overlays : [])
		.map(normalizeOverlay)
		.filter((o): o is MemeTextOverlay => o !== null)
		.slice(0, MAX_OVERLAYS);
	if (!overlays.length) return null;
	return {
		eventId: event.id,
		templateId: d[1]!.slice(TEMPLATE_D_PREFIX.length) || event.id.slice(0, 16),
		label:
			(typeof content.label === 'string' && content.label.trim().slice(0, 40)) || 'Shared template',
		icon: isTemplateIcon(content.icon) ? content.icon : 'i-lucide-bookmark',
		overlays,
		...normalizeTimedExtras(content),
		creatorPubkey: event.pubkey,
		createdAt: event.created_at
	};
}

/** Rank picker results: newest first; author's own templates sink (already had them). */
export function rankSharedTemplates(
	templates: SharedTemplate[],
	selfPubkey: string
): SharedTemplate[] {
	return [...templates].sort((a, b) => {
		const selfA = a.creatorPubkey === selfPubkey ? 1 : 0;
		const selfB = b.creatorPubkey === selfPubkey ? 1 : 0;
		if (selfA !== selfB) return selfA - selfB;
		return b.createdAt - a.createdAt;
	});
}
