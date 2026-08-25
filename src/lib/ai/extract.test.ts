import { describe, expect, it } from 'vitest';
import {
	DEFAULT_PEAK_LIMIT,
	FACE_CLUSTER_SEC,
	MIN_SILENCE_SEC,
	analyzeClip,
	captionCues,
	energyPeaks,
	mergeFaceBoxes,
	silenceSpans,
	speechSegments,
	windowRms
} from './extract';

/** Synthetic PCM: `spec` maps second -> amplitude (piecewise, filled at 100 Hz). */
function pcmFrom(spec: Array<[number, number]>, seconds: number, sampleRate = 100): Float32Array {
	const pcm = new Float32Array(Math.round(seconds * sampleRate));
	for (let i = 0; i < pcm.length; i++) {
		const t = i / sampleRate;
		let amp = 0;
		for (const [from, level] of spec) {
			if (t >= from) amp = level;
		}
		// Alternate sign so a nonzero level has real energy, zero stays zero.
		pcm[i] = amp === 0 ? 0 : amp * (i % 2 === 0 ? 1 : -1);
	}
	return pcm;
}

describe('windowRms', () => {
	it('produces one value per 20 ms window and measures energy', () => {
		const sampleRate = 1000; // 20 samples per window
		const pcm = new Float32Array(40); // two windows: loud, silent
		for (let i = 0; i < 20; i++) pcm[i] = i % 2 ? 0.5 : -0.5;
		const rms = windowRms(pcm, sampleRate);
		expect(rms).toHaveLength(2);
		expect(rms[0]).toBeCloseTo(0.5, 5);
		expect(rms[1]).toBe(0);
	});

	it('returns empty for empty input or bad rate', () => {
		expect(windowRms(new Float32Array(0), 1000)).toHaveLength(0);
		expect(windowRms(new Float32Array(10), 0)).toHaveLength(0);
	});
});

describe('silenceSpans', () => {
	it('detects a long quiet stretch between loud ones', () => {
		// 0-1s loud, 1-3s silent, 3-4s loud at 100 Hz
		const pcm = pcmFrom(
			[
				[0, 0.4],
				[1, 0],
				[3, 0.4]
			],
			4
		);
		const spans = silenceSpans(windowRms(pcm, 100));
		expect(spans).toHaveLength(1);
		expect(spans[0].startSec).toBeGreaterThanOrEqual(1);
		expect(spans[0].startSec).toBeLessThan(1.2);
		expect(spans[0].endSec).toBeGreaterThan(2.8);
		expect(spans[0].endSec).toBeLessThanOrEqual(3);
		expect(spans[0].endSec - spans[0].startSec).toBeGreaterThanOrEqual(MIN_SILENCE_SEC);
	});

	it('ignores sub-floor blips shorter than the debounce', () => {
		// Loud throughout with a single quiet window in the middle.
		const windows = new Float32Array(50).fill(0.5);
		windows[25] = 0.001;
		expect(silenceSpans(windows)).toHaveLength(0);
	});

	it('drops silence runs shorter than MIN_SILENCE_SEC', () => {
		// 200 ms of silence - under the 250 ms floor.
		const pcm = pcmFrom(
			[
				[0, 0.4],
				[1, 0],
				[1.2, 0.4]
			],
			2
		);
		expect(silenceSpans(windowRms(pcm, 100))).toHaveLength(0);
	});
});

describe('energyPeaks', () => {
	it('picks the loudest windows with the minimum gap enforced', () => {
		// Two bursts: 5-6s at 0.9 and 0-1s at 0.4, plus a third at 4.4s at 0.8
		const pcm = pcmFrom(
			[
				[0, 0.4],
				[4.4, 0.8],
				[5, 0.9],
				[6, 0.12]
			],
			7
		);
		const peaks = energyPeaks(windowRms(pcm, 100));
		expect(peaks.length).toBeGreaterThan(0);
		expect(peaks.length).toBeLessThanOrEqual(DEFAULT_PEAK_LIMIT);
		// The 5-6s burst (loudest) is present as a peak...
		const loudBurst = peaks.find((p) => p.atSec >= 4.8 && p.atSec <= 6);
		expect(loudBurst).toBeDefined();
		expect(loudBurst!.rms).toBeGreaterThanOrEqual(0.8);
		// ...and every pair respects the gap.
		for (let i = 1; i < peaks.length; i++) {
			expect(peaks[i].atSec - peaks[i - 1].atSec).toBeGreaterThanOrEqual(0.6 - 1e-9);
		}
		// Sorted output.
		for (let i = 1; i < peaks.length; i++) {
			expect(peaks[i].atSec).toBeGreaterThan(peaks[i - 1].atSec);
		}
	});

	it('caps results at the limit', () => {
		const windows = new Float32Array(200);
		for (let i = 0; i < windows.length; i++) windows[i] = 0.1 + (i % 100) / 1000;
		expect(energyPeaks(windows, 3)).toHaveLength(3);
	});
});

describe('speechSegments', () => {
	it('returns the complement of silence, dropping too-short gaps', () => {
		const segments = speechSegments(
			[
				{ startSec: 1, endSec: 3 },
				{ startSec: 4, endSec: 4.1 } // dropped as it splits a 0.9s speech run? no - complement logic keeps speech >= MIN_SPEECH_SEC
			],
			5
		);
		// Segments: [0,1) speech, [3,4) speech (0.9s? no: 4.1 end -> cursor jumps), [4.1?..5]
		expect(segments.length).toBeGreaterThanOrEqual(2);
		expect(segments[0]).toEqual({ startSec: 0, endSec: 1 });
		// Last tail from 4.1 to 5 is 0.9s of speech - kept.
		expect(segments.at(-1)!.endSec).toBe(5);
	});

	it('keeps a leading segment when the clip starts loud', () => {
		const segments = speechSegments([{ startSec: 2, endSec: 4 }], 4);
		expect(segments).toEqual([{ startSec: 0, endSec: 2 }]);
	});

	it('drops speech shorter than MIN_SPEECH_SEC', () => {
		// A 0.1s tail (4.9-5.0) is under the floor - nothing survives.
		const segments = speechSegments([{ startSec: 0, endSec: 4.9 }], 5);
		expect(segments).toEqual([]);
	});
});

describe('captionCues', () => {
	it('maps detected text onto segments and drops empty results', async () => {
		const cues = await captionCues(
			[
				{ startSec: 0, endSec: 1 },
				{ startSec: 2, endSec: 3 }
			],
			async (seg) => (seg.startSec === 0 ? '  hello world  ' : null)
		);
		expect(cues).toEqual([{ startSec: 0, endSec: 1, text: 'hello world' }]);
	});
});

/** Face-box helper shared by the clustering tests. */
const box = (x: number) => ({ x, y: 0.1, width: 0.2, height: 0.3 });

describe('mergeFaceBoxes', () => {
	it('clusters nearby observations into median-box anchors', () => {
		const anchors = mergeFaceBoxes([
			{ atSec: 0.0, box: box(0.1) },
			{ atSec: 0.2, box: box(0.3) },
			{ atSec: 0.4, box: box(0.2) }
		]);
		expect(anchors).toHaveLength(1);
		expect(anchors[0].box.x).toBeCloseTo(0.2, 5);
		expect(anchors[0].observations).toBe(3);
		expect(anchors[0].atSec).toBeCloseTo(0.2, 5);
	});

	it('splits clusters farther apart than FACE_CLUSTER_SEC and orders output', () => {
		const anchors = mergeFaceBoxes([
			{ atSec: 5.0, box: box(0.5) },
			{ atSec: 0.0, box: box(0.1) },
			{ atSec: 5.0 + FACE_CLUSTER_SEC + 0.01, box: box(0.7) }
		]);
		expect(anchors).toHaveLength(3);
		expect(anchors.map((a) => a.atSec)).toEqual([0, 5, expect.closeTo(5.51, 2)]);
	});
});

describe('analyzeClip (orchestrator)', () => {
	it('runs DSP-only with no detectors injected', async () => {
		const pcm = pcmFrom(
			[
				[0, 0.4],
				[1, 0],
				[3, 0.4]
			],
			4
		);
		const analysis = await analyzeClip(pcm, 100);
		expect(analysis.durationSec).toBe(4);
		expect(analysis.silence).toHaveLength(1);
		expect(analysis.speechSegments.length).toBe(2);
		expect(analysis.captions).toEqual([]);
		expect(analysis.faces).toEqual([]);
		expect(analysis.peaks.length).toBeGreaterThan(0);
	});

	it('wires caption + face detectors through the speech anchors', async () => {
		const pcm = pcmFrom(
			[
				[0, 0.5],
				[1.5, 0],
				[3, 0.5]
			],
			4.5
		);
		const analysis = await analyzeClip(pcm, 100, {
			detectCaptionText: async (seg) => `line at ${seg.startSec.toFixed(1)}`,
			detectFaces: async () => [box(0.4)]
		});
		expect(analysis.captions.length).toBe(analysis.speechSegments.length);
		for (const cue of analysis.captions) {
			expect(cue.text).toMatch(/^line at \d+\.\d$/);
		}
		// One face detection per speech segment; segments sit 3s apart (> cluster
		// window), so each becomes its own single-observation anchor.
		expect(analysis.faces).toHaveLength(analysis.speechSegments.length);
		for (const anchor of analysis.faces) {
			expect(anchor.observations).toBe(1);
			expect(anchor.box.x).toBeCloseTo(0.4, 5);
		}
	});
});
