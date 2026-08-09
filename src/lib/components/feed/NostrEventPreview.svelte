<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { decode } from 'nostr-tools/nip19';
	import type { Event } from 'nostr-tools/pure';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { queryPrimaryFirst } from '$lib/nostr/pool';
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

	let { value, compact = false }: { value: string; compact?: boolean } = $props();
	const raw = $derived(value.startsWith('nostr:') ? value.slice(6) : value);
	const noteId = $derived.by(() => {
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

	let event = $state<Event | null>(null);
	let loading = $state(true);
	$effect(() => {
		if (!browser || !noteId) {
			loading = false;
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
		class="my-2 flex items-center gap-2 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3 py-2.5 text-[12px] text-[var(--ui-text-muted)]"
	>
		<span class="size-3 animate-pulse rounded-full bg-primary-500/50"></span>Loading referenced
		note…
	</div>
{:else if event}
	<a
		href={noteHref}
		class="my-2 block rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] p-3 transition hover:border-primary-500/50 hover:bg-[var(--interactive-hover-bg)]"
		aria-label={`Open note by ${displayName}`}
	>
		<div class="flex items-center gap-2">
			<Avatar
				pubkey={event.pubkey}
				name={displayName}
				picture={profile?.picture}
				size={compact ? 26 : 30}
			/>
			<div class="min-w-0 flex-1">
				<div class="truncate text-[12px] font-bold">{displayName}</div>
				<div class="text-[11px] text-[var(--ui-text-muted)]">{timeAgo(event.created_at)}</div>
			</div>
			<Icon name="i-lucide-external-link" class="size-3.5 text-[var(--ui-text-muted)]" />
		</div>
		{#if excerpt}
			<p class="mt-2 line-clamp-3 text-[12.5px] leading-relaxed break-words whitespace-pre-wrap">
				{excerpt}
			</p>
		{/if}
		{#if media.length}
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
		href={noteId ? `/note/${noteId}?returnTo=${encodeURIComponent(returnTo)}` : value}
		class="my-1 inline-flex items-center gap-1 text-[12px] font-semibold text-accent-500 hover:underline"
		><Icon name="i-lucide-file-question" class="size-3.5" />Referenced note unavailable</a
	>
{/if}
