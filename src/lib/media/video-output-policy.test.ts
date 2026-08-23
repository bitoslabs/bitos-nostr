import { describe, expect, it } from 'vitest';
import {
	DEFAULT_VIDEO_OUTPUT_POLICY,
	VIDEO_CONTAINER_CANDIDATES,
	decideRender,
	pickOutputMimeType,
	planRendition,
	trimCuts
} from '$lib/media/video-output-policy';

const supportsMp4 = (type: string) => type.startsWith('video/mp4');
const supportsNothing = () => false;
const supportsEverything = () => true;

describe('VIDEO_CONTAINER_CANDIDATES', () => {
	it('lists portable MP4 H.264/AAC profiles first', () => {
		expect(VIDEO_CONTAINER_CANDIDATES[0]).toContain('avc1');
		expect(VIDEO_CONTAINER_CANDIDATES[0]).toContain('mp4a.40.2');
		expect(VIDEO_CONTAINER_CANDIDATES[2]).toBe('video/mp4');
	});

	it('falls back to WebM variants after MP4', () => {
		const mp4Count = VIDEO_CONTAINER_CANDIDATES.filter((c) => c.startsWith('video/mp4')).length;
		expect(VIDEO_CONTAINER_CANDIDATES[mp4Count]).toBe('video/webm;codecs=vp9,opus');
	});
});

describe('planRendition', () => {
	it('caps the long edge at 720 (portrait 9:16)', () => {
		expect(planRendition({ width: 1080, height: 1920 })).toEqual({
			width: 720,
			height: 1280,
			upscaled: false
		});
	});

	it('caps landscape sources too', () => {
		const plan = planRendition({ width: 3840, height: 2160 });
		expect(plan).toEqual({ width: 1280, height: 720, upscaled: false });
	});

	it('keeps small sources at their natural size (no upscale)', () => {
		const plan = planRendition({ width: 480, height: 640 });
		expect(plan.width).toBe(480);
		expect(plan.height).toBe(640);
		expect(plan.upscaled).toBe(false);
	});

	it('forces even dimensions', () => {
		const plan = planRendition({ width: 481, height: 641 });
		expect(plan.width % 2).toBe(0);
		expect(plan.height % 2).toBe(0);
	});

	it('recovers from garbage dimensions with the 720p default', () => {
		expect(planRendition({ width: 0, height: 0 })).toEqual({
			width: 720,
			height: 1280,
			upscaled: true
		});
		expect(planRendition({ width: NaN, height: 1920 }).width).toBe(720);
	});

	it('honors a custom policy cap', () => {
		const plan = planRendition(
			{ width: 1080, height: 1920 },
			{ ...DEFAULT_VIDEO_OUTPUT_POLICY, maxLongEdge: 1080 }
		);
		expect(plan).toEqual({ width: 1080, height: 1920, upscaled: false });
	});
});

describe('pickOutputMimeType', () => {
	it('returns the first supported candidate', () => {
		expect(pickOutputMimeType(supportsMp4)).toBe(VIDEO_CONTAINER_CANDIDATES[0]);
	});

	it('skips unsupported candidates in order', () => {
		expect(pickOutputMimeType((t) => t === 'video/webm')).toBe('video/webm');
	});

	it('returns empty string when nothing encodes', () => {
		expect(pickOutputMimeType(supportsNothing)).toBe('');
	});

	it('returns empty string with no candidates', () => {
		expect(pickOutputMimeType(supportsEverything, [])).toBe('');
	});
});

describe('trimCuts', () => {
	it('is false for a full-length window', () => {
		expect(trimCuts({ inSeconds: 0, outSeconds: 30 }, 30)).toBe(false);
		expect(trimCuts({ inSeconds: 0, outSeconds: 60 }, 60.004)).toBe(false);
	});

	it('is true when the in-point moves', () => {
		expect(trimCuts({ inSeconds: 5, outSeconds: 30 }, 30)).toBe(true);
	});

	it('is true when the out-point moves', () => {
		expect(trimCuts({ inSeconds: 0, outSeconds: 20 }, 30)).toBe(true);
	});

	it('is false for unknown durations', () => {
		expect(trimCuts({ inSeconds: 5, outSeconds: 20 }, Number.NaN)).toBe(false);
	});
});

describe('decideRender', () => {
	const base = {
		trim: { inSeconds: 0, outSeconds: 30 },
		sourceDurationSeconds: 30,
		width: 720,
		height: 1280
	};

	it('passes through a fitting full-length source (no render)', () => {
		const decision = decideRender(base, { isTypeSupported: supportsMp4 });
		expect(decision.render).toBe(false);
		expect(decision.reason).toBe('no-trim');
		expect(decision.mimeType).toContain('video/mp4');
	});

	it('requires a render when the trim cuts the source', () => {
		const decision = decideRender(
			{ ...base, trim: { inSeconds: 5, outSeconds: 20 } },
			{ isTypeSupported: supportsMp4 }
		);
		expect(decision.render).toBe(true);
		expect(decision.durationSeconds).toBe(15);
	});

	it('requires a render when the source needs downscaling', () => {
		const decision = decideRender(
			{ ...base, width: 1080, height: 1920 },
			{ isTypeSupported: supportsMp4 }
		);
		expect(decision.render).toBe(true);
		expect(decision.rendition).toEqual({ width: 720, height: 1280, upscaled: false });
	});

	it('refuses invalid trim windows before encoding', () => {
		const decision = decideRender(
			{ ...base, trim: { inSeconds: 10, outSeconds: 10.5 } },
			{ isTypeSupported: supportsMp4 }
		);
		expect(decision.render).toBe(false);
		expect(decision.reason).toBe('invalid-trim');
	});

	it('refuses cuts the platform cannot encode', () => {
		const decision = decideRender(
			{ ...base, trim: { inSeconds: 5, outSeconds: 20 } },
			{ isTypeSupported: supportsNothing }
		);
		expect(decision.render).toBe(false);
		expect(decision.reason).toBe('cannot-encode');
		expect(decision.mimeType).toBe('');
	});

	it('refuses over-cap full-length windows instead of rendering them', () => {
		const decision = decideRender(
			{ ...base, sourceDurationSeconds: 90, trim: { inSeconds: 0, outSeconds: 90 } },
			{ isTypeSupported: supportsMp4 }
		);
		// A full 90s window exceeds the 60s cap → rejected before any encode;
		// the composer's PUB-008 defaultTrim would have pre-capped it to 0–60.
		expect(decision.render).toBe(false);
		expect(decision.reason).toBe('invalid-trim');
	});

	it('accepts a capped full-length window within policy', () => {
		const decision = decideRender(
			{ ...base, sourceDurationSeconds: 90, trim: { inSeconds: 0, outSeconds: 60 } },
			{ isTypeSupported: supportsMp4 }
		);
		expect(decision.render).toBe(true);
		expect(decision.durationSeconds).toBe(60);
	});
});
