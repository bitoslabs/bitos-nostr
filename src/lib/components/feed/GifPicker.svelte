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
	import { SvelteMap } from 'svelte/reactivity';
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
		/** Giphy's title for the GIF — used to prefill alt text where relevant. */
		title?: string;
	}

	/**
	 * `popover` keeps the compact dropdown width used by the note composer;
	 * `inline` fills its container (the story composer embeds the picker as a
	 * full-width sheet inside its dialog).
	 */
	let {
		onpick,
		onpickmany,
		/** Device browse — opens the host's image/GIF chooser (the caller owns
		 *  the hidden input so popover click-close can't eat the dialog). */
		onbrowse,
		variant = 'popover',
		/** Multi-select mode: taps toggle selection, confirmed via `onpickmany`. */
		multiple = false,
		/** Selection cap in multi-select mode (slots remaining in the story). */
		max = 6
	}: {
		onpick?: (gif: GifChoice) => void;
		onpickmany?: (gifs: GifChoice[]) => void;
		onbrowse?: () => void;
		variant?: 'popover' | 'inline';
		multiple?: boolean;
		max?: number;
	} = $props();

	type GiphyImageSet = { url: string; width?: string; height?: string };
	type GiphyItem = { id: string; images: Record<string, GiphyImageSet>; title?: string };
	type GifItem = { id: string; preview: string; url: string; w: number; h: number; title?: string };
	type TrendingCache = { savedAt: number; items: GifItem[] };
	type GifStorage = {
		recent?: GifItem[];
		trending?: TrendingCache;
		trendingStickers?: TrendingCache;
		kind?: 'gifs' | 'stickers';
	};

	let query = $state('');
	let searchInput = $state<HTMLInputElement | null>(null);
	let items = $state<GifItem[]>([]);
	let recent = $state<GifItem[]>([]);
	let tab = $state<'recent' | 'trending'>('trending');
	/** GIFs vs Stickers — Giphy's sticker endpoints return transparent
	 *  cut-outs, exactly what meme layers want on top of the media. */
	let kind = $state<'gifs' | 'stickers'>('gifs');
	let loading = $state(false);
	let loadingMore = $state(false);
	let loaded = $state(false);
	let error = $state('');
	let nextOffset = $state(0);
	let hasMore = $state(true);
	let debounce: ReturnType<typeof setTimeout> | undefined;
	let controller: AbortController | undefined;
	let storage = $state<GifStorage>({});
	/** Multi-select: id → item, insertion order = pick order. */
	const selected = new SvelteMap<string, GifItem>();
	const atCapacity = $derived(multiple && selected.size >= max);

	function trendingCache(): TrendingCache | undefined {
		return kind === 'stickers' ? storage.trendingStickers : storage.trending;
	}

	function readStorage() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) {
				const saved = JSON.parse(raw) as GifStorage;
				// Keep only the intentionally persistent data; older versions stored search results here.
				storage = {
					recent: saved.recent,
					trending: saved.trending,
					trendingStickers: saved.trendingStickers,
					kind: saved.kind === 'stickers' ? 'stickers' : 'gifs'
				};
				localStorage.setItem(STORAGE_KEY, JSON.stringify(storage));
			}
		} catch {
			storage = {};
		}
		kind = storage.kind ?? 'gifs';
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
		// Keep the Recent view in sync when the user picks another GIF from it.
		if (tab === 'recent' && !query.trim()) items = recent;
		writeStorage();
	}

	function mergeItems(current: GifItem[], incoming: GifItem[]) {
		// Plain Map on purpose: a local dedupe inside an async fetch, never reactive state.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
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
				? `https://api.giphy.com/v1/${kind}/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(q)}&limit=${GIPHY_PAGE_SIZE}&offset=${offset}&rating=pg`
				: `https://api.giphy.com/v1/${kind}/trending?api_key=${GIPHY_KEY}&limit=${GIPHY_PAGE_SIZE}&offset=${offset}&rating=pg`;
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
					h: Number(preview.height ?? 120),
					title: gif.title?.trim() || undefined
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
				storage = {
					...storage,
					[kind === 'stickers' ? 'trendingStickers' : 'trending']: { savedAt, items: allItems }
				};
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
		onpick?.({
			url: item.url,
			preview: item.preview,
			width: item.w,
			height: item.h,
			title: item.title
		});
	}

	/** Multi-select: toggle a tile. Taps beyond the cap are ignored. */
	function toggle(item: GifItem) {
		if (selected.has(item.id)) {
			selected.delete(item.id);
			return;
		}
		if (selected.size >= max) return;
		selected.set(item.id, item);
	}

	/** 1-based pick order for a selected tile (0 when not selected). */
	function selectionOrder(id: string): number {
		let n = 0;
		for (const key of selected.keys()) {
			n += 1;
			if (key === id) return n;
		}
		return 0;
	}

	/** Confirm the selection — hands the ordered set back, then resets. */
	function confirmSelection() {
		if (!selected.size || !onpickmany) return;
		const chosen = [...selected.values()];
		for (const item of chosen) remember(item);
		onpickmany(
			chosen.map((item) => ({
				url: item.url,
				preview: item.preview,
				width: item.w,
				height: item.h,
				title: item.title
			}))
		);
		selected.clear();
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
		items = trendingCache()?.items ?? items;
		nextOffset = items.length;
		hasMore = true;
		error = '';
	}

	/** Switch GIFs ⇄ Stickers — keeps the query (searching the same words in
	 *  stickers is the whole point) and reloads the grid for the new kind. */
	function switchKind(next: 'gifs' | 'stickers') {
		if (kind === next) return;
		kind = next;
		storage = { ...storage, kind };
		writeStorage();
		tab = 'trending';
		nextOffset = 0;
		hasMore = true;
		items = [];
		selected.clear();
		void fetchGifs(query);
	}

	function loadMore() {
		void fetchGifs(query, { append: true });
	}

	// Inside the picker dialog the search box is the primary control — focus it
	// on open so typing works immediately (no a11y-hostile `autofocus` attr).
	$effect(() => {
		if (variant === 'inline') searchInput?.focus();
	});

	// Restore useful context immediately, then revalidate it in the background.
	$effect(() => {
		if (!browser || loaded || loading) return;
		readStorage();
		const cached = trendingCache();
		// Recent history is the fastest and most useful first view. Trending is
		// still revalidated below so it's ready when the user switches tabs.
		if (recent.length) {
			tab = 'recent';
			items = recent;
			hasMore = false;
		}
		if (cached && fresh(cached)) {
			if (!recent.length) items = cached.items;
			nextOffset = cached.items.length;
			hasMore = true;
			loaded = true;
		}
		fetchGifs('');
	});
</script>

<div class={variant === 'popover' ? 'w-72 max-w-[80vw] sm:w-80' : 'w-full'}>
	<div class="flex items-center gap-2 border-b border-[var(--ui-border-muted)] p-2">
		<Icon name="i-lucide-search" class="size-4 shrink-0 text-[var(--ui-text-dimmed)]" />
		<input
			bind:this={searchInput}
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

	<!-- Filter row: recents (when any) + the GIFs ⇄ Stickers kind toggle —
	     stickers are transparent cut-outs made for layering on media. -->
	<div class="flex items-center gap-1 border-b border-[var(--ui-border-muted)] px-2 py-1.5">
		{#if recent.length}
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
				class="rounded-md px-2 py-1 text-[11px] {tab === 'trending' && kind === 'gifs'
					? 'bg-[var(--ui-bg-muted)] font-medium text-[var(--ui-text)]'
					: 'text-[var(--ui-text-dimmed)]'}"
			>
				Trending
			</button>
		{/if}
		<div class="ml-auto flex items-center gap-0.5 rounded-full bg-[var(--ui-bg-muted)] p-0.5">
			<button
				type="button"
				onclick={(event) => {
					event.stopPropagation();
					switchKind('gifs');
				}}
				aria-pressed={kind === 'gifs'}
				title="Full-frame animated GIFs"
				class="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold transition {kind ===
				'gifs'
					? 'bg-[var(--ui-bg)] text-[var(--ui-text)] shadow-sm'
					: 'text-[var(--ui-text-dimmed)]'}"
			>
				<Icon name="i-lucide-film" class="size-3" />
				GIFs
			</button>
			<button
				type="button"
				onclick={(event) => {
					event.stopPropagation();
					switchKind('stickers');
				}}
				aria-pressed={kind === 'stickers'}
				title="Transparent cut-out stickers — ideal as meme layers"
				class="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold transition {kind ===
				'stickers'
					? 'bg-[var(--ui-bg)] text-[var(--ui-text)] shadow-sm'
					: 'text-[var(--ui-text-dimmed)]'}"
			>
				<Icon name="i-lucide-sticker" class="size-3" />
				Stickers
			</button>
		</div>
	</div>

	<div
		class="{variant === 'popover'
			? 'max-h-[280px]'
			: 'max-h-[42vh] sm:max-h-[52vh]'} overflow-y-auto p-2"
	>
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
			<div
				class="gap-2 {variant === 'popover'
					? '[column-count:2] sm:[column-count:3]'
					: '[column-count:3] sm:[column-count:4]'}"
			>
				{#each items as item (item.id)}
					{@const isSelected = selected.has(item.id)}
					{@const isDisabled = multiple && !isSelected && atCapacity}
					<button
						type="button"
						onclick={(event) => {
							if (multiple) {
								event.stopPropagation();
								toggle(item);
							} else {
								pick(item);
							}
						}}
						disabled={isDisabled}
						aria-pressed={multiple ? isSelected : undefined}
						aria-label={multiple
							? isSelected
								? `Deselect ${item.title ?? 'GIF'}`
								: `Select ${item.title ?? 'GIF'}`
							: undefined}
						title={multiple ? (isSelected ? 'Deselect GIF' : 'Select GIF') : 'Insert GIF'}
						class="group relative mb-2 block w-full overflow-hidden rounded-lg bg-[var(--ui-bg-muted)] transition {isSelected
							? 'ring-2 ring-primary-500'
							: isDisabled
								? 'cursor-not-allowed opacity-40'
								: ''}"
						style={kind === 'stickers'
							? 'background-image:repeating-conic-gradient(rgba(127,127,127,0.18) 0% 25%, transparent 0% 50%); background-size:12px 12px;'
							: ''}
					>
						<img
							src={item.preview}
							alt=""
							loading="lazy"
							class="w-full object-cover transition group-hover:opacity-90"
							style="aspect-ratio:{item.w}/{item.h};"
						/>
						{#if multiple}
							<!-- Numbered checkmark — shows both state and pick order. -->
							<span
								class="absolute top-1.5 left-1.5 grid size-5 place-items-center rounded-full text-[10px] font-extrabold transition {isSelected
									? 'bg-primary-500 text-white'
									: 'bg-black/45 text-transparent ring-1 ring-white/70 backdrop-blur-sm'}"
							>
								<Icon name="i-lucide-check" class="size-3" />
								{#if isSelected}<span class="sr-only">{selectionOrder(item.id)}</span>{/if}
							</span>
							{#if isSelected}
								<span
									class="absolute top-1 right-1.5 rounded-full bg-black/55 px-1.5 text-[10px] font-bold text-white backdrop-blur-sm"
									>{selectionOrder(item.id)}</span
								>
							{/if}
						{:else}
							<span
								class="absolute inset-0 grid place-items-center bg-black/0 transition group-hover:bg-black/30"
							>
								<Icon
									name="i-lucide-plus"
									class="size-5 text-white opacity-0 transition group-hover:opacity-100"
								/>
							</span>
						{/if}
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
	{#if multiple}
		<!-- Selection tray — the confirm step of the multi-select dialog. -->
		<div
			class="flex items-center gap-2 border-t border-[var(--ui-border-muted)] p-2 {selected.size
				? ''
				: 'opacity-80'}"
		>
			<div class="min-w-0 flex-1">
				<p class="text-[12px] font-semibold text-[var(--ui-text)]">
					{selected.size
						? `${selected.size} selected${atCapacity ? ` · max ${max}` : ''}`
						: `Tap GIFs to select up to ${max}`}
				</p>
			</div>
			{#if selected.size}
				<button
					type="button"
					onclick={() => selected.clear()}
					class="h-8 shrink-0 rounded-full px-3 text-[12px] font-semibold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]"
				>
					Clear
				</button>
			{/if}
			<button
				type="button"
				onclick={confirmSelection}
				disabled={!selected.size}
				class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-primary-500 px-3.5 text-[12px] font-bold text-white transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-40"
			>
				<Icon name="i-lucide-plus" class="size-3.5" />
				Add{selected.size ? ` ${selected.size}` : ''}
			</button>
		</div>
	{/if}
	<p
		class="flex items-center justify-between gap-1 border-t border-[var(--ui-border-muted)] p-1.5 text-[10px] text-[var(--ui-text-dimmed)]"
	>
		{#if onbrowse}
			<!-- Device browse lives next to the library — one picker, every source.
			     stopPropagation keeps the host popover open through the dialog. -->
			<button
				type="button"
				onclick={(event) => {
					event.stopPropagation();
					onbrowse();
				}}
				class="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]"
			>
				<Icon name="i-lucide-folder-open" class="size-3" />
				From device
			</button>
		{:else}
			<span></span>
		{/if}
		<span class="flex items-center gap-1">
			<Icon name="i-lucide-info" class="size-3" />
			Powered by Giphy
		</span>
	</p>
</div>
