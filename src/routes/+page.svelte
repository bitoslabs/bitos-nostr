<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import StoriesBar from '$lib/components/feed/StoriesBar.svelte';
	import Composer from '$lib/components/feed/Composer.svelte';
	import PostCard from '$lib/components/feed/PostCard.svelte';
	import TrendingRail from '$lib/components/feed/TrendingRail.svelte';
	import { feed } from '$lib/nostr/feed.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
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
	const filterMenuId = 'feed-filter';

	$effect(() => {
		if (feed.notes.length) profiles.ensure(feed.notes.map((n) => n.pubkey));
	});

	let feedScroller: HTMLDivElement | undefined = $state();
	const filterOpen = $derived(popovers.isOpen(filterMenuId));
	let activeFilter = $state<FeedFilter>('all');
	const activeFilterLabel = $derived(
		filterOptions.find((option) => option.key === activeFilter)?.label ?? 'All'
	);
	const filteredNotes = $derived(
		feed.notes.filter((note) => {
			if (activeFilter === 'originals') return !note.replyTo;
			if (activeFilter === 'replies') return !!note.replyTo;
			if (activeFilter === 'media') return hasMedia(note);
			if (activeFilter === 'liked') return note.reactions.some((reaction) => reaction.byMe);
			if (activeFilter === 'mine') return !!identity.current && note.pubkey === identity.current.pk;
			return true;
		})
	);

	function hasMedia(note: FeedNote) {
		return mediaUrlPattern.test(note.content);
	}

	function setFilter(next: FeedFilter) {
		activeFilter = next;
		popovers.close();
		requestAnimationFrame(() => {
			feedScroller?.scrollTo({ top: 0, behavior: 'smooth' });
		});
	}

	function showNewNotes() {
		const count = feed.revealPending();
		if (!count) return;
		requestAnimationFrame(() => {
			feedScroller?.scrollTo({ top: 0, behavior: 'smooth' });
		});
	}

	function loadMoreNotes() {
		void feed.loadMore();
	}

	function handleFeedScroll() {
		if (!feedScroller || feed.loading || feed.loadingMore || !feed.hasMore) return;
		const remaining =
			feedScroller.scrollHeight - feedScroller.scrollTop - feedScroller.clientHeight;
		if (remaining < 900) loadMoreNotes();
	}
</script>

<svelte:window onclick={() => popovers.close()} />

<div class="flex h-full">
	<!-- Center feed -->
	<div bind:this={feedScroller} class="flex-1 overflow-y-auto" onscroll={handleFeedScroll}>
		<div class="mx-auto max-w-[640px] px-5 py-6">
			<!-- Header -->
			<div class="mb-5 flex items-center justify-between">
				<div>
					<h1 class="font-display text-[32px] leading-none font-extrabold tracking-tight">
						Discover
					</h1>
					<p class="mt-1.5 text-[12px] text-[var(--ui-text-muted)]">
						Fresh notes from the global Nostr feed
					</p>
				</div>
				<div class="relative flex gap-2">
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
						onclick={(e) => {
							e.stopPropagation();
							popovers.toggle(filterMenuId);
						}}
						class="grid size-10 place-items-center rounded-xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] text-[var(--ui-text-muted)] transition hover:text-primary-500 {activeFilter !==
						'all'
							? 'border-primary-500/30 bg-primary-500/10 text-primary-600'
							: ''}"
						aria-label="Filters"
						aria-expanded={filterOpen}
					>
						<Icon name="i-lucide-sliders-horizontal" class="size-5" />
					</button>

					{#if filterOpen}
						<div
							class="absolute top-12 right-0 z-20 w-48 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] p-1.5 shadow-[var(--shadow-pop)]"
						>
							{#each filterOptions as option (option.key)}
								<button
									type="button"
									onclick={() => setFilter(option.key)}
									class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold transition-colors hover:bg-[var(--interactive-hover-bg)] {activeFilter ===
									option.key
										? 'bg-primary-500/10 text-primary-600'
										: 'text-[var(--ui-text-muted)]'}"
								>
									<Icon name={option.icon} class="size-4 shrink-0" />
									<span class="flex-1">{option.label}</span>
									{#if activeFilter === option.key}
										<Icon name="i-lucide-check" class="size-4 shrink-0" />
									{/if}
								</button>
							{/each}
						</div>
					{/if}
				</div>
			</div>

			{#if activeFilter !== 'all'}
				<div
					class="mb-4 flex items-center justify-between rounded-xl border border-primary-500/15 bg-primary-500/10 px-3 py-2 text-[12px]"
				>
					<div class="flex min-w-0 items-center gap-2 font-semibold text-primary-600">
						<Icon name="i-lucide-filter" class="size-4 shrink-0" />
						<span class="truncate">{activeFilterLabel} · {filteredNotes.length} notes</span>
					</div>
					<button
						type="button"
						onclick={() => setFilter('all')}
						class="rounded-lg px-2 py-1 font-bold text-primary-600 transition hover:bg-primary-500/10"
					>
						Clear
					</button>
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
						<p class="mt-1 text-[13px] text-[var(--ui-text-muted)]">Try a different feed filter.</p>
					</div>
					<button
						type="button"
						onclick={() => setFilter('all')}
						class="rounded-full bg-primary-500 px-4 py-2 text-[12px] font-bold text-white transition hover:bg-primary-600"
					>
						Show all
					</button>
				</div>
			{:else}
				<div class="space-y-5">
					{#each filteredNotes as note, i (note.id)}
						<PostCard {note} index={i} />
					{/each}
				</div>

				<div class="py-8 text-center">
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
				</div>
			{/if}
		</div>
	</div>

	<!-- Right rail -->
	<TrendingRail />
</div>
