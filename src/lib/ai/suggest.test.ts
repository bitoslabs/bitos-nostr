import { describe, expect, it } from 'vitest';
import type { ClipAnalysis } from './extract';
import {
	MEME_INTENSITIES,
	MAX_SUGGESTION_OVERLAYS,
	captionOverlays,
	faceZooms,
	peakCues,
	suggestTimelines
} from './suggest';

const analysis: ClipAnalysis = {
	durationSec: 10,
	silence: [{ startSec: 4, endSec: 6 }],
	peaks: [
		{ atSec: 1, rms: 0.5 },
		{ atSec: 3, rms: 0.9 },
		{ atSec: 8, rms: 0.7 }
	],
	speechSegments: [
		{ startSec: 0, endSec: 4 },
		{ startSec: 6, endSec: 10 }
	],
	captions: [
		{ startSec: 0.5, endSec: 1.8, text: 'watch this' },
		{ startSec: 6.5, endSec: 8.5, text: 'told you' }
	],
	faces: [
		{ atSec: 1, box: { x: 0.3, y: 0.2, width: 0.25, height: 0.3 }, observations: 4 },
		{ atSec: 8, box: { x: 0.45, y: 0.25, width: 0.2, height: 0.28 }, observations: 2 }
	]
};

describe('suggestTimelines (AI-002 ladder)', () => {
	it('returns exactly the three intensities in ladder order', () => {
		const suggestions = suggestTimelines(analysis);
		expect(suggestions.map((s) => s.intensity)).toEqual([...MEME_INTENSITIES]);
	});

	it('escalates: mild has no zooms, chaos tops out at 250%', () => {
		const [mild, funny, chaos] = suggestTimelines(analysis);
		expect(mild.zooms).toHaveLength(0);
		expect(funny.zooms.length).toBeGreaterThan(0);
		expect(Math.max(...chaos.zooms.map((z) => z.factor))).toBe(2.5);
		expect(funny.zooms.every((z) => z.factor === 1.6)).toBe(true);
	});

	it('grows caption size and drops the subtitle bar as intensity rises', () => {
		const [mild, funny] = suggestTimelines(analysis);
		const mildCaps = captionOverlays(analysis, 'mild');
		const chaosCaps = captionOverlays(analysis, 'chaos');
		expect(mildCaps.every((o) => o.bar)).toBe(true);
		expect(chaosCaps.every((o) => !o.bar)).toBe(true);
		expect(chaosCaps[0].size).toBeGreaterThan(mildCaps[0].size);
		expect(funny.overlays.length).toBeGreaterThanOrEqual(mild.overlays.length);
	});

	it('loudest peaks become punchlines and SFX, chronologically after slicing', () => {
		const chaos = suggestTimelines(analysis)[2];
		const punches = chaos.overlays.filter((o) => o.id.startsWith('ai-punch'));
		expect(punches).toHaveLength(2);
		// 0.9 (3s) and 0.7 (8s) are the two loudest -> chronological order.
		expect(punches[0].startMs).toBe(3000);
		expect(punches[0].text).toBe('BONK!');
		expect(punches[1].startMs).toBe(8000);
		// SFX rides every peak (up to its cap of 6), punches only the top two.
		expect(chaos.sfxCues.map((c) => c.atMs)).toEqual([1000, 3000, 8000]);
		expect(chaos.sfxCues[0].gain).toBe(1);
	});

	it('cues use valid schema ids and stay under the cap', () => {
		const cues = peakCues(analysis, 'chaos');
		expect(cues.length).toBeLessThanOrEqual(6);
		expect(cues.every((c) => c.atMs >= 0 && c.gain >= 0 && c.gain <= 1)).toBe(true);
		const chaos = suggestTimelines(analysis)[2];
		expect(chaos.overlays.length).toBeLessThanOrEqual(MAX_SUGGESTION_OVERLAYS + 2);
	});

	it('zooms center on the detected face boxes', () => {
		const zooms = faceZooms(analysis, 'funny');
		expect(zooms[0].cx).toBeCloseTo(0.3 + 0.25 / 2, 5);
		expect(zooms[0].startMs).toBe(800); // 0.2 s lead-in
		expect(zooms.length).toBe(2);
	});
});
