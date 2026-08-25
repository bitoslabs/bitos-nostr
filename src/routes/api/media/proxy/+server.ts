import { error } from '@sveltejs/kit';

const MAX_REDIRECTS = 3;

function isAllowedRemoteUrl(value: string): URL | null {
	try {
		const url = new URL(value);
		const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
		if (
			url.protocol !== 'https:' ||
			host === 'localhost' ||
			host.endsWith('.localhost') ||
			host.endsWith('.local') ||
			host === '0.0.0.0' ||
			host === '::1' ||
			host.startsWith('::ffff:') ||
			host.startsWith('127.') ||
			host.startsWith('10.') ||
			host.startsWith('169.254.') ||
			host.startsWith('192.168.') ||
			/^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
			/^(fc|fd|fe80:)/.test(host)
		) {
			return null;
		}
		return url;
	} catch {
		return null;
	}
}

/**
 * Same-origin media relay for hosts such as BTTV that serve valid public
 * images but decline browser CORS requests. Redirects are checked too, so a
 * public URL cannot bounce the server to a local address.
 */
export async function GET({ url, fetch }: { url: URL; fetch: typeof globalThis.fetch }) {
	let target = isAllowedRemoteUrl(url.searchParams.get('url') ?? '');
	if (!target) error(400, 'A public HTTPS media URL is required');

	for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
		let upstream: Response;
		try {
			upstream = await fetch(target, { redirect: 'manual' });
		} catch {
			error(502, 'Could not retrieve remote media');
		}

		if (upstream.status >= 300 && upstream.status < 400) {
			const location = upstream.headers.get('location');
			target = location ? isAllowedRemoteUrl(new URL(location, target).href) : null;
			if (!target) error(400, 'Remote media redirect is not allowed');
			continue;
		}

		if (!upstream.ok || !upstream.body) error(502, 'Remote media request failed');
		const headers = new Headers();
		const contentType = upstream.headers.get('content-type');
		const contentLength = upstream.headers.get('content-length');
		if (contentType) headers.set('content-type', contentType);
		if (contentLength) headers.set('content-length', contentLength);
		headers.set('cache-control', 'public, max-age=3600');
		return new Response(upstream.body, { status: 200, headers });
	}

	error(502, 'Too many remote media redirects');
}
