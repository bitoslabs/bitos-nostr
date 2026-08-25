<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';

	type PickedIcon = { name: string; url: string };
	type SearchResponse = { icons?: unknown };

	let { onPick }: { onPick: (icon: PickedIcon) => void } = $props();

	const popularIcons = [
		'lucide:heart',
		'lucide:flame',
		'lucide:star',
		'lucide:zap',
		'lucide:rocket',
		'lucide:crown',
		'lucide:party-popper',
		'lucide:sparkles',
		'twemoji:skull',
		'twemoji:eyes',
		'noto:money-bag',
		'noto:collision'
	];

	let query = $state('');
	let results = $state<string[]>(popularIcons);
	let loading = $state(false);
	let searched = $state(false);
	let searchError = $state('');

	function iconUrl(icon: string): string {
		const [prefix, ...name] = icon.split(':');
		if (!prefix || !name.length) return '';
		return `https://api.iconify.design/${encodeURIComponent(prefix)}/${encodeURIComponent(name.join(':'))}.svg?height=128`;
	}

	function labelFor(icon: string): string {
		return icon.replace(':', ' · ').replaceAll('-', ' ');
	}

	async function searchIcons(term: string): Promise<void> {
		const clean = term.trim();
		if (!clean) {
			results = popularIcons;
			searched = false;
			searchError = '';
			return;
		}
		loading = true;
		searchError = '';
		try {
			const response = await fetch(`/api/icons/search?q=${encodeURIComponent(clean)}`);
			if (!response.ok) throw new Error('Search unavailable');
			const data = (await response.json()) as SearchResponse;
			results = Array.isArray(data.icons)
				? data.icons.filter((icon): icon is string => typeof icon === 'string').slice(0, 48)
				: [];
			searched = true;
		} catch {
			results = [];
			searched = true;
			searchError = 'Search could not load. Please try again.';
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		const timer = window.setTimeout(() => void searchIcons(query), 180);
		return () => window.clearTimeout(timer);
	});
</script>

<div class="space-y-2">
	<div
		class="flex items-center gap-1.5 rounded-full border border-[var(--ui-border-muted)] px-2.5 py-1"
	>
		<Icon name="i-lucide-search" class="size-3 shrink-0 text-[var(--ui-text-dimmed)]" />
		<label class="sr-only" for="meme-svg-icon-search">Search SVG icons</label>
		<input
			id="meme-svg-icon-search"
			type="search"
			bind:value={query}
			placeholder="Search SVG icons…"
			onclick={(event) => event.stopPropagation()}
			onkeydown={(event) => {
				event.stopPropagation();
				if (event.key === 'Enter') {
					event.preventDefault();
					void searchIcons(query);
				}
			}}
			class="w-full bg-transparent text-[11px] outline-none placeholder:text-[var(--ui-text-dimmed)]"
		/>
		{#if loading}
			<Icon
				name="i-lucide-loader-circle"
				class="size-3 shrink-0 animate-spin text-[var(--ui-text-dimmed)]"
			/>
		{/if}
	</div>

	<p class="px-1 text-[9.5px] leading-snug text-[var(--ui-text-dimmed)]">
		{searched ? `${results.length} matches` : 'Popular picks'} · Iconify SVG catalog
	</p>

	<div class="grid max-h-56 grid-cols-6 gap-1 overflow-y-auto pr-0.5">
		{#each results as icon (icon)}
			<button
				type="button"
				onclick={() => onPick({ name: icon, url: iconUrl(icon) })}
				aria-label={`Add ${labelFor(icon)} as an SVG sticker`}
				title={`Add ${icon}`}
				class="grid aspect-square place-items-center rounded-lg p-1.5 transition hover:scale-110 hover:bg-[var(--ui-bg-muted)] active:scale-95"
			>
				<img src={iconUrl(icon)} alt="" loading="lazy" class="size-full object-contain" />
			</button>
		{/each}
		{#if !loading && !results.length}
			<p class="col-span-6 py-4 text-center text-[10.5px] text-[var(--ui-text-dimmed)]">
				{searchError || `No SVG icons match “${query.trim()}”`}
			</p>
		{/if}
	</div>
</div>
