import { browser } from '$app/environment';

const STORAGE_KEY = 'bitos:feed-preferences';
const MAX_PINNED_TAGS = 8;

type FeedPreferencesState = {
	pinnedTags: string[];
	hiddenTrendTags: string[];
};

const DEFAULTS: FeedPreferencesState = {
	pinnedTags: [],
	hiddenTrendTags: []
};

function normalizeTag(tag: string) {
	return tag.trim().replace(/^#/, '').toLowerCase();
}

class FeedPreferencesStore {
	state = $state<FeedPreferencesState>({ ...DEFAULTS });
	private loaded = false;

	load() {
		if (!browser || this.loaded) return;
		this.loaded = true;
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw) as Partial<FeedPreferencesState>;
			this.state = {
				...DEFAULTS,
				...parsed,
				pinnedTags: (parsed.pinnedTags ?? [])
					.map(normalizeTag)
					.filter(Boolean)
					.slice(0, MAX_PINNED_TAGS),
				hiddenTrendTags: [
					...new Set((parsed.hiddenTrendTags ?? []).map(normalizeTag).filter(Boolean))
				]
			};
		} catch {
			/* ignore malformed storage */
		}
	}

	reload() {
		this.loaded = false;
		this.state = { ...DEFAULTS };
		this.load();
	}

	private persist() {
		if (!browser) return;
		localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
	}

	togglePinnedTag(tag: string) {
		this.load();
		const normalized = normalizeTag(tag);
		if (!normalized) return;
		const exists = this.state.pinnedTags.includes(normalized);
		this.state.pinnedTags = exists
			? this.state.pinnedTags.filter((item) => item !== normalized)
			: [normalized, ...this.state.pinnedTags.filter((item) => item !== normalized)].slice(
					0,
					MAX_PINNED_TAGS
				);
		this.persist();
	}

	isPinned(tag: string) {
		this.load();
		return this.state.pinnedTags.includes(normalizeTag(tag));
	}

	hideTrendTag(tag: string) {
		this.load();
		const normalized = normalizeTag(tag);
		if (!normalized || this.state.hiddenTrendTags.includes(normalized)) return;
		this.state.hiddenTrendTags = [...this.state.hiddenTrendTags, normalized];
		this.persist();
	}

	isTrendHidden(tag: string) {
		this.load();
		return this.state.hiddenTrendTags.includes(normalizeTag(tag));
	}
}

export const feedPreferences = new FeedPreferencesStore();
