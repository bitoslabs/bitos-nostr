import { describe, expect, it } from 'vitest';
import { decodeGif, gifLayerPainter } from './gif';
import { encodeAnimatedGif, type GifEncodeFrame } from './gif-encode';
import { planGifExport } from './gif-export';
import { paintImageOverlays } from './render';
import type { MemeImageOverlay } from './image-overlay';

/** Solid-color canvas (the frame source for synthetic GIFs). */
function colorCanvas(size: number, fill: string): HTMLCanvasElement {
	const c = document.createElement('canvas');
	c.width = size;
	c.height = size;
	const ctx = c.getContext('2d')!;
	ctx.fillStyle = fill;
	ctx.fillRect(0, 0, size, size);
	return c;
}

/** Center pixel of an ImageBitmap as an rgb string. */
async function centerPixel(bitmap: ImageBitmap): Promise<string> {
	const c = document.createElement('canvas');
	c.width = bitmap.width;
	c.height = bitmap.height;
	const ctx = c.getContext('2d')!;
	ctx.drawImage(bitmap, 0, 0);
	const d = ctx.getImageData(
		Math.floor(bitmap.width / 2),
		Math.floor(bitmap.height / 2),
		1,
		1
	).data;
	return `rgb(${d[0]},${d[1]},${d[2]})`;
}

describe('GIF export round trip (browser)', () => {
	it('keeps an animated LAYER moving over a static base — the frozen single-frame export regression', async () => {
		// A 3-frame RGB source GIF, 100ms per frame.
		const srcFrames: GifEncodeFrame[] = ['#ff0000', '#00ff00', '#0000ff'].map((fill) => ({
			source: colorCanvas(40, fill),
			delayMs: 100
		}));
		const srcBlob = await encodeAnimatedGif(srcFrames, { width: 40, height: 40 });
		const decoded = await decodeGif(await srcBlob.arrayBuffer());
		expect(decoded.frames.length).toBe(3);

		// The studio's export plan for: static base + this animated layer,
		// no sound cues. The old code derived durationSec=0 here (one frozen
		// frame); the plan must carry the layer's own frames and holds.
		const plan = planGifExport(undefined, [decoded.frames], 0, null);
		expect(plan.steps.length).toBe(3);
		expect(plan.steps.map((s) => s.delayMs)).toEqual([100, 100, 100]);

		// Paint the composition exactly like exportAnimatedGifMeme: static
		// base fill, then the layer through the animated painter resolver.
		const layer: MemeImageOverlay = {
			id: 'layer-1',
			src: 'https://example.com/sticker.gif',
			aspect: 1,
			x: 0.5,
			y: 0.5,
			size: 0.5
		};
		let painter: ReturnType<typeof gifLayerPainter> | null = null;
		const resolver = (_src: string, box: { w: number; h: number }) => {
			if (!painter) painter = gifLayerPainter(decoded, box);
			return (ctx, x, y, timeSec) => painter!.paint(ctx, x, y, timeSec);
		};
		const outFrames: GifEncodeFrame[] = [];
		for (const step of plan.steps) {
			const a = colorCanvas(80, '#404040');
			const ctx = a.getContext('2d')!;
			paintImageOverlays(ctx, [layer], () => null, a, step.atSec * 1000, resolver);
			outFrames.push({ source: a, delayMs: step.delayMs });
		}
		painter?.close();

		const outBlob = await encodeAnimatedGif(outFrames, { width: 80, height: 80 });
		const roundTripped = await decodeGif(await outBlob.arrayBuffer());
		// The exported loop must contain the layer's animation: three frames,
		// each showing a different source color at the layer's position.
		expect(roundTripped.frames.length).toBe(3);
		const seen = new Set<string>();
		for (const f of roundTripped.frames) seen.add(await centerPixel(f.frame));
		expect(seen.size).toBe(3);
		expect(roundTripped.frames.map((f) => Math.round(f.duration * 1000))).toEqual([100, 100, 100]);
	});

	it('preserves a base GIF’s original variable frame timing through the plan', async () => {
		const srcFrames: GifEncodeFrame[] = [
			{ source: colorCanvas(20, '#ff0000'), delayMs: 30 },
			{ source: colorCanvas(20, '#00ff00'), delayMs: 120 },
			{ source: colorCanvas(20, '#0000ff'), delayMs: 50 }
		];
		const decoded = await decodeGif(
			await (await encodeAnimatedGif(srcFrames, { width: 20, height: 20 })).arrayBuffer()
		);
		// Encoded holds are centiseconds — the 30ms frame lands at 3cs.
		const plan = planGifExport(decoded.frames, [], 0, null);
		expect(plan.steps.map((s) => s.delayMs)).toEqual([30, 120, 50]);
	});
});
