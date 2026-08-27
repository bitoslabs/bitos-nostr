import { describe, expect, it } from 'vitest';
import type { ClipAnalysis } from './extract';
import {
	resolveTriggers,
	resolveSmartTemplate,
	recommendSmartTemplates,
	SMART_TEMPLATES
} from './smart-templates';

/** 10s clip: loud punchline at 4s (rms .8), quieter at 7s, silence right before 4s, one stable face, speech ending at 8.5s. */
function analysis(): ClipAnalysis {
	return {
		durationSec: 10,
		silence: [{ startSec: 3.2, endSec: 3.8 }],
		peaks: [
			{ atSec: 4, rms: 0.8 },
			{ atSec: 7, rms: 0.4 },
			{ atSec: 1, rms: 0.5 }
		],
		speechSegments: [{ startSec: 0.5, endSec: 8.5 }],
		captions: [],
		faces: [{ atSec: 4.1, box: { x: 0.3, y: 0.2, width: 0.25, height: 0.3 }, observations: 4 }]
	};
}

describe('resolveTriggers', () => {
	it('always emits clip-start and clip-end at the clip bounds', () => {
		const points = resolveTriggers(analysis());
		const kinds = new Set(points.map((p) => p.trigger));
		expect(kinds.has('clip-start')).toBe(true);
		expect(kinds.has('clip-end')).toBe(true);
		expect(points.find((p) => p.trigger === 'clip-start')?.atMs).toBe(0);
		expect(points.find((p) => p.trigger === 'clip-end')?.atMs).toBe(10000);
	});

	it('marks the loudest peaks as punchlines with relative strengths', () => {
		const punchlines = resolveTriggers(analysis()).filter((p) => p.trigger === 'punchline');
		expect(punchlines.length).toBe(3);
		const sorted = [...punchlines].sort((a, b) => b.strength - a.strength);
		expect(sorted[0].atMs).toBe(4000); // rms .8 is loudest
		expect(sorted[0].strength).toBeCloseTo(1, 5);
		expect(sorted.find((p) => p.atMs === 7000)?.strength).toBeCloseTo(0.5, 5);
	});

	it('detects silence immediately before a punchline', () => {
		const beat = resolveTriggers(analysis()).find((p) => p.trigger === 'silence-before-punchline');
		expect(beat).toBeDefined();
		expect(beat?.atMs).toBe(3800); // silence ends at 3.8s, 200ms before the 4s peak
	});

	it('emits face-surprised scaled by observations and speech-end at the last segment', () => {
		const points = resolveTriggers(analysis());
		expect(points.find((p) => p.trigger === 'face-surprised')?.strength).toBeCloseTo(0.8, 5); // 0.4 + 4/10
		expect(points.find((p) => p.trigger === 'speech-end')?.atMs).toBe(8500);
	});

	it('returns nothing for a zero-length clip', () => {
		expect(
			resolveTriggers({
				durationSec: 0,
				silence: [],
				peaks: [],
				speechSegments: [],
				captions: [],
				faces: []
			})
		).toEqual([]);
	});
});

describe('resolveSmartTemplate', () => {
	it('scales zoom factor by trigger strength below the configured max', () => {
		const tpl = SMART_TEMPLATES.find((t) => t.id === 'smart-punchline-zoom')!;
		const res = resolveSmartTemplate(tpl, analysis());
		expect(res.matchScore).toBe(1); // only needs punchline
		expect(res.zoomWindows.length).toBe(3); // one per punchline (capped 3)
		for (const w of res.zoomWindows) {
			expect(w.factor).toBeLessThanOrEqual(1.8);
			expect(w.factor).toBeGreaterThanOrEqual(1); // 1 + (0.8)*(0.7..1.0)
		}
		// loudest punchline gets the strongest zoom
		const strongest = [...res.zoomWindows].sort((a, b) => b.factor - a.factor)[0];
		expect(strongest.factor).toBeCloseTo(1.8, 5);
	});

	it('gives sticker layers their figure default motion and a bounded hold', () => {
		const tpl = SMART_TEMPLATES.find((t) => t.id === 'smart-reaction-cam')!;
		const res = resolveSmartTemplate(tpl, analysis());
		expect(res.matchScore).toBe(1);
		expect(res.imageLayers.length).toBeGreaterThanOrEqual(1);
		for (const layer of res.imageLayers) {
			expect(layer.motionId).toBe('pop'); // shock figure default
			expect((layer.endMs ?? 0) - (layer.startMs ?? 0)).toBe(1600); // STICKER_HOLD_MS
			expect(layer.src).toContain('/bitz-buddy/');
		}
	});

	it('cues land with the action offset applied', () => {
		const tpl = SMART_TEMPLATES.find((t) => t.id === 'smart-news-drop')!;
		const res = resolveSmartTemplate(tpl, analysis());
		expect(res.overlays[0]?.text).toBe('BREAKING');
		expect(res.overlays[0]?.startMs).toBe(8800); // clip-end 10000 - 1200
		expect(res.sfxCues[0]?.atMs).toBe(8800);
	});

	it('clamps negative offsets to zero', () => {
		const short: ClipAnalysis = {
			durationSec: 0.5,
			silence: [],
			peaks: [{ atSec: 0.05, rms: 0.9 }],
			speechSegments: [],
			captions: [],
			faces: []
		};
		const tpl = SMART_TEMPLATES.find((t) => t.id === 'smart-news-drop')!;
		const res = resolveSmartTemplate(tpl, short);
		expect(res.overlays[0]?.startMs).toBe(0); // 500 - 1200 → 0
	});

	it('scores zero and produces no tracks when no triggers match', () => {
		const tpl = SMART_TEMPLATES.find((t) => t.id === 'smart-freeze-beat')!;
		const bare: ClipAnalysis = {
			durationSec: 5,
			silence: [],
			peaks: [],
			speechSegments: [],
			captions: [],
			faces: []
		};
		const res = resolveSmartTemplate(tpl, bare);
		expect(res.matchScore).toBe(0);
		expect(res.overlays.length + res.sfxCues.length + res.imageLayers.length).toBe(0);
	});
});

describe('recommendSmartTemplates', () => {
	it('returns ranked matches with scores above zero', () => {
		const recs = recommendSmartTemplates(analysis());
		expect(recs.length).toBeGreaterThan(0);
		expect(recs.length).toBeLessThanOrEqual(3);
		for (let i = 1; i < recs.length; i++) {
			expect(recs[i - 1].matchScore).toBeGreaterThanOrEqual(recs[i].matchScore);
		}
	});

	it('drops triggerless templates entirely', () => {
		const bare: ClipAnalysis = {
			durationSec: 5,
			silence: [],
			peaks: [],
			speechSegments: [],
			captions: [],
			faces: []
		};
		// only clip-bound templates survive; punchline/silence/face ones must be gone
		const ids = recommendSmartTemplates(bare).map((r) => r.templateId);
		expect(ids).not.toContain('smart-punchline-zoom');
		expect(ids).toContain('smart-news-drop'); // rides on clip-end, always present
	});
});
