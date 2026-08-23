import { describe, expect, it } from 'vitest';
import {
	BITZ_MEDIA_KINDS,
	BITZ_VIDEO_KINDS,
	buildKind22,
	latestAddressableEvents,
	parseBitz,
	selectRendition,
	validateBitzMedia
} from './bitz-codec';
import { NOSTR_KINDS } from './types';

describe('parseBitz', () => {
	it('parses kind 20 image events via imeta (MIME authoritative)', () => {
		const media = parseBitz({
			kind: NOSTR_KINDS.PICTURE,
			content: 'sunset https://cdn.example.com/pic.jpg',
			tags: [['imeta', 'url https://cdn.example.com/pic.jpg', 'm image/jpeg', 'dim 1080x1350']]
		});
		expect(media).toEqual({
			url: 'https://cdn.example.com/pic.jpg',
			type: 'image',
			fallbacks: [],
			address: ''
		});
	});

	it('collects multi-photo kind-20 fallbacks from content URLs', () => {
		const media = parseBitz({
			kind: NOSTR_KINDS.PICTURE,
			content: 'album https://a.example.com/1.jpg and https://a.example.com/2.jpg',
			tags: [['imeta', 'url https://a.example.com/1.jpg', 'm image/jpeg']]
		});
		expect(media?.url).toBe('https://a.example.com/1.jpg');
		expect(media?.fallbacks).toEqual(['https://a.example.com/2.jpg']);
	});

	it('parses video events on every Bitz video kind (21/22/34235/34236)', () => {
		for (const kind of BITZ_VIDEO_KINDS) {
			const media = parseBitz({
				kind,
				content: 'clip https://v.example.com/a.mp4',
				tags: [['imeta', 'url https://v.example.com/a.mp4', 'm video/mp4']]
			});
			expect(media?.type).toBe('video');
			expect(media?.url).toBe('https://v.example.com/a.mp4');
		}
	});

	it('builds an address for addressable video events (34235/34236)', () => {
		const media = parseBitz({
			kind: NOSTR_KINDS.ADDRESSABLE_VIDEO,
			content: 'reel https://v.example.com/b.mp4',
			tags: [
				['d', 'profile-reel'],
				['imeta', 'url https://v.example.com/b.mp4', 'm video/mp4']
			],
			id: 'evt'.padEnd(64, '0'),
			pubkey: 'abc'.padEnd(64, '0')
		});
		expect(media?.address).toBe(
			`${NOSTR_KINDS.ADDRESSABLE_VIDEO}:abc`.padEnd(70, '0') + ':profile-reel'
		);
	});

	it('treats a legacy kind-1 note as video when content carries a video URL', () => {
		const media = parseBitz({
			kind: NOSTR_KINDS.TEXT_NOTE,
			content: 'watch this https://media.example.com/clip.webm',
			tags: []
		});
		expect(media?.type).toBe('video');
		expect(media?.url).toBe('https://media.example.com/clip.webm');
	});

	it('returns null for text-only kind-1 notes', () => {
		expect(parseBitz({ kind: NOSTR_KINDS.TEXT_NOTE, content: 'just words', tags: [] })).toBeNull();
	});

	it('never treats an image-MIME imeta as video, even with a video-ish URL path', () => {
		const media = parseBitz({
			kind: NOSTR_KINDS.SHORT_VIDEO,
			content: 'https://cdn.example.com/upload/video.mp4?arty=1',
			tags: [['imeta', 'url https://cdn.example.com/upload/video.mp4?arty=1', 'm image/jpeg']]
		});
		// The imeta is authoritative; an image attachment must not become a reel,
		// so a kind-22 event with only image data parses as null.
		expect(media).toBeNull();
	});

	it('falls back to content video URLs with the first as primary and rest as fallbacks', () => {
		const media = parseBitz({
			kind: NOSTR_KINDS.VIDEO,
			content: 'mirrors: https://v.example.com/one.mp4 https://mirror.example.com/two.mp4',
			tags: []
		});
		expect(media?.url).toBe('https://v.example.com/one.mp4');
		expect(media?.fallbacks).toEqual(['https://mirror.example.com/two.mp4']);
	});

	it('includes imeta fallbackrendition URLs as video fallbacks', () => {
		const media = parseBitz({
			kind: NOSTR_KINDS.VIDEO,
			content: 'source https://v.example.com/hires.mp4',
			tags: [
				[
					'imeta',
					'url https://v.example.com/hires.mp4',
					'm video/mp4',
					'fallback https://v.example.com/lores.mp4'
				]
			]
		});
		expect(media?.url).toBe('https://v.example.com/hires.mp4');
		expect(media?.fallbacks).toEqual(['https://v.example.com/lores.mp4']);
	});

	it('collects every imeta fallback mirror in order without duplicates', () => {
		const media = parseBitz({
			kind: NOSTR_KINDS.SHORT_VIDEO,
			content: 'reel https://v.example.com/a.mp4',
			tags: [
				[
					'imeta',
					'url https://v.example.com/a.mp4',
					'm video/mp4',
					'fallback https://v.example.com/a.mp4',
					'fallback https://mirror.example.com/a.mp4',
					'fallback https://mirror.example.com/a.mp4',
					'fallback https://cdn2.example.com/a.mp4'
				]
			]
		});
		expect(media?.fallbacks).toEqual([
			'https://mirror.example.com/a.mp4',
			'https://cdn2.example.com/a.mp4'
		]);
	});

	it('carries validated x/dim/duration metadata from imeta', () => {
		const media = parseBitz({
			kind: NOSTR_KINDS.VIDEO,
			content: 'reel https://v.example.com/a.mp4',
			tags: [
				[
					'imeta',
					'url https://v.example.com/a.mp4',
					'm video/mp4',
					`x ${'ab'.repeat(32)}`,
					'dim 1080x1920',
					'duration 8.4'
				]
			]
		});
		expect(media?.hash).toBe('ab'.repeat(32));
		expect(media?.dim).toBe('1080x1920');
		expect(media?.duration).toBe(8.4);
	});

	it('drops malformed optional metadata instead of failing the parse', () => {
		const media = parseBitz({
			kind: NOSTR_KINDS.VIDEO,
			content: 'reel https://v.example.com/a.mp4',
			tags: [
				[
					'imeta',
					'url https://v.example.com/a.mp4',
					'm video/mp4',
					'x not-a-hash',
					'dim not-dims',
					'duration -1'
				]
			]
		});
		expect(media?.url).toBe('https://v.example.com/a.mp4');
		expect(media?.hash).toBeUndefined();
		expect(media?.dim).toBeUndefined();
		expect(media?.duration).toBeUndefined();
	});

	it('decodes the plan §6.2 golden kind-22 sample via content URL only', () => {
		// The §6.2 example relies on the content URL for legacy renderers; the
		// imeta remains authoritative for kind/type/hash/dim/duration.
		const url = 'https://media.example/abc.mp4';
		const media = parseBitz({
			kind: NOSTR_KINDS.SHORT_VIDEO,
			content: `Developer life 😂\n${url}`,
			tags: [
				[
					'imeta',
					`url ${url}`,
					'm video/mp4',
					`x ${'ab'.repeat(32)}`,
					'dim 1080x1920',
					'duration 8.4'
				]
			]
		});
		expect(media).toMatchObject({
			url,
			type: 'video',
			hash: 'ab'.repeat(32),
			dim: '1080x1920',
			duration: 8.4
		});
	});

	it('ignores audio-only events', () => {
		expect(
			parseBitz({
				kind: NOSTR_KINDS.TEXT_NOTE,
				content: 'listen https://a.example.com/track.mp3',
				tags: [['imeta', 'url https://a.example.com/track.mp3', 'm audio/mpeg']]
			})
		).toBeNull();
	});

	it('tolerates malformed tags entries', () => {
		const media = parseBitz({
			kind: NOSTR_KINDS.SHORT_VIDEO,
			content: 'ok https://v.example.com/x.mp4',
			tags: [[]] as unknown as string[][]
		});
		expect(media?.url).toBe('https://v.example.com/x.mp4');
	});

	it('covers every video kind plus picture in BITZ_MEDIA_KINDS', () => {
		expect(BITZ_MEDIA_KINDS).toContain(NOSTR_KINDS.PICTURE);
		for (const kind of BITZ_VIDEO_KINDS) expect(BITZ_MEDIA_KINDS).toContain(kind);
	});
});

describe('buildKind22', () => {
	const baseMedia = {
		url: 'https://v.example.com/reel.mp4',
		mimeType: 'video/mp4',
		bytes: 9_234_567,
		dim: '1080x1920',
		thumb: 'https://v.example.com/thumb.jpg'
	};

	it('emits the golden event shape: imeta segments, content join, defaults', () => {
		const event = buildKind22({
			pubkey: 'pk'.padEnd(64, 'x'),
			caption: 'golden reel',
			media: baseMedia,
			sensitive: false
		});
		expect(event.kind).toBe(22);
		expect(event.content).toBe('golden reel\n\nhttps://v.example.com/reel.mp4');
		expect(event.tags).toEqual([
			[
				'imeta',
				'url https://v.example.com/reel.mp4',
				'm video/mp4',
				'size 9234567',
				'dim 1080x1920',
				'thumb https://v.example.com/thumb.jpg'
			]
		]);
		expect(event.pubkey).toBe('pk'.padEnd(64, 'x'));
		expect(event.created_at).toBeGreaterThan(0);
	});

	it('appends a content-warning tag for sensitive media', () => {
		const event = buildKind22({
			pubkey: 'pk'.padEnd(64, 'x'),
			caption: 'spicy',
			media: baseMedia,
			sensitive: true
		});
		expect(event.tags[1]).toEqual(['content-warning', 'Sensitive content']);
	});

	it('places prefixTags (client/hashtag tags) ahead of the imeta tag', () => {
		const event = buildKind22({
			pubkey: 'pk'.padEnd(64, 'x'),
			caption: 'tagged',
			media: baseMedia,
			sensitive: false,
			prefixTags: [
				['client', 'bitos'],
				['t', 'reels']
			]
		});
		expect(event.tags.slice(0, 2)).toEqual([
			['client', 'bitos'],
			['t', 'reels']
		]);
		expect(event.tags[2]?.[0]).toBe('imeta');
	});

	it('omits optional imeta segments when absent', () => {
		const event = buildKind22({
			pubkey: 'pk'.padEnd(64, 'x'),
			caption: '',
			media: { url: baseMedia.url, mimeType: 'video/mp4' },
			sensitive: false
		});
		expect(event.tags).toEqual([['imeta', 'url https://v.example.com/reel.mp4', 'm video/mp4']]);
		// Empty caption degrades to URL-only content (legacy NIP-92 compat).
		expect(event.content).toBe('https://v.example.com/reel.mp4');
	});

	it('honours the created_at override (used by tests/goldens)', () => {
		const event = buildKind22({
			pubkey: 'pk'.padEnd(64, 'x'),
			caption: 'fixed time',
			media: baseMedia,
			sensitive: false,
			created_at: 42
		});
		expect(event.created_at).toBe(42);
	});

	it('emits x/duration/bitrate segments when provided (§6.2 golden ordering)', () => {
		const event = buildKind22({
			pubkey: 'pk'.padEnd(64, 'x'),
			caption: 'full',
			media: {
				...baseMedia,
				hash: 'ab'.repeat(32),
				duration: 8.4,
				bitrate: 3_500_000
			},
			sensitive: false
		});
		expect(event.tags[0]).toEqual([
			'imeta',
			'url https://v.example.com/reel.mp4',
			'm video/mp4',
			'size 9234567',
			'dim 1080x1920',
			'thumb https://v.example.com/thumb.jpg',
			`x ${'ab'.repeat(32)}`,
			'duration 8.400',
			'bitrate 3500000'
		]);
		// Round-trip: our own encoding parses back with metadata intact.
		expect(parseBitz({ kind: event.kind, content: event.content, tags: event.tags })).toMatchObject(
			{
				url: baseMedia.url,
				type: 'video',
				hash: 'ab'.repeat(32),
				dim: '1080x1920',
				duration: 8.4
			}
		);
	});

	it('skips duration/bitrate when zero or non-finite', () => {
		const event = buildKind22({
			pubkey: 'pk'.padEnd(64, 'x'),
			caption: 'edge',
			media: { ...baseMedia, duration: 0, bitrate: Number.NaN },
			sensitive: false
		});
		expect(event.tags[0]?.some((s) => s.startsWith('duration '))).toBe(false);
		expect(event.tags[0]?.some((s) => s.startsWith('bitrate '))).toBe(false);
	});
});

describe('validateBitzMedia (plan §6.4 pre-signing gate)', () => {
	const valid = {
		url: 'https://v.example.com/reel.mp4',
		hash: 'ab'.repeat(32),
		duration: 8.4,
		dim: '1080x1920',
		fallback: 'https://mirror.example.com/reel.mp4'
	};

	it('accepts a well-formed candidate', () => {
		expect(validateBitzMedia(valid)).toEqual([]);
	});

	it('flags each malformed field independently', () => {
		const issues = validateBitzMedia({
			...valid,
			hash: 'NOT-A-HASH',
			duration: -2,
			dim: '0x100',
			fallback: 'ftp://mirror.example.com/reel.mp4'
		});
		expect(issues.map((i) => i.field)).toEqual(['hash', 'duration', 'dim', 'fallback']);
	});

	it('rejects non-absolute URLs', () => {
		const issues = validateBitzMedia({ url: 'media/reel.mp4' });
		expect(issues).toEqual([{ field: 'url', reason: 'not a valid absolute URL' }]);
	});

	it('enforces https-only under constraint', () => {
		const issues = validateBitzMedia(
			{ ...valid, url: 'http://v.example.com/reel.mp4' },
			{
				httpsOnly: true
			}
		);
		expect(issues.map((i) => i.field)).toEqual(['url']);
		expect(issues[0]?.reason).toContain('https');
	});

	it('flags the fallback separately from the url under https-only', () => {
		const issues = validateBitzMedia(
			{ ...valid, fallback: 'http://mirror.example.com/reel.mp4' },
			{ httpsOnly: true }
		);
		expect(issues.map((i) => i.field)).toEqual(['fallback']);
	});

	it('enforces the max duration product limit', () => {
		expect(
			validateBitzMedia({ ...valid, duration: 61 }, { maxDurationSeconds: 60 }).map((i) => i.field)
		).toEqual(['duration']);
		expect(validateBitzMedia({ ...valid, duration: 60 }, { maxDurationSeconds: 60 })).toEqual([]);
	});

	it('tolerates absent optional fields', () => {
		expect(validateBitzMedia({ url: valid.url })).toEqual([]);
	});
});
describe('renditions (READ-002 / F-019)', () => {
	const RENDITION_EVENT = {
		kind: NOSTR_KINDS.VIDEO,
		content: 'source https://v.example/1080.mp4',
		tags: [
			[
				'imeta',
				'url https://v.example/1080.mp4',
				'm video/mp4',
				'dim 1080x1920',
				'fallbackrendition variant:https://v.example/720.mp4 m video/mp4 dim 720x1280 bitrate 2500k',
				'fallbackrendition variant:https://v.example/480.mp4 m video/mp4 dim 480x854 bitrate 1000k'
			]
		]
	};

	it('parses fallbackrendition variants high-to-low with height + bitrate', () => {
		const media = parseBitz(RENDITION_EVENT)!;
		expect(media.renditions?.map((r) => r.url)).toEqual([
			'https://v.example/720.mp4',
			'https://v.example/480.mp4'
		]);
		expect(media.renditions?.[0]).toMatchObject({ height: 1280, bitrate: 2_500_000 });
		expect(media.renditions?.[1]).toMatchObject({ height: 854, bitrate: 1_000_000 });
		// Mirror fallbacks and renditions stay separate channels.
		expect(media.fallbacks).toEqual([]);
	});

	it('treats a same-URL variant as a mirror, not a rendition', () => {
		const media = parseBitz({
			kind: NOSTR_KINDS.VIDEO,
			content: RENDITION_EVENT.content,
			tags: [
				[
					'imeta',
					'url https://v.example/1080.mp4',
					'm video/mp4',
					'fallbackrendition variant:https://v.example/1080.mp4 dim 1080x1920'
				]
			]
		})!;
		expect(media.renditions).toBeUndefined();
	});

	it('skips variants without a usable URL instead of throwing', () => {
		const media = parseBitz({
			kind: NOSTR_KINDS.VIDEO,
			content: RENDITION_EVENT.content,
			tags: [
				[
					'imeta',
					'url https://v.example/1080.mp4',
					'm video/mp4',
					'fallbackrendition 720x1280 bitrate 2500k',
					'fallbackrendition variant:https://v.example/720.mp4 dim 720x1280'
				]
			]
		})!;
		expect(media.renditions?.map((r) => r.url)).toEqual(['https://v.example/720.mp4']);
	});

	it('content-only videos never carry renditions (no quality metadata)', () => {
		const media = parseBitz({
			kind: NOSTR_KINDS.VIDEO,
			content: 'a https://v.one/a.mp4 b https://v.two/b.mp4',
			tags: []
		})!;
		expect(media.renditions).toBeUndefined();
		expect(media.fallbacks).toEqual(['https://v.two/b.mp4']);
	});
});

describe('selectRendition (adaptive pick)', () => {
	const media = {
		url: 'https://v.example/1080.mp4',
		renditions: [
			{ url: 'https://v.example/720.mp4', height: 1280, bitrate: 2_500_000 },
			{ url: 'https://v.example/480.mp4', height: 854, bitrate: 1_000_000 },
			{ url: 'https://v.example/360.mp4', height: 640, bitrate: 600_000 }
		]
	};

	it('returns the primary when no renditions exist', () => {
		const pick = selectRendition({ url: 'https://v.example/only.mp4', renditions: [] }, 1280, {
			primaryHeight: 1920
		});
		expect(pick).toEqual({ url: 'https://v.example/only.mp4', isRendition: false, height: 1920 });
	});

	it('picks the largest rendition that fits the target', () => {
		// 854 <= 800*1.25 (1000) fits; 1280 does not.
		expect(selectRendition(media, 800)).toMatchObject({
			url: 'https://v.example/480.mp4',
			height: 854
		});
		// 1280 <= 1080*1.25 (1350) fits.
		expect(selectRendition(media, 1080)).toMatchObject({
			url: 'https://v.example/720.mp4',
			height: 1280
		});
	});

	it('takes the smallest rendition when everything exceeds the target', () => {
		expect(selectRendition(media, 300)).toMatchObject({
			url: 'https://v.example/360.mp4',
			height: 640
		});
	});
});

// ---- Addressable replacement selection (READ-004 / F-016) -------------------

describe('latestAddressableEvents', () => {
	function addrEvent(id: string, d: string, createdAt: number, kind = 34236) {
		return {
			id,
			pubkey: '18'.repeat(32),
			kind,
			content: 'v',
			created_at: createdAt,
			tags: [
				['d', d],
				['imeta', 'url https://v.example/r.mp4', 'm video/mp4']
			]
		};
	}

	it('keeps only the newest event per (kind, pubkey, d) coordinate', () => {
		const older = addrEvent('a'.repeat(64), 'profile-reel', 100);
		const newer = addrEvent('b'.repeat(64), 'profile-reel', 200);
		const resolved = latestAddressableEvents([older, newer]);
		expect(resolved).toHaveLength(1);
		expect(resolved[0].id).toBe(newer.id);
	});

	it('is order-independent: newest wins regardless of arrival order', () => {
		const older = addrEvent('a'.repeat(64), 'reel', 100);
		const newer = addrEvent('b'.repeat(64), 'reel', 200);
		expect(latestAddressableEvents([newer, older]).map((e) => e.id)).toEqual([newer.id]);
	});

	it('breaks created_at ties by larger event id (deterministic across relays)', () => {
		const low = addrEvent('0'.repeat(64), 'reel', 100);
		const high = addrEvent('f'.repeat(64), 'reel', 100);
		expect(latestAddressableEvents([low, high]).map((e) => e.id)).toEqual([high.id]);
		expect(latestAddressableEvents([high, low]).map((e) => e.id)).toEqual([high.id]);
	});

	it('separates coordinates by d-tag, kind and pubkey', () => {
		const a = addrEvent('a'.repeat(64), 'one', 100);
		const b = addrEvent('b'.repeat(64), 'two', 50);
		const otherKind = addrEvent('c'.repeat(64), 'one', 10, 34235);
		const resolved = latestAddressableEvents([a, b, otherKind]);
		expect(resolved).toHaveLength(3);
	});

	it('passes non-addressable events (kind 21/22) through untouched, order kept', () => {
		const plain22 = { ...addrEvent('d'.repeat(64), 'ignored', 5, 22) };
		const plain21 = { ...addrEvent('e'.repeat(64), 'ignored', 50, 21) };
		expect(latestAddressableEvents([plain22, plain21])).toEqual([plain22, plain21]);
	});

	it('keeps input ordering of winners interleaved with passthrough events', () => {
		const older = addrEvent('a'.repeat(64), 'reel', 100);
		const newer = addrEvent('b'.repeat(64), 'reel', 999);
		const plain = { ...addrEvent('c'.repeat(64), 'x', 1, 22) };
		const resolved = latestAddressableEvents([older, plain, newer]);
		// older version drops out; newer keeps its position, plain unmoved
		expect(resolved.map((e) => e.id)).toEqual([plain.id, newer.id]);
	});

	it('main addressable flow: parseBitz still resolves the coordinate on the winner', () => {
		const newer = addrEvent('b'.repeat(64), 'profile-reel', 200);
		const [winnerEvent] = latestAddressableEvents([
			addrEvent('a'.repeat(64), 'profile-reel', 100),
			newer
		]);
		const media = parseBitz(winnerEvent);
		expect(media?.address).toContain('34236:');
		expect(media?.address).toContain(':profile-reel');
	});
});
