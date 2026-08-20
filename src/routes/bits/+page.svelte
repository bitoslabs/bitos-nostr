<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { noteEncode, npubEncode } from 'nostr-tools/nip19';
	import type { Filter } from 'nostr-tools/filter';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import BitsSearch from '$lib/components/bits/BitsSearch.svelte';
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
	import { NOSTR_KINDS, type FeedNote } from '$lib/nostr/types';
	import { toFeedNote } from '$lib/nostr/feed-note';
	import { applyActivityToNotes } from '$lib/nostr/zaps';
	import { bookmarks } from '$lib/stores/bookmarks.svelte';
	import { algorithmPreferences, buildScoringContext, rankNotes } from '$lib/algorithm';
	import { interactionProfile, extractTags } from '$lib/algorithm';
	import { popovers } from '$lib/stores/popovers.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { shortKey, timeAgo, formatDuration } from '$lib/utils/format';
	import { lazyVideoMetadata } from '$lib/utils/media';
	import { isEventReference, parseContent } from '$lib/utils/note-content';
	import { hasNip05 } from '$lib/utils/verification';
	import { sensitiveMediaReason } from '$lib/utils/sensitive-media';
	import { privacyNotificationSettings } from '$lib/stores/privacy-notification-settings.svelte';
	import { compactSats } from '$lib/utils/profile-stats';
	import { BitsSearchStore } from '$lib/stores/bits-search.svelte';
	import {
		bitsSession,
		BITS_SESSION_REFRESH_MS,
		type BitsMode,
		type ReelNote
	} from '$lib/stores/bits-session.svelte';

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
	// Keep startup fast without retaining the full Bits feed locally. Older
	// pages always come from relays through the normal pagination request.
	const MAX_CACHED_REELS = 10;
	// Nostr `limit` applies PER RELAY PER FILTER, so a single combined filter
	// transfers limit × relay-count events. Splitting by kind fixes the yield:
	// dedicated media kinds are ~100% renderable bits (query them deep), while
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

	const bitsTabs: { key: BitsMode; label: string }[] = [
		{ key: 'explore', label: 'Explore' },
		{ key: 'following', label: 'Following' },
		{ key: 'foryou', label: 'For you' }
	];

	let loading = $state(true);
	let loadingComments = $state(false);
	let deletingCommentId = $state('');
	let loadingMoreReels = $state(false);
	let hasMoreReels = $state(true);
	let reelScroller: HTMLDivElement | undefined = $state();
	let reels = $state<ReelNote[]>([]);
	let bitsMode = $state<BitsMode>('foryou');
	let exploreScroller: HTMLDivElement | undefined = $state();
	let exploreVisible = $state(EXPLORE_INITIAL_VISIBLE);
	let gridVideoDurations = $state<Record<string, number>>({});
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
	let reelVideos = new Map<string, HTMLVideoElement>();
	let reelCards = new Map<string, HTMLDivElement>();
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
	const rankedReels = $derived.by(() => {
		if (!reels.length) return reels;
		if (!algorithmPreferences.isEnabled('reels')) return reels;
		// Fold the current watch-time proxy into engagement. Snap a copy so dwell is a
		// soft, best-effort input (re-ranking only fires when `reels`/config change,
		// never on every visibility tick — that would jitter the scroll snap).
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
	const playbackReels = $derived(bitsMode === 'following' ? followingReels : rankedReels);
	const renderedReels = $derived(playbackReels.slice(0, renderedReelCount));
	const hasMoreRenderedReels = $derived(renderedReelCount < playbackReels.length);
	// Explore grid: videos lead (it is the "vdo" tab), pictures keep ranked order.
	const exploreReels = $derived([
		...rankedReels.filter((reel) => reel.mediaType === 'video'),
		...rankedReels.filter((reel) => reel.mediaType !== 'video')
	]);
	const visibleExploreReels = $derived(exploreReels.slice(0, exploreVisible));

	function bitAuthorName(reel: ReelNote) {
		const profile = profiles.get(reel.pubkey);
		return profile?.display_name || profile?.name || shortKey(reel.pubkey);
	}

	/** Search runs in a dedicated store (debounce + relay round + dedupe);
	 *  the page only injects its relay access, reel pipeline, and name helpers.
	 *  The local pool mirrors `exploreReels` so matching updates as the feed grows. */
	const search = new BitsSearchStore({
		relaySearch: (requests) =>
			queryUrls(relays.orderedReadUrls, requests as Filter[], { maxWait: REELS_PAGE_MAX_WAIT_MS }),
		eventsToReels: async (events) => {
			const mediaEvents = events.filter((event) => !!extractReelMedia(event));
			return mediaEvents.length ? await buildReelsFromEvents(mediaEvents, new Set()) : [];
		},
		captionOf: captionFor,
		authorOf: bitAuthorName,
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
	async function openBitResult(reel: ReelNote) {
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

	function imetaValue(tag: string[], key: string) {
		const line = tag.find((segment) => segment.startsWith(`${key} `));
		return line?.slice(key.length + 1).trim();
	}

	function extractVideo(event: { content: string; tags: string[][] }) {
		for (const tag of event.tags.filter((tag) => tag[0] === 'imeta')) {
			const url = imetaValue(tag, 'url');
			const mime = imetaValue(tag, 'm');
			// NIP-92 metadata is authoritative when present. In particular, some
			// image CDNs use /upload/ in their paths, which must not turn an image
			// attachment into a reel just because its URL looks video-ish.
			if (url && (mime ? mime.startsWith('video/') : looksLikeVideoUrl(url))) return url;
		}
		for (const match of event.content.matchAll(urlPattern)) {
			const { core } = splitTrailingPunctuation(match[0]);
			if (looksLikeVideoUrl(core)) return core;
		}
		return '';
	}

	function extractImage(event: { content: string; tags: string[][] }) {
		for (const tag of event.tags.filter((tag) => tag[0] === 'imeta')) {
			const url = imetaValue(tag, 'url');
			const mime = imetaValue(tag, 'm');
			if (url && (mime?.startsWith('image/') || imagePattern.test(url))) return url;
		}
		for (const match of event.content.matchAll(urlPattern)) {
			const { core } = splitTrailingPunctuation(match[0]);
			if (imagePattern.test(core)) return core;
		}
		return '';
	}

	function extractReelMedia(event: { kind: number; content: string; tags: string[][] }) {
		if (event.kind === NOSTR_KINDS.PICTURE) {
			const url = extractImage(event);
			return url ? { url, type: 'image' as const } : null;
		}
		const url = extractVideo(event);
		return url ? { url, type: 'video' as const } : null;
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
		return `bit-menu:${reel.id}`;
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

	/** Drops the bit everywhere on the page: player lists, cache, session. */
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
		const newestByKey = new Map<string, (typeof configured)[number]>();
		for (const event of [...configured, ...discovered]) {
			const d = event.tags.find((tag) => tag[0] === 'd')?.[1];
			const addressable =
				(event.kind === NOSTR_KINDS.ADDRESSABLE_VIDEO ||
					event.kind === NOSTR_KINDS.ADDRESSABLE_SHORT_VIDEO) &&
				d;
			const key = addressable ? `${event.kind}:${event.pubkey}:${d}` : event.id;
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
		reels = options.append ? mergeReelLists(reels, next) : next;
		renderedReelCount = options.append
			? Math.min(reels.length, Math.max(renderedReelCount, INITIAL_RENDERED_REELS))
			: Math.min(INITIAL_RENDERED_REELS, reels.length);
		if (identity.current) profiles.ensure([identity.current.pk]);
		profiles.ensure(
			reels.slice(0, Math.max(renderedReelCount, INITIAL_RENDERED_REELS)).map((reel) => reel.pubkey)
		);
		for (const reel of next) feed.upsertNote(reel);
		bitsSession.reels = reels;
		bitsSession.renderedReelCount = renderedReelCount;
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
		bitsSession.oldestReelEventCreatedAt = oldestReelEventCreatedAt;
		bitsSession.hasMoreReels = hasMoreReels;
		// Relays may return short pages even when older events remain. Keep the
		// cursor alive until a subsequent all-relays request returns nothing.
		hasMoreReels = !!oldestReelEventCreatedAt;
		saveReelsCache(options.append ? reels : nextReels);
	}

	async function buildReelsFromEvents(
		events: Awaited<ReturnType<typeof queryPrimaryFirst>>,
		discoveryIds = new Set<string>()
	) {
		const seen: Record<string, true> = {};
		const baseReels = events
			.sort((a, b) => b.created_at - a.created_at)
			.map((event) => ({ event, media: extractReelMedia(event) }))
			.filter(({ event, media }) => {
				const d = event.tags.find((tag) => tag[0] === 'd')?.[1];
				const key =
					(event.kind === NOSTR_KINDS.ADDRESSABLE_VIDEO ||
						event.kind === NOSTR_KINDS.ADDRESSABLE_SHORT_VIDEO) &&
					d
						? `${event.kind}:${event.pubkey}:${d}`
						: event.id;
				if (!media || seen[key]) return false;
				seen[key] = true;
				return true;
			})
			.map(({ event, media }) => ({
				...toFeedNote(event),
				mediaUrl: media!.url,
				mediaType: media!.type,
				source: discoveryIds.has(event.id) ? ('discovery' as const) : ('configured' as const)
			}));
		const reelIds = baseReels.map((reel) => reel.id);
		const activity = reelIds.length
			? await queryPrimaryFirst([
					{
						kinds: [NOSTR_KINDS.REACTION, NOSTR_KINDS.ZAP, NOSTR_KINDS.TEXT_NOTE],
						'#e': reelIds,
						limit: 500
					}
				])
			: [];
		const nextReels = applyActivityToNotes(baseReels, activity, identity.current?.pk).map(
			(note) => ({
				...note,
				mediaUrl: baseReels.find((reel) => reel.id === note.id)?.mediaUrl ?? '',
				mediaType: baseReels.find((reel) => reel.id === note.id)?.mediaType ?? 'video'
			})
		);
		for (const event of activity.filter((event) => event.kind === NOSTR_KINDS.TEXT_NOTE)) {
			const reply = toFeedNote(event);
			if (reply.replyTo && reelIds.includes(reply.replyTo)) feed.upsertNote(reply);
		}
		return nextReels;
	}

	async function loadReels(options: { background?: boolean } = {}) {
		if (!options.background) loading = true;
		try {
			const filters = [
				{ kinds: REEL_MEDIA_KINDS, limit: REELS_MEDIA_INITIAL_LIMIT },
				{ kinds: [NOSTR_KINDS.TEXT_NOTE], limit: REELS_TEXT_INITIAL_LIMIT }
			];
			const discoveryPromise = queryUrls(discoveryUrls(), filters);
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
			bitsSession.lastRefreshedAt = Date.now();
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
				// Media kinds come back as ready-made bits (no walking needed); the
				// kind-1 window is what the cursor walks past. Same round trip.
				const filters = [
					{
						kinds: REEL_MEDIA_KINDS,
						limit: REELS_MEDIA_PAGE_LIMIT,
						until: oldestReelEventCreatedAt - 1
					},
					{
						kinds: [NOSTR_KINDS.TEXT_NOTE],
						limit: REELS_QUERY_BATCH_LIMIT,
						until: oldestReelEventCreatedAt - 1
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
				// walk finish with zero new bits (the "load more does nothing" bug).
				const known: Record<string, true> = {};
				for (const reel of reels) known[reel.id] = true;
				const fresh = events.filter((event) => !known[event.id]);
				foundMedia += fresh.filter((event) => !!extractReelMedia(event)).length;
				// Apply each batch as it lands so bits stream in immediately instead
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
		// older bits remain, keep the flow going until a full page is buffered.
		if (exploreVisible >= exploreReels.length && hasMoreReels) {
			void loadMoreExploreReels();
		}
	}

	function handleReelScroll() {
		if (!reelScroller) return;
		bitsSession.activeReelIndex = Math.round(reelScroller.scrollTop / reelScroller.clientHeight);
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
		if (bitsMode === 'explore') return;
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
	 * their reply tag, nested replies carry it as their NIP-10 root tag. Powers
	 * the comment counters. */
	function commentsFor(reelId: string) {
		return feed.notes
			.filter(
				(note) => note.id !== reelId && note.tags.some((tag) => tag[0] === 'e' && tag[1] === reelId)
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
	 * hearts at the tap point — the reflex interaction every reels app needs. */
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
			const filter: {
				kinds: number[];
				'#e': string[];
				limit: number;
				until?: number;
			} = {
				kinds: [NOSTR_KINDS.TEXT_NOTE],
				'#e': [reel.id],
				limit: COMMENTS_PAGE_SIZE
			};
			if (options.more) filter.until = page!.oldestCreatedAt - 1;
			const replyEvents = await queryPrimaryFirst([filter]);
			// Keep the whole thread, not just direct replies: nested replies-to-
			// comments reference the reel through their NIP-10 root tag.
			const replies = replyEvents
				.map(toFeedNote)
				.filter((note) => note.tags.some((tag) => tag[0] === 'e' && tag[1] === reel.id));
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

	// --- Explore grid (Bits · Explore tab) ----------------------------------

	function switchBitsMode(mode: BitsMode) {
		// Re-tapping the active tab is the standard "back to top" shortcut. It
		// replaces the old forced reset: position survives tab switches, and
		// returning to the top is an explicit user action instead of a penalty.
		if (bitsMode === mode) {
			const scroller = mode === 'explore' ? exploreScroller : reelScroller;
			scroller?.scrollTo({ top: 0, behavior: 'smooth' });
			return;
		}
		bitsMode = mode;
		if (mode === 'explore') {
			// Coming back to the grid must land on the tiles the user left behind
			// (tap tile → For you → Explore = same spot, not a scroll-from-scratch).
			// The scroller remounts in this branch, so restore after the DOM is
			// ready; exploreVisible already holds the revealed window and the scroll
			// offset lives in the session (kept fresh by handleExploreScroll).
			void tick().then(() => {
				requestAnimationFrame(() => {
					exploreScroller?.scrollTo({ top: bitsSession.exploreScrollTop });
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
					if (reelScroller && bitsSession.activeReelIndex > 0)
						reelScroller.scrollTo({
							top: bitsSession.activeReelIndex * reelScroller.clientHeight
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
		bitsSession.exploreScrollTop = exploreScroller.scrollTop;
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
		if (exploreScroller) bitsSession.exploreScrollTop = exploreScroller.scrollTop;
		const index = rankedReels.findIndex((item) => item.id === reel.id);
		bitsMode = 'foryou';
		if (index < 0) return;
		renderedReelCount = Math.max(renderedReelCount, index + REEL_RENDER_BATCH);
		profiles.ensure(rankedReels.slice(0, renderedReelCount).map((item) => item.pubkey));
		await tick();
		requestAnimationFrame(() => {
			reelScroller?.scrollTo({ top: index * reelScroller.clientHeight });
		});
	}

	// Mirror UI state into the session so a route switch and return restores
	// exactly this view. (reels/cursor mirror imperatively in applyReels —
	// async relay loads can land after this component unmounts.)
	$effect(() => {
		bitsSession.bitsMode = bitsMode;
		bitsSession.exploreVisible = exploreVisible;
		bitsSession.revealedSensitiveReels = revealedSensitiveReels;
		bitsSession.renderedReelCount = renderedReelCount;
	});

	// The Explore grid reveals tiles through its own counter (exploreVisible),
	// so it never passes through renderMoreReels' profile prefetch. Keep author
	// metadata (names/avatars) flowing for exactly the tiles on screen;
	// profiles.ensure dedupes in-flight requests and skips fresh (12h) entries.
	$effect(() => {
		if (bitsMode !== 'explore') return;
		void profiles.ensure(visibleExploreReels.map((reel) => reel.pubkey));
	});

	onMount(() => {
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
		let hydrated = false;
		if (bitsSession.reels.length) {
			loading = false;
			reels = bitsSession.reels;
			renderedReelCount = Math.max(
				INITIAL_RENDERED_REELS,
				Math.min(bitsSession.renderedReelCount || INITIAL_RENDERED_REELS, reels.length)
			);
			bitsMode = bitsSession.bitsMode;
			exploreVisible = Math.max(EXPLORE_INITIAL_VISIBLE, bitsSession.exploreVisible);
			revealedSensitiveReels = bitsSession.revealedSensitiveReels;
			oldestReelEventCreatedAt = bitsSession.oldestReelEventCreatedAt;
			hasMoreReels = bitsSession.hasMoreReels && !!oldestReelEventCreatedAt;
			profiles.ensure(reels.slice(0, renderedReelCount).map((reel) => reel.pubkey));
			hydrated = true;
			void tick().then(() => {
				requestAnimationFrame(() => {
					if (bitsMode === 'explore')
						exploreScroller?.scrollTo({ top: bitsSession.exploreScrollTop });
					else if (reelScroller)
						reelScroller.scrollTo({
							top: bitsSession.activeReelIndex * reelScroller.clientHeight
						});
				});
			});
			if (Date.now() - bitsSession.lastRefreshedAt > BITS_SESSION_REFRESH_MS) {
				void loadReels({ background: true });
			}
		}
		const hasCache = hydrated ? false : loadCachedReels();
		if (hasCache) {
			loading = false;
			void loadReels({ background: true });
			void ensureMoreReelsBuffered();
		} else if (!hydrated) {
			void loadReels();
		}

		return () => {
			document.removeEventListener('fullscreenchange', handleFullscreenChange);
			visibilityObserver?.disconnect();
			visibilityObserver = null;
			reelVideos.clear();
			reelCards.clear();
			reelVisibility.clear();
		};
	});
</script>

<svelte:head><title>Bits · BitOS</title></svelte:head>

<svelte:window onkeydown={handleKeydown} />

<div class="relative h-full bg-[var(--ui-bg)] text-[var(--ui-text)]">
	{#if loading}
		<div class="flex h-full items-center justify-center">
			<div
				class="size-8 animate-spin rounded-full border-2 border-[var(--ui-border)] border-t-primary-500"
			></div>
		</div>
	{:else if bitsMode === 'explore'}
		<!-- Explore: video-first grid, TikTok-discover style -->
		<div
			bind:this={exploreScroller}
			class="h-full [scrollbar-width:none] overflow-y-auto bg-black [&::-webkit-scrollbar]:hidden"
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
							class="group relative aspect-[9/16] overflow-hidden rounded-lg bg-black text-left"
							aria-label="Open bit by {name}"
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
									alt={captionFor(reel) || 'Bit picture'}
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
									<span class="flex min-w-0 items-center gap-1">
										<Avatar
											pubkey={reel.pubkey}
											{name}
											picture={profile?.picture}
											size={16}
											shape="hex"
										/>
										<span class="truncate text-[10px] font-bold">{name}</span>
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
							class="inline-flex h-10 items-center gap-2 rounded-full border border-white/20 bg-white/10 px-5 text-[13px] font-bold text-white transition hover:bg-white/20"
						>
							<Icon name="i-lucide-plus" class="size-4" />
							Load more bits
						</button>
					{:else if loadingMoreReels || hasMoreReels}
						<button
							type="button"
							onclick={() => void loadMoreExploreReels()}
							disabled={loadingMoreReels}
							class="inline-flex h-10 items-center gap-2 rounded-full border border-white/20 bg-white/10 px-5 text-[13px] font-bold text-white transition hover:bg-white/20 disabled:cursor-default disabled:opacity-60"
						>
							<Icon
								name="i-lucide-loader-circle"
								class="size-4 {loadingMoreReels ? 'animate-spin' : 'hidden'}"
							/>
							{loadingMoreReels ? 'Loading older bits' : 'Load older bits'}
						</button>
					{:else}
						<p class="text-[11px] font-semibold text-white/50">That's all the bits for now</p>
					{/if}
				</div>
			{:else}
				<div
					class="flex h-full flex-col items-center justify-center gap-3 px-6 pb-16 text-center text-white"
				>
					<div class="grid size-14 place-items-center rounded-2xl bg-white/10 text-white/70">
						<Icon name="i-lucide-clapperboard" class="size-7" />
					</div>
					<div>
						<p class="text-[15px] font-bold">No bits to explore yet</p>
						<p class="mt-1 text-[13px] text-white/60">
							Short videos and pictures from your relays will appear here.
						</p>
					</div>
					<button
						type="button"
						onclick={() => loadReels()}
						class="mt-2 rounded-full bg-white px-5 py-2.5 text-[13px] font-bold text-black transition hover:opacity-90"
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
							<MediaPlayer
								src={reel.mediaUrl}
								label="Relay video note"
								class="absolute inset-0"
								mediaClass="absolute inset-0 size-full object-cover {reelCovered
									? 'scale-105 blur-2xl saturate-50'
									: ''}"
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
							<button
								type="button"
								onclick={() => {
									navigator.clipboard.writeText(`nostr:${noteEncode(reel.id)}`);
									toasts.success('Note ID copied');
								}}
								class="reel-action"
							>
								<span class="icon-circle"><Icon name="i-lucide-share" class="size-5" /></span>
								<span class="text-[11px] font-semibold">Share</span>
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
							<a href={`/profile/${reel.pubkey}`} class="spin-slow mt-2" aria-label="Open profile">
								<Avatar
									pubkey={reel.pubkey}
									{name}
									picture={profile?.picture}
									verified={hasNip05(profile)}
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
									verified={hasNip05(profile)}
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
										<!-- Same overflow menu as a feed post card, scoped to this bit. -->
										<Popover
											id={reelMenuId(reel)}
											placement="top-start"
											width="auto"
											class="w-60"
											label="Bit actions"
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
												{bookmarks.has(reel.id) ? 'Unsave bit' : 'Save bit'}
											</MenuItem>
											<MenuItem
												icon="i-lucide-link"
												onclick={() => copyText(`nostr:${noteEncode(reel.id)}`, 'Note link')}
											>
												Copy note link
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
													Delete bit
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
													Report bit
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
							{#if loadingMoreReels && reel.id === renderedReels.at(-1)?.id}
								<div
									class="mt-3 inline-flex items-center gap-2 rounded-full bg-black/35 px-3 py-1 text-[11px] font-semibold backdrop-blur"
								>
									<Icon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
									Loading older bits
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
							{bitsMode === 'following' ? 'Nothing from your follows yet' : 'No bits found'}
						</h1>
						<p class="mt-2 text-[13px] leading-relaxed text-[var(--ui-text-muted)]">
							{bitsMode === 'following'
								? 'Follow more creators from Discover and their short videos will land here.'
								: 'Your configured relays did not return kind-1 notes with video links.'}
						</p>
						{#if bitsMode === 'following'}
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
						aria-label="Previous bit"
					>
						<Icon name="i-lucide-chevron-up" class="size-[18px]" />
					</button>
					<button
						type="button"
						onclick={() => scrollToReel(1)}
						class="grid size-9 place-items-center rounded-full bg-white/12 text-white/90 transition hover:bg-white/25 hover:text-white"
						aria-label="Next bit"
					>
						<Icon name="i-lucide-chevron-down" class="size-[18px]" />
					</button>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Sticky top bar: Bits wordmark · view tabs · refresh. Shrinks with the
	     comments panel so the tabs stay centered over the video area (lg). -->
	<div
		class="pointer-events-none absolute inset-x-0 top-0 z-40 grid grid-cols-[1fr_auto_1fr] items-center gap-2 bg-gradient-to-b from-black/55 via-black/25 to-transparent px-4 pt-4 pb-12 text-white transition-[padding] duration-200 {commentReel
			? 'lg:pr-[390px]'
			: ''}"
	>
		<h2
			class="pointer-events-auto hidden justify-self-start font-display text-[22px] font-extrabold text-white drop-shadow sm:block"
		>
			Bits
		</h2>
		<div
			class="pointer-events-auto flex items-center gap-0.5 rounded-full bg-black/40 p-1 backdrop-blur-md"
			role="tablist"
			aria-label="Bits views"
		>
			{#each bitsTabs as tab (tab.key)}
				<button
					type="button"
					role="tab"
					aria-selected={bitsMode === tab.key}
					onclick={() => switchBitsMode(tab.key)}
					class="rounded-full px-3 py-1.5 text-[13px] font-bold whitespace-nowrap transition {bitsMode ===
					tab.key
						? 'bg-white text-black'
						: 'text-white/75 hover:text-white'}"
				>
					{tab.label}
				</button>
			{/each}
		</div>
		<div class="pointer-events-auto flex items-center gap-2 justify-self-end">
			<button
				type="button"
				onclick={() => search.openOverlay()}
				class="grid size-10 place-items-center rounded-xl bg-white/15 text-white backdrop-blur transition hover:bg-white/25"
				aria-label="Search bits"
			>
				<Icon name="i-lucide-search" class="size-5" />
			</button>
			<button
				type="button"
				onclick={() => loadReels()}
				class="grid size-10 place-items-center rounded-xl bg-white/15 text-white backdrop-blur transition hover:bg-white/25"
				aria-label="Refresh bits"
			>
				<Icon name="i-lucide-rotate-cw" class="size-5" />
			</button>
		</div>
	</div>

	<!-- Bits video search: instant local matches + NIP-50 relay search (store-driven) -->
	{#if search.open}
		<BitsSearch
			{search}
			profileFor={(pubkey) => profiles.get(pubkey)}
			{gridVideoDurations}
			onDuration={(reelId, seconds) =>
				(gridVideoDurations = { ...gridVideoDurations, [reelId]: seconds })}
			onSelect={(reel) => void openBitResult(reel)}
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
			aria-label="Bit comments"
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
											verified={hasNip05(commentProfile)}
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

	<!-- NIP-56 report (overflow menu → “Report bit”) -->
	{#if reportReelTarget}
		<ReportDialog
			bind:open={reportReelOpen}
			pubkey={reportReelTarget.pubkey}
			noteId={reportReelTarget.id}
			targetLabel={captionFor(reportReelTarget).slice(0, 60) || 'bit'}
		/>
	{/if}

	<!-- Delete own bit (overflow menu → “Delete bit”) -->
	<Dialog bind:open={deleteReelOpen} title="Delete bit">
		<div class="space-y-2">
			<p class="text-[14px] font-semibold text-[var(--ui-text)]">Delete this bit?</p>
			<p class="text-[13px] leading-relaxed text-[var(--ui-text-muted)]">
				BitOS will publish a delete event to your relays and remove the bit locally.
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
</div>
