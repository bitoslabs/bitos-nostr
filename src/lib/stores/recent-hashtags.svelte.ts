import { browser } from '$app/environment';
import { extractHashtagTags } from '$lib/utils/note-content';

export const RECENT_HASHTAGS_KEY = 'bitos:recent-hashtags';

/** Bounded history — enough choice, never a wall of chips. */
const MAX_TAGS = 12;

/** NIP-01 hashtag charset (same as $lib/utils/note-content hashtagPattern). */
const TAG_PATTERN = /^[\p{L}\p{N}_-]{2,60}$/u;

/**
 * Recently posted hashtags — a local-only convenience cache. Hashtags typed in
 * the note composer or the meme-studio caption resurface as one-tap chips in
 * both forms, so repeat posters never retype their usual tags. Not synced to
 * relays (it is private usage history, not social state).
 */
class RecentHashtagsStore {
	/** Most-recent-first normalized tags (no leading `#`). */
	tags = $state<string[]>([]);

	load = () => {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(RECENT_HASHTAGS_KEY);
			if (raw === null) return;
			const parsed = JSON.parse(raw) as string[];
			this.tags = Array.isArray(parsed)
				? parsed
						.filter((tag) => typeof tag === 'string' && TAG_PATTERN.test(tag))
						.slice(0, MAX_TAGS)
				: [];
		} catch {
			this.tags = [];
		}
	};

	/**
	 * Record every hashtag in posted content (note text or meme caption) —
	 * newest post first, deduplicated, capped. Tags already in the history
	 * move to the front instead of duplicating.
	 */
	record(content: string) {
		const posted = extractHashtagTags(content).map(([, tag]) => tag);
		if (!posted.length) return;
		this.tags = [...posted, ...this.tags.filter((tag) => !posted.includes(tag))].slice(0, MAX_TAGS);
		this.persist();
	}

	remove(tag: string) {
		this.tags = this.tags.filter((candidate) => candidate !== tag.toLowerCase());
		this.persist();
	}

	/** Wipe the whole history (e.g. a "clear" affordance in the chips row). */
	clear = () => {
		this.tags = [];
		if (browser) localStorage.removeItem(RECENT_HASHTAGS_KEY);
	};

	private persist() {
		if (browser) localStorage.setItem(RECENT_HASHTAGS_KEY, JSON.stringify(this.tags));
	}
}

export const recentHashtags = new RecentHashtagsStore();
