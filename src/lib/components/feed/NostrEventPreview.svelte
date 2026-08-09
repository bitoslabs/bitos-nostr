<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { decode } from 'nostr-tools/nip19';
	import type { Event } from 'nostr-tools/pure';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { queryPrimaryFirst } from '$lib/nostr/pool';
	import {
		originNotes,
		originNoteStates,
		requestOriginNotes
	} from '$lib/nostr/origin-notes.svelte';
	import { shortKey, timeAgo } from '$lib/utils/format';
	import NotificationMedia from './NotificationMedia.svelte';
	import { cleanNotificationPreview, extractNotificationMedia } from '$lib/utils/imeta';

	const eventCache = new Map<string, Event>();
	const eventRequests = new Map<string, Promise<Event | null>>();

	function loadEvent(id: string): Promise<Event | null> {
		const cached = eventCache.get(id);
		if (cached) return Promise.resolve(cached);
		const pending = eventRequests.get(id);
		if (pending) return pending;
		const request = queryPrimaryFirst([{ ids: [id], limit: 1 }])
			.then((events) => {
				const found = events[0] ?? null;
				if (found) eventCache.set(id, found);
				return found;
			})
			.finally(() => eventRequests.delete(id));
		eventRequests.set(id, request);
		return request;
	}

	let {
		value,
		eventId,
		compact = false,
		inline = false
	}: { value?: string; eventId?: string; compact?: boolean; inline?: boolean } = $props();
	const reference = $derived(eventId ?? value ?? '');
	const raw = $derived(reference.startsWith('nostr:') ? reference.slice(6) : reference);
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
	const batchedEvent = $derived(eventId ? originNotes[noteId ?? ''] : undefined);
	const batchedState = $derived(eventId ? originNoteStates[noteId ?? ''] : undefined);

	let event = $state<Event | null>(null);
	let loading = $state(true);
	$effect(() => {
		if (!browser || !noteId) {
			loading = false;
			return;
		}
		if (eventId) {
			requestOriginNotes([noteId]);
			event = batchedEvent ?? null;
			loading = !batchedEvent && batchedState !== 'missing';
			if (batchedEvent) profiles.ensure([batchedEvent.pubkey]);
			return;
		}
		let active = true;
		void loadEvent(noteId)
			.then((found) => {
				if (!active) return;
				event = found;
				loading = false;
				if (event) profiles.ensure([event.pubkey]);
			})
			.catch(() => {
				if (active) loading = false;
			});
		return () => (active = false);
	});

	const profile = $derived(event ? profiles.get(event.pubkey) : undefined);
	const displayName = $derived(
		profile?.display_name || profile?.name || (event ? shortKey(event.pubkey) : 'Unknown author')
	);
	const media = $derived(event ? extractNotificationMedia(event) : []);
	const excerpt = $derived(
		event ? cleanNotificationPreview(event).replace(/\s+/g, ' ').trim() || 'No text content' : ''
	);
	const returnTo = $derived(
		page.url.pathname.startsWith('/profile')
			? `${page.url.pathname}${page.url.search}`
			: page.url.pathname.startsWith('/notifications')
				? '/notifications'
				: '/'
	);
	const noteHref = $derived(
		`/note/${event?.id ?? noteId}?returnTo=${encodeURIComponent(returnTo)}`
	);
</script>

{#if loading}
	<div
		class={inline
			? 'mt-1 flex items-center gap-2 rounded-lg bg-[var(--ui-bg-muted)] px-2 py-1.5 text-[11px] text-[var(--ui-text-muted)]'
			: 'my-2 flex items-center gap-2 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3 py-2.5 text-[12px] text-[var(--ui-text-muted)]'}
	>
		<span class="size-3 animate-pulse rounded-full bg-primary-500/50"></span>Loading referenced
		note…
	</div>
{:else if event}
	<a
		href={noteHref}
		class={inline
			? 'mt-1 block rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-2 py-1.5 transition hover:border-primary-500/50 hover:bg-[var(--interactive-hover-bg)]'
			: 'my-2 block rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] p-3 transition hover:border-primary-500/50 hover:bg-[var(--interactive-hover-bg)]'}
		aria-label={`Open note by ${displayName}`}
	>
		<div class="flex items-center gap-2">
			<Avatar
				pubkey={event.pubkey}
				name={displayName}
				picture={profile?.picture}
				size={inline ? 22 : compact ? 26 : 30}
			/>
			<div class="min-w-0 flex-1">
				<div class="truncate text-[12px] font-bold">{displayName}</div>
				<div class="text-[11px] text-[var(--ui-text-muted)]">
					{inline ? 'original note' : timeAgo(event.created_at)}
				</div>
			</div>
			<Icon name="i-lucide-external-link" class="size-3.5 text-[var(--ui-text-muted)]" />
		</div>
		{#if excerpt}
			<p
				class={inline
					? 'mt-1 line-clamp-2 text-[11.5px] leading-snug break-words whitespace-pre-wrap'
					: 'mt-2 line-clamp-3 text-[12.5px] leading-relaxed break-words whitespace-pre-wrap'}
			>
				{excerpt}
			</p>
		{/if}
		{#if media.length && !inline}
			<div
				class="mt-2"
				role="presentation"
				onclick={(e) => e.stopPropagation()}
				onkeydown={(e) => e.stopPropagation()}
			>
				<NotificationMedia {media} tags={event.tags} content={event.content} />
			</div>
		{/if}
	</a>
{:else}
	<a
		href={noteId ? `/note/${noteId}?returnTo=${encodeURIComponent(returnTo)}` : reference}
		class="my-1 inline-flex items-center gap-1 text-[12px] font-semibold text-accent-500 hover:underline"
		><Icon name="i-lucide-file-question" class="size-3.5" />Referenced note unavailable</a
	>
{/if}
