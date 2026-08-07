<script module lang="ts">
	const activeFeedVideos = new Set<HTMLVideoElement>();

	function pauseOtherFeedVideos(activeVideo: HTMLVideoElement) {
		for (const video of activeFeedVideos) {
			if (video !== activeVideo) video.pause();
		}
	}
</script>

<script lang="ts">
	import { browser } from '$app/environment';
	import { noteEncode, npubEncode } from 'nostr-tools/nip19';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import StoryRing from './StoryRing.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import ImageLightbox from '$lib/components/ui/ImageLightbox.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import MenuItem from '$lib/components/ui/MenuItem.svelte';
	import MenuDivider from '$lib/components/ui/MenuDivider.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { feed } from '$lib/nostr/feed.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { shortKey, timeAgo, timeFull } from '$lib/utils/format';
	import { makeParticles, type Particle } from '$lib/utils/burst';
	import { popovers } from '$lib/stores/popovers.svelte';
	import { bookmarks } from '$lib/stores/bookmarks.svelte';
	import { privacyNotificationSettings } from '$lib/stores/privacy-notification-settings.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import type { FeedNote } from '$lib/nostr/types';
	import { sensitiveMediaReason as getSensitiveMediaReason } from '$lib/utils/sensitive-media';
	import Poll from './Poll.svelte';

	type ContentToken =
		| { type: 'text'; value: string }
		| { type: 'url'; value: string; host: string }
		| { type: 'nostr'; value: string }
		| { type: 'hashtag'; value: string; tag: string };
	type MediaAttachment = {
		type: 'image' | 'video' | 'audio' | 'embed' | 'link';
		url: string;
		host: string;
		embedUrl?: string;
		provider?: string;
	};

	let {
		note,
		index = 0,
		onNoteChange
	}: { note: FeedNote; index?: number; onNoteChange?: (note: FeedNote) => void } = $props();

	const contentPattern =
		/(https?:\/\/[^\s<>()]+|nostr:(?:note1|nevent1|npub1|nprofile1|naddr1)[a-z0-9]+|#[\p{L}\p{N}_-]{2,60})/giu;
	const imagePattern = /\.(?:apng|avif|gif|jpe?g|png|webp)$/i;
	const videoPattern = /\.(?:m3u8|m4v|mov|mp4|webm)$/i;
	const audioPattern = /\.(?:aac|flac|m4a|mp3|ogg|opus|wav)$/i;
	const imageFormatPattern = /(?:[?&](?:ext|fm|format)=)(?:apng|avif|gif|jpe?g|png|webp)\b/i;
	const imagePathPattern =
		/(?:^|\/)(?:avatar|avatars|cdn-cgi\/image|image|images|img|media|photo|photos|picture|resize|thumbnail|thumb|upload|uploads)(?:\/|$|:|-|_)/i;
	const urlPattern = /https?:\/\/[^\s<>()]+/giu;
	const longTextLimit = 420;

	const profile = $derived(profiles.get(note.pubkey));
	const displayName = $derived(profile?.display_name || profile?.name || shortKey(note.pubkey));
	const currentProfile = $derived(identity.current ? profiles.get(identity.current.pk) : undefined);
	const currentDisplayName = $derived(
		currentProfile?.display_name || currentProfile?.name || 'You'
	);
	const lightningAddress = $derived(profile?.lud16 || profile?.lud06 || '');
	const isMe = $derived(identity.current?.pk === note.pubkey);
	const liked = $derived(note.reactions.some((r) => r.byMe));
	const reactionCount = $derived(note.reactions.reduce((s, r) => s + r.count, 0));
	const zapLabel = $derived(
		note.zapTotalSats
			? `${compactSats(note.zapTotalSats)} sats`
			: note.zapCount
				? `${note.zapCount} zaps`
				: 'Zap'
	);
	const menuId = $derived(`post-menu:${note.id}`);
	const noteLink = $derived(`nostr:${noteEncode(note.id)}`);
	const authorNpub = $derived(npubEncode(note.pubkey));
	const rawNote = $derived(
		JSON.stringify(
			{
				id: note.id,
				author: note.pubkey,
				authorNpub,
				createdAt: note.createdAt,
				content: note.content,
				tags: note.tags,
				replyTo: note.replyTo,
				reactions: note.reactions,
				repostCount: note.repostCount,
				zapCount: note.zapCount,
				zapTotalSats: note.zapTotalSats
			},
			null,
			2
		)
	);
	let expanded = $state(false);
	const isLong = $derived(
		note.content.length > longTextLimit || note.content.split('\n').length > 8
	);
	const visibleContent = $derived(
		isLong && !expanded ? `${note.content.slice(0, longTextLimit).trimEnd()}…` : note.content
	);
	const contentTokens = $derived(parseContent(visibleContent));
	const mediaAttachments = $derived(extractMedia(note.content));
	const previewableImages = $derived(mediaAttachments.filter((media) => media.type === 'image'));
	const previewableImageUrls = $derived(previewableImages.map((media) => media.url));
	const firstAttachment = $derived(mediaAttachments[0]);
	const visibleMediaAttachments = $derived(mediaAttachments.slice(0, 5));
	const hiddenMediaCount = $derived(
		Math.max(0, mediaAttachments.length - visibleMediaAttachments.length)
	);
	let burst = $state(false);
	let articleEl = $state<HTMLElement | undefined>(undefined);
	let likeBursts = $state<{ id: number; x: number; y: number; particles: Particle[] }[]>([]);
	let likeBurstSeq = 0;
	let rawOpen = $state(false);
	let deleteOpen = $state(false);
	let pendingDelete = $state<FeedNote | null>(null);
	let deleting = $state(false);
	let previewOpen = $state(false);
	let previewImageIndex = $state(0);
	let replyOpen = $state(false);
	let replyText = $state('');
	let replying = $state(false);
	let replyInput: HTMLInputElement | undefined;
	let showAllReplies = $state(false);
	let replyingToCommentId = $state('');
	let commentReplyText = $state('');
	let commentReplying = $state(false);
	let failedMedia = $state<Record<string, boolean>>({});
	let revealedSensitiveMedia = $state<Record<string, boolean>>({});
	const sensitiveReason = $derived(sensitiveMediaReason());
	const shouldCoverMedia = $derived(!!sensitiveReason);
	const directReplies = $derived(
		feed.notes
			.filter((reply) => reply.replyTo === note.id && reply.id !== note.id)
			.sort((a, b) => a.createdAt - b.createdAt)
	);
	const visibleReplies = $derived(showAllReplies ? directReplies : directReplies.slice(0, 2));
	const hiddenReplyCount = $derived(Math.max(0, directReplies.length - visibleReplies.length));
	const saved = $derived(bookmarks.has(note.id));
	const deleteTargetLabel = $derived(pendingDelete?.id === note.id ? 'note' : 'comment');
	const canCommentOnNote = $derived(privacyNotificationSettings.canCommentOn(note.pubkey));

	function sensitiveMediaReason() {
		return getSensitiveMediaReason(note.tags, note.content);
	}

	function isMediaRevealed(url: string) {
		return !!revealedSensitiveMedia[url];
	}

	function revealMedia(url: string) {
		revealedSensitiveMedia = { ...revealedSensitiveMedia, [url]: true };
	}

	function shouldHideImage(url: string) {
		return !isMediaRevealed(url);
	}

	function shouldHideVideo(url: string) {
		return shouldCoverMedia && !isMediaRevealed(url);
	}

	function mediaGridClass(count: number) {
		if (count <= 1) return 'grid-cols-1';
		if (count === 2) return 'grid-cols-2';
		return 'grid-cols-2 auto-rows-[150px] sm:auto-rows-[180px]';
	}

	function mediaTileClass(index: number, count: number) {
		if (count <= 2) return 'aspect-video';
		if (count === 3 && index === 0) return 'row-span-2';
		if (count >= 5 && index < 2) return 'row-span-2';
		return '';
	}

	function mediaContentClass(count: number) {
		return count <= 2 ? 'aspect-video' : 'size-full';
	}

	function compactSats(count: number) {
		if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
		if (count >= 1000) return `${(count / 1000).toFixed(count >= 10_000 ? 0 : 1)}K`;
		return `${count}`;
	}

	function commentLiked(reply: FeedNote) {
		return reply.reactions.some((reaction) => reaction.byMe);
	}

	function commentReactionCount(reply: FeedNote) {
		return reply.reactions.reduce((sum, reaction) => sum + reaction.count, 0);
	}

	function childReplies(replyId: string) {
		return feed.notes
			.filter((reply) => reply.replyTo === replyId)
			.sort((a, b) => a.createdAt - b.createdAt);
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

	function openAttachment() {
		if (!browser || !firstAttachment) return;
		window.open(firstAttachment.url, '_blank', 'noopener,noreferrer');
		popovers.close();
	}

	function previewImage(url: string) {
		const index = previewableImages.findIndex((media) => media.url === url);
		previewImageIndex = index >= 0 ? index : 0;
		previewOpen = true;
	}

	function trackFeedVideo(node: HTMLVideoElement) {
		activeFeedVideos.add(node);

		const handlePlay = () => {
			pauseOtherFeedVideos(node);
		};

		node.addEventListener('play', handlePlay);

		return {
			destroy() {
				node.removeEventListener('play', handlePlay);
				activeFeedVideos.delete(node);
			}
		};
	}

	function startReply() {
		if (!identity.current) {
			toasts.error('Create or import a key first');
			return;
		}
		if (!canCommentOnNote) {
			toasts.info('Commenting is limited by your privacy settings');
			return;
		}
		replyOpen = true;
		setTimeout(() => replyInput?.focus(), 0);
	}

	function startCommentReply(reply: FeedNote) {
		if (!identity.current) {
			toasts.error('Create or import a key first');
			return;
		}
		if (!privacyNotificationSettings.canCommentOn(reply.pubkey)) {
			toasts.info('Commenting is limited by your privacy settings');
			return;
		}
		replyingToCommentId = reply.id;
		commentReplyText = '';
	}

	function splitTrailingPunctuation(value: string) {
		const match = value.match(/^(.+?)([.,!?;:]+)?$/);
		return {
			core: match?.[1] ?? value,
			suffix: match?.[2] ?? ''
		};
	}

	function hostFromUrl(url: string) {
		try {
			return new URL(url).hostname.replace(/^www\./, '');
		} catch {
			return url;
		}
	}

	function parseContent(content: string): ContentToken[] {
		const tokens: ContentToken[] = [];
		let lastIndex = 0;

		for (const match of content.matchAll(contentPattern)) {
			const value = match[0];
			const index = match.index ?? 0;
			if (index > lastIndex) tokens.push({ type: 'text', value: content.slice(lastIndex, index) });

			if (value.startsWith('#')) {
				tokens.push({ type: 'hashtag', value, tag: value.slice(1).toLowerCase() });
			} else if (value.toLowerCase().startsWith('nostr:')) {
				const { core, suffix } = splitTrailingPunctuation(value);
				tokens.push({ type: 'nostr', value: core });
				if (suffix) tokens.push({ type: 'text', value: suffix });
			} else {
				const { core, suffix } = splitTrailingPunctuation(value);
				tokens.push({ type: 'url', value: core, host: hostFromUrl(core) });
				if (suffix) tokens.push({ type: 'text', value: suffix });
			}

			lastIndex = index + value.length;
		}

		if (lastIndex < content.length) tokens.push({ type: 'text', value: content.slice(lastIndex) });
		return tokens;
	}

	function embedForUrl(url: string): Pick<MediaAttachment, 'embedUrl' | 'provider'> | null {
		try {
			const parsed = new URL(url);
			const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
			if (host === 'youtu.be') {
				const id = parsed.pathname.split('/').filter(Boolean)[0];
				return id
					? { embedUrl: `https://www.youtube-nocookie.com/embed/${id}`, provider: 'YouTube' }
					: null;
			}
			if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
				const id =
					parsed.searchParams.get('v') ||
					(parsed.pathname.startsWith('/shorts/')
						? parsed.pathname.split('/').filter(Boolean)[1]
						: '') ||
					(parsed.pathname.startsWith('/embed/')
						? parsed.pathname.split('/').filter(Boolean)[1]
						: '');
				return id
					? { embedUrl: `https://www.youtube-nocookie.com/embed/${id}`, provider: 'YouTube' }
					: null;
			}
			if (host === 'vimeo.com' || host.endsWith('.vimeo.com')) {
				const id = parsed.pathname
					.split('/')
					.filter(Boolean)
					.find((part) => /^\d+$/.test(part));
				return id ? { embedUrl: `https://player.vimeo.com/video/${id}`, provider: 'Vimeo' } : null;
			}
		} catch {
			return null;
		}
		return null;
	}

	function mediaType(url: string): MediaAttachment['type'] {
		if (embedForUrl(url)) return 'embed';
		try {
			const parsed = new URL(url);
			const pathname = decodeURIComponent(parsed.pathname);
			if (videoPattern.test(pathname)) return 'video';
			if (audioPattern.test(pathname)) return 'audio';
			if (
				imagePattern.test(pathname) ||
				imageFormatPattern.test(parsed.search) ||
				imagePathPattern.test(pathname)
			)
				return 'image';
		} catch {
			if (/\.(?:m3u8|m4v|mov|mp4|webm)(?:[?#].*)?$/i.test(url)) return 'video';
			if (/\.(?:aac|flac|m4a|mp3|ogg|opus|wav)(?:[?#].*)?$/i.test(url)) return 'audio';
			if (/\.(?:apng|avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(url)) return 'image';
		}
		return 'link';
	}

	function markMediaFailed(url: string) {
		failedMedia = { ...failedMedia, [url]: true };
	}

	function extractMedia(content: string) {
		const seen: string[] = [];
		const attachments: MediaAttachment[] = [];
		for (const match of content.matchAll(urlPattern)) {
			const { core } = splitTrailingPunctuation(match[0]);
			if (seen.includes(core)) continue;
			seen.push(core);
			const type = mediaType(core);
			const embed = type === 'embed' ? embedForUrl(core) : null;
			if (type === 'link' && attachments.some((item) => item.type !== 'link')) continue;
			attachments.push({ type, url: core, host: hostFromUrl(core), ...embed });
		}
		return attachments.slice(0, 4);
	}

	function toggleSaved() {
		const nextSaved = bookmarks.toggle(note);
		if (nextSaved) {
			toasts.success('Saved');
		} else {
			toasts.info('Removed from saved');
		}
		popovers.close();
	}

	function hideNote() {
		feed.hideNote(note.id);
		toasts.info('Note hidden');
		popovers.close();
	}

	function muteAuthor() {
		feed.muteAuthor(note.pubkey);
		toasts.info(`Muted ${displayName}`);
		popovers.close();
	}

	function blockAuthor() {
		if (feed.blockAuthor(note.pubkey)) toasts.success(`Blocked ${displayName}`);
		else toasts.info(`${displayName} is already blocked`);
		popovers.close();
	}

	function askDeleteNote() {
		popovers.close();
		pendingDelete = note;
		deleteOpen = true;
	}

	function cancelDelete() {
		if (deleting) return;
		pendingDelete = null;
		deleteOpen = false;
	}

	async function confirmDelete() {
		const target = pendingDelete;
		if (!target || deleting) return;
		deleting = true;
		try {
			await feed.deleteNote(target);
			pendingDelete = null;
			deleteOpen = false;
			toasts.success('Deletion request published');
		} catch (e) {
			toasts.error((e as Error).message || 'Could not publish deletion request');
		} finally {
			deleting = false;
		}
	}

	function showRaw() {
		rawOpen = true;
		popovers.close();
	}

	async function react(e?: MouseEvent) {
		// Capture the click target synchronously — `e.currentTarget` is nulled
		// once the event finishes dispatching (i.e. after the first `await`).
		const targetEl = (e?.currentTarget as HTMLElement | null) ?? null;
		try {
			const wasLiked = liked;
			await feed.react(note, '❤️');
			if (onNoteChange) onNoteChange(nextLocalReaction(note, wasLiked));
			if (!wasLiked) {
				burst = true;
				setTimeout(() => (burst = false), 600);
				if (targetEl && articleEl) {
					const a = articleEl.getBoundingClientRect();
					const t = targetEl.getBoundingClientRect();
					triggerLikeBurst(t.left + t.width / 2 - a.left, t.top + t.height / 2 - a.top);
				}
			}
		} catch (err) {
			toasts.error((err as Error).message);
		}
	}

	function triggerLikeBurst(x: number, y: number) {
		const id = ++likeBurstSeq;
		likeBursts = [...likeBursts, { id, x, y, particles: makeParticles(12) }];
		setTimeout(() => {
			likeBursts = likeBursts.filter((b) => b.id !== id);
		}, 1100);
	}

	function nextLocalReaction(current: FeedNote, wasLiked: boolean): FeedNote {
		if (wasLiked) {
			return {
				...current,
				reactions: current.reactions
					.map((reaction) =>
						reaction.byMe
							? {
									...reaction,
									count: Math.max(0, reaction.count - 1),
									byMe: false,
									myEventId: undefined
								}
							: reaction
					)
					.filter((reaction) => reaction.count > 0)
			};
		}

		const reactions = current.reactions.map((reaction) => ({ ...reaction }));
		const existing = reactions.find((reaction) => reaction.emoji === '❤️');
		if (existing) {
			existing.count += 1;
			existing.byMe = true;
		} else {
			reactions.push({ emoji: '❤️', count: 1, byMe: true });
		}
		return { ...current, reactions };
	}

	function zapNote() {
		if (!lightningAddress) {
			toasts.info('This author has no Lightning address');
			return;
		}
		if (!browser) return;
		window.location.href = `lightning:${lightningAddress}`;
	}

	async function submitReply() {
		if (!replyText.trim() || replying) return;
		if (!canCommentOnNote) {
			toasts.info('Commenting is limited by your privacy settings');
			return;
		}
		replying = true;
		try {
			await feed.reply(note, replyText);
			replyText = '';
			replyOpen = false;
			toasts.success('Reply posted to Nostr');
		} catch (e) {
			toasts.error((e as Error).message);
		} finally {
			replying = false;
		}
	}

	async function reactToComment(reply: FeedNote) {
		try {
			await feed.react(reply, '❤️');
		} catch (e) {
			toasts.error((e as Error).message);
		}
	}

	async function submitCommentReply(reply: FeedNote) {
		if (!commentReplyText.trim() || commentReplying) return;
		if (!privacyNotificationSettings.canCommentOn(reply.pubkey)) {
			toasts.info('Commenting is limited by your privacy settings');
			return;
		}
		commentReplying = true;
		try {
			await feed.reply(reply, commentReplyText);
			commentReplyText = '';
			replyingToCommentId = '';
			toasts.success('Reply posted to Nostr');
		} catch (e) {
			toasts.error((e as Error).message);
		} finally {
			commentReplying = false;
		}
	}

	function hideComment(reply: FeedNote) {
		feed.hideNote(reply.id);
		toasts.info('Comment hidden');
	}

	function askDeleteComment(reply: FeedNote) {
		pendingDelete = reply;
		deleteOpen = true;
	}

	$effect(() => {
		if (identity.current) profiles.ensure([identity.current.pk]);
	});
</script>

<article
	bind:this={articleEl}
	class="post-card fade-up relative overflow-visible"
	style="animation-delay:{index * 0.05}s"
>
	<!-- Author header -->
	<header class="flex items-center justify-between gap-2 p-4 pb-3">
		<a href={`/profile/${note.pubkey}`} class="flex min-w-0 flex-1 items-center gap-3">
			<StoryRing pubkey={note.pubkey} interactive={false}>
				<Avatar pubkey={note.pubkey} name={displayName} picture={profile?.picture} size={44} />
			</StoryRing>
			<div class="min-w-0 flex-1 leading-tight">
				<p class="flex min-w-0 items-center gap-1.5 text-[14px] font-bold">
					<span class="truncate">{displayName}</span>
					{#if profile?.nip05}<Icon
							name="i-lucide-badge-check"
							class="size-4 shrink-0 text-primary-500"
						/>{/if}
					{#if isMe}
						<span
							class="rounded-full bg-primary-500/15 px-1.5 py-px text-[9px] font-bold text-primary-600 uppercase"
							>you</span
						>
					{/if}
				</p>
				<p class="flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--ui-text-dimmed)]">
					<span class="truncate font-mono">{shortKey(note.pubkey, 8, 6)}</span>
					<span>·</span>
					<time class="shrink-0" title={timeFull(note.createdAt)}>{timeAgo(note.createdAt)}</time>
				</p>
			</div>
		</a>
		<div class="shrink-0">
			<Popover
				id={menuId}
				placement="bottom-end"
				width="auto"
				class="w-60"
				label="Post actions"
				triggerClass="grid size-9 place-items-center rounded-lg text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)]"
				triggerActiveClass="bg-[var(--interactive-hover-bg)] text-[var(--ui-text)]"
			>
				{#snippet trigger()}
					<Icon name="i-lucide-ellipsis" class="size-5" />
				{/snippet}

				<MenuItem href={`/messages?to=${note.pubkey}`} icon="i-lucide-message-circle">
					Message author
				</MenuItem>
				<MenuItem
					icon={saved ? 'i-lucide-bookmark-x' : 'i-lucide-bookmark'}
					onclick={toggleSaved}
				>
					{saved ? 'Unsave note' : 'Save note'}
				</MenuItem>
				<MenuItem icon="i-lucide-link" onclick={() => copyText(noteLink, 'Note link')}>
					Copy note link
				</MenuItem>
				<MenuItem icon="i-lucide-fingerprint" onclick={() => copyText(note.id, 'Note ID')}>
					Copy note ID
				</MenuItem>
				<MenuItem icon="i-lucide-text" onclick={() => copyText(note.content, 'Note text')}>
					Copy note text
				</MenuItem>
				{#if firstAttachment}
					<MenuItem icon="i-lucide-external-link" onclick={openAttachment}>
						Open attachment
					</MenuItem>
					<MenuItem
						icon="i-lucide-image"
						onclick={() => copyText(firstAttachment.url, 'Attachment URL')}
					>
						Copy attachment URL
					</MenuItem>
				{/if}
				<MenuItem
					icon="i-lucide-user-round"
					onclick={() => copyText(authorNpub, 'Author npub')}
				>
					Copy author npub
				</MenuItem>
				<MenuItem icon="i-lucide-braces" onclick={showRaw}>View raw note</MenuItem>

				<MenuDivider />

				<MenuItem icon="i-lucide-eye-off" onclick={hideNote}>Hide note</MenuItem>
				{#if !isMe}
					<MenuItem icon="i-lucide-volume-x" onclick={muteAuthor}>Mute author</MenuItem>
					<MenuItem tone="danger" icon="i-lucide-ban" onclick={blockAuthor}>
						Block author
					</MenuItem>
				{:else}
					<MenuItem tone="danger" icon="i-lucide-trash-2" onclick={askDeleteNote}>
						Delete note
					</MenuItem>
				{/if}
			</Popover>
		</div>
	</header>

	<!-- Body -->
	<div class="px-4 pb-3">
		<p class="text-[14.5px] leading-relaxed break-words whitespace-pre-wrap">
			{#each contentTokens as token, tokenIndex (`${token.type}:${tokenIndex}:${token.value}`)}
				{#if token.type === 'text'}
					{token.value}
				{:else if token.type === 'hashtag'}
					<a
						href={`/?tag=${encodeURIComponent(token.tag)}`}
						class="font-bold text-primary-500 transition hover:text-primary-600 hover:underline"
					>
						{token.value}
					</a>
				{:else if token.type === 'nostr'}
					<a
						href={token.value}
						class="font-semibold text-accent-500 transition hover:text-accent-600 hover:underline"
					>
						{token.value.slice(0, 28)}{token.value.length > 28 ? '…' : ''}
					</a>
				{:else}
					<a
						href={token.value}
						target="_blank"
						rel="noreferrer"
						class="font-semibold text-accent-500 transition hover:text-accent-600 hover:underline"
					>
						{token.host}
					</a>
				{/if}
			{/each}
		</p>
		{#if isLong}
			<button
				type="button"
				onclick={() => (expanded = !expanded)}
				class="mt-2 text-[13px] font-bold text-primary-500 transition hover:text-primary-600"
			>
				{expanded ? 'Show less' : 'Show more'}
			</button>
		{/if}

		{#if note.poll}
			<Poll {note} />
		{/if}
	</div>

	{#if mediaAttachments.length}
		<div
			class="mx-4 mb-3 grid gap-0.5 overflow-hidden rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] {mediaGridClass(
				visibleMediaAttachments.length
			)}"
		>
			{#each visibleMediaAttachments as media, mediaIndex (media.url)}
				{@const tileClass = mediaTileClass(mediaIndex, visibleMediaAttachments.length)}
				{@const contentClass = mediaContentClass(visibleMediaAttachments.length)}
				{@const showMoreOverlay =
					hiddenMediaCount > 0 && mediaIndex === visibleMediaAttachments.length - 1}
				{#if media.type === 'image'}
					{#if failedMedia[media.url]}
						<a
							href={media.url}
							target="_blank"
							rel="noreferrer"
							class="{tileClass} flex min-h-32 items-center gap-3 p-4 transition hover:bg-[var(--interactive-hover-bg)]"
						>
							<span
								class="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-500/15 text-primary-500"
							>
								<Icon name="i-lucide-image-off" class="size-5" />
							</span>
							<span class="min-w-0">
								<span class="block truncate text-[13px] font-bold text-[var(--ui-text)]">
									Open image
								</span>
								<span class="block truncate text-[12px] text-[var(--ui-text-muted)]"
									>{media.url}</span
								>
							</span>
						</a>
					{:else if shouldHideImage(media.url)}
						<div class="{tileClass} relative block bg-black">
							<img
								src={media.url}
								alt="Blurred sensitive attachment"
								loading="lazy"
								referrerpolicy="no-referrer"
								onerror={() => markMediaFailed(media.url)}
								class="{contentClass} scale-105 object-cover blur-2xl saturate-50 transition"
							/>
							<button
								type="button"
								class="absolute inset-0 z-5 grid place-items-center bg-black/18 p-4 text-center text-white"
								onclick={() => revealMedia(media.url)}
								aria-label="Show sensitive media"
							>
								<span
									class="max-w-56 rounded-[22px] border border-white/25 bg-white/14 px-4 py-3 shadow-lg backdrop-blur-md backdrop-saturate-150"
								>
									<Icon name="i-lucide-eye-off" class="mx-auto mb-2 size-5 text-white/90" />
									<span class="block text-[13px] font-bold">Image hidden</span>
									<span class="mt-1 block text-[11px] text-white/80"
										>{sensitiveReason || 'Tap view to reveal'}</span
									>
									<span
										class="mt-2 inline-flex rounded-full border border-white/25 bg-white/90 px-3 py-1 text-[11px] font-bold text-black"
									>
										View
									</span>
								</span>
							</button>
						</div>
					{:else}
						<button
							type="button"
							class="{tileClass} group relative block w-full bg-black"
							onclick={() => previewImage(media.url)}
						>
							<img
								src={media.url}
								alt="Note attachment"
								loading="lazy"
								referrerpolicy="no-referrer"
								onerror={() => markMediaFailed(media.url)}
								class="{contentClass} object-cover transition group-hover:scale-[1.02]"
							/>
							<span
								class="absolute right-3 bottom-3 rounded-full bg-black/55 px-3 py-1 text-[11px] font-bold text-white opacity-0 transition group-hover:opacity-100"
							>
								Preview
							</span>
							{#if showMoreOverlay}
								<span
									class="absolute inset-0 grid place-items-center bg-black/55 text-3xl font-extrabold text-white"
								>
									+{hiddenMediaCount}
								</span>
							{/if}
						</button>
					{/if}
				{:else if media.type === 'video'}
					<div class="{tileClass} relative bg-black">
						<!-- svelte-ignore a11y_media_has_caption -->
						<video
							use:trackFeedVideo
							src={media.url}
							controls={!shouldHideVideo(media.url)}
							preload="metadata"
							playsinline
							class="{contentClass} object-cover transition {!shouldHideVideo(media.url)
								? ''
								: 'scale-105 blur-2xl saturate-50'}"
						></video>
						{#if showMoreOverlay && !shouldHideVideo(media.url)}
							<div
								class="absolute inset-0 grid place-items-center bg-black/55 text-3xl font-extrabold text-white"
							>
								+{hiddenMediaCount}
							</div>
						{/if}
						{#if shouldHideVideo(media.url)}
							<button
								type="button"
								class="absolute inset-0 z-5 grid place-items-center bg-black/18 p-4 text-center text-white"
								onclick={() => revealMedia(media.url)}
								aria-label="Show sensitive video"
							>
								<span
									class="max-w-56 rounded-[22px] border border-white/25 bg-white/14 px-4 py-3 shadow-lg backdrop-blur-md backdrop-saturate-150"
								>
									<Icon name="i-lucide-eye-off" class="mx-auto mb-2 size-5 text-white/90" />
									<span class="block text-[13px] font-bold">Sensitive video</span>
									<span class="mt-1 block text-[11px] text-white/80">{sensitiveReason}</span>
									<span
										class="mt-2 inline-flex rounded-full border border-white/25 bg-white/90 px-3 py-1 text-[11px] font-bold text-black"
									>
										View
									</span>
								</span>
							</button>
						{/if}
					</div>
				{:else if media.type === 'embed' && media.embedUrl}
					<div class="{tileClass} relative overflow-hidden bg-black">
						<iframe
							src={media.embedUrl}
							title={`${media.provider ?? 'Video'} embed`}
							class={contentClass}
							loading="lazy"
							allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
							allowfullscreen
						></iframe>
						<a
							href={media.url}
							target="_blank"
							rel="noreferrer"
							class="flex items-center justify-between gap-3 bg-[var(--surface-bg)] px-3 py-2 text-[12px] font-semibold text-[var(--ui-text-muted)] transition hover:text-primary-500"
						>
							<span class="truncate">{media.provider ?? media.host}</span>
							<Icon name="i-lucide-external-link" class="size-4 shrink-0" />
						</a>
						{#if showMoreOverlay}
							<div
								class="absolute inset-0 grid place-items-center bg-black/55 text-3xl font-extrabold text-white"
							>
								+{hiddenMediaCount}
							</div>
						{/if}
					</div>
				{:else if media.type === 'audio'}
					<div class="{tileClass} flex min-h-28 flex-col justify-center gap-3 p-4">
						<div class="flex items-center gap-2 text-[13px] font-bold text-[var(--ui-text)]">
							<Icon name="i-lucide-audio-lines" class="size-4 text-primary-500" />
							<span class="truncate">{media.host}</span>
						</div>
						<audio src={media.url} controls class="w-full"></audio>
					</div>
				{:else}
					<a
						href={media.url}
						target="_blank"
						rel="noreferrer"
						class="{tileClass} flex min-h-28 items-center gap-3 p-4 transition hover:bg-[var(--interactive-hover-bg)]"
					>
						<span
							class="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-500/15 text-primary-500"
						>
							<Icon name="i-lucide-external-link" class="size-5" />
						</span>
						<span class="min-w-0">
							<span class="block truncate text-[13px] font-bold text-[var(--ui-text)]">
								{media.host}
							</span>
							<span class="block truncate text-[12px] text-[var(--ui-text-muted)]">{media.url}</span
							>
						</span>
					</a>
				{/if}
			{/each}
		</div>
	{/if}

	<!-- Reactions summary -->
	{#if reactionCount > 0 || note.zapCount > 0 || note.repostCount > 0}
		<div
			class="flex items-center justify-between gap-2 px-4 pt-1 pb-1.5 text-[12px] text-[var(--ui-text-dimmed)]"
		>
			<div class="flex min-w-0 items-center gap-1.5">
				{#if reactionCount > 0}
					<span class="flex -space-x-1.5">
						{#each note.reactions.slice(0, 3) as r (r.emoji)}
							<span
								class="grid size-[18px] place-items-center rounded-full bg-[var(--ui-bg-muted)] text-[9px] ring-2 ring-[var(--surface-bg)]"
								>{r.emoji || '❤️'}</span
							>
						{/each}
					</span>
					<span class="font-semibold text-[var(--ui-text-muted)]">{reactionCount}</span>
				{/if}
			</div>
			<div class="flex shrink-0 items-center gap-3">
				{#if note.repostCount > 0}<span>{note.repostCount} reposts</span>{/if}
				{#if note.zapCount > 0}
					<span class="inline-flex items-center gap-0.5">
						{compactSats(note.zapTotalSats)} sats
					</span>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Action bar -->
	<div
		class="mx-4 mb-2 flex items-center justify-between gap-1 border-t border-[var(--ui-border-muted)] py-1"
	>
		<button
			type="button"
			onclick={react}
			class="group relative flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-[12.5px] font-bold transition active:scale-90 md:flex-none md:px-3 {liked
				? 'text-[var(--tone-error-text)]'
				: 'text-[var(--ui-text-muted)] hover:bg-[var(--tone-error-bg)] hover:text-[var(--tone-error-text)]'}"
			aria-label={liked ? 'Unlike' : 'Like'}
		>
			<span class="relative grid place-items-center">
				<Icon
					name={liked ? 'i-solar-heart-bold' : 'i-solar-heart-linear'}
					class="size-[18px] transition group-active:scale-90"
				/>
				{#if burst}
					<span
						class="heart-burst pointer-events-none absolute inset-0 text-[var(--tone-error-text)]"
					>
						<Icon name="i-solar-heart-bold" class="size-[18px]" />
					</span>
				{/if}
			</span>
			{#if reactionCount > 0}
				<span class="tabular-nums">{reactionCount}</span>
			{:else}
				<span class="hidden md:inline">Like</span>
			{/if}
		</button>
		<button
			type="button"
			onclick={startReply}
			disabled={!canCommentOnNote}
			class="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-[12.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-primary-500/10 hover:text-primary-500 active:scale-90 disabled:pointer-events-none disabled:opacity-40 md:flex-none md:px-3"
			aria-label={directReplies.length
				? `${directReplies.length} ${directReplies.length === 1 ? 'comment' : 'comments'}`
				: 'Comment'}
		>
			<Icon name="i-lucide-message-circle" class="size-[18px]" />
			{#if directReplies.length > 0}
				<span class="tabular-nums">{directReplies.length}</span>
			{:else}
				<span class="hidden md:inline">Comment</span>
			{/if}
		</button>
		<button
			type="button"
			onclick={() => copyText(noteLink, 'Note link')}
			class="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-[12.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-accent-500/10 hover:text-accent-600 active:scale-90 md:flex-none md:px-3"
			aria-label="Share"
		>
			<Icon name="i-lucide-share" class="size-[18px]" />
			<span class="hidden md:inline">Share</span>
		</button>
		<button
			type="button"
			onclick={zapNote}
			disabled={!lightningAddress}
			class="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-[12.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-warm-500/10 hover:text-warm-500 active:scale-90 disabled:pointer-events-none disabled:opacity-40 md:flex-none md:px-3"
			aria-label={zapLabel}
		>
			<Icon name="i-lucide-zap" class="size-[18px]" />
			<span class="hidden md:inline">{zapLabel}</span>
		</button>
		<button
			type="button"
			onclick={toggleSaved}
			class="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-[12.5px] font-bold transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)] active:scale-90 md:flex-none md:px-3 {saved
				? 'text-primary-500'
				: 'text-[var(--ui-text-muted)]'}"
			aria-label={saved ? 'Unsave note' : 'Save note'}
		>
			<Icon
				name={saved ? 'i-lucide-bookmark-check' : 'i-lucide-bookmark'}
				class="size-[18px]"
			/>
		</button>
	</div>

	{#if directReplies.length}
		<div class="mx-4 mb-3 space-y-3 rounded-xl bg-[var(--ui-bg-muted)] p-3">
			{#each visibleReplies as reply (reply.id)}
				{@const replyProfile = profiles.get(reply.pubkey)}
				{@const replyName =
					replyProfile?.display_name || replyProfile?.name || shortKey(reply.pubkey)}
				{@const children = childReplies(reply.id)}
				<div class="flex gap-2.5">
					<a href={`/profile/${reply.pubkey}`} class="shrink-0">
						<Avatar
							pubkey={reply.pubkey}
							name={replyName}
							picture={replyProfile?.picture}
							size={28}
						/>
					</a>
					<div class="min-w-0 flex-1">
						<div class="flex min-w-0 items-center gap-1.5">
							<a
								href={`/profile/${reply.pubkey}`}
								class="truncate text-[12.5px] font-bold hover:text-primary-500"
							>
								{replyName}
							</a>
							<time
								class="shrink-0 text-[11px] text-[var(--ui-text-dimmed)]"
								title={timeFull(reply.createdAt)}>{timeAgo(reply.createdAt)}</time
							>
						</div>
						<p class="mt-0.5 text-[13px] leading-relaxed break-words whitespace-pre-wrap">
							{#each parseContent(reply.content) as token, tokenIndex (`${reply.id}:${token.type}:${tokenIndex}:${token.value}`)}
								{#if token.type === 'text'}
									{token.value}
								{:else if token.type === 'hashtag'}
									<a
										href={`/?tag=${encodeURIComponent(token.tag)}`}
										class="font-bold text-primary-500 transition hover:text-primary-600 hover:underline"
									>
										{token.value}
									</a>
								{:else if token.type === 'nostr'}
									<a
										href={token.value}
										class="font-semibold text-accent-500 transition hover:text-accent-600 hover:underline"
									>
										{token.value.slice(0, 24)}{token.value.length > 24 ? '…' : ''}
									</a>
								{:else}
									<a
										href={token.value}
										target="_blank"
										rel="noreferrer"
										class="font-semibold text-accent-500 transition hover:text-accent-600 hover:underline"
									>
										{token.host}
									</a>
								{/if}
							{/each}
						</p>
						<div class="mt-1.5 flex items-center gap-3 text-[11.5px] font-bold">
							<button
								type="button"
								onclick={() => reactToComment(reply)}
								class="inline-flex items-center gap-1 {commentLiked(reply)
									? 'text-[var(--tone-error-text)]'
									: 'text-[var(--ui-text-dimmed)] hover:text-[var(--tone-error-text)]'}"
							>
								<Icon
									name={commentLiked(reply) ? 'i-solar-heart-bold' : 'i-solar-heart-linear'}
									class="size-3.5"
								/>
								{commentLiked(reply) ? 'Unlike' : 'Like'}
								{#if commentReactionCount(reply)}
									<span class="font-semibold"> · {commentReactionCount(reply)}</span>
								{/if}
							</button>
							<button
								type="button"
								onclick={() => startCommentReply(reply)}
								disabled={!privacyNotificationSettings.canCommentOn(reply.pubkey)}
								class="text-[var(--ui-text-dimmed)] hover:text-primary-500 disabled:pointer-events-none disabled:opacity-40"
							>
								Reply
							</button>
							<button
								type="button"
								onclick={() => hideComment(reply)}
								class="text-[var(--ui-text-dimmed)] hover:text-primary-500"
							>
								Hide
							</button>
							{#if identity.current?.pk === reply.pubkey}
								<button
									type="button"
									onclick={() => askDeleteComment(reply)}
									class="text-[var(--ui-text-dimmed)] hover:text-[var(--ui-text)]"
								>
									Delete
								</button>
							{/if}
						</div>

						{#if children.length}
							<div class="mt-3 space-y-2 border-l border-[var(--ui-border-muted)] pl-3">
								{#each children.slice(0, 3) as child (child.id)}
									{@const childProfile = profiles.get(child.pubkey)}
									{@const childName =
										childProfile?.display_name || childProfile?.name || shortKey(child.pubkey)}
									<div class="flex gap-2">
										<a href={`/profile/${child.pubkey}`} class="shrink-0">
											<Avatar
												pubkey={child.pubkey}
												name={childName}
												picture={childProfile?.picture}
												size={22}
											/>
										</a>
										<div class="min-w-0 flex-1">
											<div class="flex min-w-0 items-center gap-1.5">
												<a
													href={`/profile/${child.pubkey}`}
													class="truncate text-[12px] font-bold hover:text-primary-500"
												>
													{childName}
												</a>
												<time
													class="shrink-0 text-[10.5px] text-[var(--ui-text-dimmed)]"
													title={timeFull(child.createdAt)}>{timeAgo(child.createdAt)}</time
												>
											</div>
											<p
												class="mt-0.5 text-[12.5px] leading-relaxed break-words whitespace-pre-wrap"
											>
												{child.content}
											</p>
											<div class="mt-1 flex items-center gap-3 text-[11px] font-bold">
												<button
													type="button"
													onclick={() => hideComment(child)}
													class="text-[var(--ui-text-dimmed)] hover:text-primary-500"
												>
													Hide
												</button>
												{#if identity.current?.pk === child.pubkey}
													<button
														type="button"
														onclick={() => askDeleteComment(child)}
														class="text-[var(--ui-text-dimmed)] hover:text-[var(--ui-text)]"
													>
														Delete
													</button>
												{/if}
											</div>
										</div>
									</div>
								{/each}
							</div>
						{/if}

						{#if replyingToCommentId === reply.id}
							<div class="mt-2 flex items-center gap-2">
								{#if identity.current}
									<Avatar
										pubkey={identity.current.pk}
										name={currentDisplayName}
										picture={currentProfile?.picture}
										size={28}
									/>
								{/if}
								<input
									bind:value={commentReplyText}
									type="text"
									placeholder={`Reply to ${replyName}...`}
									disabled={commentReplying}
									onkeydown={(e) => {
										if (e.key === 'Enter') {
											e.preventDefault();
											void submitCommentReply(reply);
										}
										if (e.key === 'Escape') {
											replyingToCommentId = '';
											commentReplyText = '';
										}
									}}
									class="h-8 flex-1 rounded-full bg-[var(--surface-bg)] px-3 text-[12.5px] text-[var(--ui-text)] outline-none placeholder:text-[var(--ui-text-dimmed)] focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60"
								/>
								<button
									type="button"
									onclick={() => submitCommentReply(reply)}
									disabled={!commentReplyText.trim() ||
										commentReplying ||
										!privacyNotificationSettings.canCommentOn(reply.pubkey)}
									class="grid size-8 shrink-0 place-items-center rounded-full bg-primary-500 text-white transition hover:bg-primary-600 disabled:pointer-events-none disabled:opacity-50"
									aria-label="Post comment reply"
								>
									<Icon
										name={commentReplying ? 'i-lucide-loader-circle' : 'i-lucide-send-horizontal'}
										class="size-3.5 {commentReplying ? 'animate-spin' : ''}"
									/>
								</button>
							</div>
						{/if}
					</div>
				</div>
			{/each}
			{#if hiddenReplyCount}
				<button
					type="button"
					onclick={() => (showAllReplies = true)}
					class="text-[12.5px] font-bold text-primary-500 transition hover:text-primary-600"
				>
					View {hiddenReplyCount} more {hiddenReplyCount === 1 ? 'comment' : 'comments'}
				</button>
			{:else if showAllReplies && directReplies.length > 2}
				<button
					type="button"
					onclick={() => (showAllReplies = false)}
					class="text-[12.5px] font-bold text-primary-500 transition hover:text-primary-600"
				>
					Show fewer comments
				</button>
			{/if}
		</div>
	{/if}

	<!-- Reply input -->
	<div class="px-4 pt-1 pb-4 {replyOpen || replyText ? '' : 'hidden sm:block'}">
		<div class="flex items-center gap-2">
			{#if identity.current}
				<Avatar
					pubkey={identity.current.pk}
					name={currentDisplayName}
					picture={currentProfile?.picture}
					size={28}
				/>
			{/if}
			<input
				bind:this={replyInput}
				bind:value={replyText}
				type="text"
				placeholder={identity.current ? 'Reply to this note…' : 'Create or import a key to reply'}
				disabled={!identity.current || replying}
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						void submitReply();
					}
				}}
				onfocus={() => (replyOpen = true)}
				class="flex-1 rounded-full bg-[var(--ui-bg-muted)] px-4 py-2 text-[13px] text-[var(--ui-text)] transition outline-none placeholder:text-[var(--ui-text-dimmed)] focus:bg-[var(--surface-bg)] focus:ring-2 focus:ring-primary-500/30 disabled:cursor-not-allowed disabled:opacity-60"
			/>
			{#if replyOpen || replyText}
				<button
					type="button"
					onclick={submitReply}
					disabled={!replyText.trim() || replying}
					class="grid size-9 shrink-0 place-items-center rounded-full bg-primary-500 text-white shadow-[var(--glow-primary)] transition hover:bg-primary-600 disabled:pointer-events-none disabled:opacity-50"
					aria-label="Post reply"
				>
					<Icon
						name={replying ? 'i-lucide-loader-circle' : 'i-lucide-send-horizontal'}
						class="size-4 {replying ? 'animate-spin' : ''}"
					/>
				</button>
			{/if}
		</div>
	</div>
	<!-- Like confetti burst overlay -->
	<div class="pointer-events-none absolute inset-0 z-30 overflow-hidden">
		{#each likeBursts as b (b.id)}
			{#each b.particles as p (p.id)}
				<span
					class="like-particle"
					style="left:{b.x}px; top:{b.y}px; --tx:{p.tx}px; --ty:{p.ty}px; --rot:{p.rot}deg; font-size:{p.size}px; animation-duration:{p.duration}s; animation-delay:{p.delay}s"
					>{p.emoji}</span
				>
			{/each}
			<div
				class="absolute grid size-16 place-items-center"
				style="left:calc({b.x}px - 32px); top:calc({b.y}px - 32px)"
			>
				<Icon
					name="i-solar-heart-bold"
					class="like-burst-heart relative size-16 text-[var(--tone-error-text)] drop-shadow-[0_4px_12px_rgba(0,0,0,0.4)]"
				/>
			</div>
		{/each}
	</div>
</article>

<Dialog bind:open={deleteOpen} title={`Delete ${deleteTargetLabel}`}>
	<div class="space-y-4">
		<div
			class="flex size-10 items-center justify-center rounded-full bg-[var(--tone-error-bg)] text-[var(--tone-error-text)]"
		>
			<Icon name="i-lucide-triangle-alert" class="size-5" />
		</div>
		<div class="space-y-1.5">
			<p class="text-[15px] font-bold text-[var(--ui-text)]">
				Delete this {deleteTargetLabel}?
			</p>
			<p class="text-[13px] leading-relaxed text-[var(--ui-text-muted)]">
				This publishes a deletion request to your relays and removes it from your feed. Other
				clients may take time to reflect the change.
			</p>
		</div>
	</div>
	{#snippet footer()}
		<button
			type="button"
			onclick={cancelDelete}
			disabled={deleting}
			class="inline-flex h-9 items-center justify-center rounded-full border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-4 text-[13px] font-bold text-[var(--ui-text)] transition hover:border-primary-500 hover:text-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
		>
			Cancel
		</button>
		<button
			type="button"
			onclick={confirmDelete}
			disabled={deleting || !pendingDelete}
			class="inline-flex h-9 items-center gap-2 rounded-full bg-[var(--tone-error-text)] px-4 text-[13px] font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
		>
			<Icon
				name={deleting ? 'i-lucide-loader-circle' : 'i-lucide-trash-2'}
				class="size-4 {deleting ? 'animate-spin' : ''}"
			/>
			{deleting ? 'Deleting…' : `Delete ${deleteTargetLabel}`}
		</button>
	{/snippet}
</Dialog>

<Dialog bind:open={rawOpen} title="Raw note">
	<div class="space-y-3">
		<div class="flex items-center gap-2">
			<button
				type="button"
				onclick={() => copyText(rawNote, 'Raw note')}
				class="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-3 py-2 text-[12px] font-bold text-white transition hover:bg-primary-600"
			>
				<Icon name="i-lucide-copy" class="size-4" />
				Copy JSON
			</button>
		</div>
		<pre
			class="max-h-[52vh] overflow-auto rounded-xl bg-[var(--ui-bg-muted)] p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-[var(--ui-text-muted)]">{rawNote}</pre>
	</div>
</Dialog>

<ImageLightbox
	bind:open={previewOpen}
	images={previewableImageUrls}
	bind:index={previewImageIndex}
/>
