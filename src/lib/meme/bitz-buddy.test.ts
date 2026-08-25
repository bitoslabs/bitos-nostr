import { describe, expect, it } from 'vitest';

import { BUDDY_FIGURES, buddyFigure, isBuddySrc } from './bitz-buddy';
import { layerSrcOk, normalizeImageOverlay, makeImageOverlay } from './image-overlay';

describe('bitz-buddy catalog', () => {
	it('ships the 10-figure V1 pack with unique ids and bundled srcs', () => {
		expect(BUDDY_FIGURES).toHaveLength(10);
		const ids = new Set(BUDDY_FIGURES.map((f) => f.id));
		expect(ids.size).toBe(10);
		for (const f of BUDDY_FIGURES) {
			expect(f.src).toBe(`/bitz-buddy/${f.id}.svg`);
			expect(f.label.length).toBeGreaterThan(0);
		}
	});

	it('covers the spec emotion pack', () => {
		for (const id of [
			'buddy',
			'shock',
			'laugh',
			'panic',
			'angry',
			'thinking',
			'dead-inside',
			'hodl-zen',
			'moon',
			'facepalm'
		]) {
			expect(buddyFigure(id)?.id).toBe(id);
		}
		expect(buddyFigure('nope')).toBeNull();
	});

	it('isBuddySrc accepts only bundled buddy paths', () => {
		expect(isBuddySrc('/bitz-buddy/buddy.svg')).toBe(true);
		expect(isBuddySrc('/bitz-buddy/dead-inside.svg')).toBe(true);
		expect(isBuddySrc(' /bitz-buddy/moon.svg ')).toBe(true);
		// Not a buddy path — must stay rejected so the gate stays strict.
		expect(isBuddySrc('/static/bitz-buddy/buddy.svg')).toBe(false);
		expect(isBuddySrc('/bitz-buddy/buddy.png')).toBe(false);
		expect(isBuddySrc('/bitz-buddy/../evil.svg')).toBe(false);
		expect(isBuddySrc('https://evil.example.com/bitz-buddy/buddy.svg')).toBe(false);
		expect(isBuddySrc('/other/icon.svg')).toBe(false);
	});

	it('buddy srcs ride the image-layer pipeline (gate + wire round-trip)', () => {
		const src = '/bitz-buddy/hodl-zen.svg';
		expect(layerSrcOk(src)).toBe(true);
		expect(layerSrcOk('https://cdn.example.com/s.png')).toBe(true);
		expect(layerSrcOk('http://insecure.example.com/s.png')).toBe(false);

		const layer = makeImageOverlay(src, 1, { index: 2 });
		expect(layer).not.toBeNull();
		expect(layer!.src).toBe(src);

		// Draft/wire restore keeps buddy layers intact (normalize accepts them).
		const restored = normalizeImageOverlay({ ...layer, startMs: 100, endMs: 1500 });
		expect(restored).not.toBeNull();
		expect(restored!.startMs).toBe(100);
		expect(restored!.src).toBe(src);
	});
});
