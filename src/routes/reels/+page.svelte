<script lang="ts">
	import { onMount } from 'svelte';
	import { noteEncode } from 'nostr-tools/nip19';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { feed } from '$lib/nostr/feed.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { queryOnce } from '$lib/nostr/pool';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { NOSTR_KINDS, type FeedNote } from '$lib/nostr/types';
	import { applyActivityToNotes } from '$lib/nostr/zaps';
	import { bookmarks } from '$lib/stores/bookmarks.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { shortKey, timeAgo } from '$lib/utils/format';

	type ReelNote = FeedNote & { videoUrl: string };
	type ReelsCache = {
		savedAt: number;
		reels: ReelNote[];
	};

	const urlPattern = /https?:\/\/[^\s<>()]+/gi;
	const videoPattern = /\.(?:m3u8|m4v|mov|mp4|webm)$/i;
	const videoFormatPattern = /(?:[?&](?:ext|fm|format)=)(?:m3u8|m4v|mov|mp4|webm)\b/i;
	const videoPathPattern = /(?:^|\/)(?:video|videos|reel|reels|upload)(?:\/|$|:|-|_)/i;
	const REELS_CACHE_KEY = 'bitos:reels-cache:v1';
	const REELS_CACHE_TTL_MS = 15 * 60 * 1000;
	const MAX_CACHED_REELS = 40;
	const INITIAL_RENDERED_REELS = 5;
	const REEL_RENDER_BATCH = 5;

	let loading = $state(true);
	let loadingComments = $state(false);
	let postingComment = $state(false);
	let deletingCommentId = $state('');
	let reelScroller: HTMLDivElement | undefined = $state();
	let reels = $state<ReelNote[]>([]);
	let renderedReelCount = $state(INITIAL_RENDERED_REELS);
	let commentReel = $state<ReelNote | null>(null);
	let commentPendingDelete = $state<FeedNote | null>(null);
	let deleteCommentOpen = $state(false);
	let commentsLoadedFor = $state('');
	let commentText = $state('');
	const renderedReels = $derived(reels.slice(0, renderedReelCount));
	const hasMoreRenderedReels = $derived(renderedReelCount < reels.length);
	const activeComments = $derived(commentReel ? commentsFor(commentReel.id) : []);
	const currentProfile = $derived(identity.current ? profiles.get(identity.current.pk) : undefined);
	const currentDisplayName = $derived(currentProfile?.display_name || currentProfile?.name || 'You');

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
			if (url && (mime?.startsWith('video/') || looksLikeVideoUrl(url))) return url;
		}
		for (const match of event.content.matchAll(urlPattern)) {
			const { core } = splitTrailingPunctuation(match[0]);
			if (looksLikeVideoUrl(core)) return core;
		}
		return '';
	}

	function captionFor(reel: ReelNote) {
		return reel.content
			.split(reel.videoUrl)
			.join(' ')
			.replace(/\s+/g, ' ')
			.trim();
	}

	function toFeedNote(event: {
		id: string;
		pubkey: string;
		content: string;
		created_at: number;
		tags: string[][];
	}): FeedNote {
		const replyTag = event.tags.find((tag) => tag[0] === 'e' && tag[3] === 'reply');
		return {
			id: event.id,
			pubkey: event.pubkey,
			content: event.content,
			createdAt: event.created_at,
			tags: event.tags,
			replyTo: replyTag?.[1],
			reactions: [],
			repostCount: 0,
			zapCount: 0,
			zapTotalSats: 0
		};
	}

	function applyReels(next: ReelNote[]) {
		reels = next.slice(0, MAX_CACHED_REELS);
		renderedReelCount = Math.min(INITIAL_RENDERED_REELS, reels.length);
		profiles.ensure(reels.slice(0, renderedReelCount).map((reel) => reel.pubkey));
		if (identity.current) profiles.ensure([identity.current.pk]);
		for (const reel of reels) feed.upsertNote(reel);
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

	async function loadReels(options: { background?: boolean } = {}) {
		if (!options.background) loading = true;
		try {
			const events = await queryOnce([{ kinds: [NOSTR_KINDS.TEXT_NOTE], limit: 400 }]);
			const seen: Record<string, true> = {};
			const baseReels = events
				.sort((a, b) => b.created_at - a.created_at)
				.map((event) => ({ event, videoUrl: extractVideo(event) }))
				.filter(({ event, videoUrl }) => {
					if (!videoUrl || seen[event.id]) return false;
					seen[event.id] = true;
					return true;
				})
				.slice(0, 40)
				.map(({ event, videoUrl }) => ({ ...toFeedNote(event), videoUrl }));
			const reelIds = baseReels.map((reel) => reel.id);
			const activity = reelIds.length
				? await queryOnce([
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
			applyReels(nextReels);
			saveReelsCache(nextReels);
		} catch (e) {
			if (!options.background) toasts.error((e as Error).message || 'Could not load reels');
		} finally {
			loading = false;
		}
	}

	function renderMoreReels() {
		if (!hasMoreRenderedReels) return;
		renderedReelCount = Math.min(reels.length, renderedReelCount + REEL_RENDER_BATCH);
		profiles.ensure(reels.slice(0, renderedReelCount).map((reel) => reel.pubkey));
	}

	function handleReelScroll() {
		if (!reelScroller) return;
		const remaining =
			reelScroller.scrollHeight - reelScroller.scrollTop - reelScroller.clientHeight;
		if (remaining < reelScroller.clientHeight * 2) renderMoreReels();
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
			Math.min(renderedReels.length - 1, Math.round(reelScroller.scrollTop / reelScroller.clientHeight))
		);
		return renderedReels[index] ?? null;
	}

	function activeReelIndex() {
		if (!reelScroller || !renderedReels.length) return 0;
		return Math.max(
			0,
			Math.min(renderedReels.length - 1, Math.round(reelScroller.scrollTop / reelScroller.clientHeight))
		);
	}

	function scrollToReel(delta: -1 | 1) {
		if (!reelScroller || !renderedReels.length) return;
		const current = activeReelIndex();
		const target = current + delta;
		if (target < 0) return;
		if (target >= renderedReels.length) {
			if (!hasMoreRenderedReels) return;
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
			if (updated) reels = reels.map((item) => (item.id === reel.id ? { ...item, ...updated } : item));
		} catch (e) {
			toasts.error((e as Error).message);
		}
	}

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
			const replyEvents = await queryOnce([
				{ kinds: [NOSTR_KINDS.TEXT_NOTE], '#e': [reel.id], limit: 200 }
			]);
			const replies = replyEvents
				.map(toFeedNote)
				.filter((note) => note.replyTo === reel.id);
			const replyIds = replies.map((reply) => reply.id);
			const reactions = replyIds.length
				? await queryOnce([{ kinds: [NOSTR_KINDS.REACTION], '#e': replyIds, limit: 300 }])
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
		const hasCache = loadCachedReels();
		if (hasCache) {
			loading = false;
			void loadReels({ background: true });
		} else {
			void loadReels();
		}
	});
</script>

<svelte:head><title>Reels · BitOS</title></svelte:head>

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
				<div
					class="reel-card relative flex h-full w-full snap-start items-center justify-center overflow-hidden bg-black text-white"
				>
					<!-- svelte-ignore a11y_media_has_caption -->
					<video
						src={reel.videoUrl}
						class="absolute inset-0 size-full object-cover"
						aria-label="Relay video note"
						controls
						loop
						playsinline
						preload="metadata"
					></video>
					<div
						class="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/70"
					></div>

					<div class="absolute inset-x-0 top-0 z-10 flex items-center justify-between p-5">
						<h2 class="font-display text-[26px] font-extrabold text-white">Reels</h2>
						<button
							type="button"
							onclick={() => loadReels()}
							class="grid size-10 place-items-center rounded-xl bg-white/15 text-white backdrop-blur transition hover:bg-white/25"
							aria-label="Refresh reels"
						>
							<Icon name="i-lucide-rotate-cw" class="size-5" />
						</button>
					</div>

					<div
						class="absolute right-4 bottom-24 z-10 flex flex-col gap-5 transition-[right] duration-200 {commentReel
							? 'lg:right-24'
							: ''}"
					>
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
							class="spin-slow mt-2 size-10 overflow-hidden rounded-full border-2 border-white"
							aria-label="Open profile"
						>
							<Avatar pubkey={reel.pubkey} {name} picture={profile?.picture} size={40} />
						</a>
					</div>

					<div class="absolute inset-x-0 bottom-0 z-10 p-5 pr-20 text-white">
						<div class="mb-3 flex items-center gap-3">
							<Avatar
								pubkey={reel.pubkey}
								{name}
								picture={profile?.picture}
								size={40}
								class="ring-2 ring-white"
							/>
							<div class="min-w-0 flex-1">
								<a href={`/profile/${reel.pubkey}`} class="truncate text-[14px] font-bold">
									{name}
								</a>
								<p class="text-[11px] opacity-80">{timeAgo(reel.createdAt)}</p>
							</div>
						</div>
						{#if captionFor(reel)}
							<p class="line-clamp-4 text-[13.5px] leading-relaxed">{captionFor(reel)}</p>
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
					<h1 class="font-display text-[28px] font-extrabold">No reels found</h1>
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
	</div>

	{#if reels.length}
		<div
			class="absolute top-1/2 right-[92px] z-30 hidden -translate-y-1/2 flex-col gap-1.5 rounded-full bg-black/25 p-1 shadow-lg shadow-black/20 ring-1 ring-white/10 backdrop-blur-md transition-[right] duration-200 sm:flex {commentReel
				? 'lg:right-[398px]'
				: ''}"
		>
			<button
				type="button"
				onclick={() => scrollToReel(-1)}
				class="grid size-9 place-items-center rounded-full bg-white/12 text-white/90 transition hover:bg-white/25 hover:text-white"
				aria-label="Previous reel"
			>
				<Icon name="i-lucide-chevron-up" class="size-[18px]" />
			</button>
			<button
				type="button"
				onclick={() => scrollToReel(1)}
				class="grid size-9 place-items-center rounded-full bg-white/12 text-white/90 transition hover:bg-white/25 hover:text-white"
				aria-label="Next reel"
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
			class="fixed inset-x-0 bottom-0 z-50 flex max-h-[78vh] flex-col overflow-hidden rounded-t-3xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] text-[var(--ui-text)] shadow-2xl shadow-black/20 lg:inset-y-0 lg:right-0 lg:left-auto lg:h-full lg:max-h-none lg:w-[390px] lg:rounded-none lg:border-y-0 lg:border-r-0"
			aria-label="Reel comments"
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
											<a href={`/note/${comment.id}?from=reels`} class="block hover:text-primary-500">
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
						placeholder={identity.current ? 'Add a comment...' : 'Create or import a key to comment'}
						disabled={!identity.current || postingComment}
						class="max-h-28 min-h-10 flex-1 resize-none rounded-full bg-[var(--ui-bg-accented)] px-4 py-2.5 text-[14px] text-[var(--ui-text)] outline-none placeholder:text-[var(--ui-text-dimmed)] focus:ring-2 focus:ring-primary-500/40 disabled:cursor-not-allowed disabled:opacity-60"
						onkeydown={(event) => {
							if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
								event.preventDefault();
								void submitComment();
							}
						}}
					></textarea>
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
</div>
