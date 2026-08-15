import { browser } from '$app/environment';

/**
 * Composer draft persistence. Each surface (note composer, story composer,
 * …) saves its text under a stable key; drafts survive accidental closes,
 * crashes and refreshes. Pure localStorage, debounced writes.
 *
 * Shape is intentionally minimal — only what a user would be upset to lose:
 *   note  → { text }
 *   story → { text, bgIndex }
 */
export interface DraftData {
	text: string;
	bgIndex?: number;
	savedAt: number;
}

const PREFIX = 'bitos:draft:';
const WRITE_DEBOUNCE_MS = 400;

function key(k: string) {
	return `${PREFIX}${k}`;
}

export function readDraft(k: string): DraftData | null {
	if (!browser) return null;
	try {
		const raw = localStorage.getItem(key(k));
		if (!raw) return null;
		const parsed = JSON.parse(raw) as DraftData;
		if (!parsed || typeof parsed.text !== 'string' || !parsed.text.trim()) return null;
		return { ...parsed, text: parsed.text };
	} catch {
		return null;
	}
}

export function clearDraft(k: string) {
	if (!browser) return;
	try {
		localStorage.removeItem(key(k));
	} catch {
		/* ignore */
	}
}

/** Debounced per-key writer so every keystroke does not hit storage. */
export function createDraftWriter(k: string): {
	write: (data: Omit<DraftData, 'savedAt'>) => void;
	clear: () => void;
	flush: () => void;
} {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let pending: Omit<DraftData, 'savedAt'> | null = null;

	const writeNow = () => {
		if (!browser || !pending) return;
		try {
			localStorage.setItem(key(k), JSON.stringify({ ...pending, savedAt: Date.now() }));
		} catch {
			/* storage full / private mode — drafts stay in memory */
		}
		pending = null;
	};

	return {
		write: (data) => {
			pending = data.text.trim() ? data : null;
			if (!pending) {
				clearDraft(k);
				return;
			}
			if (timer) clearTimeout(timer);
			timer = setTimeout(writeNow, WRITE_DEBOUNCE_MS);
		},
		clear: () => {
			if (timer) clearTimeout(timer);
			timer = undefined;
			pending = null;
			clearDraft(k);
		},
		flush: () => {
			if (timer) clearTimeout(timer);
			timer = undefined;
			writeNow();
		}
	};
}
