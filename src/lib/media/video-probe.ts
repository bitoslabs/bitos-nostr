/**
 * Client-side video/image probe (plan PUB-007).
 *
 * V1 probes metadata the way the renderer will consume it: a detached
 * `<video>`/`<img>` element decodes just enough of the blob to report
 * dimensions/duration. That intentionally doubles as a *playability* check —
 * a file whose tracks the browser cannot decode surfaces here as a probe
 * error instead of failing later inside the published reel.
 *
 * Probe limits enforce plan §11-style security caps BEFORE any bytes leave
 * the device: size, duration, and megapixel ceiling (decompression-bomb
 * guard). The limit set is data, not policy-in-code — callers may tighten it.
 */
import type { BitzMediaConstraints } from '$lib/nostr/bitz-codec';

export interface VideoProbeOk {
	ok: true;
	kind: 'video' | 'image';
	width: number;
	height: number;
	duration?: number;
}

export interface VideoProbeErr {
	ok: false;
	/** Machine-readable reason; map to UI copy at the call site. */
	reason:
		| 'unsupported-type'
		| 'probe-failed'
		| 'too-large'
		| 'too-long'
		| 'too-many-megapixels'
		| 'no-tracks';
	/** Human-readable detail for logs/toasts. */
	detail?: string;
}

export type VideoProbeResult = VideoProbeOk | VideoProbeErr;

/** Limits are plain data so product can tune them without code archaeon. */
export interface ProbeLimits {
	/** Hard byte cap before any upload attempt. */
	maxBytes: number;
	/** Hard duration cap in seconds (product limit, initially 60). */
	maxDurationSeconds: number;
	/** Megapixel ceiling for images/frames (decompression-bomb guard). */
	maxMegapixels: number;
}

/** Plan §11 V1 defaults. */
export const DEFAULT_PROBE_LIMITS: ProbeLimits = {
	maxBytes: 200 * 1024 * 1024,
	maxDurationSeconds: 60,
	maxMegapixels: 50
};

const PROBE_TIMEOUT_MS = 10_000;

function classifyFile(file: File): 'video' | 'image' | null {
	const type = file.type;
	if (type.startsWith('video/')) return 'video';
	if (type.startsWith('image/')) return 'image';
	// Some pickers hand back an empty MIME with a video-ish extension.
	if (!type && /\.(mp4|webm|mov|m4v)$/i.test(file.name)) return 'video';
	if (!type && /\.(apng|avif|gif|jpe?g|png|webp)$/i.test(file.name)) return 'image';
	return null;
}

function probeImage(file: File): Promise<VideoProbeOk | VideoProbeErr> {
	return new Promise((resolve) => {
		const url = URL.createObjectURL(file);
		const img = new Image();
		const done = (result: VideoProbeOk | VideoProbeErr) => {
			URL.revokeObjectURL(url);
			clearTimeout(timer);
			resolve(result);
		};
		const timer = setTimeout(
			() => done({ ok: false, reason: 'probe-failed', detail: 'image decode timed out' }),
			PROBE_TIMEOUT_MS
		);
		img.onload = () => {
			if (!img.naturalWidth || !img.naturalHeight) {
				done({ ok: false, reason: 'no-tracks', detail: 'image has no pixel size' });
				return;
			}
			done({
				ok: true,
				kind: 'image',
				width: img.naturalWidth,
				height: img.naturalHeight
			});
		};
		img.onerror = () => done({ ok: false, reason: 'probe-failed', detail: 'image decode failed' });
		img.src = url;
	});
}

function probeVideo(file: File): Promise<VideoProbeOk | VideoProbeErr> {
	return new Promise((resolve) => {
		const url = URL.createObjectURL(file);
		const video = document.createElement('video');
		// Preload metadata only — we never want to buffer the whole file.
		video.preload = 'metadata';
		video.muted = true;
		const done = (result: VideoProbeOk | VideoProbeErr) => {
			URL.revokeObjectURL(url);
			clearTimeout(timer);
			resolve(result);
		};
		const timer = setTimeout(
			() => done({ ok: false, reason: 'probe-failed', detail: 'metadata load timed out' }),
			PROBE_TIMEOUT_MS
		);
		video.onloadedmetadata = () => {
			if (!video.videoWidth || !video.videoHeight) {
				done({ ok: false, reason: 'no-tracks', detail: 'video has no visual track' });
				return;
			}
			// Chrome reports Infinity for streamed files until seekable; treat
			// non-finite duration as unknown rather than rejecting outright.
			const duration = Number.isFinite(video.duration) ? video.duration : undefined;
			done({
				ok: true,
				kind: 'video',
				width: video.videoWidth,
				height: video.videoHeight,
				duration
			});
		};
		video.onerror = () => done({ ok: false, reason: 'probe-failed', detail: 'cannot decode' });
		video.src = url;
	});
}

export function probeMediaLimits(
	meta: { width: number; height: number; duration?: number },
	limits: ProbeLimits = DEFAULT_PROBE_LIMITS
): VideoProbeErr | null {
	if ((meta.width * meta.height) / 1_000_000 > limits.maxMegapixels) {
		return {
			ok: false,
			reason: 'too-many-megapixels',
			detail: `${meta.width}×${meta.height} exceeds the ${limits.maxMegapixels} MP cap`
		};
	}
	if (meta.duration !== undefined) {
		if (meta.duration > limits.maxDurationSeconds) {
			return {
				ok: false,
				reason: 'too-long',
				detail: `${meta.duration.toFixed(1)}s exceeds the ${limits.maxDurationSeconds}s limit`
			};
		}
		if (meta.duration <= 0) {
			return { ok: false, reason: 'no-tracks', detail: 'duration not positive' };
		}
	}
	return null;
}

/**
 * Probe one picked file and enforce the limit set. `file.size` is checked
 * before any decoding starts, `duration`/megapixels after metadata lands.
 */
export async function probeMedia(
	file: File,
	limits: ProbeLimits = DEFAULT_PROBE_LIMITS
): Promise<VideoProbeResult> {
	if (file.size > limits.maxBytes) {
		return {
			ok: false,
			reason: 'too-large',
			detail: `${file.size} bytes exceeds ${limits.maxBytes}`
		};
	}
	const kind = classifyFile(file);
	if (!kind) return { ok: false, reason: 'unsupported-type', detail: file.type || file.name };
	const probed = kind === 'video' ? await probeVideo(file) : await probeImage(file);
	if (!probed.ok) return probed;
	const violation = probeMediaLimits(probed, limits);
	return violation ?? probed;
}

/** Convert probe output to the `dim`/`duration` inputs postBitz expects. */
export function probeToImetaInputs(probe: VideoProbeOk): {
	dim: string;
	duration?: number;
} {
	return {
		dim: `${probe.width}x${probe.height}`,
		duration: probe.kind === 'video' ? probe.duration : undefined
	};
}

/** Re-export so callers can pair the probe with the §6.4 signing gate. */
export type { BitzMediaConstraints };
