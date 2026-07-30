<script lang="ts">
	import { onMount } from 'svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { queryOnce } from '$lib/nostr/pool';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { NOSTR_KINDS } from '$lib/nostr/types';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { shortKey } from '$lib/utils/format';

	type TrendTag = { tag: string; count: number };
	type Creator = { pubkey: string; count: number; latest: number };
	type MediaItem = { id: string; url: string; kind: 'image' | 'video'; pubkey: string; content: string };
	type DiscoverCache = {
		savedAt: number;
		trendTags: TrendTag[];
		creators: Creator[];
		mediaItems: MediaItem[];
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
	const DISCOVER_CACHE_TTL_MS = 10 * 60 * 1000;
	const MAX_CACHED_TAGS = 18;
	const MAX_CACHED_CREATORS = 8;
	const MAX_CACHED_MEDIA = 60;
	const INITIAL_MEDIA_VISIBLE = 24;

	let loading = $state(true);
	let query = $state('');
	let trendTags = $state<TrendTag[]>([]);
	let creators = $state<Creator[]>([]);
	let mediaItems = $state<MediaItem[]>([]);
	let mediaVisibleCount = $state(INITIAL_MEDIA_VISIBLE);
	const me = $derived(identity.current?.pk ?? '');
	const queryText = $derived(query.trim().toLowerCase());

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

	function applyDiscoverData(data: Omit<DiscoverCache, 'savedAt'>) {
		trendTags = data.trendTags.slice(0, MAX_CACHED_TAGS);
		creators = data.creators.slice(0, MAX_CACHED_CREATORS);
		mediaItems = data.mediaItems
			.slice(0, MAX_CACHED_MEDIA)
			.map((item) => ({ ...item, kind: item.kind ?? 'image' }));
		mediaVisibleCount = INITIAL_MEDIA_VISIBLE;
		profiles.ensure(creators.map((creator) => creator.pubkey));
		profiles.ensure(mediaItems.map((item) => item.pubkey));
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

	async function loadDiscover(options: { background?: boolean } = {}) {
		if (!options.background) loading = true;
		try {
			const events = await queryOnce([{ kinds: [NOSTR_KINDS.TEXT_NOTE], limit: 300 }]);
			const seen: Record<string, true> = {};
			const tags: Record<string, number> = {};
			const authors: Record<string, Creator> = {};
			const nextMedia: MediaItem[] = [];

			for (const event of events.sort((a, b) => b.created_at - a.created_at)) {
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
				if (media && nextMedia.length < MAX_CACHED_MEDIA) {
					nextMedia.push({
						id: event.id,
						url: media.url,
						kind: media.kind,
						pubkey: event.pubkey,
						content: event.content
					});
				}
			}

			const nextTags = Object.entries(tags)
				.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
				.slice(0, 18)
				.map(([tag, count]) => ({ tag, count }));
			const nextCreators = Object.values(authors)
				.sort((a, b) => b.count - a.count || b.latest - a.latest)
				.slice(0, 8);
			const data = {
				trendTags: nextTags,
				creators: nextCreators,
				mediaItems: nextMedia
			};
			applyDiscoverData(data);
			saveDiscoverCache(data);
		} catch (e) {
			if (!options.background) {
				toasts.error((e as Error).message || 'Could not load discover data');
			}
		} finally {
			loading = false;
		}
	}

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

<div class="h-full overflow-y-auto">
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

		<div class="mb-6">
			<h3 class="mb-3 font-display text-[18px] font-extrabold">Trending tags</h3>
			{#if filteredTags.length}
				<div class="flex flex-wrap gap-2">
					{#each filteredTags as item (item.tag)}
						<a href={`/?tag=${encodeURIComponent(item.tag)}`} class="trend-tag">
							<Icon name="i-lucide-hash" class="size-3.5 text-primary-500" />
							#{item.tag}
							<span class="font-normal text-[var(--ui-text-dimmed)]">{item.count}</span>
						</a>
					{/each}
				</div>
			{:else}
				<div class="post-card p-5 text-[13px] text-[var(--ui-text-muted)]">
					{loading ? 'Loading tags from relays...' : 'No tags found from your relays.'}
				</div>
			{/if}
		</div>

		<div class="mb-8">
			<h3 class="mb-3 font-display text-[18px] font-extrabold">Active creators</h3>
			{#if filteredCreators.length}
				<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
					{#each filteredCreators as creator (creator.pubkey)}
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
					{loading ? 'Loading creators from relays...' : 'No creators found.'}
				</div>
			{/if}
		</div>

		<div class="mb-6">
			<div class="mb-3 flex items-center justify-between gap-3">
				<h3 class="font-display text-[18px] font-extrabold">Media</h3>
				{#if mediaItems.length}
					<p class="text-[12px] font-semibold text-[var(--ui-text-muted)]">
						{filteredMedia.length} result{filteredMedia.length === 1 ? '' : 's'}
					</p>
				{/if}
			</div>
			{#if visibleMedia.length}
				<div class="masonry">
					{#each visibleMedia as item (item.id)}
						{@const profile = profiles.get(item.pubkey)}
						{@const name = profile?.display_name || profile?.name || shortKey(item.pubkey)}
						<a
							href={`/note/${item.id}?from=discover`}
							class="group relative block cursor-pointer overflow-hidden rounded-xl transition-transform hover:scale-[0.97]"
						>
							{#if item.kind === 'video'}
								<!-- svelte-ignore a11y_media_has_caption -->
								<video
									src={item.url}
									class="aspect-video w-full bg-black object-cover"
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
								<img src={item.url} class="w-full" alt="" loading="lazy" />
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
						</a>
					{/each}
				</div>
				{#if filteredMedia.length > mediaVisibleCount}
					<div class="mt-5 flex justify-center">
						<button
							type="button"
							onclick={() => (mediaVisibleCount += 18)}
							class="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-4 text-[13px] font-bold text-[var(--ui-text)] transition hover:border-primary-500 hover:text-primary-500"
						>
							<Icon name="i-lucide-plus" class="size-4" />
							Load more media
						</button>
					</div>
				{/if}
			{:else}
				<div class="post-card p-5 text-[13px] text-[var(--ui-text-muted)]">
					{loading
						? 'Loading media from relays...'
						: queryText
							? 'No media matched your search.'
							: 'No image or video media links found.'}
				</div>
			{/if}
		</div>
	</div>
</div>
