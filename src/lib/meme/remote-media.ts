/**
 * Fetch a remote image or GIF for the studio.
 *
 * This policy deliberately lives outside the editor: callers can choose
 * whether an image-proxy retry is appropriate, while media loading, layer
 * loading, and remix loading all share the same CORS behaviour.
 */
export interface RemoteMediaFetchOptions {
	/** Retry image requests through wsrv when the source refuses browser CORS. */
	proxy?: boolean;
	/** Injectable for deterministic tests and non-browser callers. */
	fetch?: typeof globalThis.fetch;
}

const WSRV_URL = 'https://wsrv.nl/?url=';

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
	const targets = proxy && !isWsrvUrl(url) ? [url, `${WSRV_URL}${encodeURIComponent(url)}`] : [url];

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
