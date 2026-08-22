<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import type { Filter } from 'nostr-tools/filter';
	import { npubEncode } from 'nostr-tools/nip19';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import PostCard from '$lib/components/feed/PostCard.svelte';
	import ImageLightbox from '$lib/components/ui/ImageLightbox.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import MediaPlayer from '$lib/components/media/MediaPlayer.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { contacts } from '$lib/nostr/contacts.svelte';
	import { algorithmPreferences, getWotSet } from '$lib/algorithm';
	import { queryPrimaryFirst, queryUrls } from '$lib/nostr/pool';
	import { DISCOVERY_RELAY_URLS, relays } from '$lib/nostr/relays.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { NOSTR_KINDS } from '$lib/nostr/types';
	import type { FeedNote } from '$lib/nostr/types';
	import { toFeedNote } from '$lib/nostr/feed-note';
	import { humanTags } from '$lib/nostr/content-classification';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { hashtagFollows } from '$lib/stores/hashtag-follows.svelte';
	import { sensitiveMediaReason } from '$lib/utils/sensitive-media';
	import { privacyNotificationSettings } from '$lib/stores/privacy-notification-settings.svelte';
	import { shortKey, timeAgo, formatDuration } from '$lib/utils/format';

	type TrendTag = { tag: string; count: number };
	type Creator = { pubkey: string; count: number; latest: number };
	type DiscoverTab = 'notes' | 'media' | 'people' | 'tags';
	type MediaItem = {
		id: string;
		url: string;
		kind: 'image' | 'video';
		pubkey: string;
		content: string;
		createdAt: number;
		sensitiveReason: string;
		source?: 'configured' | 'discovery';
	};
	type DiscoverCache = {
		savedAt: number;
		discoveryEnabled?: boolean;
		trendTags: TrendTag[];
		creators: Creator[];
		mediaItems: MediaItem[];
		notes?: FeedNote[];
		oldestNoteEventCreatedAt?: number;
		hasMoreNotes?: boolean;
	};
	type DiscoverSearchCache = {
		savedAt: number;
		queries: Array<{
			query: string;
			savedAt: number;
			discoveryEnabled?: boolean;
			data: Omit<DiscoverCache, 'savedAt'>;
		}>;
	};

	const hashtagPattern = /(?:^|\s)#([\p{L}\p{N}_-]{2,60})/gu;
	const urlPattern = /https?:\/\/[^\s<>()]+/gi;
	const imagePattern = /\.(?:apng|avif|gif|jpe?g|png|webp)$/i;
	const videoPattern = /\.(?:m3u8|m4v|mov|mp4|webm)$/i;
	const imageFormatPattern = /(?:[?&](?:ext|fm|format)=)(?:apng|avif|gif|jpe?g|png|webp)\b/i;
	const videoFormatPattern = /(?:[?&](?:ext|fm|format)=)(?:m3u8|m4v|mov|mp4|webm)\b/i;
	const imagePathPattern =
		/(?:^|\/)(?:avatar|avatars|cdn-cgi\/image|image|images|img|media|photo|photos|picture|resize|thumbnail|thumb|upload|uploads)(?:\/|$|:|-|_)/i;
	const videoPathPattern = /(?:^|\/)(?:video|videos|reel|reels|upload)(?:\/|$|:|-|_)/i;
	const DISCOVER_CACHE_KEY = 'bitos:discover-cache:v8';
	const DISCOVER_SEARCH_CACHE_KEY = 'bitos:discover-search-cache:v8';
	const DISCOVER_CACHE_TTL_MS = 10 * 60 * 1000;
	const DISCOVER_SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
	const MAX_CACHED_SEARCHES = 5;
	// Saved snapshots stay small for fast startup. Live lists are intentionally
	// uncapped so a user-initiated "Load more" can keep appending results.
	const MAX_PERSISTED_TAGS = 60;
	const MAX_PERSISTED_CREATORS = 40;
	const MAX_CACHED_MEDIA = 180;
	// The persisted cache keeps only a tiny slice of notes; search results for
	// notes are never cached at all and always reload fresh from relays.
	const MAX_CACHED_NOTES = 10;
	// Keep enough events to populate notes, media, tags, and creators after relay
	// overlap is deduplicated, without making the first Discover request too heavy.
	const MAX_DISCOVER_NOTES = 300;
	const DISCOVER_INITIAL_EVENT_LIMIT = 120;
	const DISCOVER_PAGE_EVENT_LIMIT = 180;
	const DISCOVER_SEARCH_EVENT_LIMIT = 180;
	const DISCOVER_TEXT_FALLBACK_LIMIT = 240;
	const DISCOVER_CONTENT_KINDS = [
		NOSTR_KINDS.TEXT_NOTE,
		NOSTR_KINDS.PICTURE,
		NOSTR_KINDS.VIDEO,
		NOSTR_KINDS.SHORT_VIDEO,
		NOSTR_KINDS.ADDRESSABLE_VIDEO,
		NOSTR_KINDS.ADDRESSABLE_SHORT_VIDEO
	];
	const INITIAL_MEDIA_VISIBLE = 24;
	const INITIAL_NOTES_VISIBLE = 20;
	const INITIAL_TAGS_VISIBLE = 18;
	const INITIAL_CREATORS_VISIBLE = 8;
	const MEDIA_PAGE_SIZE = 18;
	const NOTES_PAGE_SIZE = 20;
	const MEDIA_PREFETCH_THRESHOLD = 12;
	const SEARCH_DEBOUNCE_MS = 350;

	let loading = $state(true);
	let refreshingRelays = $state(false);
	let lastRelayRefreshAt = $state(0);
	let query = $state('');
	let trendTags = $state<TrendTag[]>([]);
	let creators = $state<Creator[]>([]);
	let mediaItems = $state<MediaItem[]>([]);
	let notes = $state<FeedNote[]>([]);
	let activeTab = $state<DiscoverTab>('notes');
	let noteScope = $state<'latest' | 'following'>('latest');
	let notesVisibleCount = $state(INITIAL_NOTES_VISIBLE);
	let tagsVisibleCount = $state(INITIAL_TAGS_VISIBLE);
	let creatorsVisibleCount = $state(INITIAL_CREATORS_VISIBLE);
	let loadingMoreNotes = $state(false);
	let hasMoreNotes = $state(false);
	let mediaVisibleCount = $state(INITIAL_MEDIA_VISIBLE);
	let loadingMoreMedia = $state(false);
	let searchingRelays = $state(false);
	let hasMoreMedia = $state(true);
	let discoverScroller: HTMLDivElement | undefined = $state();
	let oldestMediaEventCreatedAt = $state(0);
	let oldestNoteEventCreatedAt = $state(0);
	let mediaDialogOpen = $state(false);
	/** Video durations (item.id → seconds) for the media-grid badges. */
	let videoDurations = $state<Record<string, number>>({});
	let mediaIndex = $state(0);
	let zoomOpen = $state(false);
	let revealedSensitiveMedia = $state<Record<string, boolean>>({});
	let relaySearchData = $state<Omit<DiscoverCache, 'savedAt'> | null>(null);
	let relaySearchToken = 0;
	let appliedRailQuery = $state<string | null>(null);
	const me = $derived(identity.current?.pk ?? '');
	const queryTrimmed = $derived(query.trim());
	const railQuery = $derived(page.url.searchParams.get('q')?.trim() ?? '');
	const queryText = $derived(query.trim().toLowerCase());
	const queryTag = $derived(queryTrimmed.replace(/^#/, '').trim().toLowerCase());
	const hasActiveRelaySearch = $derived(queryTrimmed.length >= 2);
	const isRelayQuerying = $derived(
		loading || refreshingRelays || searchingRelays || loadingMoreNotes || loadingMoreMedia
	);

	// The app-wide rail routes its search here. Keep the URL as the hand-off
	// boundary so a shared rail never needs to reach into this page's state.
	// Track the last URL value applied: reading `query` here would make each
	// keystroke overwrite the user's edits with the original `?q=` value.
	$effect(() => {
		if (railQuery && railQuery !== appliedRailQuery) {
			query = railQuery;
			appliedRailQuery = railQuery;
		}
	});

	const filteredTags = $derived(
		trendTags.filter((item) => !queryText || item.tag.toLowerCase().includes(queryText))
	);
	const filteredCreators = $derived(
		creators.filter((item) => {
			const profile = profiles.get(item.pubkey);
			const name = profile?.display_name || profile?.name || shortKey(item.pubkey);
			return (
				!queryText || name.toLowerCase().includes(queryText) || item.pubkey.includes(queryText)
			);
		})
	);
	const filteredMedia = $derived(
		mediaItems.filter((item) => {
			const profile = profiles.get(item.pubkey);
			const name = profile?.display_name || profile?.name || shortKey(item.pubkey);
			const haystack =
				`${item.kind} ${item.content} ${item.url} ${name} ${item.pubkey}`.toLowerCase();
			return !queryText || haystack.includes(queryText);
		})
	);
	const visibleMedia = $derived(filteredMedia.slice(0, mediaVisibleCount));
	const activeTrendTags = $derived(
		hasActiveRelaySearch ? (relaySearchData?.trendTags ?? []) : filteredTags
	);
	const visibleTrendTags = $derived(activeTrendTags.slice(0, tagsVisibleCount));
	const activeCreators = $derived(
		hasActiveRelaySearch ? (relaySearchData?.creators ?? []) : filteredCreators
	);
	const rankedCreators = $derived.by(() => {
		const list = activeCreators;
		if (!list.length || !algorithmPreferences.isEnabled('discover')) return list;
		const cfg = algorithmPreferences.config.discover.signals;
		const now = Math.floor(Date.now() / 1000);
		const halfLife = algorithmPreferences.recencyHalfLifeSeconds;
		const followingSet = contacts.followingSet;
		const wotSet = getWotSet(identity.current?.pk);
		let maxCount = 1;
		for (const c of list) if (c.count > maxCount) maxCount = c.count;
		const wEng = cfg.engagement?.enabled ? cfg.engagement.weight : 0;
		const wRec = cfg.recency?.enabled ? cfg.recency.weight : 0;
		const wWot = cfg.wot?.enabled ? cfg.wot.weight : 0;
		const total = wEng + wRec + wWot || 1;
		return [...list]
			.map((creator) => {
				const engagement = Math.log10(1 + creator.count) / Math.log10(1 + maxCount);
				const recency = Math.pow(0.5, Math.max(0, now - creator.latest) / halfLife);
				const wot = followingSet.has(creator.pubkey) ? 1 : wotSet.has(creator.pubkey) ? 0.6 : 0.2;
				const score = (engagement * wEng + recency * wRec + wot * wWot) / total;
				return { creator, score };
			})
			.sort((a, b) => b.score - a.score)
			.map((item) => item.creator);
	});
	const visibleCreators = $derived(rankedCreators.slice(0, creatorsVisibleCount));
	const activeMedia = $derived(
		hasActiveRelaySearch
			? (relaySearchData?.mediaItems.slice(0, mediaVisibleCount) ?? [])
			: visibleMedia
	);
	const activeMediaCount = $derived(
		hasActiveRelaySearch ? (relaySearchData?.mediaItems.length ?? 0) : filteredMedia.length
	);
	const hasUnrevealedMedia = $derived(activeMedia.length < activeMediaCount);
	const activeSearchNotes = $derived(hasActiveRelaySearch ? (relaySearchData?.notes ?? []) : []);
	const availableNotes = $derived(hasActiveRelaySearch ? activeSearchNotes : notes);
	const filteredNotes = $derived(
		noteScope === 'following'
			? availableNotes.filter((note) => contacts.followingSet.has(note.pubkey))
			: availableNotes
	);
	const visibleNotes = $derived(filteredNotes.slice(0, notesVisibleCount));
	const resultTabs = $derived([
		{ key: 'notes' as const, label: 'Notes', count: availableNotes.length },
		{ key: 'media' as const, label: 'Media', count: activeMediaCount },
		{ key: 'people' as const, label: 'People', count: activeCreators.length },
		{ key: 'tags' as const, label: 'Tags', count: activeTrendTags.length }
	]);
	const selectedMediaItem = $derived(mediaDialogOpen ? (activeMedia[mediaIndex] ?? null) : null);

	function splitTrailingPunctuation(raw: string) {
		let core = raw;
		let suffix = '';
		while (/[),.!?;:\]]$/.test(core)) {
			suffix = core.at(-1) + suffix;
			core = core.slice(0, -1);
		}
		return { core, suffix };
	}

	function imetaValue(tag: string[], key: string) {
		const line = tag.find((segment) => segment.startsWith(`${key} `));
		return line?.slice(key.length + 1).trim();
	}

	function classifyMediaUrl(url: string): MediaItem['kind'] | null {
		try {
			const parsed = new URL(url);
			const pathname = decodeURIComponent(parsed.pathname);
			if (
				videoPattern.test(pathname) ||
				videoFormatPattern.test(parsed.search) ||
				videoPathPattern.test(pathname) ||
				parsed.searchParams.get('resource_type') === 'video'
			) {
				return 'video';
			}
			if (
				imagePattern.test(pathname) ||
				imageFormatPattern.test(parsed.search) ||
				imagePathPattern.test(pathname) ||
				parsed.searchParams.get('resource_type') === 'image'
			) {
				return 'image';
			}
		} catch {
			if (/\.(?:m3u8|m4v|mov|mp4|webm)(?:[?#].*)?$/i.test(url)) return 'video';
			if (/\.(?:apng|avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(url)) return 'image';
		}
		return null;
	}

	/** Keep captions readable: media is already rendered as a tile/viewer, so
	 * its raw source URL is redundant and very noisy on small screens. */
	function mediaCaption(content: string, currentMediaUrl = '') {
		let caption = currentMediaUrl ? content.split(currentMediaUrl).join('') : content;
		for (const match of content.matchAll(urlPattern)) {
			const { core } = splitTrailingPunctuation(match[0]);
			if (classifyMediaUrl(core)) caption = caption.split(core).join('');
		}
		return caption
			.replace(/[ \t]+\n/g, '\n')
			.replace(/\n{3,}/g, '\n\n')
			.replace(/[ \t]{2,}/g, ' ')
			.trim();
	}

	function mediaFromEvent(event: { content: string; tags: string[][] }) {
		for (const tag of event.tags.filter((tag) => tag[0] === 'imeta')) {
			const url = imetaValue(tag, 'url');
			const mime = imetaValue(tag, 'm');
			if (!url) continue;
			if (mime?.startsWith('video/')) return { url, kind: 'video' as const };
			if (mime?.startsWith('image/')) return { url, kind: 'image' as const };
			const kind = classifyMediaUrl(url);
			if (kind) return { url, kind };
		}
		for (const match of event.content.matchAll(urlPattern)) {
			const { core } = splitTrailingPunctuation(match[0]);
			const kind = classifyMediaUrl(core);
			if (kind) return { url: core, kind };
		}
		return null;
	}

	function mergeMediaLists(existing: MediaItem[], incoming: MediaItem[]) {
		const seen = new Set(existing.map((item) => item.id));
		const merged = [...existing];
		for (const item of incoming) {
			if (seen.has(item.id)) continue;
			seen.add(item.id);
			merged.push(item);
		}
		return merged;
	}

	function mergeTrendTags(existing: TrendTag[], incoming: TrendTag[]) {
		// Keep the visible order stable while pagination is adding older relay
		// results. Resorting here made existing tags jump around (or disappear at
		// the cache cap) instead of appending the next page.
		const tagsByName = new Map(existing.map((item) => [item.tag, { ...item }]));
		const merged = existing.map((item) => tagsByName.get(item.tag)!);
		for (const item of incoming) {
			const current = tagsByName.get(item.tag);
			if (current) {
				current.count += item.count;
				continue;
			}
			const next = { ...item };
			tagsByName.set(item.tag, next);
			merged.push(next);
		}
		return merged;
	}

	function mergeCreators(existing: Creator[], incoming: Creator[]) {
		const creatorsByKey = new Map(existing.map((creator) => [creator.pubkey, { ...creator }]));
		const merged = existing.map((creator) => creatorsByKey.get(creator.pubkey)!);
		for (const creator of incoming) {
			const current = creatorsByKey.get(creator.pubkey);
			if (current) {
				current.count += creator.count;
				current.latest = Math.max(current.latest, creator.latest);
			} else {
				const next = { ...creator };
				creatorsByKey.set(creator.pubkey, next);
				merged.push(next);
			}
		}
		return merged;
	}

	function discoveryUrls() {
		if (!algorithmPreferences.relayDiscovery.discover) return [];
		return DISCOVERY_RELAY_URLS.filter((url) => !relays.urls.includes(url));
	}

	function mergeEvents(
		configured: Awaited<ReturnType<typeof queryPrimaryFirst>>,
		discovered: Awaited<ReturnType<typeof queryUrls>>
	) {
		const seen = new Set<string>();
		return [...configured, ...discovered].filter((event) => {
			if (seen.has(event.id)) return false;
			seen.add(event.id);
			return true;
		});
	}

	function matchesDiscoverSearch(
		event: { content: string; tags: string[][] },
		term: string
	): boolean {
		const query = term.trim().toLocaleLowerCase();
		if (!query) return true;
		if (event.content.toLocaleLowerCase().includes(query)) return true;

		// Searching `bitcoin` should also find an event with a `t` tag even when
		// the author did not repeat #bitcoin in the note body.
		const tagQuery = query.replace(/^#/, '');
		if (!tagQuery || /\s/.test(tagQuery)) return false;
		return event.tags.some((tag) => tag[0] === 't' && tag[1]?.toLocaleLowerCase() === tagQuery);
	}

	function discoveryOnlyIds(
		configured: Awaited<ReturnType<typeof queryPrimaryFirst>>,
		discovered: Awaited<ReturnType<typeof queryUrls>>
	) {
		const configuredIds = new Set(configured.map((event) => event.id));
		return new Set(
			discovered.filter((event) => !configuredIds.has(event.id)).map((event) => event.id)
		);
	}

	function buildDiscoverData(
		events: Array<{
			id: string;
			pubkey: string;
			content: string;
			created_at: number;
			tags: string[][];
		}>,
		options: {
			mediaLimit?: number;
			noteLimit?: number;
			includeNotes?: boolean;
			discoveryIds?: Set<string>;
		} = {}
	) {
		const seen: Record<string, true> = {};
		const tags: Record<string, number> = {};
		const authors: Record<string, Creator> = {};
		const nextMedia: MediaItem[] = [];
		const nextNotes: FeedNote[] = [];
		const mediaLimit = options.mediaLimit ?? MAX_CACHED_MEDIA;
		const noteLimit = options.noteLimit ?? MAX_DISCOVER_NOTES;
		const sortedEvents = [...events].sort((a, b) => b.created_at - a.created_at);

		for (const event of sortedEvents) {
			if (seen[event.id]) continue;
			seen[event.id] = true;

			const noteTags = humanTags(
				event.tags.filter((tag) => tag[0] === 't' && tag[1]).map((tag) => tag[1].toLowerCase())
			);
			const inlineTags = humanTags(
				[...event.content.matchAll(hashtagPattern)].map((match) => match[1].toLowerCase())
			);
			for (const tag of [...noteTags, ...inlineTags].filter(
				(tag, index, all) => all.indexOf(tag) === index
			)) {
				tags[tag] = (tags[tag] ?? 0) + 1;
			}

			if (event.pubkey !== me) {
				const author = authors[event.pubkey] ?? {
					pubkey: event.pubkey,
					count: 0,
					latest: event.created_at
				};
				author.count += 1;
				author.latest = Math.max(author.latest, event.created_at);
				authors[event.pubkey] = author;
			}

			if (options.includeNotes && nextNotes.length < noteLimit) {
				nextNotes.push({
					...toFeedNote(event),
					source: options.discoveryIds?.has(event.id) ? 'discovery' : 'configured'
				});
			}

			const media = mediaFromEvent(event);
			if (media && nextMedia.length < mediaLimit) {
				const reason = sensitiveMediaReason(event.tags, event.content);
				nextMedia.push({
					id: event.id,
					url: media.url,
					kind: media.kind,
					pubkey: event.pubkey,
					content: event.content,
					createdAt: event.created_at,
					sensitiveReason: reason,
					source: options.discoveryIds?.has(event.id) ? 'discovery' : 'configured'
				});
			}
		}

		return {
			data: {
				trendTags: Object.entries(tags)
					.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
					.map(([tag, count]) => ({ tag, count })),
				creators: Object.values(authors).sort((a, b) => b.count - a.count || b.latest - a.latest),
				mediaItems: nextMedia,
				notes: options.includeNotes ? nextNotes : undefined
			},
			sortedEvents
		};
	}

	function applyDiscoverData(data: Omit<DiscoverCache, 'savedAt'>) {
		trendTags = data.trendTags;
		creators = data.creators;
		mediaItems = data.mediaItems.slice(0, MAX_CACHED_MEDIA).map((item) => ({
			...item,
			kind: item.kind ?? 'image',
			createdAt: item.createdAt ?? 0,
			sensitiveReason: item.sensitiveReason ?? '',
			source: item.source ?? 'configured'
		}));
		notes = (data.notes ?? []).slice(0, MAX_DISCOVER_NOTES);
		oldestNoteEventCreatedAt = data.oldestNoteEventCreatedAt ?? notes.at(-1)?.createdAt ?? 0;
		hasMoreNotes = data.hasMoreNotes ?? false;
		notesVisibleCount = INITIAL_NOTES_VISIBLE;
		tagsVisibleCount = INITIAL_TAGS_VISIBLE;
		creatorsVisibleCount = INITIAL_CREATORS_VISIBLE;
		mediaVisibleCount = INITIAL_MEDIA_VISIBLE;
		profiles.ensure(creators.map((creator) => creator.pubkey));
		profiles.ensure(mediaItems.map((item) => item.pubkey));
		profiles.ensure(notes.map((note) => note.pubkey));
	}

	function updateDiscoverNote(next: FeedNote) {
		notes = notes.map((note) => (note.id === next.id ? next : note));
	}

	function updateSearchNote(next: FeedNote) {
		if (!relaySearchData?.notes) return;
		relaySearchData = {
			...relaySearchData,
			notes: relaySearchData.notes.map((note) => (note.id === next.id ? next : note))
		};
	}

	function showMoreNotes() {
		if (filteredNotes.length > notesVisibleCount) {
			notesVisibleCount = Math.min(filteredNotes.length, notesVisibleCount + NOTES_PAGE_SIZE);
		}
		void ensureNotesBuffered();
	}

	async function toggleFollowCreator(pubkey: string) {
		try {
			if (contacts.isFollowing(pubkey)) await contacts.unfollow(pubkey);
			else await contacts.follow(pubkey);
		} catch (error) {
			toasts.error((error as Error).message || 'Could not update follow list');
		}
	}

	function appendDiscoverMedia(nextItems: MediaItem[]) {
		if (!nextItems.length) return;
		mediaItems = mergeMediaLists(mediaItems, nextItems);
		profiles.ensure(nextItems.map((item) => item.pubkey));
		saveCurrentDiscoverCache();
	}

	function loadCachedDiscover() {
		try {
			const raw = localStorage.getItem(DISCOVER_CACHE_KEY);
			if (!raw) return false;
			const cached = JSON.parse(raw) as DiscoverCache;
			if (!cached?.savedAt || Date.now() - cached.savedAt > DISCOVER_CACHE_TTL_MS) return false;
			if (cached.discoveryEnabled && !algorithmPreferences.relayDiscovery.discover) return false;
			if (!Array.isArray(cached.trendTags) || !Array.isArray(cached.creators)) return false;
			applyDiscoverData(cached);
			return true;
		} catch {
			return false;
		}
	}

	function saveDiscoverCache(data: Omit<DiscoverCache, 'savedAt'>) {
		try {
			localStorage.setItem(
				DISCOVER_CACHE_KEY,
				JSON.stringify({
					...data,
					trendTags: data.trendTags.slice(0, MAX_PERSISTED_TAGS),
					creators: data.creators.slice(0, MAX_PERSISTED_CREATORS),
					// Only a tiny slice of notes is persisted; the rest reloads from relays.
					notes: data.notes?.slice(0, MAX_CACHED_NOTES),
					discoveryEnabled: algorithmPreferences.relayDiscovery.discover,
					savedAt: Date.now()
				})
			);
		} catch {
			/* Ignore quota/private-mode failures; cache is only a performance hint. */
		}
	}

	function saveCurrentDiscoverCache() {
		const cachedNotes = notes.slice(0, MAX_CACHED_NOTES);
		saveDiscoverCache({
			trendTags,
			creators,
			mediaItems: mediaItems.slice(0, MAX_CACHED_MEDIA),
			notes: cachedNotes,
			oldestNoteEventCreatedAt: cachedNotes.at(-1)?.createdAt ?? oldestNoteEventCreatedAt,
			hasMoreNotes
		});
	}

	function loadCachedDiscoverSearch(queryValue: string) {
		try {
			const raw = localStorage.getItem(DISCOVER_SEARCH_CACHE_KEY);
			if (!raw) return null;
			const cached = JSON.parse(raw) as DiscoverSearchCache;
			if (!Array.isArray(cached?.queries)) return null;
			const entry = cached.queries.find((item) => item.query === queryValue);
			if (!entry?.savedAt || Date.now() - entry.savedAt > DISCOVER_SEARCH_CACHE_TTL_MS) return null;
			if (entry.discoveryEnabled && !algorithmPreferences.relayDiscovery.discover) return null;
			if (
				!Array.isArray(entry.data?.trendTags) ||
				!Array.isArray(entry.data?.creators) ||
				!Array.isArray(entry.data?.mediaItems)
			)
				return null;
			// Note results are never restored from cache; the live relay query
			// always refills them.
			return { ...entry.data, notes: undefined };
		} catch {
			return null;
		}
	}

	function saveDiscoverSearchCache(queryValue: string, data: Omit<DiscoverCache, 'savedAt'>) {
		try {
			const raw = localStorage.getItem(DISCOVER_SEARCH_CACHE_KEY);
			const cached = raw ? (JSON.parse(raw) as DiscoverSearchCache) : { savedAt: 0, queries: [] };
			const nextQueries = [
				{
					query: queryValue,
					// Notes are never persisted here — only tags, creators, and media.
					// Note search results always reload fresh from relays.
					data: { ...data, notes: undefined },
					discoveryEnabled: algorithmPreferences.relayDiscovery.discover,
					savedAt: Date.now()
				},
				...((cached.queries ?? []).filter((item) => item.query !== queryValue) as Array<{
					query: string;
					data: Omit<DiscoverCache, 'savedAt'>;
					savedAt: number;
				}>)
			]
				.filter((item) => Date.now() - item.savedAt <= DISCOVER_SEARCH_CACHE_TTL_MS)
				.slice(0, MAX_CACHED_SEARCHES);
			localStorage.setItem(
				DISCOVER_SEARCH_CACHE_KEY,
				JSON.stringify({ savedAt: Date.now(), queries: nextQueries })
			);
		} catch {
			/* Ignore quota/private-mode failures; cache is only a performance hint. */
		}
	}

	async function loadDiscover(options: { background?: boolean } = {}) {
		console.debug('[Discover relay] Starting Discover query', { background: !!options.background });
		if (!options.background) loading = true;
		refreshingRelays = true;
		try {
			const filters = [{ kinds: DISCOVER_CONTENT_KINDS, limit: DISCOVER_INITIAL_EVENT_LIMIT }];
			let discovered: Awaited<ReturnType<typeof queryUrls>> = [];
			const applyResults = (events: Awaited<ReturnType<typeof queryPrimaryFirst>>) => {
				const combined = mergeEvents(events, discovered);
				const { data, sortedEvents } = buildDiscoverData(combined, {
					includeNotes: true,
					noteLimit: MAX_DISCOVER_NOTES,
					discoveryIds: discoveryOnlyIds(events, discovered)
				});
				applyDiscoverData(data);
				const oldestEventCreatedAt = sortedEvents.at(-1)?.created_at ?? 0;
				oldestMediaEventCreatedAt = oldestEventCreatedAt;
				oldestNoteEventCreatedAt = oldestEventCreatedAt;
				// Relays often return partial pages, so a short response is not a reliable
				// end-of-feed signal. Continue until a request returns no older events.
				hasMoreMedia = !!oldestMediaEventCreatedAt;
				hasMoreNotes = !!oldestNoteEventCreatedAt;
				saveCurrentDiscoverCache();
			};
			const discoveryPromise = queryUrls(discoveryUrls(), filters).then((events) => {
				discovered = events;
				if (events.length) applyResults(primaryEvents);
				return events;
			});
			let primaryEvents: Awaited<ReturnType<typeof queryPrimaryFirst>> = [];
			const events = await queryPrimaryFirst(filters, {
				onSecondary: (mergedEvents) => {
					applyResults(mergedEvents);
				}
			});
			primaryEvents = events;
			await discoveryPromise;
			applyResults(events);
		} catch (e) {
			console.debug('[Discover relay] Discover query failed', e);
			if (!options.background) {
				toasts.error((e as Error).message || 'Could not load discover data');
			}
		} finally {
			console.debug('[Discover relay] Discover query finished');
			loading = false;
			refreshingRelays = false;
			lastRelayRefreshAt = Math.floor(Date.now() / 1000);
		}
	}

	async function loadMoreNotes() {
		if (loadingMoreNotes || !hasMoreNotes || !oldestNoteEventCreatedAt) {
			console.debug('[Discover pagination] Notes request skipped', {
				loadingMoreNotes,
				hasMoreNotes,
				oldestNoteEventCreatedAt
			});
			return;
		}
		console.debug('[Discover pagination] Requesting older notes from relays', {
			cursor: oldestNoteEventCreatedAt,
			relays: relays.orderedReadUrls.length
		});
		loadingMoreNotes = true;
		try {
			const events = await queryUrls(relays.orderedReadUrls, [
				{
					kinds: DISCOVER_CONTENT_KINDS,
					limit: DISCOVER_PAGE_EVENT_LIMIT,
					until: oldestNoteEventCreatedAt - 1
				}
			]);
			const sortedEvents = events.sort((a, b) => b.created_at - a.created_at);
			oldestNoteEventCreatedAt = sortedEvents.at(-1)?.created_at ?? 0;
			hasMoreNotes = events.length > 0 && oldestNoteEventCreatedAt > 0;
			const { data: olderDiscoverData } = buildDiscoverData(sortedEvents);
			trendTags = mergeTrendTags(trendTags, olderDiscoverData.trendTags);
			creators = mergeCreators(creators, olderDiscoverData.creators);
			profiles.ensure(olderDiscoverData.creators.map((creator) => creator.pubkey));
			const existingIds = new Set(notes.map((note) => note.id));
			const nextNotes = sortedEvents
				.filter((event) => !existingIds.has(event.id))
				.slice(0, NOTES_PAGE_SIZE)
				.map((event) => ({ ...toFeedNote(event), source: 'configured' as const }));
			if (nextNotes.length) {
				notes = [...notes, ...nextNotes];
				profiles.ensure(nextNotes.map((note) => note.pubkey));
			}
			// Tags and people can be new even when this page has no additional
			// visible notes, so persist the bounded startup snapshot either way.
			saveCurrentDiscoverCache();
			console.debug('[Discover pagination] Older notes relay request completed', {
				loaded: nextNotes.length,
				hasMoreNotes,
				nextCursor: oldestNoteEventCreatedAt
			});
		} catch (e) {
			console.debug('[Discover pagination] Older notes relay request failed', e);
			toasts.error((e as Error).message || 'Could not load more notes');
		} finally {
			loadingMoreNotes = false;
		}
	}

	async function ensureNotesBuffered() {
		if (hasActiveRelaySearch || loading || loadingMoreNotes || !hasMoreNotes) return;
		if (notes.length - notesVisibleCount > NOTES_PAGE_SIZE) return;
		await loadMoreNotes();
	}

	async function loadMoreMedia() {
		if (loadingMoreMedia || !hasMoreMedia || !oldestMediaEventCreatedAt) {
			console.debug('[Discover pagination] Media request skipped', {
				loadingMoreMedia,
				hasMoreMedia,
				oldestMediaEventCreatedAt
			});
			return;
		}
		console.debug('[Discover pagination] Requesting older media from relays', {
			cursor: oldestMediaEventCreatedAt,
			relays: relays.orderedReadUrls.length
		});
		loadingMoreMedia = true;
		try {
			const nextMedia: MediaItem[] = [];
			let nextCursor = oldestMediaEventCreatedAt;
			let attempts = 0;

			while (nextMedia.length < MEDIA_PAGE_SIZE && hasMoreMedia && nextCursor > 0 && attempts < 4) {
				const events = await queryUrls(relays.orderedReadUrls, [
					{
						kinds: DISCOVER_CONTENT_KINDS,
						limit: DISCOVER_PAGE_EVENT_LIMIT,
						until: nextCursor - 1
					}
				]);
				attempts += 1;
				if (!events.length) {
					hasMoreMedia = false;
					break;
				}

				const sortedEvents = events.sort((a, b) => b.created_at - a.created_at);
				nextCursor = sortedEvents.at(-1)?.created_at ?? 0;
				oldestMediaEventCreatedAt = nextCursor;
				hasMoreMedia = nextCursor > 0;

				const existingIds = new Set([...mediaItems, ...nextMedia].map((item) => item.id));
				for (const event of sortedEvents) {
					if (existingIds.has(event.id)) continue;
					const media = mediaFromEvent(event);
					if (!media) continue;
					existingIds.add(event.id);
					nextMedia.push({
						id: event.id,
						url: media.url,
						kind: media.kind,
						pubkey: event.pubkey,
						content: event.content,
						createdAt: event.created_at,
						sensitiveReason: sensitiveMediaReason(event.tags, event.content)
					});
					if (nextMedia.length >= MEDIA_PAGE_SIZE) break;
				}
			}

			appendDiscoverMedia(nextMedia);
			console.debug('[Discover pagination] Older media relay request completed', {
				loaded: nextMedia.length,
				hasMoreMedia,
				nextCursor: oldestMediaEventCreatedAt
			});
		} catch (e) {
			console.debug('[Discover pagination] Older media relay request failed', e);
			toasts.error((e as Error).message || 'Could not load more media');
		} finally {
			loadingMoreMedia = false;
		}
	}

	async function ensureMediaBuffered() {
		if (hasActiveRelaySearch || loading || loadingMoreMedia || !hasMoreMedia) return;
		if (filteredMedia.length - mediaVisibleCount > MEDIA_PREFETCH_THRESHOLD) return;
		await loadMoreMedia();
	}

	function revealMoreMedia() {
		const availableMedia = hasActiveRelaySearch
			? (relaySearchData?.mediaItems ?? [])
			: filteredMedia;
		console.debug('[Discover pagination] Revealing media', {
			visible: mediaVisibleCount,
			available: availableMedia.length,
			hasMoreMedia
		});
		if (availableMedia.length > mediaVisibleCount) {
			mediaVisibleCount = Math.min(availableMedia.length, mediaVisibleCount + MEDIA_PAGE_SIZE);
		}
		void ensureMediaBuffered();
	}

	function loadNextDiscoverResults(trigger: 'scroll' | 'sentinel') {
		console.debug('[Discover pagination] Checking next page', {
			trigger,
			tab: activeTab,
			visibleNotes: visibleNotes.length,
			availableNotes: filteredNotes.length,
			visibleMedia: activeMedia.length,
			availableMedia: activeMediaCount,
			hasMoreMedia
		});
		if (activeTab === 'notes') {
			if (visibleNotes.length < filteredNotes.length) {
				console.debug('[Discover pagination] Auto-revealing notes');
				showMoreNotes();
			} else {
				console.debug('[Discover pagination] Auto-requesting older notes from relays');
				void ensureNotesBuffered();
			}
			return;
		}
		if (activeTab === 'media') {
			console.debug('[Discover pagination] Auto-revealing media');
			revealMoreMedia();
			return;
		}
		if (activeTab === 'people') {
			if (visibleCreators.length < rankedCreators.length) {
				console.debug('[Discover pagination] Revealing more people');
				creatorsVisibleCount = Math.min(
					rankedCreators.length,
					creatorsVisibleCount + INITIAL_CREATORS_VISIBLE
				);
			} else {
				console.debug('[Discover pagination] Requesting older results for more people');
				void loadMoreNotes();
			}
			return;
		}
		if (activeTab === 'tags') {
			if (visibleTrendTags.length < activeTrendTags.length) {
				console.debug('[Discover pagination] Revealing more tags');
				tagsVisibleCount = Math.min(
					activeTrendTags.length,
					tagsVisibleCount + INITIAL_TAGS_VISIBLE
				);
			} else {
				console.debug('[Discover pagination] Requesting older results for more tags');
				void loadMoreNotes();
			}
			return;
		}
		console.debug('[Discover pagination] Nothing more to load for this tab');
	}

	function observeDiscoverPagination(node: HTMLElement) {
		if (typeof IntersectionObserver === 'undefined') {
			console.debug(
				'[Discover pagination] IntersectionObserver unavailable; using scroll fallback'
			);
			return {};
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) return;
				console.debug('[Discover pagination] Bottom sentinel reached', {
					usesDiscoverScroller: !!discoverScroller
				});
				loadNextDiscoverResults('sentinel');
			},
			{ root: discoverScroller ?? null, rootMargin: '0px 0px 640px', threshold: 0 }
		);
		observer.observe(node);
		return { destroy: () => observer.disconnect() };
	}

	function handleDiscoverScroll() {
		if (!discoverScroller) return;
		const remaining =
			discoverScroller.scrollHeight - discoverScroller.scrollTop - discoverScroller.clientHeight;
		console.debug('[Discover pagination] Scroll received', {
			tab: activeTab,
			scrollTop: Math.round(discoverScroller.scrollTop),
			remaining: Math.round(remaining),
			threshold: Math.round(discoverScroller.clientHeight * 1.5)
		});
		// Keep the current result surface moving without unexpectedly fetching or
		// expanding a tab the person is not looking at. Buttons below each list
		// remain as a keyboard and manual-retry fallback.
		if (remaining >= discoverScroller.clientHeight * 1.5) return;
		loadNextDiscoverResults('scroll');
	}

	function openMediaDialog(item: MediaItem) {
		const idx = activeMedia.indexOf(item);
		mediaIndex = idx >= 0 ? idx : 0;
		mediaDialogOpen = true;
	}

	function handleMediaTileClick(item: MediaItem) {
		if (shouldHideMedia(item)) {
			revealMedia(item);
			return;
		}
		openMediaDialog(item);
	}

	function isMediaRevealed(item: MediaItem) {
		return !!revealedSensitiveMedia[item.id];
	}

	function revealMedia(item: MediaItem) {
		revealedSensitiveMedia = { ...revealedSensitiveMedia, [item.id]: true };
	}

	function shouldHideMedia(item: MediaItem) {
		return (
			privacyNotificationSettings.state.hideSensitiveMedia &&
			!!item.sensitiveReason &&
			!isMediaRevealed(item)
		);
	}

	function prevMedia() {
		if (mediaIndex > 0) {
			mediaIndex -= 1;
			zoomOpen = false;
		}
	}

	function nextMedia() {
		if (mediaIndex < activeMedia.length - 1) {
			mediaIndex += 1;
			zoomOpen = false;
		}
	}

	function onViewerKey(e: KeyboardEvent) {
		// Let the zoom lightbox own the keyboard while it's open.
		if (!mediaDialogOpen || zoomOpen) return;
		if (e.key === 'Escape') mediaDialogOpen = false;
		else if (e.key === 'ArrowLeft') prevMedia();
		else if (e.key === 'ArrowRight') nextMedia();
	}

	async function searchDiscoverRelays(term: string) {
		console.debug('[Discover relay] Starting search query', { term });
		const searchToken = ++relaySearchToken;
		searchingRelays = true;
		mediaVisibleCount = INITIAL_MEDIA_VISIBLE;
		notesVisibleCount = INITIAL_NOTES_VISIBLE;
		try {
			// Cached searches only paint tags, creators, and media instantly. Notes
			// are never served from cache, so keep querying the relays below to
			// refresh the full result set (including notes) fresh.
			const cached = loadCachedDiscoverSearch(term);
			if (cached && searchToken === relaySearchToken) {
				relaySearchData = { ...cached, notes: [] };
				profiles.ensure(cached.creators.map((creator) => creator.pubkey));
				profiles.ensure(cached.mediaItems.map((item) => item.pubkey));
			}

			const filters = [
				{
					kinds: DISCOVER_CONTENT_KINDS,
					limit: DISCOVER_SEARCH_EVENT_LIMIT,
					search: term
				} as Filter,
				{
					kinds: DISCOVER_CONTENT_KINDS,
					limit: DISCOVER_SEARCH_EVENT_LIMIT,
					'#t': [queryTag || term.toLowerCase()]
				} as Filter,
				// NIP-50 full-text search is optional. Fetch a bounded recent sample
				// too, then apply the same text/tag matching locally as a reliable
				// fallback for relays that do not implement `search`.
				{
					kinds: DISCOVER_CONTENT_KINDS,
					limit: DISCOVER_TEXT_FALLBACK_LIMIT
				} as Filter
			];
			let discovered: Awaited<ReturnType<typeof queryUrls>> = [];
			const applyResults = (events: Awaited<ReturnType<typeof queryPrimaryFirst>>) => {
				if (searchToken !== relaySearchToken) return;
				const matchingEvents = mergeEvents(events, discovered).filter((event) =>
					matchesDiscoverSearch(event, term)
				);
				relaySearchData = buildDiscoverData(matchingEvents, {
					mediaLimit: MAX_CACHED_MEDIA,
					noteLimit: MAX_DISCOVER_NOTES,
					includeNotes: true,
					discoveryIds: discoveryOnlyIds(events, discovered)
				}).data;
				saveDiscoverSearchCache(term, relaySearchData);
				profiles.ensure(relaySearchData.creators.map((creator) => creator.pubkey));
				profiles.ensure(relaySearchData.mediaItems.map((item) => item.pubkey));
				profiles.ensure(relaySearchData.notes?.map((note) => note.pubkey) ?? []);
			};
			const discoveryPromise = queryUrls(discoveryUrls(), filters).then((events) => {
				discovered = events;
				applyResults(primaryEvents);
				return events;
			});
			let primaryEvents: Awaited<ReturnType<typeof queryPrimaryFirst>> = [];
			const events = await queryPrimaryFirst(filters, {
				onSecondary: (mergedEvents) => {
					applyResults(mergedEvents);
				}
			});
			primaryEvents = events;
			await discoveryPromise;
			applyResults(events);
		} catch (e) {
			if (searchToken !== relaySearchToken) return;
			console.debug('[Discover relay] Search query failed', e);
			relaySearchData = { trendTags: [], creators: [], mediaItems: [], notes: [] };
			toasts.error((e as Error).message || 'Could not search relays');
		} finally {
			if (searchToken === relaySearchToken) {
				console.debug('[Discover relay] Search query finished', { term });
				searchingRelays = false;
			}
		}
	}

	$effect(() => {
		if (!hasActiveRelaySearch) {
			relaySearchToken += 1;
			searchingRelays = false;
			relaySearchData = null;
			return;
		}

		const term = queryTrimmed;
		const handle = window.setTimeout(() => {
			void searchDiscoverRelays(term);
		}, SEARCH_DEBOUNCE_MS);

		return () => window.clearTimeout(handle);
	});

	onMount(() => {
		const hasCache = loadCachedDiscover();
		if (hasCache) {
			loading = false;
			void loadDiscover({ background: true });
		} else {
			void loadDiscover();
		}
	});
</script>

<svelte:head><title>Discover · BitOS</title></svelte:head>

<div bind:this={discoverScroller} class="h-full overflow-y-auto" onscroll={handleDiscoverScroll}>
	<PageHeader title="Discover">
		{#snippet subtitle()}
			Real notes, tags, creators, and media from your relays
			{#if refreshingRelays}
				· <span class="inline-flex items-center gap-1"
					><Icon
						name="i-lucide-loader-circle"
						class="size-3 animate-spin text-primary-500"
					/>Refreshing relays…</span
				>
			{:else if lastRelayRefreshAt}
				· <span class="inline-flex items-center gap-1"
					><Icon name="i-lucide-check-circle-2" class="size-3 text-primary-500" />Updated {timeAgo(
						lastRelayRefreshAt
					)}</span
				>
			{/if}
		{/snippet}
		{#snippet actions()}
			<button
				type="button"
				onclick={() => loadDiscover()}
				class="icon-btn size-9"
				aria-label="Refresh discover"
			>
				<Icon name="i-lucide-rotate-cw" class="size-[18px] {loading ? 'animate-spin' : ''}" />
			</button>
		{/snippet}
		{#snippet tabs()}
			<div
				class="flex gap-1 overflow-x-auto px-[clamp(1rem,3vw,1.5rem)]"
				role="tablist"
				aria-label="Discover results"
			>
				{#each resultTabs as tab (tab.key)}
					<button
						type="button"
						role="tab"
						aria-selected={activeTab === tab.key}
						onclick={() => (activeTab = tab.key)}
						class="relative shrink-0 px-3 py-2.5 text-[12px] font-bold transition {activeTab ===
						tab.key
							? 'text-primary-600'
							: 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
					>
						{tab.label}<span class="ml-1.5 font-mono text-[10px] opacity-70">{tab.count}</span>
						{#if activeTab === tab.key}<span
								class="absolute right-2 bottom-0 left-2 h-0.5 rounded-full bg-primary-500"
							></span>{/if}
					</button>
				{/each}
			</div>
		{/snippet}
	</PageHeader>
	<div class="page-container page-container--wide py-6">
		<div class="relative mb-6">
			<Icon
				name="i-lucide-search"
				class="absolute top-1/2 left-4 size-5 -translate-y-1/2 text-[var(--ui-text-dimmed)]"
			/>
			<input
				type="text"
				bind:value={query}
				placeholder="Search creators, hashtags, images, or videos..."
				class="w-full rounded-2xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] py-3.5 pr-12 pl-12 text-[14px] transition outline-none placeholder:text-[var(--ui-text-dimmed)] focus:ring-2 focus:ring-primary-500/30"
			/>
			{#if searchingRelays}
				<div
					class="absolute top-1/2 right-12 grid size-6 -translate-y-1/2 place-items-center text-[var(--ui-text-dimmed)]"
				>
					<Icon name="i-lucide-loader-circle" class="size-4 animate-spin" />
				</div>
			{/if}
			{#if query}
				<button
					type="button"
					onclick={() => (query = '')}
					class="absolute top-1/2 right-3 grid size-8 -translate-y-1/2 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text-highlighted)]"
					aria-label="Clear search"
				>
					<Icon name="i-lucide-x" class="size-4" />
				</button>
			{/if}
		</div>
		{#if hasActiveRelaySearch}
			<p class="mb-6 text-[12px] font-semibold text-[var(--ui-text-muted)]">
				{searchingRelays ? 'Searching relays...' : `Relay results for "${queryTrimmed}"`}
			</p>
		{/if}
		{#if hasActiveRelaySearch && activeTab === 'notes'}
			<section class="mb-8" aria-label="Matching notes">
				<div class="mb-3 flex items-center justify-between gap-3">
					<div>
						<h3 class="font-display text-[18px] font-extrabold">Notes</h3>
						<p class="text-[11px] text-[var(--ui-text-muted)]">Matching text notes from relays</p>
					</div>
					{#if filteredNotes.length}
						<span
							class="rounded-full bg-primary-500/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-primary-600"
						>
							{filteredNotes.length} result{filteredNotes.length === 1 ? '' : 's'}
						</span>
					{/if}
				</div>
				<div class="mb-3 flex justify-end">
					<select
						bind:value={noteScope}
						class="rounded-lg border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--ui-text-muted)] outline-none focus:border-primary-500"
						><option value="latest">Latest notes</option><option value="following"
							>From people you follow</option
						></select
					>
				</div>
				{#if filteredNotes.length}
					<div class="-mx-[clamp(1rem,3vw,1.5rem)] divide-y divide-[var(--ui-border-muted)]">
						{#each visibleNotes as note, index (note.id)}
							<PostCard {note} {index} flat onNoteChange={updateSearchNote} />
						{/each}
					</div>
					{#if isRelayQuerying}
						<div class="mt-3 space-y-3" role="status" aria-live="polite">
							<span class="sr-only">Loading notes from relays</span>
							{#each [0, 1] as item (item)}
								<div class="h-28 animate-pulse rounded-2xl bg-[var(--ui-bg-muted)]"></div>
							{/each}
						</div>
					{/if}
					{#if visibleNotes.length < filteredNotes.length || (!hasActiveRelaySearch && hasMoreNotes)}<button
							use:observeDiscoverPagination
							type="button"
							onclick={showMoreNotes}
							disabled={loadingMoreNotes && visibleNotes.length >= filteredNotes.length}
							class="mt-3 w-full rounded-xl border border-[var(--ui-border-muted)] py-2.5 text-[12px] font-bold text-primary-600 transition hover:bg-primary-500/5"
							>{visibleNotes.length < filteredNotes.length
								? 'Load more notes'
								: 'Loading older notes'}</button
						>{/if}
				{:else if searchingRelays}
					<div class="space-y-3">
						{#each [0, 1] as item (item)}
							<div class="h-32 animate-pulse rounded-2xl bg-[var(--ui-bg-muted)]"></div>
						{/each}
					</div>
				{:else}
					<div class="post-card p-5 text-[13px] text-[var(--ui-text-muted)]">
						No text notes matched this search. Try another phrase, hashtag, or author.
					</div>
				{/if}
			</section>
		{/if}

		{#if !hasActiveRelaySearch && activeTab === 'notes'}
			<section class="mb-8" aria-label="Latest notes from relays">
				<div class="mb-3 flex items-center justify-between gap-3">
					<div>
						<h3 class="font-display text-[18px] font-extrabold">Latest notes</h3>
						<p class="text-[11px] text-[var(--ui-text-muted)]">
							Recent text notes from your relays
						</p>
					</div>
					{#if filteredNotes.length}
						<span
							class="rounded-full bg-primary-500/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-primary-600"
						>
							{filteredNotes.length} notes
						</span>
					{/if}
				</div>
				<div class="mb-3 flex justify-end">
					<select
						bind:value={noteScope}
						class="rounded-lg border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--ui-text-muted)] outline-none focus:border-primary-500"
						><option value="latest">Latest notes</option><option value="following"
							>From people you follow</option
						></select
					>
				</div>
				{#if filteredNotes.length}
					<div class="-mx-[clamp(1rem,3vw,1.5rem)] divide-y divide-[var(--ui-border-muted)]">
						{#each visibleNotes as note, index (note.id)}
							<PostCard {note} {index} flat onNoteChange={updateDiscoverNote} />
						{/each}
					</div>
					{#if isRelayQuerying}
						<div class="mt-3 space-y-3" role="status" aria-live="polite">
							<span class="sr-only">Loading notes from relays</span>
							{#each [0, 1] as item (item)}
								<div class="h-28 animate-pulse rounded-2xl bg-[var(--ui-bg-muted)]"></div>
							{/each}
						</div>
					{/if}
					{#if visibleNotes.length < filteredNotes.length || (!hasActiveRelaySearch && hasMoreNotes)}<button
							use:observeDiscoverPagination
							type="button"
							onclick={showMoreNotes}
							disabled={loadingMoreNotes && visibleNotes.length >= filteredNotes.length}
							class="mt-3 w-full rounded-xl border border-[var(--ui-border-muted)] py-2.5 text-[12px] font-bold text-primary-600 transition hover:bg-primary-500/5"
							>{visibleNotes.length < filteredNotes.length
								? 'Load more notes'
								: 'Loading older notes'}</button
						>{/if}
				{:else if loading}
					<div class="space-y-3">
						{#each [0, 1] as item (item)}
							<div class="h-32 animate-pulse rounded-2xl bg-[var(--ui-bg-muted)]"></div>
						{/each}
					</div>
				{:else}
					<div class="post-card p-5 text-[13px] text-[var(--ui-text-muted)]">
						No recent text notes were returned by your relays.
					</div>
				{/if}
			</section>
		{/if}

		{#if activeTab === 'tags'}
			<div class="mb-6">
				<h3 class="mb-3 font-display text-[18px] font-extrabold">Trending tags</h3>
				{#if activeTrendTags.length}
					<div class="flex flex-wrap gap-2">
						{#each visibleTrendTags as item (item.tag)}
							<div class="flex items-center gap-1">
								<a href={`/?tag=${encodeURIComponent(item.tag)}`} class="trend-tag">
									<Icon name="i-lucide-hash" class="size-3.5 text-primary-500" />
									#{item.tag}
									<span class="font-normal text-[var(--ui-text-dimmed)]">{item.count}</span>
								</a>
								<button
									type="button"
									onclick={() => {
										const followed = hashtagFollows.toggle(item.tag);
										if (followed)
											toasts.success(`Following #${item.tag} — its notes now appear in your feeds`);
										else toasts.info(`Unfollowed #${item.tag}`);
									}}
									class="grid size-6 shrink-0 place-items-center rounded-full transition {hashtagFollows.has(
											item.tag
										)
											? 'bg-primary-500/15 text-primary-600'
											: 'text-[var(--ui-text-dimmed)] hover:bg-primary-500/10 hover:text-primary-600'}"
									aria-label={hashtagFollows.has(item.tag)
										? `Unfollow #${item.tag}`
										: `Follow #${item.tag}`}
									title={hashtagFollows.has(item.tag)
										? `Unfollow #${item.tag} (synced via NIP-51)`
										: `Follow #${item.tag} (synced via NIP-51)`}
								>
									<Icon
											name={hashtagFollows.has(item.tag) ? 'i-lucide-check' : 'i-lucide-plus'}
											class="size-3.5"
										/>
								</button>
							</div>
						{/each}
					</div>
					{#if visibleTrendTags.length < activeTrendTags.length || (!hasActiveRelaySearch && hasMoreNotes)}
						<button
							use:observeDiscoverPagination
							type="button"
							onclick={() => loadNextDiscoverResults('sentinel')}
							disabled={loadingMoreNotes && visibleTrendTags.length >= activeTrendTags.length}
							class="mt-4 w-full rounded-xl border border-[var(--ui-border-muted)] py-2.5 text-[12px] font-bold text-primary-600 transition hover:bg-primary-500/5"
						>
							{visibleTrendTags.length < activeTrendTags.length
								? 'Show more tags'
								: 'Load older tags'}
						</button>
					{:else}
						<p class="mt-4 text-center text-[11px] font-semibold text-[var(--ui-text-dimmed)]">
							All available tags are shown
						</p>
					{/if}
				{:else}
					<div class="post-card p-5 text-[13px] text-[var(--ui-text-muted)]">
						{searchingRelays
							? 'Searching tags from relays...'
							: hasActiveRelaySearch
								? 'No relay tags matched your search.'
								: loading
									? 'Loading tags from relays...'
									: 'No tags found from your relays.'}
					</div>
				{/if}
			</div>
		{/if}

		{#if activeTab === 'people'}
			<div class="mb-8">
				<div class="mb-3 flex items-center justify-between gap-2">
					<h3 class="font-display text-[18px] font-extrabold">People you might like</h3>
					{#if activeCreators.length}
						<a
							href="/settings/algorithm"
							class="text-[11px] font-bold text-primary-500 transition hover:text-primary-600"
						>
							{algorithmPreferences.isEnabled('discover') ? 'Ranked · Tune' : 'Tune'}
						</a>
					{/if}
				</div>
				{#if activeCreators.length}
					<div class="grid grid-cols-1 gap-x-10 gap-y-8 sm:grid-cols-2">
						{#each visibleCreators as creator (creator.pubkey)}
							{@const profile = profiles.get(creator.pubkey)}
							{@const name = profile?.display_name || profile?.name || shortKey(creator.pubkey)}
							<div class="min-w-0">
								<div class="flex items-center gap-3">
									<a
										href={`/profile/${creator.pubkey}`}
										class="shrink-0 mask-squircle transition hover:ring-2 hover:ring-primary-500/30"
										aria-label={`Open ${name} profile`}
									>
										<Avatar pubkey={creator.pubkey} {name} picture={profile?.picture} size={46} />
									</a>
									<a
										href={`/profile/${creator.pubkey}`}
										class="min-w-0 transition hover:text-primary-600"
									>
										<p class="flex min-w-0 items-center gap-1 text-[14px] font-bold">
											<span class="truncate">{name}</span>
											{#if profile?.nip05}
												<Icon
													name="i-lucide-badge-check"
													class="size-3.5 shrink-0 text-primary-500"
													title={`NIP-05: ${profile.nip05}`}
												/>
											{/if}
										</p>
										<p class="truncate font-mono text-[10px] text-[var(--ui-text-dimmed)]">
											{shortKey(npubEncode(creator.pubkey), 12, 4)}
										</p>
									</a>
								</div>
								<p
									class="mt-3 line-clamp-2 min-h-10 text-[12px] leading-5 text-[var(--ui-text-muted)]"
								>
									{profile?.about ||
										`${creator.count} recent ${creator.count === 1 ? 'note' : 'notes'} from relays.`}
								</p>
								<div class="mt-3 flex items-center justify-between gap-3">
									<span class="font-mono text-[10px] text-[var(--ui-text-dimmed)]">
										{creator.count} notes · {timeAgo(creator.latest)}
									</span>
									<button
										type="button"
										onclick={() => toggleFollowCreator(creator.pubkey)}
										class="rounded-full bg-primary-500 px-3.5 py-1.5 text-[11px] font-bold text-[var(--ui-text-inverted)] transition hover:bg-primary-600"
									>
										{contacts.isFollowing(creator.pubkey) ? 'Following' : 'Follow'}
									</button>
								</div>
							</div>
						{/each}
					</div>
					{#if visibleCreators.length < rankedCreators.length || (!hasActiveRelaySearch && hasMoreNotes)}
						<button
							use:observeDiscoverPagination
							type="button"
							onclick={() => loadNextDiscoverResults('sentinel')}
							disabled={loadingMoreNotes && visibleCreators.length >= rankedCreators.length}
							class="mt-5 w-full rounded-xl border border-[var(--ui-border-muted)] py-2.5 text-[12px] font-bold text-primary-600 transition hover:bg-primary-500/5"
						>
							{visibleCreators.length < rankedCreators.length
								? 'Load more people'
								: 'Load older people'}
						</button>
					{:else}
						<p class="mt-5 text-center text-[11px] font-semibold text-[var(--ui-text-dimmed)]">
							All available people are shown
						</p>
					{/if}
				{:else}
					<div class="post-card p-5 text-[13px] text-[var(--ui-text-muted)]">
						{searchingRelays
							? 'Searching creators from relays...'
							: hasActiveRelaySearch
								? 'No relay creators matched your search.'
								: loading
									? 'Loading creators from relays...'
									: 'No creators found.'}
					</div>
				{/if}
			</div>
		{/if}

		{#if activeTab === 'media'}
			<div class="mb-6">
				<div class="mb-3 flex items-center justify-between gap-3">
					<h3 class="font-display text-[18px] font-extrabold">Media</h3>
					{#if activeMediaCount}
						<p class="text-[12px] font-semibold text-[var(--ui-text-muted)]">
							{activeMediaCount} result{activeMediaCount === 1 ? '' : 's'}
						</p>
					{/if}
				</div>
				{#if activeMedia.length}
					<div class="masonry">
						{#each activeMedia as item (item.id)}
							{@const profile = profiles.get(item.pubkey)}
							{@const name = profile?.display_name || profile?.name || shortKey(item.pubkey)}
							<button
								type="button"
								onclick={() => handleMediaTileClick(item)}
								class="group relative block w-full cursor-pointer overflow-hidden rounded-xl text-left transition-transform hover:scale-[0.97]"
							>
								{#if item.kind === 'video'}
									<!-- svelte-ignore a11y_media_has_caption -->
									<video
										src={item.url}
										class="aspect-video w-full bg-black object-cover transition {!shouldHideMedia(
											item
										)
											? ''
											: 'scale-105 blur-2xl saturate-50'}"
										muted
										playsinline
										preload="metadata"
										onmouseenter={(event) => {
											// Desktop hover-to-preview: scrub the tile alive like IG/TikTok grids.
											if (shouldHideMedia(item)) return;
											void (event.currentTarget as HTMLVideoElement).play().catch(() => {});
										}}
										onmouseleave={(event) => {
											const video = event.currentTarget as HTMLVideoElement;
											video.pause();
											video.currentTime = 0;
										}}
										onloadedmetadata={(event) => {
											const video = event.currentTarget as HTMLVideoElement;
											if (Number.isFinite(video.duration))
												videoDurations = { ...videoDurations, [item.id]: video.duration };
										}}
									></video>
									<div
										class="absolute top-2 right-2 grid size-9 place-items-center rounded-full bg-black/55 text-white backdrop-blur transition group-hover:scale-90 group-hover:opacity-0"
									>
										<Icon name="i-lucide-play" class="size-4 fill-current" />
									</div>
									{#if videoDurations[item.id]}
										<span
											class="absolute right-2 bottom-2 rounded-md bg-black/65 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white tabular-nums backdrop-blur"
										>
											{formatDuration(videoDurations[item.id])}
										</span>
									{/if}
								{:else}
									<img
										src={item.url}
										class="w-full transition {!shouldHideMedia(item)
											? ''
											: 'scale-105 blur-2xl saturate-50'}"
										alt=""
										loading="lazy"
									/>
								{/if}
								{#if shouldHideMedia(item)}
									<div
										class="absolute inset-0 z-10 grid place-items-center bg-black/18 p-4 text-center text-white"
									>
										<span
											class="max-w-56 rounded-[22px] border border-white/25 bg-white/14 px-4 py-3 shadow-lg backdrop-blur-md backdrop-saturate-150"
										>
											<Icon name="i-lucide-eye-off" class="mx-auto mb-2 size-5 text-white/90" />
											<span class="block text-[13px] font-bold"
												>{item.kind === 'image' ? 'Image hidden' : 'Sensitive media'}</span
											>
											{#if privacyNotificationSettings.state.sensitiveReason}
												<span class="mt-1 block text-[11px] text-white/80"
													>{item.sensitiveReason}</span
												>
											{/if}
											<span
												class="mt-2 inline-flex rounded-full border border-white/25 bg-white/90 px-3 py-1 text-[11px] font-bold text-black"
											>
												View
											</span>
										</span>
									</div>
								{/if}
								<div
									class="absolute inset-0 flex items-end bg-black/0 p-3 text-white opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100"
								>
									<div class="min-w-0">
										<div class="mb-1 flex items-center gap-1.5 text-[11px] font-bold">
											<Icon
												name={item.kind === 'video' ? 'i-lucide-video' : 'i-lucide-image'}
												class="size-3.5"
											/>
											<span class="truncate">{name}</span>
											{#if item.source === 'discovery'}
												<span
													class="shrink-0 rounded-full bg-primary-500/80 px-1.5 py-0.5 text-[9px] uppercase"
													>discovery</span
												>
											{/if}
										</div>
										{#if mediaCaption(item.content, item.url)}
											<p class="line-clamp-3 text-[12px] font-semibold">
												{mediaCaption(item.content, item.url)}
											</p>
										{/if}
									</div>
								</div>
							</button>
						{/each}
					</div>
					{#if isRelayQuerying}
						<div class="masonry mt-3" role="status" aria-live="polite">
							<span class="sr-only">Loading media from relays</span>
							{#each [0, 1, 2, 3, 4, 5] as item (item)}
								<div
									class="animate-pulse break-inside-avoid rounded-xl bg-[var(--ui-bg-muted)] {item %
										3 ===
									0
										? 'aspect-[4/5]'
										: item % 3 === 1
											? 'aspect-square'
											: 'aspect-[3/4]'}"
								></div>
							{/each}
						</div>
					{/if}
					<div class="mt-5 flex flex-col items-center gap-2">
						<button
							use:observeDiscoverPagination
							type="button"
							onclick={revealMoreMedia}
							disabled={loadingMoreMedia ||
								(!hasUnrevealedMedia && (!hasMoreMedia || hasActiveRelaySearch))}
							class="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-4 text-[13px] font-bold text-[var(--ui-text)] transition hover:border-primary-500 hover:text-primary-500"
						>
							<Icon
								name={loadingMoreMedia && !hasUnrevealedMedia
									? 'i-lucide-loader-circle'
									: 'i-lucide-plus'}
								class="size-4 {loadingMoreMedia && !hasUnrevealedMedia ? 'animate-spin' : ''}"
							/>
							{loadingMoreMedia
								? 'Loading older media'
								: hasUnrevealedMedia
									? 'Load more media'
									: hasMoreMedia && !hasActiveRelaySearch
										? 'Load older media'
										: 'All available media is shown'}
						</button>
						{#if !hasUnrevealedMedia && (!hasMoreMedia || hasActiveRelaySearch) && !loadingMoreMedia}
							<p class="text-center text-[11px] font-semibold text-[var(--ui-text-dimmed)]">
								No additional media from these relay results
							</p>
						{/if}
					</div>
				{:else}
					<div class="post-card p-5 text-[13px] text-[var(--ui-text-muted)]">
						{searchingRelays
							? 'Searching media from relays...'
							: hasActiveRelaySearch
								? 'No relay media matched your search.'
								: loading
									? 'Loading media from relays...'
									: queryText
										? 'No media matched your search.'
										: 'No image or video media links found.'}
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>

<svelte:window onkeydown={onViewerKey} />

{#if mediaDialogOpen && selectedMediaItem}
	{@const profile = profiles.get(selectedMediaItem.pubkey)}
	{@const name = profile?.display_name || profile?.name || shortKey(selectedMediaItem.pubkey)}
	<!-- Immersive media viewer -->
	<div class="animate-fade fixed inset-0 z-[60] flex flex-col bg-black/95 backdrop-blur-sm">
		<!-- Top bar -->
		<header class="flex items-center gap-2 p-3 text-white">
			<a
				href={`/profile/${selectedMediaItem.pubkey}`}
				onclick={() => (mediaDialogOpen = false)}
				class="flex min-w-0 flex-1 items-center gap-2.5 rounded-full p-1 pr-3 transition hover:bg-white/10"
			>
				<Avatar pubkey={selectedMediaItem.pubkey} {name} picture={profile?.picture} size={36} />
				<div class="min-w-0 leading-tight">
					<p class="truncate text-[14px] font-bold">{name}</p>
					<p class="text-[11.5px] text-white/65">
						{selectedMediaItem.createdAt ? timeAgo(selectedMediaItem.createdAt) : 'Recent post'}
					</p>
				</div>
			</a>
			{#if activeMedia.length > 1}
				<span class="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold tabular-nums">
					{mediaIndex + 1} / {activeMedia.length}
				</span>
			{/if}
			<a
				href={`/note/${selectedMediaItem.id}?from=discover`}
				class="hidden h-9 items-center rounded-full border border-white/20 px-4 text-[12px] font-bold transition hover:bg-white/10 sm:inline-flex"
			>
				Open note
			</a>
			<button
				type="button"
				onclick={() => (mediaDialogOpen = false)}
				class="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 transition hover:bg-white/20"
				aria-label="Close"
			>
				<Icon name="i-lucide-x" class="size-5" />
			</button>
		</header>

		<!-- Media stage -->
		<div class="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-2">
			{#if activeMedia.length > 1}
				<button
					type="button"
					onclick={prevMedia}
					disabled={mediaIndex === 0}
					class="absolute top-1/2 left-2 z-10 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20 disabled:pointer-events-none disabled:opacity-30"
					aria-label="Previous"
				>
					<Icon name="i-lucide-chevron-left" class="size-6" />
				</button>
			{/if}

			<div class="relative min-h-0 w-full overflow-hidden">
				{#if shouldHideMedia(selectedMediaItem)}
					<div class="grid min-h-[60vh] place-items-center px-4">
						<button
							type="button"
							onclick={() => revealMedia(selectedMediaItem)}
							class="max-w-sm rounded-3xl bg-white/10 px-6 py-5 text-center text-white shadow-xl backdrop-blur"
						>
							<Icon name="i-lucide-eye-off" class="mx-auto mb-3 size-8 text-white/90" />
							<p class="text-[15px] font-bold">
								{selectedMediaItem.kind === 'image' ? 'Image hidden' : 'Sensitive media hidden'}
							</p>
							{#if privacyNotificationSettings.state.sensitiveReason}
								<p class="mt-1 text-[12px] text-white/75">{selectedMediaItem.sensitiveReason}</p>
							{/if}
							<span
								class="mt-4 inline-flex rounded-full bg-white px-4 py-2 text-[12px] font-bold text-black"
							>
								Show media
							</span>
						</button>
					</div>
				{:else if selectedMediaItem.kind === 'video'}
					<!-- Full BitOS player: seek + buffered bar, speed, volume,
						 buffering + retry, and a fullscreen button. -->
					<MediaPlayer
						src={selectedMediaItem.url}
						label="Discover video"
						class="relative mx-auto w-full max-w-5xl"
						mediaClass="mx-auto max-h-[80vh] w-full bg-black object-contain"
						overlayControls
						autoplay
					/>
				{:else}
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions, a11y_no_noninteractive_element_interactions -->
					<img
						src={selectedMediaItem.url}
						alt="Discover media"
						onclick={() => (zoomOpen = true)}
						class="mx-auto max-h-[80vh] w-auto cursor-zoom-in rounded-xl object-contain"
					/>
				{/if}
			</div>

			{#if activeMedia.length > 1}
				<button
					type="button"
					onclick={nextMedia}
					disabled={mediaIndex === activeMedia.length - 1}
					class="absolute top-1/2 right-2 z-10 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20 disabled:pointer-events-none disabled:opacity-30"
					aria-label="Next"
				>
					<Icon name="i-lucide-chevron-right" class="size-6" />
				</button>
			{/if}
		</div>

		<!-- Caption + mobile actions -->
		{#if mediaCaption(selectedMediaItem.content, selectedMediaItem.url)}
			<footer
				class="mx-auto max-h-28 max-w-2xl overflow-y-auto px-4 py-2 text-center text-[13px] leading-relaxed whitespace-pre-wrap text-white/90"
			>
				{mediaCaption(selectedMediaItem.content, selectedMediaItem.url)}
			</footer>
		{/if}
		<div class="flex items-center justify-center gap-2 p-3 sm:hidden">
			<a
				href={`/note/${selectedMediaItem.id}?from=discover`}
				class="inline-flex h-9 items-center rounded-full border border-white/20 px-4 text-[12px] font-bold text-white"
			>
				Open note
			</a>
		</div>
	</div>
{/if}

<ImageLightbox
	bind:open={zoomOpen}
	images={selectedMediaItem && selectedMediaItem.kind === 'image' ? [selectedMediaItem.url] : []}
	index={0}
/>
