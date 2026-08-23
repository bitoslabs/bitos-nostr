<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { SvelteMap } from 'svelte/reactivity';
	import { npubEncode, decode as nip19Decode } from 'nostr-tools/nip19';
	import type { Filter } from 'nostr-tools/filter';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import BitsSearch from '$lib/components/bitz/BitzSearch.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import MenuItem from '$lib/components/ui/MenuItem.svelte';
	import MenuDivider from '$lib/components/ui/MenuDivider.svelte';
	import ReportDialog from '$lib/components/ui/ReportDialog.svelte';
	import MentionLink from '$lib/components/feed/MentionLink.svelte';
	import NostrEventPreview from '$lib/components/feed/NostrEventPreview.svelte';
	import PowBadge from '$lib/components/ui/PowBadge.svelte';
	import NoteZapDialog from '$lib/components/feed/NoteZapDialog.svelte';
	import CommentBody from '$lib/components/feed/CommentBody.svelte';
	import ReplyComposer from '$lib/components/feed/ReplyComposer.svelte';
	import MediaPlayer from '$lib/components/media/MediaPlayer.svelte';
	import { feed } from '$lib/nostr/feed.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { queryPrimaryFirst, queryUrls } from '$lib/nostr/pool';
	import { DISCOVERY_RELAY_URLS, relays } from '$lib/nostr/relays.svelte';
	import { contacts } from '$lib/nostr/contacts.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { eventRefFor, eventRefKey } from '$lib/nostr/event-ref';
	import { NOSTR_KINDS, type FeedNote } from '$lib/nostr/types';
	import { latestAddressableEvents, selectRendition } from '$lib/nostr/bitz-codec';
	import { toFeedNote } from '$lib/nostr/feed-note';
	import { applyActivityToNotes } from '$lib/nostr/zaps';
	import { bookmarks } from '$lib/stores/bookmarks.svelte';
	import { algorithmPreferences, buildScoringContext, rankNotes } from '$lib/algorithm';
	import { interactionProfile, extractTags } from '$lib/algorithm';
	import { popovers } from '$lib/stores/popovers.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { shortKey, timeAgo, formatDuration, formatCompact } from '$lib/utils/format';
	import { lazyVideoMetadata } from '$lib/utils/media';
	import { isEventReference, parseContent } from '$lib/utils/note-content';
	import { hasLightning } from '$lib/utils/verification';
	import { sensitiveMediaReason } from '$lib/utils/sensitive-media';
	import { privacyNotificationSettings } from '$lib/stores/privacy-notification-settings.svelte';
	import { compactSats } from '$lib/utils/profile-stats';
	import { shareEntity, sharePayload, shareWebLink } from '$lib/utils/bitz-links';
	import { BitzSearchStore } from '$lib/stores/bitz-search.svelte';
	import {
		bitzSession,
		BITZ_SESSION_REFRESH_MS,
		reconcileOptimisticReel,
		toReelNote,
		type BitzMode,
		type ReelNote
	} from '$lib/stores/bitz-session.svelte';
	import { pendingOutbox } from '$lib/stores/event-outbox';
	import type { RemixHandoff } from '$lib/components/bitz/MemeStudio.svelte';
	import { studioHandoff } from '$lib/stores/studio-handoff.svelte';
	import { remixLayoutOf, remixOf, rightsOf, canRemix } from '$lib/meme/remix';
	import { splitsOf } from '$lib/meme/splits';
	type Burst = {
		id: number;
		reelId: string;
		emoji: string;
		/** CSS position values relative to the reel card. */
		left: string;
		top: string;
		tx: number;
		rot: number;
		size: number;
		delay: number;
	};
	let burstSeq = 0;

	type ReelsCache = {
		savedAt: number;
		reels: ReelNote[];
	};
	type CommentPage = {
		loaded: boolean;
		oldestCreatedAt: number;
		hasMore: boolean;
	};

	const urlPattern = /https?:\/\/[^\s<>()]+/gi;
	const imagePattern = /\.(?:apng|avif|gif|jpe?g|png|webp)$/i;
	const videoPattern = /\.(?:m3u8|m4v|mov|mp4|webm)$/i;
	const videoFormatPattern = /(?:[?&](?:ext|fm|format)=)(?:m3u8|m4v|mov|mp4|webm)\b/i;
	const videoPathPattern = /(?:^|\/)(?:video|videos|reel|reels)(?:\/|$|:|-|_)/i;
	// v2 stores generic media cards (video or NIP-68 picture), not only videoUrl.
	const REELS_CACHE_KEY = 'bitos:reels-cache:v3';
	const LEGACY_REELS_CACHE_KEY = 'bitos:reels-cache:v2';
	const REELS_CACHE_TTL_MS = 15 * 60 * 1000;
	// Keep startup fast without retaining the full Bitz feed locally. Older
	// pages always come from relays through the normal pagination request.
	const MAX_CACHED_REELS = 10;
	// Nostr `limit` applies PER RELAY PER FILTER, so a single combined filter
	// transfers limit × relay-count events. Splitting by kind fixes the yield:
	// dedicated media kinds are ~100% renderable bitz (query them deep), while
	// kind-1 text notes are mostly text (query a shallow window for the few
	// that carry video links). Both filters run in one parallel round trip.
	const REEL_MEDIA_KINDS = [
		NOSTR_KINDS.PICTURE,
		NOSTR_KINDS.VIDEO,
		NOSTR_KINDS.SHORT_VIDEO,
		NOSTR_KINDS.ADDRESSABLE_VIDEO,
		NOSTR_KINDS.ADDRESSABLE_SHORT_VIDEO
	];
	const REELS_MEDIA_INITIAL_LIMIT = 400;
	const REELS_TEXT_INITIAL_LIMIT = 120;
	// "Load more" walks backwards in batches large enough that one or two relay
	// round-trips usually cover a full media page. The old 10-event batches made
	// pagination feel dead: dozens of sequential requests before anything showed.
	const REELS_QUERY_BATCH_LIMIT = 150;
	const REELS_MEDIA_PAGE_LIMIT = 60;
	// One "load more" targets a full Explore reveal page (18 tiles) so the grid
	// never stalls with fewer new tiles than it just revealed.
	const REELS_MEDIA_PAGE_SIZE = 18;
	const MAX_REEL_QUERY_BATCHES = 6;
	// Cap each pagination batch so a single dead/slow relay cannot stall the
	// backwards walk behind its EOSE. Initial loads keep the full wait.
	const REELS_PAGE_MAX_WAIT_MS = 4000;
	const INITIAL_RENDERED_REELS = 5;
	const REEL_RENDER_BATCH = 5;
	const REEL_PREFETCH_THRESHOLD = 6;
	const COMMENTS_PAGE_SIZE = 80;
	// Explore grid: how many tiles render up front and per "load more".
	const EXPLORE_INITIAL_VISIBLE = 24;
	const EXPLORE_PAGE_SIZE = 18;

	const bitzTabs: { key: BitzMode; label: string }[] = [
		{ key: 'explore', label: 'Explore' },
		{ key: 'following', label: 'Following' },
		{ key: 'foryou', label: 'For you' }
	];

	// --- Author mode (profile → Bitz tab → tile tap) -------------------------
	// The shared reels player scoped to one author (`/bitz?author=<npub>`):
	// same snap-scroll surface, same action rail — like/comments/zap/share/
	// remix all work. The tab bar is replaced by a back-to-profile bar and the
	// feed stays in loaded (chronological) order so the deep-linked tile lands
	// exactly where the user tapped in the profile grid (TikTok/Instagram grid
	// → player pattern: one player surface, context-aware data).
	function resolveAuthorParam(value: string | null): string {
		if (!value) return '';
		if (/^[0-9a-f]{64}$/i.test(value)) return value.toLowerCase();
		if (value.startsWith('npub1')) {
			try {
				const decoded = nip19Decode(value);
				if (decoded.type === 'npub') return decoded.data as string;
			} catch {
				return '';
			}
		}
		return '';
	}

	const authorPubkey = $derived(resolveAuthorParam(page.url.searchParams.get('author')));
	const authorMode = $derived(!!authorPubkey);
	const authorProfile = $derived(authorPubkey ? profiles.get(authorPubkey) : undefined);
	const authorDisplayName = $derived(
		authorProfile?.display_name ||
			authorProfile?.name ||
			(authorPubkey ? shortKey(authorPubkey) : '')
	);

	function exitAuthorMode() {
		if (history.length > 1) history.back();
		else if (authorPubkey) goto(`/profile/${npubEncode(authorPubkey)}`);
	}

	let loading = $state(true);
	let loadingComments = $state(false);
	let deletingCommentId = $state('');
	let loadingMoreReels = $state(false);
	let hasMoreReels = $state(true);
	/** Long-edge render target for adaptive rendition picks (READ-002/F-019).
	 * Reels render near full-viewport height; 25% selection headroom in
	 * selectRendition absorbs DPR rounding, so screen CSS pixels suffice. */
	const reelDisplayHeight = $derived.by(() => {
		if (typeof window === 'undefined') return 1280;
		return Math.max(window.screen?.height ?? window.innerHeight ?? 1280, 640);
	});

	/** Adaptive source for a reel: the rendition closest to the display
	 * without grossly exceeding it; mirrors stay the failure chain. */
	function reelSource(reel: ReelNote) {
		const pick = selectRendition(
			{ url: reel.mediaUrl, renditions: reel.mediaRenditions ?? [] },
			reelDisplayHeight
		);
		return pick.url;
	}

	let reelScroller: HTMLDivElement | undefined = $state();
	let reels = $state<ReelNote[]>([]);
	let bitzMode = $state<BitzMode>('foryou');
	let exploreScroller: HTMLDivElement | undefined = $state();
	let exploreVisible = $state(EXPLORE_INITIAL_VISIBLE);
	let gridVideoDurations = $state<Record<string, number>>({});
	/** Reel view mode: 'fill' = crop-to-fill (default), 'full' = letterbox the
	 * whole video. Global — one choice applies to every reel while swiping and
	 * persists across sessions (same pattern as the playback-rate pref). */
	const REEL_VIEW_MODE_KEY = 'bitos:reel-view-mode';
	function loadReelViewMode(): 'fill' | 'full' {
		try {
			return localStorage.getItem(REEL_VIEW_MODE_KEY) === 'full' ? 'full' : 'fill';
		} catch {
			return 'full';
		}
	}
	let reelViewMode = $state<'fill' | 'full'>(loadReelViewMode());
	function toggleReelViewMode() {
		reelViewMode = reelViewMode === 'full' ? 'fill' : 'full';
		try {
			localStorage.setItem(REEL_VIEW_MODE_KEY, reelViewMode);
		} catch {
			/* best-effort persistence */
		}
	}
	let renderedReelCount = $state(INITIAL_RENDERED_REELS);
	let activeReelId = $state('');
	let activeReelMuted = $state(true);
	let revealedSensitiveReels = $state<Record<string, boolean>>({});
	let commentReel = $state<ReelNote | null>(null);
	let commentPendingDelete = $state<FeedNote | null>(null);
	let deleteCommentOpen = $state(false);
	let commentPages = $state<Record<string, CommentPage>>({});
	/** The comment being replied to (full note, not just id/name): replies must
	 * chain NIP-10 tags to this comment so they land nested under it — exactly
	 * how feed-card comment replies are saved. Null = replying to the reel. */
	let commentReplyTarget = $state<FeedNote | null>(null);
	// Element/observer registries are non-reactive by design (no re-render on
	// media wiring) — plain Maps are intentional.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	let reelVideos = new Map<string, HTMLVideoElement>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	let reelCards = new Map<string, HTMLDivElement>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	let reelVisibility = new Map<string, number>();
	let visibilityObserver: IntersectionObserver | null = null;
	let oldestReelEventCreatedAt = $state(0);
	let zapReel = $state<ReelNote | null>(null);
	let zapOpen = $state(false);
	let optimisticZapSats = $state<Record<string, number>>({});
	let bursts = $state<Burst[]>([]);
	// --- Reel overflow menu (mirrors PostCard's "…" menu) ---
	let rawReelOpen = $state(false);
	let rawReelJson = $state('');
	let reportReelOpen = $state(false);
	let reportReelTarget = $state<ReelNote | null>(null);
	let deleteReelOpen = $state(false);
	let pendingDeleteReel = $state<ReelNote | null>(null);
	let deletingReel = $state(false);
	// --- Remix chain (plan §17 creator economy rec #1) ---
	/** Pending remix handed to the Meme Studio at /create (§17 remix chain). */
	let remixHandoff = $state<RemixHandoff | null>(null);
	const rankedReels = $derived.by(() => {
		if (!reels.length) return reels;
		// Author mode keeps the loaded (chronological) order — the profile grid
		// deep-links to an exact index, so re-ranking would land elsewhere.
		if (authorMode) return reels;
		if (!algorithmPreferences.isEnabled('reels')) return reels;
		// Fold the current watch-time proxy into engagement. Snap a copy so dwell is a
		// soft, best-effort input (re-ranking only fires when `reels`/config change,
		// never on every visibility tick — that would jitter the scroll snap).
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const dwell = new Map<string, number>();
		for (const [id, ratio] of reelVisibility) dwell.set(id, ratio);
		const ctx = buildScoringContext('reels', reels, { dwell });
		return rankNotes('reels', reels, ctx);
	});
	const followingReels = $derived(
		rankedReels.filter(
			(reel) => contacts.followingSet.has(reel.pubkey) || reel.pubkey === identity.current?.pk
		)
	);
	// The snap player consumes whichever list the active tab implies.
	const playbackReels = $derived(bitzMode === 'following' ? followingReels : rankedReels);
	const renderedReels = $derived(playbackReels.slice(0, renderedReelCount));
	const hasMoreRenderedReels = $derived(renderedReelCount < playbackReels.length);
	// Explore grid: videos lead (it is the "vdo" tab), pictures keep ranked order.
	const exploreReels = $derived([
		...rankedReels.filter((reel) => reel.mediaType === 'video'),
		...rankedReels.filter((reel) => reel.mediaType !== 'video')
	]);
	// Explore is page chrome on the themed background (light/dark aware);
	// the player tabs float over video and stay dark-media chrome.
	const isExplore = $derived(bitzMode === 'explore');
	const visibleExploreReels = $derived(exploreReels.slice(0, exploreVisible));

	function bitzAuthorName(reel: ReelNote) {
		const profile = profiles.get(reel.pubkey);
		return profile?.display_name || profile?.name || shortKey(reel.pubkey);
	}

	/** Search runs in a dedicated store (debounce + relay round + dedupe);
	 *  the page only injects its relay access, reel pipeline, and name helpers.
	 *  The local pool mirrors `exploreReels` so matching updates as the feed grows. */
	const search = new BitzSearchStore({
		relaySearch: (requests) =>
			queryUrls(relays.orderedReadUrls, requests as Filter[], { maxWait: REELS_PAGE_MAX_WAIT_MS }),
		eventsToReels: async (events) => {
			const mediaEvents = events.filter((event) => !!toReelNote(event));
			return mediaEvents.length ? await buildReelsFromEvents(mediaEvents, new Set()) : [];
		},
		captionOf: captionFor,
		authorOf: bitzAuthorName,
		profileEnsure: (pubkeys) => profiles.ensure(pubkeys),
		mediaKinds: REEL_MEDIA_KINDS,
		textKind: NOSTR_KINDS.TEXT_NOTE
	});
	// Mirror the explore pool into the store — instant local matching that
	// stays fresh as the feed grows/paginates.
	$effect(() => {
		search.setLocalPool(exploreReels);
	});

	/** Tap a result: splice into the feed if needed, then jump the snap player
	 *  straight to it (same path the Explore grid uses). */
	async function openBitzResult(reel: ReelNote) {
		search.close();
		if (!reels.some((item) => item.id === reel.id)) {
			applyReels([reel], { append: true });
			await tick();
		}
		await openFromExplore(reel);
	}
	const activeComments = $derived(commentReel ? commentsFor(commentReel.id) : []);
	const activeCommentTree = $derived(
		commentReel
			? commentTree(commentReel.id)
			: { top: [] as FeedNote[], children: new SvelteMap<string, FeedNote[]>() }
	);
	const activeTopLevelComments = $derived(activeCommentTree.top);
	const activeCommentPage = $derived(commentReel ? commentPages[commentReel.id] : undefined);

	function splitTrailingPunctuation(raw: string) {
		let core = raw;
		let suffix = '';
		while (/[),.!?;:\]]$/.test(core)) {
			suffix = core.at(-1) + suffix;
			core = core.slice(0, -1);
		}
		return { core, suffix };
	}

	function looksLikeVideoUrl(url: string) {
		try {
			const parsed = new URL(url);
			const pathname = decodeURIComponent(parsed.pathname);
			return (
				videoPattern.test(pathname) ||
				videoFormatPattern.test(parsed.search) ||
				videoPathPattern.test(pathname) ||
				parsed.searchParams.get('resource_type') === 'video'
			);
		} catch {
			return /\.(?:m3u8|m4v|mov|mp4|webm)(?:[?#].*)?$/i.test(url);
		}
	}

	function captionFor(reel: ReelNote) {
		// The reel itself is the media presentation. Do not repeat source URLs in
		// the caption, including additional image/video URLs from multi-media notes.
		let caption = reel.content.split(reel.mediaUrl).join(' ');
		for (const match of reel.content.matchAll(urlPattern)) {
			const { core } = splitTrailingPunctuation(match[0]);
			if (looksLikeVideoUrl(core) || imagePattern.test(core))
				caption = caption.split(core).join(' ');
		}
		return caption.replace(/\s+/g, ' ').trim();
	}

	/** Caption tokens (mentions / hashtags / links) rendered like a feed card
	 *  body — the caption on the reel reads exactly like note content there. */
	function captionTokens(reel: ReelNote) {
		return parseContent(captionFor(reel));
	}

	function reelMenuId(reel: ReelNote) {
		return `bitz-menu:${reel.id}`;
	}

	/** Open the Meme Studio with this reel's meme layout pre-applied — the
	 *  remix chain (§17 creator economy). Non-meme bitz still work: the studio
	 *  opens with the source media only and the creator adds their own spin. */
	function remixReel(reel: ReelNote) {
		popovers.close();
		const layout = remixLayoutOf(reel.tags);
		const reelRights = rightsOf(reel.tags);
		// S-013 advisory gate: restrictive licenses never hide the feature —
		// the creator is asked first, then the studio opens as usual (§17.3:
		// policy is advisory across the open network).
		if (canRemix(reelRights).requiresAsk) {
			const proceed = window.confirm(
				`This creator marked this bitz “${reelRights.license}”.\n\nRemix anyway? (Credit is added automatically when you publish.)`
			);
			if (!proceed) return;
		}
		remixHandoff = {
			eventId: reel.id,
			pubkey: reel.pubkey,
			label: bitzAuthorName(reel) || captionFor(reel).slice(0, 40) || 'a bitz',
			mediaUrl: reel.mediaUrl,
			mediaType: reel.mediaType,
			overlays: layout?.overlays ?? [],
			sfxCues: layout?.sfxCues ?? [],
			relays: [...new Set([...(remixOf(reel.tags)?.relays ?? []), ...relays.writeUrls])].slice(0, 3)
		};
		// /create owns the studio bundle now — hand off and navigate.
		studioHandoff.openInStudio('meme', remixHandoff);
	}

	async function copyText(value: string, label: string) {
		try {
			await navigator.clipboard.writeText(value);
			toasts.success(`${label} copied`);
		} catch {
			toasts.error(`Could not copy ${label.toLowerCase()}`);
		} finally {
			popovers.close();
		}
	}

	function showRawReel(reel: ReelNote) {
		popovers.close();
		rawReelJson = JSON.stringify(
			{
				id: reel.id,
				pubkey: reel.pubkey,
				created_at: reel.createdAt,
				kind: 'media',
				tags: reel.tags,
				content: reel.content,
				zapTotalSats: reel.zapTotalSats
			},
			null,
			2
		);
		rawReelOpen = true;
	}

	function notInterestedIn(reel: ReelNote) {
		interactionProfile.dismissNote(reel.id);
		feed.hideNote(reel.id);
		removeReel(reel);
		toasts.success("Got it — we'll show less like this");
		popovers.close();
	}

	function toggleMuteAuthorOf(reel: ReelNote, name: string) {
		const muted = interactionProfile.toggleMutedAuthor(reel.pubkey);
		toasts.info(muted ? `Showing less from ${name}` : `Showing more from ${name}`);
		popovers.close();
	}

	function toggleMuteTag(tag: string) {
		const muted = interactionProfile.toggleMutedTag(tag);
		toasts.info(muted ? `Showing less about #${tag}` : `Showing more about #${tag}`);
		popovers.close();
	}

	function muteAuthorOf(reel: ReelNote, name: string) {
		feed.muteAuthor(reel.pubkey);
		removeReel(reel);
		toasts.info(`Muted ${name}`);
		popovers.close();
	}

	function blockAuthorOf(reel: ReelNote, name: string) {
		if (feed.blockAuthor(reel.pubkey)) toasts.success(`Blocked ${name}`);
		else toasts.info(`${name} is already blocked`);
		removeReel(reel);
		popovers.close();
	}

	/** Drops the bitz everywhere on the page: player lists, cache, session. */
	function removeReel(reel: ReelNote) {
		reels = reels.filter((item) => item.id !== reel.id);
		renderedReelCount = Math.min(renderedReelCount, Math.max(INITIAL_RENDERED_REELS, reels.length));
		revealedSensitiveReels = Object.fromEntries(
			Object.entries(revealedSensitiveReels).filter(([id]) => id !== reel.id)
		);
		delete gridVideoDurations[reel.id];
		exploreVisible = Math.min(exploreVisible, exploreReels.length);
	}

	async function deleteReel() {
		const reel = pendingDeleteReel;
		if (!reel || deletingReel || reel.pubkey !== identity.current?.pk) return;
		deletingReel = true;
		try {
			await feed.deleteNote(reel);
			pendingDeleteReel = null;
			deleteReelOpen = false;
			removeReel(reel);
			toasts.success('Deletion request published');
		} catch (e) {
			toasts.error((e as Error).message || 'Could not publish deletion request');
		} finally {
			deletingReel = false;
		}
	}

	function mergeReelLists(existing: ReelNote[], incoming: ReelNote[]) {
		// Transient merge index — discarded per call.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const merged = new Map<string, ReelNote>();
		for (const reel of existing) merged.set(reel.id, reel);
		for (const reel of incoming) merged.set(reel.id, reel);
		return [...merged.values()].sort((a, b) => b.createdAt - a.createdAt);
	}

	function discoveryUrls() {
		if (!algorithmPreferences.relayDiscovery.reels) return [];
		return DISCOVERY_RELAY_URLS.filter((url) => !relays.urls.includes(url));
	}

	function mergeEvents(
		configured: Awaited<ReturnType<typeof queryPrimaryFirst>>,
		discovered: Awaited<ReturnType<typeof queryUrls>>
	) {
		// Transient dedupe index — discarded per call.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const newestByKey = new Map<string, (typeof configured)[number]>();
		for (const event of [...configured, ...discovered]) {
			// Addressable reels (34235/34236) dedupe by their NostrEventRef key
			// so only the newest version survives the merge (F-016).
			const key = eventRefKey(eventRefFor(event)!);
			const current = newestByKey.get(key);
			if (
				!current ||
				event.created_at > current.created_at ||
				(event.created_at === current.created_at && event.id.localeCompare(current.id) < 0)
			) {
				newestByKey.set(key, event);
			}
		}
		return [...newestByKey.values()];
	}

	function discoveryOnlyIds(
		configured: Awaited<ReturnType<typeof queryPrimaryFirst>>,
		discovered: Awaited<ReturnType<typeof queryUrls>>
	) {
		const configuredIds = new Set(configured.map((event) => event.id));
		return new Set(
			discovered.filter((event) => !configuredIds.has(event.id)).map((event) => event.id)
		);
	}

	function applyReels(next: ReelNote[], options: { append?: boolean } = {}) {
		// PUB-013: a just-published bitz stages its optimistic reel immediately,
		// but relay refreshes can lag behind it. Carry reels whose event is still
		// pending in the PUB-012 outbox through a full refresh so the player never
		// flashes the fresh bitz away; the relay echo carries the same event id
		// and reconciles in place — never a duplicate entry.
		const pendingIds = new Set(pendingOutbox().map((entry) => entry.event.id));
		const carried = options.append
			? []
			: reels.filter(
					(reel) => pendingIds.has(reel.id) && !next.some((incoming) => incoming.id === reel.id)
				);
		reels = options.append ? mergeReelLists(reels, next) : [...carried, ...next];
		renderedReelCount = options.append
			? Math.min(reels.length, Math.max(renderedReelCount, INITIAL_RENDERED_REELS))
			: Math.min(INITIAL_RENDERED_REELS, reels.length);
		if (identity.current) profiles.ensure([identity.current.pk]);
		profiles.ensure(
			reels.slice(0, Math.max(renderedReelCount, INITIAL_RENDERED_REELS)).map((reel) => reel.pubkey)
		);
		for (const reel of next) feed.upsertNote(reel);
		// Author playback never overwrites the global Bitz session — returning
		// to /bitz must restore the user's own feed, tabs and scroll position.
		if (authorMode) return;
		bitzSession.reels = reels;
		bitzSession.renderedReelCount = renderedReelCount;
	}

	function loadCachedReels() {
		try {
			const raw = localStorage.getItem(REELS_CACHE_KEY);
			if (!raw) return false;
			const cached = JSON.parse(raw) as ReelsCache;
			if (!cached?.savedAt || Date.now() - cached.savedAt > REELS_CACHE_TTL_MS) return false;
			if (!Array.isArray(cached.reels) || !cached.reels.length) return false;
			applyReels(cached.reels);
			// Treat the small cached snapshot as the first page. Restoring its
			// cursor lets the next scroll request continue directly from relays.
			oldestReelEventCreatedAt = Math.min(...cached.reels.map((reel) => reel.createdAt));
			hasMoreReels = Number.isFinite(oldestReelEventCreatedAt) && oldestReelEventCreatedAt > 0;
			return true;
		} catch {
			return false;
		}
	}

	function saveReelsCache(next: ReelNote[]) {
		if (authorMode) return; // never seed the global cache from author playback
		try {
			localStorage.setItem(
				REELS_CACHE_KEY,
				JSON.stringify({ savedAt: Date.now(), reels: next.slice(0, MAX_CACHED_REELS) })
			);
		} catch {
			/* Cache is best-effort only. */
		}
	}

	async function updateReelWindow(
		events: Awaited<ReturnType<typeof queryPrimaryFirst>>,
		options: { append?: boolean; discoveryIds?: Set<string> } = {}
	) {
		const nextReels = await buildReelsFromEvents(events, options.discoveryIds);
		applyReels(nextReels, options);
		const oldestSeen =
			events
				.slice()
				.sort((a, b) => b.created_at - a.created_at)
				.at(-1)?.created_at ?? 0;
		// The pagination cursor may only move backwards. Progressive appends pass
		// only *new* events, so their oldest can be newer than the walk cursor —
		// moving forward would re-fetch the same window forever.
		oldestReelEventCreatedAt = oldestReelEventCreatedAt
			? Math.min(oldestReelEventCreatedAt, oldestSeen || oldestReelEventCreatedAt)
			: oldestSeen;
		if (!authorMode) {
			bitzSession.oldestReelEventCreatedAt = oldestReelEventCreatedAt;
			bitzSession.hasMoreReels = hasMoreReels;
		}
		// Relays may return short pages even when older events remain. Keep the
		// cursor alive until a subsequent all-relays request returns nothing.
		hasMoreReels = !!oldestReelEventCreatedAt;
		if (!authorMode) saveReelsCache(options.append ? reels : nextReels);
	}

	async function buildReelsFromEvents(
		events: Awaited<ReturnType<typeof queryPrimaryFirst>>,
		discoveryIds = new Set<string>()
	) {
		const seen: Record<string, true> = {};
		const baseReels = latestAddressableEvents(events)
			.sort((a, b) => b.created_at - a.created_at)
			// READ-001: parsing lives in the repository fn — the route consumes
			// domain ReelNotes, never raw events (mirrors plan §6.2 BitzVideo).
			.map((event) => ({ event, reel: toReelNote(event) }))
			.filter(({ event, reel }) => {
				const key = eventRefKey(eventRefFor(event)!);
				if (!reel || seen[key]) return false;
				seen[key] = true;
				return true;
			})
			.map(({ event, reel }) => ({
				...reel!,
				source: discoveryIds.has(event.id) ? ('discovery' as const) : ('configured' as const)
			}));
		const reelIds = baseReels.map((reel) => reel.id);
		const activity = reelIds.length
			? await queryPrimaryFirst([
					{
						kinds: [
							NOSTR_KINDS.REACTION,
							NOSTR_KINDS.POLL_RESPONSE,
							NOSTR_KINDS.REPOST,
							NOSTR_KINDS.GENERIC_REPOST,
							NOSTR_KINDS.ZAP,
							NOSTR_KINDS.COMMENT,
							NOSTR_KINDS.TEXT_NOTE
						],
						'#e': reelIds,
						limit: 500
					}
				])
			: [];
		const nextReels = applyActivityToNotes(baseReels, activity, identity.current?.pk).map(
			(note) => ({
				...note,
				mediaUrl: baseReels.find((reel) => reel.id === note.id)?.mediaUrl ?? '',
				mediaType: baseReels.find((reel) => reel.id === note.id)?.mediaType ?? 'video',
				mediaFallbacks: baseReels.find((reel) => reel.id === note.id)?.mediaFallbacks ?? []
			})
		);
		for (const event of activity.filter(
			(event) => event.kind === NOSTR_KINDS.TEXT_NOTE || event.kind === NOSTR_KINDS.COMMENT
		)) {
			const reply = toFeedNote(event);
			if (reply.replyTo && reelIds.includes(reply.replyTo)) feed.upsertNote(reply);
		}
		return nextReels;
	}

	async function loadReels(options: { background?: boolean } = {}) {
		if (!options.background) loading = true;
		try {
			// Author mode: every filter is scoped to one author; discovery relays
			// never contribute (the profile grid is configured-relay territory).
			const authorFilter = authorPubkey ? { authors: [authorPubkey] } : {};
			const filters = [
				{ kinds: REEL_MEDIA_KINDS, limit: REELS_MEDIA_INITIAL_LIMIT, ...authorFilter },
				{ kinds: [NOSTR_KINDS.TEXT_NOTE], limit: REELS_TEXT_INITIAL_LIMIT, ...authorFilter }
			];
			const discoveryPromise = queryUrls(authorMode ? [] : discoveryUrls(), filters);
			const events = await queryPrimaryFirst(filters, {
				onSecondary: (mergedEvents) => {
					void discoveryPromise.then((discovered) =>
						updateReelWindow(mergeEvents(mergedEvents, discovered), {
							discoveryIds: discoveryOnlyIds(mergedEvents, discovered)
						})
					);
				}
			});
			const discovered = await discoveryPromise;
			await updateReelWindow(mergeEvents(events, discovered), {
				discoveryIds: discoveryOnlyIds(events, discovered)
			});
		} catch (e) {
			if (!options.background) toasts.error((e as Error).message || 'Could not load reels');
		} finally {
			loading = false;
			// Author playback must not mark the global session fresh — returning to
			// /bitz should still get its own background refresh when stale.
			if (!authorMode) bitzSession.lastRefreshedAt = Date.now();
		}
	}

	async function loadMoreReels() {
		if (loading || loadingMoreReels || !hasMoreReels || !oldestReelEventCreatedAt) return;
		loadingMoreReels = true;
		try {
			let foundMedia = 0;
			let exhausted = false;
			for (
				let batch = 0;
				batch < MAX_REEL_QUERY_BATCHES && foundMedia < REELS_MEDIA_PAGE_SIZE;
				batch += 1
			) {
				// Media kinds come back as ready-made bitz (no walking needed); the
				// kind-1 window is what the cursor walks past. Same round trip.
				const authorFilter = authorPubkey ? { authors: [authorPubkey] } : {};
				const filters = [
					{
						kinds: REEL_MEDIA_KINDS,
						limit: REELS_MEDIA_PAGE_LIMIT,
						until: oldestReelEventCreatedAt - 1,
						...authorFilter
					},
					{
						kinds: [NOSTR_KINDS.TEXT_NOTE],
						limit: REELS_QUERY_BATCH_LIMIT,
						until: oldestReelEventCreatedAt - 1,
						...authorFilter
					}
				];
				// Match Discover pagination: query every configured read relay together,
				// rather than treating an empty primary relay as the end of the feed.
				// maxWait keeps one stalled relay from freezing the walk.
				const events = await queryUrls(relays.orderedReadUrls, filters, {
					maxWait: REELS_PAGE_MAX_WAIT_MS
				});
				if (!events.length) {
					exhausted = true;
					break;
				}
				// Only *new* media fills the page budget. Relays happily resend events
				// we already hold inside an `until` window; counting those made the
				// walk finish with zero new bitz (the "load more does nothing" bug).
				const known: Record<string, true> = {};
				for (const reel of reels) known[reel.id] = true;
				const fresh = events.filter((event) => !known[event.id]);
				foundMedia += fresh.filter((event) => !!toReelNote(event)).length;
				// Apply each batch as it lands so bitz stream in immediately instead
				// of appearing only after the whole backwards walk finishes.
				if (fresh.length) await updateReelWindow(mergeEvents(fresh, []), { append: true });
				// Advance with the oldest raw event, even if the batch has no media.
				// The next request therefore never repeats the same text-only page.
				const oldestInBatch = Math.min(...events.map((event) => event.created_at));
				const cursorAdvanced = oldestInBatch < oldestReelEventCreatedAt;
				oldestReelEventCreatedAt = Math.min(oldestInBatch, oldestReelEventCreatedAt);
				// A relay that ignores `until` would keep returning the same window;
				// stop when the cursor is stuck and nothing new arrived.
				if (!cursorAdvanced && !fresh.length) {
					exhausted = true;
					break;
				}
			}
			if (exhausted) hasMoreReels = false;
		} catch (e) {
			toasts.error((e as Error).message || 'Could not load more reels');
		} finally {
			loadingMoreReels = false;
		}
	}

	function renderMoreReels() {
		if (!hasMoreRenderedReels) return;
		renderedReelCount = Math.min(reels.length, renderedReelCount + REEL_RENDER_BATCH);
		profiles.ensure(reels.slice(0, renderedReelCount).map((reel) => reel.pubkey));
		void ensureMoreReelsBuffered();
	}

	async function ensureMoreReelsBuffered() {
		if (loading || loadingMoreReels || !hasMoreReels) return;
		if (reels.length - renderedReelCount > REEL_PREFETCH_THRESHOLD) return;
		await loadMoreReels();
	}

	/** Explore uses its own visible-tile counter, so it cannot use the snap
	 * player's render-buffer guard above. */
	async function loadMoreExploreReels() {
		if (loading || loadingMoreReels || !hasMoreReels) return;
		const before = reels.length;
		await loadMoreReels();
		if (reels.length === before) return;
		// Reveal the freshly fetched page right away: while pinned to the bottom
		// no scroll event fires, so without this the grid would stall until the
		// user nudges the scrollbar.
		exploreVisible = Math.min(exploreReels.length, exploreVisible + EXPLORE_PAGE_SIZE);
		// One load targets one reveal page; if the relay walk came up short but
		// older bitz remain, keep the flow going until a full page is buffered.
		if (exploreVisible >= exploreReels.length && hasMoreReels) {
			void loadMoreExploreReels();
		}
	}

	function handleReelScroll() {
		if (!reelScroller) return;
		if (!authorMode)
			bitzSession.activeReelIndex = Math.round(reelScroller.scrollTop / reelScroller.clientHeight);
		const remaining =
			reelScroller.scrollHeight - reelScroller.scrollTop - reelScroller.clientHeight;
		if (remaining < reelScroller.clientHeight * 2) renderMoreReels();
		if (remaining < reelScroller.clientHeight * 3) void ensureMoreReelsBuffered();
		if (commentReel) {
			const activeReel = reelAtScrollPosition();
			if (activeReel && activeReel.id !== commentReel.id) {
				commentReel = activeReel;
				commentReplyTarget = null;
				void loadComments(activeReel);
			}
		}
	}

	function reelAtScrollPosition() {
		if (!reelScroller || !renderedReels.length) return null;
		const index = Math.max(
			0,
			Math.min(
				renderedReels.length - 1,
				Math.round(reelScroller.scrollTop / reelScroller.clientHeight)
			)
		);
		return renderedReels[index] ?? null;
	}

	function activeReelIndex() {
		if (!renderedReels.length) return 0;
		if (activeReelId) {
			const index = renderedReels.findIndex((reel) => reel.id === activeReelId);
			if (index >= 0) return index;
		}
		if (!reelScroller) return 0;
		return Math.max(
			0,
			Math.min(
				renderedReels.length - 1,
				Math.round(reelScroller.scrollTop / reelScroller.clientHeight)
			)
		);
	}

	function registerReelVideo(reelId: string, node: HTMLVideoElement | null) {
		const previous = reelVideos.get(reelId);
		if (previous) previous.ontimeupdate = null;

		if (node) {
			reelVideos.set(reelId, node);
			node.muted = reelId === activeReelId ? activeReelMuted : true;
			void syncActivePlayback();
			return;
		}
		reelVideos.delete(reelId);
	}

	function registerReelCard(reelId: string, node: HTMLDivElement | null) {
		const previous = reelCards.get(reelId);
		if (previous && visibilityObserver) visibilityObserver.unobserve(previous);

		if (!node) {
			reelCards.delete(reelId);
			reelVisibility.delete(reelId);
			if (activeReelId === reelId) updateActiveReel();
			return;
		}

		reelCards.set(reelId, node);
		if (visibilityObserver) visibilityObserver.observe(node);
	}

	function trackReelCard(node: HTMLDivElement, reelId: string) {
		registerReelCard(reelId, node);
		return {
			destroy() {
				registerReelCard(reelId, null);
			}
		};
	}

	function updateActiveReel() {
		let nextId = '';
		let bestVisibility = 0;

		for (const reel of renderedReels) {
			const visibility = reelVisibility.get(reel.id) ?? 0;
			if (visibility > bestVisibility) {
				bestVisibility = visibility;
				nextId = reel.id;
			}
		}

		if (!nextId && renderedReels.length) nextId = renderedReels[0].id;
		if (nextId === activeReelId) return;
		activeReelId = nextId;
		void syncActivePlayback();
	}

	async function syncActivePlayback() {
		for (const [reelId, video] of reelVideos) {
			if (reelId !== activeReelId) {
				video.muted = true;
				video.pause();
				continue;
			}
			video.muted = activeReelMuted;
			try {
				await video.play();
			} catch {
				/* Autoplay can be blocked until the browser allows playback. */
			}
		}
	}

	function createVisibilityObserver() {
		if (typeof IntersectionObserver === 'undefined') return null;
		return new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					const reelId = (entry.target as HTMLElement).dataset.reelId;
					if (!reelId) continue;
					reelVisibility.set(reelId, entry.isIntersecting ? entry.intersectionRatio : 0);
				}
				updateActiveReel();
			},
			{
				root: reelScroller,
				threshold: [0.25, 0.5, 0.6, 0.75, 0.9]
			}
		);
	}

	function scrollToReel(delta: -1 | 1) {
		if (!reelScroller || !renderedReels.length) return;
		const current = activeReelIndex();
		const target = current + delta;
		if (target < 0) return;
		if (target >= renderedReels.length) {
			if (!hasMoreRenderedReels) {
				void ensureMoreReelsBuffered();
				return;
			}
			renderMoreReels();
			requestAnimationFrame(() => scrollToReel(delta));
			return;
		}
		reelScroller.scrollTo({
			top: target * reelScroller.clientHeight,
			behavior: 'smooth'
		});
		if (commentReel) {
			const next = renderedReels[target];
			if (next) {
				commentReel = next;
				commentReplyTarget = null;
				void loadComments(next);
			}
		}
	}

	/** Desktop power moves: ↑/↓ jump reels, Space/K play-pause, M mute,
	 * F fullscreen, ←/→ seek 5s. Ignored while typing in the comments box. */
	function handleKeydown(event: KeyboardEvent) {
		// The search overlay owns the keyboard while open; Esc dismisses it.
		if (search.open) {
			if (event.key === 'Escape') {
				event.preventDefault();
				search.close();
			}
			return;
		}
		const target = event.target as HTMLElement | null;
		// Never steal keys while typing…
		if (target?.closest('input, textarea, select, [contenteditable]')) return;
		// The Explore grid owns the page — no reel shortcuts there.
		if (bitzMode === 'explore') return;
		// …and let Space activate a focused control (buttons, links, dialogs).
		if (
			(event.key === ' ' || event.key === 'Enter') &&
			target?.closest('button, a, [role="button"], [data-dialog]')
		)
			return;
		const activeVideo = activeReelId ? reelVideos.get(activeReelId) : undefined;
		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				scrollToReel(1);
				break;
			case 'ArrowUp':
				event.preventDefault();
				scrollToReel(-1);
				break;
			case ' ':
			case 'k':
			case 'K':
				event.preventDefault();
				if (activeVideo) {
					if (activeVideo.paused) void activeVideo.play();
					else activeVideo.pause();
				}
				break;
			case 'm':
			case 'M':
				activeReelMuted = !activeReelMuted;
				break;
			case 'f':
			case 'F':
				// Fullscreen the whole reel card so the rail + captions stay visible.
				if (document.fullscreenElement) void document.exitFullscreen();
				else if (activeReelId)
					reelCards
						.get(activeReelId)
						?.requestFullscreen()
						.catch(() => {
							/* Fullscreen can be blocked in embedded browsers. */
						});
				break;
			case 'ArrowLeft':
				if (activeVideo && Number.isFinite(activeVideo.duration))
					activeVideo.currentTime = Math.max(0, activeVideo.currentTime - 5);
				break;
			case 'ArrowRight':
				if (activeVideo && Number.isFinite(activeVideo.duration))
					activeVideo.currentTime = Math.min(activeVideo.duration, activeVideo.currentTime + 5);
				break;
		}
	}

	/** Every reply in the reel's thread: top-level comments carry the reel as
	 * their reply tag, nested replies carry it as their NIP-10 root tag. NIP-22
	 * comments reference the reel via the uppercase E root tag instead. Powers
	 * the comment counters. */
	function commentsFor(reelId: string) {
		return feed.notes
			.filter(
				(note) =>
					note.id !== reelId &&
					note.tags.some((tag) => (tag[0] === 'e' || tag[0] === 'E') && tag[1] === reelId)
			)
			.sort((a, b) => a.createdAt - b.createdAt);
	}

	/** Two-level thread layout, same as feed cards: top-level comments reply
	 * directly to the reel; everything else nests under its top-level ancestor
	 * (a reply to a level-2 comment renders flat beside it — never a third
	 * indent). Orphans whose parent sits behind the pagination cut, and cyclic
	 * replyTo chains, fall back to top-level so nothing ever vanishes. */
	function commentTree(reelId: string): {
		top: FeedNote[];
		children: SvelteMap<string, FeedNote[]>;
	} {
		const thread = commentsFor(reelId);
		const byId = new Map(thread.map((note) => [note.id, note]));
		const isTopLevel = (note: FeedNote) => !note.replyTo || note.replyTo === reelId;
		/** The top-level comment this note nests under, or null = render top-level. */
		const parentGroupId = (note: FeedNote): string | null => {
			let current = note;
			// Guard against cyclic replyTo chains: stop after thread.length hops.
			for (let hops = 0; hops < thread.length; hops += 1) {
				if (isTopLevel(current)) return null;
				const parent = byId.get(current.replyTo!);
				if (!parent) return null; // orphan — keep it visible at top level
				if (isTopLevel(parent)) return parent.id;
				current = parent;
			}
			return null; // cycle — bail out as top-level
		};
		const top: FeedNote[] = [];
		const children = new SvelteMap<string, FeedNote[]>();
		for (const note of thread) {
			const pid = parentGroupId(note);
			if (pid === null) top.push(note);
			else children.set(pid, [...(children.get(pid) ?? []), note]);
		}
		return { top, children };
	}

	async function toggleLike(reel: ReelNote) {
		feed.upsertNote(reel);
		try {
			await feed.react(reel, '❤️');
			const updated = feed.notes.find((note) => note.id === reel.id);
			if (updated)
				reels = reels.map((item) => (item.id === reel.id ? { ...item, ...updated } : item));
		} catch (e) {
			toasts.error((e as Error).message);
		}
	}

	/** Double-tap anywhere on the video: like (never unlike) + a burst of
	 * hearts at the tap point — the reflex interaction every reels app needs.
	 * The video element always fills the card (letterboxed inside when in full
	 * view), so video-relative coords are card-relative too. */
	async function likeAtTap(reel: ReelNote, x: number, y: number) {
		spawnBurst(reel.id, '❤️', `${x}px`, `${y}px`, 9);
		if (reel.reactions.some((reaction) => reaction.byMe)) return;
		await toggleLike(reel);
	}

	function spawnBurst(reelId: string, emoji: string, left: string, top: string, count = 7) {
		const next: Burst[] = Array.from({ length: count }, () => ({
			id: ++burstSeq,
			reelId,
			emoji,
			left,
			top,
			tx: Math.round((Math.random() - 0.5) * 130),
			rot: Math.round((Math.random() - 0.5) * 60),
			size: 16 + Math.round(Math.random() * 16),
			delay: Math.random() * 0.18
		}));
		bursts = [...bursts, ...next];
		const ids = new Set(next.map((b) => b.id));
		setTimeout(() => (bursts = bursts.filter((b) => !ids.has(b.id))), 1000);
	}

	function zapTotalFor(reel: ReelNote) {
		return reel.zapTotalSats + (optimisticZapSats[reel.id] ?? 0);
	}

	function openZap(reel: ReelNote) {
		zapReel = reel;
		zapOpen = true;
	}

	function handleZapPaid(sats: number) {
		const reel = zapReel;
		if (!reel) return;
		optimisticZapSats = {
			...optimisticZapSats,
			[reel.id]: (optimisticZapSats[reel.id] ?? 0) + sats
		};
		// Sats burst floating up from the action rail — payment should feel alive.
		spawnBurst(reel.id, '⚡', 'calc(100% - 68px)', '58%', 8);
	}

	$effect(() => {
		if (!zapOpen) zapReel = null;
	});

	function toggleSave(reel: ReelNote) {
		const isSaved = bookmarks.toggle(reel);
		toasts.success(isSaved ? 'Saved' : 'Removed from saved');
	}

	/** SOC-007/PUB-014: share a reel via Web Share (url + nostr entity text)
	 * and publish a NIP-18 kind-16 generic repost (correct form for non-kind-1
	 * events per S-002). Falls back to clipboard when the Share sheet is
	 * unavailable (desktop browsers). */
	async function shareReel(reel: ReelNote) {
		const webUrl = shareWebLink({ eventId: reel.id }, location.origin);
		if (navigator.share) {
			try {
				await navigator.share(sharePayload({ eventId: reel.id }, location.origin));
				toasts.success('Shared');
			} catch {
				// user dismissed the sheet — still fire the repost? No: dismissal
				// is not intent. Only abort quietly.
			}
			try {
				await feed.repost(reel);
			} catch {
				// Repost is best-effort; sharing itself succeeded.
			}
			return;
		}
		navigator.clipboard.writeText(webUrl);
		try {
			await feed.repost(reel);
			toasts.success('Reposted · Link copied');
		} catch {
			// The link is already useful on its own; a publish failure (e.g. no
			// raw event in this view) must not break sharing.
			toasts.success('Link copied');
		}
	}

	async function openComments(reel: ReelNote) {
		commentReel = reel;
		commentReplyTarget = null;
		await loadComments(reel);
	}

	async function loadComments(reel: ReelNote, options: { force?: boolean; more?: boolean } = {}) {
		const page = commentPages[reel.id];
		if (!options.force && !options.more && page?.loaded) return;
		if (options.more && (!page?.hasMore || !page.oldestCreatedAt)) return;
		loadingComments = true;
		try {
			// ADR-003 migration window: read both NIP-22 comments (kind 1111,
			// uppercase E root) and legacy kind-1 replies so old and new clients
			// see one merged thread.
			const filter: {
				kinds: number[];
				'#e': string[];
				limit: number;
				until?: number;
			} = {
				kinds: [NOSTR_KINDS.COMMENT, NOSTR_KINDS.TEXT_NOTE],
				'#e': [reel.id],
				limit: COMMENTS_PAGE_SIZE
			};
			if (options.more) filter.until = page!.oldestCreatedAt - 1;
			const replyEvents = await queryPrimaryFirst([filter]);
			// Keep the whole thread, not just direct replies: nested replies-to-
			// comments reference the reel through their NIP-10 root tag (or the
			// uppercase E tag on kind-1111 comments).
			const replies = replyEvents
				.map(toFeedNote)
				.filter((note) =>
					note.tags.some((tag) => (tag[0] === 'e' || tag[0] === 'E') && tag[1] === reel.id)
				);
			const replyIds = replies.map((reply) => reply.id);
			const reactions = replyIds.length
				? await queryPrimaryFirst([{ kinds: [NOSTR_KINDS.REACTION], '#e': replyIds, limit: 300 }])
				: [];
			const withActivity = applyActivityToNotes(replies, reactions, identity.current?.pk);
			for (const reply of withActivity) feed.upsertNote(reply);
			profiles.ensure(withActivity.map((reply) => reply.pubkey));
			const oldestInPage = replyEvents.reduce(
				(oldest, event) => Math.min(oldest, event.created_at),
				Number.POSITIVE_INFINITY
			);
			const oldestCreatedAt = Number.isFinite(oldestInPage)
				? Math.min(page?.oldestCreatedAt || Number.POSITIVE_INFINITY, oldestInPage)
				: page?.oldestCreatedAt || 0;
			commentPages = {
				...commentPages,
				[reel.id]: {
					loaded: true,
					oldestCreatedAt,
					hasMore: replyEvents.length >= COMMENTS_PAGE_SIZE && oldestCreatedAt > 0
				}
			};
		} catch (e) {
			toasts.error((e as Error).message || 'Could not load comments');
		} finally {
			loadingComments = false;
		}
	}

	async function loadMoreComments() {
		if (!commentReel || loadingComments || !activeCommentPage?.hasMore) return;
		await loadComments(commentReel, { more: true });
	}

	async function likeComment(comment: FeedNote) {
		try {
			await feed.react(comment, '❤️');
			if (commentReel) await loadComments(commentReel, { force: true });
		} catch (e) {
			toasts.error((e as Error).message);
		}
	}

	// --- Zap a reel comment ---
	let zapCommentTarget = $state<FeedNote | null>(null);
	let zapCommentOpen = $state(false);
	let optimisticCommentZaps = $state<Record<string, number>>({});
	const zapCommentProfile = $derived(
		zapCommentTarget ? profiles.get(zapCommentTarget.pubkey) : undefined
	);
	const zapCommentAddress = $derived(zapCommentProfile?.lud16 || zapCommentProfile?.lud06 || '');

	function commentZapSats(comment: FeedNote) {
		return comment.zapTotalSats + (optimisticCommentZaps[comment.id] ?? 0);
	}

	function zapComment(comment: FeedNote) {
		const profile = profiles.get(comment.pubkey);
		if (!profile?.lud16 && !profile?.lud06) {
			toasts.info('This author has no Lightning address');
			return;
		}
		zapCommentTarget = comment;
		zapCommentOpen = true;
	}

	function handleCommentZapPaid(sats: number) {
		if (!zapCommentTarget) return;
		optimisticCommentZaps = {
			...optimisticCommentZaps,
			[zapCommentTarget.id]: (optimisticCommentZaps[zapCommentTarget.id] ?? 0) + sats
		};
	}

	function askDeleteComment(comment: FeedNote) {
		if (comment.pubkey !== identity.current?.pk) return;
		commentPendingDelete = comment;
		deleteCommentOpen = true;
	}

	async function deleteComment() {
		const comment = commentPendingDelete;
		if (!comment || deletingCommentId || comment.pubkey !== identity.current?.pk) return;
		deletingCommentId = comment.id;
		try {
			await feed.deleteNote(comment);
			commentPendingDelete = null;
			deleteCommentOpen = false;
			toasts.success('Comment deleted');
		} catch (e) {
			toasts.error((e as Error).message || 'Could not delete comment');
		} finally {
			deletingCommentId = '';
		}
	}

	// --- Explore grid (Bitz · Explore tab) ----------------------------------

	function switchBitzMode(mode: BitzMode) {
		// Re-tapping the active tab is the standard "back to top" shortcut. It
		// replaces the old forced reset: position survives tab switches, and
		// returning to the top is an explicit user action instead of a penalty.
		if (bitzMode === mode) {
			const scroller = mode === 'explore' ? exploreScroller : reelScroller;
			scroller?.scrollTo({ top: 0, behavior: 'smooth' });
			return;
		}
		bitzMode = mode;
		if (mode === 'explore') {
			// Coming back to the grid must land on the tiles the user left behind
			// (tap tile → For you → Explore = same spot, not a scroll-from-scratch).
			// The scroller remounts in this branch, so restore after the DOM is
			// ready; exploreVisible already holds the revealed window and the scroll
			// offset lives in the session (kept fresh by handleExploreScroll).
			void tick().then(() => {
				requestAnimationFrame(() => {
					exploreScroller?.scrollTo({ top: bitzSession.exploreScrollTop });
				});
			});
		} else {
			// Fresh player mount: keep the first window visible and let the
			// visibility observer re-elect the active reel.
			renderedReelCount = Math.max(INITIAL_RENDERED_REELS, renderedReelCount);
			// Mirror of the grid fix: resume the snap player at the reel the user
			// last watched instead of dropping them back on reel 0.
			void tick().then(() => {
				requestAnimationFrame(() => {
					if (reelScroller && bitzSession.activeReelIndex > 0)
						reelScroller.scrollTo({
							top: bitzSession.activeReelIndex * reelScroller.clientHeight
						});
				});
			});
		}
	}

	function reelLikes(reel: ReelNote) {
		return reel.reactions.reduce((sum, reaction) => sum + reaction.count, 0);
	}

	function handleExploreScroll() {
		if (!exploreScroller) return;
		bitzSession.exploreScrollTop = exploreScroller.scrollTop;
		const remaining =
			exploreScroller.scrollHeight - exploreScroller.scrollTop - exploreScroller.clientHeight;
		if (remaining < exploreScroller.clientHeight * 2) {
			if (exploreVisible < exploreReels.length) {
				exploreVisible = Math.min(exploreReels.length, exploreVisible + EXPLORE_PAGE_SIZE);
			} else {
				void loadMoreExploreReels();
			}
		}
	}

	/** Sensitive tiles reveal on first tap; afterwards a tap jumps from the
	 *  grid straight into the snap player at that exact reel. */
	async function openFromExplore(reel: ReelNote) {
		const reason = sensitiveMediaReason(reel.tags, reel.content);
		if (
			privacyNotificationSettings.state.hideSensitiveMedia &&
			reason &&
			!revealedSensitiveReels[reel.id]
		) {
			revealedSensitiveReels = { ...revealedSensitiveReels, [reel.id]: true };
			return;
		}
		// Snapshot the grid offset before leaving: onscroll keeps the session
		// fresh, but persisting here guarantees the return-to-Explore restore.
		if (exploreScroller) bitzSession.exploreScrollTop = exploreScroller.scrollTop;
		const index = rankedReels.findIndex((item) => item.id === reel.id);
		bitzMode = 'foryou';
		if (index < 0) return;
		renderedReelCount = Math.max(renderedReelCount, index + REEL_RENDER_BATCH);
		profiles.ensure(rankedReels.slice(0, renderedReelCount).map((item) => item.pubkey));
		await tick();
		requestAnimationFrame(() => {
			reelScroller?.scrollTo({ top: index * reelScroller.clientHeight });
		});
	}

	// --- Deep link: /bitz#reel=<event id> opens that bitz in the player -------
	// “View in Bitz” in the post-success toast lands here. The just-published
	// event may take a moment to come back from the relays, so the pending id
	// waits (bounded) for any reels refresh to deliver it.
	let pendingDeepLinkId = $state('');
	let deepLinkTimeout: ReturnType<typeof setTimeout> | undefined;

	function deepLinkReelIdFromHash() {
		const hash = window.location.hash;
		// #reel=<hex> (in-app) or #reel=<nevent1…> (portable inbound, PUB-014)
		const match = /^#reel=([0-9a-f]{64})$/i.exec(hash);
		if (match) return match[1].toLowerCase();
		const entity = /^#reel=(nevent1[02-9a-z]+)$/i.exec(hash);
		if (entity) {
			try {
				const decoded = nip19Decode(entity[1].toLowerCase());
				return decoded.type === 'nevent' ? decoded.data.id : '';
			} catch {
				return '';
			}
		}
		return '';
	}

	function handleDeepLinkHash() {
		const id = deepLinkReelIdFromHash();
		if (!id || pendingDeepLinkId === id) return;
		pendingDeepLinkId = id;
		clearTimeout(deepLinkTimeout);
		deepLinkTimeout = setTimeout(() => {
			if (pendingDeepLinkId) {
				pendingDeepLinkId = '';
				toasts.info('Your bitz is still syncing across relays — check back in a moment.');
			}
		}, 10_000);
	}

	$effect(() => {
		const id = pendingDeepLinkId;
		if (!id || loading) return;
		const reel = reels.find((item) => item.id === id);
		if (!reel) return;
		pendingDeepLinkId = '';
		clearTimeout(deepLinkTimeout);
		void openFromExplore(reel).then(() => {
			history.replaceState(null, '', window.location.pathname + window.location.search);
		});
	});

	// Mirror UI state into the session so a route switch and return restores
	// exactly this view. (reels/cursor mirror imperatively in applyReels —
	// async relay loads can land after this component unmounts.)
	$effect(() => {
		// Author playback is a transient view — it must never leak its tab,
		// reveal or render state into the global Bitz session.
		if (authorMode) return;
		bitzSession.bitzMode = bitzMode;
		bitzSession.exploreVisible = exploreVisible;
		bitzSession.revealedSensitiveReels = revealedSensitiveReels;
		bitzSession.renderedReelCount = renderedReelCount;
	});

	// The Explore grid reveals tiles through its own counter (exploreVisible),
	// so it never passes through renderMoreReels' profile prefetch. Keep author
	// metadata (names/avatars) flowing for exactly the tiles on screen;
	// profiles.ensure dedupes in-flight requests and skips fresh (12h) entries.
	$effect(() => {
		if (bitzMode !== 'explore') return;
		void profiles.ensure(visibleExploreReels.map((reel) => reel.pubkey));
	});

	onMount(() => {
		handleDeepLinkHash();
		if (authorPubkey) void profiles.ensure([authorPubkey]);
		visibilityObserver = createVisibilityObserver();
		for (const node of reelCards.values()) visibilityObserver?.observe(node);
		// The former cache could retain 120 items. Drop it once after moving to
		// the intentionally small v3 cache.
		try {
			localStorage.removeItem(LEGACY_REELS_CACHE_KEY);
		} catch {
			/* Storage cleanup is best-effort. */
		}

		const handleFullscreenChange = () => {
			if (document.fullscreenElement) return;
			void syncActivePlayback();
		};
		document.addEventListener('fullscreenchange', handleFullscreenChange);

		// Returning from another page: hydrate the in-memory session for an
		// instant paint with the previous tab, position, and cursor intact.
		// Author mode starts from its own author-scoped fetch instead.
		let hydrated = false;
		if (!authorMode && bitzSession.reels.length) {
			loading = false;
			// PUB-013: an optimistic reel staged by a fresh publish (feed.postBitz
			// → stageOptimisticReel) reconciles here — same-id entries are
			// idempotent no-ops, so the optimistic copy and the relay echo never
			// produce a duplicate player entry. Fold oldest→newest so the
			// head-prepend reconciliation restores newest-first order.
			reels = [...bitzSession.reels]
				.reverse()
				.reduce<ReelNote[]>((acc, reel) => reconcileOptimisticReel(acc, reel).reels, []);
			renderedReelCount = Math.max(
				INITIAL_RENDERED_REELS,
				Math.min(bitzSession.renderedReelCount || INITIAL_RENDERED_REELS, reels.length)
			);
			bitzMode = bitzSession.bitzMode;
			exploreVisible = Math.max(EXPLORE_INITIAL_VISIBLE, bitzSession.exploreVisible);
			revealedSensitiveReels = bitzSession.revealedSensitiveReels;
			oldestReelEventCreatedAt = bitzSession.oldestReelEventCreatedAt;
			hasMoreReels = bitzSession.hasMoreReels && !!oldestReelEventCreatedAt;
			profiles.ensure(reels.slice(0, renderedReelCount).map((reel) => reel.pubkey));
			hydrated = true;
			void tick().then(() => {
				requestAnimationFrame(() => {
					if (bitzMode === 'explore')
						exploreScroller?.scrollTo({ top: bitzSession.exploreScrollTop });
					else if (reelScroller)
						reelScroller.scrollTo({
							top: bitzSession.activeReelIndex * reelScroller.clientHeight
						});
				});
			});
			if (Date.now() - bitzSession.lastRefreshedAt > BITZ_SESSION_REFRESH_MS) {
				void loadReels({ background: true });
			}
		}
		const hasCache = hydrated || authorMode ? false : loadCachedReels();
		if (hasCache) {
			loading = false;
			void loadReels({ background: true });
			void ensureMoreReelsBuffered();
		} else if (!hydrated) {
			void loadReels();
		}

		return () => {
			document.removeEventListener('fullscreenchange', handleFullscreenChange);
			clearTimeout(deepLinkTimeout);
			visibilityObserver?.disconnect();
			visibilityObserver = null;
			reelVideos.clear();
			reelCards.clear();
			reelVisibility.clear();
		};
	});
</script>

<svelte:head><title>Bitz · BitOS</title></svelte:head>

<svelte:window onkeydown={handleKeydown} onhashchange={handleDeepLinkHash} />

<div class="relative h-full bg-[var(--ui-bg)] text-[var(--ui-text)]">
	{#if loading}
		<div class="flex h-full items-center justify-center">
			<div
				class="size-8 animate-spin rounded-full border-2 border-[var(--ui-border)] border-t-primary-500"
			></div>
		</div>
	{:else if bitzMode === 'explore'}
		<!-- Explore: video-first grid, TikTok-discover style -->
		<div
			bind:this={exploreScroller}
			class="h-full [scrollbar-width:none] overflow-y-auto bg-[var(--ui-bg)] [&::-webkit-scrollbar]:hidden"
			onscroll={handleExploreScroll}
		>
			{#if visibleExploreReels.length}
				<div class="grid grid-cols-3 gap-1 px-2 pt-[76px] pb-4 sm:gap-1.5 sm:px-3">
					{#each visibleExploreReels as reel (reel.id)}
						{@const profile = profiles.get(reel.pubkey)}
						{@const name = profile?.display_name || profile?.name || shortKey(reel.pubkey)}
						{@const reelSensitiveReason = sensitiveMediaReason(reel.tags, reel.content)}
						{@const reelCovered =
							privacyNotificationSettings.state.hideSensitiveMedia &&
							!!reelSensitiveReason &&
							!revealedSensitiveReels[reel.id]}
						<button
							type="button"
							onclick={() => openFromExplore(reel)}
							class="group relative aspect-[9/16] overflow-hidden rounded-lg bg-[var(--ui-bg-muted)] text-left"
							aria-label="Open bitz by {name}"
						>
							{#if reel.mediaType === 'video'}
								<video
									use:lazyVideoMetadata
									src={reel.mediaUrl}
									class="absolute inset-0 size-full object-cover transition group-hover:scale-105 {reelCovered
										? 'scale-105 blur-2xl saturate-50'
										: ''}"
									playsinline
									preload="none"
									muted
									onmouseenter={(event) => {
										if (reelCovered) return;
										const video = event.currentTarget as HTMLVideoElement;
										video.muted = false;
										void video.play().catch(() => {
											// Browsers may block hover-triggered audio until the user
											// interacts with the page; keep hover preview working muted.
											video.muted = true;
											void video.play().catch(() => {});
										});
									}}
									onmouseleave={(event) => {
										const video = event.currentTarget as HTMLVideoElement;
										video.pause();
										video.currentTime = 0;
									}}
									onloadedmetadata={(event) => {
										const video = event.currentTarget as HTMLVideoElement;
										if (Number.isFinite(video.duration))
											gridVideoDurations = {
												...gridVideoDurations,
												[reel.id]: video.duration
											};
									}}
								></video>
								{#if gridVideoDurations[reel.id]}
									<span
										class="absolute top-1.5 right-1.5 rounded-md bg-black/60 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white tabular-nums backdrop-blur"
									>
										{formatDuration(gridVideoDurations[reel.id])}
									</span>
								{:else}
									<span
										class="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-black/50 text-white backdrop-blur"
										aria-hidden="true"
									>
										<Icon name="i-lucide-play" class="size-3 fill-current" />
									</span>
								{/if}
							{:else}
								<img
									src={reel.mediaUrl}
									alt={captionFor(reel) || 'Bitz picture'}
									class="absolute inset-0 size-full object-cover transition group-hover:scale-105 {reelCovered
										? 'scale-105 blur-2xl saturate-50'
										: ''}"
									loading="lazy"
								/>
							{/if}
							{#if reel.source === 'discovery'}
								<span
									class="absolute top-1.5 left-1.5 rounded-full bg-primary-500/80 px-1.5 py-0.5 text-[9px] font-bold text-white uppercase"
									>discovery</span
								>
							{/if}
							{#if reelCovered}
								<span
									class="absolute inset-0 z-10 grid place-items-center bg-black/30 text-center text-white"
								>
									<span class="flex flex-col items-center gap-1 text-[10px] font-bold">
										<Icon name="i-lucide-eye-off" class="size-5" />
										Sensitive
									</span>
								</span>
							{:else}
								<span
									class="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-2 pt-7 text-white opacity-90 transition group-hover:opacity-100"
								>
									{#if captionFor(reel)}
										<span class="line-clamp-1 text-[11px] leading-tight font-semibold">
											{captionFor(reel)}
										</span>
									{/if}
									<span class="flex min-w-0 items-center gap-1.5">
										<Avatar
											pubkey={reel.pubkey}
											{name}
											picture={profile?.picture}
											lightning={hasLightning(profile)}
											size={20}
											shape="hex"
										/>
										<span class="truncate text-[10px] font-bold">{name}</span>
										{#if profile?.nip05}
											<Icon name="i-lucide-badge-check" class="size-2.5 shrink-0 text-white/85" />
										{/if}
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
							{/if}
						</button>
					{/each}
				</div>
				<div class="flex flex-col items-center gap-2 px-4 pb-12">
					{#if visibleExploreReels.length < exploreReels.length}
						<button
							type="button"
							onclick={() =>
								(exploreVisible = Math.min(
									exploreReels.length,
									exploreVisible + EXPLORE_PAGE_SIZE
								))}
							class="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--ui-border-accented)] bg-[var(--ui-bg-muted)] px-5 text-[13px] font-bold text-[var(--ui-text)] transition hover:bg-[var(--ui-bg-accented)]"
						>
							<Icon name="i-lucide-plus" class="size-4" />
							Load more bitz
						</button>
					{:else if loadingMoreReels || hasMoreReels}
						<button
							type="button"
							onclick={() => void loadMoreExploreReels()}
							disabled={loadingMoreReels}
							class="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--ui-border-accented)] bg-[var(--ui-bg-muted)] px-5 text-[13px] font-bold text-[var(--ui-text)] transition hover:bg-[var(--ui-bg-accented)] disabled:cursor-default disabled:opacity-60"
						>
							<Icon
								name="i-lucide-loader-circle"
								class="size-4 {loadingMoreReels ? 'animate-spin' : 'hidden'}"
							/>
							{loadingMoreReels ? 'Loading older bitz' : 'Load older bitz'}
						</button>
					{:else}
						<p class="text-[11px] font-semibold text-[var(--ui-text-dimmed)]">
							That's all the bitz for now
						</p>
					{/if}
				</div>
			{:else}
				<div
					class="flex h-full flex-col items-center justify-center gap-3 px-6 pb-16 text-center text-[var(--ui-text)]"
				>
					<div
						class="grid size-14 place-items-center rounded-2xl bg-[var(--ui-bg-muted)] text-[var(--ui-text-dimmed)] ring-1 ring-[var(--ui-border-muted)]"
					>
						<Icon name="i-lucide-clapperboard" class="size-7" />
					</div>
					<div>
						<p class="text-[15px] font-bold">No bitz to explore yet</p>
						<p class="mt-1 text-[13px] text-[var(--ui-text-muted)]">
							Short videos and pictures from your relays will appear here.
						</p>
					</div>
					<button
						type="button"
						onclick={() => loadReels()}
						class="mt-2 rounded-full bg-primary-500 px-5 py-2.5 text-[13px] font-bold text-white shadow-[var(--glow-primary)] transition hover:bg-primary-600"
					>
						Refresh
					</button>
				</div>
			{/if}
		</div>
	{:else}
		<div
			bind:this={reelScroller}
			class="reel-container h-full snap-y snap-mandatory [scrollbar-width:none] overflow-y-auto transition-[padding] duration-200 {commentReel
				? 'lg:pr-[390px]'
				: ''} [&::-webkit-scrollbar]:hidden"
			onscroll={handleReelScroll}
		>
			{#if playbackReels.length}
				{#each renderedReels as reel (reel.id)}
					{@const profile = profiles.get(reel.pubkey)}
					{@const name = profile?.display_name || profile?.name || shortKey(reel.pubkey)}
					{@const reelSensitiveReason = sensitiveMediaReason(reel.tags, reel.content)}
					{@const reelCovered =
						privacyNotificationSettings.state.hideSensitiveMedia &&
						!!reelSensitiveReason &&
						!revealedSensitiveReels[reel.id]}
					<div
						use:trackReelCard={reel.id}
						data-reel-id={reel.id}
						class="reel-card relative flex h-full w-full snap-start items-center justify-center overflow-hidden bg-black text-white"
					>
						{#if reel.mediaType === 'video'}
							{@const fullView = reelViewMode === 'full'}
							<MediaPlayer
								src={reelSource(reel)}
								fallbackSrcs={reel.mediaFallbacks}
								label="Relay video note"
								mediaClass={fullView
									? `absolute inset-0 size-full object-contain ${
											reelCovered ? 'scale-105 blur-2xl saturate-50' : ''
										}`
									: `absolute inset-0 size-full object-cover ${
											reelCovered ? 'scale-105 blur-2xl saturate-50' : ''
										}`}
								variant="reel"
								loop
								muted={reel.id === activeReelId ? activeReelMuted : true}
								onMediaElement={(node) => {
									registerReelVideo(reel.id, node as HTMLVideoElement);
									return () => registerReelVideo(reel.id, null);
								}}
								onMutedChange={(nextMuted) => {
									if (reel.id === activeReelId) activeReelMuted = nextMuted;
								}}
								onDoubleTap={(x, y) => void likeAtTap(reel, x, y)}
							/>
						{:else}
							<img
								src={reel.mediaUrl}
								alt={reel.content || 'Relay picture note'}
								class="absolute inset-0 size-full object-cover {reelCovered
									? 'scale-105 blur-2xl saturate-50'
									: ''}"
							/>
						{/if}
						<div
							class="pointer-events-none absolute inset-0 z-30 overflow-hidden"
							aria-hidden="true"
						>
							{#each bursts.filter((burst) => burst.reelId === reel.id) as burst (burst.id)}
								<span
									class="reel-burst"
									style={`left:${burst.left}; top:${burst.top}; --tx:${burst.tx}px; --rot:${burst.rot}deg; font-size:${burst.size}px; animation-delay:${burst.delay}s`}
									>{burst.emoji}</span
								>
							{/each}
						</div>
						{#if reelCovered}
							<button
								type="button"
								class="absolute inset-0 z-20 grid place-items-center bg-black/20 p-4 text-center text-white"
								onclick={() =>
									(revealedSensitiveReels = { ...revealedSensitiveReels, [reel.id]: true })}
								aria-label="Show sensitive reel"
							>
								<span class="max-w-56 rounded-3xl bg-black/45 px-5 py-4 backdrop-blur-md">
									<Icon name="i-lucide-eye-off" class="mx-auto mb-2 size-6" />
									<span class="block text-[14px] font-bold">Sensitive media</span>
									{#if privacyNotificationSettings.state.sensitiveReason}
										<span class="mt-1 block text-[11px] text-white/75">{reelSensitiveReason}</span>
									{/if}
									<span
										class="mt-3 inline-flex rounded-full bg-white px-3 py-1 text-[11px] font-bold text-black"
										>View</span
									>
								</span>
							</button>
						{/if}
						<div
							class="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/70"
						></div>

						<div
							class="absolute right-4 bottom-24 z-10 flex flex-col gap-5 transition-[right] duration-200 {commentReel
								? 'lg:right-24'
								: ''}"
						>
							<button
								type="button"
								onclick={() => openZap(reel)}
								disabled={!profile?.lud16 && !profile?.lud06}
								class="reel-action disabled:opacity-45"
								aria-label={zapTotalFor(reel)
									? `Zap — ${zapTotalFor(reel)} sats total`
									: 'Zap sats'}
							>
								<span class="icon-circle is-zap">
									<Icon name="i-lucide-zap" class="size-5 fill-current" />
								</span>
								<span class="text-[11px] font-semibold tabular-nums">
									{zapTotalFor(reel) ? `${compactSats(zapTotalFor(reel))} sats` : 'Zap'}
								</span>
							</button>
							<button type="button" onclick={() => toggleLike(reel)} class="reel-action">
								<span class="icon-circle">
									<Icon
										name={reel.reactions.some((reaction) => reaction.byMe)
											? 'i-solar-heart-bold'
											: 'i-solar-heart-linear'}
										class="size-5 {reel.reactions.some((reaction) => reaction.byMe)
											? 'text-primary-500'
											: ''}"
									/>
								</span>
								<span class="text-[11px] font-semibold">
									{reel.reactions.reduce((sum, reaction) => sum + reaction.count, 0) || 'Like'}
								</span>
							</button>
							<button
								type="button"
								onclick={() => openComments(reel)}
								class="reel-action"
								aria-pressed={commentReel?.id === reel.id}
							>
								<span class="icon-circle {commentReel?.id === reel.id ? 'is-active' : ''}">
									<Icon name="i-lucide-message-circle" class="size-5" />
								</span>
								<span class="text-[11px] font-semibold">
									{commentsFor(reel.id).length || 'Comment'}
								</span>
							</button>
							<button type="button" onclick={() => void shareReel(reel)} class="reel-action">
								<span class="icon-circle"><Icon name="i-lucide-share" class="size-5" /></span>
								<span class="text-[11px] font-semibold">
									{reel.repostCount ? formatCompact(reel.repostCount) : 'Share'}
								</span>
							</button>
							<button type="button" onclick={() => toggleSave(reel)} class="reel-action">
								<span class="icon-circle">
									<Icon
										name={bookmarks.has(reel.id) ? 'i-lucide-bookmark-check' : 'i-lucide-bookmark'}
										class="size-5"
									/>
								</span>
								<span class="text-[11px] font-semibold">Save</span>
							</button>
							<a href={`/profile/${reel.pubkey}`} class="mt-2" aria-label="Open profile">
								<Avatar
									pubkey={reel.pubkey}
									{name}
									picture={profile?.picture}
									lightning={hasLightning(profile)}
									orbit
									size={40}
									frame
								/>
							</a>
						</div>

						<!-- pb clears the auto-hiding player bar (progress + play/mute row) -->
						<div class="absolute inset-x-0 bottom-0 z-10 p-5 pr-20 pb-[4.75rem] text-white">
							<div class="mb-3 flex items-center gap-3">
								<Avatar
									pubkey={reel.pubkey}
									{name}
									picture={profile?.picture}
									lightning={hasLightning(profile)}
									size={40}
									frame
								/>
								<div class="min-w-0 flex-1">
									<a
										href={`/profile/${reel.pubkey}`}
										class="inline-flex min-w-0 items-center gap-1 text-[14px] font-bold"
									>
										<span class="truncate">{name}</span>
										{#if profile?.nip05}
											<Icon name="i-lucide-badge-check" class="size-3.5 shrink-0 text-white/85" />
										{/if}
									</a>
									<div class="flex min-w-0 items-center gap-1.5">
										<p class="flex shrink-0 items-center gap-1.5 text-[11px] opacity-80">
											<span>{timeAgo(reel.createdAt)}</span>
											{#if reel.source === 'discovery'}
												<span>· discovery</span>{/if}
											{#if reel.pow}
												<PowBadge bits={reel.pow} micro id={reel.id} />
											{/if}
										</p>
										<!-- Same overflow menu as a feed post card, scoped to this bitz. -->
										<Popover
											id={reelMenuId(reel)}
											placement="top-start"
											width="auto"
											class="w-60"
											label="Bitz actions"
											triggerClass="grid size-7 shrink-0 place-items-center rounded-lg text-white/60 transition-colors hover:bg-white/15 hover:text-white"
											triggerActiveClass="bg-white/15 text-white"
										>
											{#snippet trigger()}
												<Icon name="i-lucide-ellipsis" class="size-4" />
											{/snippet}

											<MenuItem href={`/messages?to=${reel.pubkey}`} icon="i-lucide-message-circle">
												Message author
											</MenuItem>
											<MenuItem
												icon={bookmarks.has(reel.id) ? 'i-lucide-bookmark-x' : 'i-lucide-bookmark'}
												onclick={() => {
													const saved = bookmarks.toggle(reel);
													toasts.success(saved ? 'Saved' : 'Removed from saved');
													popovers.close();
												}}
											>
												{bookmarks.has(reel.id) ? 'Unsave bitz' : 'Save bitz'}
											</MenuItem>
											<!-- Remix chain (§17): open the meme studio with this bitz's
											     layout + media pre-loaded — one tap to riff on a meme. -->
											<MenuItem icon="i-lucide-repeat" onclick={() => remixReel(reel)}>
												Remix this meme
											</MenuItem>
											{#if reel.mediaType === 'video'}
												<!-- Whole-video view vs the default crop-to-fill. Global:
												     applies to every reel while swiping, and persists. -->
												<MenuItem
													icon={reelViewMode === 'full' ? 'i-lucide-shrink' : 'i-lucide-expand'}
													onclick={() => {
														toggleReelViewMode();
														popovers.close();
													}}
												>
													{reelViewMode === 'full'
														? 'Fill screen · all bitz'
														: 'View full video · all bitz'}
												</MenuItem>
											{/if}
											<MenuItem
												icon="i-lucide-link"
												onclick={() =>
													copyText(shareWebLink({ eventId: reel.id }, location.origin), 'Web link')}
											>
												Copy web link
											</MenuItem>
											<MenuItem
												icon="i-lucide-at-sign"
												onclick={() => copyText(shareEntity({ eventId: reel.id }), 'Nostr link')}
											>
												Copy nostr link
											</MenuItem>
											<MenuItem
												icon="i-lucide-fingerprint"
												onclick={() => copyText(reel.id, 'Note ID')}
											>
												Copy note ID
											</MenuItem>
											<MenuItem
												icon="i-lucide-text"
												onclick={() => copyText(reel.content, 'Note text')}
											>
												Copy note text
											</MenuItem>
											<MenuItem
												icon="i-lucide-user-round"
												onclick={() => copyText(npubEncode(reel.pubkey), 'Author npub')}
											>
												Copy author npub
											</MenuItem>
											<MenuItem icon="i-lucide-braces" onclick={() => showRawReel(reel)}>
												View raw note
											</MenuItem>

											<MenuDivider />

											<MenuItem icon="i-lucide-thumbs-down" onclick={() => notInterestedIn(reel)}>
												Not interested
											</MenuItem>
											{#if reel.pubkey !== identity.current?.pk}
												<MenuItem
													icon={interactionProfile.isAuthorMuted(reel.pubkey)
														? 'i-lucide-eye'
														: 'i-lucide-eye-off'}
													onclick={() => toggleMuteAuthorOf(reel, name)}
												>
													{interactionProfile.isAuthorMuted(reel.pubkey)
														? `Show more from ${name}`
														: `Show less from ${name}`}
												</MenuItem>
											{/if}
											{#each extractTags(reel).slice(0, 3) as tag (tag)}
												{#if interactionProfile.isTagMuted(tag)}
													<MenuItem icon="i-lucide-eye" onclick={() => toggleMuteTag(tag)}>
														Show more about #{tag}
													</MenuItem>
												{:else}
													<MenuItem icon="i-lucide-hash" onclick={() => toggleMuteTag(tag)}>
														Show less about #{tag}
													</MenuItem>
												{/if}
											{/each}

											<MenuDivider />

											{#if reel.pubkey === identity.current?.pk}
												<MenuItem
													tone="danger"
													icon="i-lucide-trash-2"
													onclick={() => {
														popovers.close();
														pendingDeleteReel = reel;
														deleteReelOpen = true;
													}}
												>
													Delete bitz
												</MenuItem>
											{:else}
												<MenuItem icon="i-lucide-volume-x" onclick={() => muteAuthorOf(reel, name)}>
													Mute author
												</MenuItem>
												<MenuItem
													tone="danger"
													icon="i-lucide-ban"
													onclick={() => blockAuthorOf(reel, name)}
												>
													Block author
												</MenuItem>
												<MenuItem
													tone="danger"
													icon="i-lucide-flag"
													onclick={() => {
														popovers.close();
														reportReelTarget = reel;
														reportReelOpen = true;
													}}
												>
													Report bitz
												</MenuItem>
											{/if}
										</Popover>
									</div>
								</div>
							</div>
							{#if captionFor(reel)}
								<p class="line-clamp-4 text-[13.5px] leading-relaxed">
									{#each captionTokens(reel) as token, tokenIndex (`${token.type}:${tokenIndex}:${token.value}`)}
										{#if token.type === 'text'}
											{token.value}
										{:else if token.type === 'hashtag'}
											<a
												href={`/?tag=${encodeURIComponent(token.tag)}`}
												class="font-bold text-primary-400 transition hover:text-primary-300 hover:underline"
											>
												{token.value}
											</a>
										{:else if token.type === 'nostr'}
											{#if isEventReference(token.value)}
												<NostrEventPreview value={token.value} compact />
											{:else}
												<MentionLink
													value={token.value}
													class="font-bold text-primary-400 transition hover:text-primary-300 hover:underline"
												/>
											{/if}
										{:else}
											<a
												href={token.value}
												target="_blank"
												rel="noreferrer"
												class="font-semibold text-accent-400 transition hover:text-accent-300 hover:underline"
											>
												{token.host}
											</a>
										{/if}
									{/each}
								</p>
							{/if}
							{#if remixOf(reel.tags)}
								<!-- Remix lineage chip (§17 creator economy): links the derivative to
								     its source. Protocol provenance only — rights live upstream. -->
								<a
									href={`/note/${remixOf(reel.tags)!.eventId}?from=reels`}
									class="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold backdrop-blur transition hover:bg-white/25"
								>
									<Icon name="i-lucide-repeat" class="size-3.5 shrink-0" />
									<span class="truncate">Remixed</span>
								</a>
							{/if}
							{#if rightsOf(reel.tags).license}
								<!-- Advisory rights badge (S-013, §17.3): provenance, not legal advice. -->
								{@const reelRights = rightsOf(reel.tags)}
								<span
									class="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full bg-black/30 px-3 py-1 text-[11px] font-semibold backdrop-blur"
									title={`License ${reelRights.license}${reelRights.attribution ? ` · ${reelRights.attribution}` : ''}`}
								>
									<Icon name="i-lucide-scale" class="size-3.5 shrink-0" />
									<span class="truncate">{reelRights.license}</span>
								</span>
							{/if}
							{#if splitsOf(reel.tags)}
								<!-- Value-split chip (CRE-008): how this bitz declares its value graph.
							         Display only in V1 - store/display/validate, payment comes later. -->
								<span
									class="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full bg-black/30 px-3 py-1 text-[11px] font-semibold backdrop-blur"
									title={`Value splits (display only)\n${splitsOf(reel.tags)!
										.rows.map(
											(r) =>
												`${r.role.replace(/_/g, ' ')}: ${(r.basisPoints / 100).toFixed(1)}%${r.beneficiary ? ` - ${r.beneficiary.slice(0, 12)}` : ''}`
										)
										.join('\n')}`}
								>
									<Icon name="i-lucide-git-fork" class="size-3.5 shrink-0" />
									<span class="truncate"
										>{splitsOf(reel.tags)!.rows.length} split{splitsOf(reel.tags)!.rows.length > 1
											? 's'
											: ''} declared</span
									>
								</span>
							{/if}
							{#if loadingMoreReels && reel.id === renderedReels.at(-1)?.id}
								<div
									class="mt-3 inline-flex items-center gap-2 rounded-full bg-black/35 px-3 py-1 text-[11px] font-semibold backdrop-blur"
								>
									<Icon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
									Loading older bitz
								</div>
							{/if}
						</div>
					</div>
				{/each}
			{:else}
				<div class="flex h-full items-center justify-center px-6">
					<div class="max-w-sm text-center">
						<div
							class="mx-auto mb-4 grid size-16 place-items-center rounded-2xl bg-[var(--ui-bg-muted)] text-[var(--ui-text-dimmed)]"
						>
							<Icon name="i-lucide-clapperboard" class="size-8" />
						</div>
						<h1 class="font-display text-[28px] font-extrabold">
							{bitzMode === 'following' ? 'Nothing from your follows yet' : 'No bitz found'}
						</h1>
						<p class="mt-2 text-[13px] leading-relaxed text-[var(--ui-text-muted)]">
							{bitzMode === 'following'
								? 'Follow more creators from Discover and their short videos will land here.'
								: 'Your configured relays did not return kind-1 notes with video links.'}
						</p>
						{#if bitzMode === 'following'}
							<a
								href="/discover"
								class="mt-5 inline-flex rounded-full border border-primary-500/40 bg-primary-500/10 px-5 py-2.5 text-[13px] font-bold text-primary-600 transition hover:bg-primary-500/20"
							>
								Explore Discover
							</a>
						{/if}
						<button
							type="button"
							onclick={() => loadReels()}
							class="mt-5 rounded-full bg-primary-500 px-5 py-2.5 text-[13px] font-bold text-white shadow-[var(--glow-primary)] transition hover:bg-primary-600"
						>
							Refresh
						</button>
					</div>
				</div>
			{/if}

			{#if playbackReels.length}
				<div
					class="absolute top-1/2 right-[92px] z-30 hidden -translate-y-1/2 flex-col gap-1.5 rounded-full bg-black/25 p-1 shadow-lg ring-1 shadow-black/20 ring-white/10 backdrop-blur-md transition-[right] duration-200 sm:flex {commentReel
						? 'lg:right-[398px]'
						: ''}"
				>
					<button
						type="button"
						onclick={() => scrollToReel(-1)}
						class="grid size-9 place-items-center rounded-full bg-white/12 text-white/90 transition hover:bg-white/25 hover:text-white"
						aria-label="Previous bitz"
					>
						<Icon name="i-lucide-chevron-up" class="size-[18px]" />
					</button>
					<button
						type="button"
						onclick={() => scrollToReel(1)}
						class="grid size-9 place-items-center rounded-full bg-white/12 text-white/90 transition hover:bg-white/25 hover:text-white"
						aria-label="Next bitz"
					>
						<Icon name="i-lucide-chevron-down" class="size-[18px]" />
					</button>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Sticky top bar: Bitz wordmark · view tabs · refresh. Shrinks with the
	     comments panel so the tabs stay centered over the video area (lg).
	     Over the player it is dark media chrome (gradient over video); on the
	     Explore grid it follows the theme so light mode gets a themed page. -->
	<div
		class="pointer-events-none absolute inset-x-0 top-0 z-40 grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 pt-4 pb-12 transition-[padding] duration-200 {isExplore
			? 'bg-gradient-to-b from-[var(--ui-bg)] via-[color-mix(in_oklab,var(--ui-bg)_72%,transparent)] to-transparent text-[var(--ui-text)]'
			: 'bg-gradient-to-b from-black/55 via-black/25 to-transparent text-white'} {commentReel
			? 'lg:pr-[390px]'
			: ''}"
	>
		{#if authorMode}
			<!-- Author mode: back-to-profile bar replaces the wordmark. Tapping the
			     identity opens the full profile; bitz count frames the swipe deck. -->
			<div class="pointer-events-auto flex min-w-0 items-center gap-2 justify-self-start">
				<button
					type="button"
					onclick={exitAuthorMode}
					class="grid size-9 shrink-0 place-items-center rounded-full bg-white/15 text-white backdrop-blur transition hover:bg-white/25"
					aria-label="Back to profile"
				>
					<Icon name="i-lucide-arrow-left" class="size-5" />
				</button>
				<a
					href={authorPubkey ? `/profile/${npubEncode(authorPubkey)}` : '#'}
					class="flex min-w-0 items-center gap-2 rounded-full bg-black/30 p-1 pr-3 text-white backdrop-blur-md transition hover:bg-black/50"
				>
					<Avatar
						pubkey={authorPubkey}
						name={authorDisplayName}
						picture={authorProfile?.picture}
						size={28}
						shape="hex"
					/>
					<span class="min-w-0 leading-tight">
						<span class="block max-w-[120px] truncate text-[13px] font-bold sm:max-w-[200px]"
							>{authorDisplayName}</span
						>
						<span class="block text-[10.5px] text-white/65 tabular-nums">{reels.length} bitz</span>
					</span>
				</a>
			</div>
		{:else}
			<h2
				class="pointer-events-auto hidden justify-self-start font-display text-[22px] font-extrabold sm:block {isExplore
					? 'text-[var(--ui-text-highlighted)]'
					: 'text-white drop-shadow'}"
			>
				Bitz
			</h2>
		{/if}
		{#if !authorMode}
			<div
				class="pointer-events-auto flex items-center gap-0.5 rounded-full p-1 {isExplore
					? 'bg-[var(--ui-bg-muted)] ring-1 ring-[var(--ui-border-muted)]'
					: 'bg-black/40 backdrop-blur-md'}"
				role="tablist"
				aria-label="Bitz views"
			>
				{#each bitzTabs as tab (tab.key)}
					<button
						type="button"
						role="tab"
						aria-selected={bitzMode === tab.key}
						onclick={() => switchBitzMode(tab.key)}
						class="rounded-full px-3 py-1.5 text-[13px] font-bold whitespace-nowrap transition {bitzMode ===
						tab.key
							? isExplore
								? 'bg-[var(--ui-bg)] text-[var(--ui-text-highlighted)] shadow-sm ring-1 ring-[var(--ui-border-muted)]'
								: 'bg-white text-black'
							: isExplore
								? 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'
								: 'text-white/75 hover:text-white'}"
					>
						{tab.label}
					</button>
				{/each}
			</div>
		{/if}
		<div class="pointer-events-auto flex items-center gap-2 justify-self-end">
			{#if !authorMode}
				<button
					type="button"
					onclick={() => search.openOverlay()}
					class="grid size-10 place-items-center rounded-xl transition {isExplore
						? 'bg-[var(--ui-bg-muted)] text-[var(--ui-text)] ring-1 ring-[var(--ui-border-muted)] hover:bg-[var(--ui-bg-accented)]'
						: 'bg-white/15 text-white backdrop-blur hover:bg-white/25'}"
					aria-label="Search bitz"
				>
					<Icon name="i-lucide-search" class="size-5" />
				</button>
			{/if}
			<button
				type="button"
				onclick={() => loadReels()}
				class="grid size-10 place-items-center rounded-xl transition {isExplore
					? 'bg-[var(--ui-bg-muted)] text-[var(--ui-text)] ring-1 ring-[var(--ui-border-muted)] hover:bg-[var(--ui-bg-accented)]'
					: 'bg-white/15 text-white backdrop-blur hover:bg-white/25'}"
				aria-label="Refresh bitz"
			>
				<Icon name="i-lucide-rotate-cw" class="size-5" />
			</button>
		</div>
	</div>

	<!-- Bitz video search: instant local matches + NIP-50 relay search (store-driven) -->
	{#if search.open}
		<BitsSearch
			{search}
			profileFor={(pubkey) => profiles.get(pubkey)}
			{gridVideoDurations}
			onDuration={(reelId, seconds) =>
				(gridVideoDurations = { ...gridVideoDurations, [reelId]: seconds })}
			onSelect={(reel) => void openBitzResult(reel)}
		/>
	{/if}

	{#if commentReel}
		<button
			type="button"
			class="fixed inset-0 z-40 bg-black/45 lg:hidden"
			aria-label="Close comments"
			onclick={() => (commentReel = null)}
		></button>
		<aside
			class="reel-comments-panel fixed inset-x-0 bottom-0 z-50 flex max-h-[78vh] flex-col overflow-hidden rounded-t-3xl border border-[var(--ui-border)] bg-[var(--ui-bg)] text-[var(--ui-text)] shadow-2xl shadow-black/20 lg:inset-y-0 lg:right-0 lg:left-auto lg:h-full lg:max-h-none lg:w-[390px] lg:rounded-none lg:border-y-0 lg:border-r-0 lg:border-[var(--ui-border-muted)]"
			aria-label="Bitz comments"
		>
			<header class="flex h-14 shrink-0 items-center justify-between px-4">
				<h2 class="text-[16px] font-extrabold text-[var(--ui-text-highlighted)]">
					Comments <span class="ml-1 text-[var(--ui-text-dimmed)]">{activeComments.length}</span>
				</h2>
				<div class="flex items-center gap-1">
					<button
						type="button"
						onclick={() => loadComments(commentReel!, { force: true })}
						disabled={loadingComments}
						class="grid size-9 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text-highlighted)] disabled:cursor-not-allowed disabled:opacity-60"
						aria-label="Refresh comments"
					>
						<Icon
							name="i-lucide-rotate-cw"
							class="size-4 {loadingComments ? 'animate-spin' : ''}"
						/>
					</button>
					<button
						type="button"
						onclick={() => (commentReel = null)}
						class="grid size-9 place-items-center rounded-full bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)] transition hover:text-[var(--ui-text-highlighted)]"
						aria-label="Close comments"
					>
						<Icon name="i-lucide-x" class="size-5" />
					</button>
				</div>
			</header>
			<div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
				{#if loadingComments && !activeComments.length}
					<div class="flex h-36 items-center justify-center">
						<div
							class="size-6 animate-spin rounded-full border-2 border-[var(--ui-border)] border-t-primary-500"
						></div>
					</div>
				{:else}
					<div class="space-y-6">
						{#if activeCommentPage?.hasMore}
							<button
								type="button"
								onclick={loadMoreComments}
								disabled={loadingComments || !activeCommentPage?.hasMore}
								class="mx-auto flex h-9 items-center gap-2 rounded-full border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-4 text-[12px] font-bold text-[var(--ui-text-muted)] transition hover:border-primary-500 hover:text-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
							>
								<Icon
									name={loadingComments ? 'i-lucide-loader-circle' : 'i-lucide-chevron-up'}
									class="size-3.5 {loadingComments ? 'animate-spin' : ''}"
								/>
								{loadingComments ? 'Loading comments…' : 'Load more comments'}
							</button>
						{/if}
						{#if activeComments.length}
							{#snippet commentRow(comment: FeedNote, nested: boolean)}
								{@const commentProfile = profiles.get(comment.pubkey)}
								{@const commentName =
									commentProfile?.display_name || commentProfile?.name || shortKey(comment.pubkey)}
								{@const commentLiked = comment.reactions.some((reaction) => reaction.byMe)}
								{@const commentLikes = comment.reactions.reduce(
									(sum, reaction) => sum + reaction.count,
									0
								)}
								<div class="flex {nested ? 'gap-2 pl-8' : 'gap-3'}">
									<a href={`/profile/${comment.pubkey}`} class="shrink-0">
										<Avatar
											pubkey={comment.pubkey}
											name={commentName}
											picture={commentProfile?.picture}
											lightning={hasLightning(commentProfile)}
											size={nested ? 22 : 34}
											frame={!nested}
										/>
									</a>
									<div class="min-w-0 flex-1">
										<div class="flex min-w-0 items-center gap-1.5">
											<a
												href={`/profile/${comment.pubkey}`}
												class="truncate text-[12px] font-extrabold text-[var(--ui-text-highlighted)] hover:text-primary-500"
											>
												{commentName}
											</a>
											{#if commentProfile?.nip05}
												<Icon
													name="i-lucide-badge-check"
													class="size-3 shrink-0 text-primary-500"
												/>
											{/if}
											{#if comment.pubkey === identity.current?.pk}
												<span
													class="rounded-full bg-primary-500/15 px-1 py-px text-[9px] font-bold text-primary-600 uppercase"
													>you</span
												>
											{/if}
											{#if comment.pow}
												<PowBadge bits={comment.pow} micro id={comment.id} />
											{/if}
											<a
												href={`/note/${comment.id}?from=reels`}
												class="ml-auto shrink-0 text-[10.5px] font-semibold text-[var(--ui-text-dimmed)] hover:text-primary-500"
											>
												{timeAgo(comment.createdAt)}
											</a>
										</div>
										<CommentBody content={comment.content} tags={comment.tags} compact />
										<div
											class="mt-1 flex items-center gap-3 text-[11px] font-bold text-[var(--ui-text-dimmed)]"
										>
											<button
												type="button"
												onclick={() => likeComment(comment)}
												class="inline-flex items-center gap-1 transition hover:text-[var(--tone-error-text)]"
												aria-label="Like comment"
											>
												<Icon
													name={commentLiked ? 'i-solar-heart-bold' : 'i-solar-heart-linear'}
													class="size-3 {commentLiked ? 'text-primary-500' : ''}"
												/>
												{#if commentLikes}<span class="font-semibold">{commentLikes}</span>{/if}
											</button>
											<button
												type="button"
												onclick={() => zapComment(comment)}
												class="inline-flex items-center gap-1 transition hover:text-warm-500"
												aria-label="Zap sats to this comment"
											>
												<Icon name="i-lucide-zap" class="size-3 fill-current" />
												{#if commentZapSats(comment)}
													<span class="font-semibold">{compactSats(commentZapSats(comment))}</span>
												{:else}Zap{/if}
											</button>
											<button
												type="button"
												onclick={() => (commentReplyTarget = comment)}
												disabled={!privacyNotificationSettings.canCommentOn(comment.pubkey)}
												class="transition hover:text-primary-500 disabled:pointer-events-none disabled:opacity-40"
											>
												Reply
											</button>
											{#if comment.pubkey === identity.current?.pk}
												<button
													type="button"
													onclick={() => askDeleteComment(comment)}
													disabled={deletingCommentId === comment.id}
													class="transition hover:text-[var(--ui-text-highlighted)] disabled:cursor-not-allowed disabled:opacity-60"
												>
													{deletingCommentId === comment.id ? 'Deleting' : 'Delete'}
												</button>
											{/if}
										</div>
									</div>
								</div>
							{/snippet}
							{#each activeTopLevelComments as comment (comment.id)}
								{@render commentRow(comment, false)}
								{#each activeCommentTree.children.get(comment.id) ?? [] as child (child.id)}
									{@render commentRow(child, true)}
								{/each}
							{/each}
						{:else}
							<div class="flex h-44 flex-col items-center justify-center text-center">
								<div
									class="grid size-12 place-items-center rounded-2xl bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)]"
								>
									<Icon name="i-lucide-message-circle" class="size-6" />
								</div>
								<p class="mt-3 text-[14px] font-bold text-[var(--ui-text-highlighted)]">
									No comments yet
								</p>
								<p class="mt-1 text-[12px] text-[var(--ui-text-muted)]">Start the conversation.</p>
							</div>
						{/if}
					</div>
				{/if}
			</div>

			<div class="shrink-0 bg-transparent p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
				{#key `${commentReel.id}:${commentReplyTarget?.id ?? ''}`}
					{@const replyTargetProfile = commentReplyTarget
						? profiles.get(commentReplyTarget.pubkey)
						: undefined}
					{@const replyTargetName = commentReplyTarget
						? replyTargetProfile?.display_name ||
							replyTargetProfile?.name ||
							shortKey(commentReplyTarget.pubkey)
						: ''}
					<ReplyComposer
						parent={commentReplyTarget ?? commentReel}
						commentTarget={{
							id: commentReel.id,
							pubkey: commentReel.pubkey,
							kind: commentReel.raw?.kind ?? NOSTR_KINDS.TEXT_NOTE
						}}
						placeholder={commentReplyTarget ? `Reply to ${replyTargetName}…` : 'Add a comment…'}
						autofocus={!!commentReplyTarget}
						initialMention={commentReplyTarget
							? { pubkey: commentReplyTarget.pubkey, name: replyTargetName }
							: undefined}
						onSubmitted={() => {
							commentReplyTarget = null;
							void loadComments(commentReel!, { force: true });
						}}
						onCancel={() => (commentReplyTarget = null)}
					/>
				{/key}
			</div>
		</aside>
	{/if}

	<Dialog bind:open={deleteCommentOpen} title="Delete comment">
		<div class="space-y-2">
			<p class="text-[14px] font-semibold text-[var(--ui-text)]">Delete this comment?</p>
			<p class="text-[13px] leading-relaxed text-[var(--ui-text-muted)]">
				BitOS will publish a delete event to your relays and remove the comment locally.
			</p>
		</div>

		{#snippet footer()}
			<button
				type="button"
				onclick={() => {
					commentPendingDelete = null;
					deleteCommentOpen = false;
				}}
				disabled={!!deletingCommentId}
				class="inline-flex h-9 items-center justify-center rounded-full border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-4 text-[13px] font-bold text-[var(--ui-text)] transition hover:border-primary-500 hover:text-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
			>
				Cancel
			</button>
			<button
				type="button"
				onclick={deleteComment}
				disabled={!!deletingCommentId}
				class="inline-flex h-9 items-center gap-2 rounded-full bg-[var(--tone-error-text)] px-4 text-[13px] font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
			>
				<Icon
					name={deletingCommentId ? 'i-lucide-loader-circle' : 'i-lucide-trash-2'}
					class="size-4 {deletingCommentId ? 'animate-spin' : ''}"
				/>
				{deletingCommentId ? 'Deleting' : 'Delete'}
			</button>
		{/snippet}
	</Dialog>

	{#if zapReel}
		{@const zapProfile = profiles.get(zapReel.pubkey)}
		<NoteZapDialog
			bind:open={zapOpen}
			recipientPubkey={zapReel.pubkey}
			lightningAddress={zapProfile?.lud16 || zapProfile?.lud06 || ''}
			eventId={zapReel.id}
			onPaid={handleZapPaid}
		/>
	{/if}

	{#if zapCommentTarget}
		<NoteZapDialog
			bind:open={zapCommentOpen}
			recipientPubkey={zapCommentTarget.pubkey}
			lightningAddress={zapCommentAddress}
			eventId={zapCommentTarget.id}
			onPaid={handleCommentZapPaid}
			onClose={() => (zapCommentTarget = null)}
		/>
	{/if}

	<!-- Raw note viewer (overflow menu → “View raw note”) -->
	<Dialog bind:open={rawReelOpen} title="Raw note">
		<pre
			class="max-h-[50vh] overflow-auto rounded-xl bg-[var(--ui-bg-muted)] p-4 font-mono text-[12px] leading-relaxed text-[var(--ui-text)]"><code
				>{rawReelJson}</code
			></pre>
		{#snippet footer()}
			<Button
				color="neutral"
				onclick={() => void copyText(rawReelJson, 'Raw note')}
				icon="i-lucide-copy"
			>
				Copy JSON
			</Button>
			<Button color="primary" onclick={() => (rawReelOpen = false)}>Close</Button>
		{/snippet}
	</Dialog>

	<!-- NIP-56 report (overflow menu → “Report bitz”) -->
	{#if reportReelTarget}
		<ReportDialog
			bind:open={reportReelOpen}
			pubkey={reportReelTarget.pubkey}
			noteId={reportReelTarget.id}
			targetLabel={captionFor(reportReelTarget).slice(0, 60) || 'bitz'}
		/>
	{/if}

	<!-- Delete own bitz (overflow menu → “Delete bitz”) -->
	<Dialog bind:open={deleteReelOpen} title="Delete bitz">
		<div class="space-y-2">
			<p class="text-[14px] font-semibold text-[var(--ui-text)]">Delete this bitz?</p>
			<p class="text-[13px] leading-relaxed text-[var(--ui-text-muted)]">
				BitOS will publish a delete event to your relays and remove the bitz locally.
			</p>
		</div>
		{#snippet footer()}
			<Button
				color="neutral"
				onclick={() => {
					pendingDeleteReel = null;
					deleteReelOpen = false;
				}}
				disabled={deletingReel}
			>
				Cancel
			</Button>
			<Button color="error" onclick={deleteReel} disabled={deletingReel}>
				<Icon
					name={deletingReel ? 'i-lucide-loader-circle' : 'i-lucide-trash-2'}
					class="size-4 {deletingReel ? 'animate-spin' : ''}"
				/>
				{deletingReel ? 'Deleting' : 'Delete'}
			</Button>
		{/snippet}
	</Dialog>

	<!-- Remix chain (§17 creator economy rec #1): the studio opens with the
	     remixed bitz media + layout pre-applied, lineage publishes as tags. -->
</div>
