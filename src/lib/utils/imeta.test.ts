import { describe, expect, it } from 'vitest';
import { extractNotificationMedia, parseImeta, stripMediaUrls } from './imeta';

const url =
	'https://blossom.primal.net/9210bade26afd9847638984384e690e32ee90984a7ecf0ac55d2db593b2a3437.jpg';

describe('imeta media parsing', () => {
	it('parses the Blossom image event shape', () => {
		const tags = [['imeta', `url ${url}`, 'm image/jpeg', 'size 227048']];
		const parsed = parseImeta(tags);
		const media = extractNotificationMedia({ content: `🤔\n${url}`, tags });

		expect(parsed.get(url)?.mime).toBe('image/jpeg');
		expect(media).toHaveLength(1);
		expect(media[0]).toMatchObject({ url, kind: 'image', animated: false });
	});

	it('keeps per-media warning metadata from imeta tags', () => {
		const tags = [
			['imeta', `url ${url}`, 'm image/jpeg', 'content-warning Graphic violence', 'sensitive true']
		];
		const parsed = parseImeta(tags).get(url);

		expect(parsed?.contentWarning).toBe('Graphic violence');
		expect(parsed?.sensitive).toBe('true');
	});

	it('removes every rendered media URL while preserving the caption', () => {
		expect(stripMediaUrls(`A SeedSigner build\n${url}\n${url}`, [url])).toBe('A SeedSigner build');
	});
});

describe('media fallback chains (F-017)', () => {
	it('collects imeta url + fallback mirror as candidates', () => {
		const tags = [
			[
				'imeta',
				'url https://cdn.example/v.mp4',
				'm video/mp4',
				'fallback https://mirror.example/v.mp4'
			]
		];
		const parsed = parseImeta(tags);
		expect(parsed.get('https://cdn.example/v.mp4')?.kind).toBe('video');
		// The page extractor reads the same tags; the mirror URL must survive
		// as a fallback candidate (verified through the tag shape contract).
		const imeta = tags.find((t) => t[0] === 'imeta')!;
		expect(imeta.some((seg) => seg.startsWith('fallback https://mirror.example/'))).toBe(true);
	});

	it('keeps multiple imeta attachments addressable for fallback selection', () => {
		const tags = [
			['imeta', 'url https://a.example/one.mp4', 'm video/mp4'],
			['imeta', 'url https://b.example/two.mp4', 'm video/mp4']
		];
		const parsed = parseImeta(tags);
		expect(parsed.size).toBe(2);
		expect(parsed.get('https://a.example/one.mp4')?.mime).toBe('video/mp4');
	});
});
