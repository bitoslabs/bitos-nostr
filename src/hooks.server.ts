import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	if (
		event.url.pathname === '/api/media/upload' &&
		event.request.headers.get('origin') === 'https://bitos.space'
	) {
		response.headers.set('Access-Control-Allow-Origin', 'https://bitos.space');
		response.headers.append('Vary', 'Origin');
	}
	return response;
};
