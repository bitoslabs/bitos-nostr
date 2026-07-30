<script lang="ts">
	import { page } from '$app/state';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { dms } from '$lib/nostr/dms.svelte';
	import { notifications } from '$lib/nostr/notifications.svelte';
	import { privacyNotificationSettings } from '$lib/stores/privacy-notification-settings.svelte';

	const nav = [
		{ to: '/', label: 'Home Feed', icon: 'i-lucide-house' },
		{ to: '/messages', label: 'Chats', icon: 'i-lucide-message-circle-more', badge: true },
		{ to: '/notifications', label: 'Notifications', icon: 'i-lucide-bell', notifications: true },
		{ to: '/reels', label: 'Reels', icon: 'i-lucide-clapperboard' },
		{ to: '/discover', label: 'Discover', icon: 'i-lucide-compass' },
		{ to: '/bookmarks', label: 'Bookmarks', icon: 'i-lucide-bookmark' },
		{ to: '/profile', label: 'Profile', icon: 'i-lucide-user' },
		{ to: '/settings', label: 'Settings', icon: 'i-lucide-settings-2' }
	];

	function isActive(to: string) {
		const path = page.url.pathname;
		return to === '/' ? path === '/' : path.startsWith(to);
	}

	const me = $derived(identity.current);
	const myProfile = $derived(me ? profiles.get(me.pk) : undefined);
	const displayName = $derived(myProfile?.display_name || myProfile?.name || 'You');
	const unread = $derived(privacyNotificationSettings.state.dms ? dms.unreadCount : 0);
	const notificationUnread = $derived(notifications.unreadCount);
	const logo = '/icons/icon-96-96.png';
</script>

<nav class="flex h-full flex-col items-center py-5">
	<!-- Brand -->
	<a
		href="/"
		aria-label="BitOS home"
		class="mb-6 grid size-11 place-items-center overflow-hidden rounded-2xl shadow-[var(--glow-primary)] transition-transform hover:scale-105 active:scale-95"
	>
		<img src={logo} alt="" class="size-full" />
	</a>

	<div class="flex flex-1 flex-col gap-2">
		{#each nav as item (item.to)}
			{@const active = isActive(item.to)}
			<a
				href={item.to}
				class="group relative grid size-11 place-items-center rounded-2xl transition-all {active
					? 'bg-primary-500 text-white shadow-[var(--glow-primary)]'
					: 'text-[var(--ui-text-muted)] hover:bg-primary-500/10 hover:text-primary-500'}"
				aria-label={item.label}
				aria-current={active ? 'page' : undefined}
			>
				<Icon name={item.icon} class="size-[18px]" />
				{#if (item.badge && unread > 0) || (item.notifications && notificationUnread > 0)}
					<span
						class="absolute -top-1 -right-1 grid size-4 place-items-center rounded-full bg-primary-500 text-[9px] font-bold text-white ring-2 ring-[var(--surface-bg)]"
						>{item.notifications
							? notificationUnread > 9
								? '9+'
								: notificationUnread
							: unread > 9
								? '9+'
								: unread}</span
					>
				{/if}
				<span
					class="pointer-events-none absolute left-[calc(100%+12px)] z-50 hidden rounded-md bg-[var(--ui-text-highlighted)] px-2.5 py-1 text-[12px] font-medium whitespace-nowrap text-[var(--ui-bg)] opacity-0 shadow-[var(--shadow-pop)] transition-opacity group-hover:opacity-100 lg:block"
				>
					{item.label}
				</span>
			</a>
		{/each}
	</div>

	<div class="flex flex-col items-center gap-2">
		{#if me}
			<a
				href="/profile"
				class="relative size-11 overflow-hidden mask-squircle ring-2 ring-primary-500/30 transition-all hover:ring-primary-500"
				aria-label="Your profile"
			>
				<Avatar pubkey={me.pk} name={displayName} picture={myProfile?.picture} size={44} />
			</a>
		{/if}
	</div>
</nav>
