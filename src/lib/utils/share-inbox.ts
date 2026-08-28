/**
 * Share-target inbox — the client half of the PWA share flow
 * (docs/source/studio-mobile-ux.md §4j).
 *
 * The service worker banks a file shared from the OS share sheet into the
 * `bitos-share-inbox` Cache (see src/service-worker.ts) and 303-redirects the
 * launch to `/studio/create?tab=meme&shared=1`. This helper drains that
 * inbox: it rebuilds the File (name + type ride the cached Response headers)
 * and removes the entry so a share is staged exactly once.
 *
 * The stash write races the page boot (the SW's waitUntil runs alongside the
 * redirect navigation), so a short bounded poll covers the cold-start case.
 */

const SHARE_INBOX_CACHE = 'bitos-share-inbox';
const SHARE_INBOX_KEY = '/__bitos-shared-file__';

export async function takeSharedFile(): Promise<File | null> {
	if (typeof caches === 'undefined') return null;
	try {
		let response: Response | undefined;
		// Up to ~2s: cold starts can land here before the SW finished banking
		// the shared file (waitUntil ≠ blocking the redirect).
		for (let attempt = 0; attempt < 10; attempt++) {
			const cache = await caches.open(SHARE_INBOX_CACHE);
			response = await cache.match(SHARE_INBOX_KEY);
			if (response) break;
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
		if (!response) return null;
		const blob = await response.blob();
		const type = response.headers.get('Content-Type') ?? blob.type ?? 'application/octet-stream';
		const encodedName = response.headers.get('X-File-Name');
		let name = 'shared';
		try {
			name = encodedName ? decodeURIComponent(encodedName) : 'shared';
		} catch {
			/* keep the fallback name */
		}
		const cache = await caches.open(SHARE_INBOX_CACHE);
		await cache.delete(SHARE_INBOX_KEY);
		return new File([blob], name || 'shared', { type });
	} catch {
		return null;
	}
}
