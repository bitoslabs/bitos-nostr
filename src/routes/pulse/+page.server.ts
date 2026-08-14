import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';

export function load() {
	// The Pulse screen is a development-only UI showcase. Guard it on the
	// server so production deployments cannot render it by navigating directly.
	if (!dev) error(404, 'Not found');
}
