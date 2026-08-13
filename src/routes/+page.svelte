<script lang="ts">
	import { page } from '$app/state';
	import type { Filter } from 'nostr-tools/filter';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import StoriesBar from '$lib/components/feed/StoriesBar.svelte';
	import Composer from '$lib/components/feed/Composer.svelte';
	import PostCard from '$lib/components/feed/PostCard.svelte';
	import TrendingRail from '$lib/components/feed/TrendingRail.svelte';
	import ZapLiveStrip from '$lib/components/feed/ZapLiveStrip.svelte';
	import { feed } from '$lib/nostr/feed.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { queryParallelProgressive, queryPrimaryFirst, queryUrls } from '$lib/nostr/pool';
	import { DISCOVERY_RELAY_URLS, relays } from '$lib/nostr/relays.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { contacts } from '$lib/nostr/contacts.svelte';
	import { NOSTR_KINDS, type Event, type FeedNote } from '$lib/nostr/types';
	import { toFeedNote } from '$lib/nostr/feed-note';
	import { applyActivityToNotes } from '$lib/nostr/zaps';
	import { feedPreferences } from '$lib/stores/feed-preferences.svelte';
	import {
		algorithmPreferences,
		buildScoringContext,
		rankNotesWithBreakdown,
		interactionProfile
	} from '$lib/algorithm';
	import { detectPreset } from '$lib/algorithm/presets';
	import type { ScoreBreakdown } from '$lib/algorithm';
	import RankExplainer from '$lib/components/feed/RankExplainer.svelte';
	import { popovers } from '$lib/stores/popovers.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';

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
	const RELAY_RESULT_LIMIT = 120;

	let feedScroller: HTMLDivElement | undefined = $state();
	const filterOpen = $derived(popovers.isOpen(filterMenuId));
	let activeFilters = $state<FeedFilter[]>(['all']);
	let feedMode = $state<'foryou' | 'following'>('foryou');
	let searchQuery = $state('');
	let searchOpen = $state(false);
	let renderedCount = $state(INITIAL_RENDER_COUNT);
	let promotedNewIds = $state<Set<string>>(new Set());
	let promotedNewNotes = $state<Map<string, FeedNote>>(new Map());
	let lastViewSignature = $state('');
	let relayFeedNotes = $state<FeedNote[]>([]);
	let relayFeedLoading = $state(false);
	let relayFeedMerging = $state(false);
	let relayFeedStatus = $state<'idle' | 'primary' | 'merged'>('idle');
	let relayFeedSignature = $state('');
	let relayFeedRevision = 0;
	let relayFeedHasResult = $state(false);
	let discoveryNotes = $state<FeedNote[]>([]);
	let discoverySignature = $state('');
	let discoveryRevision = 0;
	const activeTag = $derived((page.url.searchParams.get('tag') ?? '').trim().toLowerCase());
	const normalizedSearch = $derived(searchQuery.trim().toLowerCase());
	const useRelayFeed = $derived(!!activeTag || normalizedSearch.length >= 2);
	// Keep local matches visible while the remote search is in flight.
	const discoveryActive = $derived(
		algorithmPreferences.relayDiscovery.feed && feedMode === 'foryou' && !useRelayFeed
	);
	const baseNotes = $derived.by(() => {
		const candidates =
			useRelayFeed && relayFeedHasResult
				? relayFeedNotes
				: discoveryActive
					? mergeDiscoveryNotes(feed.notes, discoveryNotes)
					: feed.notes;
		const seen = new Set<string>();
		return candidates.filter((note) => {
			if (seen.has(note.id)) return false;
			seen.add(note.id);
			return true;
		});
	});
	const selectedFilterOptions = $derived(
		filterOptions.filter((option) => activeFilters.includes(option.key))
	);
	const activeFilterLabel = $derived(
		selectedFilterOptions.length
			? selectedFilterOptions.map((option) => option.label).join(', ')
			: 'All'
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
	// Algorithm ranking — only on the "For you" timeline (not search/tag/following).
	const algorithmActive = $derived(
		algorithmPreferences.isEnabled('feed') &&
			feedMode === 'foryou' &&
			!useRelayFeed &&
			!followingOnly
	);
	// Smooth ranking: instead of re-sorting on *every* reaction arrival (which
	// makes the post you're reading jump), recompute on a short debounce. Hard
	// triggers (reveal, loadMore, settings change) run immediately.
	let rankedFeed = $state<{ notes: FeedNote[]; breakdown: Map<string, ScoreBreakdown> }>({
		notes: [],
		breakdown: new Map()
	});
	let rankToken = 0;
	let explainerBreakdown = $state<ScoreBreakdown | null>(null);
	let explainerOpen = $state(false);

	function computeRanking(candidates: FeedNote[]) {
		if (!algorithmActive || !candidates.length) {
			rankedFeed = { notes: candidates, breakdown: new Map() };
			return;
		}
		const ctx = buildScoringContext('feed', candidates);
		const nextRanking = rankNotesWithBreakdown('feed', candidates, ctx);

		// Keep cards that are already on screen in the current window when an
		// interaction changes the ranking inputs. A like updates the note and a
		// reply adds another candidate; allowing either update to immediately
		// reorder the first page makes the card the user just acted on appear to
		// disappear. New candidates still participate in ranking after the stable
		// visible window.
		const visibleIds = new Set(rankedFeed.notes.slice(0, renderedCount).map((note) => note.id));
		if (visibleIds.size) {
			// Keep the current order for cards already on screen, but take the
			// note objects from the new ranking. The feed store updates reactions
			// optimistically; reusing rankedFeed's old objects here would restore
			// the pre-like state after every ranking pass.
			const nextById = new Map(nextRanking.notes.map((note) => [note.id, note]));
			const stableVisible = rankedFeed.notes
				.filter((note) => visibleIds.has(note.id) && nextById.has(note.id))
				.map((note) => nextById.get(note.id)!);
			const stableIds = new Set(stableVisible.map((note) => note.id));
			nextRanking.notes = [
				...stableVisible,
				...nextRanking.notes.filter((note) => !stableIds.has(note.id))
			];
		}

		rankedFeed = nextRanking;
	}

	function scheduleRank(reason: 'hard' | 'soft' = 'soft') {
		const token = ++rankToken;
		const delay = reason === 'hard' || !algorithmPreferences.smoothRanking ? 0 : 600;
		const handle = window.setTimeout(() => {
			if (token !== rankToken) return; // superseded by a newer change
			computeRanking(filteredNotes);
		}, delay);
		return () => window.clearTimeout(handle);
	}

	// Recompute when the candidate pool, config, profile, or freshness change.
	$effect(() => {
		// Touch reactive deps so this effect re-runs on each:
		void filteredNotes.length;
		void filteredNotes;
		void algorithmPreferences.config.feed;
		void algorithmPreferences.recencyHalfLifeSeconds;
		void interactionProfile.version;
		if (!algorithmActive) {
			rankedFeed = { notes: filteredNotes, breakdown: new Map() };
			return;
		}
		const cancel = scheduleRank('soft');
		return cancel;
	});

	// Hard (immediate) re-rank when the user explicitly reveals new notes,
	// changes a setting, or refreshes the WoT graph.
	$effect(() => {
		void algorithmPreferences.smoothRanking;
		void algorithmPreferences.wotVersion;
	});

	const rankedNotes = $derived(rankedFeed.notes);
	const rankedNotesWithoutNew = $derived(
		rankedNotes.filter((note) => !promotedNewIds.has(note.id))
	);
	const scoreBreakdown = $derived(rankedFeed.breakdown);
	const feedPresetLabel = $derived.by(() => {
		if (!algorithmActive) return '';
		const id = detectPreset(algorithmPreferences.config.feed);
		if (id === 'custom') return 'Custom mix';
		return `${id[0].toUpperCase()}${id.slice(1)}`;
	});
	const renderedNotes = $derived(rankedNotesWithoutNew.slice(0, renderedCount));
	const hasMoreRenderedNotes = $derived(renderedCount < rankedNotesWithoutNew.length);
	const newlyRevealedNotes = $derived(
		filteredNotes
			.map((note) => promotedNewNotes.get(note.id) ?? note)
			.filter((note) => promotedNewIds.has(note.id))
			.sort((a, b) => b.createdAt - a.createdAt)
	);
	const pendingAuthors = $derived.by(() => {
		const seen: Record<string, boolean> = {};
		const unique: { pubkey: string; name: string; picture?: string | null }[] = [];
		for (const note of feed.pendingNotes) {
			if (seen[note.pubkey]) continue;
			seen[note.pubkey] = true;
			const profile = profiles.get(note.pubkey);
			unique.push({
				pubkey: note.pubkey,
				name: profile?.display_name || profile?.name || '',
				picture: profile?.picture
			});
			if (unique.length >= 4) break;
		}
		return unique;
	});
	const pendingAuthorCount = $derived.by(() => {
		const seen: Record<string, boolean> = {};
		let count = 0;
		for (const note of feed.pendingNotes) {
			if (seen[note.pubkey]) continue;
			seen[note.pubkey] = true;
			count += 1;
		}
		return count;
	});
	const pendingAuthorSummary = $derived.by(() => {
		if (!pendingAuthorCount) return '';
		if (pendingAuthorCount === 1) {
			const author = pendingAuthors[0];
			return author?.name ? `from ${author.name}` : 'from 1 person';
		}
		return `from ${pendingAuthorCount} people`;
	});

	function renderMoreNotes() {
		if (!hasMoreRenderedNotes) return;
		renderedCount = Math.min(rankedNotes.length, renderedCount + RENDER_BATCH_SIZE);
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

	function uniqueTimelineEvents(events: Event[]) {
		const seen: Record<string, boolean> = {};
		return events
			.filter((event) => {
				if (event.kind !== NOSTR_KINDS.TEXT_NOTE || seen[event.id]) return false;
				seen[event.id] = true;
				return true;
			})
			.sort((a, b) => b.created_at - a.created_at);
	}

	function mergeDiscoveryNotes(configured: FeedNote[], discovered: FeedNote[]) {
		const seen = new Set<string>();
		const merged: FeedNote[] = [];
		for (const note of [...configured, ...discovered]) {
			if (seen.has(note.id)) continue;
			seen.add(note.id);
			merged.push(note);
		}
		return merged.sort((a, b) => b.createdAt - a.createdAt);
	}

	function relayFilters(): Filter[] {
		const filters: Filter[] = [];
		if (activeTag) {
			filters.push({
				kinds: [NOSTR_KINDS.TEXT_NOTE],
				'#t': [activeTag],
				limit: RELAY_RESULT_LIMIT
			});
		}
		if (normalizedSearch) {
			filters.push({
				kinds: [NOSTR_KINDS.TEXT_NOTE],
				search: normalizedSearch,
				limit: RELAY_RESULT_LIMIT
			});
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

	async function applyRelayFeed(
		events: Event[],
		signature: string,
		status: 'primary' | 'merged',
		revision: number
	) {
		const nextNotes = await buildRelayFeed(events);
		if (relayFeedSignature !== signature || revision !== relayFeedRevision) return;
		relayFeedNotes = nextNotes;
		relayFeedStatus = status;
		relayFeedMerging = false;
		profiles.ensure(nextNotes.map((note) => note.pubkey));
	}

	async function loadRelayFeed() {
		const signature = `${activeTag}|${normalizedSearch}`;
		const filters = relayFilters();
		if (!filters.length) return;
		relayFeedSignature = signature;
		relayFeedHasResult = false;
		relayFeedLoading = true;
		relayFeedMerging = true;
		relayFeedStatus = 'primary';
		relayFeedRevision = 0;
		try {
			const events = await queryParallelProgressive(filters, {
				onPrimary: (primaryEvents) => {
					relayFeedRevision = 1;
					relayFeedHasResult = true;
					void applyRelayFeed(primaryEvents, signature, 'primary', 1);
				},
				onSecondary: (mergedEvents) => {
					if (relayFeedSignature !== signature) return;
					relayFeedRevision = 2;
					void applyRelayFeed(mergedEvents, signature, 'merged', 2);
				}
			});
			if (relayFeedSignature !== signature) return;
			// The callback applies the primary batch. This fallback also covers
			// callers/environments where the callback is unavailable.
			if (relayFeedRevision === 0) {
				relayFeedRevision = 1;
				await applyRelayFeed(events, signature, 'primary', 1);
			}
		} catch (e) {
			if (relayFeedSignature === signature) {
				relayFeedNotes = [];
				relayFeedHasResult = true;
				toasts.error((e as Error).message || 'Could not load relay feed');
			}
		} finally {
			if (relayFeedSignature === signature) relayFeedLoading = false;
		}
	}

	async function loadDiscoveryFeed() {
		const urls = DISCOVERY_RELAY_URLS.filter((url) => !relays.urls.includes(url));
		if (!urls.length) {
			discoverySignature = '';
			discoveryRevision += 1;
			discoveryNotes = [];
			return;
		}
		const signature = urls.join('|');
		discoverySignature = signature;
		discoveryRevision += 1;
		const revision = discoveryRevision;
		try {
			const events = await queryUrls(urls, [
				{ kinds: [NOSTR_KINDS.TEXT_NOTE], limit: RELAY_RESULT_LIMIT }
			]);
			if (discoverySignature !== signature || revision !== discoveryRevision) return;
			const notes = uniqueTimelineEvents(events).map((event) => ({
				...toFeedNote(event),
				source: 'discovery' as const
			}));
			const ids = notes.map((note) => note.id);
			const activity = ids.length
				? await queryPrimaryFirst([
						{ kinds: [NOSTR_KINDS.REACTION, NOSTR_KINDS.ZAP], '#e': ids, limit: 1000 }
					])
				: [];
			if (discoverySignature !== signature || revision !== discoveryRevision) return;
			discoveryNotes = applyActivityToNotes(notes, activity, identity.current?.pk);
			profiles.ensure(notes.map((note) => note.pubkey));
		} catch {
			// Discovery is optional. The configured relay feed remains unaffected.
		} finally {
			// Discovery is intentionally best-effort and has no blocking loading UI.
		}
	}

	function showNewNotes() {
		const incomingIds = new Set(feed.pendingNotes.map((note) => note.id));
		const count = feed.revealPending();
		if (!count) return;
		promotedNewIds = new Set([...promotedNewIds, ...incomingIds]);
		promotedNewNotes = new Map([
			...promotedNewNotes,
			...[...incomingIds]
				.map((id) => feed.getNote(id))
				.filter((note): note is FeedNote => !!note)
				.map((note) => [note.id, note] as const)
		]);
		renderedCount = INITIAL_RENDER_COUNT;
		// Reveal merges new notes into the candidate pool → re-rank immediately.
		computeRanking(filteredNotes);
		rankToken++; // cancel any pending soft re-rank
		requestAnimationFrame(() => {
			feedScroller?.scrollTo({ top: 0, behavior: 'smooth' });
		});
	}

	function dismissNewNotes() {
		promotedNewIds = new Set();
		promotedNewNotes = new Map();
		renderedCount = INITIAL_RENDER_COUNT;
	}

	function loadMoreNotes() {
		void feed.loadMore().then(() => {
			// Older notes expanded the pool → re-rank immediately so the fresh mix shows.
			computeRanking(filteredNotes);
			rankToken++;
		});
	}

	/** Record a positive interaction into the persistent profile so affinity &
	 *  topics adapt. */
	function handleInteract(interactedNote: FeedNote, kind: 'react' | 'save', active: boolean) {
		if (active) interactionProfile.recordInteraction(interactedNote, kind === 'save' ? 0.8 : 1);
		else interactionProfile.recordInteractionRemoved(interactedNote, kind === 'save' ? 0.8 : 1);
	}

	function handleNoteChange(next: FeedNote) {
		if (promotedNewIds.has(next.id)) {
			promotedNewNotes = new Map(promotedNewNotes).set(next.id, next);
		}
		if (next.source === 'discovery') {
			discoveryNotes = discoveryNotes.map((note) => (note.id === next.id ? next : note));
			return;
		}
		if (relayFeedNotes.some((note) => note.id === next.id)) {
			relayFeedNotes = relayFeedNotes.map((note) => (note.id === next.id ? next : note));
		} else {
			feed.upsertNote(next);
			// Keep the ranked snapshot's card data live while smooth ranking is
			// waiting to run. This updates the heart/count immediately without
			// allowing an interaction to reorder the visible cards.
			if (rankedFeed.notes.some((note) => note.id === next.id)) {
				rankedFeed = {
					...rankedFeed,
					notes: rankedFeed.notes.map((note) => (note.id === next.id ? next : note))
				};
			}
		}
	}

	function openExplainer(note: FeedNote) {
		const b = scoreBreakdown.get(note.id);
		if (!b) return;
		explainerBreakdown = b;
		explainerOpen = true;
	}

	const RANK_TAG_COLORS: Record<string, string> = {
		recency: '#3b82f6',
		engagement: '#f97316',
		zaps: '#eab308',
		affinity: '#ec4899',
		wot: '#22c55e',
		novelty: '#14b8a6'
	};
	const RANK_TAG_ICONS: Record<string, string> = {
		recency: 'i-lucide-clock',
		engagement: 'i-lucide-flame',
		zaps: 'i-lucide-zap',
		affinity: 'i-lucide-heart-handshake',
		wot: 'i-lucide-shield-check',
		novelty: 'i-lucide-shuffle'
	};

	/** Build the "why am I seeing this" chip from a note's score breakdown. */
	function rankTagFor(note: FeedNote): { label: string; icon: string; color: string } | undefined {
		if (!algorithmActive) return undefined;
		const b = scoreBreakdown.get(note.id);
		if (!b?.topSignal) return undefined;
		// Only surface a chip for the notes that actually ranked into the top window —
		// showing it on every post would be noise.
		return {
			label: b.topSignal.label,
			icon: RANK_TAG_ICONS[b.topSignal.signalId] ?? 'i-lucide-sparkles',
			color: RANK_TAG_COLORS[b.topSignal.signalId] ?? '#94a3b8'
		};
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

	function handleNoteHide(id: string) {
		discoveryNotes = discoveryNotes.filter((note) => note.id !== id);
	}

	$effect(() => {
		feedPreferences.load();
		const signature = `${activeFilters.slice().sort().join(',')}:${activeTag}:${normalizedSearch}`;
		if (signature === lastViewSignature) return;
		lastViewSignature = signature;
		renderedCount = INITIAL_RENDER_COUNT;
	});

	$effect(() => {
		void algorithmPreferences.relayDiscovery.feed;
		void discoveryActive;
		void relays.urls;
		if (!discoveryActive) {
			discoveryNotes = [];
			discoverySignature = '';
			discoveryRevision += 1;
			return;
		}
		void loadDiscoveryFeed();
	});

	$effect(() => {
		if (renderedNotes.length) profiles.ensure(renderedNotes.map((n) => n.pubkey));
	});

	$effect(() => {
		if (!useRelayFeed) {
			relayFeedNotes = [];
			relayFeedHasResult = false;
			relayFeedLoading = false;
			relayFeedMerging = false;
			relayFeedStatus = 'idle';
			relayFeedSignature = '';
			return;
		}
		if (activeTag) {
			void loadRelayFeed();
			return;
		}
		const timer = window.setTimeout(() => void loadRelayFeed(), 250);
		return () => window.clearTimeout(timer);
	});
</script>

<svelte:head><title>Feed · BitOS</title></svelte:head>

<div class="flex h-full">
	<!-- Center feed -->
	<div bind:this={feedScroller} class="min-w-0 flex-1 overflow-y-auto" onscroll={handleFeedScroll}>
		<div class="page-container page-container--feed feed-timeline py-6">
			<!-- Header -->
			<div class="relative z-30 mb-5 flex flex-wrap items-start justify-between gap-3">
				<div>
					<h1 class="font-display text-[32px] leading-none font-extrabold tracking-tight">
						Home
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
						class="icon-btn size-10"
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
						class="icon-btn size-10 {searchOpen || normalizedSearch ? 'is-active' : ''}"
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
						class="icon-btn size-10 {!activeFilters.includes('all') || activeFilters.length > 1
							? 'is-active'
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
								class="w-full rounded-xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] py-2.5 pr-3 pl-9 text-[13px] text-[var(--ui-text)] transition outline-none focus:border-primary-500/40 focus:ring-2 focus:ring-primary-500/15"
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
					<div class="flex items-center gap-1.5 text-[11px] text-[var(--ui-text-dimmed)]">
						<Icon name="i-lucide-zap" class="size-3.5 text-primary-500" />
						<span>Instant results, then more from your relays</span>
					</div>
				</div>
			{/if}

			<!-- Sticky feed tabs: For you · Following · pinned hashtags -->
			<div
				class="sticky top-0 z-10 -mx-[clamp(1rem,3vw,1.5rem)] mb-4 border-b border-[var(--ui-border-muted)] bg-[color-mix(in_oklab,var(--ui-bg)_82%,transparent)] px-[clamp(1rem,3vw,1.5rem)] backdrop-blur-md"
			>
				<div
					class="flex [scrollbar-width:none] items-center gap-1 overflow-x-auto [&::-webkit-scrollbar]:hidden"
				>
					<a
						href="/"
						onclick={() => (feedMode = 'foryou')}
						class="relative flex shrink-0 items-center gap-1.5 px-3.5 py-3 text-[13.5px] font-bold whitespace-nowrap transition-colors {!activeTag &&
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
						class="relative flex shrink-0 items-center gap-1.5 px-3.5 py-3 text-[13.5px] font-bold whitespace-nowrap transition-colors {!activeTag &&
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
								class="relative flex shrink-0 items-center px-3 py-3 text-[13px] font-semibold whitespace-nowrap transition-colors {activeTag ===
								tag
									? 'text-primary-600'
									: 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
								aria-current={activeTag === tag ? 'page' : undefined}
							>
								#{tag}
								<span
									class="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary-500 transition-opacity {activeTag ===
									tag
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
						<span
							class="rounded-full border border-primary-500/15 bg-white/70 px-2.5 py-1 text-[11px] font-bold text-primary-600"
						>
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

			{#if identity.current}
				<!-- Stories -->
				<div class="mb-4">
					<StoriesBar />
				</div>

				<!-- Composer -->
				<div class="feed-composer mb-4">
					<Composer />
				</div>
			{:else}
				<div class="mb-4 rounded-2xl border border-primary-500/15 bg-primary-500/10 px-4 py-3">
					<div class="flex flex-wrap items-center justify-between gap-3">
						<div>
							<p class="text-[14px] font-bold text-primary-600">Browsing BitOS as a guest</p>
							<p class="mt-1 text-[12px] text-[var(--ui-text-muted)]">
								Public notes stay open to everyone. Create or import a key when you want to post,
								reply, react, bookmark, or message.
							</p>
						</div>
						<a
							href="/welcome"
							class="rounded-full bg-primary-500 px-4 py-2 text-[12px] font-bold text-white transition hover:bg-primary-600"
						>
							Create or import a key
						</a>
					</div>
				</div>
			{/if}

			{#if feed.pendingCount}
				<div class="pointer-events-none sticky top-16 z-20 mb-4 flex justify-center">
					<button
						type="button"
						onclick={showNewNotes}
						class="pointer-events-auto inline-flex items-center gap-3 rounded-full border border-primary-500/20 bg-primary-500 px-3 py-2 text-left text-white shadow-[var(--glow-primary)] transition hover:bg-primary-600 active:scale-95 sm:px-4"
					>
						<Icon name="i-lucide-arrow-up" class="size-4" />
						{#if pendingAuthors.length}
							<div class="flex items-center gap-2.5">
								<div class="flex -space-x-2">
									{#each pendingAuthors as author, index (author.pubkey)}
										<div
											class="rounded-full ring-2 ring-primary-500/40 {index === 0
												? 'ring-white/80'
												: 'ring-primary-500/30'} {index === 3 ? 'hidden sm:block' : ''}"
										>
											<Avatar
												pubkey={author.pubkey}
												name={author.name}
												picture={author.picture}
												size={24}
											/>
										</div>
									{/each}
								</div>
								<div class="flex flex-col leading-none">
									<span class="text-[13px] font-bold">
										{feed.pendingCount} new {feed.pendingCount === 1 ? 'note' : 'notes'}
									</span>
									<span class="text-[11px] font-medium text-white/80">{pendingAuthorSummary}</span>
								</div>
							</div>
						{:else}
							<span class="text-[13px] font-bold">
								{feed.pendingCount} new {feed.pendingCount === 1 ? 'note' : 'notes'}
							</span>
						{/if}
					</button>
				</div>
			{/if}

			{#if newlyRevealedNotes.length && !useRelayFeed}
				<section class="-mx-[clamp(1rem,3vw,1.5rem)] border-y border-primary-500/20 bg-primary-500/5 py-3">
					<div class="mb-0 flex items-center justify-between gap-3 px-1">
						<div class="flex min-w-0 items-center gap-2">
							<Icon name="i-lucide-sparkles" class="size-4 shrink-0 text-primary-500" />
							<div class="min-w-0">
								<p class="truncate text-[13px] font-bold text-primary-600">New posts · just now</p>
								<p class="text-[11px] text-[var(--ui-text-muted)]">
									{newlyRevealedNotes.length}
									{newlyRevealedNotes.length === 1 ? 'post' : 'posts'} from your live feed
								</p>
							</div>
						</div>
						<button
							type="button"
							onclick={dismissNewNotes}
							class="shrink-0 rounded-lg px-2 py-1 text-[11px] font-bold text-primary-600 transition hover:bg-primary-500/10"
						>
							Continue to For you
						</button>
					</div>
					<div>
						{#each newlyRevealedNotes as note, i (note.id)}
							<PostCard
								{note}
								index={i}
								onInteract={handleInteract}
								onNoteChange={handleNoteChange}
								onNoteHide={handleNoteHide}
							/>
						{/each}
					</div>
				</section>
			{/if}

			<ZapLiveStrip />

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
						<p class="text-[15px] font-semibold">
							{followingOnly ? 'Nothing from your follows yet' : 'No matching notes'}
						</p>
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
				{#if algorithmActive && renderedNotes.length > 0}
					<div
						class="-mx-[clamp(1rem,3vw,1.5rem)] flex flex-wrap items-center justify-between gap-2 border-b border-primary-500/15 bg-primary-500/5 px-[clamp(1rem,3vw,1.5rem)] py-2"
					>
						<div class="flex min-w-0 items-center gap-2 text-[12px] font-semibold text-primary-600">
							<Icon name="i-lucide-wand-sparkles" class="size-4 shrink-0" />
							<span class="truncate">Ranked for you · {feedPresetLabel}</span>
						</div>
						<a
							href="/settings/algorithm"
							class="shrink-0 rounded-full px-2 py-1 text-[11px] font-bold text-primary-600 transition hover:bg-primary-500/10"
						>
							<Icon name="i-lucide-sliders-horizontal" class="mr-1 inline size-3.5" />Tune
						</a>
					</div>
				{/if}
				<div class="feed-note-list space-y-5">
					{#each renderedNotes as note, i (note.id)}
						<PostCard
							{note}
							index={i}
							onNoteChange={handleNoteChange}
							onNoteHide={handleNoteHide}
							rankTag={rankTagFor(note)}
							onExplain={() => openExplainer(note)}
							onInteract={handleInteract}
						/>
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

	<!-- Home-only trending rail. Other pages keep the centered single-column layout. -->
	<TrendingRail />
</div>

<RankExplainer bind:open={explainerOpen} breakdown={explainerBreakdown} />
