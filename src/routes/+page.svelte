<script lang="ts">
	import { page } from '$app/state';
	import Icon from '$lib/components/ui/Icon.svelte';
	import StoriesBar from '$lib/components/feed/StoriesBar.svelte';
	import Composer from '$lib/components/feed/Composer.svelte';
	import PostCard from '$lib/components/feed/PostCard.svelte';
	import TrendingRail from '$lib/components/feed/TrendingRail.svelte';
	import { feed } from '$lib/nostr/feed.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { feedPreferences } from '$lib/stores/feed-preferences.svelte';
	import { popovers } from '$lib/stores/popovers.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import type { FeedNote } from '$lib/nostr/types';

	type FeedFilter = 'all' | 'originals' | 'replies' | 'media' | 'liked' | 'mine';

	const filterOptions: { key: FeedFilter; label: string; icon: string }[] = [
		{ key: 'all', label: 'All', icon: 'i-lucide-list-filter' },
		{ key: 'originals', label: 'Original', icon: 'i-lucide-message-square' },
		{ key: 'replies', label: 'Replies', icon: 'i-lucide-reply' },
		{ key: 'media', label: 'Media', icon: 'i-lucide-image' },
		{ key: 'liked', label: 'Liked', icon: 'i-lucide-heart' },
		{ key: 'mine', label: 'Mine', icon: 'i-lucide-user' }
	];

	const mediaUrlPattern = /https?:\/\/\S+\.(?:apng|avif|gif|jpe?g|png|webp)(?:[?#]\S*)?/i;
	const hashtagPattern = /(?:^|\s)#([\p{L}\p{N}_-]{2,60})/gu;
	const filterMenuId = 'feed-filter';
	const INITIAL_RENDER_COUNT = 15;
	const RENDER_BATCH_SIZE = 12;

	let feedScroller: HTMLDivElement | undefined = $state();
	const filterOpen = $derived(popovers.isOpen(filterMenuId));
	let activeFilters = $state<FeedFilter[]>(['all']);
	let searchQuery = $state('');
	let searchOpen = $state(false);
	let renderedCount = $state(INITIAL_RENDER_COUNT);
	let lastViewSignature = $state('');
	const activeTag = $derived((page.url.searchParams.get('tag') ?? '').trim().toLowerCase());
	const normalizedSearch = $derived(searchQuery.trim().toLowerCase());
	const selectedFilterOptions = $derived(
		filterOptions.filter((option) => activeFilters.includes(option.key))
	);
	const activeFilterLabel = $derived(
		selectedFilterOptions.length ? selectedFilterOptions.map((option) => option.label).join(', ') : 'All'
	);
	const pinnedTags = $derived(feedPreferences.state.pinnedTags);
	const filteredNotes = $derived(
		feed.notes.filter((note) => {
			const matchesFilter = matchesActiveFilters(note);
			return (
				matchesFilter &&
				(!activeTag || hasTag(note, activeTag)) &&
				(!normalizedSearch || matchesSearch(note, normalizedSearch))
			);
		})
	);
	const renderedNotes = $derived(filteredNotes.slice(0, renderedCount));
	const hasMoreRenderedNotes = $derived(renderedCount < filteredNotes.length);

	function renderMoreNotes() {
		if (!hasMoreRenderedNotes) return;
		renderedCount = Math.min(filteredNotes.length, renderedCount + RENDER_BATCH_SIZE);
	}

	function hasMedia(note: FeedNote) {
		return mediaUrlPattern.test(note.content);
	}

	function hasTag(note: FeedNote, tag: string) {
		const tagged = note.tags.some((item) => item[0] === 't' && item[1]?.toLowerCase() === tag);
		if (tagged) return true;
		return [...note.content.matchAll(hashtagPattern)].some(
			(match) => match[1].toLowerCase() === tag
		);
	}

	function isFilterSelected(filter: FeedFilter) {
		return activeFilters.includes(filter);
	}

	function toggleFilter(next: FeedFilter) {
		if (next === 'all') {
			activeFilters = ['all'];
		} else {
			const withoutAll = activeFilters.filter((filter) => filter !== 'all');
			activeFilters = withoutAll.includes(next)
				? withoutAll.filter((filter) => filter !== next)
				: [...withoutAll, next];
			if (!activeFilters.length) activeFilters = ['all'];
		}
		renderedCount = INITIAL_RENDER_COUNT;
		requestAnimationFrame(() => {
			feedScroller?.scrollTo({ top: 0, behavior: 'smooth' });
		});
	}

	function matchesActiveFilters(note: FeedNote) {
		if (!activeFilters.length || activeFilters.includes('all')) return true;
		return activeFilters.some((filter) => {
			if (filter === 'originals') return !note.replyTo;
			if (filter === 'replies') return !!note.replyTo;
			if (filter === 'media') return hasMedia(note);
			if (filter === 'liked') return note.reactions.some((reaction) => reaction.byMe);
			if (filter === 'mine') return !!identity.current && note.pubkey === identity.current.pk;
			return true;
		});
	}

	function matchesSearch(note: FeedNote, query: string) {
		const profile = profiles.get(note.pubkey);
		const displayName = profile?.display_name || profile?.name || '';
		return [note.content, displayName, profile?.name ?? '', note.pubkey]
			.join(' ')
			.toLowerCase()
			.includes(query);
	}

	function showNewNotes() {
		const count = feed.revealPending();
		if (!count) return;
		renderedCount = INITIAL_RENDER_COUNT;
		requestAnimationFrame(() => {
			feedScroller?.scrollTo({ top: 0, behavior: 'smooth' });
		});
	}

	function loadMoreNotes() {
		void feed.loadMore();
	}

	function handleFeedScroll() {
		if (!feedScroller) return;
		const remaining =
			feedScroller.scrollHeight - feedScroller.scrollTop - feedScroller.clientHeight;
		if (remaining < 1200 && hasMoreRenderedNotes) renderMoreNotes();
		if (feed.loading || feed.loadingMore || !feed.hasMore) return;
		if (remaining < 900) loadMoreNotes();
	}

	$effect(() => {
		feedPreferences.load();
		const signature = `${activeFilters.slice().sort().join(',')}:${activeTag}:${normalizedSearch}`;
		if (signature === lastViewSignature) return;
		lastViewSignature = signature;
		renderedCount = INITIAL_RENDER_COUNT;
	});

	$effect(() => {
		if (renderedNotes.length) profiles.ensure(renderedNotes.map((n) => n.pubkey));
	});
</script>

<svelte:head><title>Feed · BitOS</title></svelte:head>

<div class="flex h-full">
	<!-- Center feed -->
	<div bind:this={feedScroller} class="flex-1 overflow-y-auto" onscroll={handleFeedScroll}>
		<div class="mx-auto max-w-[640px] px-5 py-6">
			<!-- Header -->
			<div class="mb-5 flex flex-wrap items-start justify-between gap-3">
				<div>
					<h1 class="font-display text-[32px] leading-none font-extrabold tracking-tight">
						Discover
					</h1>
					<p class="mt-1.5 text-[12px] text-[var(--ui-text-muted)]">
						Fresh notes from the global Nostr feed
					</p>
				</div>
				<div class="relative flex shrink-0 gap-2">
					<button
						type="button"
						onclick={() => {
							if (feed.pendingCount) {
								showNewNotes();
							} else {
								feed.start();
								toasts.info('Refreshing feed');
							}
						}}
						class="grid size-10 place-items-center rounded-xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] text-[var(--ui-text-muted)] transition hover:text-primary-500"
						aria-label={feed.pendingCount ? 'Show new notes' : 'Refresh'}
					>
						<Icon name="i-lucide-rotate-cw" class="size-5" />
					</button>
					<button
						type="button"
						onclick={() => {
							searchOpen = !searchOpen;
							if (!searchOpen) searchQuery = '';
						}}
						class="grid size-10 place-items-center rounded-xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] text-[var(--ui-text-muted)] transition hover:text-primary-500 {searchOpen || normalizedSearch
							? 'border-primary-500/30 bg-primary-500/10 text-primary-600'
							: ''}"
						aria-label={searchOpen ? 'Hide search' : 'Show search'}
						aria-expanded={searchOpen}
					>
						<Icon name="i-lucide-search" class="size-5" />
					</button>
					<button
						type="button"
						onclick={(e) => {
							e.stopPropagation();
							popovers.toggle(filterMenuId);
						}}
						class="grid size-10 place-items-center rounded-xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] text-[var(--ui-text-muted)] transition hover:text-primary-500 {!activeFilters.includes(
						'all'
					) || activeFilters.length > 1
							? 'border-primary-500/30 bg-primary-500/10 text-primary-600'
							: ''}"
						aria-label="Filters"
						aria-expanded={filterOpen}
					>
						<Icon name="i-lucide-sliders-horizontal" class="size-5" />
					</button>

					{#if filterOpen}
						<div
							class="absolute top-12 right-0 z-20 w-56 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] p-1.5 shadow-[var(--shadow-pop)]"
						>
							{#each filterOptions as option (option.key)}
								<button
									type="button"
									onclick={() => toggleFilter(option.key)}
									class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold transition-colors hover:bg-[var(--interactive-hover-bg)] {isFilterSelected(
									option.key
								)
										? 'text-primary-600'
										: 'text-[var(--ui-text-muted)]'}"
								>
									<Icon name={option.icon} class="size-4 shrink-0" />
									<span class="flex-1">{option.label}</span>
									{#if isFilterSelected(option.key)}
										<Icon name="i-lucide-check" class="size-4 shrink-0" />
									{/if}
								</button>
							{/each}
						</div>
					{/if}
				</div>
			</div>

			<div class="mb-4 flex flex-col gap-3">
				{#if searchOpen}
					<div class="flex flex-wrap items-center gap-2">
						<label class="relative min-w-0 flex-1">
							<Icon
								name="i-lucide-search"
								class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--ui-text-dimmed)]"
							/>
							<input
								bind:value={searchQuery}
								type="search"
								placeholder="Search notes, hashtags, or authors"
								class="w-full rounded-xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] py-2.5 pr-3 pl-9 text-[13px] text-[var(--ui-text)] outline-none transition focus:border-primary-500/40 focus:ring-2 focus:ring-primary-500/15"
							/>
						</label>
						{#if normalizedSearch}
							<button
								type="button"
								onclick={() => (searchQuery = '')}
								class="rounded-xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-3 py-2 text-[12px] font-semibold text-[var(--ui-text-muted)] transition hover:text-primary-500"
							>
								Clear search
							</button>
						{/if}
					</div>
				{/if}

				{#if pinnedTags.length}
					<div class="flex flex-wrap items-center gap-2">
						<span class="text-[11px] font-bold tracking-[0.16em] text-[var(--ui-text-dimmed)] uppercase">
							Pinned
						</span>
						{#each pinnedTags as tag (tag)}
							<div class="flex items-center overflow-hidden rounded-full border border-primary-500/15 bg-primary-500/10">
								<a
									href={`/?tag=${encodeURIComponent(tag)}`}
									class="px-3 py-1.5 text-[12px] font-semibold text-primary-600 transition hover:bg-primary-500/10"
								>
									#{tag}
								</a>
								<button
									type="button"
									onclick={() => feedPreferences.togglePinnedTag(tag)}
									class="grid h-full place-items-center px-2 text-primary-600/75 transition hover:bg-primary-500/10 hover:text-primary-700"
									aria-label={`Unpin #${tag}`}
									title={`Unpin #${tag}`}
								>
									<Icon name="i-lucide-pin-off" class="size-3.5" />
								</button>
							</div>
						{/each}
					</div>
				{/if}
			</div>

			{#if !activeFilters.includes('all') || activeTag || normalizedSearch}
				<div
					class="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary-500/15 bg-primary-500/10 px-3 py-2 text-[12px]"
				>
					<div class="flex min-w-0 items-center gap-2 font-semibold text-primary-600">
						<Icon name="i-lucide-filter" class="size-4 shrink-0" />
						<span class="truncate">
							{activeTag ? `#${activeTag}` : activeFilterLabel}
							{normalizedSearch ? ` · "${searchQuery.trim()}"` : ''}
							· {filteredNotes.length} notes
						</span>
					</div>
					<div class="flex items-center gap-2">
						{#if activeTag}
							<button
								type="button"
								onclick={() => feedPreferences.togglePinnedTag(activeTag)}
								class="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-bold text-primary-600 transition hover:bg-primary-500/10"
							>
								<Icon
									name={feedPreferences.isPinned(activeTag) ? 'i-lucide-pin-off' : 'i-lucide-pin'}
									class="size-3.5"
								/>
								{feedPreferences.isPinned(activeTag) ? 'Unpin tag' : 'Pin tag'}
							</button>
						{/if}
						<a
							href="/"
							onclick={() => {
								activeFilters = ['all'];
								searchQuery = '';
							}}
							class="rounded-lg px-2 py-1 font-bold text-primary-600 transition hover:bg-primary-500/10"
						>
							Clear
						</a>
					</div>
				</div>
			{/if}

			<!-- Stories -->
			<div class="mb-4">
				<StoriesBar />
			</div>

			<!-- Composer -->
			<div class="mb-4">
				<Composer />
			</div>

			{#if feed.pendingCount}
				<div class="sticky top-3 z-10 mb-4 flex justify-center">
					<button
						type="button"
						onclick={showNewNotes}
						class="inline-flex items-center gap-2 rounded-full border border-primary-500/20 bg-primary-500 px-4 py-2 text-[13px] font-bold text-white shadow-[var(--glow-primary)] transition hover:bg-primary-600 active:scale-95"
					>
						<Icon name="i-lucide-arrow-up" class="size-4" />
						{feed.pendingCount} new {feed.pendingCount === 1 ? 'note' : 'notes'}
					</button>
				</div>
			{/if}

			<!-- Posts -->
			{#if feed.loading && !feed.notes.length}
				<div class="flex flex-col items-center gap-3 py-20 text-center">
					<div
						class="size-7 animate-spin rounded-full border-2 border-[var(--ui-border)] border-t-primary-500"
					></div>
					<p class="text-[13px] text-[var(--ui-text-muted)]">Fetching notes from relays…</p>
				</div>
			{:else if !feed.notes.length}
				<div class="post-card flex flex-col items-center gap-3 py-16 text-center">
					<div
						class="grid size-14 place-items-center rounded-2xl bg-[var(--ui-bg-muted)] text-[var(--ui-text-dimmed)]"
					>
						<Icon name="i-lucide-newspaper" class="size-7" />
					</div>
					<div>
						<p class="text-[15px] font-semibold">No notes yet</p>
						<p class="mt-1 text-[13px] text-[var(--ui-text-muted)]">
							Be the first to post something.
						</p>
					</div>
				</div>
			{:else if !filteredNotes.length}
				<div class="post-card flex flex-col items-center gap-3 py-16 text-center">
					<div
						class="grid size-14 place-items-center rounded-2xl bg-[var(--ui-bg-muted)] text-[var(--ui-text-dimmed)]"
					>
						<Icon name="i-lucide-filter-x" class="size-7" />
					</div>
					<div>
						<p class="text-[15px] font-semibold">No matching notes</p>
						<p class="mt-1 text-[13px] text-[var(--ui-text-muted)]">
							Try a different filter, hashtag, or search term.
						</p>
					</div>
					<a
						href="/"
						onclick={() => {
							activeFilters = ['all'];
							searchQuery = '';
						}}
						class="rounded-full bg-primary-500 px-4 py-2 text-[12px] font-bold text-white transition hover:bg-primary-600"
					>
						Show all
					</a>
				</div>
			{:else}
				<div class="space-y-5">
					{#each renderedNotes as note, i (note.id)}
						<PostCard {note} index={i} />
					{/each}
				</div>

				<div class="py-8 text-center">
					{#if hasMoreRenderedNotes}
						<button
							type="button"
							onclick={renderMoreNotes}
							class="inline-flex items-center justify-center gap-2 rounded-full border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-6 py-2.5 text-[13px] font-semibold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-accented)]"
						>
							Show more posts
							<span class="text-[11px] opacity-70">
								{Math.min(RENDER_BATCH_SIZE, filteredNotes.length - renderedCount)} next
							</span>
						</button>
					{:else}
						<button
							type="button"
							onclick={loadMoreNotes}
							disabled={feed.loadingMore || !feed.hasMore}
							class="inline-flex items-center justify-center gap-2 rounded-full border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-6 py-2.5 text-[13px] font-semibold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-accented)] disabled:cursor-default disabled:opacity-60 disabled:hover:bg-[var(--surface-bg)]"
						>
							{#if feed.loadingMore}
								<Icon name="i-lucide-loader-circle" class="size-4 animate-spin" />
								Loading older notes
							{:else if feed.hasMore}
								Load more posts
							{:else}
								End of relay results
							{/if}
						</button>
					{/if}
				</div>
			{/if}
		</div>
	</div>

	<!-- Right rail -->
	<TrendingRail />
</div>
