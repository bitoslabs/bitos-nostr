/**
 * Auto Meme timeline generator (AI-002, plan-bitz section 19 "Generate 3
 * versions" + Phase 7 deliverable "Mild/Funny/Chaos suggestions as editable
 * timelines").
 *
 * Consumes the AI-001 `ClipAnalysis` anchors and emits ordinary editor
 * objects (`MemeTextOverlay` + `MemeSfxCue`) - the output is ALWAYS a
 * suggestion the user previews and edits before publish (Phase 7 exit
 * criterion), never a direct-to-wire payload.
 *
 * Intensity ladder per the plan spec:
 *   Mild   - subtitle, small zoom, pop
 *   Funny  - zoom, big eyes, boom, freeze
 *   Chaos  - BIG EYES, SHAKE, ZOOM 250%, BONK, FREEZE, CAPTION, REPLAY
 *
 * Pure functions over parsed anchors - node-testable, no platform code.
 */
import type { ClipAnalysis, EnergyPeak, FaceAnchor } from './extract';
import type { MemeSfxCue, MemeSfxId, MemeTextOverlay } from '$lib/meme/schema';

export const MEME_INTENSITIES = ['mild', 'funny', 'chaos'] as const;
export type MemeIntensity = (typeof MEME_INTENSITIES)[number];

/** Max overlays/cues per suggestion - suggestions stay hand-editable. */
export const MAX_SUGGESTION_OVERLAYS = 6;
export const MAX_SUGGESTION_CUES = 6;

/** Punchline window per intensity (ms) - how long the gag stays up. */
const PUNCHLINE_MS: Record<MemeIntensity, number> = { mild: 1500, funny: 2000, chaos: 2500 };

/** Cue-to-sfx vocabulary per intensity (the plan's onomatopoeia ladder). */
const PEAK_SFX: Record<MemeIntensity, MemeSfxId[]> = {
	mild: ['pop', 'ding'],
	funny: ['boom', 'boing', 'laugh'],
	chaos: ['boom', 'laugh', 'drumroll', 'whoosh']
};

const CAPTION_FONT_SIZE: Record<MemeIntensity, number> = { mild: 0.05, funny: 0.08, chaos: 0.13 };

let seq = 0;
function idFor(prefix: string): string {
	return `ai-${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;
}

function ms(sec: number): number {
	return Math.max(0, Math.round(sec * 1000));
}

/** Top-N peaks as punchline candidates, chronological. */
function punchlinePeaks(peaks: EnergyPeak[], count: number): EnergyPeak[] {
	return [...peaks]
		.sort((a, b) => b.rms - a.rms)
		.slice(0, count)
		.sort((a, b) => a.atSec - b.atSec);
}

/** Caption overlays: transcript lines bounded to their speech windows. */
export function captionOverlays(
	analysis: ClipAnalysis,
	intensity: MemeIntensity
): MemeTextOverlay[] {
	return analysis.captions.slice(0, MAX_SUGGESTION_OVERLAYS).map((cue, i) => ({
		id: idFor('cap'),
		text: cue.text.toUpperCase(),
		x: 0.5,
		y: intensity === 'chaos' ? 0.12 + (i % 3) * 0.06 : 0.86,
		size: CAPTION_FONT_SIZE[intensity],
		color: '#ffffff',
		font: 'impact',
		caps: intensity !== 'mild',
		stroke: intensity !== 'mild',
		bar: intensity === 'mild',
		startMs: ms(cue.startSec),
		endMs: ms(cue.endSec)
	}));
}

/** Punchline text overlays riding the loudest peaks ("HA!", "BOOM!"...). */
export function punchlineOverlays(
	analysis: ClipAnalysis,
	intensity: MemeIntensity
): MemeTextOverlay[] {
	const words: Record<MemeIntensity, string[]> = {
		mild: ['HA!', 'hah'],
		funny: ['LOL!', 'HAHA!', 'WAIT FOR IT'],
		chaos: ['BONK!', 'LMAO!!', 'NO WAY', 'SEND IT']
	};
	return punchlinePeaks(analysis.peaks, 2).map((peak, i) => ({
		id: idFor('punch'),
		text: words[intensity][i % words[intensity].length],
		x: 0.5,
		y: 0.45,
		size: CAPTION_FONT_SIZE[intensity] * 1.2,
		color: intensity === 'chaos' ? '#facc15' : '#ffffff',
		font: 'impact',
		caps: true,
		stroke: true,
		bar: false,
		startMs: ms(peak.atSec),
		endMs: ms(peak.atSec) + PUNCHLINE_MS[intensity]
	}));
}

/** SFX cues on peaks - one per peak until the cap, cycling the vocabulary. */
export function peakCues(analysis: ClipAnalysis, intensity: MemeIntensity): MemeSfxCue[] {
	const vocab = PEAK_SFX[intensity];
	return punchlinePeaks(analysis.peaks, MAX_SUGGESTION_CUES).map((peak, i) => ({
		id: idFor('sfx'),
		sfx: vocab[i % vocab.length],
		atMs: ms(peak.atSec),
		gain: intensity === 'chaos' ? 1 : intensity === 'funny' ? 0.8 : 0.5
	}));
}

/** Face-anchored zoom windows (auto-zoom targets from the plan's Detect stage). */
export interface ZoomWindow {
	startMs: number;
	endMs: number;
	/** Zoom factor 1 = none. Mild keeps 1 (no zoom), chaos hits 2.5 ("ZOOM 250%"). */
	factor: number;
	cx: number;
	cy: number;
}

export function faceZooms(analysis: ClipAnalysis, intensity: MemeIntensity): ZoomWindow[] {
	if (intensity === 'mild') return [];
	const factor = intensity === 'chaos' ? 2.5 : 1.6;
	return analysis.faces.slice(0, 3).map((face: FaceAnchor) => ({
		startMs: ms(Math.max(0, face.atSec - 0.2)),
		endMs: ms(face.atSec + PUNCHLINE_MS[intensity] / 1000),
		factor,
		cx: face.box.x + face.box.width / 2,
		cy: face.box.y + face.box.height / 2
	}));
}

export interface MemeSuggestion {
	intensity: MemeIntensity;
	overlays: MemeTextOverlay[];
	sfxCues: MemeSfxCue[];
	zooms: ZoomWindow[];
}

/**
 * Build one editable suggestion per intensity from a single analysis.
 * Deterministic given the anchors (ids aside) so regenerating with the
 * same input yields the same edit surface.
 */
export function suggestTimelines(analysis: ClipAnalysis): MemeSuggestion[] {
	return MEME_INTENSITIES.map((intensity) => ({
		intensity,
		overlays: [...captionOverlays(analysis, intensity), ...punchlineOverlays(analysis, intensity)],
		sfxCues: peakCues(analysis, intensity),
		zooms: faceZooms(analysis, intensity)
	}));
}
