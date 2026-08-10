import { describe, expect, it } from 'vitest';
import { extractNotificationMedia, parseImeta } from './imeta';

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
});
