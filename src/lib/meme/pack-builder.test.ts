import { describe, expect, it } from 'vitest';
import {
	MAX_PACK_EMOJIS,
	normalizeShortcode,
	packEventParts,
	packToJson,
	parsePackJson,
	sanitizePackEntries,
	slugifyPackD
} from './pack-builder';

const U = (n: number) => `https://cdn.example.com/e${n}.png`;

describe('normalizeShortcode', () => {
	it('lowercases, trims colons and squeezes separators', () => {
		expect(normalizeShortcode(':Woke Roll:')).toBe('woke_roll');
		expect(normalizeShortcode('  Doge--Coin  ')).toBe('doge_coin');
		expect(normalizeShortcode('₿TCP!!')).toBe('tcp');
	});

	it('caps length at 64 without trailing separators', () => {
		const out = normalizeShortcode('a'.repeat(80));
		expect(out).toHaveLength(64);
		expect(out.endsWith('_')).toBe(false);
	});

	it('returns empty for junk-only input', () => {
		expect(normalizeShortcode('!!!')).toBe('');
		expect(normalizeShortcode('   ')).toBe('');
	});
});

describe('sanitizePackEntries', () => {
	it('drops nameless, non-https and duplicate entries (first wins)', () => {
		const out = sanitizePackEntries([
			{ name: 'Doge', url: U(1) },
			{ name: ':doge:', url: U(2) }, // duplicate after normalize — dropped
			{ name: '', url: U(3) },
			{ name: 'insecure', url: 'http://x.example.com/a.png' },
			{ name: 'ok', url: U(4) }
		]);
		expect(out).toEqual([
			{ name: 'doge', url: U(1) },
			{ name: 'ok', url: U(4) }
		]);
	});

	it('caps the pack at MAX_PACK_EMOJIS entries', () => {
		const many = Array.from({ length: MAX_PACK_EMOJIS + 20 }, (_, i) => ({
			name: `e${i}`,
			url: U(i)
		}));
		expect(sanitizePackEntries(many)).toHaveLength(MAX_PACK_EMOJIS);
	});
});

describe('slugifyPackD', () => {
	it('slugs the title into an addressable d tag', () => {
		expect(slugifyPackD('My Bitz Pack!')).toBe('my-bitz-pack');
	});

	it('falls back to a stable slug for empty titles', () => {
		expect(slugifyPackD('??')).toBe('pack');
	});
});

describe('packEventParts', () => {
	it('builds kind-30030 tags: client, d, title, cover fallback, emojis', () => {
		const parts = packEventParts({
			title: 'Bitz Pack',
			emojis: [
				{ name: 'zap', url: U(1) },
				{ name: 'zap', url: U(2) } // deduped
			],
			clientTag: [['client', 'bitos.test']]
		});
		expect(parts.d).toBe('bitz-pack');
		expect(parts.title).toBe('Bitz Pack');
		expect(parts.tags).toEqual([
			['client', 'bitos.test'],
			['d', 'bitz-pack'],
			['title', 'Bitz Pack'],
			['image', U(1)], // first emoji is the cover fallback
			['emoji', 'zap', U(1)]
		]);
	});

	it('prefers an explicit https cover over the fallback', () => {
		const parts = packEventParts({
			title: 'P',
			emojis: [{ name: 'a', url: U(1) }],
			cover: U(9)
		});
		expect(parts.tags.find((t) => t[0] === 'image')).toEqual(['image', U(9)]);
	});

	it('drops a non-https cover back to the first emoji', () => {
		const parts = packEventParts({
			title: 'P',
			emojis: [{ name: 'a', url: U(1) }],
			cover: 'http://insecure.example.com/c.png'
		});
		expect(parts.tags.find((t) => t[0] === 'image')).toEqual(['image', U(1)]);
	});
});

describe('pack JSON round-trip', () => {
	it('exports a portable schema and parses it back', () => {
		const json = packToJson({
			title: 'Bitz Pack',
			emojis: [
				{ name: 'zap', url: U(1) },
				{ name: 'nope', url: 'ftp://bad' } // dropped
			]
		});
		const parsed = parsePackJson(JSON.parse(json));
		expect(parsed).not.toBeNull();
		expect(parsed!.title).toBe('Bitz Pack');
		expect(parsed!.emojis).toEqual([{ name: 'zap', url: U(1) }]);
		expect(parsed!.cover).toBe(U(1));
		// The exported file is stable/readable (2-space indent, key order).
		expect(json).toContain('"schema": "com.bitos.emoji-pack"');
	});

	it('imports tolerate {name,url} objects too', () => {
		const parsed = parsePackJson({
			schema: 'com.bitos.emoji-pack',
			version: 1,
			title: 'X',
			emojis: [{ name: 'a', url: U(1) }, ['b', U(2)]]
		});
		expect(parsed!.emojis).toEqual([
			{ name: 'a', url: U(1) },
			{ name: 'b', url: U(2) }
		]);
	});

	it('rejects wrong-schema or emoji-less imports', () => {
		expect(parsePackJson({ schema: 'other', emojis: [['a', U(1)]] })).toBeNull();
		expect(
			parsePackJson({ schema: 'com.bitos.emoji-pack', emojis: [['a', 'http://x']] })
		).toBeNull();
		expect(parsePackJson(null)).toBeNull();
	});
});
