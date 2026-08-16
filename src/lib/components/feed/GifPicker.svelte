<script lang="ts">
	/**
	 * GIF picker backed by the Giphy API.
	 *
	 * Shows trending GIFs on open and searches as you type. Picking one hands
	 * back the full-resolution GIF URL — the reply composer embeds it as a plain
	 * URL in the note content (exactly how giphy links appear in real Nostr
	 * notes), no upload required.
	 *
	 * The key defaults to Giphy's public beta key (rate-limited, docs/demo use)
	 * and can be overridden with VITE_GIPHY_API_KEY.
	 */
	import { browser } from '$app/environment';
	import Icon from '$lib/components/ui/Icon.svelte';

	const GIPHY_KEY =
		(import.meta.env.VITE_GIPHY_API_KEY as string | undefined) ||
		'Gc7131jiJuvI7IdN0HZ1D7nh0ow5BU6g';
	const STORAGE_KEY = 'bitos:gif-picker:v1';
	const CACHE_TTL = 24 * 60 * 60 * 1000;
	const RECENT_LIMIT = 12;
	const GIPHY_PAGE_SIZE = 30;

	export interface GifChoice {
		url: string;
		preview: string;
		width: number;
		height: number;
	}

	let { onpick }: { onpick: (gif: GifChoice) => void } = $props();

	type GiphyImageSet = { url: string; width?: string; height?: string };
	type GiphyItem = { id: string; images: Record<string, GiphyImageSet>; title?: string };
	type GifItem = { id: string; preview: string; url: string; w: number; h: number };
	type GifStorage = {
		recent?: GifItem[];
		trending?: { savedAt: number; items: GifItem[] };
	};

	let query = $state('');
	let items = $state<GifItem[]>([]);
	let recent = $state<GifItem[]>([]);
	let tab = $state<'recent' | 'trending'>('trending');
	let loading = $state(false);
	let loadingMore = $state(false);
	let loaded = $state(false);
	let error = $state('');
	let nextOffset = $state(0);
	let hasMore = $state(true);
	let debounce: ReturnType<typeof setTimeout> | undefined;
	let controller: AbortController | undefined;
	let storage = $state<GifStorage>({});

	function readStorage() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) {
				const saved = JSON.parse(raw) as GifStorage;
				// Keep only the intentionally persistent data; older versions stored search results here.
				storage = { recent: saved.recent, trending: saved.trending };
				localStorage.setItem(STORAGE_KEY, JSON.stringify(storage));
			}
		} catch {
			storage = {};
		}
		recent = Array.isArray(storage.recent) ? storage.recent.slice(0, RECENT_LIMIT) : [];
	}

	function writeStorage() {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(storage));
		} catch {
			// GIF cache is an enhancement; private browsing and quota limits are safe to ignore.
		}
	}

	function fresh(cached: { savedAt: number; items: GifItem[] } | undefined) {
		return !!cached && Date.now() - cached.savedAt < CACHE_TTL && cached.items.length > 0;
	}

	function remember(item: GifItem) {
		recent = [item, ...recent.filter((gif) => gif.id !== item.id)].slice(0, RECENT_LIMIT);
		storage = { ...storage, recent };
		writeStorage();
	}

	function mergeItems(current: GifItem[], incoming: GifItem[]) {
		const byId = new Map(current.map((item) => [item.id, item]));
		for (const item of incoming) byId.set(item.id, item);
		return [...byId.values()];
	}

	async function fetchGifs(q: string, options: { append?: boolean } = {}) {
		if (!browser) return;
		if (options.append && (loading || loadingMore || !hasMore)) return;
		controller?.abort();
		controller = new AbortController();
		if (options.append) loadingMore = true;
		else loading = true;
		error = '';
		const normalizedQuery = q.trim().toLowerCase();
		const offset = options.append ? nextOffset : 0;
		try {
			const endpoint = q.trim()
				? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(q)}&limit=${GIPHY_PAGE_SIZE}&offset=${offset}&rating=pg`
				: `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_KEY}&limit=${GIPHY_PAGE_SIZE}&offset=${offset}&rating=pg`;
			const res = await fetch(endpoint, { signal: controller.signal });
			if (!res.ok) throw new Error(`Giphy ${res.status}`);
			const json = (await res.json()) as {
				data: GiphyItem[];
				pagination?: { count?: number; offset?: number; total_count?: number };
			};
			const nextItems = json.data.map((gif) => {
				const preview =
					gif.images.fixed_height_small ?? gif.images.fixed_height ?? gif.images.original;
				const full = gif.images.original ?? preview;
				return {
					id: gif.id,
					preview: preview.url,
					url: full.url,
					w: Number(preview.width ?? 120),
					h: Number(preview.height ?? 120)
				};
			});
			const allItems = options.append ? mergeItems(items, nextItems) : nextItems;
			if (normalizedQuery || tab !== 'recent') items = allItems;
			const returnedOffset = json.pagination?.offset ?? offset;
			const returnedCount = json.pagination?.count ?? nextItems.length;
			nextOffset = returnedOffset + returnedCount;
			hasMore = json.pagination?.total_count
				? nextOffset < json.pagination.total_count
				: nextItems.length >= GIPHY_PAGE_SIZE;
			const savedAt = Date.now();
			if (!normalizedQuery) {
				storage = { ...storage, trending: { savedAt, items: allItems } };
				writeStorage();
			}
			if (!items.length && q.trim()) error = 'No GIFs found';
		} catch (e) {
			if ((e as Error).name !== 'AbortError') error = 'Could not load GIFs';
		} finally {
			loading = false;
			loadingMore = false;
			loaded = true;
		}
	}

	function onInput() {
		tab = 'trending';
		clearTimeout(debounce);
		debounce = setTimeout(() => fetchGifs(query), 350);
	}

	function pick(item: GifItem) {
		remember(item);
		onpick({ url: item.url, preview: item.preview, width: item.w, height: item.h });
	}

	function showRecent() {
		tab = 'recent';
		query = '';
		items = recent;
		hasMore = false;
		error = '';
	}

	function showTrending() {
		tab = 'trending';
		items = storage.trending?.items ?? items;
		nextOffset = items.length;
		hasMore = true;
		error = '';
	}

	function loadMore() {
		void fetchGifs(query, { append: true });
	}

	// Restore useful context immediately, then revalidate it in the background.
	$effect(() => {
		if (!browser || loaded || loading) return;
		readStorage();
		const cached = storage.trending;
		if (cached && fresh(cached)) {
			items = cached.items;
			nextOffset = cached.items.length;
			hasMore = true;
			loaded = true;
			if (recent.length) tab = 'recent';
		}
		fetchGifs('');
	});
</script>

<div class="w-72 max-w-[80vw] sm:w-80">
	<div class="flex items-center gap-2 border-b border-[var(--ui-border-muted)] p-2">
		<Icon name="i-lucide-search" class="size-4 shrink-0 text-[var(--ui-text-dimmed)]" />
		<input
			type="search"
			bind:value={query}
			oninput={onInput}
			onclick={(e) => e.stopPropagation()}
			placeholder="Search GIFs…"
			class="w-full bg-transparent text-[13px] outline-none placeholder:text-[var(--ui-text-dimmed)]"
		/>
		{#if loading}
			<Icon name="i-lucide-loader-circle" class="size-4 shrink-0 animate-spin text-primary-500" />
		{/if}
	</div>

	{#if !query.trim() && recent.length}
		<div class="flex gap-1 border-b border-[var(--ui-border-muted)] px-2 pt-2">
			<button
				type="button"
				onclick={(event) => {
					event.stopPropagation();
					showRecent();
				}}
				class="rounded-md px-2 py-1 text-[11px] {tab === 'recent'
					? 'bg-[var(--ui-bg-muted)] font-medium text-[var(--ui-text)]'
					: 'text-[var(--ui-text-dimmed)]'}"
			>
				Recent
			</button>
			<button
				type="button"
				onclick={(event) => {
					event.stopPropagation();
					showTrending();
				}}
				class="rounded-md px-2 py-1 text-[11px] {tab === 'trending'
					? 'bg-[var(--ui-bg-muted)] font-medium text-[var(--ui-text)]'
					: 'text-[var(--ui-text-dimmed)]'}"
			>
				Trending
			</button>
		</div>
	{/if}

	<div class="max-h-[280px] overflow-y-auto p-2">
		{#if error}
			<p
				class="grid place-items-center gap-2 py-10 text-center text-[12px] text-[var(--ui-text-dimmed)]"
			>
				<Icon name="i-lucide-image-off" class="size-6" />
				{error}
			</p>
		{:else if !loading && !items.length}
			<p class="py-10 text-center text-[12px] text-[var(--ui-text-dimmed)]">
				{query.trim() ? 'No GIFs found' : 'No GIFs to show yet'}
			</p>
		{:else}
			<!-- Masonry via CSS columns keeps varied GIF heights tidy without JS. -->
			<div class="gap-2 [column-count:2] sm:[column-count:3]">
				{#each items as item (item.id)}
					<button
						type="button"
						onclick={() => pick(item)}
						class="group relative mb-2 block w-full overflow-hidden rounded-lg bg-[var(--ui-bg-muted)]"
						title="Insert GIF"
					>
						<img
							src={item.preview}
							alt=""
							loading="lazy"
							class="w-full object-cover transition group-hover:opacity-90"
							style="aspect-ratio:{item.w}/{item.h};"
						/>
						<span
							class="absolute inset-0 grid place-items-center bg-black/0 transition group-hover:bg-black/30"
						>
							<Icon
								name="i-lucide-plus"
								class="size-5 text-white opacity-0 transition group-hover:opacity-100"
							/>
						</span>
					</button>
				{/each}
			</div>
			{#if tab !== 'recent' && hasMore}
				<button
					type="button"
					onclick={(event) => {
						event.stopPropagation();
						loadMore();
					}}
					disabled={loading || loadingMore}
					class="mx-auto mt-2 flex h-8 items-center gap-1.5 rounded-full border border-[var(--ui-border-muted)] px-3 text-[11px] font-semibold text-[var(--ui-text-muted)] transition hover:border-primary-500 hover:text-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
				>
					<Icon
						name={loadingMore ? 'i-lucide-loader-circle' : 'i-lucide-plus'}
						class="size-3.5 {loadingMore ? 'animate-spin' : ''}"
					/>
					{loadingMore ? 'Loading GIFs…' : 'Load more GIFs'}
				</button>
			{/if}
		{/if}
	</div>
	<p
		class="flex items-center justify-center gap-1 border-t border-[var(--ui-border-muted)] p-1.5 text-[10px] text-[var(--ui-text-dimmed)]"
	>
		<Icon name="i-lucide-info" class="size-3" />
		Powered by Giphy
	</p>
</div>
