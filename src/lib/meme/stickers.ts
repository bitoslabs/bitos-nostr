/**
 * Emoji sticker packs (user concept #3). A sticker is deliberately NOT a new
 * schema object: it rides `MemeTextOverlay` with a single-grapheme text, no
 * stroke, bigger size — so drafts, templates and the remix wire payload
 * (`meme` tag) carry stickers unchanged. Zero migration, zero custom kinds.
 */
import { makeOverlay, type MemeTextOverlay } from './schema';
import type { MemeFx } from './fx';

export interface StickerPack {
	id: string;
	label: string;
	/** Single-grapheme emoji (no ZWJ complexity rules — plain emoji only). */
	stickers: string[];
}

/** Curated packs — punchy meme vocabulary, no licensing (system emoji). */
export const STICKER_PACKS: StickerPack[] = [
	{
		id: 'crypto',
		label: 'Crypto',
		stickers: ['₿', '🚀', '🌕', '⚡', '🟠', '📈', '💎', '🙌']
	},
	{
		id: 'reactions',
		label: 'Reactions',
		stickers: ['😂', '💀', '😈', '🤡', '👀', '🔥', '💯', '🫡']
	},
	{
		id: 'moods',
		label: 'Moods',
		stickers: ['😭', '🥲', '😤', '🤯', '😴', '🤔', '😳', '🥶']
	},
	{
		id: 'money',
		label: 'Money',
		stickers: ['💰', '🤑', '💸', '🪙', '📈', '📉', '🏦', '⚡']
	},
	{
		id: 'chaos',
		label: 'Chaos',
		stickers: ['💥', '🌪️', '🚨', '☠️', '🎮', '🏆', '🧠', '🍄']
	},
	{
		id: 'love',
		label: 'Love',
		stickers: ['❤️', '🧡', '💜', '🖤', '💌', '🫶', '😭', '✨']
	}
];

/** Distinct emoji across all packs (recents seed-order, deduped). */
export const ALL_STICKERS: string[] = [...new Set(STICKER_PACKS.flatMap((p) => p.stickers))];

export const MAX_RECENT_STICKERS = 16;

/** Default motion cycled onto fresh stickers so they land feeling alive —
 * creators can always switch it off (fx is per-overlay, optional wire data). */
export const STICKER_FX_CYCLE: readonly MemeFx[] = ['pop', 'spin'];

/** True when an overlay is a sticker (single grapheme, stroke-free). */
export function isStickerOverlay(overlay: MemeTextOverlay): boolean {
	return !overlay.stroke && overlay.caps === false && isEmojiOnly(overlay.text);
}

/** Emoji-only text: at least one emoji and no other visible characters. */
export function isEmojiOnly(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed) return false;
	let sawEmoji = false;
	// Spread into codepoints (surrogate-safe). Every grapheme must be an
	// emoji-presentation codepoint — variation selectors (U+FE0F) and ZWJ
	// joins are structural and allowed, everything else disqualifies.
	const graphemes = [...trimmed];
	for (const g of graphemes) {
		if (g === '\u200d' || g === '\ufe0f') continue;
		// Bitcoin's official sign is a currency symbol rather than Unicode emoji,
		// but it is a first-class meme sticker alongside regular emoji.
		if (g === '₿') {
			sawEmoji = true;
			continue;
		}
		if (!/\p{Extended_Pictographic}|\p{Emoji_Presentation}/u.test(g)) return false;
		sawEmoji = true;
	}
	return sawEmoji;
}

/** Build a stage-ready sticker overlay at a jittered spot (avoid stacking).
 *  A default pop/spin fx rides along so stickers feel alive without setup —
 *  override with `fx` (e.g. 'none') when a still sticker is wanted. */
export function makeSticker(
	emoji: string,
	options: { index?: number; fx?: MemeFx } = {}
): MemeTextOverlay {
	const i = options.index ?? 0;
	// Rotate through pleasant anchor spots so consecutive stickers don't stack.
	const anchors = [
		{ x: 0.5, y: 0.32 },
		{ x: 0.3, y: 0.55 },
		{ x: 0.7, y: 0.55 },
		{ x: 0.5, y: 0.74 },
		{ x: 0.28, y: 0.36 },
		{ x: 0.72, y: 0.36 }
	];
	const spot = anchors[i % anchors.length]!;
	const fx = options.fx ?? STICKER_FX_CYCLE[i % STICKER_FX_CYCLE.length];
	return makeOverlay({
		text: emoji,
		x: spot.x,
		y: spot.y,
		size: 0.18,
		stroke: false,
		caps: false,
		fx
	});
}

export function parseStickerPacks(raw: unknown): StickerPack[] {
	if (!Array.isArray(raw)) return [];
	const packs: StickerPack[] = [];
	for (const item of raw.slice(0, 12)) {
		if (!item || typeof item !== 'object') continue;
		const p = item as Record<string, unknown>;
		const id = typeof p.id === 'string' ? p.id.slice(0, 32) : '';
		const label = typeof p.label === 'string' ? p.label.slice(0, 40) : '';
		const stickers = Array.isArray(p.stickers)
			? p.stickers.filter((s): s is string => typeof s === 'string').slice(0, 24)
			: [];
		if (id && label && stickers.length) packs.push({ id, label, stickers });
	}
	return packs;
}
