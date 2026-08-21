/**
 * Shared media helpers used by the reels-style surfaces (Bitz explore grid,
 * Bitz search results, Discover media tab).
 */

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
