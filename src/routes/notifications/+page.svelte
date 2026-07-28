<script lang="ts">
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { notifications } from '$lib/nostr/notifications.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { shortKey, timeAgo, timeFull } from '$lib/utils/format';
	import type { NotificationItem } from '$lib/nostr/types';

	const unread = $derived(notifications.unreadCount);

	function actorName(pubkey: string) {
		const profile = profiles.get(pubkey);
		return profile?.display_name || profile?.name || shortKey(pubkey);
	}

	function iconFor(type: NotificationItem['type']) {
		if (type === 'comment') return 'i-lucide-message-circle';
		if (type === 'repost') return 'i-lucide-repeat-2';
		if (type === 'follow') return 'i-lucide-user-plus';
		return 'i-lucide-heart';
	}

	function labelFor(type: NotificationItem['type']) {
		if (type === 'comment') return 'commented on your note';
		if (type === 'repost') return 'reposted your note';
		if (type === 'follow') return 'followed you';
		return 'liked your note';
	}

	function targetLink(item: NotificationItem) {
		return item.targetId ? `/note/${item.targetId}` : `/profile/${item.pubkey}`;
	}

	async function copyTarget(item: NotificationItem) {
		try {
			await navigator.clipboard.writeText(item.targetId ?? item.pubkey);
			toasts.success(item.targetId ? 'Note id copied' : 'Profile id copied');
		} catch {
			toasts.error('Could not copy id');
		}
	}

	function preview(item: NotificationItem) {
		if (item.type === 'like') return item.content || '❤️';
		if (item.type === 'follow') return '';
		const body = item.content.trim().replace(/\s+/g, ' ');
		return body.length > 140 ? `${body.slice(0, 140).trimEnd()}…` : body;
	}

	function openItem(item: NotificationItem) {
		notifications.markRead(item.id);
	}
</script>

<div class="h-full overflow-y-auto">
	<div class="mx-auto max-w-[720px] px-5 py-6">
		<header class="mb-5 flex items-center justify-between gap-4">
			<div>
				<h1 class="font-display text-[32px] leading-none font-extrabold tracking-tight">
					Notifications
				</h1>
				<p class="mt-1.5 text-[12px] text-[var(--ui-text-muted)]">
					{unread} unread · {notifications.items.length} activities
				</p>
			</div>
			<button
				type="button"
				onclick={() => notifications.markAllRead()}
				disabled={!unread}
				class="inline-flex items-center gap-2 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-3 py-2 text-[12px] font-bold text-[var(--ui-text-muted)] transition hover:text-primary-500 disabled:pointer-events-none disabled:opacity-50"
			>
				<Icon name="i-lucide-check-check" class="size-4" />
				Mark read
			</button>
		</header>

		{#if notifications.loading && !notifications.items.length}
			<div class="flex flex-col items-center gap-3 py-20 text-center">
				<div
					class="size-7 animate-spin rounded-full border-2 border-[var(--ui-border)] border-t-primary-500"
				></div>
				<p class="text-[13px] text-[var(--ui-text-muted)]">Loading activity from relays…</p>
			</div>
		{:else if !notifications.items.length}
			<div class="post-card flex flex-col items-center gap-3 py-16 text-center">
				<div
					class="grid size-14 place-items-center rounded-2xl bg-[var(--ui-bg-muted)] text-[var(--ui-text-dimmed)]"
				>
					<Icon name="i-lucide-bell" class="size-7" />
				</div>
				<div>
					<p class="text-[15px] font-semibold">No notifications yet</p>
					<p class="mt-1 text-[13px] text-[var(--ui-text-muted)]">
						Likes, comments, reposts, and follows will appear here.
					</p>
				</div>
			</div>
		{:else}
			<div class="space-y-3">
				{#each notifications.items as item (item.id)}
					{@const name = actorName(item.pubkey)}
					{@const profile = profiles.get(item.pubkey)}
					<a
						href={targetLink(item)}
						onclick={() => openItem(item)}
						class="post-card flex items-start gap-3 p-4 transition hover:border-primary-500/25 hover:bg-[var(--interactive-hover-bg)]"
					>
						<div class="relative shrink-0">
							<Avatar pubkey={item.pubkey} {name} picture={profile?.picture} size={44} />
							<span
								class="absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full bg-primary-500 text-white ring-2 ring-[var(--surface-bg)]"
							>
								<Icon name={iconFor(item.type)} class="size-3" />
							</span>
						</div>
						<div class="min-w-0 flex-1">
							<div class="flex min-w-0 items-start justify-between gap-3">
								<p class="min-w-0 text-[14px] leading-snug">
									<span class="font-bold">{name}</span>
									<span class="text-[var(--ui-text-muted)]"> {labelFor(item.type)}</span>
								</p>
								{#if !item.read}
									<span class="mt-1 size-2 shrink-0 rounded-full bg-primary-500"></span>
								{/if}
							</div>
							{#if preview(item)}
								<p
									class="mt-1 line-clamp-2 text-[13px] leading-relaxed break-words text-[var(--ui-text-muted)]"
								>
									{preview(item)}
								</p>
							{/if}
							<div class="mt-2 flex items-center gap-2 text-[11px] text-[var(--ui-text-dimmed)]">
								<time title={timeFull(item.createdAt)}>{timeAgo(item.createdAt)}</time>
								{#if item.targetId}
									<span>·</span>
									<span class="font-mono">{shortKey(item.targetId, 8, 6)}</span>
								{/if}
							</div>
							<div class="mt-3 flex items-center gap-2 text-[11.5px] font-bold">
								<span class="text-primary-500">Open in BitOS</span>
								<button
									type="button"
									onclick={(event) => {
										event.preventDefault();
										event.stopPropagation();
										void copyTarget(item);
									}}
									class="text-[var(--ui-text-dimmed)] hover:text-primary-500"
								>
									Copy id
								</button>
							</div>
						</div>
					</a>
				{/each}
			</div>
			<div class="py-8 text-center">
				<button
					type="button"
					onclick={() => notifications.loadMore()}
					disabled={notifications.loadingMore || !notifications.hasMore}
					class="inline-flex items-center justify-center gap-2 rounded-full border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-6 py-2.5 text-[13px] font-semibold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-accented)] disabled:cursor-default disabled:opacity-60 disabled:hover:bg-[var(--surface-bg)]"
				>
					{#if notifications.loadingMore}
						<Icon name="i-lucide-loader-circle" class="size-4 animate-spin" />
						Loading older activity
					{:else if notifications.hasMore}
						Load older notifications
					{:else}
						End of relay results
					{/if}
				</button>
			</div>
		{/if}
	</div>
</div>
