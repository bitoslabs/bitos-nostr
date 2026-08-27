import { browser } from '$app/environment';
import {
	MAX_OVERLAYS,
	MAX_SFX_CUES,
	MEME_SCHEMA,
	normalizeOverlay,
	normalizeSfxCues,
	type MemeSfxCue,
	type MemeTextOverlay
} from '$lib/meme/schema';
import {
	MAX_IMAGE_OVERLAYS,
	normalizeImageOverlay,
	type MemeImageOverlay
} from '$lib/meme/image-overlay';
import { MAX_FX_WINDOWS, normalizeFxWindows, type FrameFxWindow } from '$lib/meme/fx-track';
import { MAX_ZOOM_WINDOWS, normalizeZoomWindows } from '$lib/meme/zoom-track';
import type { ZoomWindow } from '$lib/ai/suggest';
import { normalizeSpeedWindows, type SpeedWindow } from '$lib/meme/speed-track';

/**
 * Meme templates the user saved from Meme Studio — the Phase-6 "template"
 * creator economy (plan §17) starts local: a saved layout is a portable,
 * versioned overlay list that re-applies onto any media.
 *
 * Storage shape (localStorage, key `bitos:meme-templates`):
 *   { schema, version, list: [{ id, label, icon, createdAt, overlays }] }
 *
 * NIP-78 publish/consume (CRE-004) lands in Phase 6 — the same overlay list
 * serializes into the namespaced app-data event unchanged, so nothing here
 * will need migrating.
 */

export const MEME_TEMPLATES_KEY = 'bitos:meme-templates';
export const MEME_TEMPLATES_VERSION = 1;
/** Keep the saved-list UI snappy; localStorage stays small. */
export const MAX_SAVED_TEMPLATES = 24;

export interface SavedMemeTemplate {
	id: string;
	label: string;
	icon: string;
	createdAt: number;
	overlays: MemeTextOverlay[];
	/** Timed extras (schema v2): sound cues, zoom punches, frame-fx
	 *  windows, speed ramps and sticker layers captured with the layout.
	 *  All optional — v1 rows import untouched. */
	sfxCues?: MemeSfxCue[];
	zoomWindows?: ZoomWindow[];
	fxWindows?: FrameFxWindow[];
	speedWindows?: SpeedWindow[];
	imageLayers?: MemeImageOverlay[];
}

interface StoredTemplates {
	schema: string;
	version: number;
	list: SavedMemeTemplate[];
}

function newId(): string {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
	return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Tolerant parse of one stored template — bad rows are dropped, not fatal. */
function parseTemplate(raw: unknown): SavedMemeTemplate | null {
	if (!raw || typeof raw !== 'object') return null;
	const t = raw as Record<string, unknown>;
	const overlays = (Array.isArray(t.overlays) ? t.overlays : [])
		.map(normalizeOverlay)
		.filter((o): o is MemeTextOverlay => !!o)
		.slice(0, MAX_OVERLAYS);
	if (!overlays.length) return null;
	const label = typeof t.label === 'string' && t.label.trim() ? t.label.trim().slice(0, 40) : '';
	// v2 timed extras — each track re-normalizes; empty tracks stay absent.
	const sfxCues = normalizeSfxCues(t.sfxCues).slice(0, MAX_SFX_CUES);
	const zoomWindows = normalizeZoomWindows(t.zoomWindows).slice(0, MAX_ZOOM_WINDOWS);
	const fxWindows = normalizeFxWindows(t.fxWindows).slice(0, MAX_FX_WINDOWS);
	const speedWindows = normalizeSpeedWindows(t.speedWindows).slice(0, MAX_FX_WINDOWS);
	const imageLayers = (Array.isArray(t.imageLayers) ? t.imageLayers : [])
		.map((l) => normalizeImageOverlay(l as Record<string, unknown>))
		.filter((l): l is MemeImageOverlay => l !== null)
		.slice(0, MAX_IMAGE_OVERLAYS);
	return {
		id: typeof t.id === 'string' && t.id.trim() ? t.id.slice(0, 64) : newId(),
		label: label || 'My template',
		icon: typeof t.icon === 'string' && t.icon ? t.icon.slice(0, 64) : 'i-lucide-bookmark',
		createdAt:
			Number.isFinite(Number(t.createdAt)) && Number(t.createdAt) > 0
				? Number(t.createdAt)
				: Date.now(),
		overlays,
		...(sfxCues.length ? { sfxCues } : {}),
		...(zoomWindows.length ? { zoomWindows } : {}),
		...(fxWindows.length ? { fxWindows } : {}),
		...(speedWindows.length ? { speedWindows } : {}),
		...(imageLayers.length ? { imageLayers } : {})
	};
}

class MemeTemplatesStore {
	list = $state<SavedMemeTemplate[]>([]);

	constructor() {
		this.load();
	}

	load = () => {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(MEME_TEMPLATES_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw) as Partial<StoredTemplates>;
			if (parsed.schema !== MEME_SCHEMA) return;
			const version = Number(parsed.version);
			if (!Number.isFinite(version) || version < 1 || version > MEME_TEMPLATES_VERSION) return;
			this.list = (Array.isArray(parsed.list) ? parsed.list : [])
				.map(parseTemplate)
				.filter((t): t is SavedMemeTemplate => !!t)
				.slice(0, MAX_SAVED_TEMPLATES);
		} catch {
			/* ignore malformed storage */
		}
	};

	private persist = () => {
		if (!browser) return;
		try {
			const stored: StoredTemplates = {
				schema: MEME_SCHEMA,
				version: MEME_TEMPLATES_VERSION,
				list: this.list
			};
			localStorage.setItem(MEME_TEMPLATES_KEY, JSON.stringify(stored));
		} catch {
			/* storage full / private mode — templates stay in-memory */
		}
	};

	/** Save the current overlay layout under a label. Returns the saved template. */
	save(
		label: string,
		overlays: MemeTextOverlay[],
		icon = 'i-lucide-bookmark',
		extras?: {
			sfxCues?: MemeSfxCue[];
			zoomWindows?: ZoomWindow[];
			fxWindows?: FrameFxWindow[];
			speedWindows?: SpeedWindow[];
			imageLayers?: MemeImageOverlay[];
		}
	): SavedMemeTemplate {
		const clean = overlays
			.map((o) => normalizeOverlay(o))
			.filter((o): o is MemeTextOverlay => !!o)
			.slice(0, MAX_OVERLAYS);
		if (!clean.length) throw new Error('Add at least one caption before saving a template');
		const trimmed = label.trim().slice(0, 40);
		const template: SavedMemeTemplate = {
			id: newId(),
			label: trimmed || `Template ${this.list.length + 1}`,
			icon,
			overlays: clean,
			createdAt: Date.now(),
			...(extras?.sfxCues?.length ? { sfxCues: extras.sfxCues } : {}),
			...(extras?.zoomWindows?.length ? { zoomWindows: extras.zoomWindows } : {}),
			...(extras?.fxWindows?.length ? { fxWindows: extras.fxWindows } : {}),
			...(extras?.speedWindows?.length ? { speedWindows: extras.speedWindows } : {}),
			...(extras?.imageLayers?.length ? { imageLayers: extras.imageLayers } : {})
		};
		// Freshest first; cap the list so storage stays lean.
		this.list = [template, ...this.list].slice(0, MAX_SAVED_TEMPLATES);
		this.persist();
		return template;
	}

	remove(id: string) {
		this.list = this.list.filter((t) => t.id !== id);
		this.persist();
	}

	rename(id: string, label: string) {
		const trimmed = label.trim().slice(0, 40);
		if (!trimmed) return;
		this.list = this.list.map((t) => (t.id === id ? { ...t, label: trimmed } : t));
		this.persist();
	}

	/** Build a fresh, editable copy for the stage (ids regenerate on apply). */
	apply(template: SavedMemeTemplate): MemeTextOverlay[] {
		return template.overlays.map((o) => ({ ...o, id: newId() }));
	}

	/** Fresh copies of the timed extras (v2) — ids regenerate on apply. */
	applyExtras(template: SavedMemeTemplate): {
		sfxCues?: MemeSfxCue[];
		zoomWindows?: ZoomWindow[];
		fxWindows?: FrameFxWindow[];
		speedWindows?: SpeedWindow[];
		imageLayers?: MemeImageOverlay[];
	} {
		const extras: {
			sfxCues?: MemeSfxCue[];
			zoomWindows?: ZoomWindow[];
			fxWindows?: FrameFxWindow[];
			speedWindows?: SpeedWindow[];
			imageLayers?: MemeImageOverlay[];
		} = {};
		if (template.sfxCues?.length)
			extras.sfxCues = normalizeSfxCues(template.sfxCues.map((c) => ({ ...c, id: undefined })));
		if (template.zoomWindows?.length)
			extras.zoomWindows = normalizeZoomWindows(template.zoomWindows);
		if (template.fxWindows?.length) extras.fxWindows = normalizeFxWindows(template.fxWindows);
		if (template.speedWindows?.length)
			extras.speedWindows = normalizeSpeedWindows(template.speedWindows);
		if (template.imageLayers?.length)
			extras.imageLayers = template.imageLayers.map((l) => ({
				...l,
				id: `img-${newId()}`
			}));
		return extras;
	}
}

export const memeTemplates = new MemeTemplatesStore();
