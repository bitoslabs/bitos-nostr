import { browser } from '$app/environment';
import {
	decodeEmojiPack,
	encodeEmojiPack,
	type NostrEmoji,
	type NostrEmojiPack
} from '$lib/meme/emoji-packs';

/**
 * Installed Nostr emoji packs (kind 30030) — the "install / cache to device"
 * store. Installing persists the parsed pack (title, cover, emoji urls) to
 * localStorage, so picks work offline and never re-query relays. Uninstall
 * frees the cache. Mirrors the meme-templates store conventions.
 *
 * Storage shape (localStorage, key `bitos:emoji-packs`):
 *   { schema, version, list: [WireEmojiPack…] }
 */

export const EMOJI_PACKS_KEY = 'bitos:emoji-packs';
export const EMOJI_PACKS_VERSION = 1;
/** Cache stays light — packs are small, but relays serve many. */
export const MAX_EMOJI_PACKS = 12;

interface StoredPacks {
	schema: string;
	version: number;
	list: unknown[];
}

class EmojiPackStore {
	/** Installed packs, freshest install first. */
	list = $state<NostrEmojiPack[]>([]);

	constructor() {
		if (browser) this.read();
	}

	private read() {
		try {
			const raw = localStorage.getItem(EMOJI_PACKS_KEY);
			if (!raw) return;
			const stored = JSON.parse(raw) as StoredPacks;
			if (stored?.schema !== EMOJI_PACKS_KEY) return;
			this.list = (Array.isArray(stored.list) ? stored.list : [])
				.map(decodeEmojiPack)
				.filter((p): p is NostrEmojiPack => p !== null)
				.slice(0, MAX_EMOJI_PACKS);
		} catch {
			this.list = [];
		}
	}

	private write() {
		try {
			const stored: StoredPacks = {
				schema: EMOJI_PACKS_KEY,
				version: EMOJI_PACKS_VERSION,
				list: this.list.map(encodeEmojiPack)
			};
			localStorage.setItem(EMOJI_PACKS_KEY, JSON.stringify(stored));
		} catch {
			/* quota/private mode — installs just won't persist */
		}
	}

	has(eventId: string): boolean {
		return this.list.some((p) => p.eventId === eventId);
	}

	/** Install (cache to device). Idempotent; returns false at the cap. */
	install(pack: NostrEmojiPack): boolean {
		if (this.has(pack.eventId)) return true;
		if (this.list.length >= MAX_EMOJI_PACKS) return false;
		this.list = [pack, ...this.list];
		this.write();
		return true;
	}

	uninstall(eventId: string) {
		this.list = this.list.filter((p) => p.eventId !== eventId);
		this.write();
	}

	/** Every emoji from every installed pack, pack title prefixed for search. */
	allEmojis(): { emoji: NostrEmoji; pack: NostrEmojiPack }[] {
		return this.list.flatMap((pack) => pack.emojis.map((emoji) => ({ emoji, pack })));
	}
}

export const emojiPacks = new EmojiPackStore();
