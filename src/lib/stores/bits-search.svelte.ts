/**
 * Bits search store — owns everything search-related for the Bits page so the
 * route component stays a view: query text, result filters, the debounced
 * NIP-50 relay round trip, dedupe of local + remote hits, match metadata for
 * UI highlighting, and result ordering.
 *
 * All side effects (relay pool, profile cache, event→reel mapping) are
 * injected as constructor dependencies, which keeps this module unit-testable
 * without a live relay connection.
 */
import type { ReelNote } from '$lib/stores/bits-session.svelte';
import type { Event } from '$lib/nostr/types';

/** One filter option in the results toolbar. */
export type BitsSearchFilter = 'all' | 'video' | 'image' | 'creator';

/** Result ordering switch shown next to the count line. */
export type BitsSearchSort = 'recent' | 'engagement';

/** For each matched bit: the first index (per field) where a token hit, or -1. */
export interface BitsMatchMeta {
	caption: number;
	content: number;
	author: number;
}

/** One NIP-50 `search` filter the page adapter turns into a relay request. */
export interface BitsSearchRequest {
	kinds: number[];
	limit: number;
	search: string;
}

/** Injected relay runner: executes the search filters (maxWait lives there). */
export type BitsRelaySearchFn = (requests: BitsSearchRequest[]) => Promise<Event[]>;

/** Debounce for the relay round trip while the user is still typing. */
export const BITS_SEARCH_DEBOUNCE_MS = 400;

/** Limits for one relay search round — same split rationale as the feed load
 *  (media kinds deep, kind-1 shallow). */
export const BITS_SEARCH_MEDIA_LIMIT = 80;
export const BITS_SEARCH_TEXT_LIMIT = 120;

/** A text run inside a highlighted string: plain or matched. */
export interface HighlightSegment {
	text: string;
	match: boolean;
}

/**
 * Split a raw query into word tokens (lowercased). Matching is multi-word:
 * every token must appear in at least one searchable field of the bit.
 */
export function tokenizeQuery(raw: string): string[] {
	return raw
		.toLowerCase()
		.split(/\s+/)
		.map((token) => token.trim())
		.filter((token) => token.length > 0);
}

/**
 * Case-insensitively split `text` into segments, marking the spans that
 * contain any token — what the UI renders as highlighted matches.
 */
export function highlightSegments(text: string, tokens: string[]): HighlightSegment[] {
	if (!text || !tokens.length) return [{ text, match: false }];
	const lower = text.toLowerCase();
	const segments: HighlightSegment[] = [];
	let cursor = 0;
	while (cursor < text.length) {
		let hitStart = -1;
		let hitLen = 0;
		for (const token of tokens) {
			if (!token) continue;
			const at = lower.indexOf(token, cursor);
			if (at >= 0 && (hitStart < 0 || at < hitStart)) {
				hitStart = at;
				hitLen = token.length;
			}
		}
		if (hitStart < 0) break;
		if (hitStart > cursor) segments.push({ text: text.slice(cursor, hitStart), match: false });
		segments.push({ text: text.slice(hitStart, hitStart + hitLen), match: true });
		cursor = hitStart + hitLen;
	}
	if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
	return segments.length ? segments : [{ text, match: false }];
}

/** Blend a bit's aggregate engagement into one comparable number. */
function engagementScore(reel: ReelNote): number {
	const likes = reel.reactions?.reduce((sum, reaction) => sum + reaction.count, 0) ?? 0;
	return likes * 2 + (reel.zapCount ?? 0) * 3 + reel.zapTotalSats / 100;
}

/**
 * Match one bit against the tokens. A bit matches when every token is found
 * in at least one field (caption, content, or author). Returns first-hit
 * indexes per field for highlighting, or null when the bit does not match.
 */
export function matchBit(
	reel: ReelNote,
	tokens: string[],
	opts: { captionOf: (reel: ReelNote) => string; authorOf: (reel: ReelNote) => string }
): BitsMatchMeta | null {
	if (!tokens.length) return null;
	const caption = opts.captionOf(reel).toLowerCase();
	const content = reel.content.toLowerCase();
	const author = opts.authorOf(reel).toLowerCase();
	let captionHit = -1;
	let contentHit = -1;
	let authorHit = -1;
	for (const token of tokens) {
		if (!token) continue;
		const c = caption.indexOf(token);
		const x = content.indexOf(token);
		const a = author.indexOf(token);
		if (c < 0 && x < 0 && a < 0) return null;
		if (c >= 0 && captionHit < 0) captionHit = c;
		if (x >= 0 && contentHit < 0) contentHit = x;
		if (a >= 0 && authorHit < 0) authorHit = a;
	}
	return { caption: captionHit, content: contentHit, author: authorHit };
}

export interface BitsSearchDeps {
	/** Executes the built NIP-50 filters against the relay pool. */
	relaySearch: BitsRelaySearchFn;
	/** Maps raw relay events to renderable reels (page owns this pipeline). */
	eventsToReels: (events: Event[]) => Promise<ReelNote[]>;
	/** Caption for a reel with media URLs stripped (page helper). */
	captionOf: (reel: ReelNote) => string;
	/** Display name for a reel's author (resolves via profile cache). */
	authorOf: (reel: ReelNote) => string;
	/** Prefetches profile metadata for result authors. */
	profileEnsure: (pubkeys: string[]) => void;
	/** Dedicated media kinds queried deeply (page's REEL_MEDIA_KINDS). */
	mediaKinds: number[];
	/** Text-note kind queried shallowly (NOSTR_KINDS.TEXT_NOTE). */
	textKind: number;
}

export class BitsSearchStore {
	open = $state(false);
	query = $state('');
	filter = $state<BitsSearchFilter>('all');
	sort = $state<BitsSearchSort>('recent');

	/** Remote hits from the latest relay round. */
	remote = $state<ReelNote[]>([]);
	searching = $state(false);
	/** Set when the relay round failed — local matches still render. */
	error = $state<string | null>(null);

	/** Local candidates published by the page (reactive: pool updates flow). */
	private localPool = $state<ReelNote[]>([]);
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private relayToken = 0;
	private readonly deps: BitsSearchDeps;

	constructor(deps: BitsSearchDeps) {
		this.deps = deps;
	}

	/** Query tokens for the current input (lowercased words). */
	tokens = $derived(tokenizeQuery(this.query));

	/** Trimmed query, or '' when only whitespace is typed. */
	trimmed = $derived(this.query.trim());

	/** True when there is at least one token to match against. */
	hasQuery = $derived(this.tokens.length > 0);

	/** Candidates (local pool + remote hits) matching every query token. */
	private matched = $derived.by(() => {
		const tokens = this.tokens;
		if (!tokens.length) {
			return { reels: [] as ReelNote[], meta: {} as Record<string, BitsMatchMeta> };
		}
		const seen = new Set<string>();
		const reels: ReelNote[] = [];
		const meta: Record<string, BitsMatchMeta> = {};
		for (const pool of [this.localPool, this.remote]) {
			for (const reel of pool) {
				if (seen.has(reel.id)) continue;
				const hit = matchBit(reel, tokens, {
					captionOf: this.deps.captionOf,
					authorOf: this.deps.authorOf
				});
				if (!hit) continue;
				seen.add(reel.id);
				meta[reel.id] = hit;
				reels.push(reel);
			}
		}
		return { reels, meta };
	});

	/** matchBit output per result id — drives chip badges + highlighting. */
	meta = $derived(this.matched.meta);

	/** Result counts per filter, powering the toolbar chips. */
	counts = $derived.by(() => {
		const { reels, meta } = this.matched;
		return {
			all: reels.length,
			video: reels.filter((reel) => reel.mediaType === 'video').length,
			image: reels.filter((reel) => reel.mediaType === 'image').length,
			creator: reels.filter((reel) => (meta[reel.id]?.author ?? -1) >= 0).length
		};
	});

	/** Filtered and ordered result list the grid renders. */
	matches = $derived.by(() => {
		const { reels, meta } = this.matched;
		const isCreatorMatch = (reel: ReelNote) => (meta[reel.id]?.author ?? -1) >= 0;
		const filtered =
			this.filter === 'all'
				? reels
				: reels.filter((reel) =>
						this.filter === 'creator' ? isCreatorMatch(reel) : reel.mediaType === this.filter
					);
		return [...filtered].sort(
			this.sort === 'engagement'
				? (a, b) => engagementScore(b) - engagementScore(a) || b.createdAt - a.createdAt
				: (a, b) => b.createdAt - a.createdAt
		);
	});

	/** Caption helper exposed for the overlay UI (delegates to the page). */
	captionFor(reel: ReelNote): string {
		return this.deps.captionOf(reel);
	}

	/** The page publishes its loaded bits so local matching works instantly. */
	setLocalPool(pool: ReelNote[]) {
		this.localPool = pool;
	}

	openOverlay() {
		this.open = true;
	}

	/**
	 * Typing entry point: stores the query, clears stale errors/results when
	 * the input was emptied, and schedules the debounced relay round.
	 */
	setQuery(raw: string) {
		this.query = raw;
		this.error = null;
		if (!raw.trim()) {
			this.clearRemote();
			return;
		}
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		this.debounceTimer = setTimeout(() => void this.searchRelays(), BITS_SEARCH_DEBOUNCE_MS);
	}

	/** Immediate search for form submit / tests. */
	async searchNow() {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		await this.searchRelays();
	}

	/** Drops remote results (used when the query is cleared or on reopen). */
	clearRemote() {
		this.remote = [];
		this.searching = false;
	}

	/** Close the overlay; keep the query so reopening is non-destructive. */
	close() {
		this.open = false;
		this.relayToken += 1;
		this.searching = false;
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
	}

	private async searchRelays() {
		const term = this.trimmed;
		if (!term) return;
		const token = ++this.relayToken;
		this.searching = true;
		this.error = null;
		const requests: BitsSearchRequest[] = [
			{ kinds: this.deps.mediaKinds, limit: BITS_SEARCH_MEDIA_LIMIT, search: term },
			{ kinds: [this.deps.textKind], limit: BITS_SEARCH_TEXT_LIMIT, search: term }
		];
		try {
			const events = await this.deps.relaySearch(requests);
			if (token !== this.relayToken) return;
			const reels = await this.deps.eventsToReels(events);
			if (token !== this.relayToken) return;
			this.remote = reels;
			this.deps.profileEnsure(reels.map((reel) => reel.pubkey));
		} catch (e) {
			if (token !== this.relayToken) return;
			// Search is best-effort; local matches still render.
			this.error = (e as Error)?.message || 'Relay search failed';
		} finally {
			if (token === this.relayToken) this.searching = false;
		}
	}
}
