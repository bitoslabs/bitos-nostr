import { describe, expect, it } from 'vitest';
import {
	exportErrorMessage,
	exportImetaDuration,
	recordedExt,
	shiftCuesForExport
} from './export-support';
import type { MemeSfxCue } from './schema';

const cue = (atMs: number): MemeSfxCue => ({ id: 'c', sfx: 'boom', atMs, gain: 1 });

describe('shiftCuesForExport', () => {
	it('re-maps media time into the trimmed, speed-adjusted export window', () => {
		const out = shiftCuesForExport([cue(5000), cue(9000)], 2, 2, 10);
		// (5000 - 2000) / 2 = 1500; (9000 - 2000) / 2 = 3500
		expect(out.map((c) => c.atMs)).toEqual([1500, 3500]);
	});

	it('drops cues outside the window and keeps ids/sfx', () => {
		const out = shiftCuesForExport([cue(1000), cue(25000), cue(4000)], 2, 1, 10);
		// 1000 → -1000 (before trim, drops); 25000 → 23000 (past 10s, drops); 4000 → 2000 stays
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ id: 'c', sfx: 'boom', atMs: 2000 });
	});

	it('treats playbackRate 0 as 1 (guard against division blowups)', () => {
		const out = shiftCuesForExport([cue(3000)], 1, 0, 10);
		expect(out[0]!.atMs).toBe(2000);
	});
});

describe('exportImetaDuration', () => {
	const base = {
		uploadedKind: 'video',
		mediaKind: 'image',
		exportFormat: 'auto',
		pinnedLengthSec: null,
		capSec: 60
	} as const;

	it('returns nothing for image uploads', () => {
		expect(
			exportImetaDuration({ ...base, uploadedKind: 'image', cueRuntimeSec: 5 })
		).toBeUndefined();
	});

	it('video sources use the export window', () => {
		expect(exportImetaDuration({ ...base, mediaKind: 'video', exportDurationSec: 4.5 })).toBe(4.5);
		expect(
			exportImetaDuration({ ...base, mediaKind: 'video', exportDurationSec: 0 })
		).toBeUndefined();
	});

	it('explicit GIF exports clamp a pinned length to the source loop', () => {
		expect(
			exportImetaDuration({
				...base,
				gifDuration: 3,
				exportFormat: 'gif',
				pinnedLengthSec: 10
			})
		).toBe(3);
	});

	it('recorder GIF exports prefer the pinned length over the loop', () => {
		expect(exportImetaDuration({ ...base, gifDuration: 3, pinnedLengthSec: 10 })).toBe(10);
		expect(exportImetaDuration({ ...base, gifDuration: 3 })).toBe(3);
	});

	it('sound memes clamp to the cap and floor at 0.5s', () => {
		expect(exportImetaDuration({ ...base, cueRuntimeSec: 90, capSec: 60 })).toBe(60);
		expect(exportImetaDuration({ ...base, cueRuntimeSec: 0.2 })).toBe(0.5);
	});
});

describe('exportErrorMessage', () => {
	it('translates tainted-canvas SecurityErrors into the fix', () => {
		const e = new DOMException('The canvas has been tainted', 'SecurityError');
		expect(exportErrorMessage(e)).toContain('cross-origin image');
	});
	it('passes ordinary errors through', () => {
		expect(exportErrorMessage(new Error('boom'))).toBe('boom');
		expect(exportErrorMessage('x')).toBe('Export failed');
	});
});

describe('recordedExt', () => {
	it('picks mp4 only for mp4 mimes', () => {
		expect(recordedExt('video/mp4')).toBe('mp4');
		expect(recordedExt('video/webm;codecs=vp9,opus')).toBe('webm');
	});
});
