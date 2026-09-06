import { describe, expect, it } from 'vitest';
import {
	commentTarget,
	parseNotificationContent,
	parseZapAmount,
	zapSenderPubkey
} from './notifications.svelte';
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
		expect(
			parseZapAmount([
				['amount', '50000'],
				['description', JSON.stringify({ tags: [['amount', '21000']] })]
			])
		).toBe(50);
	});
});

describe('commentTarget', () => {
	const ME = 'a'.repeat(64);
	const OTHER = 'b'.repeat(64);
	const RELAY = 'wss://relay.damus.io';

	it('surfaces the post for a top-level comment on my video', () => {
		const tags = [
			['E', 'video1', RELAY, ME],
			['K', '22'],
			['P', ME, RELAY],
			['e', 'video1', RELAY, ME],
			['k', '22'],
			['p', ME, RELAY]
		];
		expect(commentTarget(tags, ME)).toEqual({
			id: 'video1',
			kind: 'note',
			rootKind: 22,
			mine: true
		});
	});

	it('surfaces the parent comment for a reply to my comment', () => {
		const tags = [
			['E', 'video1', RELAY, OTHER],
			['K', '22'],
			['P', OTHER, RELAY],
			['e', 'mycomment', RELAY, ME],
			['k', '1111'],
			['p', OTHER, RELAY],
			['p', ME, RELAY]
		];
		expect(commentTarget(tags, ME)).toEqual({
			id: 'mycomment',
			kind: 'comment',
			rootKind: 22,
			mine: true
		});
	});

	it('still opens the post — not a stranger comment — for replies under my video', () => {
		const tags = [
			['E', 'video1', RELAY, ME],
			['K', '22'],
			['P', ME, RELAY],
			['e', 'bobcomment', RELAY, OTHER],
			['k', '1111'],
			['p', ME, RELAY],
			['p', OTHER, RELAY]
		];
		expect(commentTarget(tags, ME)).toEqual({
			id: 'video1',
			kind: 'note',
			rootKind: 22,
			mine: true
		});
	});

	it('marks a comment that only mentions me as not mine (inline mention)', () => {
		const tags = [
			['E', 'video1', RELAY, OTHER],
			['K', '22'],
			['P', OTHER, RELAY],
			['e', 'video1', RELAY, OTHER],
			['k', '22'],
			['p', OTHER, RELAY],
			['p', ME, RELAY]
		];
		expect(commentTarget(tags, ME)).toEqual({
			id: 'video1',
			kind: 'note',
			rootKind: 22,
			mine: false
		});
	});

	it('falls back to the parent kind tag when no author hints exist', () => {
		expect(
			commentTarget(
				[
					['E', 'video1'],
					['K', '22'],
					['e', 'video1'],
					['k', '22']
				],
				ME
			)
		).toEqual({ id: 'video1', kind: 'note', rootKind: 22, mine: true });
		expect(
			commentTarget(
				[
					['E', 'video1'],
					['K', '22'],
					['e', 'comment1'],
					['k', '1111']
				],
				ME
			)
		).toEqual({ id: 'comment1', kind: 'comment', rootKind: 22, mine: true });
	});

	it('matches author hints case-insensitively', () => {
		const tags = [
			['E', 'pic1', RELAY, ME.toUpperCase()],
			['K', '20']
		];
		expect(commentTarget(tags, ME)).toEqual({
			id: 'pic1',
			kind: 'note',
			rootKind: 20,
			mine: true
		});
	});
});
