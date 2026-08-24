import { describe, expect, it } from 'vitest';
import { LayerAssetCache } from './meme-layer-assets.svelte';

describe('LayerAssetCache.looksAnimatedGif', () => {
	it('trusts held bytes over the URL', () => {
		const c = new LayerAssetCache();
		// PNG bytes under a .gif URL — content type wins.
		c.blobs.set('https://x/y.gif', new Blob(['x'], { type: 'image/png' }));
		expect(c.looksAnimatedGif('https://x/y.gif')).toBe(false);
		// GIF bytes under a .png URL — still animated.
		c.blobs.set('https://x/y.png', new Blob(['x'], { type: 'image/gif' }));
		expect(c.looksAnimatedGif('https://x/y.png')).toBe(true);
	});

	it('falls back to the URL extension when bytes are unknown', () => {
		const c = new LayerAssetCache();
		expect(c.looksAnimatedGif('https://x/cat.gif')).toBe(true);
		expect(c.looksAnimatedGif('https://x/cat.gif?v=2')).toBe(true);
		expect(c.looksAnimatedGif('https://x/cat.png')).toBe(false);
		expect(c.looksAnimatedGif('https://x/cat.webp')).toBe(false);
	});
});

describe('LayerAssetCache.release', () => {
	it('drops bytes + decoders for a src and tolerates unknown srcs', () => {
		const c = new LayerAssetCache();
		c.gifs.set('a', { close: () => undefined } as never);
		c.painters.set('a', {
			key: '10x10',
			handle: { close: () => undefined } as never
		});
		c.blobs.set('a', new Blob(['x']));
		c.release('a');
		expect(c.gifs.has('a')).toBe(false);
		expect(c.painters.has('a')).toBe(false);
		expect(c.blobs.has('a')).toBe(false);
		// Unknown src must not throw (layers can land without assets).
		expect(() => c.release('nope')).not.toThrow();
	});

	it('resets the decode-failure note', () => {
		const c = new LayerAssetCache();
		c.lastGifDecodeError = 'no bytes';
		c.releaseAll();
		expect(c.lastGifDecodeError).toBe('');
	});
});

describe('LayerAssetCache.painterFor', () => {
	it('keeps its cache context when passed as a renderer callback', () => {
		const c = new LayerAssetCache();
		const resolvePainter = c.painterFor;
		expect(resolvePainter('https://x/layer.gif', { w: 10, h: 10 })).toBeNull();
	});
});
