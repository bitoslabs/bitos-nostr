import type { MemeSfxCue } from '$lib/meme/schema';

/**
 * Export/publish support — the pure pieces of the studio's export pipeline
 * that used to live inline in MemeStudio: shared recorder plumbing that the
 * GIF and sound-meme recorders duplicated verbatim, error translation, and
 * the small derived values (cue shifting, imeta duration) the publish path
 * recomputes from project state.
 */

/** MediaRecorder codec pick — the first container/codec the browser supports.
 *  Shared by every recorder-based export path (GIF loop, sound meme). */
export function pickRecorderMime(): string {
	for (const type of [
		'video/webm;codecs=vp9,opus',
		'video/webm;codecs=vp8,opus',
		'video/webm',
		'video/mp4'
	]) {
		if (MediaRecorder.isTypeSupported(type)) return type;
	}
	return '';
}

/** Tainted-canvas SecurityErrors read like alphabet soup ("The canvas has
 *  been tainted by cross-origin data") — translate them into the fix. */
export function exportErrorMessage(e: unknown): string {
	const message = (e as Error)?.message ?? 'Export failed';
	if (e instanceof DOMException && e.name === 'SecurityError') {
		return 'Export blocked by a cross-origin image — remove and re-add that sticker/layer, then retry';
	}
	return message;
}

/** Map cue times onto the EXPORT timeline: media time re-mapped by the trim
 *  window and compressed by playbackRate; cues outside the window drop.
 *  (Export runs the trimmed span at the chosen speed; a cue pinned at media
 *  time t fires at (t - trimStart) / rate seconds into the export.) */
export function shiftCuesForExport(
	cues: MemeSfxCue[],
	trimStartSec: number,
	playbackRate: number,
	durationSec: number
): MemeSfxCue[] {
	const shift = (atMs: number) => (atMs - trimStartSec * 1000) / (playbackRate || 1);
	return cues
		.map((c) => ({ ...c, atMs: shift(c.atMs) }))
		.filter((c) => c.atMs >= 0 && c.atMs <= durationSec * 1000);
}

/** File extension for a recorded export (mp4 vs webm) from the mime type. */
export function recordedExt(mimeType: string): string {
	return mimeType.includes('mp4') ? 'mp4' : 'webm';
}

/** §6.4 imeta duration for a published video: the export window when the
 *  source is video (exportDurationSec already nets trim + speed), the GIF's
 *  own loop (a `gif` explicit export trims a pinned Length to the source;
 *  recorder exports repeat the loop instead), the cue-sheet runtime for
 *  sound memes, and nothing for stills. */
export function exportImetaDuration(opts: {
	uploadedKind: 'image' | 'video' | 'file';
	mediaKind: 'image' | 'video' | null;
	gifDuration?: number;
	exportFormat: 'auto' | 'image' | 'gif' | 'video';
	pinnedLengthSec: number | null;
	cueRuntimeSec?: number;
	exportDurationSec?: number;
	capSec: number;
}): number | undefined {
	if (opts.uploadedKind !== 'video') return undefined;
	if (opts.mediaKind === 'video') return opts.exportDurationSec || undefined;
	if (opts.gifDuration !== undefined) {
		return opts.exportFormat === 'gif'
			? Math.min(opts.pinnedLengthSec ?? Infinity, opts.gifDuration)
			: (opts.pinnedLengthSec ?? opts.gifDuration);
	}
	if (opts.cueRuntimeSec) {
		return Math.min(Math.max(opts.pinnedLengthSec ?? opts.cueRuntimeSec, 0.5), opts.capSec);
	}
	return undefined;
}

/** One MediaRecorder session with the studio-shared lifecycle: chunk
 *  collection, abort-signal cancellation, a requestAnimationFrame paint loop
 *  driven by wall clock, and the force-flush race for muxers that never
 *  flush on their own (hidden/background renderers wedged the export).
 *
 *  `run(paint)` drives `paint(ctx, elapsedMs)` on rAF until it returns true
 *  (timeline complete) or the abort signal fires. `finish()` stops the
 *  recorder, flushes, and assembles the File. */
export class RecorderSession {
	readonly canvas: HTMLCanvasElement;
	readonly ctx: CanvasRenderingContext2D;
	readonly stream: MediaStream;
	private readonly recorder: MediaRecorder;
	private readonly chunks: Blob[] = [];
	private readonly startedAt = performance.now();
	private readonly pickedMime: string;
	private readonly signal?: AbortSignal;
	private readonly onAbort = () => {
		this.cancelled = true;
	};
	private cancelled = false;
	private loopDone = false;
	private readonly done: Promise<void>;

	constructor(opts: {
		canvas: HTMLCanvasElement;
		mimeType: string;
		fps?: number;
		signal?: AbortSignal;
		errorLabel?: string;
		/** Audio must be present before MediaRecorder starts; Chromium rejects
		 * mutating a recorded stream after start(). */
		extraTracks?: MediaStreamTrack[];
	}) {
		this.canvas = opts.canvas;
		const ctx = opts.canvas.getContext('2d');
		if (!ctx) throw new Error('Canvas is not available in this browser');
		this.ctx = ctx;
		this.stream = opts.canvas.captureStream(opts.fps ?? 30);
		for (const track of opts.extraTracks ?? []) {
			if (track.readyState !== 'ended') this.stream.addTrack(track);
		}
		this.signal = opts.signal;
		this.pickedMime = opts.mimeType;
		this.recorder = new MediaRecorder(this.stream, {
			mimeType: opts.mimeType,
			videoBitsPerSecond: 6_000_000
		});
		this.recorder.ondataavailable = (e) => {
			if (e.data.size) this.chunks.push(e.data);
		};
		this.done = new Promise<void>((resolve, reject) => {
			this.recorder.onstop = () => resolve();
			this.recorder.onerror = () =>
				reject(new Error(opts.errorLabel ?? 'Recording the meme failed'));
		});
		this.recorder.start(250);
		opts.signal?.addEventListener('abort', this.onAbort);
	}

	get isCancelled(): boolean {
		return this.cancelled;
	}

	/** Wall-clock ms since the session started. */
	elapsedMs(): number {
		return performance.now() - this.startedAt;
	}

	/** Drive `paint` on rAF until it returns true (timeline complete) or the
	 *  abort signal fires; resolves once the loop has fully ended (mirrors
	 *  the original 100ms-interval reconciliation between the two). */
	async run(paint: (ctx: CanvasRenderingContext2D, elapsedMs: number) => boolean): Promise<void> {
		const step = () => {
			if (paint(this.ctx, this.elapsedMs())) {
				this.loopDone = true;
				return;
			}
			if (this.cancelled) {
				this.loopDone = true;
				return;
			}
			requestAnimationFrame(step);
		};
		requestAnimationFrame(step);
		await new Promise<void>((resolve) => {
			const check = setInterval(() => {
				if (this.cancelled || this.loopDone) {
					clearInterval(check);
					resolve();
				}
			}, 100);
		});
	}

	/** Stop recording and flush. Hidden/background renderers sometimes never
	 *  flush the WebM muxer — onstop hangs and the studio stays busy forever.
	 *  Race a force-flush: re-stop + stop the tracks so pending data events
	 *  land (better a possibly-short file than a wedged export). */
	async finish(): Promise<File> {
		this.signal?.removeEventListener('abort', this.onAbort);
		this.recorder.stop();
		await Promise.race([
			this.done,
			new Promise<void>((resolve) =>
				setTimeout(() => {
					try {
						this.recorder.stop();
					} catch {
						/* already inactive */
					}
					this.stream.getTracks().forEach((t) => t.stop());
					resolve();
				}, 10_000)
			)
		]);
		this.stream.getTracks().forEach((t) => t.stop());
		if (this.cancelled) throw new Error('Meme export cancelled');
		const mimeType = this.pickedMime || this.recorder.mimeType || 'video/webm';
		const blob = new Blob(this.chunks, { type: mimeType.split(';')[0] });
		if (!blob.size) throw new Error('The meme export produced an empty video');
		return new File([blob], `meme-${Date.now()}.${recordedExt(mimeType)}`, {
			type: mimeType.split(';')[0]
		});
	}

	/** Error-path cleanup: unregister the abort listener and stop the stream
	 *  when finish() was never reached. */
	dispose(): void {
		this.signal?.removeEventListener('abort', this.onAbort);
		try {
			this.recorder.stop();
		} catch {
			/* already inactive */
		}
		this.stream.getTracks().forEach((t) => t.stop());
	}
}
