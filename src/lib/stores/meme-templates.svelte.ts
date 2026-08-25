import { browser } from '$app/environment';
import {
	MAX_OVERLAYS,
	MEME_SCHEMA,
	normalizeOverlay,
	type MemeTextOverlay
} from '$lib/meme/schema';

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
	return {
		id: typeof t.id === 'string' && t.id.trim() ? t.id.slice(0, 64) : newId(),
		label: label || 'My template',
		icon: typeof t.icon === 'string' && t.icon ? t.icon.slice(0, 64) : 'i-lucide-bookmark',
		createdAt:
			Number.isFinite(Number(t.createdAt)) && Number(t.createdAt) > 0
				? Number(t.createdAt)
				: Date.now(),
		overlays
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
	save(label: string, overlays: MemeTextOverlay[], icon = 'i-lucide-bookmark'): SavedMemeTemplate {
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
			createdAt: Date.now()
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
}

export const memeTemplates = new MemeTemplatesStore();
