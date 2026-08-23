/**
 * Portable video output policy (plan PUB-009, §11.1).
 *
 * Plan mandate: "Do not hard-code codec policy inside UI; expose
 * `VideoOutputPolicy` config." This module is that config, plus the pure
 * decision logic every renderer (device MP4 today, server-assisted §11.2
 * later) must agree on BEFORE bytes are produced:
 *
 *   • rank containers/codecs by NIP-71 platform portability
 *   • pick the rendition (long-edge cap + even dimensions)
 *   • resolve the trim window against publish caps
 *   • decide whether a draft even needs a render pass
 *
 * The browser-side renderer lives in `video-cut.ts`; it CONSUMES this policy
 * and never invents its own codec rules.
 */

import { MAX_PUBLISH_SECONDS, type TrimRange, validateTrim } from '$lib/media/video-trim';

/** Ordered by how broadly NIP-71 clients can play the result. */
export const VIDEO_CONTAINER_CANDIDATES = [
	'video/mp4;codecs="avc1.42E01E,mp4a.40.2"', // H.264 Baseline + AAC-LC
	'video/mp4;codecs="avc1.4D401F,mp4a.40.2"', // H.264 Main + AAC-LC
	'video/mp4',
	'video/webm;codecs=vp9,opus',
	'video/webm;codecs=vp8,opus',
	'video/webm'
] as const;

export interface VideoOutputPolicy {
	/** Short-edge pixel cap for the rendition (720 => 720x1280 portrait). */
	maxLongEdge: number;
	/** Target encode bitrate for the video track. */
	videoBitsPerSecond: number;
	/** Canvas capture rate. 30 matches plan §11.1 "keyframe-friendly" seeking. */
	framesPerSecond: number;
	/** JPEG quality for the rendered cover frame. */
	coverQuality: number;
	/** Hard product cap — renders never exceed this (plan: initially 60s). */
	maxPublishSeconds: number;
}

/** Plan §11.1 V1: "one 720x1280 rendition first". */
export const DEFAULT_VIDEO_OUTPUT_POLICY: VideoOutputPolicy = {
	maxLongEdge: 720,
	videoBitsPerSecond: 5_000_000,
	framesPerSecond: 30,
	coverQuality: 0.85,
	maxPublishSeconds: MAX_PUBLISH_SECONDS
};

export interface RenditionPlan {
	/** Even-dimension export size (hardware encoders need even edges). */
	width: number;
	height: number;
	/** True when the source is upscaled to reach the cap. */
	upscaled: boolean;
}

/**
 * Rendition size for a source under a policy (even dims).
 *
 * Caps the SHORT edge: a 9:16 source renders as 720x1280 — the plan's
 * "one 720x1280 rendition" and the vertical-video convention where "720p"
 * names the width. Landscape sources come out as 1280x720.
 */
export function planRendition(
	source: { width: number; height: number },
	policy: VideoOutputPolicy = DEFAULT_VIDEO_OUTPUT_POLICY
): RenditionPlan {
	let { width, height } = source;
	if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
		return { width: 720, height: 1280, upscaled: true };
	}
	const shortest = Math.min(width, height);
	const cap = policy.maxLongEdge;
	const scale = cap > 0 && shortest > cap ? cap / shortest : 1;
	width = Math.round(width * scale);
	height = Math.round(height * scale);
	return {
		width: Math.max(2, width - (width % 2)),
		height: Math.max(2, height - (height % 2)),
		upscaled: scale > 1
	};
}

/**
 * Pick the most portable MIME type the platform can actually encode.
 * Returns '' when nothing is supported (caller decides fallback copy).
 */
export function pickOutputMimeType(
	isSupported: (type: string) => boolean,
	candidates: readonly string[] = VIDEO_CONTAINER_CANDIDATES
): string {
	for (const type of candidates) {
		if (isSupported(type)) return type;
	}
	return '';
}

export interface RenderDecision {
	/** Whether a render pass must run before publishing. */
	render: boolean;
	/** Reasons keyed for UI copy when `render` is false. */
	reason?: 'no-trim' | 'invalid-trim' | 'cannot-encode';
	/** The exact window a renderer must export. */
	trim: TrimRange;
	/** Duration the rendered artifact will have. */
	durationSeconds: number;
	/** Rendition size the renderer must produce. */
	rendition: RenditionPlan;
	/** Chosen container/codec the platform can encode ('' when none). */
	mimeType: string;
}

/**
 * Decide what the render pipeline must do with a probed draft:
 * full-length sources inside the publish cap and sized within the rendition
 * skip rendering entirely (pass-through publish, today's behavior).
 */
export function decideRender(
	input: {
		trim: TrimRange;
		sourceDurationSeconds?: number;
		width: number;
		height: number;
	},
	environment: {
		/** e.g. MediaRecorder.isTypeSupported bound to the platform. */
		isTypeSupported: (type: string) => boolean;
	},
	policy: VideoOutputPolicy = DEFAULT_VIDEO_OUTPUT_POLICY
): RenderDecision {
	const rendition = planRendition(input, policy);
	const mimeType = pickOutputMimeType(environment.isTypeSupported);
	const duration = Number.isFinite(input.sourceDurationSeconds)
		? Math.max(0, input.sourceDurationSeconds ?? 0)
		: 0;
	// No cut, within cap, no resize needed → pass-through (no encoder touched).
	const needsCut = trimCuts(input.trim, duration);
	const sourceFits =
		rendition.width === evenize(input.width) && rendition.height === evenize(input.height);
	const withinCap = duration <= policy.maxPublishSeconds;
	if (!needsCut && sourceFits && withinCap) {
		return {
			render: false,
			reason: 'no-trim',
			trim: input.trim,
			durationSeconds: duration,
			rendition,
			mimeType
		};
	}
	const validation = validateTrim(input.trim, { forPublish: true });
	if (!validation.valid) {
		return {
			render: false,
			reason: 'invalid-trim',
			trim: input.trim,
			durationSeconds: duration,
			rendition,
			mimeType
		};
	}
	if (!mimeType) {
		// A cut/resize is required but the platform encodes nothing portable.
		return {
			render: false,
			reason: 'cannot-encode',
			trim: input.trim,
			durationSeconds: validation.durationSeconds,
			rendition,
			mimeType: ''
		};
	}
	return {
		render: true,
		trim: input.trim,
		durationSeconds: validation.durationSeconds,
		rendition,
		mimeType
	};
}

function evenize(value: number) {
	return Math.max(2, value - (value % 2));
}

/** True when the window is not effectively the whole source. */
export function trimCuts(trim: TrimRange, sourceDurationSeconds: number): boolean {
	const duration = Number.isFinite(sourceDurationSeconds) ? sourceDurationSeconds : 0;
	if (duration <= 0) return false;
	return (
		trim.inSeconds > 0.05 ||
		trim.outSeconds < duration - 0.05 ||
		trim.outSeconds - trim.inSeconds < duration - 0.05
	);
}
