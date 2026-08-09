<script lang="ts">
	/**
	 * Minimal "context line" preview of the note a notification is *about*
	 * (the post someone liked, commented on, reposted, or mentioned you in).
	 *
	 * Renders as a leading reply-context icon + indented excerpt — the
	 * Twitter/X reply-context pattern — rather than a filled box. The type
	 * accent belongs on the card's avatar badge, so it isn't duplicated here.
	 * No background fill means no "card inside a card" noise.
	 *
	 * Lighter than `NostrEventPreview` (built for inline quoted notes in feed
	 * bodies with a full avatar + bordered card) and tuned for notification
	 * density. Data comes from the shared, batched `originNotes` store so a
	 * full notification list resolves its origin notes in one relay round trip.
	 */
	import { browser } from '$app/environment';
	import { decode } from 'nostr-tools/nip19';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import {
		originNotes,
		originNoteStates,
		requestOriginNotes
	} from '$lib/nostr/origin-notes.svelte';
	import { popovers } from '$lib/stores/popovers.svelte';
	import { shortKey, timeAgo } from '$lib/utils/format';
	import { cleanNotificationPreview, extractNotificationMedia } from '$lib/utils/imeta';
	import { extractMentionEntities } from '$lib/utils/nip27';
	import { parseContent } from '$lib/utils/note-content';

	let {
		noteId,
		/** Where to land when pressing Back from the opened note. */
		returnTo = '/notifications'
	}: { noteId: string; returnTo?: string } = $props();

	// Kick off the batched fetch. The store dedupes by id, so this is a no-op
	// after the first call — safe to run from a $effect on every render.
	$effect(() => {
		if (browser && noteId) requestOriginNotes([noteId]);
	});

	const event = $derived(originNotes[noteId]);
	const state = $derived(originNoteStates[noteId]);
	const loading = $derived(!event && state !== 'missing');
	const missing = $derived(!event && state === 'missing');

	const profile = $derived(event ? profiles.get(event.pubkey) : undefined);
	const isMe = $derived(!!event && identity.current?.pk === event.pubkey);
	const authorName = $derived(
		isMe
			? 'You'
			: profile?.display_name || profile?.name || (event ? shortKey(event.pubkey) : 'Someone')
	);

	// Collapse to a single line of prose: strip media URLs + collapse whitespace
	// so the context reads as text, never as raw links.
	const excerpt = $derived(
		event
			? parseContent(cleanNotificationPreview(event))
					.map((token) => {
						if (token.type !== 'nostr') return token.value;
						const raw = token.value.startsWith('nostr:') ? token.value.slice(6) : token.value;
						try {
							const decoded = decode(raw);
							const pubkey =
								decoded.type === 'npub'
									? (decoded.data as string)
									: decoded.type === 'nprofile'
										? (decoded.data as { pubkey: string }).pubkey
										: undefined;
							if (!pubkey) return token.value;
							const mentioned = profiles.get(pubkey);
							return `@${mentioned?.display_name || mentioned?.name || shortKey(pubkey)}`;
						} catch {
							return token.value;
						}
					})
					.join('')
					.replace(/\s+/g, ' ')
					.trim()
			: ''
	);

	// A single thumbnail (Facebook style) — the full grid lives on the note page.
	const thumb = $derived(event ? extractNotificationMedia(event)[0] : undefined);

	const href = $derived(`/note/${event?.id ?? noteId}?returnTo=${encodeURIComponent(returnTo)}`);

	$effect(() => {
		if (event) {
			profiles.ensure([event.pubkey, ...extractMentionEntities(event.content).pubkeys]);
		}
	});

	/** Close the card's overflow menu so it doesn't linger over the note page. */
	function open() {
		popovers.close();
	}
</script>

{#if loading}
	<!-- Skeleton mirrors the loaded layout (icon + indent) for zero CLS. -->
	<div class="mt-2 flex items-start gap-2" aria-hidden="true">
		<div
			class="mt-0.5 size-3.5 shrink-0 animate-pulse rounded-md bg-[var(--ui-border-accented)]"
		></div>
		<div class="flex-1 space-y-1.5 py-1 pr-1.5">
			<div class="h-2.5 w-20 animate-pulse rounded-full bg-[var(--ui-border-accented)]"></div>
			<div class="h-2.5 w-full animate-pulse rounded-full bg-[var(--ui-border-accented)]"></div>
			<div class="h-2.5 w-3/4 animate-pulse rounded-full bg-[var(--ui-border-accented)]"></div>
		</div>
	</div>
{:else if event}
	<a
		{href}
		onclick={open}
		class="group mt-2 flex items-start gap-2 rounded-lg py-0.5 pr-1.5 transition-colors hover:bg-[var(--interactive-hover-bg)] focus-visible:ring-2 focus-visible:ring-primary-500/40 focus-visible:outline-none"
		aria-label="Open the note this activity is about"
	>
		<!-- Leading reply icon marks this as the note the activity is about;
		     brightens to primary on hover/keyboard. -->
		<Icon
			name="i-lucide-corner-down-right"
			class="mt-0.5 size-3.5 shrink-0 text-[var(--ui-text-dimmed)] transition-colors group-hover:text-[var(--ui-color-primary-500)] group-focus-visible:text-[var(--ui-color-primary-500)]"
		/>

		<div class="min-w-0 flex-1 py-0.5">
			<div
				class="flex min-w-0 items-center gap-1.5 text-[11px] leading-none text-[var(--ui-text-dimmed)]"
			>
				{#if isMe}
					<span class="font-bold text-[var(--ui-text-muted)]">Your note</span>
				{:else}
					<span class="truncate font-semibold text-[var(--ui-text-muted)]">{authorName}</span>
					<span class="shrink-0">·</span>
					<span class="shrink-0">{timeAgo(event.created_at)}</span>
				{/if}
			</div>

			{#if excerpt}
				<p
					class="mt-1 line-clamp-2 text-[12.5px] leading-snug break-words text-[var(--ui-text-muted)] transition-colors group-hover:text-[var(--ui-text)]"
				>
					{excerpt}
				</p>
			{:else}
				<p class="mt-1 text-[12px] text-[var(--ui-text-dimmed)] italic">
					{#if thumb}Media post{:else}No text{/if}
				</p>
			{/if}
		</div>

		{#if thumb}
			<div
				class="relative my-0.5 aspect-square w-11 shrink-0 overflow-hidden rounded-lg bg-[var(--ui-bg-muted)]"
			>
				{#if thumb.kind === 'video'}
					<!-- svelte-ignore a11y_media_has_caption -->
					<video
						src={thumb.url}
						poster={thumb.thumb}
						muted
						playsinline
						preload="metadata"
						class="size-full object-cover"
					></video>
					<span
						class="absolute inset-0 grid place-items-center bg-black/25 transition group-hover:bg-black/10"
					>
						<Icon name="i-lucide-play" class="size-4 text-white drop-shadow" />
					</span>
				{:else}
					<img
						src={thumb.thumb ?? thumb.url}
						alt={thumb.alt ?? 'Attachment'}
						loading="lazy"
						decoding="async"
						referrerpolicy="no-referrer"
						class="size-full object-cover transition duration-300 group-hover:scale-[1.04]"
					/>
				{/if}
			</div>
		{/if}
	</a>
{:else if missing}
	<a
		{href}
		onclick={open}
		class="mt-2 inline-flex items-center gap-1.5 rounded-lg px-1 py-0.5 text-[11px] font-semibold text-[var(--ui-text-dimmed)] transition-colors hover:text-primary-500"
	>
		<Icon name="i-lucide-file-text" class="size-3.5" />
		Note unavailable
	</a>
{/if}
