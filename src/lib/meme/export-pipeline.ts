/** Export-path primitives shared by the meme studio's five export functions:
 *  base-media painting, cue-audio track assembly, and the RecorderSession
 *  lifecycle. Each replaces a block that was copy-pasted across the export
 *  paths in MemeStudio — same behavior, one home, unit-testable. */
import { canRenderVideoMeme, coverRect, type MediaTransform } from '$lib/meme/render';
import { paintGifFrameAt, type DecodedGif } from '$lib/meme/gif';
import { createSfxAudioTrack } from '$lib/meme/sfx';
import type { MemeSfxCue } from '$lib/meme/schema';
import { paintFxFrame, type FrameFxWindow } from '$lib/meme/fx-track';
import { pickRecorderMime, RecorderSession } from '$lib/meme/export-support';

/** The base media of an export, as the studio stages it. Exactly one of the
 *  three sources is live per export; the first non-null wins in that order. */
export interface MemeExportBase {
	mediaKind: 'image' | 'video' | null;
	gif: DecodedGif | null;
	stageImg: HTMLImageElement | null;
	stageVideo: HTMLVideoElement | null;
	/** CSS filter chain burned into the media pixels (look presets). */
	lookCss: string;
	mediaTransform: MediaTransform;
	/** Playhead for the GIF path when no explicit time is passed. */
	stageSeconds?: number;
	/** Frame-FX windows painted over the base media (media-timed ms). */
	fxWindows?: FrameFxWindow[];
	/** FX playhead override (export-timeline ms); defaults to atSec/stageSeconds. */
	fxAtMs?: number;
}

/** Paint the base media cover-fitted onto `a`, look applied. Video draws its
 *  current frame; GIF paints `atSec` (falls back to the stage playhead);
 *  images draw their natural pixels. Resets the filter after — the caller's
 *  layers/captions must stay crisp. */
export function paintMemeBase(
	ctx: CanvasRenderingContext2D,
	a: HTMLCanvasElement,
	base: MemeExportBase,
	atSec?: number
): void {
	const fxAtMs = base.fxAtMs ?? (atSec ?? base.stageSeconds ?? 0) * 1000;
	if (base.lookCss !== 'none') ctx.filter = base.lookCss;
	if (base.mediaKind === 'video' && base.stageVideo) {
		const rect = coverRect(
			base.stageVideo.videoWidth || a.width,
			base.stageVideo.videoHeight || a.height,
			a.width,
			a.height,
			base.mediaTransform
		);
		ctx.drawImage(base.stageVideo, rect.x, rect.y, rect.w, rect.h);
	} else if (base.gif) {
		const t = atSec ?? base.stageSeconds ?? 0;
		paintGifFrameAt(ctx, base.gif, t, a, base.mediaTransform);
	} else if (base.stageImg) {
		const rect = coverRect(
			base.stageImg.naturalWidth || a.width,
			base.stageImg.naturalHeight || a.height,
			a.width,
			a.height,
			base.mediaTransform
		);
		ctx.drawImage(base.stageImg, rect.x, rect.y, rect.w, rect.h);
	}
	ctx.filter = 'none';
	if (base.fxWindows?.length) paintFxFrame(ctx, base.fxWindows, fxAtMs, a);
}

/** Mix the cue sheet (synth + custom sounds) and wrap it as a MediaRecorder
 *  audio track. `decodeSound` returns PCM on success or null when a custom
 *  sound cannot be decoded (the mixer skips it). Returns null when there is
 *  nothing audible (silent export) or the track could not be created —
 *  exports must never die on cue audio. */
export async function cueAudioTrack(
	durationSec: number,
	cues: MemeSfxCue[],
	decodeSound: (soundId: string) => Promise<{ pcm: Float32Array; sampleRate: number } | null>
): Promise<MediaStreamTrack | null> {
	const OfflineCtx = window.OfflineAudioContext;
	if (!OfflineCtx || !cues.length) return null;
	const { buildCueMixBuffer } = await import('$lib/meme/cue-mix');
	const buffer = await buildCueMixBuffer(cues, durationSec, {
		offlineCtor: OfflineCtx,
		decodeSound
	});
	if (!buffer) return null;
	try {
		return createSfxAudioTrack(buffer, window.AudioContext);
	} catch {
		return null;
	}
}

/** Record a real-time paint loop into a File. `paint(ctx, elapsedMs)` fires
 *  on every animation frame; the loop ends once elapsed ≥ totalMs. Progress
 *  surfaces once per frame through `onProgress`. The session is disposed on
 *  ANY failure — the recorder never leaks a half-flushed file. */
export async function recordMeme(opts: {
	canvas: HTMLCanvasElement;
	totalMs: number;
	signal?: AbortSignal;
	extraTracks?: MediaStreamTrack[];
	paint: (ctx: CanvasRenderingContext2D, elapsedMs: number) => void;
	onProgress?: (percent: number) => void;
	unsupportedMessage?: string;
}): Promise<File> {
	const mimeType = pickRecorderMime();
	if (!mimeType)
		throw new Error(opts.unsupportedMessage ?? 'This browser cannot record meme videos');
	const session = new RecorderSession({
		canvas: opts.canvas,
		mimeType,
		signal: opts.signal,
		extraTracks: opts.extraTracks ?? []
	});
	try {
		await session.run((ctx, elapsedMs) => {
			opts.paint(ctx, elapsedMs);
			const percent = Math.min(100, Math.round((elapsedMs / opts.totalMs) * 100));
			opts.onProgress?.(percent);
			return percent >= 100;
		});
		return await session.finish();
	} catch (e) {
		session.dispose();
		throw e;
	}
}

export { canRenderVideoMeme };
