/**
 * AI Smart Templates (spec tp-2.md “AI Smart Template” p.558 + “Auto Meme
 * Engine V2” p.602).
 *
 * A smart template is NOT fixed timings (“zoom at 2.3s”) — it is a bag of
 * TRIGGER RULES that resolve against a clip's `ClipAnalysis` anchors
 * (peaks / silence / speech / captions / faces):
 *
 *   WHEN punchline            → zoom + boom
 *   WHEN silence-before-gag   → freeze-frame beat
 *   WHEN face-surprised       → spotlight + big sticker
 *
 * Rules resolve per-clip, so the SAME template fits a 5s clip and a 20s
 * one. Output is ordinary editor objects (overlays/cues/zoom/fx/windows +
 * sticker layers) — a suggestion the studio applies like any template,
 * never a direct-to-wire payload.
 *
 * Auto Meme recommendations: each template self-scores its trigger support
 * (0–1) against the analysis, so the studio can surface “Production Bug —
 * 94% match” style cards. Pure functions, node-testable.
 */

import type { ClipAnalysis, EnergyPeak } from './extract';
import type { MemeSfxCue, MemeSfxId, MemeTextOverlay } from '$lib/meme/schema';
import type { FrameFxWindow } from '$lib/meme/fx-track';
import type { ZoomWindow } from './suggest';
import type { SpeedWindow } from '$lib/meme/speed-track';
import type { MemeImageOverlay } from '$lib/meme/image-overlay';
import { makeImageOverlay } from '$lib/meme/image-overlay';
import { buddyFigure } from '$lib/meme/bitz-buddy';
import { bitzverseProp } from '$lib/meme/bitzverse';

/** Trigger vocabulary resolvable from ClipAnalysis anchors. */
export const SMART_TRIGGERS = [
	'punchline',
	'silence-before-punchline',
	'face-surprised',
	'speech-end',
	'clip-start',
	'clip-end'
] as const;
export type SmartTrigger = (typeof SMART_TRIGGERS)[number];

/** One resolved moment a rule can hang tracks off. */
export interface TriggerPoint {
	trigger: SmartTrigger;
	atMs: number;
	/** Confidence 0–1 (peak loudness, face stability…). */
	strength: number;
}

/** A track row: what to place (+offset/duration) when a trigger fires. */
export interface SmartAction {
	effect?:
		| { kind: 'overlay'; text: string; size?: number; y?: number; color?: string; bar?: boolean }
		| { kind: 'cue'; sfx: MemeSfxId; gain?: number }
		| { kind: 'zoom'; factor: number; durationMs?: number }
		| { kind: 'fx'; fx: FrameFxWindow['fx']; intensity?: number; durationMs?: number }
		| { kind: 'speed'; rate: number; durationMs?: number }
		| { kind: 'sticker'; id: string; size?: number; x?: number; y?: number };
	trigger: SmartTrigger;
	/** Shift after the trigger point (ms; negative allowed for pre-roll). */
	offsetMs?: number;
}

export interface SmartTemplate {
	id: string;
	label: string;
	hint: string;
	icon: string;
	actions: SmartAction[];
}

/** Fully-resolved output — the same shape studio templates produce. */
export interface SmartResolution {
	templateId: string;
	matchScore: number;
	overlays: MemeTextOverlay[];
	sfxCues: MemeSfxCue[];
	zoomWindows: ZoomWindow[];
	fxWindows: FrameFxWindow[];
	speedWindows: SpeedWindow[];
	imageLayers: MemeImageOverlay[];
}

const ms = (sec: number) => Math.max(0, Math.round(sec * 1000));
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Duration defaults per effect kind (ms). */
type EffectKind = NonNullable<SmartAction['effect']>['kind'];
const DEFAULT_DURATION: Partial<Record<EffectKind, number>> = {
	zoom: 900,
	fx: 700,
	speed: 1000
};
const durationFor = (kind: EffectKind, custom?: number): number =>
	custom ?? DEFAULT_DURATION[kind] ?? 800;
const STICKER_HOLD_MS = 1600;

let seq = 0;
const idFor = (p: string) => `sm-${p}-${(seq++).toString(36)}`;

/** Loudest peaks, chronological — the punchline candidates. */
function punchlinePeaks(peaks: EnergyPeak[], count: number): EnergyPeak[] {
	return [...peaks]
		.sort((a, b) => b.rms - a.rms)
		.slice(0, count)
		.sort((a, b) => a.atSec - b.atSec);
}

/** Normalize peak strength against the clip's own loudest moment. */
function peakStrength(peak: EnergyPeak, loudest: number): number {
	return loudest > 0 ? clamp01(peak.rms / loudest) : 0.5;
}

/**
 * Resolve every trigger in the vocabulary against one clip. Deterministic:
 * same analysis → same points (ids aside).
 */
export function resolveTriggers(analysis: ClipAnalysis): TriggerPoint[] {
	const points: TriggerPoint[] = [];
	const durMs = ms(analysis.durationSec);
	if (durMs <= 0) return points;

	points.push({ trigger: 'clip-start', atMs: 0, strength: 1 });
	points.push({ trigger: 'clip-end', atMs: durMs, strength: 1 });

	const loudest = analysis.peaks.reduce((m, p) => Math.max(m, p.rms), 0);
	for (const peak of punchlinePeaks(analysis.peaks, 3)) {
		points.push({
			trigger: 'punchline',
			atMs: ms(peak.atSec),
			strength: peakStrength(peak, loudest)
		});
		// silence immediately BEFORE a loud peak = comedic beat.
		const before = analysis.silence.find(
			(s) => ms(s.endSec) <= ms(peak.atSec) && ms(peak.atSec) - ms(s.endSec) < 600
		);
		if (before)
			points.push({ trigger: 'silence-before-punchline', atMs: ms(before.endSec), strength: 0.8 });
	}

	// Most stable face = reaction-cam candidate.
	const face = [...analysis.faces].sort((a, b) => b.observations - a.observations)[0];
	if (face) {
		points.push({
			trigger: 'face-surprised',
			atMs: ms(face.atSec),
			strength: clamp01(0.4 + face.observations / 10)
		});
	}

	const lastSpeech = analysis.speechSegments[analysis.speechSegments.length - 1];
	if (lastSpeech) {
		points.push({ trigger: 'speech-end', atMs: ms(lastSpeech.endSec), strength: 0.7 });
	}

	return points.sort((a, b) => a.atMs - b.atMs);
}

/**
 * Resolve a template's actions into concrete tracks against the triggers.
 * Every action hangs off EVERY matching trigger point (capped), each scaled
 * by the point's strength — a 20s clip with three punchlines gets three
 * gags, a 5s clip one.
 */
export function resolveSmartTemplate(
	template: SmartTemplate,
	analysis: ClipAnalysis
): SmartResolution {
	const triggers = resolveTriggers(analysis);
	const out: SmartResolution = {
		templateId: template.id,
		matchScore: 0,
		overlays: [],
		sfxCues: [],
		zoomWindows: [],
		fxWindows: [],
		speedWindows: [],
		imageLayers: []
	};
	const neededTriggers = new Set(template.actions.map((a) => a.trigger));
	let support = 0;
	for (const trigger of neededTriggers) {
		const hits = triggers.filter((t) => t.trigger === trigger);
		if (hits.length) support += 1;
	}
	out.matchScore = neededTriggers.size ? support / neededTriggers.size : 0;

	for (const action of template.actions) {
		const hits = triggers.filter((t) => t.trigger === action.trigger).slice(0, 3);
		for (const point of hits) {
			const at = Math.max(0, point.atMs + (action.offsetMs ?? 0));
			const eff = action.effect;
			if (!eff) continue;
			if (eff.kind === 'overlay') {
				out.overlays.push({
					id: idFor('ov'),
					text: eff.text,
					x: 0.5,
					y: eff.y ?? 0.84,
					size: (eff.size ?? 0.07) * (0.7 + 0.3 * point.strength),
					color: eff.color ?? '#ffffff',
					font: 'impact',
					caps: true,
					stroke: true,
					bar: eff.bar ?? false,
					startMs: at,
					endMs: at + STICKER_HOLD_MS
				});
			} else if (eff.kind === 'cue') {
				out.sfxCues.push({
					id: idFor('cue'),
					sfx: eff.sfx,
					atMs: at,
					gain: Math.min(1, (eff.gain ?? 0.9) * (0.6 + 0.4 * point.strength))
				});
			} else if (eff.kind === 'zoom') {
				const dur = durationFor(eff.kind, eff.durationMs);
				out.zoomWindows.push({
					startMs: at,
					endMs: at + dur,
					factor: 1 + (eff.factor - 1) * (0.7 + 0.3 * point.strength),
					cx: 0.5,
					cy: 0.45
				});
			} else if (eff.kind === 'fx') {
				const dur = durationFor(eff.kind, eff.durationMs);
				out.fxWindows.push({
					startMs: at,
					endMs: at + dur,
					fx: eff.fx,
					intensity: clamp01((eff.intensity ?? 0.7) * (0.6 + 0.4 * point.strength))
				});
			} else if (eff.kind === 'speed') {
				const dur = durationFor(eff.kind, eff.durationMs);
				out.speedWindows.push({ startMs: at, endMs: at + dur, rate: eff.rate });
			} else if (eff.kind === 'sticker') {
				const figure = buddyFigure(eff.id) ?? bitzverseProp(eff.id);
				const layer = makeImageOverlay(figure?.src ?? '/bitz-buddy/buddy.svg', 1);
				if (layer) {
					if (figure && figure.motion !== 'none') layer.motionId = figure.motion;
					layer.x = eff.x ?? 0.74;
					layer.y = eff.y ?? 0.74;
					layer.size = eff.size ?? 0.36;
					layer.startMs = at;
					layer.endMs = at + STICKER_HOLD_MS;
					out.imageLayers.push(layer);
				}
			}
		}
	}
	return out;
}

/** The built-in smart template catalog (spec examples + the studio packs). */
export const SMART_TEMPLATES: readonly SmartTemplate[] = [
	{
		id: 'smart-punchline-zoom',
		label: 'Punchline zoom',
		hint: 'WHEN punchline → zoom + boom',
		icon: 'i-lucide-crosshair',
		actions: [
			{ effect: { kind: 'zoom', factor: 1.8 }, trigger: 'punchline', offsetMs: -150 },
			{ effect: { kind: 'cue', sfx: 'boom' }, trigger: 'punchline' },
			{ effect: { kind: 'fx', fx: 'flash', intensity: 0.6, durationMs: 300 }, trigger: 'punchline' }
		]
	},
	{
		id: 'smart-freeze-beat',
		label: 'Silence beat',
		hint: 'WHEN silence-before-punchline → freeze feel',
		icon: 'i-lucide-pause',
		actions: [
			{
				effect: { kind: 'speed', rate: 0.5, durationMs: 500 },
				trigger: 'silence-before-punchline'
			},
			{
				effect: { kind: 'fx', fx: 'vignette', intensity: 0.5, durationMs: 500 },
				trigger: 'silence-before-punchline'
			},
			{ effect: { kind: 'cue', sfx: 'pop' }, trigger: 'punchline' }
		]
	},
	{
		id: 'smart-reaction-cam',
		label: 'Reaction cam',
		hint: 'WHEN face-surprised → spotlight + buddy',
		icon: 'i-lucide-smile',
		actions: [
			{ effect: { kind: 'fx', fx: 'spotlight', intensity: 0.6 }, trigger: 'face-surprised' },
			{
				effect: { kind: 'sticker', id: 'shock', size: 0.34, x: 0.76, y: 0.72 },
				trigger: 'face-surprised'
			},
			{ effect: { kind: 'cue', sfx: 'gasp' }, trigger: 'face-surprised', offsetMs: -100 }
		]
	},
	{
		id: 'smart-news-drop',
		label: 'News drop',
		hint: 'Clip end → breaking caption + slam',
		icon: 'i-lucide-newspaper',
		actions: [
			{
				effect: { kind: 'overlay', text: 'BREAKING', y: 0.86, bar: true, color: '#ef4444' },
				trigger: 'clip-end',
				offsetMs: -1200
			},
			{ effect: { kind: 'cue', sfx: 'slam' }, trigger: 'clip-end', offsetMs: -1200 },
			{
				effect: { kind: 'zoom', factor: 1.4, durationMs: 1200 },
				trigger: 'clip-end',
				offsetMs: -1200
			}
		]
	}
];

/** Rank smart templates for an analysis — Auto Meme's “94% match” cards. */
export function recommendSmartTemplates(analysis: ClipAnalysis, limit = 3): SmartResolution[] {
	return SMART_TEMPLATES.map((t) => resolveSmartTemplate(t, analysis))
		.filter((r) => r.matchScore > 0)
		.sort((a, b) => b.matchScore - a.matchScore)
		.slice(0, Math.max(1, limit));
}
