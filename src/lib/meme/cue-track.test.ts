import { describe, expect, it } from 'vitest';
import { cueTrackDurationSec, MAX_VIDEO_MEME_SECONDS } from './cue-track';

describe('cue-track (AI-002 static/GIF timeline)', () => {
	it('empty cues floor at 1s', () => {
		expect(cueTrackDurationSec([])).toBe(1);
	});

	it('last cue + 500ms tail', () => {
		expect(cueTrackDurationSec([{ atMs: 2500 }])).toBe(3);
		expect(cueTrackDurationSec([{ atMs: 0 }, { atMs: 4200 }, { atMs: 900 }])).toBeCloseTo(4.7);
	});

	it('clamped to the export cap', () => {
		expect(cueTrackDurationSec([{ atMs: 200_000 }])).toBe(MAX_VIDEO_MEME_SECONDS);
	});

	it('never below 1s even with a tiny cue', () => {
		expect(cueTrackDurationSec([{ atMs: 100 }])).toBe(1);
	});
});
