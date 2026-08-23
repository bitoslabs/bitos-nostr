import { describe, expect, it } from 'vitest';

import {
	decodeImageOverlay,
	encodeImageOverlay,
	imageOverlayVisibleAt,
	isHttpUrl,
	makeImageOverlay,
	normalizeImageOverlay,
	MAX_IMAGE_OVERLAYS
} from './image-overlay';

describe('image-overlay', () => {
	it('accepts only http(s) image sources', () => {
		expect(isHttpUrl('https://cdn.example.com/sticker.png')).toBe(true);
		expect(isHttpUrl('http://cdn.example.com/sticker.png')).toBe(false);
		expect(isHttpUrl('data:image/png;base64,AAAA')).toBe(false);
		expect(isHttpUrl('javascript:alert(1)')).toBe(false);
		expect(isHttpUrl('')).toBe(false);
	});

	it('normalizeImageOverlay coerces, clamps and drops junk', () => {
		const layer = normalizeImageOverlay({
			src: ' https://cdn.example.com/s.png ',
			aspect: 99,
			x: 2,
			y: -1,
			size: 5,
			startMs: 100,
			endMs: 50
		});
		expect(layer).not.toBeNull();
		expect(layer!.src).toBe('https://cdn.example.com/s.png');
		expect(layer!.aspect).toBe(20);
		expect(layer!.x).toBe(1);
		expect(layer!.y).toBe(0);
		expect(layer!.size).toBeLessThanOrEqual(0.9);
		// Nonsensical window means "always visible".
		expect(layer!.startMs).toBeUndefined();
		expect(layer!.endMs).toBeUndefined();
	});

	it('normalizeImageOverlay rejects non-http and junk input', () => {
		expect(normalizeImageOverlay(null)).toBeNull();
		expect(normalizeImageOverlay('hi')).toBeNull();
		expect(normalizeImageOverlay({ src: 'data:image/png;base64,AAAA' })).toBeNull();
		expect(normalizeImageOverlay({ src: 42 })).toBeNull();
	});

	it('makeImageOverlay rotates anchors and never stacks', () => {
		const a = makeImageOverlay('https://cdn.example.com/a.png', 1, { index: 0 });
		const b = makeImageOverlay('https://cdn.example.com/b.png', 1, { index: 1 });
		expect(a).not.toBeNull();
		expect(b).not.toBeNull();
		expect(a!.x).not.toBe(b!.x);
		expect(makeImageOverlay('not-a-url', 1)).toBeNull();
	});

	it('wide layers default bigger than tall ones', () => {
		const wide = makeImageOverlay('https://cdn.example.com/w.png', 2, { index: 0 });
		const tall = makeImageOverlay('https://cdn.example.com/t.png', 0.5, { index: 0 });
		expect(wide!.size).toBeGreaterThan(tall!.size);
	});

	it('timing windows gate visibility like text overlays', () => {
		const base = {
			src: 'https://cdn.example.com/s.png',
			aspect: 1,
			x: 0.5,
			y: 0.5,
			size: 0.3
		};
		const always = normalizeImageOverlay(base)!;
		expect(imageOverlayVisibleAt(always, 0)).toBe(true);
		expect(imageOverlayVisibleAt(always, 60_000)).toBe(true);
		const timed = normalizeImageOverlay({ ...base, startMs: 1000, endMs: 2000 })!;
		expect(imageOverlayVisibleAt(timed, 500)).toBe(false);
		expect(imageOverlayVisibleAt(timed, 1500)).toBe(true);
		expect(imageOverlayVisibleAt(timed, 2500)).toBe(false);
	});

	it('wire round-trip keeps position, size and window (not ids)', () => {
		const layer = normalizeImageOverlay({
			src: 'https://cdn.example.com/s.png',
			aspect: 1.5,
			x: 0.25,
			y: 0.75,
			size: 0.4,
			startMs: 0,
			endMs: 3000
		})!;
		const wire = encodeImageOverlay(layer);
		const back = decodeImageOverlay(wire);
		expect(back).not.toBeNull();
		expect(back!.src).toBe(layer.src);
		expect(back!.aspect).toBe(layer.aspect);
		expect(back!.x).toBe(layer.x);
		expect(back!.y).toBe(layer.y);
		expect(back!.size).toBe(layer.size);
		expect(back!.startMs).toBe(0);
		expect(back!.endMs).toBe(3000);
	});

	it('effect fields round-trip the wire and default when absent', () => {
		const styled = normalizeImageOverlay({
			src: 'https://cdn.example.com/s.gif',
			x: 0.5,
			y: 0.5,
			size: 0.3,
			opacity: 0.55,
			rotate: 90,
			flipH: true,
			flipV: false,
			lookId: 'sepia'
		})!;
		expect(styled.opacity).toBe(0.55);
		expect(styled.rotate).toBe(90);
		expect(styled.flipH).toBe(true);
		expect(styled.flipV).toBeUndefined();
		expect(styled.lookId).toBe('sepia');
		const wire = encodeImageOverlay(styled);
		expect(wire.o).toBeCloseTo(0.55);
		expect(wire.r).toBe(90);
		expect(wire.fh).toBe(1);
		expect(wire.fv).toBeUndefined();
		expect(wire.k).toBe('sepia');
		const back = decodeImageOverlay(wire)!;
		expect(back.opacity).toBeCloseTo(0.55);
		expect(back.rotate).toBe(90);
		expect(back.flipH).toBe(true);
		expect(back.flipV).toBeUndefined();
		expect(back.lookId).toBe('sepia');

		// Defaults stay wire-silent: an untouched layer encodes no effect keys.
		const plain = normalizeImageOverlay({ src: 'https://cdn.example.com/p.png' })!;
		const plainWire = encodeImageOverlay(plain);
		expect(plainWire.o).toBeUndefined();
		expect(plainWire.r).toBeUndefined();
		expect(plainWire.fh).toBeUndefined();
		expect(plainWire.k).toBeUndefined();
		expect(plain.opacity).toBeUndefined();
		expect(plain.rotate).toBeUndefined();

		// Junk is clamped/dropped, never thrown.
		const junk = normalizeImageOverlay({
			src: 'https://cdn.example.com/j.png',
			opacity: 9,
			rotate: 9999,
			lookId: 'not-a-look'
		})!;
		expect(junk.opacity).toBe(1);
		expect(junk.rotate).toBe(180);
		expect(junk.lookId).toBeUndefined();
	});

	it('decodeImageOverlay drops junk entries instead of throwing', () => {
		expect(decodeImageOverlay(null)).toBeNull();
		expect(decodeImageOverlay({})).toBeNull();
		expect(decodeImageOverlay({ u: 'data:...' })).toBeNull();
		expect(
			decodeImageOverlay({ u: 'https://ok.example.com/x.png', x: 9, y: 9, s: 9 })
		).not.toBeNull();
	});

	it('caps layers at the collage limit', () => {
		expect(MAX_IMAGE_OVERLAYS).toBeLessThanOrEqual(6);
		expect(MAX_IMAGE_OVERLAYS).toBeGreaterThan(0);
	});
});
