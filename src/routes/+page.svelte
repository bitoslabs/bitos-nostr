<script lang="ts">
	import { page } from '$app/state';
	import type { Filter } from 'nostr-tools/filter';
	import Icon from '$lib/components/ui/Icon.svelte';
	import StoriesBar from '$lib/components/feed/StoriesBar.svelte';
	import Composer from '$lib/components/feed/Composer.svelte';
	import PostCard from '$lib/components/feed/PostCard.svelte';
	import TrendingRail from '$lib/components/feed/TrendingRail.svelte';
	import { feed } from '$lib/nostr/feed.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { queryPrimaryFirst } from '$lib/nostr/pool';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { contacts } from '$lib/nostr/contacts.svelte';
	import { NOSTR_KINDS, type Event, type FeedNote } from '$lib/nostr/types';
	import { applyActivityToNotes } from '$lib/nostr/zaps';
	import { feedPreferences } from '$lib/stores/feed-preferences.svelte';
	import { popovers } from '$lib/stores/popovers.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';

	type FeedFilter = 'all' | 'originals' | 'replies' | 'media' | 'liked' | 'mine';
	type SearchMode = 'local' | 'relay';

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
	const RELAY_RESULT_LIMIT = 120;

	let feedScroller: HTMLDivElement | undefined = $state();
	const filterOpen = $derived(popovers.isOpen(filterMenuId));
	let activeFilters = $state<FeedFilter[]>(['all']);
	let feedMode = $state<'foryou' | 'following'>('foryou');
	let searchQuery = $state('');
	let searchOpen = $state(false);
	let searchMode = $state<SearchMode>('local');
	let renderedCount = $state(INITIAL_RENDER_COUNT);
	let lastViewSignature = $state('');
	let relayFeedNotes = $state<FeedNote[]>([]);
	let relayFeedLoading = $state(false);
	let relayFeedMerging = $state(false);
	let relayFeedStatus = $state<'idle' | 'primary' | 'merged'>('idle');
	let relayFeedSignature = $state('');
	const activeTag = $derived((page.url.searchParams.get('tag') ?? '').trim().toLowerCase());
	const normalizedSearch = $derived(searchQuery.trim().toLowerCase());
	const useRelayFeed = $derived(!!activeTag || (!!normalizedSearch && searchMode === 'relay'));
	const baseNotes = $derived(useRelayFeed ? relayFeedNotes : feed.notes);
	const selectedFilterOptions = $derived(
		filterOptions.filter((option) => activeFilters.includes(option.key))
	);
	const activeFilterLabel = $derived(
		selectedFilterOptions.length ? selectedFilterOptions.map((option) => option.label).join(', ') : 'All'
	);
	const pinnedTags = $derived(feedPreferences.state.pinnedTags);
	const followingOnly = $derived(feedMode === 'following' && !useRelayFeed);
	const filteredNotes = $derived(
		baseNotes.filter((note) => {
			if (
				followingOnly &&
				!contacts.followingSet.has(note.pubkey) &&
				note.pubkey !== identity.current?.pk
			)
				return false;
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

	function toFeedNote(ev: Pick<Event, 'id' | 'pubkey' | 'content' | 'created_at' | 'tags'>): FeedNote {
		const replyTag = ev.tags.find((tag) => tag[0] === 'e' && tag[3] === 'reply');
		return {
			id: ev.id,
			pubkey: ev.pubkey,
			content: ev.content,
			createdAt: ev.created_at,
			tags: ev.tags,
			replyTo: replyTag?.[1],
			reactions: [],
			repostCount: 0,
			zapCount: 0,
			zapTotalSats: 0
		};
	}

	function uniqueTimelineEvents(events: Event[]) {
		const seen = new Set<string>();
		return events
			.filter((event) => {
				if (event.kind !== NOSTR_KINDS.TEXT_NOTE || seen.has(event.id)) return false;
				seen.add(event.id);
				return true;
			})
			.sort((a, b) => b.created_at - a.created_at);
	}

	function relayFilters(): Filter[] {
		const filters: Filter[] = [];
		if (activeTag) {
			filters.push({ kinds: [NOSTR_KINDS.TEXT_NOTE], '#t': [activeTag], limit: RELAY_RESULT_LIMIT });
		}
		if (normalizedSearch) {
			filters.push({ kinds: [NOSTR_KINDS.TEXT_NOTE], search: normalizedSearch, limit: RELAY_RESULT_LIMIT });
			if (!activeTag) {
				filters.push({
					kinds: [NOSTR_KINDS.TEXT_NOTE],
					'#t': [normalizedSearch],
					limit: RELAY_RESULT_LIMIT
				});
			}
		}
		return filters;
	}

	async function buildRelayFeed(events: Event[]) {
		const noteEvents = uniqueTimelineEvents(events);
		const nextNotes = noteEvents.map(toFeedNote);
		const noteIds = nextNotes.map((note) => note.id);
		const activity = noteIds.length
			? await queryPrimaryFirst([
					{ kinds: [NOSTR_KINDS.REACTION, NOSTR_KINDS.ZAP], '#e': noteIds, limit: 1000 }
				])
			: [];
		return applyActivityToNotes(nextNotes, activity, identity.current?.pk);
	}

	async function applyRelayFeed(events: Event[], signature: string, status: 'primary' | 'merged') {
		const nextNotes = await buildRelayFeed(events);
		if (relayFeedSignature !== signature) return;
		relayFeedNotes = nextNotes;
		relayFeedStatus = status;
		relayFeedMerging = false;
		profiles.ensure(nextNotes.map((note) => note.pubkey));
	}

	async function loadRelayFeed() {
		const signature = `${activeTag}|${searchMode}|${normalizedSearch}`;
		const filters = relayFilters();
		if (!filters.length) return;
		relayFeedSignature = signature;
		relayFeedLoading = true;
		relayFeedMerging = true;
		relayFeedStatus = 'primary';
		try {
			const events = await queryPrimaryFirst(filters, {
				onSecondary: (mergedEvents) => {
					if (relayFeedSignature !== signature) return;
					void applyRelayFeed(mergedEvents, signature, 'merged');
				}
			});
			if (relayFeedSignature !== signature) return;
			await applyRelayFeed(events, signature, 'primary');
		} catch (e) {
			if (relayFeedSignature === signature) {
				relayFeedNotes = [];
				toasts.error((e as Error).message || 'Could not load relay feed');
			}
		} finally {
			if (relayFeedSignature === signature) relayFeedLoading = false;
		}
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
		if (useRelayFeed) return;
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

	$effect(() => {
		if (activeTag) {
			searchMode = 'relay';
			return;
		}
		if (!normalizedSearch && searchMode === 'relay') searchMode = 'local';
	});

	$effect(() => {
		if (!useRelayFeed) {
			relayFeedNotes = [];
			relayFeedLoading = false;
			relayFeedMerging = false;
			relayFeedStatus = 'idle';
			relayFeedSignature = '';
			return;
		}
		void loadRelayFeed();
	});
</script>

<svelte:head><title>Feed · BitOS</title></svelte:head>

<div class="flex h-full">
	<!-- Center feed -->
	<div bind:this={feedScroller} class="flex-1 overflow-y-auto" onscroll={handleFeedScroll}>
		<div class="mx-auto max-w-[640px] px-5 py-6">
			<!-- Header -->
			<div class="relative z-30 mb-5 flex flex-wrap items-start justify-between gap-3">
				<div>
					<h1 class="font-display text-[32px] leading-none font-extrabold tracking-tight">
						Discover
					</h1>
					<p class="mt-1.5 text-[12px] text-[var(--ui-text-muted)]">
						Fresh notes from the global Nostr feed
					</p>
				</div>
				<div class="relative z-40 flex shrink-0 gap-2">
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
							class="absolute top-12 right-0 z-50 w-56 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] p-1.5 shadow-[var(--shadow-pop)]"
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

			{#if searchOpen}
				<div class="mb-4 flex flex-col gap-2">
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
					<div class="flex items-center gap-2">
						<button
							type="button"
							onclick={() => (searchMode = 'local')}
							class="rounded-full px-3 py-1.5 text-[11px] font-bold transition {searchMode === 'local'
								? 'bg-primary-500 text-white'
								: 'border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] text-[var(--ui-text-muted)] hover:text-primary-500'}"
						>
							Quick filter
						</button>
						<button
							type="button"
							onclick={() => (searchMode = 'relay')}
							disabled={!normalizedSearch && !activeTag}
							class="rounded-full px-3 py-1.5 text-[11px] font-bold transition {searchMode === 'relay'
								? 'bg-primary-500 text-white'
								: 'border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] text-[var(--ui-text-muted)] hover:text-primary-500 disabled:cursor-default disabled:opacity-50'}"
						>
							Relay search
						</button>
						<span class="text-[11px] text-[var(--ui-text-dimmed)]">
							{searchMode === 'local'
								? 'Filters only the notes already loaded.'
								: 'Queries the primary relay first, then merges others.'}
						</span>
					</div>
				</div>
			{/if}

			<!-- Sticky feed tabs: For you · Following · pinned hashtags -->
			<div
				class="sticky top-0 z-10 -mx-5 mb-4 border-b border-[var(--ui-border-muted)] bg-[color-mix(in_oklab,var(--ui-bg)_82%,transparent)] px-5 backdrop-blur-md"
			>
				<div
					class="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
				>
					<a
						href="/"
						onclick={() => (feedMode = 'foryou')}
						class="relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3.5 py-3 text-[13.5px] font-bold transition-colors {!activeTag &&
						feedMode === 'foryou'
							? 'text-primary-600'
							: 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
						aria-current={!activeTag && feedMode === 'foryou' ? 'page' : undefined}
					>
						<Icon name="i-lucide-sparkles" class="size-4" />
						For you
						<span
							class="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary-500 transition-opacity {!activeTag &&
							feedMode === 'foryou'
								? 'opacity-100'
								: 'opacity-0'}"
						></span>
					</a>
					<a
						href="/"
						onclick={() => (feedMode = 'following')}
						class="relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3.5 py-3 text-[13.5px] font-bold transition-colors {!activeTag &&
						feedMode === 'following'
							? 'text-primary-600'
							: 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
						aria-current={!activeTag && feedMode === 'following' ? 'page' : undefined}
					>
						<Icon name="i-lucide-users" class="size-4" />
						Following
						<span
							class="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary-500 transition-opacity {!activeTag &&
							feedMode === 'following'
								? 'opacity-100'
								: 'opacity-0'}"
						></span>
					</a>
					{#if pinnedTags.length}
						<span
							class="mx-1 h-5 w-px shrink-0 self-center bg-[var(--ui-border-muted)]"
							aria-hidden="true"
						></span>
						{#each pinnedTags as tag (tag)}
							<a
								href={`/?tag=${encodeURIComponent(tag)}`}
								class="relative flex shrink-0 items-center whitespace-nowrap px-3 py-3 text-[13px] font-semibold transition-colors {activeTag === tag
									? 'text-primary-600'
									: 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
								aria-current={activeTag === tag ? 'page' : undefined}
							>
								#{tag}
								<span
									class="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary-500 transition-opacity {activeTag === tag
										? 'opacity-100'
										: 'opacity-0'}"
								></span>
							</a>
						{/each}
					{/if}
					<a
						href="/discover"
						class="ml-auto flex shrink-0 items-center gap-1 self-center rounded-full px-2.5 py-1 text-[11px] font-bold text-[var(--ui-text-dimmed)] transition hover:bg-[var(--ui-bg-muted)] hover:text-primary-500"
						title="Find & pin more tags"
					>
						<Icon name="i-lucide-hash" class="size-3.5" />
						Tags
					</a>
				</div>
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
						<span class="rounded-full border border-primary-500/15 bg-white/70 px-2.5 py-1 text-[11px] font-bold text-primary-600">
							{#if useRelayFeed}
								{relayFeedMerging || relayFeedLoading
									? 'Primary relay · merging others…'
									: relayFeedStatus === 'merged'
										? 'Merged relay results'
										: 'Primary relay results'}
							{:else if normalizedSearch}
								Quick local results
							{:else}
								Live timeline
							{/if}
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
								feedMode = 'foryou';
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
				<div class="pointer-events-none sticky top-16 z-20 mb-4 flex justify-center">
					<button
						type="button"
						onclick={showNewNotes}
						class="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-primary-500/20 bg-primary-500 px-4 py-2 text-[13px] font-bold text-white shadow-[var(--glow-primary)] transition hover:bg-primary-600 active:scale-95"
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
						<Icon name={followingOnly ? 'i-lucide-users' : 'i-lucide-filter-x'} class="size-7" />
					</div>
					<div>
						<p class="text-[15px] font-semibold">{followingOnly ? 'Nothing from your follows yet' : 'No matching notes'}</p>
						<p class="mt-1 text-[13px] text-[var(--ui-text-muted)]">
							{useRelayFeed
								? 'Your relays did not return matching notes yet. Try another tag or search term.'
								: followingOnly
									? 'Follow people from Discover or their profiles to fill this tab.'
									: 'Try a different filter, hashtag, or search term.'}
						</p>
					</div>
					{#if followingOnly}
						<a
							href="/discover"
							class="rounded-full bg-primary-500 px-4 py-2 text-[12px] font-bold text-white transition hover:bg-primary-600"
						>
							Explore Discover
						</a>
					{:else}
						<a
							href="/"
							onclick={() => {
								activeFilters = ['all'];
								searchQuery = '';
								feedMode = 'foryou';
							}}
							class="rounded-full bg-primary-500 px-4 py-2 text-[12px] font-bold text-white transition hover:bg-primary-600"
						>
							Show all
						</a>
					{/if}
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
