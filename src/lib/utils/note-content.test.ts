import { describe, expect, it } from 'vitest';
import { extractHashtagTags } from './note-content';

describe('extractHashtagTags', () => {
	it('converts hashtags to normalized unique t tags', () => {
		expect(extractHashtagTags('Hello #BitOS and #nostr — hello #bitos')).toEqual([
			['t', 'bitos'],
			['t', 'nostr']
		]);
	});

	it('does not treat URL fragments as hashtags', () => {
		expect(extractHashtagTags('https://example.com/page#section')).toEqual([]);
	});
});
