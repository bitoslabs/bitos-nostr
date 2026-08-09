import { describe, expect, it } from 'vitest';
import { rewriteMentions } from './nip27';

describe('rewriteMentions', () => {
	it('replaces @mentions with nostr:npub references when followed by punctuation', () => {
		const content = 'Hello @alice, please meet @bob. Thanks @carol!';
		const mentions = [
			{ name: 'alice', npub: 'npub1alice' },
			{ name: 'bob', npub: 'npub1bob' },
			{ name: 'carol', npub: 'npub1carol' }
		];

		expect(rewriteMentions(content, mentions)).toBe(
			'Hello nostr:npub1alice, please meet nostr:npub1bob. Thanks nostr:npub1carol!'
		);
	});

	it('does not replace mentions that are part of longer words', () => {
		const content = 'This is @alicebob and @bobtest';
		const mentions = [
			{ name: 'alice', npub: 'npub1alice' },
			{ name: 'bob', npub: 'npub1bob' }
		];

		expect(rewriteMentions(content, mentions)).toBe(content);
	});
});
