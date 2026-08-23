import { describe, expect, it } from 'vitest';
import { extractNotificationMedia } from './imeta';

describe('extractor fallback chains (READ-003)', () => {
	it('carries imeta fallback mirrors in order, deduped, sans self', () => {
		const tags = [
			[
				'imeta',
				'url https://cdn.example/v.mp4',
				'm video/mp4',
				'fallback https://cdn.example/v.mp4',
				'fallback https://mirror.example/v.mp4',
				'fallback https://mirror.example/v.mp4',
				'fallback https://cdn2.example/v.mp4'
			]
		];
		const media = extractNotificationMedia({ content: '', tags });
		expect(media[0]?.fallbacks).toEqual([
			'https://mirror.example/v.mp4',
			'https://cdn2.example/v.mp4'
		]);
	});

	it('gathers extra same-kind content URLs as implicit video mirrors', () => {
		const media = extractNotificationMedia({
			content: 'source https://v.example/hires.mp4 and https://mirror.example/lores.mp4',
			tags: [['imeta', 'url https://v.example/hires.mp4', 'm video/mp4']]
		});
		expect(media).toHaveLength(1);
		expect(media[0]?.fallbacks).toEqual(['https://mirror.example/lores.mp4']);
	});

	it('never mixes kinds — a poster image URL does not mirror a video', () => {
		const media = extractNotificationMedia({
			content: 'v https://v.example/a.mp4 poster https://v.example/a.jpg',
			tags: [['imeta', 'url https://v.example/a.mp4', 'm video/mp4']]
		});
		expect(media).toHaveLength(2);
		expect(media[0]?.fallbacks).toBeUndefined();
	});

	it('stores imeta fallbacks on images too — consumers gate players, not data', () => {
		const url = 'https://cdn.example/pic.jpg';
		const media = extractNotificationMedia({
			content: url,
			tags: [['imeta', `url ${url}`, 'm image/jpeg', 'fallback https://mirror.example/pic.jpg']]
		});
		expect(media[0]?.kind).toBe('image');
		// The extractor is renderer-agnostic; the implicit same-kind gather is
		// the player-chain gated path (see video tests above). imeta-declared
		// mirrors are kept regardless of kind for future <img> failover.
		expect(media[0]?.fallbacks).toEqual(['https://mirror.example/pic.jpg']);
	});
});
