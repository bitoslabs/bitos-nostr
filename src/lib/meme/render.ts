/**
 * Meme renderer — paints overlays onto a canvas and exports web-ready media.
 *
 * Two export paths:
 *   • image / poster frame → draw media + overlays once, `toBlob('image/jpeg')`
 *   • full video meme → play the source muted while painting every frame onto
 *     a canvas, capture the canvas stream and record it with MediaRecorder
 *     (WebM) — overlays are burned into the pixels, so the published Nostr
 *     event stays a standard NIP-68/71 media note every client can play.
 */
import { overlayVisibleAt, type MemeFont, type MemeTextOverlay } from './schema';
import { imageOverlayVisibleAt, type MemeImageOverlay } from './image-overlay';
import { memeLookCss } from './look';
import { fxTransformAt } from './fx';

/** Paints an animated layer frame into (x,y) — one scratch canvas per use. */
export type AnimatedLayerPainter = (
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	timeSec: number
) => void;

const FONT_STACKS: Record<MemeFont, string> = {
	impact: '"Impact", "Haettenschweiler", "Arial Black", "sans-serif"',
	sans: 'system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
	serif: 'Georgia, "Times New Roman", serif',
	mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'
};

export interface RenderOptions {
	/** Raster image layers painted after the media, under the captions. */
	imageLayers?: MemeImageOverlay[];
	/** Cached decoded bitmaps per src — see paintImageOverlays. */
	bitmaps?: Map<string, HTMLImageElement>;
	/**
	 * Animated layer painters per src — when a layer is an animated GIF,
	 * this paints the frame active at export time instead of the static
	 * first frame that `drawImage(img)` would freeze on. Same resolver
	 * signature as paintImageOverlays' `animFor`.
	 */
	animPainters?: (src: string, box: { w: number; h: number }) => AnimatedLayerPainter | null;
	/** Canvas long-edge cap (px). Defaults to 1080; 0 = keep source size. */
	maxEdge?: number;
	/**
	 * Explicit output canvas size (the "artboard"). When set it replaces the
	 * source-derived sizing — the media cover-fits into it, so a 16:9 clip on
	 * a 9:16 artboard crops to fill. Overlays are normalized, so they land
	 * identically whatever the artboard.
	 */
	target?: { width: number; height: number };
	/** Base-media framing (crop/zoom) — see coverRect. */
	mediaTransform?: MediaTransform;
	/** JPEG quality for image exports. */
	quality?: number;
	/** CSS filter chain burned into the MEDIA pixels (captions stay crisp). */
	lookCss?: string;
}

export interface VideoRenderOptions extends RenderOptions {
	onProgress?: (progress: { percent: number; deterministic: boolean }) => void;
	signal?: AbortSignal;
	/** Extra audio tracks to mix into the recorded stream (e.g. the cue mix). */
	extraTracks?: MediaStreamTrack[];
	/** Export window: play from trimStartSec (default 0). */
	trimStartSec?: number;
	/** Export window: stop at trimEndSec (default = source duration). */
	trimEndSec?: number;
	/** Playback rate for the export pass (0.5–2; audio pitch follows). */
	playbackRate?: number;
}

function fontFor(overlay: MemeTextOverlay, px: number): string {
	return `${overlay.caps ? '' : ''}700 ${Math.round(px)}px ${FONT_STACKS[overlay.font]}`;
}

/**
 * Greedy word-wrap. `measure` returns the line width so the layout engine is
 * testable without a canvas (the browser passes `ctx.measureText`).
 */
export function wrapLines(
	text: string,
	measure: (line: string) => number,
	maxWidth: number
): string[] {
	const out: string[] = [];
	if (!text.trim()) return out;
	for (const paragraph of text.split('\n')) {
		const words = paragraph.split(/\s+/).filter(Boolean);
		if (!words.length) {
			out.push('');
			continue;
		}
		let line = words[0];
		for (let i = 1; i < words.length; i++) {
			const candidate = `${line} ${words[i]}`;
			if (measure(candidate) <= maxWidth || line === words[i]) {
				line = candidate;
			} else {
				out.push(line);
				line = words[i];
			}
		}
		out.push(line);
	}
	return out;
}

/** Uppercase transform applied inside the renderer (source text is untouched). */
export function displayText(overlay: MemeTextOverlay): string {
	return overlay.caps ? overlay.text.toUpperCase() : overlay.text;
}

function roundRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number
) {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

/** Canvas size for a source, honoring the long-edge cap and even dimensions. */
export function targetSize(
	source: { width: number; height: number },
	maxEdge = 1080
): { width: number; height: number } {
	let { width, height } = source;
	if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
		return { width: 1080, height: 1920 };
	}
	const longest = Math.max(width, height);
	if (maxEdge > 0 && longest > maxEdge) {
		const scale = maxEdge / longest;
		width = Math.round(width * scale);
		height = Math.round(height * scale);
	}
	// Even dimensions keep hardware encoders happy.
	return { width: Math.max(2, width - (width % 2)), height: Math.max(2, height - (height % 2)) };
}

/** Paint one overlay (wrapped, outlined, optional contrast bar, FX). Exported for tests. */
export function paintOverlay(
	ctx: CanvasRenderingContext2D,
	overlay: MemeTextOverlay,
	canvas: { width: number; height: number },
	options: { referenceHeight?: number; atMs?: number } = {}
): void {
	const text = displayText(overlay);
	if (!text.trim()) return;
	const fx = fxTransformAt(overlay, options.atMs);
	if (fx.alpha <= 0) return;
	const referenceHeight = options.referenceHeight ?? canvas.height;
	const px = Math.max(10, overlay.size * referenceHeight);
	ctx.save();
	if (fx.scale !== 1 || fx.rotate !== 0 || fx.dx !== 0 || fx.dy !== 0) {
		const cx = overlay.x * canvas.width + fx.dx * canvas.width;
		const cy = overlay.y * canvas.height + fx.dy * canvas.height;
		ctx.translate(cx, cy);
		if (fx.rotate) ctx.rotate(fx.rotate);
		if (fx.scale !== 1) ctx.scale(fx.scale, fx.scale);
		ctx.translate(-overlay.x * canvas.width, -overlay.y * canvas.height);
	}
	if (fx.alpha < 1) ctx.globalAlpha = Math.max(0, Math.min(1, fx.alpha));
	ctx.font = fontFor(overlay, px);
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	const maxWidth = canvas.width * 0.94;
	const lines = wrapLines(text, (line) => ctx.measureText(line).width, maxWidth);
	const lineHeight = px * 1.12;
	const centerX = overlay.x * canvas.width;
	let top = overlay.y * canvas.height - (lines.length - 1) * (lineHeight / 2);
	// Scale down a hair when the wrapped block overflows the canvas.
	const blockHeight = lines.length * lineHeight;
	if (blockHeight > canvas.height * 0.96) {
		const shrink = (canvas.height * 0.9) / blockHeight;
		ctx.font = fontFor(overlay, px * shrink);
		const resizedLines = wrapLines(text, (line) => ctx.measureText(line).width, maxWidth);
		lines.length = 0;
		lines.push(...resizedLines);
		top = canvas.height / 2 - (lines.length * lineHeight * shrink) / 2;
	}
	for (let i = 0; i < lines.length; i++) {
		const y = top + i * lineHeight;
		const line = lines[i];
		if (!line) continue;
		if (overlay.bar) {
			const metrics = ctx.measureText(line);
			const padX = px * 0.35;
			const padY = px * 0.22;
			ctx.save();
			ctx.fillStyle =
				overlay.color.toLowerCase() === '#ffffff' ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.75)';
			roundRect(
				ctx,
				centerX - metrics.width / 2 - padX,
				y - lineHeight / 2 - padY / 2,
				metrics.width + padX * 2,
				lineHeight * 0.92 + padY,
				px * 0.18
			);
			ctx.fill();
			ctx.restore();
		}
		if (overlay.stroke) {
			ctx.lineWidth = Math.max(2, px * 0.08);
			ctx.strokeStyle = overlay.color.toLowerCase() === '#ffffff' ? '#000000' : '#ffffff';
			ctx.lineJoin = 'round';
			ctx.miterLimit = 2;
			ctx.strokeText(line, centerX, y);
		}
		ctx.fillStyle = overlay.color;
		ctx.fillText(line, centerX, y);
	}
	ctx.restore();
}

/** Paint every visible overlay at media time `atMs` (undefined = all). */
export function paintAll(
	ctx: CanvasRenderingContext2D,
	overlays: MemeTextOverlay[],
	canvas: { width: number; height: number },
	atMs?: number
): void {
	for (const overlay of overlays) {
		if (atMs !== undefined && !overlayVisibleAt(overlay, atMs)) continue;
		paintOverlay(ctx, overlay, canvas, { atMs });
	}
}

/**
 * Paint image layers (media-timed). Callers pass a cached bitmap per src —
 * the renderer never fetches, so export stays deterministic + offline-safe.
 */
export function paintImageOverlays(
	ctx: CanvasRenderingContext2D,
	layers: MemeImageOverlay[],
	bitmapFor: (src: string) => CanvasImageSource | null,
	canvas: { width: number; height: number },
	atMs?: number,
	animFor?: (src: string, box: { w: number; h: number }) => AnimatedLayerPainter | null
): void {
	for (const layer of layers) {
		if (atMs !== undefined && !imageOverlayVisibleAt(layer, atMs)) continue;
		const h = layer.size * canvas.height;
		const w = h * (layer.aspect || 1);
		const x = layer.x * canvas.width - w / 2;
		const y = layer.y * canvas.height - h / 2;
		// Per-layer effects: opacity, rotation, mirror flips, color look.
		// Mirrors the studio's CSS exactly — WYSIWYG by construction.
		const rad = ((layer.rotate ?? 0) * Math.PI) / 180;
		const flipX = layer.flipH ? -1 : 1;
		const flipY = layer.flipV ? -1 : 1;
		const alpha = layer.opacity ?? 1;
		const look = layer.lookId && layer.lookId !== 'none' ? memeLookCss(layer.lookId) : '';
		const transformed = rad !== 0 || flipX < 0 || flipY < 0;
		if (transformed || alpha < 1 || look) {
			ctx.save();
			if (alpha < 1) ctx.globalAlpha = alpha;
			if (look) ctx.filter = look;
			if (transformed) {
				ctx.translate(x + w / 2, y + h / 2);
				ctx.rotate(rad);
				ctx.scale(flipX, flipY);
				ctx.translate(-(x + w / 2), -(y + h / 2));
			}
		}
		let painted = false;
		if (atMs !== undefined && animFor) {
			const painter = animFor(layer.src, { w, h });
			if (painter) {
				painter(ctx, x, y, atMs / 1000);
				painted = true;
			}
		}
		if (!painted) {
			const bitmap = bitmapFor(layer.src);
			if (bitmap) ctx.drawImage(bitmap, x, y, w, h);
		}
		if (transformed || alpha < 1 || look) ctx.restore();
	}
}

function mediaSize(el: HTMLImageElement | HTMLVideoElement): { width: number; height: number } {
	if (el instanceof HTMLVideoElement) {
		return { width: el.videoWidth, height: el.videoHeight };
	}
	return { width: el.naturalWidth, height: el.naturalHeight };
}

/** Base-media framing: zoom multiplier + pan, each axis −1…1 of the
 *  cover-fit overflow (0 = centered). Rides RenderOptions/drafts; layers and
 *  captions stay fixed to the artboard — only the media moves. */
export interface MediaTransform {
	scale: number;
	x: number;
	y: number;
}

/** Cover-fit rectangle for a source in a target box, with optional zoom/pan.
 *  Pure math — the preview (CSS transform), every export path and the GIF
 *  painter all derive from it, so framing is WYSIWYG everywhere by
 *  construction. Exported for tests. */
export function coverRect(
	sourceW: number,
	sourceH: number,
	canvasW: number,
	canvasH: number,
	transform?: MediaTransform
): { x: number; y: number; w: number; h: number } {
	const scale = Math.max(canvasW / (sourceW || 1), canvasH / (sourceH || 1));
	const zoom = clampNum(transform?.scale ?? 1, 1, 4);
	const w = (sourceW || canvasW) * scale * zoom;
	const h = (sourceH || canvasH) * scale * zoom;
	// Pan travels within the overflow past the canvas edges; at zoom 1 the
	// overflow can be zero on one axis, so that axis just stays centered.
	const maxX = Math.max(0, (w - canvasW) / 2);
	const maxY = Math.max(0, (h - canvasH) / 2);
	const dx = clampNum(transform?.x ?? 0, -1, 1) * maxX;
	const dy = clampNum(transform?.y ?? 0, -1, 1) * maxY;
	return { x: (canvasW - w) / 2 + dx, y: (canvasH - h) / 2 + dy, w, h };
}

function drawCover(
	ctx: CanvasRenderingContext2D,
	el: HTMLImageElement | HTMLVideoElement,
	canvas: HTMLCanvasElement,
	lookCss?: string,
	transform?: MediaTransform
): void {
	// Look filter (if any) applies to the media draw only — set right before
	// drawImage and never around the caption paint pass.
	if (lookCss && lookCss !== 'none') ctx.filter = lookCss;
	// Cover-fit the source into the target box (meme canvases match the media
	// aspect already; cover just guards odd sizes), then apply framing.
	const { width: sw, height: sh } = mediaSize(el);
	const rect = coverRect(sw, sh, canvas.width, canvas.height, transform);
	ctx.drawImage(el, rect.x, rect.y, rect.w, rect.h);
	ctx.filter = 'none';
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	return canvas;
}

function clampNum(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

/** Export an image meme (or a single video frame poster) as a JPEG blob. */
export async function renderImageMeme(
	media: HTMLImageElement | HTMLVideoElement,
	overlays: MemeTextOverlay[],
	options: RenderOptions = {}
): Promise<Blob> {
	const size = options.target ?? targetSize(mediaSize(media), options.maxEdge ?? 1080);
	const canvas = makeCanvas(size.width, size.height);
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas is not available in this browser');
	drawCover(ctx, media, canvas, options.lookCss, options.mediaTransform);
	if (options.imageLayers?.length) {
		paintImageOverlays(
			ctx,
			options.imageLayers,
			(src) => options.bitmaps?.get(src) ?? null,
			canvas
		);
	}
	paintAll(ctx, overlays, canvas);
	const blob = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob(resolve, 'image/jpeg', options.quality ?? 0.9)
	);
	if (!blob) throw new Error('Could not encode the meme image');
	return blob;
}

function pickVideoMimeType(): string {
	const candidates = [
		'video/webm;codecs=vp9,opus',
		'video/webm;codecs=vp8,opus',
		'video/webm',
		'video/mp4'
	];
	for (const type of candidates) {
		if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) return type;
	}
	return '';
}

export function canRenderVideoMeme(): boolean {
	return (
		typeof MediaRecorder !== 'undefined' &&
		typeof HTMLCanvasElement !== 'undefined' &&
		typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
		!!pickVideoMimeType()
	);
}

/**
 * Grab a single composed frame (media + look + image layers + captions at
 * that timestamp) as a JPEG blob — the poster-frame picker's source. Seeks a
 * detached copy of the video so the stage preview never stutters.
 */
export async function grabVideoFrame(
	source: HTMLVideoElement,
	timeSec: number,
	options: { lookCss?: string; overlays?: MemeTextOverlay[] } = {}
): Promise<Blob> {
	const scrub = document.createElement('video');
	scrub.src = source.currentSrc || source.src;
	scrub.muted = true;
	scrub.playsInline = true;
	scrub.preload = 'auto';
	// Wait for the copy to know its duration before seeking (metadata-only
	// loads resolve before duration exists, and seeks get dropped).
	await new Promise<void>((resolve, reject) => {
		scrub.onloadedmetadata = () => resolve();
		scrub.onerror = () => reject(new Error('Could not read the video for frame grab'));
		setTimeout(() => reject(new Error('Frame grab timed out')), 8000);
	});
	scrub.currentTime = Math.max(0, Math.min(timeSec, (scrub.duration || timeSec) - 0.05));
	await new Promise<void>((resolve, reject) => {
		scrub.onseeked = () => resolve();
		scrub.onerror = () => reject(new Error('Could not seek the video for frame grab'));
		setTimeout(() => reject(new Error('Frame seek timed out')), 8000);
	});
	const size = targetSize({ width: scrub.videoWidth, height: scrub.videoHeight }, 720);
	const canvas = makeCanvas(size.width, size.height);
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas is not available in this browser');
	if (options.lookCss && options.lookCss !== 'none') ctx.filter = options.lookCss;
	ctx.drawImage(scrub, 0, 0, canvas.width, canvas.height);
	ctx.filter = 'none';
	paintAll(ctx, options.overlays ?? [], canvas, timeSec * 1000);
	return new Promise<Blob>((resolve, reject) => {
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error('Frame encode failed'))),
			'image/jpeg',
			0.85
		);
	});
}

/**
 * Export a video meme: replays the (muted) source while painting overlays per
 * frame onto a canvas, records the captured stream to a WebM/MP4 blob.
 * Real-time by design — overlay timing windows stay frame-accurate.
 */
export async function renderVideoMeme(
	source: HTMLVideoElement,
	overlays: MemeTextOverlay[],
	options: VideoRenderOptions = {}
): Promise<{ blob: Blob; mimeType: string }> {
	if (!canRenderVideoMeme()) {
		throw new Error('This browser cannot export video memes — try Chrome or Edge');
	}
	const size = options.target
		? targetSize(options.target, 0)
		: targetSize({ width: source.videoWidth, height: source.videoHeight }, options.maxEdge ?? 1080);
	const canvas = makeCanvas(size.width, size.height);
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas is not available in this browser');
	const mimeType = pickVideoMimeType();
	const stream = canvas.captureStream(30);
	// Carry the source audio into the export when present. (`captureStream` on
	// media elements is typed loosely because older TS lib.dom versions miss it.)
	const captureSource = (source as HTMLVideoElement & { captureStream?: () => MediaStream })
		.captureStream;
	if (captureSource) {
		try {
			for (const track of captureSource.call(source).getAudioTracks()) stream.addTrack(track);
		} catch {
			/* silent source — video-only export */
		}
	}
	const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
	// The cue mix (synth + custom sounds) rides alongside any source audio;
	// callers pass it via extraTracks so GIF and video exports share one path.
	for (const track of options.extraTracks ?? []) {
		try {
			stream.addTrack(track);
		} catch {
			/* track already ended — export continues video-only */
		}
	}
	const chunks: Blob[] = [];
	recorder.ondataavailable = (e) => {
		if (e.data.size) chunks.push(e.data);
	};
	const done = new Promise<void>((resolve, reject) => {
		recorder.onstop = () => resolve();
		recorder.onerror = () => reject(new Error('Recording the meme failed'));
	});

	const wasMuted = source.muted;
	source.muted = true;
	const rate = clampNum(options.playbackRate ?? 1, 0.5, 2);
	source.playbackRate = rate;
	const startSec = Math.max(0, options.trimStartSec ?? 0);
	const endSec =
		options.trimEndSec !== undefined && Number.isFinite(options.trimEndSec)
			? Math.min(options.trimEndSec, Number.isFinite(source.duration) ? source.duration : Infinity)
			: Infinity;
	const restore = () => {
		source.muted = wasMuted;
		source.playbackRate = 1;
	};
	const paint = () => {
		drawCover(ctx, source, canvas, options.lookCss, options.mediaTransform);
		if (options.imageLayers?.length) {
			paintImageOverlays(
				ctx,
				options.imageLayers,
				(src) => options.bitmaps?.get(src) ?? null,
				canvas,
				source.currentTime * 1000,
				options.animPainters ?? undefined
			);
		}
		paintAll(ctx, overlays, canvas, source.currentTime * 1000);
		if (options.onProgress && endSec !== Infinity && endSec > startSec) {
			options.onProgress({
				percent: Math.min(
					100,
					Math.round(((source.currentTime - startSec) / (endSec - startSec)) * 100)
				),
				deterministic: true
			});
		} else if (options.onProgress && Number.isFinite(source.duration)) {
			options.onProgress({
				percent: Math.min(100, Math.round((source.currentTime / source.duration) * 100)),
				deterministic: true
			});
		}
		requestAnimationFrame(paint);
	};
	source.currentTime = startSec;
	await source.play().catch(() => undefined);
	recorder.start(250);
	paint();
	await new Promise<void>((resolve) => {
		const finish = () => {
			source.removeEventListener('ended', finish);
			source.removeEventListener('timeupdate', onTick);
			resolve();
		};
		const onTick = () => {
			if (source.currentTime >= endSec - 0.05) {
				source.pause();
				finish();
			}
		};
		source.addEventListener('ended', finish);
		source.addEventListener('timeupdate', onTick);
		const abort = () => {
			options.signal?.removeEventListener('abort', abort);
			source.pause();
			finish();
		};
		options.signal?.addEventListener('abort', abort);
	});
	recorder.stop();
	await done;
	restore();
	stream.getTracks().forEach((t) => t.stop());
	if (options.signal?.aborted) throw new Error('Meme export cancelled');
	const blob = new Blob(chunks, { type: mimeType.split(';')[0] });
	if (!blob.size) throw new Error('The meme export produced an empty video');
	return { blob, mimeType: mimeType.split(';')[0] };
}
