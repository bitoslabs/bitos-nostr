<script lang="ts">
	import { tick } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import type { ReelNote } from '$lib/stores/bitz-session.svelte';
	import { shortKey, formatDuration } from '$lib/utils/format';
	import { lazyVideoMetadata } from '$lib/utils/media';
	import {
		highlightSegments,
		type BitzMatchMeta,
		type BitzSearchFilter,
		type BitzSearchSort,
		type BitzSearchStore
	} from '$lib/stores/bitz-search.svelte';

	interface Props {
		/** Search store — single source of truth for query, filters, results. */
		search: BitzSearchStore;
		/** Resolves author profile data (picture/nip05/names) for tiles. */
		profileFor: (
			pubkey: string
		) => { picture?: string; nip05?: string; display_name?: string; name?: string } | undefined;
		/** Duration cache shared with the Explore grid (id → seconds). */
		gridVideoDurations: Record<string, number>;
		/** Reports a measured video duration back to the page cache. */
		onDuration: (reelId: string, seconds: number) => void;
		/** Opens a result in the snap player. */
		onSelect: (reel: ReelNote) => void;
	}

	let { search, profileFor, gridVideoDurations, onDuration, onSelect }: Props = $props();

	// Focus the input each time the overlay mounts. Input slotted inside the
	// header mounts with it, so one rAF after tick is enough for focus().
	let searchInputEl = $state<HTMLInputElement | null>(null);

	$effect(() => {
		void tick().then(() => searchInputEl?.focus());
	});

	const FILTERS: { key: BitzSearchFilter; label: string; icon: string }[] = [
		{ key: 'all', label: 'All', icon: 'i-lucide-layout-grid' },
		{ key: 'video', label: 'Videos', icon: 'i-lucide-video' },
		{ key: 'image', label: 'Pictures', icon: 'i-lucide-image' },
		{ key: 'creator', label: 'Creators', icon: 'i-lucide-user-round' }
	];
	const SORTS: { key: BitzSearchSort; label: string }[] = [
		{ key: 'recent', label: 'Recent' },
		{ key: 'engagement', label: 'Top' }
	];

	function reelLikes(reel: ReelNote) {
		return reel.reactions.reduce((sum, reaction) => sum + reaction.count, 0);
	}

	function authorName(reel: ReelNote) {
		const profile = profileFor(reel.pubkey);
		return profile?.display_name || profile?.name || shortKey(reel.pubkey);
	}

	/** Matched spans render with a primary glow so users see *why* a result hit. */
	function captionSegments(reel: ReelNote) {
		return highlightSegments(search.captionFor(reel), search.tokens);
	}

	function authorSegments(reel: ReelNote) {
		return highlightSegments(authorName(reel), search.tokens);
	}

	function metaFor(reel: ReelNote): BitzMatchMeta | undefined {
		return search.meta[reel.id];
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			search.close();
		}
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			(document.querySelector('.bitz-search-results button') as HTMLElement | null)?.focus();
		}
	}

	function submitSearch(event: SubmitEvent) {
		event.preventDefault();
		void search.searchNow();
	}
</script>

<!-- Backdrop click closes; the panel itself is centered on desktop (sm+)
     and stays a full-screen sheet on phones. -->
<div
	class="fixed inset-0 z-[60] flex items-end justify-center bg-black/55 backdrop-blur-sm sm:items-center sm:p-6"
	role="dialog"
	aria-modal="true"
	aria-label="Search bitz"
	tabindex="-1"
	onkeydown={handleKeydown}
	onclick={(event) => {
		if (event.target === event.currentTarget) search.close();
	}}
>
	<div
		class="bitz-search-panel flex h-full w-full flex-col overflow-hidden bg-[var(--ui-bg)] text-[var(--ui-text)] shadow-2xl shadow-black/40 sm:h-[min(760px,88vh)] sm:max-w-3xl sm:rounded-2xl sm:border sm:border-[var(--ui-border-muted)]"
	>
		<header class="flex shrink-0 items-center gap-2 border-b border-[var(--ui-border-muted)] px-4">
			<form class="flex min-w-0 flex-1 items-center py-4" onsubmit={submitSearch}>
				<Input
					bind:ref={searchInputEl}
					type="search"
					icon="i-lucide-search"
					value={search.query}
					oninput={(event) => search.setQuery(event.currentTarget.value)}
					class="bitz-search-input h-11 w-full rounded-full border-[var(--ui-border-muted)] bg-[var(--ui-bg-accented)] px-4 focus-within:bg-[var(--ui-bg)] focus-within:ring-2 focus-within:ring-[color-mix(in_oklab,var(--ui-color-primary-500)_20%,transparent)]"
					inputClass="pl-8 text-[15px] font-medium text-[var(--ui-text-highlighted)]"
					placeholder="Search bitz — caption or creator…"
					aria-label="Search bitz"
				/>
			</form>
			<Button
				variant="soft"
				square
				class="size-10 shrink-0 rounded-full"
				onclick={() => search.close()}
				aria-label="Close search"
			>
				<Icon name="i-lucide-x" class="size-5" />
			</Button>
		</header>
		<div class="min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
			{#if !search.hasQuery}
				<div class="flex h-full min-h-64 flex-col items-center justify-center gap-3 text-center">
					<div
						class="grid size-14 place-items-center rounded-2xl bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)]"
					>
						<Icon name="i-lucide-video" class="size-7" />
					</div>
					<div>
						<p class="text-[15px] font-bold text-[var(--ui-text-highlighted)]">Search bitz</p>
						<p class="mt-1 max-w-xs text-[13px] leading-relaxed text-[var(--ui-text-muted)]">
							Find short videos and pictures by caption or creator. Matches highlight as you type —
							locally first, then across your relays.
						</p>
					</div>
				</div>
			{:else if search.matches.length}
				<!-- Toolbar: count · filter chips (with per-type counts) · sort switch -->
				<div class="mb-3 flex flex-wrap items-center gap-2">
					<p class="text-[11px] font-bold tracking-wide text-[var(--ui-text-dimmed)] uppercase">
						{search.matches.length}
						{search.matches.length === 1 ? 'bitz' : 'bitz'}
						{#if search.searching}
							<span class="ml-1 normal-case">· searching relays…</span>
						{:else if search.error}
							<span class="ml-1 text-[var(--tone-error-text)] normal-case"
								>· relay search failed</span
							>
						{/if}
					</p>
					<div
						class="flex items-center gap-0.5 rounded-full bg-[var(--ui-bg-accented)] p-1"
						role="tablist"
						aria-label="Filter results"
					>
						{#each FILTERS as chip (chip.key)}
							{#if chip.key === 'all' || search.counts[chip.key] > 0}
								<button
									type="button"
									role="tab"
									aria-selected={search.filter === chip.key}
									onclick={() => (search.filter = chip.key)}
									class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold whitespace-nowrap transition {search.filter ===
									chip.key
										? 'bg-primary-500 text-white'
										: 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text-highlighted)]'}"
								>
									<Icon name={chip.icon} class="size-3.5" />
									{chip.label}
									{#if chip.key !== 'all'}
										<span class="opacity-70">{search.counts[chip.key]}</span>
									{/if}
								</button>
							{/if}
						{/each}
					</div>
					<div
						class="ml-auto flex items-center gap-0.5 rounded-full bg-[var(--ui-bg-accented)] p-1"
					>
						{#each SORTS as mode (mode.key)}
							<button
								type="button"
								aria-pressed={search.sort === mode.key}
								onclick={() => (search.sort = mode.key)}
								class="rounded-full px-2.5 py-1 text-[11px] font-bold transition {search.sort ===
								mode.key
									? 'bg-[var(--ui-text-highlighted)] text-[var(--ui-bg)]'
									: 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text-highlighted)]'}"
							>
								{mode.label}
							</button>
						{/each}
					</div>
				</div>

				<div class="bitz-search-results grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
					{#each search.matches as reel (reel.id)}
						{@const profile = profileFor(reel.pubkey)}
						{@const name = authorName(reel)}
						{@const meta = metaFor(reel)}
						{@const duration = gridVideoDurations[reel.id]}
						<button
							type="button"
							onclick={() => onSelect(reel)}
							class="group relative aspect-[9/16] overflow-hidden rounded-xl bg-black text-left transition focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:outline-none"
							aria-label="Open bitz by {name}"
						>
							{#if reel.mediaType === 'video'}
								<video
									use:lazyVideoMetadata
									src={reel.mediaUrl}
									class="absolute inset-0 size-full object-cover transition group-hover:scale-105"
									muted
									playsinline
									preload="none"
									onloadedmetadata={(event) => {
										const video = event.currentTarget as HTMLVideoElement;
										if (Number.isFinite(video.duration)) onDuration(reel.id, video.duration);
									}}
								></video>
								{#if duration}
									<span
										class="absolute top-1.5 right-1.5 rounded-md bg-black/60 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white tabular-nums backdrop-blur"
									>
										{formatDuration(duration)}
									</span>
								{/if}
							{:else}
								<img
									src={reel.mediaUrl}
									alt={search.captionFor(reel) || 'Bitz picture'}
									class="absolute inset-0 size-full object-cover transition group-hover:scale-105"
									loading="lazy"
								/>
							{/if}
							{#if (meta?.author ?? -1) >= 0 && (meta?.caption ?? -1) < 0}
								<span
									class="absolute top-1.5 left-1.5 rounded-full bg-primary-500/85 px-1.5 py-0.5 text-[9px] font-bold text-white uppercase backdrop-blur"
								>
									creator match
								</span>
							{/if}
							<span
								class="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-black/85 via-black/30 to-transparent p-2 pt-8 text-white"
							>
								{#if search.captionFor(reel)}
									<span class="line-clamp-2 text-[11px] leading-tight font-semibold">
										{#each captionSegments(reel) as segment}
											{#if segment.match}<mark class="bg-primary-500/40 text-white"
													>{segment.text}</mark
												>{:else}{segment.text}{/if}
										{/each}
									</span>
								{/if}
								<span class="flex min-w-0 items-center gap-1">
									<Avatar
										pubkey={reel.pubkey}
										{name}
										picture={profile?.picture}
										size={16}
										shape="hex"
									/>
									<span class="truncate text-[10px] font-bold">
										{#each authorSegments(reel) as segment}
											{#if segment.match}<mark class="bg-primary-500/40 text-white"
													>{segment.text}</mark
												>{:else}{segment.text}{/if}
										{/each}
									</span>
								</span>
								<span class="flex items-center gap-2 text-[10px] font-bold">
									<span class="inline-flex items-center gap-0.5">
										<Icon name="i-lucide-heart" class="size-3 fill-current" />
										{reelLikes(reel)}
									</span>
									{#if reel.zapCount}
										<span class="inline-flex items-center gap-0.5">
											<Icon name="i-lucide-zap" class="size-3 fill-current" />
											{reel.zapCount}
										</span>
									{/if}
								</span>
							</span>
						</button>
					{/each}
				</div>
				{#if search.searching}
					<div
						class="mt-4 flex items-center justify-center gap-2 text-[12px] font-semibold text-[var(--ui-text-muted)]"
					>
						<Icon name="i-lucide-loader-circle" class="size-4 animate-spin" />
						Searching relays for older bitz…
					</div>
				{/if}
			{:else if search.searching}
				<div class="flex h-full min-h-64 flex-col items-center justify-center gap-3">
					<div
						class="size-8 animate-spin rounded-full border-2 border-[var(--ui-border)] border-t-[var(--ui-color-primary-500)]"
					></div>
					<p class="text-[13px] font-semibold text-[var(--ui-text-muted)]">Searching relays…</p>
				</div>
			{:else}
				<div class="flex h-full min-h-64 flex-col items-center justify-center gap-3 text-center">
					<div
						class="grid size-14 place-items-center rounded-2xl bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)]"
					>
						<Icon name="i-lucide-search-x" class="size-7" />
					</div>
					<div>
						<p class="text-[15px] font-bold text-[var(--ui-text-highlighted)]">No bitz found</p>
						<p class="mt-1 text-[13px] text-[var(--ui-text-muted)]">
							Nothing matches “{search.trimmed}”{#if search.error}
								on your relays either.{:else}
								in your feed yet — still asking your relays…{/if}
						</p>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.bitz-search-panel {
		animation: bitz-search-in 150ms ease-out;
	}

	@keyframes bitz-search-in {
		from {
			opacity: 0;
			transform: translateY(10px) scale(0.985);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.bitz-search-panel {
			animation: none;
		}
	}
</style>
