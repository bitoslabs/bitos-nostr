<script lang="ts">
	import { page } from '$app/state';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { dms } from '$lib/nostr/dms.svelte';
	import { notifications } from '$lib/nostr/notifications.svelte';

	/** iOS-style bottom tab bar for mobile (hidden on lg+ where the rail is). */

	const tabs = [
		{ to: '/', label: 'Home', icon: 'i-lucide-house' },
		{ to: '/discover', label: 'Discover', icon: 'i-lucide-compass' },
		{ to: '/messages', label: 'Chats', icon: 'i-lucide-message-circle-more', badge: true },
		{ to: '/notifications', label: 'Activity', icon: 'i-lucide-bell', notifications: true }
	];

	const moreItems = [
		{ to: '/reels', label: 'Reels', icon: 'i-lucide-clapperboard' },
		{ to: '/bookmarks', label: 'Saved', icon: 'i-lucide-bookmark' },
		{ to: '/profile', label: 'Profile', icon: 'i-lucide-user' },
		{ to: '/settings', label: 'Account', icon: 'i-lucide-settings-2' }
	];

	let moreOpen = $state(false);

	function isActive(to: string) {
		const path = page.url.pathname;
		return to === '/' ? path === '/' : path.startsWith(to);
	}

	const me = $derived(identity.current);
	const displayName = $derived(
		me?.pk ? profiles.get(me.pk)?.display_name || profiles.get(me.pk)?.name || 'You' : ''
	);
	const unread = $derived(dms.unreadCount);
	const notificationUnread = $derived(notifications.unreadCount);
	const moreActive = $derived(moreItems.some((item) => isActive(item.to)));
</script>

<svelte:window onclick={() => (moreOpen = false)} />

<nav
	class="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-[var(--ui-border-muted)] bg-[var(--surface-bg)] pb-[env(safe-area-inset-bottom)] lg:hidden"
	aria-label="Primary"
>
	{#each tabs as tab (tab.to)}
		{@const active = isActive(tab.to)}
		<a
			href={tab.to}
			class="relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10.5px] font-semibold transition-colors {active
				? 'text-primary-500'
				: 'text-[var(--ui-text-dimmed)]'}"
		>
			<span class="relative">
				<Icon name={tab.icon} class="size-[22px]" />
				{#if (tab.badge && unread > 0) || (tab.notifications && notificationUnread > 0)}
					<span
						class="absolute -top-1 -right-2 grid size-4 place-items-center rounded-full bg-warm-500 text-[9px] font-bold text-white"
						>{tab.notifications
							? notificationUnread > 9
								? '9+'
								: notificationUnread
							: unread > 9
								? '9+'
								: unread}</span
					>
				{/if}
			</span>
			<span>{tab.label}</span>
		</a>
	{/each}
	<div class="relative flex flex-1">
		<button
			type="button"
			onclick={(event) => {
				event.stopPropagation();
				moreOpen = !moreOpen;
			}}
			class="relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10.5px] font-semibold transition-colors {moreActive || moreOpen
				? 'text-primary-500'
				: 'text-[var(--ui-text-dimmed)]'}"
			aria-label="More navigation"
			aria-expanded={moreOpen}
		>
			<Icon name="i-lucide-menu" class="size-[22px]" />
			<span>More</span>
		</button>

		{#if moreOpen}
			<div
				class="absolute right-2 bottom-[calc(100%+10px)] z-50 w-56 rounded-2xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] p-2 shadow-[var(--shadow-pop)]"
			>
				{#if me}
					<a
						href="/profile"
						onclick={() => (moreOpen = false)}
						class="mb-1 flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-[var(--interactive-hover-bg)]"
					>
						<Avatar
							pubkey={me.pk}
							name={displayName}
							picture={profiles.get(me.pk)?.picture}
							size={34}
							frame
						/>
						<span class="min-w-0">
							<span class="block truncate text-[13px] font-bold text-[var(--ui-text)]">{displayName}</span>
							<span class="block text-[11px] text-[var(--ui-text-muted)]">View profile</span>
						</span>
					</a>
					<div class="my-1 h-px bg-[var(--ui-border-muted)]"></div>
				{/if}

				{#each moreItems as item (item.to)}
					<a
						href={item.to}
						onclick={() => (moreOpen = false)}
						class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-bold transition {isActive(
							item.to
						)
							? 'bg-primary-500/10 text-primary-600'
							: 'text-[var(--ui-text-muted)] hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]'}"
					>
						<Icon name={item.icon} class="size-4 shrink-0" />
						{item.label}
					</a>
				{/each}
			</div>
		{/if}
	</div>
</nav>
