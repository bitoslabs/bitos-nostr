import { describe, expect, it } from 'vitest';
import {
	extractHashtagTags,
	isEventReference,
	parseContent,
	stripNostrPrefix
} from './note-content';

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

	it('detects and normalizes case-insensitive Nostr URIs', () => {
		const entity =
			'nprofile1qyt8wumn8ghj7un9d3shjtnyd968gmewwp6kytcqypcth4ufkrw76n4xgewj60rvn4nj9fp05m2e5f0x09vnc48u3z2tc5648nk';

		expect(parseContent(`Nostr: ${entity}`)).toEqual([
			{ type: 'nostr', value: `Nostr: ${entity}` }
		]);
		expect(parseContent(`Nostr:${entity}`)).toEqual([{ type: 'nostr', value: `Nostr:${entity}` }]);
		expect(stripNostrPrefix(`Nostr: ${entity}`)).toBe(entity);
	});

	it('recognizes naddr references for addressable events', () => {
		const address =
			'naddr1qvzqqqy0kvpzqj8fwczhhuk0zvesyq64khfy87xasyl3jvz3689sgsfcjn6x4nzrqqwhgunpvd4j6vfh8q6njdf4xqcnsd3s8ykk2emhd9ukzcm80ylvsgg2';

		expect(isEventReference(`nostr:${address}`)).toBe(true);
		expect(parseContent(`Listen: nostr:${address}`)).toContainEqual({
			type: 'nostr',
			value: `nostr:${address}`
		});
	});
});
