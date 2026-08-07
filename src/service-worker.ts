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
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
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
