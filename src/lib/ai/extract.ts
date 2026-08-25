/**
 * Clip analysis primitives for Auto Meme AI (AI-001, plan-bitz section 19
 * "Detect" stage, tracked as E-013's foundation).
 *
 * Extracts the four anchor kinds the meme generator builds on:
 *   - silence spans (RMS windows under a floor)
 *   - energy peaks (loudest windows, min-gap limited)
 *   - caption cues (speech = non-silent spans; text via injected detector)
 *   - face anchors (time-clustered medians of detector boxes)
 *
 * The DSP core is pure math over sample arrays - node-testable with
 * synthetic input, no browser and no AI service. Detectors (speech text,
 * face boxes) are injected interfaces so the domain layer stays free of
 * platform code (consent boundaries arrive with AI-003).
 */

/** RMS window length in seconds - 20 ms balances time resolution vs jitter. */
export const RMS_WINDOW_SEC = 0.02;

/** Fraction of full scale below which a window counts as silent. */
export const SILENCE_RMS_FLOOR = 0.02;

/** Silence spans shorter than this are ignored (gaps between words/phonemes). */
export const MIN_SILENCE_SEC = 0.25;

/** Number of windows that must be under the floor before silence starts. */
const SILENCE_ENTER_WINDOWS = 3;

/** Minimum gap between peaks so one laugh does not yield 40 anchors. */
export const MIN_PEAK_GAP_SEC = 0.6;

/** Default cap on peaks per clip - the generator only needs a handful. */
export const DEFAULT_PEAK_LIMIT = 8;

/** Speech (non-silent) spans shorter than this are dropped as noise clicks. */
export const MIN_SPEECH_SEC = 0.2;

/** Face observations within this distance merge into one anchor. */
export const FACE_CLUSTER_SEC = 0.5;

export interface SilenceSpan {
	startSec: number;
	endSec: number;
}

export interface EnergyPeak {
	atSec: number;
	rms: number;
}

export interface SpeechSegment {
	startSec: number;
	endSec: number;
}

export interface FaceObservation {
	atSec: number;
	box: FaceBox;
}
export interface CaptionCue {
	startSec: number;
	endSec: number;
	text: string;
}

export interface FaceBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface FaceAnchor {
	atSec: number;
	box: FaceBox;
	/** Number of observations merged into this anchor (stability signal). */
	observations: number;
}

/** Per-window RMS of mono PCM, one value per RMS_WINDOW_SEC of input. */
export function windowRms(pcm: Float32Array, sampleRate: number): Float32Array {
	if (pcm.length === 0 || sampleRate <= 0) return new Float32Array(0);
	const winSamples = Math.max(1, Math.round(RMS_WINDOW_SEC * sampleRate));
	const count = Math.ceil(pcm.length / winSamples);
	const out = new Float32Array(count);
	for (let w = 0; w < count; w++) {
		const start = w * winSamples;
		const end = Math.min(pcm.length, start + winSamples);
		let sum = 0;
		for (let i = start; i < end; i++) sum += pcm[i] * pcm[i];
		out[w] = Math.sqrt(sum / Math.max(1, end - start));
	}
	return out;
}

/** Spans where the RMS stays under the floor (debounced entry, min length). */
export function silenceSpans(windows: Float32Array): SilenceSpan[] {
	const spans: SilenceSpan[] = [];
	let runStart = -1;
	let quietRun = 0;
	const closeRun = (endWindow: number) => {
		if (quietRun >= SILENCE_ENTER_WINDOWS) {
			const startSec = runStart * RMS_WINDOW_SEC;
			const endSec = endWindow * RMS_WINDOW_SEC;
			if (endSec - startSec >= MIN_SILENCE_SEC) {
				spans.push({ startSec, endSec });
			}
		}
		quietRun = 0;
	};
	for (let w = 0; w < windows.length; w++) {
		if (windows[w] < SILENCE_RMS_FLOOR) {
			if (quietRun === 0) runStart = w;
			quietRun++;
		} else {
			closeRun(w);
		}
	}
	closeRun(windows.length);
	return spans;
}

/** The loudest windows, spread out by at least MIN_PEAK_GAP_SEC. */
export function energyPeaks(windows: Float32Array, limit = DEFAULT_PEAK_LIMIT): EnergyPeak[] {
	const order = Array.from({ length: windows.length }, (_, i) => i).sort(
		(a, b) => windows[b] - windows[a]
	);
	const picked: number[] = [];
	for (const idx of order) {
		if (picked.every((p) => Math.abs(p - idx) * RMS_WINDOW_SEC >= MIN_PEAK_GAP_SEC)) {
			picked.push(idx);
			if (picked.length >= limit) break;
		}
	}
	return picked
		.sort((a, b) => a - b)
		.map((idx) => ({ atSec: idx * RMS_WINDOW_SEC, rms: windows[idx] }));
}

/** Speech = the complement of silence inside [0, durationSec], min-length kept. */
export function speechSegments(silence: SilenceSpan[], durationSec: number): SpeechSegment[] {
	const segments: SpeechSegment[] = [];
	let cursor = 0;
	for (const span of silence) {
		if (span.startSec - cursor >= MIN_SPEECH_SEC) {
			segments.push({ startSec: cursor, endSec: span.startSec });
		}
		cursor = Math.max(cursor, span.endSec);
	}
	if (durationSec - cursor >= MIN_SPEECH_SEC) {
		segments.push({ startSec: cursor, endSec: durationSec });
	}
	return segments;
}

/** Injected text detector (AI-003 wires consent-gated real implementations). */
export type CaptionTextDetector = (segment: SpeechSegment) => Promise<string | null>;

/** Caption cues from speech segments; empty text drops the cue. */
export async function captionCues(
	segments: SpeechSegment[],
	detect: CaptionTextDetector
): Promise<CaptionCue[]> {
	const cues: CaptionCue[] = [];
	for (const segment of segments) {
		const text = (await detect(segment))?.trim();
		if (text) cues.push({ startSec: segment.startSec, endSec: segment.endSec, text });
	}
	return cues;
}

/** Injected face detector - returns boxes visible at `atSec`, empty = none. */
export type FaceDetector = (atSec: number) => Promise<FaceBox[]>;

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = sorted.length >> 1;
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Merge face observations into stable anchors: observations within
 * FACE_CLUSTER_SEC of each other collapse to one anchor at the median box.
 * Output stays time-ordered regardless of input order.
 */
export function mergeFaceBoxes(observations: FaceObservation[]): FaceAnchor[] {
	const sorted = [...observations].sort((a, b) => a.atSec - b.atSec);
	const anchors: FaceAnchor[] = [];
	let cluster: FaceObservation[] = [];
	const flush = () => {
		if (!cluster.length) return;
		anchors.push({
			atSec: median(cluster.map((o) => o.atSec)),
			box: {
				x: median(cluster.map((o) => o.box.x)),
				y: median(cluster.map((o) => o.box.y)),
				width: median(cluster.map((o) => o.box.width)),
				height: median(cluster.map((o) => o.box.height))
			},
			observations: cluster.length
		});
		cluster = [];
	};
	for (const obs of sorted) {
		if (cluster.length && obs.atSec - cluster[cluster.length - 1].atSec > FACE_CLUSTER_SEC) {
			flush();
		}
		cluster.push(obs);
	}
	flush();
	return anchors;
}

export interface ClipAnalysis {
	durationSec: number;
	silence: SilenceSpan[];
	peaks: EnergyPeak[];
	speechSegments: SpeechSegment[];
	captions: CaptionCue[];
	faces: FaceAnchor[];
}

export interface AnalyzeDeps {
	/** Optional caption text source; absent = no captions (pure-local mode). */
	detectCaptionText?: CaptionTextDetector;
	/** Optional face detector sampled at each speech segment start. */
	detectFaces?: FaceDetector;
}

/**
 * One-pass orchestrator: PCM in, anchors out. Detectors are optional - the
 * DSP features (silence/peaks/speech) always run, no platform calls needed.
 */
export async function analyzeClip(
	pcm: Float32Array,
	sampleRate: number,
	deps: AnalyzeDeps = {}
): Promise<ClipAnalysis> {
	const windows = windowRms(pcm, sampleRate);
	const durationSec = sampleRate > 0 ? pcm.length / sampleRate : 0;
	const silence = silenceSpans(windows);
	const segs = speechSegments(silence, durationSec);
	const captions = deps.detectCaptionText ? await captionCues(segs, deps.detectCaptionText) : [];
	const faces: FaceAnchor[] = [];
	if (deps.detectFaces) {
		const observations: FaceObservation[] = [];
		for (const segment of segs) {
			for (const box of await deps.detectFaces(segment.startSec)) {
				observations.push({ atSec: segment.startSec, box });
			}
		}
		faces.push(...mergeFaceBoxes(observations));
	}
	return {
		durationSec,
		silence,
		peaks: energyPeaks(windows),
		speechSegments: segs,
		captions,
		faces
	};
}
