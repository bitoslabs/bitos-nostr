import { describe, expect, it } from 'vitest';
import {
	ALL_STICKERS,
	isEmojiOnly,
	isStickerOverlay,
	makeSticker,
	parseStickerPacks,
	STICKER_PACKS
} from './stickers';
import { makeOverlay, normalizeOverlay } from './schema';

describe('stickers', () => {
	it('ships curated packs with unique ids and non-empty emoji', () => {
		expect(STICKER_PACKS.length).toBeGreaterThanOrEqual(4);
		const ids = new Set(STICKER_PACKS.map((p) => p.id));
		expect(ids.size).toBe(STICKER_PACKS.length);
		for (const pack of STICKER_PACKS) {
			expect(pack.label).toBeTruthy();
			expect(pack.stickers.length).toBeGreaterThan(0);
			for (const s of pack.stickers) expect(isEmojiOnly(s)).toBe(true);
		}
	});

	it('dedupes stickers across packs for ALL_STICKERS', () => {
		expect(new Set(ALL_STICKERS).size).toBe(ALL_STICKERS.length);
		expect(ALL_STICKERS.length).toBeGreaterThan(20);
	});

	it('isEmojiOnly accepts emoji and rejects mixed/plain text', () => {
		expect(isEmojiOnly('😂')).toBe(true);
		expect(isEmojiOnly(' 💀 ')).toBe(true);
		expect(isEmojiOnly('🔥🔥🔥')).toBe(true);
		expect(isEmojiOnly('hi😂')).toBe(false);
		expect(isEmojiOnly('')).toBe(false);
		expect(isEmojiOnly('abc')).toBe(false);
	});

	it('makeSticker builds a stroke-free overlay at rotating anchors', () => {
		const a = makeSticker('😂', { index: 0 });
		const b = makeSticker('🔥', { index: 1 });
		expect(a.text).toBe('😂');
		expect(a.stroke).toBe(false);
		expect(a.caps).toBe(false);
		expect(a.size).toBeGreaterThan(0.1);
		expect(a.x).not.toBe(b.x); // rotated anchors
		// makeSticker output survives normalizeOverlay unchanged
		expect(normalizeOverlay(a)).toEqual(a);
	});

	it('isStickerOverlay detects stickers among text overlays', () => {
		const sticker = makeSticker('💀');
		const caption = makeOverlay({ text: 'WHEN THE CODE SHIPS' });
		expect(isStickerOverlay(sticker)).toBe(true);
		expect(isStickerOverlay(caption)).toBe(false);
		// a sticker with stroke re-enabled is just styled text
		expect(isStickerOverlay({ ...sticker, stroke: true })).toBe(false);
	});

	it('parseStickerPacks is tolerant (bad rows dropped, caps enforced)', () => {
		const packs = parseStickerPacks([
			{ id: 'ok', label: 'OK', stickers: ['🔥', 42, null] },
			{ id: '', label: 'No id', stickers: ['🔥'] },
			'label-only',
			{ id: 'x2', label: 'X'.repeat(80), stickers: ['😂'] }
		]);
		expect(packs).toHaveLength(2);
		expect(packs[1]!.label.length).toBeLessThanOrEqual(40);
	});
});
