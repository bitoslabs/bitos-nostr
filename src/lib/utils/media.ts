/**
 * Shared media helpers used by the reels-style surfaces (Bitz explore grid,
 * Bitz search results, Discover media tab).
 */

/**
 * Svelte action: dead-CDN recovery for plain `<img>`/`<video>` tiles.
 *
 * Mirrors the full MediaPlayer fallback chain (F-017): when the element's
 * current src fails to load, advance to the next URL in `sources` — the
 * canonical URL first, then the ordered NIP-92 `fallback` mirrors. When the
 * chain is exhausted, `onExhausted` fires so the host can mark the tile
 * failed; the action never removes or hides the element itself.
 */
export function mirrorSrc(
	node: HTMLImageElement | HTMLVideoElement | HTMLAudioElement,
	params: { sources: string[]; onExhausted?: () => void }
) {
	let chain = dedupeSources(params.sources);
	let index = 0;
	function onError() {
		if (index < chain.length - 1) {
			index += 1;
			node.src = chain[index];
			return;
		}
		params.onExhausted?.();
	}
	node.addEventListener('error', onError);
	return {
		update(next: { sources: string[]; onExhausted?: () => void }) {
			params = next;
			chain = dedupeSources(next.sources);
			if (index >= chain.length) index = 0;
		},
		destroy() {
			node.removeEventListener('error', onError);
		}
	};
}

function dedupeSources(sources: string[]): string[] {
	return [...new Set(sources.filter(Boolean))];
}

/**
 * Svelte action: videos start at `preload="none"` and only pull metadata
 * (the moov atom powering duration badges) once the element nears the
 * viewport. On a long grid scroll this skips hundreds of off-screen header
 * requests. Falls back to eager metadata when IntersectionObserver is
 * unavailable (older browsers, SSR-adjacent environments).
 */
export function lazyVideoMetadata(node: HTMLVideoElement) {
	if (typeof IntersectionObserver === 'undefined') {
		node.preload = 'metadata';
		return {};
	}
	const observer = new IntersectionObserver(
		(entries) => {
			if (!entries.some((entry) => entry.isIntersecting)) return;
			node.preload = 'metadata';
			observer.disconnect();
		},
		{ rootMargin: '300px' }
	);
	observer.observe(node);
	return { destroy: () => observer.disconnect() };
}
