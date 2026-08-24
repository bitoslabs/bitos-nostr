<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { decode } from 'nostr-tools/nip19';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { queryPrimaryFirst } from '$lib/nostr/pool';
	import type { Event } from '$lib/nostr/types';
	import {
		originNotes,
		originNoteStates,
		requestOriginNotes
	} from '$lib/nostr/origin-notes.svelte';
	import { shortKey, timeAgo } from '$lib/utils/format';
	import { parseContent, stripNostrPrefix } from '$lib/utils/note-content';
	import { extractMentionEntities } from '$lib/utils/nip27';
	import NotificationMedia from './NotificationMedia.svelte';
	import { cleanNotificationPreview, extractNotificationMedia } from '$lib/utils/imeta';
	import CommunityInviteCard from '$lib/components/groups/CommunityInviteCard.svelte';

	let {
		value,
		eventId,
		compact = false,
		inline = false
	}: { value?: string; eventId?: string; compact?: boolean; inline?: boolean } = $props();
	const reference = $derived(eventId ?? value ?? '');
	const raw = $derived(stripNostrPrefix(reference));
	type AddressReference = { kind: number; pubkey: string; identifier: string };
	const address = $derived.by(() => {
		try {
			const data = decode(raw);
			return data.type === 'naddr' ? (data.data as AddressReference) : undefined;
		} catch {
			return undefined;
		}
	});
	const addressKey = $derived(
		address ? `${address.kind}:${address.pubkey}:${address.identifier}` : ''
	);
	let addressEvent = $state<Event | undefined>(undefined);
	let addressEventKey = $state('');
	let loadedAddressKey = $state('');
	/** NIP-29 group address (kind 39000) → render a Community invite card. */
	const communityId = $derived.by(() => {
		try {
			const data = decode(raw);
			if (data.type !== 'naddr') return undefined;
			const addr = data.data as { kind: number; identifier: string };
			return addr.kind === 39000 && addr.identifier ? addr.identifier : undefined;
		} catch {
			return undefined;
		}
	});
	const noteId = $derived.by(() => {
		if (eventId) return eventId;
		try {
			const data = decode(raw);
			return data.type === 'note'
				? (data.data as string)
				: data.type === 'nevent'
					? (data.data as { id: string }).id
					: undefined;
		} catch {
			return undefined;
		}
	});
	// All embeds use the shared request queue. A feed containing many `nevent`
	// references is therefore hydrated in batches, rather than one relay call per card.
	const event = $derived(
		originNotes[noteId ?? ''] ?? (addressEventKey === addressKey ? addressEvent : undefined)
	);
	const originState = $derived(originNoteStates[noteId ?? '']);
	const loading = $derived(
		(!!noteId && !event && originState !== 'missing') ||
			(!!address && !event && loadedAddressKey !== addressKey)
	);
	$effect(() => {
		if (browser && !communityId && noteId) requestOriginNotes([noteId]);
		if (!browser || communityId || !address || loadedAddressKey === addressKey) return;
		loadedAddressKey = addressKey;
		addressEvent = undefined;
		addressEventKey = '';
		const requestKey = addressKey;
		const applyAddressEvent = (events: Event[]) => {
			if (requestKey !== addressKey) return;
			addressEvent = events[0];
			addressEventKey = requestKey;
		};
		void queryPrimaryFirst(
			[
				{
					kinds: [address.kind],
					authors: [address.pubkey],
					'#d': [address.identifier],
					limit: 1
				}
			],
			{
				onPrimary: applyAddressEvent,
				onSecondary: applyAddressEvent
			}
		).then(applyAddressEvent);
	});
	$effect(() => {
		if (event) profiles.ensure([event.pubkey, ...extractMentionEntities(event.content).pubkeys]);
	});

	const profile = $derived(event ? profiles.get(event.pubkey) : undefined);
	const displayName = $derived(
		profile?.display_name || profile?.name || (event ? shortKey(event.pubkey) : 'Unknown author')
	);
	const contextName = $derived(
		event && identity.current?.pk === event.pubkey ? 'Your comment' : displayName
	);
	const media = $derived(event ? extractNotificationMedia(event) : []);
	const excerpt = $derived(
		event
			? parseContent(cleanNotificationPreview(event))
					.map((token) => {
						if (token.type !== 'nostr') return token.value;
						const mention = stripNostrPrefix(token.value);
						try {
							const decoded = decode(mention);
							const pubkey =
								decoded.type === 'npub'
									? (decoded.data as string)
									: decoded.type === 'nprofile'
										? (decoded.data as { pubkey: string }).pubkey
										: undefined;
							if (!pubkey) return token.value;
							const mentionProfile = profiles.get(pubkey);
							return `@${mentionProfile?.display_name || mentionProfile?.name || shortKey(pubkey)}`;
						} catch {
							return token.value;
						}
					})
					.join('')
					.replace(/\s+/g, ' ')
					.trim() || 'No text content'
			: ''
	);
	const returnTo = $derived(
		page.url.pathname.startsWith('/profile')
			? `${page.url.pathname}${page.url.search}`
			: page.url.pathname.startsWith('/notifications')
				? '/notifications'
				: '/'
	);
	const noteHref = $derived(
		`/note/${event?.id ?? noteId ?? raw}?returnTo=${encodeURIComponent(returnTo)}`
	);
</script>

{#if communityId}
	<div class={inline ? 'mt-1' : 'my-2'}>
		<CommunityInviteCard groupId={communityId} {compact} />
	</div>
{:else if loading}
	<div
		class={inline
			? 'mt-1 flex items-center gap-2 rounded-lg bg-[var(--ui-bg-muted)] px-2 py-1.5 text-[11px] text-[var(--ui-text-muted)]'
			: 'my-2 flex items-center gap-2 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3 py-2.5 text-[12px] text-[var(--ui-text-muted)]'}
	>
		<span class="size-3 animate-pulse rounded-full bg-primary-500/50"></span>Loading referenced
		note…
	</div>
{:else if event}
	<section
		class={inline
			? 'mt-1 block rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-2 py-1.5 transition hover:border-primary-500/50 hover:bg-[var(--interactive-hover-bg)]'
			: 'my-2 block rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] p-3 transition hover:border-primary-500/50 hover:bg-[var(--interactive-hover-bg)]'}
		aria-label={`Embedded note by ${displayName}`}
	>
		<div class="flex items-center gap-2">
			<Avatar
				pubkey={event.pubkey}
				name={displayName}
				picture={profile?.picture}
				size={inline ? 22 : compact ? 26 : 30}
			/>
			<div class="min-w-0 flex-1">
				<div class="truncate text-[12px] font-bold">{inline ? contextName : displayName}</div>
				<div class="text-[11px] text-[var(--ui-text-muted)]">
					{inline ? 'context' : timeAgo(event.created_at)}
				</div>
			</div>
			<a
				href={noteHref}
				class="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-bold text-primary-500 transition hover:bg-primary-500/10 hover:text-primary-600 focus-visible:ring-2 focus-visible:ring-primary-500/40 focus-visible:outline-none"
				aria-label={`View original note by ${displayName}`}
			>
				View original <Icon name="i-lucide-arrow-up-right" class="size-3.5" />
			</a>
		</div>
		{#if inline}
			<div class="mt-1 flex items-center gap-2">
				{#if excerpt}
					<p
						class="line-clamp-2 min-w-0 flex-1 text-[11.5px] leading-snug break-words whitespace-pre-wrap"
					>
						{excerpt}
					</p>
				{/if}
				{#if media[0]}
					<img
						src={media[0].thumb ?? media[0].url}
						alt={media[0].alt ?? 'Attached media'}
						class="size-10 shrink-0 rounded-md object-cover"
						loading="lazy"
					/>
				{/if}
			</div>
		{:else if excerpt}
			<p class="mt-2 line-clamp-3 text-[12.5px] leading-relaxed break-words whitespace-pre-wrap">
				{excerpt}
			</p>
		{/if}
		{#if media.length && !inline}
			<div class="mt-2">
				<NotificationMedia {media} tags={event.tags} content={event.content} playSingleVideo />
			</div>
		{/if}
	</section>
{:else}
	<a
		href={noteId || address
			? `/note/${noteId ?? raw}?returnTo=${encodeURIComponent(returnTo)}`
			: reference}
		class="my-1 inline-flex items-center gap-1 text-[12px] font-semibold text-accent-500 hover:underline"
		><Icon name="i-lucide-file-question" class="size-3.5" />Referenced note unavailable</a
	>
{/if}
