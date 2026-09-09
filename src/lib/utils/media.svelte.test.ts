import { describe, expect, it, vi } from 'vitest';
import { mirrorSrc } from './media';

/**
 * mirrorSrc (browser) — dead-CDN recovery for plain <img>/<video> tiles.
 * The first test drives a REAL load failure (invalid data URI → error event
 * → mirror swap → bytes decode); the rest dispatch synthetic error events to
 * pin the chain-walking logic deterministically.
 */

const BAD = 'data:image/png;base64,not-valid';
// 1×1 transparent PNG.
const GOOD =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
	return new Promise((resolve, reject) => {
		const started = Date.now();
		const tick = () => {
			if (predicate()) return resolve();
			if (Date.now() - started > timeoutMs) return reject(new Error('condition not met in time'));
			setTimeout(tick, 25);
		};
		tick();
	});
}

describe('mirrorSrc (browser)', () => {
	it('advances an <img> to the mirror when the canonical URL dies', async () => {
		const img = document.createElement('img');
		const action = mirrorSrc(img, { sources: [BAD, GOOD] });
		document.body.append(img);
		try {
			img.src = BAD;
			// The mirror must actually load — naturalWidth only goes non-zero
			// once the fallback bytes decoded.
			await waitFor(() => img.naturalWidth > 0);
			expect(img.src).toContain('iVBOR');
		} finally {
			action.destroy?.();
			img.remove();
		}
	});

	it('walks the chain one hop per error and fires onExhausted at the end', () => {
		const onExhausted = vi.fn();
		const img = document.createElement('img');
		const action = mirrorSrc(img, {
			sources: ['https://a.example/x.png', 'https://b.example/x.png'],
			onExhausted
		});
		try {
			img.dispatchEvent(new Event('error'));
			expect(img.getAttribute('src')).toBe('https://b.example/x.png');
			expect(onExhausted).not.toHaveBeenCalled();
			img.dispatchEvent(new Event('error'));
			expect(onExhausted).toHaveBeenCalledTimes(1);
			// Stays on the last candidate — removal is the host's call.
			expect(img.getAttribute('src')).toBe('https://b.example/x.png');
		} finally {
			action.destroy?.();
		}
	});

	it('stops listening after destroy', () => {
		const onExhausted = vi.fn();
		const img = document.createElement('img');
		const action = mirrorSrc(img, {
			sources: ['https://a.example/x.png', 'https://b.example/x.png'],
			onExhausted
		});
		action.destroy?.();
		img.dispatchEvent(new Event('error'));
		expect(img.getAttribute('src')).toBeNull();
		expect(onExhausted).not.toHaveBeenCalled();
	});

	it('advances <video> elements the same way', () => {
		const video = document.createElement('video');
		const action = mirrorSrc(video, {
			sources: ['https://a.example/x.mp4', 'https://b.example/x.mp4']
		});
		try {
			video.dispatchEvent(new Event('error'));
			expect(video.getAttribute('src')).toBe('https://b.example/x.mp4');
		} finally {
			action.destroy?.();
		}
	});
});
