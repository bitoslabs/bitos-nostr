import { SvelteMap } from 'svelte/reactivity';
import { canDecodeGif, decodeGif, gifLayerPainter, type DecodedGif } from '$lib/meme/gif';
import { MAX_IMAGE_OVERLAY_BYTES } from '$lib/meme/image-overlay';
import { isBuddySrc } from '$lib/meme/bitz-buddy';
import { isBitzverseSrc } from '$lib/meme/bitzverse';
import { fetchRemoteMedia } from '$lib/meme/remote-media';
import type { AnimatedLayerPainter } from '$lib/meme/render';

/**
 * Layer asset cache — the single owner of every per-src resource behind image
 * overlay layers (PNG/GIF/JPEG stickers dropped onto the stage):
 *
 *  - decoded bitmaps (the export reads these, no refetch);
 *  - same-origin blob render URLs (bytes we already hold — rendering and
 *    exporting from blobs sidesteps CDN/provider CORS entirely: no tainted
 *    canvas SecurityError, no layer silently missing from the export when a
 *    host withholds CORS headers);
 *  - raw bytes held SYNCHRONOUSLY at add time (the GIF decoder reads them
 *    without a network round-trip or any race);
 *  - decoded animated GIFs + export-time painter handles (one scratch canvas
 *    per src, cached for the run — a fresh painter per recorded frame would
 *    churn and leak a canvas 30×/second).
 *
 * Split out of MemeStudio so resource lifecycles (lease/refcount-free: the
 * component calls release when no remaining layer references a src) live in
 * one testable place while the component keeps layer ROWS (state + drag +
 * inspector UX).
 */

/** CORS-minded byte fetch for URL-sourced layers (cap-checked, null on any
 *  failure — callers fall back to the plain URL path). */
export async function fetchLayerBlob(url: string): Promise<Blob | null> {
	// Bundled assets (Bitz Buddy stickers + Bitzverse props) are same-origin —
	// fetch them directly; routing a relative path through the remote proxy
	// chain would mangle it. Everything else keeps the CORS-minded policy.
	const res =
		isBuddySrc(url) || isBitzverseSrc(url)
			? await fetchRemoteMedia(url, { proxy: false })
			: await fetchRemoteMedia(url);
	if (!res) return null;
	const blob = await res.blob();
	if (!blob.size || blob.size > MAX_IMAGE_OVERLAY_BYTES) return null;
	return blob;
}

/** Read natural aspect without keeping the decoder around. */
export async function probeAspect(bytes: Blob): Promise<number | null> {
	try {
		const url = URL.createObjectURL(bytes);
		try {
			return await new Promise<number | null>((resolve) => {
				const img = new Image();
				img.onload = () => resolve(img.naturalWidth / img.naturalHeight || null);
				img.onerror = () => resolve(null);
				img.src = url;
			});
		} finally {
			URL.revokeObjectURL(url);
		}
	} catch {
		return null;
	}
}

export class LayerAssetCache {
	/** Cached decoded bitmaps per src — the export reads these, no refetch. */
	readonly bitmaps = new SvelteMap<string, HTMLImageElement>();
	/** Same-origin render source per layer src (object URL over bytes we
	 *  already hold — export-safe, CORS-immune). */
	readonly renderSrcs = new SvelteMap<string, string>();
	/** Bytes per src, held SYNCHRONOUSLY at add time — the GIF decoder reads
	 *  them without a network round-trip (and without any race). */
	readonly blobs = new SvelteMap<string, Blob>();
	/** Decoded animated GIFs per layer src — layers painted via gifLayerPainter
	 *  stay animated in previews AND exports (a bare drawImage freezes frame 1;
	 *  this is the fix for "GIF lost its animation when published"). */
	readonly gifs = new SvelteMap<string, DecodedGif>();
	/** Export-time painters: one scratch canvas per animated layer src. */
	readonly painters = new SvelteMap<
		string,
		{ key: string; handle: ReturnType<typeof gifLayerPainter> }
	>();

	/** Last GIF decode failure reason — surfaces in the export warning so the
	 *  failure is diagnosable instead of a silent frame-1 freeze. */
	lastGifDecodeError = '';

	/** Keep the bytes we already have as the render source for a remote src.
	 *  The Blob lands SYNCHRONOUSLY — cacheGif must never race a promise (the
	 *  old async arrayBuffer() handoff made fresh layers fall back to a
	 *  network fetch that non-CORS providers fail, freezing the GIF at
	 *  frame 1 in exports). */
	rememberBytes(src: string, blob: Blob): void {
		if (!this.blobs.has(src)) this.blobs.set(src, blob);
		if (!this.renderSrcs.has(src)) this.renderSrcs.set(src, URL.createObjectURL(blob));
	}

	/** Drop every per-src asset (blob URL, bytes, decoder, painter) — call when
	 *  no remaining layer references the src. */
	release(src: string): void {
		const obj = this.renderSrcs.get(src);
		if (obj) {
			URL.revokeObjectURL(obj);
			this.renderSrcs.delete(src);
		}
		this.blobs.delete(src);
		this.gifs.get(src)?.close();
		this.gifs.delete(src);
		this.painters.get(src)?.handle.close();
		this.painters.delete(src);
	}

	/** Drop every held asset (studio reset / media swap). */
	releaseAll(): void {
		for (const src of this.renderSrcs.keys()) URL.revokeObjectURL(this.renderSrcs.get(src)!);
		for (const gif of this.gifs.values()) gif.close();
		for (const painter of this.painters.values()) painter.handle.close();
		this.renderSrcs.clear();
		this.blobs.clear();
		this.gifs.clear();
		this.painters.clear();
		this.lastGifDecodeError = '';
	}

	/** Does this src look like an animated GIF layer? (content type when we
	 *  hold the bytes; else the URL extension). */
	looksAnimatedGif(src: string): boolean {
		const type = this.blobs.get(src)?.type;
		if (type) return type === 'image/gif';
		return /\.gif(\?|$)/i.test(src);
	}

	/** Decode (and cache) the bitmap for a src; resolves even on failure.
	 *  Prefers the same-origin blob render source — only pure-URL layers
	 *  (draft restore, failed fetch) touch the network, and those need CORS.
	 *  A CORS-blocked URL retries once through the image proxy so hostile
	 *  hosts still render AND export (a skipped layer quietly vanishes from
	 *  the meme instead). Triggers `layers` re-allocation via onChange so
	 *  Svelte re-renders once the bitmap lands. */
	cacheBitmap(src: string, onChange: () => void): Promise<boolean> {
		if (this.bitmaps.has(src)) return Promise.resolve(true);
		return new Promise((resolve) => {
			const img = new Image();
			const local = this.renderSrcs.get(src);
			if (!local) img.crossOrigin = 'anonymous';
			img.onload = () => {
				this.bitmaps.set(src, img);
				onChange();
				resolve(true);
			};
			img.onerror = () => {
				if (local) {
					resolve(false);
					return;
				}
				void fetchLayerBlob(src).then((blob) => {
					if (!blob) {
						resolve(false);
						return;
					}
					this.rememberBytes(src, blob);
					const retry = new Image();
					retry.onload = () => {
						this.bitmaps.set(src, retry);
						onChange();
						resolve(true);
					};
					retry.onerror = () => resolve(false);
					retry.src = this.renderSrcs.get(src) ?? '';
				});
			};
			img.src = local ?? src;
		});
	}

	/** Decode (best-effort) a layer src as animated; resolves false when the
	 *  src is static or the browser can't decode frame-by-frame. Bytes we
	 *  already hold decode synchronously-started and CORS-free — only pure-URL
	 *  layers (draft restore) fall back to a network fetch. */
	async cacheGif(src: string): Promise<boolean> {
		if (this.gifs.has(src)) return true;
		if (!canDecodeGif()) return false;
		try {
			const blob = this.blobs.get(src) ?? (await fetchLayerBlob(src));
			if (!blob) {
				this.lastGifDecodeError = 'no bytes';
				return false;
			}
			const decoded = await decodeGif(await blob.arrayBuffer());
			this.gifs.set(src, decoded);
			return true;
		} catch (e) {
			this.lastGifDecodeError = e instanceof Error ? e.message : String(e);
			return false; // static layer — the bitmap path already covers it
		}
	}

	/** Export-time painter resolution: reuse the per-src scratch canvas when
	 *  the box size is unchanged (paintImageOverlays asks every recorded
	 *  frame; a fresh painter per frame would churn canvases 30×/second). */
	/**
	 * Arrow property deliberately retains this cache when supplied to the
	 * renderer as a callback (`animPainters: layerAssets.painterFor`).
	 * The size key includes the crop box — a src used uncropped AND cropped
	 * (two layers, or a re-crop mid-session) needs distinct painters, and a
	 * crop change must invalidate the cached one.
	 */
	painterFor = (
		src: string,
		box: { w: number; h: number; crop?: { x: number; y: number; w: number; h: number } }
	): AnimatedLayerPainter | null => {
		const decoded = this.gifs.get(src);
		if (!decoded) return null;
		const cropKey = box.crop
			? `c${Math.round(box.crop.x * 1000)}-${Math.round(box.crop.y * 1000)}-${Math.round(box.crop.w * 1000)}-${Math.round(box.crop.h * 1000)}`
			: '';
		const sizeKey = `${Math.round(box.w)}x${Math.round(box.h)}${cropKey}`;
		const cached = this.painters.get(src);
		let handle = cached && cached.key === sizeKey ? cached.handle : undefined;
		if (!handle) {
			cached?.handle.close();
			handle = gifLayerPainter(decoded, box);
			this.painters.set(src, { key: sizeKey, handle });
		}
		const painter = handle;
		return (ctx, x, y, timeSec) => painter.paint(ctx, x, y, timeSec);
	};
}
