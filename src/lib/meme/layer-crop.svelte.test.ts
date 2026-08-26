import { describe, expect, it } from 'vitest';
import { gifLayerPainter } from './gif';
import { encodeAnimatedGif, type GifEncodeFrame } from './gif-encode';
import { paintImageOverlays } from './render';
import type { MemeImageOverlay } from './image-overlay';

/** Solid-color canvas (frame source for synthetic GIFs). */
function colorCanvas(size: number, fill: string): HTMLCanvasElement {
	const c = document.createElement('canvas');
	c.width = size;
	c.height = size;
	const ctx = c.getContext('2d')!;
	ctx.fillStyle = fill;
	ctx.fillRect(0, 0, size, size);
	return c;
}

/** Quad-split canvas: four color quadrants over `size` px. */
function quadCanvas(size: number): HTMLCanvasElement {
	const c = document.createElement('canvas');
	c.width = size;
	c.height = size;
	const ctx = c.getContext('2d')!;
	const half = size / 2;
	const quads: [number, number, string][] = [
		[0, 0, '#ff0000'],
		[1, 0, '#00ff00'],
		[0, 1, '#0000ff'],
		[1, 1, '#ffff00']
	];
	for (const [qx, qy, fill] of quads) {
		ctx.fillStyle = fill;
		ctx.fillRect(qx * half, qy * half, half, half);
	}
	return c;
}

/** Loading an HTMLImageElement from a canvas (drawImage source with
 *  naturalWidth — what layerAssets.bitmaps cache). */
function canvasToImage(source: HTMLCanvasElement): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('img decode failed'));
		img.src = source.toDataURL('image/png');
	});
}

function pixelAt(c: HTMLCanvasElement, x: number, y: number): string {
	const ctx = c.getContext('2d')!;
	const d = ctx.getImageData(x, y, 1, 1).data;
	return `rgb(${d[0]},${d[1]},${d[2]})`;
}

describe('image layer crop painting (browser)', () => {
	it('draws only the cropped source region — quadrants resolve to the picked color', async () => {
		// 100×100 quad image; crop the top-left quadrant (red).
		const img = await canvasToImage(quadCanvas(100));
		const layer: MemeImageOverlay = {
			id: 'l1',
			src: 'https://example.com/quad.png',
			aspect: 1, // square crop of a square image
			x: 0.5,
			y: 0.5,
			size: 1, // fill the canvas
			crop: { x: 0, y: 0, w: 0.5, h: 0.5 }
		};
		const canvas = colorCanvas(80, '#404040');
		paintImageOverlays(
			canvas.getContext('2d')!,
			[layer],
			(src) => (src === layer.src ? img : null),
			canvas
		);
		// Center must be the cropped region's color (red), not the base gray.
		expect(pixelAt(canvas, 40, 40)).toBe('rgb(255,0,0)');
	});

	it('keeps quadrants aligned for a bottom-right crop (yellow)', async () => {
		const img = await canvasToImage(quadCanvas(100));
		const layer: MemeImageOverlay = {
			id: 'l1',
			src: 'https://example.com/quad.png',
			aspect: 1,
			x: 0.5,
			y: 0.5,
			size: 1,
			crop: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }
		};
		const canvas = colorCanvas(80, '#404040');
		paintImageOverlays(
			canvas.getContext('2d')!,
			[layer],
			(src) => (src === layer.src ? img : null),
			canvas
		);
		expect(pixelAt(canvas, 40, 40)).toBe('rgb(255,255,0)');
	});

	it('animated painter composes crop with the GIF frames (top-left = red)', async () => {
		// Two-frame quad GIF so the painter path (scratch canvas) is exercised.
		const frames: GifEncodeFrame[] = [
			{ source: quadCanvas(40), delayMs: 100 },
			{ source: quadCanvas(40), delayMs: 100 }
		];
		const blob = await encodeAnimatedGif(frames, { width: 40, height: 40 });
		// Reuse decode via a dynamic import to keep this file's imports tidy.
		const { decodeGif } = await import('./gif');
		const decoded = await decodeGif(await blob.arrayBuffer());
		const layer: MemeImageOverlay = {
			id: 'l1',
			src: 'https://example.com/quad.gif',
			aspect: 1,
			x: 0.5,
			y: 0.5,
			size: 1,
			crop: { x: 0, y: 0, w: 0.5, h: 0.5 }
		};
		const canvas = colorCanvas(80, '#404040');
		const painter = gifLayerPainter(decoded, {
			w: canvas.width,
			h: canvas.height,
			crop: layer.crop
		});
		painter.paint(canvas.getContext('2d')!, 0, 0, 0.05);
		painter.close();
		expect(pixelAt(canvas, 40, 40)).toBe('rgb(255,0,0)');
	});
});
