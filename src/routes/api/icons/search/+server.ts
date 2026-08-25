import { json } from '@sveltejs/kit';

const ICONIFY_SEARCH_URL = 'https://api.iconify.design/search';

/** Same-origin relay for the sticker picker. It avoids client CSP/CORS rules
 * preventing a typed search, while keeping the public Iconify response small. */
export async function GET({ url, fetch }: { url: URL; fetch: typeof globalThis.fetch }) {
	const query = (url.searchParams.get('q') ?? '').trim().slice(0, 80);
	if (!query) return json({ icons: [] });

	try {
		const upstream = await fetch(
			`${ICONIFY_SEARCH_URL}?query=${encodeURIComponent(query)}&limit=48`
		);
		if (!upstream.ok) return json({ icons: [] }, { status: 502 });
		const data = (await upstream.json()) as { icons?: unknown };
		const icons = Array.isArray(data.icons)
			? data.icons.filter((icon): icon is string => typeof icon === 'string').slice(0, 48)
			: [];
		return json(
			{ icons },
			{ headers: { 'cache-control': 'public, max-age=3600, s-maxage=86400' } }
		);
	} catch {
		return json({ icons: [] }, { status: 502 });
	}
}
