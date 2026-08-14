<script lang="ts">
	import PageHeader from '$lib/components/premium/PageHeader.svelte';
	import NotificationRow from '$lib/components/feed/NotificationRow.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { notifications as seed, notifMeta, type AppNotification, type NotifType } from '$lib/components/premium/data';

	/** Notifications view: type tabs + the grouped notification stream. */
	let activeTab = $state('all');
	let items = $state<AppNotification[]>([...seed]);
	const tabs = [
		{ key: 'all', label: 'All' },
		{ key: 'zap', label: 'Zaps' },
		{ key: 'mention', label: 'Mentions' },
		{ key: 'repost', label: 'Reposts' },
		{ key: 'like', label: 'Likes' },
		{ key: 'follow', label: 'Follows' }
	];

	const filtered = $derived(activeTab === 'all' ? items : items.filter((n) => n.type === (activeTab as NotifType)));
	const unread = $derived(items.filter((n) => n.unread).length);

	function markAllRead() {
		items = items.map((n) => ({ ...n, unread: false }));
	}
</script>

<PageHeader title="Notifications" {tabs} activeTab={activeTab} onTabChange={(k) => (activeTab = k)}>
	{#snippet actions()}
		<button type="button" onclick={markAllRead} class="icon-btn size-9" aria-label="Mark all read">
			<Icon name="i-lucide-check-check" class="size-4" />
		</button>
	{/snippet}
</PageHeader>

{#if unread > 0}
	<div class="border-b border-[var(--ui-border-muted)] bg-[color-mix(in_oklab,var(--ui-color-primary-500)_6%,transparent)] px-4 py-2 text-xs text-[var(--ui-color-primary-500)]">
		{unread} unread notification{unread === 1 ? '' : 's'}
	</div>
{/if}

<div>
	{#each filtered as n (n.id)}
		<NotificationRow notification={n} onClick={(x) => (items = items.map((i) => (i.id === x.id ? { ...i, unread: false } : i)))} />
	{:else}
		<div class="flex flex-col items-center gap-2 py-16 text-center text-[var(--ui-text-muted)]">
			<Icon name="i-lucide-bell-off" class="size-7" />
			<p class="text-sm">No notifications here</p>
		</div>
	{/each}
</div>
