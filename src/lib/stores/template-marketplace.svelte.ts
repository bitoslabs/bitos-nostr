import { browser } from '$app/environment';
import { toasts } from '$lib/stores/toasts.svelte';
import { identity } from '$lib/nostr/identity.svelte';
import {
	forCategory,
	type MarketTemplate,
	type TemplateCategoryId
} from '$lib/meme/template-marketplace';
import { sharedTemplatesStore } from '$lib/stores/meme-shared-templates.svelte';
import type { SharedTemplate } from '$lib/meme/shared-templates';

/**
 * Template Marketplace store (tp-2 p.733) — the marketplace face over the
 * shared-template catalog: category views (🔥 Trending / 😂 Meme / 🇹🇭 Thai /
 * 🇱🇦 Lao / ₿ Bitcoin …), zap-priced templates (Free · ⚡21 · ⚡100 · ⚡500),
 * and a local unlock ledger so a zap-purchased template stays usable on the
 * device. Pricing zaps re-use the NIP-57 flow (NoteZapDialog against the
 * creator's lud16 with e = the template event) — the ledger records the
 * purchase on success.
 */

const UNLOCK_KEY = 'bitos:template-unlocks';
const MAX_UNLOCKS = 500;

interface StoredUnlocks {
	schema: string;
	unlocked: Record<string, number>; // eventId -> paid sats
}

class TemplateMarketplaceStore {
	activeCategory = $state<TemplateCategoryId>('trending');
	open = $state(false);
	zapTarget = $state<SharedTemplate | null>(null);
	unlockedIds = $state<Record<string, number>>({});
	#loaded = false;

	constructor() {
		this.#load();
	}

	#load() {
		if (!browser || this.#loaded) return;
		this.#loaded = true;
		try {
			const raw = localStorage.getItem(UNLOCK_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw) as Partial<StoredUnlocks>;
			if (parsed.schema !== 'bitos.template-unlocks') return;
			const clean: Record<string, number> = {};
			for (const [id, sats] of Object.entries(parsed.unlocked ?? {})) {
				if (typeof id === 'string' && id && Number.isFinite(Number(sats))) clean[id] = Number(sats);
			}
			this.unlockedIds = clean;
		} catch {
			/* ignore malformed storage */
		}
	}

	#persist() {
		if (!browser) return;
		try {
			const entries = Object.entries(this.unlockedIds)
				.sort((a, b) => b[1] - a[1])
				.slice(0, MAX_UNLOCKS);
			localStorage.setItem(
				UNLOCK_KEY,
				JSON.stringify({ schema: 'bitos.template-unlocks', unlocked: Object.fromEntries(entries) })
			);
		} catch {
			/* storage full / private mode — unlocks stay in-memory */
		}
	}

	isUnlocked = (eventId: string) => eventId in this.unlockedIds;

	/** Record a completed pricing zap — unlocks the template on this device. */
	recordUnlock(eventId: string, sats: number) {
		if (!eventId) return;
		this.unlockedIds = { ...this.unlockedIds, [eventId]: sats };
		this.#persist();
	}

	/** One marketplace row list for the active category. */
	rows = $derived<MarketTemplate[]>(
		forCategory(
			sharedTemplatesStore.list,
			identity.current?.pk ?? '',
			(eid) => eid in this.unlockedIds,
			this.activeCategory
		)
	);

	setCategory(id: TemplateCategoryId) {
		this.activeCategory = id;
	}

	openMarket() {
		this.open = true;
		void sharedTemplatesStore.load();
	}

	/** Begin the zap flow for a priced template (caller shows NoteZapDialog). */
	startZap(template: SharedTemplate) {
		this.zapTarget = template;
	}

	clearZap() {
		this.zapTarget = null;
	}

	/** Zap completed → unlock + import into the local library. */
	async completeZap() {
		const target = this.zapTarget;
		if (!target) return;
		this.recordUnlock(target.eventId, target.priceSats ?? 0);
		this.zapTarget = null;
		await this.importUnlocked(target);
	}

	async importUnlocked(template: SharedTemplate): Promise<void> {
		await sharedTemplatesStore.import(template);
	}
}

export const templateMarketplace = new TemplateMarketplaceStore();
