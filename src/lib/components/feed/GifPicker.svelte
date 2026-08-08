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
		(import.meta.env.VITE_GIPHY_API_KEY as string | undefined) || 'Gc7131jiJuvI7IdN0HZ1D7nh0ow5BU6g';

	export interface GifChoice {
		url: string;
		preview: string;
		width: number;
		height: number;
	}

	let { onpick }: { onpick: (gif: GifChoice) => void } = $props();

	type GiphyImageSet = { url: string; width?: string; height?: string };
	type GiphyItem = { id: string; images: Record<string, GiphyImageSet>; title?: string };

	let query = $state('');
	let items = $state<{ id: string; preview: string; url: string; w: number; h: number }[]>([]);
	let loading = $state(false);
	let loaded = $state(false);
	let error = $state('');
	let debounce: ReturnType<typeof setTimeout> | undefined;
	let controller: AbortController | undefined;

	async function fetchGifs(q: string) {
		if (!browser) return;
		controller?.abort();
		controller = new AbortController();
		loading = true;
		error = '';
		try {
			const endpoint = q.trim()
				? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(q)}&limit=30&rating=pg`
				: `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_KEY}&limit=30&rating=pg`;
			const res = await fetch(endpoint, { signal: controller.signal });
			if (!res.ok) throw new Error(`Giphy ${res.status}`);
			const json = (await res.json()) as { data: GiphyItem[] };
			items = json.data.map((gif) => {
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
			if (!items.length && q.trim()) error = 'No GIFs found';
		} catch (e) {
			if ((e as Error).name !== 'AbortError') error = 'Could not load GIFs';
		} finally {
			loading = false;
			loaded = true;
		}
	}

	function onInput() {
		clearTimeout(debounce);
		debounce = setTimeout(() => fetchGifs(query), 350);
	}

	function pick(item: { url: string; preview: string; w: number; h: number }) {
		onpick({ url: item.url, preview: item.preview, width: item.w, height: item.h });
	}

	// Load trending the first time the picker renders.
	$effect(() => {
		if (browser && !loaded && !loading) fetchGifs('');
	});
</script>

<div class="w-72 max-w-[80vw] sm:w-80">
	<div class="flex items-center gap-2 border-b border-[var(--ui-border-muted)] p-2">
		<Icon name="i-lucide-search" class="size-4 shrink-0 text-[var(--ui-text-dimmed)]" />
		<input
			type="search"
			bind:value={query}
			oninput={onInput}
			placeholder="Search GIFs…"
			class="w-full bg-transparent text-[13px] outline-none placeholder:text-[var(--ui-text-dimmed)]"
		/>
		{#if loading}
			<Icon name="i-lucide-loader-circle" class="size-4 shrink-0 animate-spin text-primary-500" />
		{/if}
	</div>

	<div class="max-h-[280px] overflow-y-auto p-2">
		{#if error}
			<p class="grid place-items-center gap-2 py-10 text-center text-[12px] text-[var(--ui-text-dimmed)]">
				<Icon name="i-lucide-image-off" class="size-6" />
				{error}
			</p>
		{:else if !loading && !items.length}
			<p class="py-10 text-center text-[12px] text-[var(--ui-text-dimmed)]">Type to search GIFs</p>
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
		{/if}
	</div>
	<p class="flex items-center justify-center gap-1 border-t border-[var(--ui-border-muted)] p-1.5 text-[10px] text-[var(--ui-text-dimmed)]">
		<Icon name="i-lucide-info" class="size-3" />
		Powered by Giphy
	</p>
</div>
