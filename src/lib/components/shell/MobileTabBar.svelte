<script lang="ts">
	import { page } from '$app/state';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import MenuItem from '$lib/components/ui/MenuItem.svelte';
	import MenuDivider from '$lib/components/ui/MenuDivider.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { dms } from '$lib/nostr/dms.svelte';
	import { notifications } from '$lib/nostr/notifications.svelte';
	import { privacyNotificationSettings } from '$lib/stores/privacy-notification-settings.svelte';
	import { popovers } from '$lib/stores/popovers.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { shortKey } from '$lib/utils/format';

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

	function isActive(to: string) {
		const path = page.url.pathname;
		return to === '/' ? path === '/' : path.startsWith(to);
	}

	const me = $derived(identity.current);
	const displayName = $derived(
		me?.pk ? profiles.get(me.pk)?.display_name || profiles.get(me.pk)?.name || 'You' : ''
	);
	const unread = $derived(privacyNotificationSettings.state.dms ? dms.unreadCount : 0);
	const notificationUnread = $derived(notifications.unreadCount);
	const moreActive = $derived(moreItems.some((item) => isActive(item.to)));

	function accountName(account: (typeof identity.accounts)[number]) {
		const profile = profiles.get(account.pk) ?? account.profile;
		return profile?.display_name || profile?.name || shortKey(account.npub, 8, 6);
	}

	function accountPicture(account: (typeof identity.accounts)[number]) {
		return (profiles.get(account.pk) ?? account.profile)?.picture;
	}

	function switchAccount(pubkey: string) {
		if (identity.current?.pk === pubkey) return;
		try {
			identity.switchTo(pubkey);
			popovers.close();
			toasts.info('Switched account');
		} catch (e) {
			toasts.error((e as Error).message);
		}
	}
</script>

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
	<Popover
		id="mobile-more"
		placement="top-end"
		width="md"
		rootClass="flex-1"
		label="More navigation"
		triggerClass="relative flex w-full flex-col items-center justify-center gap-0.5 py-2 text-[10.5px] font-semibold transition-colors {moreActive
			? 'text-primary-500'
			: 'text-[var(--ui-text-dimmed)]'}"
		triggerActiveClass="text-primary-500"
	>
		{#snippet trigger()}
			<Icon name="i-lucide-menu" class="size-[22px]" />
			<span>More</span>
		{/snippet}

		{#if me}
			<a
				href="/profile"
				class="mb-1 flex items-center gap-2.5 rounded-lg px-3 py-2 transition hover:bg-[var(--interactive-hover-bg)]"
			>
				<Avatar
					pubkey={me.pk}
					name={displayName}
					picture={profiles.get(me.pk)?.picture}
					size={34}
					frame
				/>
				<span class="min-w-0">
					<span class="block truncate text-[13px] font-bold text-[var(--ui-text)]"
						>{displayName}</span
					>
					<span class="block text-[11px] text-[var(--ui-text-muted)]">View profile</span>
				</span>
			</a>

			{#if identity.accounts.length > 1}
				<MenuDivider />
				<p class="px-3 pb-1 pt-0.5 text-[11px] font-semibold text-[var(--ui-text-muted)]">
					Switch account
				</p>
				{#each identity.accounts as account (account.pk)}
					<button
						type="button"
						onclick={() => switchAccount(account.pk)}
						class="flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left transition hover:bg-[var(--interactive-hover-bg)]"
					>
						<Avatar
							pubkey={account.pk}
							name={accountName(account)}
							picture={accountPicture(account)}
							size={30}
							frame
						/>
						<span class="min-w-0 flex-1">
							<span class="block truncate text-[12.5px] font-bold text-[var(--ui-text)]">
								{accountName(account)}
							</span>
							<span
								class="block truncate font-mono text-[10.5px] text-[var(--ui-text-muted)]"
							>
								{shortKey(account.npub, 8, 5)}
							</span>
						</span>
						{#if account.active}
							<Icon name="i-lucide-check" class="size-4 shrink-0 text-primary-500" />
						{/if}
					</button>
				{/each}
			{/if}

			<MenuDivider />
		{/if}

		{#each moreItems as item (item.to)}
			<MenuItem
				href={item.to}
				icon={item.icon}
				class={isActive(item.to)
					? 'bg-primary-500/10 text-primary-600 dark:text-primary-400'
					: ''}
			>
				{item.label}
			</MenuItem>
		{/each}
	</Popover>
</nav>
