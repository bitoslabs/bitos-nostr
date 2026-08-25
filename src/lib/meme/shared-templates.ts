import { MAX_OVERLAYS, normalizeOverlay, type MemeTextOverlay } from '$lib/meme/schema';

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
export const TEMPLATE_SCHEMA_VERSION = 1;

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
	creatorPubkey: string;
	createdAt: number;
}

interface TemplateContent {
	label: string;
	icon: string;
	overlays: unknown[];
}

/** Build the d-tag + content + tags for publishing a saved template. */
export function sharedTemplateEventParts(input: {
	templateId: string;
	label: string;
	icon: string;
	overlays: MemeTextOverlay[];
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
		overlays
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
