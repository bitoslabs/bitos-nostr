/**
 * Browser video renderer for the Bitz composer (plan PUB-009, §11.1).
 *
 * Implements the V1 device pipeline segment "select/record + edit timeline →
 * final MP4 + JPEG cover + metadata": replays the source between the draft
 * trim window while painting every frame onto a policy-sized canvas, records
 * the captured stream with MediaRecorder using the MIME chosen by
 * `VideoOutputPolicy` (portable MP4 when the platform can, WebM otherwise),
 * and captures the cover frame from the rendered pixels.
 *
 * The policy owns every codec/size decision — this file only executes.
 */
import {
	DEFAULT_VIDEO_OUTPUT_POLICY,
	type VideoOutputPolicy,
	decideRender
} from '$lib/media/video-output-policy';
import type { TrimRange } from '$lib/media/video-trim';

export interface VideoCutInput {
	/** The draft trim window to export. */
	trim: TrimRange;
	/** Source metadata from PUB-007 probe (stage video's natural size works). */
	width: number;
	height: number;
	/** Whole-file duration; undefined when the source streams unmeasured. */
	durationSeconds?: number;
}

export interface VideoCutProgress {
	/** 0-100 within the trim window; deterministic when duration is known. */
	percent: number;
	deterministic: boolean;
}

export interface VideoCutResult {
	/** Rendered video blob (MP4 when the platform supports it). */
	blob: Blob;
	/** Container MIME actually used (may be webm fallback). */
	mimeType: string;
	/** Exact duration of the render, in ms. */
	durationMs: number;
	/** Rendered size (policy rendition, even dims). */
	width: number;
	height: number;
	/** JPEG cover captured from the rendered first frame. */
	coverBlob: Blob | null;
	/** True when the platform encoded a portable MP4. */
	portable: boolean;
}

export type VideoCutEnvironment = {
	isTypeSupported: (type: string) => boolean;
};

/** Whether this browser can run the device render pipeline at all. */
export function canRenderVideoCut(): boolean {
	return (
		typeof MediaRecorder !== 'undefined' &&
		typeof HTMLCanvasElement !== 'undefined' &&
		typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
		decideRender(
			// Inputs are irrelevant — only the encoder probe matters here.
			{ trim: { inSeconds: 0, outSeconds: 1 }, width: 720, height: 1280 },
			browserEnvironment()
		).mimeType !== ''
	);
}

export function browserEnvironment(): VideoCutEnvironment {
	return {
		isTypeSupported: (type: string) =>
			typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)
	};
}

function drawFrame(
	ctx: CanvasRenderingContext2D,
	source: HTMLVideoElement,
	canvas: HTMLCanvasElement
) {
	// Contain-fit with black bars — never distort; rotation metadata is
	// already burned into videoWidth/videoHeight.
	const scale = Math.min(
		canvas.width / (source.videoWidth || canvas.width),
		canvas.height / (source.videoHeight || canvas.height)
	);
	const w = (source.videoWidth || canvas.width) * scale;
	const h = (source.videoHeight || canvas.height) * scale;
	ctx.fillStyle = '#000';
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.drawImage(source, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
	return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/**
 * Render the trim window to a portable video blob.
 *
 * Real-time by design (canvas capture), so a 60s bitz renders in ~60s; the
 * caller should surface `onProgress` and keep the stage responsive.
 */
export async function renderVideoCut(
	source: HTMLVideoElement,
	input: VideoCutInput,
	options: {
		policy?: VideoOutputPolicy;
		onProgress?: (progress: VideoCutProgress) => void;
		signal?: AbortSignal;
	} = {}
): Promise<VideoCutResult> {
	const policy = options.policy ?? DEFAULT_VIDEO_OUTPUT_POLICY;
	const decision = decideRender(input, browserEnvironment(), policy);
	if (decision.reason === 'invalid-trim') {
		throw new Error('The trim window is not usable — adjust the cut first');
	}
	if (decision.reason === 'cannot-encode' || !decision.mimeType) {
		throw new Error('This browser cannot render video — try Chrome or Edge');
	}
	const { trim } = decision;
	const canvas = document.createElement('canvas');
	canvas.width = decision.rendition.width;
	canvas.height = decision.rendition.height;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas is not available in this browser');

	const stream = canvas.captureStream(policy.framesPerSecond);
	// Carry source audio into the render when the element exposes it.
	const captureSource = (source as HTMLVideoElement & { captureStream?: () => MediaStream })
		.captureStream;
	if (captureSource) {
		try {
			for (const track of captureSource.call(source).getAudioTracks()) stream.addTrack(track);
		} catch {
			/* silent source — video-only render */
		}
	}

	const recorder = new MediaRecorder(stream, {
		mimeType: decision.mimeType,
		videoBitsPerSecond: policy.videoBitsPerSecond
	});
	const chunks: Blob[] = [];
	recorder.ondataavailable = (e) => {
		if (e.data.size) chunks.push(e.data);
	};
	const stopped = new Promise<void>((resolve, reject) => {
		recorder.onstop = () => resolve();
		recorder.onerror = () => reject(new Error('Rendering the video failed'));
	});

	// Park the source at the in-point before recording starts.
	const wasMuted = source.muted;
	source.muted = true;
	const restore = () => {
		source.muted = wasMuted;
	};
	const finish = async () => {
		source.pause();
		stream.getTracks().forEach((t) => t.stop());
	};
	const abort = () => {
		options.signal?.removeEventListener('abort', abort);
		void finish();
	};
	options.signal?.addEventListener('abort', abort);

	let startedAt = 0;
	let coverBlob: Blob | null = null;
	let coverCaptured = false;
	const paint = (now: number) => {
		if (options.signal?.aborted) return;
		if (!startedAt && source.currentTime >= trim.inSeconds - 0.02) {
			startedAt = now;
		}
		drawFrame(ctx, source, canvas);
		if (!coverCaptured && startedAt) {
			coverCaptured = true;
			void canvasToBlob(canvas, policy.coverQuality).then((b) => {
				coverBlob = b;
			});
		}
		const span = Math.max(0.01, trim.outSeconds - trim.inSeconds);
		if (startedAt && options.onProgress) {
			options.onProgress({
				percent: Math.min(99, ((now - startedAt) / 1000 / span) * 100),
				deterministic: true
			});
		}
		if (source.ended || source.currentTime >= trim.outSeconds - 0.02) {
			void finish();
			return;
		}
		requestAnimationFrame(paint);
	};

	source.currentTime = trim.inSeconds;
	try {
		await source.play().catch(() => {
			throw new Error('Could not play the source for rendering');
		});
	} catch (e) {
		restore();
		void finish();
		throw e;
	}
	recorder.start(250);
	requestAnimationFrame(paint);
	await new Promise<void>((resolve) => {
		const done = () => resolve();
		const poll = () => {
			if (options.signal?.aborted || source.ended || source.paused) {
				done();
				return;
			}
			if (source.currentTime >= trim.outSeconds - 0.02) {
				done();
				return;
			}
			setTimeout(poll, 100);
		};
		poll();
	});
	if (recorder.state !== 'inactive') recorder.stop();
	await stopped;
	restore();
	if (options.signal?.aborted) throw new Error('Render cancelled');
	const blob = new Blob(chunks, { type: decision.mimeType.split(';')[0] });
	if (!blob.size) throw new Error('The render produced an empty video');
	if (options.onProgress) options.onProgress({ percent: 100, deterministic: true });
	return {
		blob,
		mimeType: decision.mimeType.split(';')[0],
		durationMs: Math.round((trim.outSeconds - trim.inSeconds) * 1000),
		width: decision.rendition.width,
		height: decision.rendition.height,
		coverBlob,
		portable: decision.mimeType.startsWith('video/mp4')
	};
}
