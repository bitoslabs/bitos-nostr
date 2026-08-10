import { describe, expect, it } from 'vitest';
import { sensitiveMediaReason } from './sensitive-media';

describe('sensitive media reasons', () => {
	it('prefers the event content-warning tag', () => {
		expect(sensitiveMediaReason([['content-warning', 'Graphic violence']], '')).toBe(
			'Graphic violence'
		);
	});

	it('supports per-attachment metadata', () => {
		expect(
			sensitiveMediaReason([], '', { contentWarning: 'Spoilers', sensitive: 'true' })
		).toBe('Spoilers');
		expect(sensitiveMediaReason([], '', { sensitive: 'Graphic violence' })).toBe('Graphic violence');
	});
});
