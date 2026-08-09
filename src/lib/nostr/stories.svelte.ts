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
import { finalizeEvent } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/pure';
import { subscribe, publish, queryPrimaryFirst } from './pool';
import { identity } from './identity.svelte';
import { contacts } from './contacts.svelte';
import { profiles } from './profiles.svelte';
import { hexToBytes } from './hex';
import type { Filter } from 'nostr-tools/filter';
import { NOSTR_KINDS } from './types';
import { clientTag } from './client-tag';
import { extractHashtagTags } from '$lib/utils/note-content';

const STORY_TTL = 24 * 60 * 60; // seconds
const MAX_PER_AUTHOR = 12;
const MIN_FOLLOWING_STORY_AUTHORS = 10;
const PUBLIC_FALLBACK_LIMIT = 20;
const SEEN_KEY = 'bitos:seen-stories';
const VIEWED_KEY = 'bitos:story-views';
const IMG_RE = /https?:\/\/[^\s<>"')]+?\.(?:apng|avif|gif|jpe?g|png|webp)(?:[?#][^\s<>"')]*)?/i;

export interface StorySlide {
	id: string;
	/** Parameterized-replaceable `d` tag — used to build the story's `a` address. */
	d?: string;
	pubkey: string;
	/** Caption / note text. */
	content: string;
	/** Attached image, if any (imeta url or an image link in content). */
	imageUrl?: string;
	/** CSS background for text-only stories (gradient or color). */
	bg?: string;
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

/** Pull an image URL out of imeta (NIP-92) or the first image link in content. */
function extractImage(ev: Pick<Event, 'content' | 'tags'>): string | undefined {
	const imeta = ev.tags.find((t) => t[0] === 'imeta');
	if (imeta) {
		const urlLine = imeta.find((seg) => seg.startsWith('url '));
		if (urlLine) return urlLine.slice(4);
	}
	return ev.content.match(IMG_RE)?.[0];
}

function cleanStoryContent(content: string, imageUrl?: string): string {
	if (!imageUrl) return content.trim();
	return content
		.split(imageUrl)
		.join(' ')
		.replace(/\*{2,}/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function parseSlide(ev: Event): StorySlide | null {
	const expiration = ev.tags.find((t) => t[0] === 'expiration')?.[1];
	const expiresAt = expiration ? Number(expiration) : ev.created_at + STORY_TTL;
	const imageUrl = extractImage(ev);
	const slide: StorySlide = {
		id: ev.id,
		d: ev.tags.find((t) => t[0] === 'd')?.[1] || undefined,
		pubkey: ev.pubkey.toLowerCase(),
		content: cleanStoryContent(ev.content, imageUrl),
		imageUrl,
		bg: ev.tags.find((t) => t[0] === 'background')?.[1] || undefined,
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
	private slidesByAuthor = new Map<string, Map<string, StorySlide>>();
	private seenAt = new Map<string, number>();
	private unsub: (() => void) | null = null;
	private publicFallbackFetched = false;

	/** Per-slide engagement: likes (❤️), views (👁️), and replies. */
	interactions = $state<Record<string, StoryInteraction>>({});
	private trackedSlides = new Map<string, StorySlide>();
	private addressToId = new Map<string, string>();
	private reactionsBySlide = new Map<
		string,
		Map<string, { emoji: string; at: number; evId: string }>
	>();
	private repliesBySlide = new Map<string, Map<string, StoryReply>>();
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

	private ingest(ev: Event) {
		if (ev.kind === NOSTR_KINDS.DELETE) {
			this.ingestDelete(ev);
			return;
		}
		const slide = parseSlide(ev);
		if (!slide) return;
		let map = this.slidesByAuthor.get(slide.pubkey);
		if (!map) {
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
	 * Publish a new story slide (text + optional image + optional background).
	 * `bg` is a CSS background value (gradient/color) stored for text-only stories.
	 * Returns the event id.
	 */
	async publish(content: string, imageUrl?: string, bg?: string): Promise<string> {
		if (!browser) throw new Error('browser only');
		const me = identity.current;
		if (!me) throw new Error('No identity');
		const text = content.trim();
		if (!text && !imageUrl) throw new Error('Nothing to post');
		const now = nowSec();
		const tags: string[][] = [
			['d', `bitos-story-${now}-${Math.random().toString(36).slice(2, 8)}`],
			['expiration', String(now + STORY_TTL)],
			...clientTag(),
			...extractHashtagTags(text)
		];
		if (bg && !imageUrl) tags.push(['background', bg]);
		let body = text;
		if (imageUrl) {
			tags.push(['imeta', `url ${imageUrl}`]);
			body = text ? `${text}\n${imageUrl}` : imageUrl;
		}
		const event = finalizeEvent(
			{ kind: NOSTR_KINDS.STORY_STATUS, content: body, created_at: now, tags },
			hexToBytes(me.sk)
		);
		await publish(event);
		this.ingest(event);
		return event.id;
	}

	async deleteSlide(slide: StorySlide) {
		if (!browser) return;
		const me = identity.current;
		if (!me) throw new Error('No identity');
		if (slide.pubkey !== me.pk) throw new Error('You can only delete your own stories');
		const event = finalizeEvent(
			{
				kind: NOSTR_KINDS.DELETE,
				content: 'Deleted story from BitOS',
				created_at: Math.floor(Date.now() / 1000),
				tags: [['e', slide.id]]
			},
			hexToBytes(me.sk)
		);
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
	};

	/** Like a story (kind 7 ❤️). Idempotent — relays keep the latest reaction. */
	like = async (slide: StorySlide, emoji = '❤️'): Promise<void> => {
		const me = identity.current;
		if (!me) throw new Error('No identity');
		const event = finalizeEvent(
			{
				kind: NOSTR_KINDS.REACTION,
				content: emoji,
				created_at: nowSec(),
				tags: [...clientTag(), ...this.targetTags(slide)]
			},
			hexToBytes(me.sk)
		);
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
		const event = finalizeEvent(
			{
				kind: NOSTR_KINDS.DELETE,
				content: 'Removed story like from BitOS',
				created_at: nowSec(),
				tags
			},
			hexToBytes(me.sk)
		);
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
		const event = finalizeEvent(
			{ kind: NOSTR_KINDS.TEXT_NOTE, content, created_at: nowSec(), tags },
			hexToBytes(me.sk)
		);
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
		const event = finalizeEvent(
			{
				kind: NOSTR_KINDS.REACTION,
				content: '👁️',
				created_at: nowSec(),
				tags: this.targetTags(slide)
			},
			hexToBytes(me.sk)
		);
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
		const filters: Filter[] = [{ kinds: [NOSTR_KINDS.REACTION], '#e': ids }];
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
		const likePubkeys = new Set<string>();
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
		return {
			likes,
			views: [...viewPubkeys],
			replies,
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
