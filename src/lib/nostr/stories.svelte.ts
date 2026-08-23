/**
 * Stories store — ephemeral 24h status updates built on NIP-38 (kind 30315
 * User Statuses) + NIP-40 (expiration).
 *
 * Each "slide" is a parameterized-replaceable event whose `d` tag is unique per
 * slide (`bitos-story-<ts>-<rand>`), so a user may have several active slides
 * (an Instagram-style story). Text-only slides double as the Messenger/IG
 * "note". A 24h `expiration` tag lets relays prune old stories automatically,
 * and we also filter client-side.
 *
 * Subscriptions cover the active user + everyone they follow.
 */
import { browser } from '$app/environment';
import { signMined } from '$lib/auth/signer';
import type { Event } from 'nostr-tools/pure';
import { subscribe, publish, queryPrimaryFirst } from './pool';
import { identity } from './identity.svelte';
import { contacts } from './contacts.svelte';
import { profiles } from './profiles.svelte';
import type { Filter } from 'nostr-tools/filter';
import { NOSTR_KINDS } from './types';
import { zapSats } from './zaps';
import { clientTag } from './client-tag';
import { extractHashtagTags } from '$lib/utils/note-content';
import { minePowAsync, eventPow, type PowProgress } from './pow';

const STORY_TTL = 24 * 60 * 60; // seconds
/** Hard cap on images per story slide — keeps events + viewer carousels sane. */
export const MAX_STORY_IMAGES = 6;
const MAX_PER_AUTHOR = 12;
const MIN_FOLLOWING_STORY_AUTHORS = 10;
const PUBLIC_FALLBACK_LIMIT = 20;
const SEEN_KEY = 'bitos:seen-stories';
const VIEWED_KEY = 'bitos:story-views';
const IMG_RE = /https?:\/\/[^\s<>"')]+?\.(?:apng|avif|gif|jpe?g|png|webp)(?:[?#][^\s<>"')]*)?/i;
const IMG_RE_GLOBAL = new RegExp(IMG_RE.source, 'gi');
const VIDEO_RE_GLOBAL = /https?:\/\/[^\s<>"')]+?\.(?:m4v|mov|mp4|webm|mkv)(?:[?#][^\s<>"')]*)?/gi;

/** A video attachment parsed off a story event (imeta url/m pair). */
interface SlideVideo {
	url: string;
	mime?: string;
	thumb?: string;
	durationMs?: number;
}

/**
 * Extract the slide's video: the first NIP-92 `imeta` whose `m` line is a
 * video mime, else the first bare video link in the content. Relays and
 * clients that never set `m` still work via the extension sniff.
 */
function extractVideo(ev: Pick<Event, 'content' | 'tags'>): SlideVideo | undefined {
	for (const tag of ev.tags) {
		if (tag[0] !== 'imeta') continue;
		let url: string | undefined;
		let mime: string | undefined;
		let thumb: string | undefined;
		let durationMs: number | undefined;
		for (const seg of tag.slice(1)) {
			if (seg.startsWith('url ')) url = seg.slice(4).trim();
			else if (seg.startsWith('m ')) mime = seg.slice(2).trim();
			else if (seg.startsWith('thumb ')) thumb = seg.slice(6).trim();
			else if (seg.startsWith('duration ')) {
				const seconds = Number(seg.slice(9).trim().replace(/s$/, ''));
				if (Number.isFinite(seconds) && seconds > 0) durationMs = seconds * 1000;
			}
		}
		if (url && mime?.startsWith('video/')) return { url, mime, thumb, durationMs };
	}
	const bare = ev.content.match(VIDEO_RE_GLOBAL)?.[0];
	return bare ? { url: bare } : undefined;
}

export interface StorySlide {
	id: string;
	/** Parameterized-replaceable `d` tag — used to build the story's `a` address. */
	d?: string;
	pubkey: string;
	/** Caption / note text. */
	content: string;
	/** Primary attached image (`images[0]`) — kept for single-image consumers. */
	imageUrl?: string;
	/** All attached images (NIP-92 imeta urls + image links in content), capped. */
	images?: string[];
	/** Attached video (NIP-92 imeta with a video mime) — plays in the viewer. */
	videoUrl?: string;
	/** Video mime type when `videoUrl` is set (for the poster/player). */
	videoMime?: string;
	/** Poster/thumbnail URL for the video (NIP-92 `thumb` on the video imeta). */
	videoPoster?: string;
	/** Approximate play duration in ms — caps the auto-advance fallback timer. */
	videoDurationMs?: number;
	/** CSS background for text-only stories (gradient or color). */
	bg?: string;
	/** NIP-13 difficulty (leading zero bits) when the slide was mined. */
	pow?: number;
	/** Alt text for the attached image (NIP-92). */
	alt?: string;
	/** True when the slide is marked sensitive (blurred until revealed). */
	sensitive?: boolean;
	createdAt: number;
	expiresAt: number;
}

export interface StoryAuthor {
	pubkey: string;
	/** True when this author came from the public discovery fallback. */
	isPublicDiscovery?: boolean;
	/** Newest-first. */
	slides: StorySlide[];
	latestAt: number;
	hasUnseen: boolean;
}

/** A like on a story slide (kind 7 ❤️, or any non-view emoji). */
export interface StoryReaction {
	pubkey: string;
	emoji: string;
	at: number;
}

/** A public reply to a story slide (kind 1, NIP-10). */
export interface StoryReply {
	id: string;
	pubkey: string;
	content: string;
	createdAt: number;
}

/** Aggregated engagement for a single story slide. */
export interface StoryInteraction {
	likes: StoryReaction[];
	/** Distinct viewer pubkeys (👁️ reactions ∪ reply authors). */
	views: string[];
	replies: StoryReply[];
	/** NIP-57 zap receipts targeting the slide (kind 9735, `#e` = slide id). */
	zapCount: number;
	zapSats: number;
	likedByMe: boolean;
	myLikeEventId?: string;
	likeCount: number;
	viewCount: number;
	replyCount: number;
}

export const EMPTY_STORY_INTERACTION: StoryInteraction = {
	likes: [],
	views: [],
	replies: [],
	zapCount: 0,
	zapSats: 0,
	likedByMe: false,
	likeCount: 0,
	viewCount: 0,
	replyCount: 0
};

const VIEW_EMOJIS = new Set(['👁️', '👁', '👀']);

/** A kind-7 reaction used as an anonymous "view" signal (rather than a like). */
function isViewContent(content: string): boolean {
	return VIEW_EMOJIS.has((content || '').trim());
}

function nowSec() {
	return Math.floor(Date.now() / 1000);
}

function isExpired(s: { expiresAt: number }): boolean {
	return s.expiresAt <= nowSec();
}

/**
 * Collect every attached image: each NIP-92 `imeta` url line first (ordered,
 * author-curated), then any bare image links in the content. Deduped, capped
 * at MAX_STORY_IMAGES so a hostile event can't bloat the viewer.
 */
function extractImages(ev: Pick<Event, 'content' | 'tags'>): string[] {
	const urls: string[] = [];
	// Plain Set on purpose: a local dedupe inside the parser, never reactive state.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const seen = new Set<string>();
	const push = (url: string | undefined) => {
		const clean = url?.trim();
		if (!clean || seen.has(clean)) return;
		seen.add(clean);
		urls.push(clean);
	};
	for (const tag of ev.tags) {
		if (tag[0] !== 'imeta') continue;
		for (const seg of tag.slice(1)) {
			if (seg.startsWith('url ')) push(seg.slice(4));
		}
	}
	for (const match of ev.content.matchAll(IMG_RE_GLOBAL)) push(match[0]);
	return urls.slice(0, MAX_STORY_IMAGES);
}

/** Alt text for the attached image (NIP-92 `alt` line inside `imeta`). */
function extractAlt(ev: Pick<Event, 'tags'>): string | undefined {
	const imeta = ev.tags.find((t) => t[0] === 'imeta');
	const altLine = imeta?.find((seg) => seg.startsWith('alt '));
	return altLine?.slice(4) || undefined;
}

/** True when the slide carries a content warning (sensitive media). */
function isSensitiveSlide(ev: Pick<Event, 'tags'>): boolean {
	return ev.tags.some(
		(t) => (t[0] === 'content-warning' || t[0] === 'warning' || t[0] === 'cw') && !!t[1]
	);
}

/** Strip every attached image URL out of the caption text. */
function cleanStoryContent(content: string, images: string[]): string {
	let out = content;
	for (const url of images) out = out.split(url).join(' ');
	return out
		.replace(/\*{2,}/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function parseSlide(ev: Event): StorySlide | null {
	const expiration = ev.tags.find((t) => t[0] === 'expiration')?.[1];
	const expiresAt = expiration ? Number(expiration) : ev.created_at + STORY_TTL;
	const images = extractImages(ev);
	const video = extractVideo(ev);
	const slide: StorySlide = {
		id: ev.id,
		d: ev.tags.find((t) => t[0] === 'd')?.[1] || undefined,
		pubkey: ev.pubkey.toLowerCase(),
		content: cleanStoryContent(ev.content, images),
		imageUrl: images[0],
		images: images.length ? images : undefined,
		videoUrl: video?.url,
		videoMime: video?.mime,
		videoPoster: video?.thumb,
		videoDurationMs: video?.durationMs,
		bg: ev.tags.find((t) => t[0] === 'background')?.[1] || undefined,
		pow: eventPow(ev),
		alt: extractAlt(ev),
		sensitive: isSensitiveSlide(ev),
		createdAt: ev.created_at,
		expiresAt
	};
	if (isExpired(slide)) return null;
	return slide;
}
export { parseSlide };

class StoriesStore {
	authors = $state<StoryAuthor[]>([]);
	loading = $state(false);
	/** Pubkey → idIndex map so updates dedupe by event id. */
	// Plain Maps/Sets below are private store internals (manual rebuild()), never reactive state.
	private slidesByAuthor = new Map<string, Map<string, StorySlide>>();
	private seenAt = new Map<string, number>();
	private unsub: (() => void) | null = null;
	private publicFallbackFetched = false;
	publicLoading = $state(false);
	publicHasMore = $state(false);
	private publicNextUntil: number | null = null;

	/** Per-slide engagement: likes (❤️), views (👁️), replies, and zaps. */
	interactions = $state<Record<string, StoryInteraction>>({});
	private trackedSlides = new Map<string, StorySlide>();
	private addressToId = new Map<string, string>();
	private reactionsBySlide = new Map<
		string,
		Map<string, { emoji: string; at: number; evId: string }>
	>();
	private repliesBySlide = new Map<string, Map<string, StoryReply>>();
	/** slide id → (zap receipt event id → sats) — dedupes relay replays. */
	private zapsBySlide = new Map<string, Map<string, number>>();
	private viewedSlides = new Set<string>();

	/** The current user's own active slides. */
	mine = $derived(
		this.authors.find((a) => a.pubkey === identity.current?.pk?.toLowerCase())?.slides ?? []
	);

	start = () => {
		if (!browser) return;
		const me = identity.current?.pk;
		if (!me) return;
		this.stop();
		this.authors = [];
		this.slidesByAuthor.clear();
		this.publicFallbackFetched = false;
		this.publicLoading = false;
		this.publicHasMore = false;
		this.publicNextUntil = null;
		this.loadSeen();
		this.loadViewed();
		this.loading = true;
		const authors = this.authorList(me);
		void this.fetch(authors);
		this.unsub = subscribe(
			[
				{ kinds: [NOSTR_KINDS.STORY_STATUS], authors, limit: 200 },
				{ kinds: [NOSTR_KINDS.DELETE], authors, limit: 200 }
			],
			{
				oneose: () => {
					this.loading = false;
				},
				onevent: (ev) => this.ingest(ev)
			}
		);
	};

	stop = () => {
		if (this.unsub) {
			this.unsub();
			this.unsub = null;
		}
	};

	clear = () => {
		this.authors = [];
		this.loading = false;
		this.slidesByAuthor.clear();
	};

	private authorList(me: string): string[] {
		const list = [me.toLowerCase(), ...contacts.following.map((p) => p.toLowerCase())];
		return [...new Set(list)].slice(0, 500);
	}

	private async fetch(authors: string[]) {
		try {
			const applyStoryEvents = (events: Awaited<ReturnType<typeof queryPrimaryFirst>>) => {
				for (const ev of events) this.ingest(ev);
				profiles.ensure(events.map((e) => e.pubkey));
			};
			const events = await queryPrimaryFirst(
				[
					{ kinds: [NOSTR_KINDS.STORY_STATUS], authors, limit: 200 },
					{ kinds: [NOSTR_KINDS.DELETE], authors, limit: 200 }
				],
				{
					onSecondary: (mergedEvents) => {
						applyStoryEvents(mergedEvents);
					}
				}
			);
			applyStoryEvents(events);
			await this.fetchPublicFallbackIfNeeded();
		} finally {
			this.loading = false;
		}
	}

	/** Fill an otherwise sparse following story bar with a small public sample. */
	private async fetchPublicFallbackIfNeeded() {
		if (this.publicFallbackFetched) return;
		const me = identity.current?.pk?.toLowerCase();
		if (!me) return;

		const followingStoryAuthors = this.authors.filter((author) => author.pubkey !== me);
		if (followingStoryAuthors.length >= MIN_FOLLOWING_STORY_AUTHORS) return;

		this.publicFallbackFetched = true;
		const applyStoryEvents = (events: Awaited<ReturnType<typeof queryPrimaryFirst>>) => {
			this.updatePublicCursor(events);
			for (const ev of events) this.ingest(ev);
			profiles.ensure(events.map((e) => e.pubkey));
		};
		const events = await queryPrimaryFirst(
			[{ kinds: [NOSTR_KINDS.STORY_STATUS], limit: PUBLIC_FALLBACK_LIMIT }],
			{
				onSecondary: (mergedEvents) => applyStoryEvents(mergedEvents)
			}
		);
		applyStoryEvents(events);
	}

	private updatePublicCursor(events: Awaited<ReturnType<typeof queryPrimaryFirst>>) {
		const storyEvents = events.filter((event) => event.kind === NOSTR_KINDS.STORY_STATUS);
		if (!storyEvents.length) return;
		const oldest = Math.min(...storyEvents.map((event) => event.created_at));
		if (this.publicNextUntil === null || oldest - 1 < this.publicNextUntil) {
			this.publicNextUntil = oldest - 1;
		}
		this.publicHasMore = storyEvents.length >= PUBLIC_FALLBACK_LIMIT;
	}

	async loadMorePublic() {
		if (this.publicLoading || !this.publicHasMore || this.publicNextUntil === null) return;
		this.publicLoading = true;
		try {
			const applyStoryEvents = (events: Awaited<ReturnType<typeof queryPrimaryFirst>>) => {
				this.updatePublicCursor(events);
				for (const ev of events) this.ingest(ev);
				profiles.ensure(events.map((e) => e.pubkey));
			};
			const events = await queryPrimaryFirst(
				[
					{
						kinds: [NOSTR_KINDS.STORY_STATUS],
						until: this.publicNextUntil,
						limit: PUBLIC_FALLBACK_LIMIT
					}
				],
				{
					onSecondary: (mergedEvents) => applyStoryEvents(mergedEvents)
				}
			);
			applyStoryEvents(events);
			if (
				events.filter((event) => event.kind === NOSTR_KINDS.STORY_STATUS).length <
				PUBLIC_FALLBACK_LIMIT
			) {
				this.publicHasMore = false;
			}
		} finally {
			this.publicLoading = false;
		}
	}

	private ingest(ev: Event) {
		if (ev.kind === NOSTR_KINDS.DELETE) {
			this.ingestDelete(ev);
			return;
		}
		const slide = parseSlide(ev);
		if (!slide) return;
		let map = this.slidesByAuthor.get(slide.pubkey);
		if (!map) {
			// Plain Map on purpose: private store internal, never reactive state.
			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			map = new Map();
			this.slidesByAuthor.set(slide.pubkey, map);
		}
		const existing = map.get(slide.id);
		if (existing && existing.createdAt >= slide.createdAt) return;
		map.set(slide.id, slide);
		this.rebuild();
		profiles.ensure([slide.pubkey]);
	}

	private ingestDelete(ev: Event) {
		const author = ev.pubkey.toLowerCase();
		const map = this.slidesByAuthor.get(author);
		if (!map) return;
		for (const id of ev.tags.filter((tag) => tag[0] === 'e').map((tag) => tag[1])) {
			if (!id) continue;
			map.delete(id);
		}
		this.rebuild();
	}

	private rebuild() {
		const me = identity.current?.pk?.toLowerCase();
		const cutoff = nowSec() - STORY_TTL;
		const result: StoryAuthor[] = [];
		for (const [pubkey, map] of this.slidesByAuthor) {
			const slides = [...map.values()]
				.filter((s) => s.createdAt > cutoff && !isExpired(s))
				.sort((a, b) => b.createdAt - a.createdAt)
				.slice(0, MAX_PER_AUTHOR);
			if (!slides.length) continue;
			const seen = this.seenAt.get(pubkey) ?? 0;
			result.push({
				pubkey,
				isPublicDiscovery: !!me && pubkey !== me && !contacts.followingSet.has(pubkey),
				slides,
				latestAt: slides[0].createdAt,
				hasUnseen: slides.some((s) => s.createdAt > seen)
			});
		}
		result.sort((a, b) => {
			if (a.pubkey === me && b.pubkey !== me) return -1;
			if (b.pubkey === me && a.pubkey !== me) return 1;
			if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1;
			return b.latestAt - a.latestAt;
		});
		this.authors = result;
	}

	/**
	 * Publish a new story slide (text + up to MAX_STORY_IMAGES images + optional
	 * background). `bg` is a CSS background value (gradient/color) stored for
	 * text-only stories. Each image gets its own NIP-92 `imeta` tag so relays and
	 * other clients see the full carousel, and every URL is mirrored into the
	 * content for clients that only parse links.
	 *
	 * Options mirror feed.post: `pow` mines NIP-13 difficulty before publishing
	 * (live stats via `onPowProgress`, cancellable via `signal`), so stories can
	 * carry the same spam-shield as notes.
	 *
	 * Returns the event id.
	 */
	async publish(
		content: string,
		images?: string | string[],
		bg?: string,
		options: {
			pow?: number;
			onPowProgress?: (progress: PowProgress) => void;
			signal?: AbortSignal;
			/** Alt text for the attached images (NIP-92 `alt` in the first imeta). */
			alt?: string;
			/** Blur the images until tapped in the viewer (content-warning tag). */
			sensitive?: boolean;
			/** Attach a video instead of images (NIP-92 imeta with a video mime). */
			video?: { url: string; mime?: string; bytes?: number; dim?: string; thumb?: string };
		} = {}
	): Promise<string> {
		if (!browser) throw new Error('browser only');
		const me = identity.current;
		if (!me) throw new Error('No identity');
		const text = content.trim();
		// Tolerate both the old single-url string and the new array (deduped, capped).
		// Plain Set on purpose: local dedupe before publishing, never reactive state.
		const unique = new Set(
			(typeof images === 'string' ? [images] : (images ?? [])).filter(Boolean)
		);
		const list = [...unique].slice(0, MAX_STORY_IMAGES);
		const video = options.video;
		if (!text && !list.length && !video) throw new Error('Nothing to post');
		const now = nowSec();
		const tags: string[][] = [
			['d', `bitos-story-${now}-${Math.random().toString(36).slice(2, 8)}`],
			['expiration', String(now + STORY_TTL)],
			...clientTag(),
			...extractHashtagTags(text)
		];
		if (bg && !list.length && !video) tags.push(['background', bg]);
		if (options.sensitive && (list.length || video))
			tags.push(['content-warning', 'Sensitive media']);
		const alt = options.alt?.trim().slice(0, 280);
		list.forEach((url, i) => {
			const imeta = [`url ${url}`];
			// Alt text describes the whole set — attach it to the first image only.
			if (i === 0 && alt) imeta.push(`alt ${alt}`);
			tags.push(['imeta', ...imeta]);
		});
		if (video) {
			const imeta = [`url ${video.url}`, `m ${video.mime ?? 'video/mp4'}`];
			if ((video.bytes ?? 0) > 0) imeta.push(`size ${video.bytes}`);
			if (video.dim) imeta.push(`dim ${video.dim}`);
			if (video.thumb) imeta.push(`thumb ${video.thumb}`);
			if (alt) imeta.push(`alt ${alt}`);
			tags.push(['imeta', ...imeta]);
		}
		const body = video
			? [text, video.url].filter(Boolean).join('\n')
			: list.length
				? [text, ...list].filter(Boolean).join('\n')
				: text;
		const unsigned = {
			pubkey: me.pk,
			kind: NOSTR_KINDS.STORY_STATUS,
			content: body,
			created_at: now,
			tags
		};
		// NIP-13 mining is opt-in — ordinary stories stay instant (difficulty 0).
		const mined =
			options.pow && options.pow > 0
				? await minePowAsync(unsigned, options.pow, {
						onProgress: options.onPowProgress,
						signal: options.signal
					})
				: unsigned;
		const event = await signMined(mined);
		await publish(event);
		this.ingest(event);
		return event.id;
	}

	async deleteSlide(slide: StorySlide) {
		if (!browser) return;
		const me = identity.current;
		if (!me) throw new Error('No identity');
		if (slide.pubkey !== me.pk) throw new Error('You can only delete your own stories');
		const event = await signMined({
			kind: NOSTR_KINDS.DELETE,
			content: 'Deleted story from BitOS',
			created_at: Math.floor(Date.now() / 1000),
			tags: [['e', slide.id]]
		});
		await publish(event);
		this.ingestDelete(event);
	}

	/** Build the `a`-tag address (`kind:pubkey:d`) for a story slide. */
	addressOf = (slide: StorySlide): string | undefined => {
		if (!slide.d) return undefined;
		return `${NOSTR_KINDS.STORY_STATUS}:${slide.pubkey}:${slide.d}`;
	};

	/** Reactive accessor used by the viewer (returns a zeroed object when unknown). */
	getInteraction = (slideId: string): StoryInteraction =>
		this.interactions[slideId] ?? EMPTY_STORY_INTERACTION;

	/** Fetch likes/views/replies for a set of slides once (best-effort). */
	loadActivity = async (slides: StorySlide[]) => {
		if (!browser || !slides.length) return;
		this.registerSlides(slides);
		try {
			const events = await queryPrimaryFirst(this.activityFilters(slides), {
				onSecondary: (mergedEvents) => {
					for (const ev of mergedEvents) this.ingestActivity(ev);
				}
			});
			for (const ev of events) this.ingestActivity(ev);
		} catch {
			/* best-effort — leave zeroes */
		}
	};

	/** Subscribe to live likes/views/replies for a set of slides. Returns an unsub fn. */
	watchActivity = (slides: StorySlide[]): (() => void) => {
		if (!browser || !slides.length) return () => {};
		this.registerSlides(slides);
		return subscribe(this.activityFilters(slides), {
			onevent: (ev) => this.ingestActivity(ev)
		});
	};

	/** Drop all cached engagement (e.g. on logout). */
	clearActivity = () => {
		this.interactions = {};
		this.trackedSlides.clear();
		this.addressToId.clear();
		this.reactionsBySlide.clear();
		this.repliesBySlide.clear();
		this.zapsBySlide.clear();
	};

	/** Like a story (kind 7 ❤️). Idempotent — relays keep the latest reaction. */
	like = async (slide: StorySlide, emoji = '❤️'): Promise<void> => {
		const me = identity.current;
		if (!me) throw new Error('No identity');
		const event = await signMined({
			kind: NOSTR_KINDS.REACTION,
			content: emoji,
			created_at: nowSec(),
			tags: [...clientTag(), ...this.targetTags(slide)]
		});
		await publish(event);
		this.ingestActivity(event);
	};

	/** Remove the current user's like (publishes a NIP-09 delete for it). */
	unlike = async (slide: StorySlide): Promise<void> => {
		const me = identity.current;
		if (!me) throw new Error('No identity');
		const targetId = this.interactions[slide.id]?.myLikeEventId;
		const tags = this.targetTags(slide);
		if (targetId) tags.unshift(['e', targetId]);
		const event = await signMined({
			kind: NOSTR_KINDS.DELETE,
			content: 'Removed story like from BitOS',
			created_at: nowSec(),
			tags
		});
		await publish(event);
		this.removeMyLike(slide.id);
	};

	/** Post a public reply to a story (NIP-10 reply to a replaceable event). */
	reply = async (slide: StorySlide, text: string): Promise<string> => {
		const me = identity.current;
		if (!me) throw new Error('No identity');
		const content = text.trim();
		if (!content) throw new Error('Nothing to reply');
		const address = this.addressOf(slide);
		const tags: string[][] = [
			...clientTag(),
			...extractHashtagTags(content),
			['e', slide.id, '', 'reply'],
			['p', slide.pubkey]
		];
		if (address) tags.push(['a', address, '', 'reply']);
		const event = await signMined({
			kind: NOSTR_KINDS.TEXT_NOTE,
			content,
			created_at: nowSec(),
			tags
		});
		await publish(event);
		this.ingestActivity(event);
		return event.id;
	};

	/** Record that the current user viewed a slide — once per slide (👁️ reaction). */
	recordView = async (slide: StorySlide): Promise<void> => {
		if (!browser) return;
		const me = identity.current;
		if (!me) return;
		if (slide.pubkey === me.pk.toLowerCase()) return; // don't count own views
		if (this.viewedSlides.has(slide.id)) return;
		this.viewedSlides.add(slide.id);
		this.persistViewed();
		const event = await signMined({
			kind: NOSTR_KINDS.REACTION,
			content: '👁️',
			created_at: nowSec(),
			tags: this.targetTags(slide)
		});
		try {
			await publish(event);
			this.ingestActivity(event);
		} catch {
			/* views are best-effort */
		}
	};

	/** `e` + `p` (+ `a`) tags pointing a reaction/reply at a story slide. */
	private targetTags(slide: StorySlide): string[][] {
		const address = this.addressOf(slide);
		const tags: string[][] = [
			['e', slide.id],
			['p', slide.pubkey]
		];
		if (address) tags.push(['a', address]);
		return tags;
	}

	private activityFilters(slides: StorySlide[]): Filter[] {
		const ids = slides.map((s) => s.id);
		const addresses = slides.map((s) => this.addressOf(s)).filter(Boolean) as string[];
		const filters: Filter[] = [
			{ kinds: [NOSTR_KINDS.REACTION], '#e': ids },
			// Zap receipts tag the zapped event id via `#e` (NIP-57), so they ride
			// the same ids as reactions and keep story zap totals live.
			{ kinds: [NOSTR_KINDS.ZAP], '#e': ids }
		];
		if (addresses.length) {
			filters.push({ kinds: [NOSTR_KINDS.TEXT_NOTE], '#a': addresses });
			filters.push({ kinds: [NOSTR_KINDS.TEXT_NOTE], '#e': ids });
		}
		return filters;
	}

	private registerSlides(slides: StorySlide[]) {
		for (const s of slides) {
			this.trackedSlides.set(s.id, s);
			const a = this.addressOf(s);
			if (a) this.addressToId.set(a, s.id);
			if (!this.reactionsBySlide.has(s.id)) this.reactionsBySlide.set(s.id, new Map());
			if (!this.repliesBySlide.has(s.id)) this.repliesBySlide.set(s.id, new Map());
			if (!this.zapsBySlide.has(s.id)) this.zapsBySlide.set(s.id, new Map());
			if (!this.interactions[s.id]) {
				this.interactions = { ...this.interactions, [s.id]: EMPTY_STORY_INTERACTION };
			}
		}
	}

	/** Resolve the tracked slide id targeted by a reaction/reply's tags. */
	private slideIdFromTags(tags: string[][]): string | undefined {
		for (const t of tags) {
			if (t[0] === 'e' && t[1] && this.trackedSlides.has(t[1])) return t[1];
		}
		for (const t of tags) {
			if (t[0] === 'a' && t[1]) {
				const id = this.addressToId.get(t[1]);
				if (id) return id;
			}
		}
		return undefined;
	}

	private ingestActivity(ev: Event) {
		if (ev.kind === NOSTR_KINDS.ZAP) {
			const slideId = this.slideIdFromTags(ev.tags);
			if (!slideId) return;
			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			const map = this.zapsBySlide.get(slideId) ?? new Map<string, number>();
			if (map.has(ev.id)) return; // relays replay receipts — count each once
			map.set(ev.id, zapSats(ev));
			this.zapsBySlide.set(slideId, map);
			this.publishInteraction(slideId);
			return;
		}
		if (ev.kind === NOSTR_KINDS.REACTION) {
			const slideId = this.slideIdFromTags(ev.tags);
			if (!slideId) return;
			const map = this.reactionsBySlide.get(slideId)!;
			const pubkey = ev.pubkey.toLowerCase();
			const prev = map.get(pubkey);
			if (prev && prev.at > ev.created_at) return; // keep the latest reaction per pubkey
			map.set(pubkey, { emoji: (ev.content || '').trim(), at: ev.created_at, evId: ev.id });
			this.publishInteraction(slideId);
			profiles.ensure([ev.pubkey]);
		} else if (ev.kind === NOSTR_KINDS.TEXT_NOTE) {
			const slideId = this.slideIdFromTags(ev.tags);
			if (!slideId) return;
			const map = this.repliesBySlide.get(slideId)!;
			if (map.has(ev.id)) return;
			map.set(ev.id, {
				id: ev.id,
				pubkey: ev.pubkey.toLowerCase(),
				content: ev.content,
				createdAt: ev.created_at
			});
			this.publishInteraction(slideId);
			profiles.ensure([ev.pubkey]);
		}
	}

	private publishInteraction(slideId: string) {
		this.interactions = { ...this.interactions, [slideId]: this.buildInteraction(slideId) };
	}

	private buildInteraction(slideId: string): StoryInteraction {
		const reactions = this.reactionsBySlide.get(slideId);
		const repliesMap = this.repliesBySlide.get(slideId);
		const me = identity.current?.pk?.toLowerCase();
		const replies: StoryReply[] = repliesMap
			? [...repliesMap.values()].sort((a, b) => a.createdAt - b.createdAt)
			: [];
		const likes: StoryReaction[] = [];
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const likePubkeys = new Set<string>();
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const viewPubkeys = new Set<string>();
		let myLikeEventId: string | undefined;
		if (reactions) {
			for (const [pubkey, r] of reactions) {
				if (isViewContent(r.emoji)) {
					viewPubkeys.add(pubkey);
					continue;
				}
				if (likePubkeys.has(pubkey)) continue;
				likePubkeys.add(pubkey);
				likes.push({ pubkey, emoji: r.emoji || '❤️', at: r.at });
				if (pubkey === me) myLikeEventId = r.evId;
			}
		}
		for (const reply of replies) viewPubkeys.add(reply.pubkey.toLowerCase());
		const zaps = this.zapsBySlide.get(slideId);
		let zapCount = 0;
		let zapSatsTotal = 0;
		if (zaps) {
			for (const sats of zaps.values()) {
				zapCount += 1;
				zapSatsTotal += sats;
			}
		}
		return {
			likes,
			views: [...viewPubkeys],
			replies,
			zapCount,
			zapSats: zapSatsTotal,
			likedByMe: !!myLikeEventId,
			myLikeEventId,
			likeCount: likes.length,
			viewCount: viewPubkeys.size,
			replyCount: replies.length
		};
	}

	private removeMyLike(slideId: string) {
		const map = this.reactionsBySlide.get(slideId);
		const me = identity.current?.pk?.toLowerCase();
		if (!map || !me) return;
		const cur = map.get(me);
		if (cur && !isViewContent(cur.emoji)) map.delete(me);
		this.publishInteraction(slideId);
	}

	private loadViewed() {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(VIEWED_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) for (const id of parsed) this.viewedSlides.add(String(id));
		} catch {
			/* ignore */
		}
	}

	private persistViewed() {
		if (!browser) return;
		localStorage.setItem(VIEWED_KEY, JSON.stringify([...this.viewedSlides]));
	}

	/** Mark an author's stories as seen (drives the "read" ring). */
	markSeen = (pubkey: string) => {
		const key = pubkey.toLowerCase();
		const author = this.authors.find((a) => a.pubkey === key);
		if (!author) return;
		if ((this.seenAt.get(key) ?? 0) >= author.latestAt) return;
		this.seenAt.set(key, author.latestAt);
		this.persistSeen();
		this.rebuild();
	};

	private loadSeen() {
		try {
			const raw = localStorage.getItem(SEEN_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw) as Record<string, number>;
			for (const [k, v] of Object.entries(parsed)) this.seenAt.set(k, v);
		} catch {
			/* ignore */
		}
	}

	private persistSeen() {
		if (!browser) return;
		const obj: Record<string, number> = {};
		for (const [k, v] of this.seenAt) obj[k] = v;
		localStorage.setItem(SEEN_KEY, JSON.stringify(obj));
	}
}

export const stories = new StoriesStore();
