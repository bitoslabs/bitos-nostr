<script lang="ts">
	/**
	 * Unified premium profile surface used by both `/profile` (the signed-in
	 * user) and `/profile/[pubkey]` (any account). Consolidates the banner +
	 * identity hero, a unified stat bar, posting-activity heatmap, highlights,
	 * a sticky tab bar with a scroll-reveal mini identity, an Instagram-style
	 * media gallery, skeleton loaders and refined empty states.
	 */
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { goto } from '$app/navigation';
	import { npubEncode } from 'nostr-tools/nip19';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import PostCard from '$lib/components/feed/PostCard.svelte';
	import StoryRing from '$lib/components/feed/StoryRing.svelte';
	import ProfileActionMenu from '$lib/components/profile/ProfileActionMenu.svelte';
	import ProfileStats from '$lib/components/profile/ProfileStats.svelte';
	import ActivityHeatmap from '$lib/components/profile/ActivityHeatmap.svelte';
	import MediaGallery from '$lib/components/profile/MediaGallery.svelte';
	import ProfileBitzGrid from '$lib/components/profile/ProfileBitzGrid.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { contacts } from '$lib/nostr/contacts.svelte';
	import { queryPrimaryFirst } from '$lib/nostr/pool';
	import { relays } from '$lib/nostr/relays.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { NOSTR_KINDS, type FeedNote } from '$lib/nostr/types';
	import { toFeedNote } from '$lib/nostr/feed-note';
	import { BITZ_MEDIA_KINDS, latestAddressableEvents, parseBitz } from '$lib/nostr/bitz-codec';
	import { toReelNote, type ReelNote } from '$lib/stores/bitz-session.svelte';
	import { applyActivityToNotes } from '$lib/nostr/zaps';
	import { receiptToZapEntry, type ZapEntry } from '$lib/nostr/wallet.svelte';
	import ZapLedgerRow from '$lib/components/zaps/ZapLedgerRow.svelte';
	import { blocks } from '$lib/stores/blocks.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { shortKey, timeFull } from '$lib/utils/format';
	import { extractProfileMedia, profileCompletion, compactSats } from '$lib/utils/profile-stats';

	let { pubkey }: { pubkey: string } = $props();

	const NOTE_PAGE_LIMIT = 30;
	const hashtagPattern = /(?:^|\s)#([\p{L}\p{N}_-]{2,60})/gu;
	type Tab = 'posts' | 'replies' | 'media' | 'zaps' | 'pinned' | 'liked' | 'reposts' | 'bitz';

	const profile = $derived(pubkey ? profiles.get(pubkey) : undefined);
	const displayName = $derived(
		profile?.display_name || profile?.name || (pubkey ? shortKey(pubkey) : 'Profile')
	);
	const npub = $derived(pubkey ? npubEncode(pubkey) : '');
	const lightning = $derived(profile?.lud16 || profile?.lud06 || '');
	const isMe = $derived(!!pubkey && identity.current?.pk === pubkey);
	const isFollowing = $derived(!!pubkey && contacts.isFollowing(pubkey));
	const isBlocked = $derived(!!pubkey && blocks.has(pubkey));
	const normalizedWebsite = $derived(
		profile?.website
			? profile.website.startsWith('http')
				? profile.website
				: `https://${profile.website}`
			: ''
	);

	let loading = $state(true);
	let bannerFailed = $state(false);
	let loadingMore = $state(false);
	let hasMoreNotes = $state(false);
	let followPending = $state(false);
	let loadedFor = $state('');
	let notes = $state<FeedNote[]>([]);
	let activeTab = $state<Tab>('posts');
	let pinnedNotes = $state<FeedNote[]>([]);
	let likedNotes = $state<FeedNote[]>([]);
	let repostedNotes = $state<FeedNote[]>([]);
	/** Zap history for the Zaps tab — loaded on first open. */
	let zapEntries = $state<ZapEntry[]>([]);
	let zapsLoading = $state(false);
	let zapsLoadedFor = $state('');
	/** Bitz (short-form media) published by this profile — loaded on first open. */
	let bitzReels = $state<ReelNote[]>([]);
	let bitzLoading = $state(false);
	let bitzLoadedFor = $state('');
	let bioExpanded = $state(false);
	let npubCopied = $state(false);
	let stuck = $state(false);
	let heroEl = $state<HTMLElement | undefined>(undefined);
	let loadRequest = 0;

	const posts = $derived(notes.filter((note) => !note.replyTo));
	const replies = $derived(notes.filter((note) => !!note.replyTo));
	const mediaItems = $derived(extractProfileMedia(notes));
	const completion = $derived(isMe ? profileCompletion(profile) : null);
	const isBioLong = $derived(!!profile?.about && profile.about.length > 200);
	const visibleBio = $derived(
		profile?.about
			? isBioLong && !bioExpanded
				? `${profile.about.slice(0, 200).trimEnd()}…`
				: profile.about
			: ''
	);

	const tabCounts = $derived(
		new SvelteMap<Tab, number>([
			['posts', posts.length],
			['replies', replies.length],
			['media', mediaItems.length],
			['zaps', zapEntries.length],
			['pinned', pinnedNotes.length],
			['liked', likedNotes.length],
			['reposts', repostedNotes.length],
			['bitz', bitzReels.length]
		])
	);

	const visibleNotes = $derived(
		activeTab === 'posts'
			? posts
			: activeTab === 'replies'
				? replies
				: activeTab === 'pinned'
					? pinnedNotes
					: activeTab === 'liked'
						? likedNotes
						: activeTab === 'reposts'
							? repostedNotes
							: []
	);
	const highlights = $derived(buildHighlights(notes));
	const reactionTotal = $derived(
		notes.reduce(
			(sum, note) => sum + note.reactions.reduce((count, reaction) => count + reaction.count, 0),
			0
		)
	);
	const satsReceived = $derived(notes.reduce((sum, note) => sum + note.zapTotalSats, 0));

	/* ----------------------------- data loading ---------------------------- */

	function uniqueNoteEvents(
		events: Array<{
			id: string;
			pubkey: string;
			content: string;
			created_at: number;
			tags: string[][];
			kind: number;
		}>
	) {
		const seen = new SvelteSet<string>();
		const feedKinds: number[] = [NOSTR_KINDS.TEXT_NOTE, NOSTR_KINDS.POLL];
		return events
			.filter((event) => {
				if (!feedKinds.includes(event.kind) || seen.has(event.id)) return false;
				seen.add(event.id);
				return true;
			})
			.sort((a, b) => b.created_at - a.created_at);
	}

	async function buildPageFromEvents(events: Awaited<ReturnType<typeof queryPrimaryFirst>>) {
		const noteEvents = uniqueNoteEvents(events);
		const nextNotes = noteEvents.map(toFeedNote);
		const noteIds = nextNotes.map((note) => note.id);
		const activity = noteIds.length
			? await queryPrimaryFirst([
					{
						kinds: [
							NOSTR_KINDS.REACTION,
							NOSTR_KINDS.POLL_RESPONSE,
							NOSTR_KINDS.REPOST,
							NOSTR_KINDS.ZAP
						],
						'#e': noteIds,
						limit: 500
					}
				])
			: [];
		return {
			notes: applyActivityToNotes(nextNotes, activity, identity.current?.pk),
			mayHaveMore:
				events.filter(
					(event) => event.kind === NOSTR_KINDS.TEXT_NOTE || event.kind === NOSTR_KINDS.POLL
				).length >= NOTE_PAGE_LIMIT
		};
	}

	async function fetchNotePage(nextPubkey: string, until?: number) {
		const events = await queryPrimaryFirst([
			{
				kinds: [NOSTR_KINDS.TEXT_NOTE, NOSTR_KINDS.POLL],
				authors: [nextPubkey],
				limit: NOTE_PAGE_LIMIT,
				...(until ? { until } : {})
			}
		]);
		return buildPageFromEvents(events);
	}

	/** Load the profile's received-zap history (kind 9735, #p = pubkey). */
	async function loadZaps(nextPubkey: string) {
		if (zapsLoading || zapsLoadedFor === nextPubkey) return;
		zapsLoading = true;
		try {
			const events = await queryPrimaryFirst([
				{ kinds: [NOSTR_KINDS.ZAP], '#p': [nextPubkey], limit: 100 }
			]);
			const entries = events
				.map((ev) => receiptToZapEntry(ev, nextPubkey))
				.filter((e): e is ZapEntry => !!e)
				.sort((a, b) => b.createdAt - a.createdAt);
			// Guard against a pubkey switch mid-flight.
			if (pubkey === nextPubkey) {
				zapEntries = entries;
				zapsLoadedFor = nextPubkey;
			}
		} catch {
			/* best-effort */
		} finally {
			zapsLoading = false;
		}
	}

	/** Load the profile's bitz (NIP-68/71 media events by this author) plus
	 *  legacy video-bearing kind-1 notes already on the page. */
	async function loadBitz(nextPubkey: string) {
		if (bitzLoading || bitzLoadedFor === nextPubkey) return;
		bitzLoading = true;
		try {
			const events = await queryPrimaryFirst([
				{ kinds: [...BITZ_MEDIA_KINDS], authors: [nextPubkey], limit: 60 }
			]);
			if (loadedFor !== nextPubkey) return;
			const mediaReels = latestAddressableEvents(events)
				.sort((a, b) => b.created_at - a.created_at)
				.map((event) => toReelNote(event))
				.filter((reel): reel is ReelNote => !!reel);
			const legacyReels = notes.map(reelFromLegacyNote).filter((reel): reel is ReelNote => !!reel);
			const seen = new SvelteSet<string>();
			const base = [...mediaReels, ...legacyReels]
				.filter((reel) => {
					if (seen.has(reel.id)) return false;
					seen.add(reel.id);
					return true;
				})
				.sort((a, b) => b.createdAt - a.createdAt);
			const activity = base.length
				? await queryPrimaryFirst([
						{
							kinds: [
								NOSTR_KINDS.REACTION,
								NOSTR_KINDS.REPOST,
								NOSTR_KINDS.GENERIC_REPOST,
								NOSTR_KINDS.ZAP
							],
							'#e': base.map((reel) => reel.id),
							limit: 500
						}
					])
				: [];
			if (loadedFor !== nextPubkey) return;
			// applyActivityToNotes returns plain FeedNotes (1:1 with `base`) — zip
			// the hydrated counts back onto the media descriptors (same pattern as
			// the Bitz page).
			const hydratedById = new Map(
				applyActivityToNotes(base, activity, identity.current?.pk).map((note) => [note.id, note])
			);
			bitzReels = base.map((reel) => ({ ...reel, ...hydratedById.get(reel.id)! }));
			bitzLoadedFor = nextPubkey;
		} catch {
			/* best-effort */
		} finally {
			bitzLoading = false;
		}
	}

	/** Legacy kind-1 video notes from the loaded page parse into reels with no
	 *  extra relay round trip (NIP-71 compatibility path, mirrors the Bitz feed). */
	function reelFromLegacyNote(note: FeedNote): ReelNote | null {
		const media = parseBitz({
			id: note.id,
			pubkey: note.pubkey,
			kind: NOSTR_KINDS.TEXT_NOTE,
			content: note.content,
			tags: note.tags
		});
		if (!media) return null;
		return {
			...note,
			mediaUrl: media.url,
			mediaType: media.type,
			mediaFallbacks: media.fallbacks,
			...(media.renditions ? { mediaRenditions: media.renditions } : {})
		};
	}

	function onTabSelect(tab: Tab) {
		activeTab = tab;
		if (tab === 'zaps' && pubkey) void loadZaps(pubkey);
		if (tab === 'bitz' && pubkey) void loadBitz(pubkey);
	}

	async function loadPinnedNotes(nextPubkey: string) {
		const [list] = await queryPrimaryFirst([
			{ kinds: [NOSTR_KINDS.PINNED_NOTES], authors: [nextPubkey], limit: 1 }
		]);
		if (loadedFor !== nextPubkey) return;
		const ids =
			list?.tags
				.filter((tag) => tag[0] === 'e' && /^[0-9a-f]{64}$/i.test(tag[1] ?? ''))
				.map((tag) => tag[1])
				.filter((id, index, all): id is string => !!id && all.indexOf(id) === index) ?? [];
		if (!ids.length) return;
		const noteEvents = await queryPrimaryFirst([
			{ kinds: [NOSTR_KINDS.TEXT_NOTE, NOSTR_KINDS.POLL], '#e': ids, limit: ids.length }
		]);
		if (loadedFor !== nextPubkey) return;
		const notesById = new SvelteMap(noteEvents.map((event) => [event.id, toFeedNote(event)]));
		const ordered = ids.map((id) => notesById.get(id)).filter((note): note is FeedNote => !!note);
		const activity = await queryPrimaryFirst([
			{
				kinds: [
					NOSTR_KINDS.REACTION,
					NOSTR_KINDS.POLL_RESPONSE,
					NOSTR_KINDS.REPOST,
					NOSTR_KINDS.ZAP
				],
				'#e': ordered.map((note) => note.id),
				limit: 500
			}
		]);
		if (loadedFor !== nextPubkey) return;
		pinnedNotes = applyActivityToNotes(ordered, activity, identity.current?.pk);
	}

	async function loadInteractionNotes(nextPubkey: string) {
		const events = await queryPrimaryFirst([
			{ kinds: [NOSTR_KINDS.REACTION, NOSTR_KINDS.REPOST], authors: [nextPubkey], limit: 300 }
		]);
		if (loadedFor !== nextPubkey) return;
		const idsFor = (kind: number) =>
			[
				...new SvelteSet(
					events
						.filter((event) => event.kind === kind && event.content !== '-')
						.sort((a, b) => b.created_at - a.created_at)
						.map(
							(event) =>
								event.tags.find(
									(tag) => tag[0] === 'e' && /^[0-9a-f]{64}$/i.test(tag[1] ?? '')
								)?.[1]
						)
						.filter((id): id is string => !!id)
				)
			].slice(0, 80);
		const likedIds = idsFor(NOSTR_KINDS.REACTION);
		const repostedIds = idsFor(NOSTR_KINDS.REPOST);
		const ids = [...new SvelteSet([...likedIds, ...repostedIds])];
		if (!ids.length) return;
		const noteEvents = await queryPrimaryFirst([
			{ kinds: [NOSTR_KINDS.TEXT_NOTE, NOSTR_KINDS.POLL], '#e': ids, limit: ids.length }
		]);
		const notesById = new SvelteMap(noteEvents.map((event) => [event.id, toFeedNote(event)]));
		const hydrate = async (targetIds: string[]) => {
			const ordered = targetIds
				.map((id) => notesById.get(id))
				.filter((note): note is FeedNote => !!note);
			const activity = await queryPrimaryFirst([
				{
					kinds: [
						NOSTR_KINDS.REACTION,
						NOSTR_KINDS.POLL_RESPONSE,
						NOSTR_KINDS.REPOST,
						NOSTR_KINDS.ZAP
					],
					'#e': ordered.map((note) => note.id),
					limit: 500
				}
			]);
			return applyActivityToNotes(ordered, activity, identity.current?.pk);
		};
		likedNotes = await hydrate(likedIds);
		repostedNotes = await hydrate(repostedIds);
	}

	function mergeNotes(current: FeedNote[], next: FeedNote[]) {
		const seen = new SvelteSet(current.map((note) => note.id));
		return [...current, ...next.filter((note) => !seen.has(note.id))].sort(
			(a, b) => b.createdAt - a.createdAt
		);
	}

	function buildHighlights(items: FeedNote[]) {
		const counts: Record<string, number> = {};
		for (const item of items) {
			for (const match of item.content.matchAll(hashtagPattern)) {
				const tag = match[1].toLowerCase();
				counts[tag] = (counts[tag] ?? 0) + 1;
			}
			for (const tag of item.tags) {
				if (tag[0] !== 't' || !tag[1]) continue;
				const value = tag[1].toLowerCase();
				counts[value] = (counts[value] ?? 0) + 1;
			}
		}
		return Object.entries(counts)
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
			.slice(0, 8)
			.map(([tag, count]) => ({ tag, count }));
	}

	async function loadProfile(nextPubkey: string) {
		if (!nextPubkey || loadedFor === nextPubkey) return;
		const request = ++loadRequest;
		loading = true;
		bannerFailed = false;
		hasMoreNotes = false;
		notes = [];
		loadedFor = nextPubkey;
		pinnedNotes = [];
		likedNotes = [];
		repostedNotes = [];
		activeTab = 'posts';
		bioExpanded = false;
		profiles.refresh([nextPubkey]);
		try {
			void loadPinnedNotes(nextPubkey).catch((error) => {
				if (loadedFor === nextPubkey)
					toasts.error((error as Error).message || 'Could not load pinned notes');
			});
			void loadInteractionNotes(nextPubkey).catch((error) => {
				if (loadedFor === nextPubkey)
					toasts.error((error as Error).message || 'Could not load profile activity');
			});
			const currentLoad = nextPubkey;
			const primaryEvents = await queryPrimaryFirst(
				[
					{
						kinds: [NOSTR_KINDS.TEXT_NOTE, NOSTR_KINDS.POLL],
						authors: [nextPubkey],
						limit: NOTE_PAGE_LIMIT
					}
				],
				{
					onSecondary: (mergedEvents) => {
						if (loadedFor !== currentLoad) return;
						void buildPageFromEvents(mergedEvents).then((page) => {
							if (loadedFor !== currentLoad) return;
							notes = page.notes;
							hasMoreNotes = page.mayHaveMore;
						});
					}
				}
			);
			if (loadedFor !== currentLoad) return;
			const page = await buildPageFromEvents(primaryEvents);
			notes = page.notes;
			hasMoreNotes = page.mayHaveMore;
		} catch (e) {
			toasts.error((e as Error).message || 'Could not load profile');
		} finally {
			if (request === loadRequest && loadedFor === nextPubkey) loading = false;
		}
	}

	async function loadMoreNotes() {
		if (!pubkey || loadingMore || !hasMoreNotes || !notes.length) return;
		const oldest = notes.at(-1);
		if (!oldest) return;
		loadingMore = true;
		try {
			const page = await fetchNotePage(pubkey, oldest.createdAt - 1);
			notes = mergeNotes(notes, page.notes);
			hasMoreNotes = page.mayHaveMore;
			if (!page.notes.length) toasts.info('No older notes found');
		} catch (e) {
			toasts.error((e as Error).message || 'Could not load older notes');
		} finally {
			loadingMore = false;
		}
	}

	function updateNote(next: FeedNote) {
		notes = notes.map((note) => (note.id === next.id ? next : note));
	}

	async function toggleFollow() {
		if (!pubkey || isMe || followPending) return;
		followPending = true;
		try {
			if (isFollowing) {
				await contacts.unfollow(pubkey);
				toasts.info(`Unfollowed ${displayName}`);
			} else {
				await contacts.follow(pubkey);
				toasts.success(`Following ${displayName}`);
			}
		} catch (e) {
			toasts.error((e as Error).message || 'Could not update follow status');
		} finally {
			followPending = false;
		}
	}

	async function copyNpub() {
		if (!npub) return;
		try {
			await navigator.clipboard.writeText(npub);
			npubCopied = true;
			toasts.success('npub copied');
			setTimeout(() => (npubCopied = false), 1600);
		} catch {
			toasts.error('Could not copy npub');
		}
	}

	async function shareProfile() {
		if (!npub) return;
		const url = `${location.origin}/profile/${npub}`;
		const shareData = { title: displayName, text: `${displayName} on BitOS`, url };
		try {
			if (navigator.share) await navigator.share(shareData);
			else {
				await navigator.clipboard.writeText(url);
				toasts.success('Profile link copied');
			}
		} catch {
			/* user cancelled share — ignore */
		}
	}

	function goBack() {
		if (history.length > 1) history.back();
		else goto('/');
	}

	function selectStat(tab: Tab) {
		activeTab = tab;
		// Jump to the tab bar so the selected content is in view.
		heroEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	$effect(() => {
		// On a hard refresh the profile can mount before the layout restores the
		// persisted relay list. React to that list becoming available so the first
		// query is not permanently skipped by loadedFor.
		const relaySignature = relays.orderedReadUrls.join(',');
		if (pubkey && relays.ready && relaySignature) void loadProfile(pubkey);
	});

	// Scroll-reveal: stick the tab bar + fade in the compact identity once the
	// hero scrolls out of view. Pure observer, no layout shift.
	$effect(() => {
		const el = heroEl;
		if (!el) return;
		const observer = new IntersectionObserver(
			([entry]) => {
				stuck = !entry.isIntersecting && entry.boundingClientRect.top < 0;
			},
			{ threshold: [0, 1] }
		);
		observer.observe(el);
		return () => observer.disconnect();
	});
</script>

<svelte:head><title>{displayName} · BitOS</title></svelte:head>

<div class="h-full overflow-y-auto">
	<!-- ============================ HERO ============================ -->
	<div class="relative">
		<div class="relative h-[160px] overflow-hidden bg-primary-500 sm:h-[200px]">
			{#if profile?.banner && !bannerFailed}
				<img
					src={profile.banner}
					class="absolute inset-0 size-full object-cover"
					alt=""
					loading="eager"
					onerror={() => (bannerFailed = true)}
				/>
			{:else}
				<!-- Default cover (no banner published or failed to load): two-tone
				     brand gradient + subtle hex overlay, mirroring the profile cover
				     in docs/ui-page-example.html (gradient base, 20%-opacity pattern). -->
				<div
					class="absolute inset-0 bg-primary-500"
					style="background-image:linear-gradient(115deg, var(--ui-color-primary-400) 0%, var(--ui-color-primary-700) 100%);"
				></div>
				<div
					class="absolute inset-0 opacity-20"
					style="background-image:url('data:image/svg+xml,%3Csvg width=%22120%22 height=%22120%22 viewBox=%220 0 120 120%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cg fill=%22%23fff%22 fill-opacity=%220.4%22%3E%3Cpolygon points=%2230,0 90,0 120,52 90,104 30,104 0,52%22/%3E%3C/g%3E%3C/svg%3E');"
				></div>
			{/if}
			<div
				class="absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-black/35"
			></div>

			<!-- Floating top controls (always visible over the banner) -->
			<div class="absolute inset-x-0 top-0 flex items-center justify-between p-3 sm:p-4">
				<button
					type="button"
					onclick={goBack}
					class="focus-brand grid size-9 place-items-center rounded-full bg-black/30 text-white backdrop-blur-md transition hover:bg-black/50"
					aria-label="Go back"
				>
					<Icon name="i-lucide-arrow-left" class="size-5" />
				</button>
				<div class="flex items-center gap-2">
					<button
						type="button"
						onclick={shareProfile}
						class="focus-brand grid size-9 place-items-center rounded-full bg-black/30 text-white backdrop-blur-md transition hover:bg-black/50"
						aria-label="Share profile"
					>
						<Icon name="i-lucide-share-2" class="size-4.5" />
					</button>
					{#if isMe}
						<a
							href="/settings"
							class="inline-flex items-center gap-1.5 rounded-full bg-black/30 px-3 py-1.5 text-[12px] font-semibold text-white backdrop-blur-md transition hover:bg-black/50"
						>
							<Icon name="i-lucide-camera" class="size-3.5" /> Edit cover
						</a>
					{/if}
				</div>
			</div>
		</div>
	</div>

	<div class="mx-auto max-w-[900px] px-4 sm:px-6 xl:max-w-[860px]">
		<!-- ============================ IDENTITY ROW ============================ -->
		<div
			class="relative -mt-12 mb-4 flex flex-col items-center gap-4 text-center sm:-mt-16 sm:flex-row sm:items-end sm:text-left"
		>
			<div class="relative">
				<StoryRing {pubkey} rounded="hex-clip">
					<div class="hex-clip bg-[var(--ui-bg)] p-1">
						<Avatar {pubkey} name={displayName} picture={profile?.picture} size={104} shape="hex" />
					</div>
				</StoryRing>
			</div>

			<div class="min-w-0 flex-1 pb-1">
				<div class="flex min-w-0 items-center justify-center gap-2 sm:justify-start">
					<h1
						class="truncate font-display text-[24px] leading-tight font-extrabold tracking-tight sm:text-[30px]"
					>
						{displayName}
					</h1>
					{#if profile?.nip05}
						<Icon name="i-lucide-badge-check" class="size-5 shrink-0 text-primary-500" />
					{/if}
				</div>

				<!-- npub copy chip -->
				<button
					type="button"
					onclick={copyNpub}
					class="focus-brand mt-1 inline-flex items-center gap-1.5 rounded-full bg-[var(--ui-bg-muted)] px-2.5 py-1 font-mono text-[11.5px] text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
					title="Copy npub"
				>
					<Icon
						name={npubCopied ? 'i-lucide-check' : 'i-lucide-copy'}
						class="size-3 {npubCopied ? 'text-accent-600' : ''}"
					/>
					{shortKey(npub, 10, 8)}
				</button>

				<div class="mt-2 flex flex-wrap items-center justify-center gap-1.5 sm:justify-start">
					{#if !isMe && isFollowing}
						<span
							class="inline-flex items-center gap-1 rounded-full bg-primary-500/10 px-2 py-0.5 text-[11px] font-bold text-primary-600 dark:text-primary-400"
						>
							<Icon name="i-lucide-check" class="size-3" />
							Following
						</span>
					{/if}
					{#if lightning}
						<span
							class="inline-flex items-center gap-1 rounded-full bg-warm-500/10 px-2 py-0.5 text-[11px] font-bold text-warm-600 dark:text-warm-400"
						>
							<Icon name="i-lucide-zap" class="size-3" />
							Lightning
						</span>
					{/if}
				</div>
			</div>

			<!-- Action buttons -->
			<div class="flex w-full flex-wrap justify-center gap-2 pb-1 sm:w-auto sm:justify-end">
				{#if isMe}
					<a
						href="/settings"
						class="focus-brand inline-flex h-10 items-center gap-2 rounded-full bg-primary-500 px-4 text-[13px] font-bold text-white shadow-[var(--glow-primary)] transition hover:bg-primary-600"
					>
						<Icon name="i-lucide-pencil" class="size-4" />
						Edit profile
					</a>
				{:else}
					<button
						type="button"
						onclick={toggleFollow}
						disabled={followPending || contacts.loading}
						class="focus-brand inline-flex h-10 items-center gap-2 rounded-full px-4 text-[13px] font-bold shadow-[var(--glow-primary)] transition disabled:cursor-not-allowed disabled:opacity-60 {isFollowing
							? 'border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] text-[var(--ui-text)] shadow-none hover:border-primary-500 hover:text-primary-500'
							: 'bg-primary-500 text-white hover:bg-primary-600'}"
					>
						<Icon
							name={followPending
								? 'i-lucide-loader-circle'
								: isFollowing
									? 'i-lucide-user-check'
									: 'i-lucide-user-plus'}
							class="size-4 {followPending ? 'animate-spin' : ''}"
						/>
						{followPending ? 'Updating' : isFollowing ? 'Following' : 'Follow'}
					</button>
					{#if isBlocked}
						<span
							class="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--tone-error-text)]/20 bg-[var(--tone-error-bg)] px-4 text-[13px] font-bold text-[var(--tone-error-text)]"
						>
							<Icon name="i-lucide-ban" class="size-4" />
							Blocked
						</span>
					{:else}
						<a
							href={`/messages?to=${pubkey}`}
							class="focus-brand inline-flex h-10 items-center gap-2 rounded-full border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-4 text-[13px] font-bold text-[var(--ui-text)] transition hover:border-primary-500 hover:text-primary-500"
						>
							<Icon name="i-lucide-message-circle" class="size-4" />
							Message
						</a>
					{/if}
				{/if}
				<ProfileActionMenu {pubkey} {npub} {lightning} />
			</div>
		</div>

		<!-- ============================ BIO ============================ -->
		<div class="post-card mb-4 p-4">
			{#if visibleBio}
				<p class="text-[14px] leading-relaxed whitespace-pre-line text-[var(--ui-text)]">
					{visibleBio}
				</p>
				{#if isBioLong}
					<button
						type="button"
						onclick={() => (bioExpanded = !bioExpanded)}
						class="mt-1.5 text-[12.5px] font-bold text-primary-600 transition hover:text-primary-700 dark:text-primary-400"
					>
						{bioExpanded ? 'Show less' : 'Show more'}
					</button>
				{/if}
			{:else}
				<p class="text-[13.5px] leading-relaxed text-[var(--ui-text-dimmed)]">
					{isMe ? 'You haven’t added a bio yet.' : 'No profile bio published yet.'}
				</p>
			{/if}

			<div class="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-[var(--ui-text-muted)]">
				{#if profile?.website}
					<a
						href={normalizedWebsite}
						target="_blank"
						rel="noreferrer"
						class="inline-flex items-center gap-1.5 transition hover:text-primary-500"
					>
						<Icon name="i-lucide-link" class="size-3.5 text-primary-500" />
						{profile.website.replace(/^https?:\/\//, '')}
					</a>
				{/if}
				{#if profile?.nip05}
					<span class="inline-flex items-center gap-1.5">
						<Icon name="i-lucide-badge-check" class="size-3.5 text-primary-500" />
						{profile.nip05}
					</span>
				{/if}
				{#if profile?.lud16 || profile?.lud06}
					<span class="inline-flex items-center gap-1.5">
						<Icon name="i-lucide-zap" class="size-3.5 text-warm-500" />
						{profile.lud16 || profile.lud06}
					</span>
				{/if}
				{#if notes[0]}
					<span class="inline-flex items-center gap-1.5" title={timeFull(notes[0].createdAt)}>
						<Icon name="i-lucide-clock" class="size-3.5 text-primary-500" />
						Active {timeFull(notes[0].createdAt)}
					</span>
				{/if}
			</div>
		</div>

		<!-- ============================ PROFILE COMPLETION (me only) ============================ -->
		{#if completion && completion.score < 100}
			<div class="post-card mb-4 p-4">
				<div class="flex items-center justify-between gap-3">
					<div class="flex items-center gap-2">
						<span
							class="grid size-7 place-items-center rounded-lg bg-warm-500/10 text-warm-600 dark:text-warm-400"
						>
							<Icon name="i-lucide-sparkles" class="size-4" />
						</span>
						<div>
							<h3 class="font-display text-[14px] font-extrabold">Complete your profile</h3>
							<p class="text-[11.5px] text-[var(--ui-text-muted)]">
								{completion.score}% complete · {completion.missing.length} step{completion.missing
									.length === 1
									? ''
									: 's'} to go
							</p>
						</div>
					</div>
					<a
						href="/settings"
						class="focus-brand inline-flex items-center gap-1.5 rounded-full bg-primary-500 px-3 py-1.5 text-[12px] font-bold text-white transition hover:bg-primary-600"
					>
						Finish
						<Icon name="i-lucide-arrow-right" class="size-3.5" />
					</a>
				</div>
				<div class="mt-3 h-2 overflow-hidden rounded-full bg-[var(--ui-bg-muted)]">
					<div
						class="h-full rounded-full bg-gradient-to-r from-primary-500 to-accent-500 transition-[width] duration-500"
						style="width:{completion.score}%"
					></div>
				</div>
				<div class="mt-3 flex flex-wrap gap-1.5">
					{#each completion.missing as field (field.key)}
						<span
							class="inline-flex items-center gap-1 rounded-full border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ui-text-muted)]"
							title={field.hint}
						>
							<Icon name="i-lucide-circle" class="size-3" />
							{field.label}
						</span>
					{/each}
				</div>
			</div>
		{/if}

		<!-- ============================ STAT BAR ============================ -->
		<ProfileStats
			{pubkey}
			stats={{ posts: posts.length, replies: replies.length, media: mediaItems.length }}
			onSelectStat={selectStat}
		/>

		<!-- ============================ ACTIVITY HEATMAP ============================ -->
		{#if !loading}
			<ActivityHeatmap {notes} />
		{/if}

		<!-- ============================ HIGHLIGHTS ============================ -->
		<div class="post-card mb-4 p-4">
			<div class="mb-3 flex items-center justify-between">
				<h3 class="font-display text-[15px] font-extrabold">Highlights</h3>
				{#if highlights.length}
					<span class="text-[11px] font-semibold text-[var(--ui-text-muted)]">Top tags</span>
				{/if}
			</div>
			<div
				class="flex [scrollbar-width:none] gap-2 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden"
			>
				{#if highlights.length}
					{#each highlights as h (h.tag)}
						<button
							type="button"
							onclick={() => toasts.info(`#${h.tag}`)}
							class="group focus-brand inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3 py-1.5 text-[12.5px] font-bold text-[var(--ui-text)] transition hover:border-primary-500 hover:bg-primary-500/10 hover:text-primary-600"
						>
							<Icon
								name="i-lucide-hash"
								class="size-3.5 text-[var(--ui-text-dimmed)] group-hover:text-primary-500"
							/>
							{h.tag}
							<span
								class="rounded-full bg-[var(--ui-bg-accented)] px-1.5 text-[10.5px] text-[var(--ui-text-muted)] tabular-nums"
								>{h.count}</span
							>
						</button>
					{/each}
				{:else}
					<div class="flex items-center gap-2 py-1 text-[12.5px] text-[var(--ui-text-dimmed)]">
						<Icon name="i-lucide-sparkles" class="size-4" />
						No hashtags yet — tags this profile posts with will collect here.
					</div>
				{/if}
			</div>
		</div>

		<!-- ============================ ENGAGEMENT SUMMARY ============================ -->
		{#if reactionTotal || satsReceived}
			<div class="post-card mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
				<div class="flex items-center gap-2 text-[12.5px] text-[var(--ui-text-muted)]">
					<span
						class="grid size-7 place-items-center rounded-lg bg-warm-500/10 text-warm-600 dark:text-warm-400"
					>
						<Icon name="i-lucide-heart" class="size-4" />
					</span>
					<strong class="text-[var(--ui-text)]">{reactionTotal}</strong> reactions
				</div>
				<div class="flex items-center gap-2 text-[12.5px] text-[var(--ui-text-muted)]">
					<span
						class="grid size-7 place-items-center rounded-lg bg-warm-500/10 text-warm-600 dark:text-warm-400"
					>
						<Icon name="i-lucide-zap" class="size-4" />
					</span>
					<strong class="text-[var(--ui-text)]">{compactSats(satsReceived)}</strong> sats received
				</div>
				<span class="ml-auto text-[11px] text-[var(--ui-text-dimmed)]">From loaded notes</span>
			</div>
		{/if}

		<!-- Sentinel: when it scrolls past the top the tab bar is pinned. -->
		<div bind:this={heroEl} class="h-0 w-0"></div>

		<!-- ============================ STICKY TAB BAR ============================ -->
		<div
			class="sticky top-0 z-30 -mx-4 mb-4 border-b border-[var(--ui-border-muted)] bg-[var(--ui-bg)]/95 px-4 backdrop-blur-md transition-shadow sm:-mx-6 sm:px-6 {stuck
				? 'shadow-[var(--shadow-card)]'
				: ''}"
		>
			<div class="flex items-center gap-2">
				<!-- Scroll-reveal compact identity (space reserved → no shift) -->
				<div
					class="flex min-w-0 items-center gap-2 transition-opacity duration-200 {stuck
						? 'opacity-100'
						: 'pointer-events-none opacity-0'}"
				>
					<Avatar {pubkey} name={displayName} picture={profile?.picture} size={26} />
					<span class="max-w-[120px] truncate text-[13px] font-bold sm:max-w-[180px]"
						>{displayName}</span
					>
					{#if !isMe}
						<button
							type="button"
							onclick={toggleFollow}
							disabled={followPending || contacts.loading}
							class="focus-brand inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11.5px] font-bold transition disabled:opacity-60 {isFollowing
								? 'border border-[var(--ui-border-muted)] text-[var(--ui-text-muted)]'
								: 'bg-primary-500 text-white'}"
						>
							{isFollowing ? 'Following' : 'Follow'}
						</button>
					{/if}
				</div>

				<div
					class="ml-auto flex [scrollbar-width:none] gap-1 overflow-x-auto [&::-webkit-scrollbar]:hidden"
				>
					{#each [['posts', 'Posts'], ['replies', 'Replies'], ['reposts', 'Reposts'], ['bitz', 'Bitz'], ['media', 'Media'], ['zaps', 'Zaps']] as [tab, label] (tab)}
						<button
							type="button"
							onclick={() => onTabSelect(tab as Tab)}
							class="flex items-center gap-1.5 border-b-2 px-3 py-3 text-[13px] font-bold whitespace-nowrap transition {activeTab ===
							tab
								? 'border-primary-500 text-[var(--ui-text)]'
								: 'border-transparent text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
						>
							{label}
							<span
								class="text-[11px] tabular-nums {activeTab === tab
									? 'text-primary-500'
									: 'text-[var(--ui-text-dimmed)]'}">{tabCounts.get(tab as Tab) ?? 0}</span
							>
						</button>
					{/each}
					{#if pinnedNotes.length}
						<button
							type="button"
							onclick={() => (activeTab = 'pinned')}
							class="flex items-center gap-1.5 border-b-2 px-3 py-3 text-[13px] font-bold whitespace-nowrap transition {activeTab ===
							'pinned'
								? 'border-primary-500 text-[var(--ui-text)]'
								: 'border-transparent text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
						>
							<Icon name="i-lucide-pin" class="size-3.5" />
							Pinned
						</button>
					{/if}
					{#if likedNotes.length}
						<button
							type="button"
							onclick={() => (activeTab = 'liked')}
							class="flex items-center gap-1.5 border-b-2 px-3 py-3 text-[13px] font-bold whitespace-nowrap transition {activeTab ===
							'liked'
								? 'border-primary-500 text-[var(--ui-text)]'
								: 'border-transparent text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
						>
							<Icon name="i-lucide-heart" class="size-3.5" />
							Liked
						</button>
					{/if}
				</div>
			</div>
		</div>

		<!-- ============================ CONTENT ============================ -->
		{#if !pubkey}
			<div class="post-card py-16 text-center">
				<p class="text-[15px] font-semibold">Invalid profile</p>
				<p class="mt-1 text-[13px] text-[var(--ui-text-muted)]">
					This profile key could not be decoded.
				</p>
			</div>
		{:else if loading}
			<!-- Skeleton -->
			<div class="space-y-4 pb-8">
				{#each [0, 1, 2] as i (i)}
					<div class="post-card p-4" aria-hidden="true">
						<div class="flex items-center gap-3">
							<div class="size-10 animate-pulse rounded-full bg-[var(--ui-bg-accented)]"></div>
							<div class="flex-1 space-y-2">
								<div class="h-3 w-1/4 animate-pulse rounded bg-[var(--ui-bg-accented)]"></div>
								<div class="h-2.5 w-1/6 animate-pulse rounded bg-[var(--ui-bg-accented)]"></div>
							</div>
						</div>
						<div class="mt-3 space-y-2">
							<div class="h-3 w-full animate-pulse rounded bg-[var(--ui-bg-accented)]"></div>
							<div
								class="h-3 {i === 0
									? 'w-5/6'
									: 'w-2/3'} animate-pulse rounded bg-[var(--ui-bg-accented)]"
							></div>
						</div>
					</div>
				{/each}
			</div>
		{:else if activeTab === 'zaps'}
			<div class="space-y-2 pb-8">
				{#if zapsLoading && !zapEntries.length}
					<div
						class="flex items-center justify-center gap-2 py-10 text-[13px] font-semibold text-[var(--ui-text-dimmed)]"
					>
						<Icon name="i-lucide-loader-circle" class="size-4 animate-spin" />
						Loading zap history…
					</div>
				{:else if !zapEntries.length}
					<div class="flex flex-col items-center gap-2 py-10 text-center">
						<Icon name="i-lucide-zap" class="size-6 text-[var(--ui-text-dimmed)]" />
						<p class="text-[13px] font-semibold text-[var(--ui-text-muted)]">No zaps yet</p>
						<p class="text-[12px] text-[var(--ui-text-dimmed)]">
							{isMe
								? 'Zaps you receive will show up here.'
								: `${displayName} has not received any zaps yet.`}
						</p>
					</div>
				{:else}
					<p class="px-1 text-[12px] font-semibold text-[var(--ui-text-dimmed)]">
						{compactSats(zapEntries.reduce((sum, z) => sum + z.amountSats, 0))} sats received ·
						{zapEntries.length} zap{zapEntries.length === 1 ? '' : 's'}
					</p>
					{#each zapEntries as entry (entry.id)}
						<ZapLedgerRow {entry} />
					{/each}
				{/if}
			</div>
		{:else if activeTab === 'media'}
			<div class="pb-8">
				<MediaGallery {notes} />
			</div>
		{:else if activeTab === 'bitz'}
			<div class="pb-8">
				<ProfileBitzGrid reels={bitzReels} loading={bitzLoading} />
			</div>
		{:else if visibleNotes.length}
			<div class="feed-note-list pb-8">
				{#each visibleNotes as note, i (note.id)}
					{#if activeTab === 'reposts' || activeTab === 'pinned'}
						{#if activeTab === 'reposts'}
							<div
								class="flex items-center gap-1.5 px-1 text-[11.5px] font-semibold text-[var(--ui-text-muted)]"
							>
								<Icon name="i-lucide-repeat-2" class="size-3.5" />
								Reposted
							</div>
						{:else}
							<div
								class="flex items-center gap-1.5 px-1 text-[11.5px] font-semibold text-primary-600 dark:text-primary-400"
							>
								<Icon name="i-lucide-pin" class="size-3.5" />
								Pinned
							</div>
						{/if}
					{/if}
					<PostCard {note} index={i} onNoteChange={updateNote} />
				{/each}
				{#if hasMoreNotes && (activeTab === 'posts' || activeTab === 'replies')}
					<div class="flex justify-center pt-1">
						<button
							type="button"
							onclick={loadMoreNotes}
							disabled={loadingMore}
							class="focus-brand inline-flex h-10 items-center gap-2 rounded-full border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-4 text-[13px] font-bold text-[var(--ui-text)] transition hover:border-primary-500 hover:text-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
						>
							<Icon
								name={loadingMore ? 'i-lucide-loader-circle' : 'i-lucide-chevron-down'}
								class="size-4 {loadingMore ? 'animate-spin' : ''}"
							/>
							{loadingMore ? 'Loading older notes' : 'Load more'}
						</button>
					</div>
				{:else if notes.length >= NOTE_PAGE_LIMIT && (activeTab === 'posts' || activeTab === 'replies')}
					<p class="pt-1 text-center text-[12px] text-[var(--ui-text-muted)]">
						No older notes returned from this relay set.
					</p>
				{/if}
			</div>
		{:else}
			<!-- Premium empty state -->
			<div class="post-card flex flex-col items-center gap-3 px-6 py-14 text-center">
				<span
					class="grid size-14 place-items-center rounded-2xl bg-primary-500/10 text-primary-600 dark:text-primary-400"
				>
					<Icon
						name={activeTab === 'posts'
							? 'i-lucide-pen-line'
							: activeTab === 'replies'
								? 'i-lucide-message-square'
								: activeTab === 'pinned'
									? 'i-lucide-pin'
									: activeTab === 'liked'
										? 'i-lucide-heart'
										: 'i-lucide-repeat-2'}
						class="size-7"
					/>
				</span>
				<div>
					<p class="text-[15px] font-semibold">
						{#if activeTab === 'posts'}
							No posts yet
						{:else if activeTab === 'replies'}
							No replies yet
						{:else if activeTab === 'pinned'}
							Nothing pinned
						{:else if activeTab === 'liked'}
							No likes shown
						{:else}
							No reposts yet
						{/if}
					</p>
					<p class="mt-1 max-w-xs text-[13px] text-[var(--ui-text-muted)]">
						{#if activeTab === 'posts'}
							{isMe
								? 'Share your first note and it will appear here.'
								: 'This relay set did not return any posts.'}
						{:else}
							This relay set did not return matching notes.
						{/if}
					</p>
				</div>
				{#if isMe && (activeTab === 'posts' || activeTab === 'replies')}
					<a
						href="/"
						class="inline-flex h-9 items-center gap-2 rounded-full bg-primary-500 px-4 text-[13px] font-bold text-white shadow-[var(--glow-primary)] transition hover:bg-primary-600"
					>
						<Icon name="i-lucide-plus" class="size-4" />
						Create a note
					</a>
				{/if}
				{#if !isMe && (activeTab === 'posts' || activeTab === 'replies') && hasMoreNotes}
					<button
						type="button"
						onclick={loadMoreNotes}
						disabled={loadingMore}
						class="inline-flex h-9 items-center gap-2 rounded-full bg-primary-500 px-4 text-[13px] font-bold text-white shadow-[var(--glow-primary)] transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
					>
						<Icon
							name={loadingMore ? 'i-lucide-loader-circle' : 'i-lucide-refresh-cw'}
							class="size-4 {loadingMore ? 'animate-spin' : ''}"
						/>
						{loadingMore ? 'Loading' : 'Retry load'}
					</button>
				{/if}
			</div>
		{/if}
	</div>
</div>
