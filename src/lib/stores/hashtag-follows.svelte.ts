import { browser } from '$app/environment';
import { SvelteSet } from 'svelte/reactivity';
import { identity } from '$lib/nostr/identity.svelte';
import {
	syncList,
	createDebouncedPublisher,
	markSynced,
	INTEREST_SET_LIST
} from '$lib/nostr/list-sync';

const STORAGE_KEY = 'bitos:followed-hashtags';
/** Legacy local-only pin list — imported once so existing tabs survive. */
const LEGACY_PINS_KEY = 'bitos:feed-preferences';

/** NIP-01 hashtag charset (same as $lib/utils/note-content hashtagPattern). */
const TAG_PATTERN = /^[\p{L}\p{N}_-]{2,60}$/u;

function normalizeTag(tag: string) {
	return tag.trim().replace(/^#/, '').toLowerCase();
}

function isValidTag(tag: string) {
	return TAG_PATTERN.test(tag);
}

/**
 * Followed hashtags — the Nostr-native replacement for local-only "pinned"
 * tags. Follows are stored in a NIP-51 interest set (kind 30015, d=interest)
 * so they sync across devices and other clients (Amethyst, etc.) render the
 * same list. While offline or signed out, localStorage stays authoritative.
 */
class HashtagFollowsStore {
	following = $state<Set<string>>(new SvelteSet());

	/** Debounced NIP-51 publisher — bursts of follows collapse into one event. */
	private publisher = createDebouncedPublisher(INTEREST_SET_LIST, () => [...this.following]);

	/** Alphabetically sorted followed hashtags (stable for feed tabs). */
	get tags(): string[] {
		return [...this.following].sort((a, b) => a.localeCompare(b));
	}

	get count(): number {
		return this.following.size;
	}

	load = () => {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw !== null) {
				const parsed = JSON.parse(raw) as string[];
				this.following = new SvelteSet(parsed.map(normalizeTag).filter(isValidTag));
				return;
			}
			// First run for this account: adopt the old local-only pinned tags.
			this.importLegacyPins();
		} catch {
			this.following = new SvelteSet();
		}
	};

	/** Seed follows from the legacy `feedPreferences.pinnedTags` pin list. */
	private importLegacyPins() {
		const pinned: string[] = [];
		try {
			const raw = localStorage.getItem(LEGACY_PINS_KEY);
			const parsed = raw ? (JSON.parse(raw) as { pinnedTags?: string[] }) : null;
			const list = Array.isArray(parsed?.pinnedTags) ? parsed!.pinnedTags! : [];
			pinned.push(...list.map(normalizeTag).filter(isValidTag));
		} catch {
			/* ignore malformed legacy storage */
		}
		this.following = new SvelteSet(pinned);
		// Persist immediately so a later unfollow-all is not re-imported.
		this.persist();
	}

	/**
	 * NIP-51 sync — merge the kind 30015 interest set from relays into the
	 * local set (union) and republish when local-only entries exist. Called on
	 * login and relay-list changes.
	 */
	sync = async () => {
		if (!browser || !identity.current) return;
		try {
			await syncList(INTEREST_SET_LIST, [...this.following], (merged) => {
				this.following = new SvelteSet(merged);
				this.persist();
			});
			markSynced();
		} catch {
			/* offline / relay failure — local list stays authoritative */
		}
	};

	private persist() {
		if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.following]));
	}

	has(tag: string) {
		return this.following.has(normalizeTag(tag));
	}

	follow(tag: string) {
		const next = normalizeTag(tag);
		if (!isValidTag(next) || this.has(next)) return false;
		const set = new SvelteSet(this.following);
		set.add(next);
		this.following = set;
		this.persist();
		this.publisher.schedule(); // NIP-51
		return true;
	}

	unfollow(tag: string) {
		const next = normalizeTag(tag);
		if (!this.has(next)) return false;
		const set = new SvelteSet(this.following);
		set.delete(next);
		this.following = set;
		this.persist();
		this.publisher.schedule(); // NIP-51
		return true;
	}

	/** Toggle a tag; returns true when the tag is followed afterwards. */
	toggle(tag: string) {
		return this.has(tag) ? !this.unfollow(tag) : this.follow(tag);
	}

	/** Publish pending changes immediately (e.g. before logout). */
	flush = () => this.publisher.flush();

	/** Drop remote state (logout) — cancels any pending publish. */
	reset = () => {
		this.publisher.cancel();
		this.following = new SvelteSet();
	};
}

export const hashtagFollows = new HashtagFollowsStore();
