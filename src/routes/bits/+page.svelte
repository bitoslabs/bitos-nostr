<script lang="ts">
	import { onMount } from 'svelte';
	import { noteEncode } from 'nostr-tools/nip19';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import PowBadge from '$lib/components/ui/PowBadge.svelte';
	import NoteZapDialog from '$lib/components/feed/NoteZapDialog.svelte';
	import MediaPlayer from '$lib/components/media/MediaPlayer.svelte';
	import { feed } from '$lib/nostr/feed.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { queryPrimaryFirst, queryUrls } from '$lib/nostr/pool';
	import { DISCOVERY_RELAY_URLS, relays } from '$lib/nostr/relays.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { NOSTR_KINDS, type FeedNote } from '$lib/nostr/types';
	import { toFeedNote } from '$lib/nostr/feed-note';
	import { applyActivityToNotes } from '$lib/nostr/zaps';
	import { bookmarks } from '$lib/stores/bookmarks.svelte';
	import { algorithmPreferences, buildScoringContext, rankNotes } from '$lib/algorithm';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { shortKey, timeAgo } from '$lib/utils/format';
	import { sensitiveMediaReason } from '$lib/utils/sensitive-media';
	import { privacyNotificationSettings } from '$lib/stores/privacy-notification-settings.svelte';
	import { compactSats } from '$lib/utils/profile-stats';

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

	type ReelNote = FeedNote & { videoUrl: string };
	type ReelsCache = {
		savedAt: number;
		reels: ReelNote[];
	};

	const urlPattern = /https?:\/\/[^\s<>()]+/gi;
	const videoPattern = /\.(?:m3u8|m4v|mov|mp4|webm)$/i;
	const videoFormatPattern = /(?:[?&](?:ext|fm|format)=)(?:m3u8|m4v|mov|mp4|webm)\b/i;
	const videoPathPattern = /(?:^|\/)(?:video|videos|reel|reels)(?:\/|$|:|-|_)/i;
	const REELS_CACHE_KEY = 'bitos:reels-cache:v1';
	const REELS_CACHE_TTL_MS = 15 * 60 * 1000;
	const MAX_CACHED_REELS = 120;
	const REELS_INITIAL_EVENT_LIMIT = 400;
	const REELS_PAGE_EVENT_LIMIT = 220;
	const INITIAL_RENDERED_REELS = 5;
	const REEL_RENDER_BATCH = 5;
	const REEL_PREFETCH_THRESHOLD = 6;

	let loading = $state(true);
	let loadingComments = $state(false);
	let postingComment = $state(false);
	let deletingCommentId = $state('');
	let loadingMoreReels = $state(false);
	let hasMoreReels = $state(true);
	let reelScroller: HTMLDivElement | undefined = $state();
	let reels = $state<ReelNote[]>([]);
	let renderedReelCount = $state(INITIAL_RENDERED_REELS);
	let activeReelId = $state('');
	let activeReelMuted = $state(true);
	let revealedSensitiveReels = $state<Record<string, boolean>>({});
	let commentReel = $state<ReelNote | null>(null);
	let commentPendingDelete = $state<FeedNote | null>(null);
	let deleteCommentOpen = $state(false);
	let commentsLoadedFor = $state('');
	let commentText = $state('');
	let reelVideos = new Map<string, HTMLVideoElement>();
	let reelCards = new Map<string, HTMLDivElement>();
	let reelVisibility = new Map<string, number>();
	let visibilityObserver: IntersectionObserver | null = null;
	let oldestReelEventCreatedAt = $state(0);
	let zapReel = $state<ReelNote | null>(null);
	let zapOpen = $state(false);
	let optimisticZapSats = $state<Record<string, number>>({});
	let bursts = $state<Burst[]>([]);
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
	const renderedReels = $derived(rankedReels.slice(0, renderedReelCount));
	const hasMoreRenderedReels = $derived(renderedReelCount < reels.length);
	const activeComments = $derived(commentReel ? commentsFor(commentReel.id) : []);
	const currentProfile = $derived(identity.current ? profiles.get(identity.current.pk) : undefined);
	const currentDisplayName = $derived(
		currentProfile?.display_name || currentProfile?.name || 'You'
	);

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

	function captionFor(reel: ReelNote) {
		return reel.content.split(reel.videoUrl).join(' ').replace(/\s+/g, ' ').trim();
	}

	function mergeReelLists(existing: ReelNote[], incoming: ReelNote[]) {
		const merged = new Map<string, ReelNote>();
		for (const reel of existing) merged.set(reel.id, reel);
		for (const reel of incoming) merged.set(reel.id, reel);
		return [...merged.values()]
			.sort((a, b) => b.createdAt - a.createdAt)
			.slice(0, MAX_CACHED_REELS);
	}

	function discoveryUrls() {
		if (!algorithmPreferences.relayDiscovery.reels) return [];
		return DISCOVERY_RELAY_URLS.filter((url) => !relays.urls.includes(url));
	}

	function mergeEvents(
		configured: Awaited<ReturnType<typeof queryPrimaryFirst>>,
		discovered: Awaited<ReturnType<typeof queryUrls>>
	) {
		const seen = new Set<string>();
		return [...configured, ...discovered].filter((event) => {
			if (seen.has(event.id)) return false;
			seen.add(event.id);
			return true;
		});
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
		reels = options.append ? mergeReelLists(reels, next) : next.slice(0, MAX_CACHED_REELS);
		renderedReelCount = options.append
			? Math.min(reels.length, Math.max(renderedReelCount, INITIAL_RENDERED_REELS))
			: Math.min(INITIAL_RENDERED_REELS, reels.length);
		if (identity.current) profiles.ensure([identity.current.pk]);
		profiles.ensure(
			reels.slice(0, Math.max(renderedReelCount, INITIAL_RENDERED_REELS)).map((reel) => reel.pubkey)
		);
		for (const reel of next) feed.upsertNote(reel);
	}

	function loadCachedReels() {
		try {
			const raw = localStorage.getItem(REELS_CACHE_KEY);
			if (!raw) return false;
			const cached = JSON.parse(raw) as ReelsCache;
			if (!cached?.savedAt || Date.now() - cached.savedAt > REELS_CACHE_TTL_MS) return false;
			if (!Array.isArray(cached.reels)) return false;
			applyReels(cached.reels);
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
		oldestReelEventCreatedAt =
			events
				.slice()
				.sort((a, b) => b.created_at - a.created_at)
				.at(-1)?.created_at ?? 0;
		hasMoreReels =
			events.length >= (options.append ? REELS_PAGE_EVENT_LIMIT : REELS_INITIAL_EVENT_LIMIT) &&
			!!oldestReelEventCreatedAt;
		saveReelsCache(options.append ? reels : nextReels);
	}

	async function buildReelsFromEvents(
		events: Awaited<ReturnType<typeof queryPrimaryFirst>>,
		discoveryIds = new Set<string>()
	) {
		const seen: Record<string, true> = {};
		const baseReels = events
			.sort((a, b) => b.created_at - a.created_at)
			.map((event) => ({ event, videoUrl: extractVideo(event) }))
			.filter(({ event, videoUrl }) => {
				if (!videoUrl || seen[event.id]) return false;
				seen[event.id] = true;
				return true;
			})
			.map(({ event, videoUrl }) => ({
				...toFeedNote(event),
				videoUrl,
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
				videoUrl: baseReels.find((reel) => reel.id === note.id)?.videoUrl ?? ''
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
			const filters = [{ kinds: [NOSTR_KINDS.TEXT_NOTE], limit: REELS_INITIAL_EVENT_LIMIT }];
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
		}
	}

	async function loadMoreReels() {
		if (loading || loadingMoreReels || !hasMoreReels || !oldestReelEventCreatedAt) return;
		loadingMoreReels = true;
		try {
			const filters = [
				{
					kinds: [NOSTR_KINDS.TEXT_NOTE],
					limit: REELS_PAGE_EVENT_LIMIT,
					until: oldestReelEventCreatedAt - 1
				}
			];
			const discoveryPromise = queryUrls(discoveryUrls(), filters);
			const events = await queryPrimaryFirst(filters, {
				onSecondary: (mergedEvents) => {
					void discoveryPromise.then((discovered) =>
						updateReelWindow(mergeEvents(mergedEvents, discovered), {
							append: true,
							discoveryIds: discoveryOnlyIds(mergedEvents, discovered)
						})
					);
				}
			});
			if (!events.length) {
				hasMoreReels = false;
				return;
			}
			const discovered = await discoveryPromise;
			await updateReelWindow(mergeEvents(events, discovered), {
				append: true,
				discoveryIds: discoveryOnlyIds(events, discovered)
			});
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

	function handleReelScroll() {
		if (!reelScroller) return;
		const remaining =
			reelScroller.scrollHeight - reelScroller.scrollTop - reelScroller.clientHeight;
		if (remaining < reelScroller.clientHeight * 2) renderMoreReels();
		if (remaining < reelScroller.clientHeight * 3) void ensureMoreReelsBuffered();
		if (commentReel) {
			const activeReel = reelAtScrollPosition();
			if (activeReel && activeReel.id !== commentReel.id) {
				commentReel = activeReel;
				commentText = '';
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
				commentText = '';
				void loadComments(next);
			}
		}
	}

	/** Desktop power moves: ↑/↓ jump reels, Space/K play-pause, M mute,
	 * F fullscreen, ←/→ seek 5s. Ignored while typing in the comments box. */
	function handleKeydown(event: KeyboardEvent) {
		const target = event.target as HTMLElement | null;
		// Never steal keys while typing…
		if (target?.closest('input, textarea, select, [contenteditable]')) return;
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

	function commentsFor(reelId: string) {
		return feed.notes
			.filter((note) => note.replyTo === reelId && note.id !== reelId)
			.sort((a, b) => a.createdAt - b.createdAt);
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
		commentText = '';
		await loadComments(reel);
	}

	async function loadComments(reel: ReelNote, options: { force?: boolean } = {}) {
		if (!options.force && commentsLoadedFor === reel.id) return;
		loadingComments = true;
		try {
			const replyEvents = await queryPrimaryFirst([
				{ kinds: [NOSTR_KINDS.TEXT_NOTE], '#e': [reel.id], limit: 200 }
			]);
			const replies = replyEvents.map(toFeedNote).filter((note) => note.replyTo === reel.id);
			const replyIds = replies.map((reply) => reply.id);
			const reactions = replyIds.length
				? await queryPrimaryFirst([{ kinds: [NOSTR_KINDS.REACTION], '#e': replyIds, limit: 300 }])
				: [];
			const withActivity = applyActivityToNotes(replies, reactions, identity.current?.pk);
			for (const reply of withActivity) feed.upsertNote(reply);
			profiles.ensure(withActivity.map((reply) => reply.pubkey));
			commentsLoadedFor = reel.id;
		} catch (e) {
			toasts.error((e as Error).message || 'Could not load comments');
		} finally {
			loadingComments = false;
		}
	}

	async function submitComment() {
		if (!commentReel || !commentText.trim() || postingComment) return;
		feed.upsertNote(commentReel);
		postingComment = true;
		try {
			await feed.reply(commentReel, commentText);
			commentText = '';
			await loadComments(commentReel, { force: true });
			toasts.success('Comment posted');
		} catch (e) {
			toasts.error((e as Error).message);
		} finally {
			postingComment = false;
		}
	}

	async function likeComment(comment: FeedNote) {
		try {
			await feed.react(comment, '❤️');
			if (commentReel) await loadComments(commentReel, { force: true });
		} catch (e) {
			toasts.error((e as Error).message);
		}
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

	onMount(() => {
		visibilityObserver = createVisibilityObserver();
		for (const node of reelCards.values()) visibilityObserver?.observe(node);

		const handleFullscreenChange = () => {
			if (document.fullscreenElement) return;
			void syncActivePlayback();
		};
		document.addEventListener('fullscreenchange', handleFullscreenChange);

		const hasCache = loadCachedReels();
		if (hasCache) {
			loading = false;
			void loadReels({ background: true });
			void ensureMoreReelsBuffered();
		} else {
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
	<div
		bind:this={reelScroller}
		class="reel-container h-full snap-y snap-mandatory [scrollbar-width:none] overflow-y-auto transition-[padding] duration-200 {commentReel
			? 'lg:pr-[390px]'
			: ''} [&::-webkit-scrollbar]:hidden"
		onscroll={handleReelScroll}
	>
		{#if loading}
			<div class="flex h-full items-center justify-center">
				<div
					class="size-8 animate-spin rounded-full border-2 border-[var(--ui-border)] border-t-primary-500"
				></div>
			</div>
		{:else if reels.length}
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
					<MediaPlayer
						src={reel.videoUrl}
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
					<div class="pointer-events-none absolute inset-0 z-30 overflow-hidden" aria-hidden="true">
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

					<div class="absolute inset-x-0 top-0 z-10 flex items-center justify-between p-5">
						<h2 class="font-display text-[26px] font-extrabold text-white">Bits</h2>
						<div class="flex items-center gap-2">
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
							aria-label={zapTotalFor(reel) ? `Zap — ${zapTotalFor(reel)} sats total` : 'Zap sats'}
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
						<a
							href={`/profile/${reel.pubkey}`}
							class="spin-slow mt-2 size-10 overflow-hidden mask-squircle border-2 border-white"
							aria-label="Open profile"
						>
							<Avatar pubkey={reel.pubkey} {name} picture={profile?.picture} size={40} />
						</a>
					</div>

					<!-- pb clears the auto-hiding player bar (progress + play/mute row) -->
					<div class="absolute inset-x-0 bottom-0 z-10 p-5 pr-20 pb-[4.75rem] text-white">
						<div class="mb-3 flex items-center gap-3">
							<Avatar
								pubkey={reel.pubkey}
								{name}
								picture={profile?.picture}
								size={40}
								class="ring-2 ring-white"
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
								<p class="flex items-center gap-1.5 text-[11px] opacity-80">
									<span>{timeAgo(reel.createdAt)}</span>
									{#if reel.source === 'discovery'}
										<span>· discovery</span>{/if}
									{#if reel.pow}
										<PowBadge bits={reel.pow} micro id={reel.id} />
									{/if}
								</p>
							</div>
						</div>
						{#if captionFor(reel)}
							<p class="line-clamp-4 text-[13.5px] leading-relaxed">{captionFor(reel)}</p>
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
					<h1 class="font-display text-[28px] font-extrabold">No bits found</h1>
					<p class="mt-2 text-[13px] leading-relaxed text-[var(--ui-text-muted)]">
						Your configured relays did not return kind-1 notes with video links.
					</p>
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

		{#if reels.length}
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

		{#if commentReel}
			<button
				type="button"
				class="fixed inset-0 z-40 bg-black/45 lg:hidden"
				aria-label="Close comments"
				onclick={() => (commentReel = null)}
			></button>
			<aside
				class="reel-comments-panel fixed inset-x-0 bottom-0 z-50 flex max-h-[78vh] flex-col overflow-hidden rounded-t-3xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] text-[var(--ui-text)] shadow-2xl shadow-black/20 lg:inset-y-0 lg:right-0 lg:left-auto lg:h-full lg:max-h-none lg:w-[390px] lg:rounded-none lg:border-y-0 lg:border-r-0"
				aria-label="Bit comments"
			>
				<header
					class="flex h-14 shrink-0 items-center justify-between border-b border-[var(--ui-border-muted)] px-4"
				>
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
					{:else if activeComments.length}
						<div class="space-y-6">
							{#each activeComments as comment (comment.id)}
								{@const commentProfile = profiles.get(comment.pubkey)}
								{@const commentName =
									commentProfile?.display_name || commentProfile?.name || shortKey(comment.pubkey)}
								<div class="flex gap-3">
									<a href={`/profile/${comment.pubkey}`} class="shrink-0">
										<Avatar
											pubkey={comment.pubkey}
											name={commentName}
											picture={commentProfile?.picture}
											size={34}
											frame
										/>
									</a>
									<div class="min-w-0 flex-1">
										<div class="flex items-start gap-2">
											<div class="min-w-0 flex-1">
												<a
													href={`/profile/${comment.pubkey}`}
													class="block truncate text-[12px] font-extrabold text-[var(--ui-text-highlighted)] hover:text-primary-500"
												>
													{commentName}
												</a>
												<a
													href={`/note/${comment.id}?from=reels`}
													class="block hover:text-primary-500"
												>
													<p
														class="mt-1 text-[14px] leading-relaxed whitespace-pre-wrap text-[var(--ui-text)]"
													>
														{comment.content}
													</p>
												</a>
											</div>
											<button
												type="button"
												onclick={() => likeComment(comment)}
												class="flex w-9 shrink-0 flex-col items-center gap-1 text-[var(--ui-text-muted)] transition hover:text-primary-500"
												aria-label="Like comment"
											>
												<Icon
													name={comment.reactions.some((reaction) => reaction.byMe)
														? 'i-solar-heart-bold'
														: 'i-solar-heart-linear'}
													class="size-4 {comment.reactions.some((reaction) => reaction.byMe)
														? 'text-primary-500'
														: ''}"
												/>
												<span class="text-[11px]">
													{comment.reactions.reduce((sum, reaction) => sum + reaction.count, 0)}
												</span>
											</button>
										</div>
										<div
											class="mt-2 flex items-center gap-3 text-[12px] font-semibold text-[var(--ui-text-dimmed)]"
										>
											<span>{timeAgo(comment.createdAt)}</span>
											<button
												type="button"
												onclick={() => (commentText = `@${commentName} `)}
												class="hover:text-[var(--ui-text-highlighted)]"
											>
												Reply
											</button>
											{#if comment.pubkey === identity.current?.pk}
												<button
													type="button"
													onclick={() => askDeleteComment(comment)}
													disabled={deletingCommentId === comment.id}
													class="hover:text-[var(--ui-text-highlighted)] disabled:cursor-not-allowed disabled:opacity-60"
												>
													{deletingCommentId === comment.id ? 'Deleting' : 'Delete'}
												</button>
											{/if}
										</div>
									</div>
								</div>
							{/each}
						</div>
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

				<div
					class="shrink-0 border-t border-[var(--ui-border-muted)] bg-[var(--surface-bg)] p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
				>
					<div class="flex items-end gap-2">
						{#if identity.current}
							<Avatar
								pubkey={identity.current.pk}
								name={currentDisplayName}
								picture={currentProfile?.picture}
								size={32}
								frame
							/>
						{/if}
						<textarea
							bind:value={commentText}
							rows="1"
							placeholder={identity.current
								? 'Add a comment...'
								: 'Create or import a key to comment'}
							disabled={!identity.current || postingComment}
							class="max-h-28 min-h-10 flex-1 resize-none rounded-full bg-[var(--ui-bg-accented)] px-4 py-2.5 text-[14px] text-[var(--ui-text)] outline-none placeholder:text-[var(--ui-text-dimmed)] focus:ring-2 focus:ring-primary-500/40 disabled:cursor-not-allowed disabled:opacity-60"
							onkeydown={(event) => {
								if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
									event.preventDefault();
									void submitComment();
								}
							}}></textarea>
						<button
							type="button"
							onclick={submitComment}
							disabled={!commentText.trim() || !identity.current || postingComment}
							class="grid size-10 shrink-0 place-items-center rounded-full bg-primary-500 text-white shadow-[var(--glow-primary)] transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
							aria-label="Post comment"
						>
							<Icon
								name={postingComment ? 'i-lucide-loader-circle' : 'i-lucide-send-horizontal'}
								class="size-4 {postingComment ? 'animate-spin' : ''}"
							/>
						</button>
					</div>
				</div>
			</aside>
		{/if}
	</div>

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
</div>
