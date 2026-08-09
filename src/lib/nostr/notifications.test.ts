import { describe, expect, it } from 'vitest';
import { parseNotificationContent } from './notifications.svelte';

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
