import { describe, expect, it } from 'vitest';

import {
	croppedLayerGeometry,
	decodeImageOverlay,
	encodeImageOverlay,
	imageOverlayVisibleAt,
	isHttpUrl,
	makeImageOverlay,
	normalizeCrop,
	normalizeImageOverlay,
	wholeImageAspect,
	MAX_IMAGE_OVERLAYS,
	MIN_CROP
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

	it('normalizeCrop clamps into the unit box and floors tiny edges', () => {
		// Junk → undefined (whole image).
		expect(normalizeCrop(undefined)).toBeUndefined();
		expect(normalizeCrop('nope')).toBeUndefined();
		// Missing fields default to the whole image.
		expect(normalizeCrop({})).toEqual({ x: 0, y: 0, w: 1, h: 1 });
		// Edges floor at MIN_CROP so crops stay pickable.
		const tiny = normalizeCrop({ x: 0.5, y: 0.5, w: 0.001, h: 0.001 })!;
		expect(tiny.w).toBeCloseTo(MIN_CROP);
		expect(tiny.h).toBeCloseTo(MIN_CROP);
		// Over-sized edges clamp, and origin pulls back inside the box.
		const over = normalizeCrop({ x: 0.8, y: 0.8, w: 2, h: 2 })!;
		expect(over).toEqual({ x: 0, y: 0, w: 1, h: 1 });
		const shifted = normalizeCrop({ x: 0.9, y: 0.9, w: 0.5, h: 0.2 })!;
		expect(shifted.x).toBeCloseTo(0.5);
		expect(shifted.y).toBeCloseTo(0.8);
		expect(shifted.x + shifted.w).toBeLessThanOrEqual(1 + 1e-9);
		expect(shifted.y + shifted.h).toBeLessThanOrEqual(1 + 1e-9);
	});

	it('crop round-trips the wire and stays silent when absent', () => {
		const cropped = normalizeImageOverlay({
			src: 'https://cdn.example.com/s.png',
			crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.4 }
		})!;
		expect(cropped.crop).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 });
		const wire = encodeImageOverlay(cropped);
		expect(wire.c).toEqual([0.1, 0.2, 0.5, 0.4]);
		const back = decodeImageOverlay(wire)!;
		expect(back.crop).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 });

		// Untouched layers carry no crop on the wire.
		const plain = normalizeImageOverlay({ src: 'https://cdn.example.com/p.png' })!;
		expect(encodeImageOverlay(plain).c).toBeUndefined();
		expect(plain.crop).toBeUndefined();

		// Partial crops default sensibly, never throw.
		const partial = normalizeImageOverlay({
			src: 'https://cdn.example.com/j.png',
			crop: { x: -5, w: 99 }
		})!;
		expect(partial.crop).toEqual({ x: 0, y: 0, w: 1, h: 1 });
	});

	it('croppedLayerGeometry keeps the crop window at its dialog scale', () => {
		// 2:1 image, box 0.4 tall × 0.8 wide.
		const layer = { size: 0.4, aspect: 2 };
		// Crop the LEFT HALF: the selected 50% × 100% source window must be
		// exactly half the stage width, rather than being zoomed back up.
		const left = croppedLayerGeometry(layer, { x: 0, y: 0, w: 0.5, h: 1 }, 2);
		expect(left.aspect).toBeCloseTo(1); // 2 · (0.5/1)
		expect(left.size).toBeCloseTo(0.4);
		expect(left.size * left.aspect).toBeCloseTo(0.4); // 0.8 × 50%

		// A 50% × 50% window has the original ratio and scales both dimensions.
		const same = croppedLayerGeometry(layer, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, 2);
		expect(same.size).toBeCloseTo(0.2);
		expect(same.aspect).toBeCloseTo(2);
	});

	it('croppedLayerGeometry returns the exact box when the crop clears', () => {
		// Crop to a 1:1 window, then clear: whole-image geometry is recovered.
		const layer = { size: 0.4, aspect: 2 };
		const cropped = croppedLayerGeometry(layer, { x: 0, y: 0, w: 0.5, h: 1 }, 2);
		const restored = croppedLayerGeometry(
			{ ...cropped, crop: { x: 0, y: 0, w: 0.5, h: 1 } },
			undefined,
			2
		);
		expect(restored.size).toBeCloseTo(layer.size);
		expect(restored.aspect).toBeCloseTo(layer.aspect);
	});

	it('croppedLayerGeometry re-crops against the whole image, not the prior window', () => {
		const first = croppedLayerGeometry({ size: 0.4, aspect: 2 }, { x: 0, y: 0, w: 0.5, h: 0.5 }, 2);
		const second = croppedLayerGeometry(
			{ ...first, crop: { x: 0, y: 0, w: 0.5, h: 0.5 } },
			{ x: 0, y: 0, w: 0.75, h: 0.25 },
			2
		);
		expect(second.size).toBeCloseTo(0.1); // original height × 25%
		expect(second.aspect).toBeCloseTo(6); // 2 × (75% / 25%)
	});

	it('wholeImageAspect inverts an existing crop back to the natural ratio', () => {
		// Natural 2:1 image cropped to the left half → window ratio 1:1,
		// aspect was rewritten to 1 → whole = 1 / (0.5/1) = 2.
		const layer = { aspect: 1, crop: { x: 0, y: 0, w: 0.5, h: 1 } };
		expect(wholeImageAspect(layer)).toBeCloseTo(2);
		// Uncropped → aspect already is the whole ratio.
		expect(wholeImageAspect({ aspect: 1.33, crop: undefined })).toBeCloseTo(1.33);
	});
});
