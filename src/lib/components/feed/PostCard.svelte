<script lang="ts">
	import { browser } from '$app/environment';
	import { noteEncode, npubEncode } from 'nostr-tools/nip19';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { feed } from '$lib/nostr/feed.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { shortKey, timeAgo, timeFull } from '$lib/utils/format';
	import { popovers } from '$lib/stores/popovers.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import type { FeedNote } from '$lib/nostr/types';

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

	let { note, index = 0 }: { note: FeedNote; index?: number } = $props();

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
	const isMe = $derived(identity.current?.pk === note.pubkey);
	const liked = $derived(note.reactions.some((r) => r.byMe));
	const reactionCount = $derived(note.reactions.reduce((s, r) => s + r.count, 0));
	const menuId = $derived(`post-menu:${note.id}`);
	const menuOpen = $derived(popovers.isOpen(menuId));
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
				repostCount: note.repostCount
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
	const firstAttachment = $derived(mediaAttachments[0]);
	let burst = $state(false);
	let rawOpen = $state(false);
	let saved = $state(isSaved());
	let replyOpen = $state(false);
	let replyText = $state('');
	let replying = $state(false);
	let replyInput: HTMLInputElement | undefined;
	let showAllReplies = $state(false);
	let failedMedia = $state<Record<string, boolean>>({});
	const directReplies = $derived(
		feed.notes
			.filter((reply) => reply.replyTo === note.id && reply.id !== note.id)
			.sort((a, b) => a.createdAt - b.createdAt)
	);
	const visibleReplies = $derived(showAllReplies ? directReplies : directReplies.slice(0, 2));
	const hiddenReplyCount = $derived(Math.max(0, directReplies.length - visibleReplies.length));

	function savedIds() {
		if (!browser) return [];
		try {
			const value = localStorage.getItem('bitos:saved-notes');
			return value ? (JSON.parse(value) as string[]) : [];
		} catch {
			return [];
		}
	}

	function isSaved() {
		return savedIds().includes(note.id);
	}

	function persistSaved(ids: string[]) {
		if (!browser) return;
		localStorage.setItem('bitos:saved-notes', JSON.stringify(ids));
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

	function startReply() {
		if (!identity.current) {
			toasts.error('Create or import a key first');
			return;
		}
		replyOpen = true;
		setTimeout(() => replyInput?.focus(), 0);
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
			if (
				imagePattern.test(pathname) ||
				imageFormatPattern.test(parsed.search) ||
				imagePathPattern.test(pathname)
			)
				return 'image';
			if (videoPattern.test(pathname)) return 'video';
			if (audioPattern.test(pathname)) return 'audio';
		} catch {
			if (/\.(?:apng|avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(url)) return 'image';
			if (/\.(?:m3u8|m4v|mov|mp4|webm)(?:[?#].*)?$/i.test(url)) return 'video';
			if (/\.(?:aac|flac|m4a|mp3|ogg|opus|wav)(?:[?#].*)?$/i.test(url)) return 'audio';
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
		const ids = savedIds();
		if (ids.includes(note.id)) {
			persistSaved(ids.filter((id) => id !== note.id));
			saved = false;
			toasts.info('Removed from saved');
		} else {
			persistSaved([note.id, ...ids]);
			saved = true;
			toasts.success('Saved');
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

	async function deleteNote() {
		popovers.close();
		if (!confirm('Request deletion for this note?')) return;
		try {
			await feed.deleteNote(note);
			toasts.success('Deletion request published');
		} catch (e) {
			toasts.error((e as Error).message);
		}
	}

	function showRaw() {
		rawOpen = true;
		popovers.close();
	}

	async function react() {
		try {
			const wasLiked = liked;
			await feed.react(note, '❤️');
			if (!wasLiked) {
				burst = true;
				setTimeout(() => (burst = false), 600);
			}
		} catch (e) {
			toasts.error((e as Error).message);
		}
	}

	async function submitReply() {
		if (!replyText.trim() || replying) return;
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
</script>

<article
	class="post-card fade-up relative overflow-visible"
	style="animation-delay:{index * 0.05}s"
>
	<!-- Author header -->
	<header class="flex items-center justify-between gap-2 p-4 pb-3">
		<a href={`/profile/${note.pubkey}`} class="flex min-w-0 flex-1 items-center gap-3">
			<Avatar pubkey={note.pubkey} name={displayName} picture={profile?.picture} size={44} />
			<div class="min-w-0 flex-1 leading-tight">
				<p class="flex min-w-0 items-center gap-1.5 text-[14px] font-bold">
					<span class="truncate">{displayName}</span>
					{#if note.reactions.length}<Icon
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
		<div class="relative shrink-0">
			<button
				type="button"
				onclick={(e) => {
					e.stopPropagation();
					popovers.toggle(menuId);
				}}
				class="grid size-9 place-items-center rounded-lg text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] {menuOpen
					? 'bg-[var(--interactive-hover-bg)] text-[var(--ui-text)]'
					: ''}"
				aria-label="Post actions"
				aria-expanded={menuOpen}
			>
				<Icon name="i-lucide-ellipsis" class="size-5" />
			</button>

			{#if menuOpen}
				<div
					class="absolute top-10 right-0 z-30 w-60 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] p-1.5 shadow-[var(--shadow-pop)]"
				>
					<a
						href={`/messages?to=${note.pubkey}`}
						class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
					>
						<Icon name="i-lucide-message-circle" class="size-4 shrink-0" />
						Message author
					</a>
					<button
						type="button"
						onclick={toggleSaved}
						class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
					>
						<Icon
							name={saved ? 'i-lucide-bookmark-x' : 'i-lucide-bookmark'}
							class="size-4 shrink-0"
						/>
						{saved ? 'Unsave note' : 'Save note'}
					</button>
					<button
						type="button"
						onclick={() => copyText(noteLink, 'Note link')}
						class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
					>
						<Icon name="i-lucide-link" class="size-4 shrink-0" />
						Copy note link
					</button>
					<button
						type="button"
						onclick={() => copyText(note.id, 'Note ID')}
						class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
					>
						<Icon name="i-lucide-fingerprint" class="size-4 shrink-0" />
						Copy note ID
					</button>
					<button
						type="button"
						onclick={() => copyText(note.content, 'Note text')}
						class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
					>
						<Icon name="i-lucide-text" class="size-4 shrink-0" />
						Copy note text
					</button>
					{#if firstAttachment}
						<button
							type="button"
							onclick={openAttachment}
							class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
						>
							<Icon name="i-lucide-external-link" class="size-4 shrink-0" />
							Open attachment
						</button>
						<button
							type="button"
							onclick={() => copyText(firstAttachment.url, 'Attachment URL')}
							class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
						>
							<Icon name="i-lucide-image" class="size-4 shrink-0" />
							Copy attachment URL
						</button>
					{/if}
					<button
						type="button"
						onclick={() => copyText(authorNpub, 'Author npub')}
						class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
					>
						<Icon name="i-lucide-user-round" class="size-4 shrink-0" />
						Copy author npub
					</button>
					<button
						type="button"
						onclick={showRaw}
						class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
					>
						<Icon name="i-lucide-braces" class="size-4 shrink-0" />
						View raw note
					</button>
					<div class="my-1 h-px bg-[var(--ui-border-muted)]"></div>
					<button
						type="button"
						onclick={hideNote}
						class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
					>
						<Icon name="i-lucide-eye-off" class="size-4 shrink-0" />
						Hide note
					</button>
					{#if !isMe}
						<button
							type="button"
							onclick={muteAuthor}
							class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
						>
							<Icon name="i-lucide-volume-x" class="size-4 shrink-0" />
							Mute author
						</button>
					{:else}
						<button
							type="button"
							onclick={deleteNote}
							class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[var(--tone-error-text)] transition-colors hover:bg-[var(--tone-error-bg)]"
						>
							<Icon name="i-lucide-trash-2" class="size-4 shrink-0" />
							Delete note
						</button>
					{/if}
				</div>
			{/if}
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
						href={`/discover?tag=${encodeURIComponent(token.tag)}`}
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
	</div>

	{#if mediaAttachments.length}
		<div
			class="mx-4 mb-3 grid overflow-hidden rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] {mediaAttachments.length ===
			1
				? 'grid-cols-1'
				: 'grid-cols-2'}"
		>
			{#each mediaAttachments as media (media.url)}
				{#if media.type === 'image'}
					{#if failedMedia[media.url]}
						<a
							href={media.url}
							target="_blank"
							rel="noreferrer"
							class="flex min-h-32 items-center gap-3 p-4 transition hover:bg-[var(--interactive-hover-bg)]"
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
					{:else}
						<a
							href={media.url}
							target="_blank"
							rel="noreferrer"
							class="group relative block bg-black"
						>
							<img
								src={media.url}
								alt="Note attachment"
								loading="lazy"
								referrerpolicy="no-referrer"
								onerror={() => markMediaFailed(media.url)}
								class="aspect-video size-full object-cover transition group-hover:scale-[1.02]"
							/>
						</a>
					{/if}
				{:else if media.type === 'video'}
					<div class="relative bg-black">
						<!-- svelte-ignore a11y_media_has_caption -->
						<video
							src={media.url}
							controls
							preload="metadata"
							playsinline
							class="aspect-video size-full object-cover"
						></video>
					</div>
				{:else if media.type === 'embed' && media.embedUrl}
					<div class="overflow-hidden bg-black">
						<iframe
							src={media.embedUrl}
							title={`${media.provider ?? 'Video'} embed`}
							class="aspect-video size-full"
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
					</div>
				{:else if media.type === 'audio'}
					<div class="flex min-h-28 flex-col justify-center gap-3 p-4">
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
						class="flex min-h-28 items-center gap-3 p-4 transition hover:bg-[var(--interactive-hover-bg)]"
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
	{#if reactionCount > 0}
		<div
			class="flex items-center justify-between px-4 pt-1 pb-2 text-[12px] text-[var(--ui-text-dimmed)]"
		>
			<div class="flex items-center gap-1.5">
				<span
					class="grid size-5 place-items-center rounded-full bg-primary-500 text-[10px] ring-2 ring-[var(--surface-bg)]"
					>❤️</span
				>
				<span>{reactionCount}</span>
			</div>
			<span>{note.repostCount || 0} reposts</span>
		</div>
	{/if}

	<!-- Action bar -->
	<div
		class="mx-4 my-2 flex items-center justify-around border-y border-[var(--ui-border-muted)] py-1.5"
	>
		<button
			type="button"
			onclick={react}
			class="relative flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-primary-500/10 {liked
				? 'text-primary-500'
				: 'text-[var(--ui-text-muted)] hover:text-primary-500'}"
		>
			<span class="relative">
				<Icon name="i-lucide-heart" class="size-[16px] {liked ? 'fill-primary-500' : ''}" />
				{#if burst}
					<span class="heart-burst pointer-events-none absolute inset-0 text-primary-500">
						<Icon name="i-lucide-heart" class="size-[16px]" />
					</span>
				{/if}
			</span>
			<span>{liked ? 'Unlike' : 'Like'}</span>
		</button>
		<button
			type="button"
			onclick={startReply}
			class="flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
		>
			<Icon name="i-lucide-message-circle" class="size-[16px]" />
			<span>
				{directReplies.length
					? `${directReplies.length} ${directReplies.length === 1 ? 'comment' : 'comments'}`
					: 'Comment'}
			</span>
		</button>
		<button
			type="button"
			onclick={() => copyText(noteLink, 'Note link')}
			class="flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
		>
			<Icon name="i-lucide-share" class="size-[16px]" />
			<span>Share</span>
		</button>
		<button
			type="button"
			onclick={toggleSaved}
			class="flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
		>
			<Icon name={saved ? 'i-lucide-bookmark-check' : 'i-lucide-bookmark'} class="size-[16px]" />
		</button>
	</div>

	{#if directReplies.length}
		<div class="mx-4 mb-3 space-y-3 rounded-xl bg-[var(--ui-bg-muted)] p-3">
			{#each visibleReplies as reply (reply.id)}
				{@const replyProfile = profiles.get(reply.pubkey)}
				{@const replyName =
					replyProfile?.display_name || replyProfile?.name || shortKey(reply.pubkey)}
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
										href={`/discover?tag=${encodeURIComponent(token.tag)}`}
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
				{@const mk = profiles.get(identity.current.pk)}
				<div
					class="grid size-7 shrink-0 place-items-center rounded-lg bg-warm-500 text-[10px] font-bold text-white"
				>
					{(mk?.display_name || 'Y').slice(0, 2).toUpperCase()}
				</div>
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
</article>

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
