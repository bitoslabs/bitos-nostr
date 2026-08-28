/**
 * Fetch a remote image or GIF for the studio.
 *
 * This policy deliberately lives outside the editor: callers can choose
 * whether a proxy retry is appropriate, while media loading, layer loading,
 * and remix loading all share the same CORS behaviour.
 */
export interface RemoteMediaFetchOptions {
	/** Retry image requests through wsrv when the source refuses browser CORS. */
	proxy?: boolean;
	/** Injectable for deterministic tests and non-browser callers. */
	fetch?: typeof globalThis.fetch;
}

const WSRV_URL = 'https://wsrv.nl/?url=';
const LOCAL_PROXY_URL = '/api/media/proxy?url=';

/** Same-origin URL for displaying a CORS-hostile remote image in an <img> or
 * canvas-facing picker. Keep the original URL as the media identity; this is
 * only the browser-safe delivery URL. */
export function mediaProxyUrl(url: string): string {
	return `${LOCAL_PROXY_URL}${encodeURIComponent(url)}`;
}

function isWsrvUrl(url: string): boolean {
	return /^https:\/\/wsrv\.nl\//i.test(url);
}

/**
 * Returns the first successful response, or `null` when every permitted
 * request fails. It never throws for a network/CORS failure so UI handlers
 * can present one consistent, human-readable error.
 */
export async function fetchRemoteMedia(
	url: string,
	{ proxy = true, fetch: fetchImpl = globalThis.fetch }: RemoteMediaFetchOptions = {}
): Promise<Response | null> {
	// Use our server relay first: CORS-hostile CDNs (notably BTTV) otherwise
	// fail before wsrv gets a chance to help. The direct source stays available
	// only for callers that explicitly opt out of proxying.
	const targets =
		proxy && !isWsrvUrl(url)
			? [mediaProxyUrl(url), `${WSRV_URL}${encodeURIComponent(url)}`]
			: [url];

	for (const target of targets) {
		try {
			const response = await fetchImpl(target, { mode: 'cors' });
			if (response.ok) return response;
		} catch {
			// Try the proxy (if allowed), otherwise report a normal load failure.
		}
	}

	return null;
}
