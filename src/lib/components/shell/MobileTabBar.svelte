<script lang="ts">
	import { page } from '$app/state';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { dms } from '$lib/nostr/dms.svelte';
	import { notifications } from '$lib/nostr/notifications.svelte';
	import { privacyNotificationSettings } from '$lib/stores/privacy-notification-settings.svelte';

	/**
	 * iOS-style bottom tab bar for mobile (hidden on lg+ where the rail is).
	 * The last tab is "You": the logged-in avatar, linking to the /more hub
	 * (profile card, quick tiles, accounts, settings) instead of a cramped
	 * popover. Guests get a neutral icon and a sign-in funnel on /more.
	 */

	const tabs = [
		{ to: '/', label: 'Home', icon: 'i-lucide-house' },
		{ to: '/discover', label: 'Discover', icon: 'i-lucide-compass' },
		{
			to: '/messages',
			label: 'Chats',
			icon: 'i-lucide-message-circle-more',
			badge: true,
			requiresAuth: true
		},
		{
			to: '/notifications',
			label: 'Activity',
			icon: 'i-lucide-bell',
			notifications: true,
			requiresAuth: true
		}
	];

	// Routes that live behind the "You" tab — the avatar lights up for them.
	const youPrefixes = [
		'/more',
		'/communities',
		'/bitz',
		'/zaps',
		'/bookmarks',
		'/profile',
		'/settings'
	];

	function isActive(to: string) {
		const path = page.url.pathname;
		return to === '/' ? path === '/' : path.startsWith(to);
	}

	const me = $derived(identity.current);
	const visibleTabs = $derived(tabs.filter((item) => me || !item.requiresAuth));
	const displayName = $derived(
		me?.pk ? profiles.get(me.pk)?.display_name || profiles.get(me.pk)?.name || 'You' : ''
	);
	const unread = $derived(privacyNotificationSettings.state.dms ? dms.unreadCount : 0);
	const notificationUnread = $derived(notifications.unreadCount);
	const youActive = $derived(
		page.url.pathname === '/more' ||
			youPrefixes.some(
				(prefix) => page.url.pathname === prefix || page.url.pathname.startsWith(`${prefix}/`)
			)
	);
</script>

<nav
	class="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-[var(--ui-border-muted)] bg-[var(--surface-bg)] pb-[env(safe-area-inset-bottom)] lg:hidden"
	aria-label="Primary"
>
	{#each visibleTabs as tab (tab.to)}
		{@const active = isActive(tab.to)}
		<a
			href={tab.to}
			class="relative flex flex-1 items-center justify-center px-1.5 py-2"
			aria-current={active ? 'page' : undefined}
		>
			<span
				class="relative flex w-full max-w-[88px] flex-col items-center justify-center gap-0.5 rounded-2xl px-2 py-2 text-[10.5px] font-semibold transition-colors {active
					? 'text-primary-600 dark:text-primary-300'
					: 'text-[var(--ui-text-dimmed)]'}"
			>
				<span class="relative">
					<Icon
						name={tab.icon}
						class="size-[22px] transition-transform {active
							? 'scale-105 text-primary-500 dark:text-primary-300'
							: ''}"
					/>
					{#if (tab.badge && unread > 0) || (tab.notifications && notificationUnread > 0)}
						<span
							class="absolute -top-1 -right-2 z-20 grid min-w-[1.2rem] place-items-center rounded-full bg-warm-500 px-1 py-[1px] text-[9px] leading-none font-extrabold text-white shadow-[var(--glow-primary)] ring-2 ring-[var(--surface-bg)]"
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
			</span>
		</a>
	{/each}

	<!-- You: avatar → /more hub -->
	<a
		href="/more"
		class="relative flex flex-1 items-center justify-center px-1.5 py-2"
		aria-current={youActive ? 'page' : undefined}
		aria-label="You — profile and more"
	>
		<span
			class="relative flex w-full max-w-[88px] flex-col items-center justify-center gap-0.5 rounded-2xl px-2 py-2 text-[10.5px] font-semibold transition-colors {youActive
				? 'text-primary-600 dark:text-primary-300'
				: 'text-[var(--ui-text-dimmed)]'}"
		>
			<span
				class="relative grid size-7 place-items-center transition-transform duration-200 {youActive
					? 'scale-110'
					: 'scale-100'}"
			>
				<!-- Soft aura behind the active hex frame -->
				<span
					class="absolute inset-[-2px] rounded-full bg-primary-500/40 blur-[5px] transition-opacity duration-200 {youActive
						? 'opacity-100'
						: 'opacity-0'}"
					aria-hidden="true"
				></span>
				<!-- Hex frame: the outline follows the brand hex geometry
				     (clip-path clips box-shadows, so the border is a clipped backdrop layer) -->
				<span
					class="hex-clip absolute inset-0 transition-colors duration-200 {youActive
						? 'bg-gradient-to-br from-primary-400 to-primary-600 dark:from-primary-300 dark:to-primary-500'
						: 'bg-[var(--ui-border-muted)]'}"
					aria-hidden="true"
				></span>
				{#if me}
					<Avatar
						pubkey={me.pk}
						name={displayName}
						picture={profiles.get(me.pk)?.picture}
						size={24}
						shape="hex"
						class="relative"
					/>
				{:else}
					<Icon
						name="i-lucide-user-round"
						class="relative size-[15px] transition-colors duration-200 {youActive
							? 'text-primary-500 dark:text-primary-300'
							: 'text-[var(--ui-text-dimmed)]'}"
					/>
				{/if}
			</span>
			<span>You</span>
		</span>
	</a>
</nav>
