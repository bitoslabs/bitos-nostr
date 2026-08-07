<script lang="ts">
	import { onMount } from 'svelte';
	import type { Filter } from 'nostr-tools/filter';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import ImageLightbox from '$lib/components/ui/ImageLightbox.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { contacts } from '$lib/nostr/contacts.svelte';
	import { algorithmPreferences, getWotSet } from '$lib/algorithm';
	import { queryPrimaryFirst } from '$lib/nostr/pool';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { NOSTR_KINDS } from '$lib/nostr/types';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { sensitiveMediaReason } from '$lib/utils/sensitive-media';
	import { shortKey, timeAgo } from '$lib/utils/format';

	type TrendTag = { tag: string; count: number };
	type Creator = { pubkey: string; count: number; latest: number };
	type MediaItem = {
		id: string;
		url: string;
		kind: 'image' | 'video';
		pubkey: string;
		content: string;
		createdAt: number;
		sensitiveReason: string;
	};
	type DiscoverCache = {
		savedAt: number;
		trendTags: TrendTag[];
		creators: Creator[];
		mediaItems: MediaItem[];
	};
	type DiscoverSearchCache = {
		savedAt: number;
		queries: Array<{
			query: string;
			savedAt: number;
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
	const DISCOVER_CACHE_KEY = 'bitos:discover-cache:v1';
	const DISCOVER_SEARCH_CACHE_KEY = 'bitos:discover-search-cache:v1';
	const DISCOVER_CACHE_TTL_MS = 10 * 60 * 1000;
	const DISCOVER_SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
	const MAX_CACHED_SEARCHES = 5;
	const MAX_CACHED_TAGS = 18;
	const MAX_CACHED_CREATORS = 8;
	const MAX_CACHED_MEDIA = 180;
	const DISCOVER_INITIAL_EVENT_LIMIT = 300;
	const DISCOVER_PAGE_EVENT_LIMIT = 180;
	const DISCOVER_SEARCH_EVENT_LIMIT = 180;
	const INITIAL_MEDIA_VISIBLE = 24;
	const MEDIA_PAGE_SIZE = 18;
	const MEDIA_PREFETCH_THRESHOLD = 12;
	const SEARCH_DEBOUNCE_MS = 350;

	let loading = $state(true);
	let query = $state('');
	let trendTags = $state<TrendTag[]>([]);
	let creators = $state<Creator[]>([]);
	let mediaItems = $state<MediaItem[]>([]);
	let mediaVisibleCount = $state(INITIAL_MEDIA_VISIBLE);
	let loadingMoreMedia = $state(false);
	let searchingRelays = $state(false);
	let hasMoreMedia = $state(true);
	let discoverScroller: HTMLDivElement | undefined = $state();
	let oldestMediaEventCreatedAt = $state(0);
	let mediaDialogOpen = $state(false);
	let mediaIndex = $state(0);
	let zoomOpen = $state(false);
	let revealedSensitiveMedia = $state<Record<string, boolean>>({});
	let relaySearchData = $state<Omit<DiscoverCache, 'savedAt'> | null>(null);
	let relaySearchToken = 0;
	const me = $derived(identity.current?.pk ?? '');
	const queryTrimmed = $derived(query.trim());
	const queryText = $derived(query.trim().toLowerCase());
	const queryTag = $derived(queryTrimmed.replace(/^#/, '').trim().toLowerCase());
	const hasActiveRelaySearch = $derived(queryTrimmed.length >= 2);

	const filteredTags = $derived(
		trendTags.filter((item) => !queryText || item.tag.toLowerCase().includes(queryText))
	);
	const filteredCreators = $derived(
		creators.filter((item) => {
			const profile = profiles.get(item.pubkey);
			const name = profile?.display_name || profile?.name || shortKey(item.pubkey);
			return !queryText || name.toLowerCase().includes(queryText) || item.pubkey.includes(queryText);
		})
	);
	const filteredMedia = $derived(
		mediaItems.filter((item) => {
			const profile = profiles.get(item.pubkey);
			const name = profile?.display_name || profile?.name || shortKey(item.pubkey);
			const haystack = `${item.kind} ${item.content} ${item.url} ${name} ${item.pubkey}`.toLowerCase();
			return !queryText || haystack.includes(queryText);
		})
	);
	const visibleMedia = $derived(filteredMedia.slice(0, mediaVisibleCount));
	const activeTrendTags = $derived(
		hasActiveRelaySearch ? (relaySearchData?.trendTags ?? []) : filteredTags
	);
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
				const wot = followingSet.has(creator.pubkey)
					? 1
					: wotSet.has(creator.pubkey)
						? 0.6
						: 0.2;
				const score = (engagement * wEng + recency * wRec + wot * wWot) / total;
				return { creator, score };
			})
			.sort((a, b) => b.score - a.score)
			.map((item) => item.creator);
	});
	const activeMedia = $derived(
		hasActiveRelaySearch ? relaySearchData?.mediaItems.slice(0, mediaVisibleCount) ?? [] : visibleMedia
	);
	const activeMediaCount = $derived(
		hasActiveRelaySearch ? relaySearchData?.mediaItems.length ?? 0 : filteredMedia.length
	);
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
		return merged.slice(0, MAX_CACHED_MEDIA);
	}

	function buildDiscoverData(
		events: Array<{ id: string; pubkey: string; content: string; created_at: number; tags: string[][] }>,
		options: { mediaLimit?: number } = {}
	) {
		const seen: Record<string, true> = {};
		const tags: Record<string, number> = {};
		const authors: Record<string, Creator> = {};
		const nextMedia: MediaItem[] = [];
		const mediaLimit = options.mediaLimit ?? MAX_CACHED_MEDIA;
		const sortedEvents = [...events].sort((a, b) => b.created_at - a.created_at);

		for (const event of sortedEvents) {
			if (seen[event.id]) continue;
			seen[event.id] = true;

			const noteTags = event.tags
				.filter((tag) => tag[0] === 't' && tag[1])
				.map((tag) => tag[1].toLowerCase());
			const inlineTags = [...event.content.matchAll(hashtagPattern)].map((match) =>
				match[1].toLowerCase()
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
					sensitiveReason: reason
				});
			}
		}

		return {
			data: {
				trendTags: Object.entries(tags)
					.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
					.slice(0, MAX_CACHED_TAGS)
					.map(([tag, count]) => ({ tag, count })),
				creators: Object.values(authors)
					.sort((a, b) => b.count - a.count || b.latest - a.latest)
					.slice(0, MAX_CACHED_CREATORS),
				mediaItems: nextMedia
			},
			sortedEvents
		};
	}

	function applyDiscoverData(data: Omit<DiscoverCache, 'savedAt'>) {
		trendTags = data.trendTags.slice(0, MAX_CACHED_TAGS);
		creators = data.creators.slice(0, MAX_CACHED_CREATORS);
		mediaItems = data.mediaItems
			.slice(0, MAX_CACHED_MEDIA)
			.map((item) => ({
				...item,
				kind: item.kind ?? 'image',
				createdAt: item.createdAt ?? 0,
				sensitiveReason: item.sensitiveReason ?? ''
			}));
		mediaVisibleCount = INITIAL_MEDIA_VISIBLE;
		profiles.ensure(creators.map((creator) => creator.pubkey));
		profiles.ensure(mediaItems.map((item) => item.pubkey));
	}

	function appendDiscoverMedia(nextItems: MediaItem[]) {
		if (!nextItems.length) return;
		mediaItems = mergeMediaLists(mediaItems, nextItems);
		profiles.ensure(nextItems.map((item) => item.pubkey));
		saveDiscoverCache({ trendTags, creators, mediaItems });
	}

	function loadCachedDiscover() {
		try {
			const raw = localStorage.getItem(DISCOVER_CACHE_KEY);
			if (!raw) return false;
			const cached = JSON.parse(raw) as DiscoverCache;
			if (!cached?.savedAt || Date.now() - cached.savedAt > DISCOVER_CACHE_TTL_MS) return false;
			if (!Array.isArray(cached.trendTags) || !Array.isArray(cached.creators)) return false;
			applyDiscoverData(cached);
			return true;
		} catch {
			return false;
		}
	}

	function saveDiscoverCache(data: Omit<DiscoverCache, 'savedAt'>) {
		try {
			localStorage.setItem(DISCOVER_CACHE_KEY, JSON.stringify({ ...data, savedAt: Date.now() }));
		} catch {
			/* Ignore quota/private-mode failures; cache is only a performance hint. */
		}
	}

	function loadCachedDiscoverSearch(queryValue: string) {
		try {
			const raw = localStorage.getItem(DISCOVER_SEARCH_CACHE_KEY);
			if (!raw) return null;
			const cached = JSON.parse(raw) as DiscoverSearchCache;
			if (!Array.isArray(cached?.queries)) return null;
			const entry = cached.queries.find((item) => item.query === queryValue);
			if (!entry?.savedAt || Date.now() - entry.savedAt > DISCOVER_SEARCH_CACHE_TTL_MS) return null;
			return entry.data;
		} catch {
			return null;
		}
	}

	function saveDiscoverSearchCache(queryValue: string, data: Omit<DiscoverCache, 'savedAt'>) {
		try {
			const raw = localStorage.getItem(DISCOVER_SEARCH_CACHE_KEY);
			const cached = raw ? (JSON.parse(raw) as DiscoverSearchCache) : { savedAt: 0, queries: [] };
			const nextQueries = [
				{ query: queryValue, data, savedAt: Date.now() },
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
		if (!options.background) loading = true;
		try {
			const applyResults = (events: Awaited<ReturnType<typeof queryPrimaryFirst>>) => {
				const { data, sortedEvents } = buildDiscoverData(events);
				applyDiscoverData(data);
				oldestMediaEventCreatedAt = sortedEvents.at(-1)?.created_at ?? 0;
				hasMoreMedia = events.length >= DISCOVER_INITIAL_EVENT_LIMIT && !!oldestMediaEventCreatedAt;
				saveDiscoverCache(data);
			};
			const events = await queryPrimaryFirst(
				[{ kinds: [NOSTR_KINDS.TEXT_NOTE], limit: DISCOVER_INITIAL_EVENT_LIMIT }],
				{
					onSecondary: (mergedEvents) => {
						applyResults(mergedEvents);
					}
				}
			);
			applyResults(events);
		} catch (e) {
			if (!options.background) {
				toasts.error((e as Error).message || 'Could not load discover data');
			}
		} finally {
			loading = false;
		}
	}

	async function loadMoreMedia() {
		if (loadingMoreMedia || !hasMoreMedia || !oldestMediaEventCreatedAt) return;
		loadingMoreMedia = true;
		try {
			const nextMedia: MediaItem[] = [];
			let nextCursor = oldestMediaEventCreatedAt;
			let attempts = 0;

			while (nextMedia.length < MEDIA_PAGE_SIZE && hasMoreMedia && nextCursor > 0 && attempts < 4) {
				const events = await queryPrimaryFirst([
					{
						kinds: [NOSTR_KINDS.TEXT_NOTE],
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
				hasMoreMedia = events.length >= DISCOVER_PAGE_EVENT_LIMIT && nextCursor > 0;

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
		} catch (e) {
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
		if (filteredMedia.length > mediaVisibleCount) {
			mediaVisibleCount = Math.min(filteredMedia.length, mediaVisibleCount + MEDIA_PAGE_SIZE);
		}
		void ensureMediaBuffered();
	}

	function handleDiscoverScroll() {
		if (hasActiveRelaySearch) return;
		if (!discoverScroller) return;
		const remaining =
			discoverScroller.scrollHeight - discoverScroller.scrollTop - discoverScroller.clientHeight;
		if (remaining < discoverScroller.clientHeight * 1.5) revealMoreMedia();
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
		if (item.kind === 'image') return !isMediaRevealed(item);
		return !!item.sensitiveReason && !isMediaRevealed(item);
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
		const searchToken = ++relaySearchToken;
		searchingRelays = true;
		mediaVisibleCount = INITIAL_MEDIA_VISIBLE;
		try {
			const cached = loadCachedDiscoverSearch(term);
			if (cached) {
				if (searchToken !== relaySearchToken) return;
				relaySearchData = cached;
				profiles.ensure(cached.creators.map((creator) => creator.pubkey));
				profiles.ensure(cached.mediaItems.map((item) => item.pubkey));
				searchingRelays = false;
				return;
			}

			const filters = [
				{
					kinds: [NOSTR_KINDS.TEXT_NOTE],
					limit: DISCOVER_SEARCH_EVENT_LIMIT,
					search: term
				} as Filter,
				{
					kinds: [NOSTR_KINDS.TEXT_NOTE],
					limit: DISCOVER_SEARCH_EVENT_LIMIT,
					'#t': [queryTag || term.toLowerCase()]
				} as Filter
			];
			const applyResults = (events: Awaited<ReturnType<typeof queryPrimaryFirst>>) => {
				if (searchToken !== relaySearchToken) return;
				relaySearchData = buildDiscoverData(events, { mediaLimit: MAX_CACHED_MEDIA }).data;
				saveDiscoverSearchCache(term, relaySearchData);
				profiles.ensure(relaySearchData.creators.map((creator) => creator.pubkey));
				profiles.ensure(relaySearchData.mediaItems.map((item) => item.pubkey));
			};
			const events = await queryPrimaryFirst(filters, {
				onSecondary: (mergedEvents) => {
					applyResults(mergedEvents);
				}
			});
			applyResults(events);
		} catch (e) {
			if (searchToken !== relaySearchToken) return;
			relaySearchData = { trendTags: [], creators: [], mediaItems: [] };
			toasts.error((e as Error).message || 'Could not search relays');
		} finally {
			if (searchToken === relaySearchToken) searchingRelays = false;
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
	<div class="mx-auto max-w-[1100px] px-6 py-6">
		<div class="mb-6 flex items-start justify-between gap-4">
			<div>
				<h1 class="font-display text-[34px] leading-none font-extrabold tracking-tight">
					Discover
				</h1>
				<p class="mt-1.5 text-[13px] text-[var(--ui-text-muted)]">
					Real notes, tags, creators, and media from your relays
				</p>
			</div>
			<button
				type="button"
				onclick={() => loadDiscover()}
				class="grid size-10 place-items-center rounded-xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] text-[var(--ui-text-muted)] transition hover:text-primary-500"
				aria-label="Refresh discover"
			>
				<Icon name="i-lucide-rotate-cw" class="size-5 {loading ? 'animate-spin' : ''}" />
			</button>
		</div>

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

		<div class="mb-6">
			<h3 class="mb-3 font-display text-[18px] font-extrabold">Trending tags</h3>
			{#if activeTrendTags.length}
				<div class="flex flex-wrap gap-2">
					{#each activeTrendTags as item (item.tag)}
						<a href={`/?tag=${encodeURIComponent(item.tag)}`} class="trend-tag">
							<Icon name="i-lucide-hash" class="size-3.5 text-primary-500" />
							#{item.tag}
							<span class="font-normal text-[var(--ui-text-dimmed)]">{item.count}</span>
						</a>
					{/each}
				</div>
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

		<div class="mb-8">
			<div class="mb-3 flex items-center justify-between gap-2">
				<h3 class="font-display text-[18px] font-extrabold">Active creators</h3>
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
				<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
					{#each rankedCreators as creator (creator.pubkey)}
						{@const profile = profiles.get(creator.pubkey)}
						{@const name = profile?.display_name || profile?.name || shortKey(creator.pubkey)}
						<a href={`/profile/${creator.pubkey}`} class="post-card p-4 text-center">
							<Avatar
								pubkey={creator.pubkey}
								{name}
								picture={profile?.picture}
								size={64}
								class="mx-auto mb-2 rounded-2xl"
							/>
							<p class="truncate text-[13px] font-bold">{name}</p>
							<p class="mb-2 text-[11px] text-[var(--ui-text-muted)]">
								{creator.count} recent notes
							</p>
						</a>
					{/each}
				</div>
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
									class="aspect-video w-full bg-black object-cover transition {!shouldHideMedia(item)
										? ''
										: 'scale-105 blur-2xl saturate-50'}"
									muted
									playsinline
									preload="metadata"
								></video>
								<div
									class="absolute top-2 right-2 grid size-9 place-items-center rounded-full bg-black/55 text-white backdrop-blur"
								>
									<Icon name="i-lucide-play" class="size-4 fill-current" />
								</div>
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
										<span class="mt-1 block text-[11px] text-white/80"
											>{item.kind === 'image'
												? item.sensitiveReason || 'Tap view to reveal'
												: item.sensitiveReason}</span
										>
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
									</div>
									<p class="line-clamp-3 text-[12px] font-semibold">{item.content}</p>
								</div>
							</div>
						</button>
					{/each}
				</div>
				{#if !hasActiveRelaySearch && (filteredMedia.length > mediaVisibleCount || hasMoreMedia)}
					<div class="mt-5 flex justify-center">
						<button
							type="button"
							onclick={revealMoreMedia}
							disabled={loadingMoreMedia && filteredMedia.length <= mediaVisibleCount}
							class="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-4 text-[13px] font-bold text-[var(--ui-text)] transition hover:border-primary-500 hover:text-primary-500"
						>
							<Icon
								name={loadingMoreMedia && filteredMedia.length <= mediaVisibleCount
									? 'i-lucide-loader-circle'
									: 'i-lucide-plus'}
								class="size-4 {loadingMoreMedia && filteredMedia.length <= mediaVisibleCount
									? 'animate-spin'
									: ''}"
							/>
							{filteredMedia.length > mediaVisibleCount ? 'Load more media' : 'Loading older media'}
						</button>
					</div>
				{/if}
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
	</div>
</div>

<svelte:window onkeydown={onViewerKey} />

{#if mediaDialogOpen && selectedMediaItem}
	{@const profile = profiles.get(selectedMediaItem.pubkey)}
	{@const name = profile?.display_name || profile?.name || shortKey(selectedMediaItem.pubkey)}
	<!-- Immersive media viewer -->
	<div class="fixed inset-0 z-[60] flex flex-col bg-black/95 backdrop-blur-sm animate-fade">
		<!-- Top bar -->
		<header class="flex items-center gap-2 p-3 text-white">
			<a
				href={`/profile/${selectedMediaItem.pubkey}`}
				onclick={() => (mediaDialogOpen = false)}
				class="flex min-w-0 flex-1 items-center gap-2.5 rounded-full p-1 pr-3 transition hover:bg-white/10"
			>
				<Avatar
					pubkey={selectedMediaItem.pubkey}
					name={name}
					picture={profile?.picture}
					size={36}
				/>
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
							<p class="mt-1 text-[12px] text-white/75">
								{selectedMediaItem.kind === 'image'
									? selectedMediaItem.sensitiveReason || 'Tap view to reveal'
									: selectedMediaItem.sensitiveReason}
							</p>
							<span
								class="mt-4 inline-flex rounded-full bg-white px-4 py-2 text-[12px] font-bold text-black"
							>
								Show media
							</span>
						</button>
					</div>
				{:else if selectedMediaItem.kind === 'video'}
					<!-- svelte-ignore a11y_media_has_caption -->
					<video
						src={selectedMediaItem.url}
						class="mx-auto max-h-[80vh] w-full bg-black object-contain"
						controls
						autoplay
						playsinline
					></video>
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
		{#if selectedMediaItem.content}
			<footer
				class="mx-auto max-h-28 max-w-2xl overflow-y-auto px-4 py-2 text-center text-[13px] leading-relaxed whitespace-pre-wrap text-white/90"
			>
				{selectedMediaItem.content}
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
