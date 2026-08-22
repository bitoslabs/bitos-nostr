/**
 * Stories store — slide parsing tests.
 *
 * Verifies that expired stories are dropped and that attached images are
 * extracted from either a NIP-92 `imeta` tag or an image URL in the content.
 */
import { describe, expect, it } from 'vitest';
import { parseSlide, MAX_STORY_IMAGES } from './stories.svelte';
import type { Event } from 'nostr-tools/pure';

const PK = 'a'.repeat(64);

function fakeEvent(partial: Partial<Event>): Event {
	return {
		id: partial.id ?? 'e1',
		pubkey: partial.pubkey ?? PK,
		created_at: partial.created_at ?? Math.floor(Date.now() / 1000),
		kind: 30315,
		content: partial.content ?? '',
		tags: partial.tags ?? [],
		sig: ''
	} as Event;
}

describe('stories.parseSlide', () => {
	it('keeps a fresh text slide and defaults expiration to 24h', () => {
		const now = Math.floor(Date.now() / 1000);
		const slide = parseSlide(fakeEvent({ content: 'hello world', created_at: now }));
		expect(slide).not.toBeNull();
		expect(slide?.content).toBe('hello world');
		expect(slide?.imageUrl).toBeUndefined();
		expect(slide?.expiresAt).toBe(now + 24 * 60 * 60);
	});

	it('drops an expired slide', () => {
		const past = Math.floor(Date.now() / 1000) - 100;
		const slide = parseSlide(
			fakeEvent({ created_at: past, tags: [['expiration', String(past + 1)]] })
		);
		expect(slide).toBeNull();
	});

	it('extracts an image from a NIP-92 imeta url line', () => {
		const slide = parseSlide(
			fakeEvent({
				content: 'nice view',
				tags: [['imeta', 'url https://cdn.example.com/pic.png']]
			})
		);
		expect(slide?.imageUrl).toBe('https://cdn.example.com/pic.png');
	});

	it('falls back to the first image URL found in content', () => {
		const slide = parseSlide(fakeEvent({ content: 'see https://cdn.example.com/a.jpg and more' }));
		expect(slide?.imageUrl).toBe('https://cdn.example.com/a.jpg');
		expect(slide?.content).toBe('see and more');
	});

	it('uses a Cloudinary image URL wrapped in markdown as the story media', () => {
		const url =
			'https://res.cloudinary.com/doqyvdhvo/image/upload/v1785303517/bitos/ab7pjrxvsbz1otowtfhq.png';
		const slide = parseSlide(fakeEvent({ content: `**${url}**` }));
		expect(slide?.imageUrl).toBe(url);
		expect(slide?.content).toBe('');
	});

	it('preserves the chosen background gradient via the `background` tag', () => {
		const gradient = 'linear-gradient(135deg, #8b5cf6, #ec4899)';
		const slide = parseSlide(fakeEvent({ content: 'mood', tags: [['background', gradient]] }));
		expect(slide?.bg).toBe(gradient);
	});

	it('captures the `d` tag so likes/replies can target the story address', () => {
		const slide = parseSlide(fakeEvent({ content: 'vibes', tags: [['d', 'bitos-story-42-abc']] }));
		expect(slide?.d).toBe('bitos-story-42-abc');
	});

	it('reads the NIP-13 difficulty of a mined slide from its nonce tag + id', () => {
		const id = '0'.repeat(5) + 'a'.repeat(59); // 20 leading zero bits
		const slide = parseSlide(fakeEvent({ id, tags: [['nonce', '918273', '20']] }));
		expect(slide?.pow).toBe(20);
	});

	it('reports no PoW when the slide was not mined', () => {
		const slide = parseSlide(fakeEvent({ content: 'plain story' }));
		expect(slide?.pow).toBeUndefined();
	});

	it('reads alt text and the sensitive flag for image slides', () => {
		const slide = parseSlide(
			fakeEvent({
				content: 'caption https://cdn.example.com/pic.png',
				tags: [
					['imeta', 'url https://cdn.example.com/pic.png', 'alt A sunset over the ocean'],
					['content-warning', 'Sensitive media']
				]
			})
		);
		expect(slide?.imageUrl).toBe('https://cdn.example.com/pic.png');
		expect(slide?.alt).toBe('A sunset over the ocean');
		expect(slide?.sensitive).toBe(true);
	});

	it('is not sensitive without a content-warning tag', () => {
		const slide = parseSlide(
			fakeEvent({ tags: [['imeta', 'url https://cdn.example.com/pic.png']] })
		);
		expect(slide?.sensitive).toBe(false);
		expect(slide?.alt).toBeUndefined();
	});

	it('collects every imeta image into a carousel in author order', () => {
		const slide = parseSlide(
			fakeEvent({
				content: 'trip!',
				tags: [
					['imeta', 'url https://cdn.example.com/1.png'],
					['imeta', 'url https://cdn.example.com/2.gif', 'alt two gifs'],
					['imeta', 'url https://cdn.example.com/3.jpg']
				]
			})
		);
		expect(slide?.images).toEqual([
			'https://cdn.example.com/1.png',
			'https://cdn.example.com/2.gif',
			'https://cdn.example.com/3.jpg'
		]);
		// imageUrl stays the primary image for single-image consumers.
		expect(slide?.imageUrl).toBe('https://cdn.example.com/1.png');
		expect(slide?.content).toBe('trip!');
	});

	it('dedupes imeta urls against bare links in the content', () => {
		const slide = parseSlide(
			fakeEvent({
				content: 'see https://cdn.example.com/a.png and https://cdn.example.com/b.png',
				tags: [['imeta', 'url https://cdn.example.com/b.png']]
			})
		);
		// imeta order wins; the duplicate bare link is dropped.
		expect(slide?.images).toEqual([
			'https://cdn.example.com/b.png',
			'https://cdn.example.com/a.png'
		]);
		expect(slide?.content).toBe('see and');
	});

	it('strips every attached image URL out of multi-image captions', () => {
		const slide = parseSlide(
			fakeEvent({
				content: 'one https://cdn.example.com/1.png two https://cdn.example.com/2.png three',
				tags: [
					['imeta', 'url https://cdn.example.com/1.png'],
					['imeta', 'url https://cdn.example.com/2.png']
				]
			})
		);
		expect(slide?.content).toBe('one two three');
	});

	it('caps the carousel at MAX_STORY_IMAGES images', () => {
		const tags = Array.from(
			{ length: 10 },
			(_, i) => ['imeta', `url https://cdn.example.com/${i}.png`] as string[]
		);
		const slide = parseSlide(fakeEvent({ content: 'many', tags }));
		expect(slide?.images?.length).toBe(MAX_STORY_IMAGES);
		expect(slide?.images?.[5]).toBe('https://cdn.example.com/5.png');
	});
});
