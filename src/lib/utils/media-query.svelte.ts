/**
 * Reactive media query — `createMediaQuery('(max-width: 1023px)')` returns a
 * handle whose `.current` is live `$state`, flipping with the viewport. Used
 * to auto-select the mobile-native studio shell (docs/studio-mobile-ux.md).
 *
 * Must be created during component init (it registers an effect cleanup).
 * SSR-safe: reads `false` on the server (shells then hydrate on mount).
 */

import { browser } from '$app/environment';

export function createMediaQuery(query: string): { readonly current: boolean } {
	let matches = $state(false);

	$effect(() => {
		if (!browser) return;
		const mql = window.matchMedia(query);
		const update = () => (matches = mql.matches);
		update();
		mql.addEventListener('change', update);
		return () => mql.removeEventListener('change', update);
	});

	return {
		get current() {
			return matches;
		}
	};
}
