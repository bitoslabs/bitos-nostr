import type { SharedTemplate } from '$lib/meme/shared-templates';

/**
 * Template Marketplace (tp-2 p.733) — creator economy on top of the
 * kind:30078 shared-template layer.
 *
 * A creator publishing a template can attach a zap price: the buyer zaps
 * the creator (NIP-57, p-tag = creator), and the unlock ledger remembers
 * the purchase locally. Everything stays in the existing template event —
 * `price` and `category` ride as content fields (v3 shape, optional and
 * backward-compatible: old v1/v2 events simply parse as free templates).
 *
 *   content = {...v2 fields,
 *              "category": "meme"|"thai"|"lao"|...,
 *              "price_sats": 21|100|500}   // absent = Free
 *
 * Unlock flow: marketplace card → price > 0 → NoteZapDialog against the
 * creator (event = the template event) → onPaid records the unlock → the
 * layout imports via the existing sharedTemplatesStore.import path.
 */

/** Marketplace categories (spec: 🔥 Trending 😂 Meme 🇱🇦 Lao 🇹🇭 Thai 🇹🇭 …). */
export const TEMPLATE_CATEGORIES = [
	{ id: 'trending', label: 'Trending', icon: 'i-lucide-flame' },
	{ id: 'meme', label: 'Meme', icon: 'i-lucide-laugh' },
	{ id: 'lao', label: 'Lao', icon: 'i-lucide-flag' },
	{ id: 'thai', label: 'Thai', icon: 'i-lucide-flag' },
	{ id: 'developer', label: 'Developer', icon: 'i-lucide-code' },
	{ id: 'bitcoin', label: 'Bitcoin', icon: 'i-lucide-bitcoin' },
	{ id: 'gaming', label: 'Gaming', icon: 'i-lucide-gamepad-2' },
	{ id: 'reaction', label: 'Reaction', icon: 'i-lucide-smile-plus' },
	{ id: 'cinematic', label: 'Cinematic', icon: 'i-lucide-clapperboard' },
	{ id: 'new', label: 'New', icon: 'i-lucide-sparkles' }
] as const;

export type TemplateCategoryId = (typeof TEMPLATE_CATEGORIES)[number]['id'];

export function isTemplateCategory(id: string): id is TemplateCategoryId {
	return TEMPLATE_CATEGORIES.some((c) => c.id === id);
}

export function categoryFor(id: string | undefined): (typeof TEMPLATE_CATEGORIES)[number] {
	return TEMPLATE_CATEGORIES.find((c) => c.id === id) ?? TEMPLATE_CATEGORIES[1];
}

/** Allowed price points (spec: Free / ⚡21 / ⚡100 / ⚡500 sats). */
export const TEMPLATE_PRICE_TIERS = [0, 21, 100, 500] as const;
export type TemplatePriceTier = (typeof TEMPLATE_PRICE_TIERS)[number];

const MAX_PRICE_SATS = 1_000_000;

/** Sanitize a remote price — junk/negative/huge values mean Free. */
export function normalizePriceSats(raw: unknown): TemplatePriceTier | number {
	const n = Number(raw);
	if (!Number.isFinite(n) || n <= 0) return 0;
	const int = Math.floor(n);
	if (int > MAX_PRICE_SATS) return 0;
	return TEMPLATE_PRICE_TIERS.includes(int as TemplatePriceTier) ? (int as TemplatePriceTier) : int;
}

/** Marketplace face of a shared template. */
export interface MarketTemplate {
	template: SharedTemplate;
	category: TemplateCategoryId;
	priceSats: number;
	/** True when the local user already unlocked (zap recorded) this template. */
	unlocked: boolean;
	/** True for the user's own published templates — always unlocked. */
	own: boolean;
	/** Sort boost — trending margin computed by the caller (zap recency/uses). */
	score: number;
}

/** Pure filter + rank for one category view (spec category grid). */
export function forCategory(
	templates: SharedTemplate[],
	selfPubkey: string,
	isUnlocked: (eventId: string) => boolean,
	category: TemplateCategoryId,
	extra: Partial<Record<string, number>> = {}
): MarketTemplate[] {
	const rows = templates.map((t) => {
		const own = t.creatorPubkey === selfPubkey;
		return {
			template: t,
			category: t.category ?? 'meme',
			priceSats: t.priceSats ?? 0,
			unlocked: own || isUnlocked(t.eventId),
			own,
			score: extra[t.eventId] ?? 0
		} satisfies MarketTemplate;
	});
	const filtered =
		category === 'trending' || category === 'new'
			? rows
			: rows.filter((r) => r.category === category);
	if (category === 'trending')
		return filtered
			.sort((a, b) => b.score - a.score || b.template.createdAt - a.template.createdAt)
			.slice(0, 12);
	// “New” and category grids: newest first, own templates sink.
	return filtered.sort((a, b) => {
		if (a.own !== b.own) return a.own ? 1 : -1;
		return b.template.createdAt - a.template.createdAt;
	});
}

/** Marketplace pricing carried on the raw wire content before parsing. */
export type MarketPriced = { price_sats?: unknown; category?: unknown };
function sanitizeCategory(raw: unknown): TemplateCategoryId {
	return typeof raw === 'string' && isTemplateCategory(raw) ? raw : 'meme';
}

/** Extract marketplace tags from a template event's content JSON (pure). */
export function marketplaceFromContent(content: { price_sats?: unknown; category?: unknown }): {
	priceSats: number;
	category: TemplateCategoryId;
} {
	return {
		priceSats: normalizePriceSats(content.price_sats),
		category: sanitizeCategory(content.category)
	};
}
