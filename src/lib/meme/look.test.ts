import { describe, expect, it } from 'vitest';
import { MEME_LOOKS, canvasFiltersSupported, memeLookCss, memeLookOf } from './look';

describe('MEME_LOOKS', () => {
	it('has unique ids, labels, and non-empty css chains', () => {
		const ids = new Set(MEME_LOOKS.map((l) => l.id));
		expect(ids.size).toBe(MEME_LOOKS.length);
		for (const look of MEME_LOOKS) {
			expect(look.label.trim().length).toBeGreaterThan(0);
			expect(look.css.trim().length).toBeGreaterThan(0);
		}
	});

	it('starts with none (the default) and keeps every css chain url-free', () => {
		expect(MEME_LOOKS[0]?.id).toBe('none');
		expect(MEME_LOOKS[0]?.css).toBe('none');
		for (const look of MEME_LOOKS) {
			expect(look.css).not.toMatch(/url\(/i);
		}
	});
});

describe('memeLookOf', () => {
	it('accepts known ids and degrades everything else to none', () => {
		expect(memeLookOf('mono')).toBe('mono');
		expect(memeLookOf('deepfry')).toBe('deepfry');
		expect(memeLookOf('hacker')).toBe('none'); // unknown
		expect(memeLookOf('')).toBe('none');
		expect(memeLookOf(null)).toBe('none');
		expect(memeLookOf(42)).toBe('none');
		expect(memeLookOf({ id: 'mono' })).toBe('none');
	});
});

describe('memeLookCss', () => {
	it('resolves a id → css and falls back to none', () => {
		expect(memeLookCss('invert')).toBe('invert(1)');
		expect(memeLookCss('mono')).toBe('grayscale(1)');
		expect(memeLookCss('gone')).toBe('none');
	});
});

describe('canvasFiltersSupported', () => {
	it('runs in node without throwing (boolean result)', () => {
		expect(typeof canvasFiltersSupported()).toBe('boolean');
	});
});
