/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const CACHE = `bitos-cache-${version}`;
const APP_SHELL = new URL(self.registration.scope).pathname;
const STATIC_ASSETS = [...build, ...files];
const STATIC_PATHS = new Set(
	STATIC_ASSETS.map((asset) => new URL(asset, self.location.origin).pathname)
);

self.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			await cache.addAll([APP_SHELL, ...STATIC_ASSETS]);
			await self.skipWaiting();
		})()
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== CACHE) await caches.delete(key);
			}
			await self.clients.claim();
		})()
	);
});

self.addEventListener('fetch', (event) => {
	const { request } = event;
	const url = new URL(request.url);

	// PWA share-target (manifest `share_target`): the OS share sheet POSTs
	// multipart data here with the shared media. The file is banked into a
	// dedicated cache BEFORE the redirect resolves (waitUntil), and the page
	// boots at ?tab=meme&shared=1 where the studio picks it up
	// (`takeSharedFile`) and stages it on the canvas.
	if (
		request.method === 'POST' &&
		url.origin === self.location.origin &&
		url.pathname === '/studio/create'
	) {
		event.respondWith(Response.redirect('/studio/create?tab=meme&shared=1', 303));
		event.waitUntil(
			(async () => {
				try {
					const form = await request.formData();
					const shared = form.get('files');
					if (!(shared instanceof File)) return;
					const cache = await caches.open('bitos-share-inbox');
					await cache.put(
						'/__bitos-shared-file__',
						new Response(shared, {
							headers: {
								'Content-Type': shared.type || 'application/octet-stream',
								'X-File-Name': encodeURIComponent(shared.name || 'shared')
							}
						})
					);
				} catch {
					/* a failed stash just opens an empty studio */
				}
			})()
		);
		return;
	}

	if (request.method !== 'GET') return;

	if (url.origin !== self.location.origin) return;

	if (request.mode === 'navigate') {
		event.respondWith(
			(async () => {
				try {
					const response = await fetch(request);
					const cache = await caches.open(CACHE);
					cache.put(APP_SHELL, response.clone()).catch(() => undefined);
					return response;
				} catch {
					return (
						(await caches.match(request)) ?? (await caches.match(APP_SHELL)) ?? Response.error()
					);
				}
			})()
		);
		return;
	}

	if (STATIC_PATHS.has(url.pathname)) {
		event.respondWith((async () => (await caches.match(request)) ?? (await fetch(request)))());
		return;
	}

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);
			const cached = await cache.match(request);
			const networkFetch = fetch(request)
				.then((response) => {
					if (response.ok) cache.put(request, response.clone()).catch(() => undefined);
					return response;
				})
				.catch(() => cached);

			return cached ?? networkFetch;
		})()
	);
});
