import { describe, expect, it } from 'vitest';
import { cueTrackDurationSec } from './cue-track';

describe('cue-track (AI-002 static/GIF timeline)', () => {
	it('empty cues floor at 1s', () => {
		expect(cueTrackDurationSec([])).toBe(1);
	});

	it('last cue + 500ms tail', () => {
		expect(cueTrackDurationSec([{ atMs: 2500 }])).toBe(3);
		expect(cueTrackDurationSec([{ atMs: 0 }, { atMs: 4200 }, { atMs: 900 }])).toBeCloseTo(4.7);
	});

	it('does not cap long cue tracks', () => {
		expect(cueTrackDurationSec([{ atMs: 200_000 }])).toBe(200.5);
	});

	it('never below 1s even with a tiny cue', () => {
		expect(cueTrackDurationSec([{ atMs: 100 }])).toBe(1);
	});

	it('runs to a cue END (start + length) when lengths are given', () => {
		// A 10s sound cued at 0 used to get chopped at ~1s (last start + tail).
		expect(cueTrackDurationSec([{ atMs: 0 }], () => 10)).toBe(10.5);
		expect(cueTrackDurationSec([{ atMs: 1500 }], () => 2)).toBeCloseTo(4);
		// The longest end wins across cues.
		expect(cueTrackDurationSec([{ atMs: 0 }, { atMs: 900 }], (c) => (c.atMs ? 1 : 8))).toBe(8.5);
	});

	it('a zero/absent length keeps the legacy last-start math', () => {
		expect(cueTrackDurationSec([{ atMs: 2500 }], () => 0)).toBe(3);
	});
});
