import { humanBytes } from '$lib/media/uploaders';
import { fetchRemoteMedia } from '$lib/meme/remote-media';

/**
 * URL → stage-File loading for the Meme Studio — the single seam where a
 * remote image/video/GIF becomes base media. All three callers (GIF picker,
 * URL paste form, source library) shared the same fetch → type-check → size
 * gate → File dance with copy-pasted error copy; this module owns that flow
 * and returns a discriminated result so the studio keeps only UX decisions.
 */

export interface SourceFileResult {
	ok: boolean;
	file?: File;
	/** Library-remember key (the original URL) on success. */
	url?: string;
	label?: string;
	mime?: string;
	error?: string;
}

export interface SourceFetchOptions {
	/** Display name base for the generated File (default 'source'). */
	label?: string;
	/** Skip the wsrv image-proxy fallback (videos can't ride it). */
	noProxy?: boolean;
	/** Type gate: accept only images, only videos, or both (default both). */
	accept?: 'image' | 'video' | 'both';
	/** Hard byte cap — one number or per-kind caps (default 200 MB both). */
	maxBytes?: number | { image: number; video: number };
	/** Byte-level download progress (0–100). Fires on chunks + completion. */
	onProgress?: (percent: number) => void;
}

/** Studio-wide media cap (kept identical to MemeStudio's previous inline cap). */
export const MAX_SOURCE_BYTES = 200 * 1024 * 1024;

function extensionFor(mime: string): string {
	return (mime.split('/')[1] ?? 'bin').replace('quicktime', 'mov');
}

/** Read a (possibly streaming) response body as a Blob, reporting byte-level
 *  progress when the server sends content-length. Unknown-length streams
 *  still complete — they just report an indeterminate progress (0). */
async function readBlobWithProgress(
	res: Response,
	onProgress?: (percent: number) => void
): Promise<Blob> {
	const total = Number(res.headers.get('content-length') ?? '');
	if (!onProgress || !res.body || !Number.isFinite(total) || total <= 0) return res.blob();
	const reader = res.body.getReader();
	const chunks: BlobPart[] = [];
	let loaded = 0;
	const report = () => onProgress(Math.min(99, Math.round((loaded / total) * 100)));
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value) {
			chunks.push(value as unknown as BlobPart);
			loaded += value.byteLength;
			report();
		}
	}
	onProgress(100);
	return new Blob(chunks, { type: (res.headers.get('content-type') ?? '').split(';')[0] });
}

/** Fetch a remote image/video URL and wrap it as a stage-ready File. */
export async function fetchSourceFile(
	url: string,
	{
		label = 'source',
		noProxy = false,
		accept = 'both',
		maxBytes = MAX_SOURCE_BYTES,
		onProgress
	}: SourceFetchOptions = {}
): Promise<SourceFileResult> {
	const trimmed = url.trim();
	if (!trimmed) return { ok: false, error: 'That link looks empty' };
	try {
		const res = await fetchRemoteMedia(trimmed, { proxy: !noProxy });
		if (!res) throw new Error('CORS-blocked host');
		const mime = (res.headers.get('content-type') ?? '').split(';')[0] ?? '';
		const kind = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : null;
		if (!kind || (accept !== 'both' && kind !== accept)) {
			throw new Error('That link is not a picture or video');
		}
		const blob = await readBlobWithProgress(res, onProgress);
		const cap = typeof maxBytes === 'number' ? maxBytes : (maxBytes?.[kind] ?? MAX_SOURCE_BYTES);
		if (blob.size > cap) throw new Error(`Over ${humanBytes(cap)} — too big`);
		const nameBase = (label || 'source').replace(/[^\w.-]+/g, '-').replace(/-+$/, '');
		const file = new File([blob], `${nameBase}-${Date.now()}.${extensionFor(mime)}`, {
			type: mime || 'application/octet-stream'
		});
		return { ok: true, file, url: trimmed, label, mime: blob.type || mime };
	} catch (e) {
		return {
			ok: false,
			error: e instanceof Error ? e.message : 'Could not load that media URL'
		};
	}
}
