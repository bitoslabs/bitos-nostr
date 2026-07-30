import { browser } from '$app/environment';
import type { FeedNote } from '$lib/nostr/types';

const BOOKMARKS_KEY = 'bitos:bookmarked-notes';
const LEGACY_SAVED_IDS_KEY = 'bitos:saved-notes';

export interface BookmarkedNote {
	id: string;
	note: FeedNote;
	savedAt: number;
}

class BookmarksStore {
	items = $state<BookmarkedNote[]>([]);
	ready = $state(false);

	constructor() {
		if (browser) this.load();
	}

	has(id: string) {
		return this.items.some((item) => item.id === id);
	}

	save(note: FeedNote) {
		const now = Date.now();
		this.items = [
			{ id: note.id, note: cloneNote(note), savedAt: now },
			...this.items.filter((item) => item.id !== note.id)
		];
		this.persist();
	}

	remove(id: string) {
		this.items = this.items.filter((item) => item.id !== id);
		this.persist();
	}

	clear() {
		this.items = [];
		if (!browser) return;
		localStorage.removeItem(BOOKMARKS_KEY);
		localStorage.removeItem(LEGACY_SAVED_IDS_KEY);
	}

	toggle(note: FeedNote) {
		if (this.has(note.id)) {
			this.remove(note.id);
			return false;
		}
		this.save(note);
		return true;
	}

	private load() {
		try {
			const raw = localStorage.getItem(BOOKMARKS_KEY);
			if (raw) {
				const parsed = JSON.parse(raw) as BookmarkedNote[];
				this.items = parsed
					.filter((item) => item?.id && item?.note)
					.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
			} else {
				this.migrateLegacyIds();
			}
		} catch {
			this.items = [];
		} finally {
			this.ready = true;
		}
	}

	private migrateLegacyIds() {
		try {
			const raw = localStorage.getItem(LEGACY_SAVED_IDS_KEY);
			const ids = raw ? (JSON.parse(raw) as string[]) : [];
			this.items = ids
				.filter((id) => typeof id === 'string')
				.map((id, index) => ({
					id,
					savedAt: Date.now() - index,
					note: {
						id,
						pubkey: '',
						content:
							'This saved note needs to appear in your feed once before it can be shown here.',
						createdAt: 0,
						tags: [],
						reactions: [],
						repostCount: 0,
						zapCount: 0,
						zapTotalSats: 0
					}
				}));
			this.persist();
		} catch {
			this.items = [];
		}
	}

	private persist() {
		if (!browser) return;
		localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(this.items));
		localStorage.setItem(LEGACY_SAVED_IDS_KEY, JSON.stringify(this.items.map((item) => item.id)));
	}
}

function cloneNote(note: FeedNote): FeedNote {
	return JSON.parse(JSON.stringify(note)) as FeedNote;
}

export const bookmarks = new BookmarksStore();
