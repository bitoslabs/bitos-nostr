import { describe, expect, it, vi } from 'vitest';
import { cueAudioTrack, paintMemeBase, recordMeme } from './export-pipeline';
import type { MemeSfxCue } from './schema';

// Browser mode: stub the recorder mime probe (MediaRecorder is real here).
vi.mock('./export-support', () => ({
	pickRecorderMime: () => null,
	RecorderSession: class {
		run = vi.fn();
		finish = vi.fn();
		dispose = vi.fn();
	},
	shiftCuesForExport: (cues: unknown[]) => [...cues]
}));

function cue(over: Partial<MemeSfxCue> = {}): MemeSfxCue {
	return { id: 'c1', sfx: 'boom', atMs: 0, gain: 1, ...over };
}

describe('paintMemeBase', () => {
	it('paints an image cover-fitted and resets the filter', async () => {
		const canvas = document.createElement('canvas');
		canvas.width = 10;
		canvas.height = 10;
		const ctx = canvas.getContext('2d')!;
		// Real pixels so naturalWidth/Height are non-zero in the browser.
		const src = document.createElement('canvas');
		src.width = 20;
		src.height = 40;
		const img = new Image();
		await new Promise<void>((resolve) => {
			img.onload = () => resolve();
			img.src = src.toDataURL('image/png');
		});
		const draw = vi.spyOn(ctx, 'drawImage');
		paintMemeBase(ctx, canvas, {
			mediaKind: 'image',
			gif: null,
			stageImg: img,
			stageVideo: null,
			lookCss: 'grayscale(1)',
			mediaTransform: { scale: 1, x: 0, y: 0 }
		});
		expect(draw).toHaveBeenCalledTimes(1);
		// coverRect on 20×40 into 10×10 → scale .5 → ~10×20 rect at x=0, y≈-5.
		const [drawnSrc, x, y, w, h] = draw.mock.calls[0] as unknown as [
			unknown,
			number,
			number,
			number,
			number
		];
		expect(drawnSrc).toBe(img);
		expect(x).toBeCloseTo(0, 5);
		expect(y).toBeCloseTo(-5, 5);
		expect(w).toBeCloseTo(10, 5);
		expect(h).toBeCloseTo(20, 5);
		expect(ctx.filter).toBe('none');
	});

	it('uses the stage playhead for gif bases when no atSec is passed', () => {
		const canvas = document.createElement('canvas');
		canvas.width = 4;
		canvas.height = 4;
		const ctx = canvas.getContext('2d')!;
		const frames = [{ atSec: 0, image: document.createElement('canvas'), x: 0, y: 0, w: 4, h: 4 }];
		const gif = {
			width: 4,
			height: 4,
			duration: 1,
			frames,
			close: () => undefined
		} as unknown as Parameters<typeof paintMemeBase>[2]['gif'];
		expect(() =>
			paintMemeBase(ctx, canvas, {
				mediaKind: 'image',
				gif,
				stageImg: null,
				stageVideo: null,
				lookCss: 'none',
				mediaTransform: { scale: 1, x: 0, y: 0 },
				stageSeconds: 0.5
			})
		).not.toThrow();
	});

	it('does nothing when no source is live (empty stage)', () => {
		const canvas = document.createElement('canvas');
		canvas.width = 4;
		canvas.height = 4;
		const ctx = canvas.getContext('2d')!;
		expect(() =>
			paintMemeBase(ctx, canvas, {
				mediaKind: null,
				gif: null,
				stageImg: null,
				stageVideo: null,
				lookCss: 'none',
				mediaTransform: { scale: 1, x: 0, y: 2 }
			})
		).not.toThrow();
	});
});

describe('cueAudioTrack', () => {
	it('returns null with no cues (silent export)', async () => {
		expect(await cueAudioTrack(1, [], async () => null)).toBeNull();
	});

	it('returns null when OfflineAudioContext is missing', async () => {
		const orig = window.OfflineAudioContext;
		// @ts-expect-error test stub
		delete window.OfflineAudioContext;
		try {
			expect(await cueAudioTrack(1, [cue()], async () => null)).toBeNull();
		} finally {
			window.OfflineAudioContext = orig;
		}
	});

	it('never throws when custom-sound decoding fails (mixer skips it)', async () => {
		const result = await cueAudioTrack(
			1,
			[cue({ sfx: 'custom', soundId: 's1' })],
			async () => null
		);
		expect(result === null || result instanceof MediaStreamTrack).toBe(true);
	});
});

describe('recordMeme', () => {
	it('throws a friendly error when MediaRecorder is unsupported', async () => {
		const canvas = document.createElement('canvas');
		await expect(recordMeme({ canvas, totalMs: 100, paint: () => undefined })).rejects.toThrow(
			/cannot record/i
		);
	});
});
