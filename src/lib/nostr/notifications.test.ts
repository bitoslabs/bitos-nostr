import { describe, expect, it } from 'vitest';
import { parseNotificationContent, parseZapAmount, zapSenderPubkey } from './notifications.svelte';
import type { Event } from './types';

describe('parseNotificationContent', () => {
	it('returns plain text unchanged', () => {
		expect(parseNotificationContent('Hello world')).toBe('Hello world');
	});

	it('unwraps JSON string payloads', () => {
		const content = JSON.stringify({ content: 'Hello from another client' });
		expect(parseNotificationContent(content)).toBe('Hello from another client');
	});

	it('unwraps nested JSON payloads recursively', () => {
		const content = JSON.stringify({ content: JSON.stringify({ text: 'Nested text' }) });
		expect(parseNotificationContent(content)).toBe('Nested text');
	});

	it('returns raw content on invalid JSON', () => {
		expect(parseNotificationContent('{invalid json')).toBe('{invalid json');
	});

	it('supports giphy style content with emoji and line breaks', () => {
		const example =
			'https://media0.giphy.com/media/v4YXtWE6EOhiP8zN1S/giphy.gif?cid=4ea4f8d5f7c9e68k7k21oivn01882g8ugwe5h8stsbsydku4&ep=v1_gifs_search&rid=giphy.gif&ct=g \n\n ❤️';
		expect(parseNotificationContent(example)).toBe(example);
	});
});

describe('zapSenderPubkey', () => {
	it('uses the zap request author instead of the receipt-publishing wallet', () => {
		const sender = 'e4ae5f87cc744e4eaf6f640c4f1b8e37e3229c0c993ab211053405c484869a93';
		const wallet = '8fe53b37518e3dbe9bab26d912292001d8b882de9456b7b08b615f912dc8bf4a';
		const receipt: Event = {
			id: 'receipt',
			pubkey: wallet,
			kind: 9735,
			created_at: 1,
			content: '',
			tags: [
				[
					'description',
					JSON.stringify({ kind: 9734, pubkey: sender.toUpperCase(), content: '', tags: [] })
				]
			],
			sig: ''
		};

		expect(zapSenderPubkey(receipt)).toBe(sender);
	});

	it('falls back to the receipt author when the embedded request is malformed', () => {
		const receipt = {
			id: 'receipt',
			pubkey: 'wallet',
			kind: 9735,
			created_at: 1,
			content: '',
			tags: [['description', 'not-json']],
			sig: ''
		} satisfies Event;

		expect(zapSenderPubkey(receipt)).toBe('wallet');
	});
});

describe('parseZapAmount', () => {
	it('falls back to the embedded zap request amount', () => {
		const description = JSON.stringify({ tags: [['amount', '21000']] });
		expect(parseZapAmount([['description', description]])).toBe(21);
	});

	it('prefers the receipt amount tag when present', () => {
		expect(parseZapAmount([['amount', '50000'], ['description', JSON.stringify({ tags: [['amount', '21000']] })]])).toBe(50);
	});
});
