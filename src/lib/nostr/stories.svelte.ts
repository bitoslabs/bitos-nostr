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
import { subscribe, publish, queryOnce } from './pool';
import { identity } from './identity.svelte';
import { contacts } from './contacts.svelte';
import { profiles } from './profiles.svelte';
import { hexToBytes } from './hex';
import { NOSTR_KINDS } from './types';

const STORY_TTL = 24 * 60 * 60; // seconds
const MAX_PER_AUTHOR = 12;
const SEEN_KEY = 'bitos:seen-stories';
const IMG_RE = /https?:\/\/[^\s<>"')]+?\.(?:apng|avif|gif|jpe?g|png|webp)(?:[?#][^\s<>"')]*)?/i;

export interface StorySlide {
	id: string;
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
	/** Newest-first. */
	slides: StorySlide[];
	latestAt: number;
	hasUnseen: boolean;
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

	/** The current user's own active slides. */
	mine = $derived(
		this.authors.find((a) => a.pubkey === identity.current?.pk?.toLowerCase())?.slides ?? []
	);

	start = () => {
		if (!browser) return;
		const me = identity.current?.pk;
		if (!me) return;
		this.stop();
		this.loadSeen();
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

	private authorList(me: string): string[] {
		const list = [me.toLowerCase(), ...contacts.following.map((p) => p.toLowerCase())];
		return [...new Set(list)].slice(0, 500);
	}

	private async fetch(authors: string[]) {
		try {
			const events = await queryOnce([
				{ kinds: [NOSTR_KINDS.STORY_STATUS], authors, limit: 200 },
				{ kinds: [NOSTR_KINDS.DELETE], authors, limit: 200 }
			]);
			for (const ev of events) this.ingest(ev);
			// opportunistically load author profiles
			profiles.ensure(events.map((e) => e.pubkey));
		} finally {
			this.loading = false;
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
			['client', 'BitOS']
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
