import { describe, expect, it, vi } from 'vitest';

import { fetchRemoteMedia, mediaProxyUrl } from './remote-media';

describe('fetchRemoteMedia', () => {
	it('builds a same-origin display URL for CORS-hostile image CDNs', () => {
		expect(mediaProxyUrl('https://cdn.betterttv.net/emote/id/3x.webp')).toBe(
			'/api/media/proxy?url=https%3A%2F%2Fcdn.betterttv.net%2Femote%2Fid%2F3x.webp'
		);
	});

	it('uses the same-origin relay for proxyable media', async () => {
		const fetch = vi.fn().mockResolvedValue(new Response('ok'));

		const result = await fetchRemoteMedia('https://media.example/meme.gif', { fetch });

		expect(result?.ok).toBe(true);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch).toHaveBeenCalledWith(
			'/api/media/proxy?url=https%3A%2F%2Fmedia.example%2Fmeme.gif',
			{ mode: 'cors' }
		);
	});

	it('retries a failed image request through the proxy', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(new Response('', { status: 502 }))
			.mockResolvedValueOnce(new Response('proxied'));

		const result = await fetchRemoteMedia('https://media.example/a b.gif', { fetch });

		expect(result?.ok).toBe(true);
		expect(fetch).toHaveBeenNthCalledWith(
			2,
			'https://wsrv.nl/?url=https%3A%2F%2Fmedia.example%2Fa%20b.gif',
			{ mode: 'cors' }
		);
	});

	it('does not proxy requests explicitly marked direct-only', async () => {
		const fetch = vi.fn().mockRejectedValue(new TypeError('CORS blocked'));

		await expect(
			fetchRemoteMedia('https://media.example/video.mp4', { proxy: false, fetch })
		).resolves.toBeNull();

		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('does not proxy a wsrv URL again', async () => {
		const fetch = vi.fn().mockResolvedValue(new Response('', { status: 500 }));

		await expect(
			fetchRemoteMedia('https://wsrv.nl/?url=https%3A%2F%2Fexample.com', { fetch })
		).resolves.toBeNull();

		expect(fetch).toHaveBeenCalledTimes(1);
	});
});
