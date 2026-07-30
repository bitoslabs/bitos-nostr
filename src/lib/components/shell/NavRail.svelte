<script lang="ts">
	import { page } from '$app/state';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { dms } from '$lib/nostr/dms.svelte';
	import { notifications } from '$lib/nostr/notifications.svelte';
	import { popovers } from '$lib/stores/popovers.svelte';
	import { privacyNotificationSettings } from '$lib/stores/privacy-notification-settings.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { shortKey } from '$lib/utils/format';

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
	const accountMenuId = 'nav-account-switcher';
	const accountMenuOpen = $derived(popovers.isOpen(accountMenuId));

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
			<div class="relative">
				<button
					type="button"
					onclick={(event) => {
						event.stopPropagation();
						popovers.toggle(accountMenuId);
					}}
					class="relative size-11 overflow-hidden mask-squircle ring-2 ring-primary-500/30 transition-all hover:ring-primary-500"
					aria-label="Account menu"
					aria-expanded={accountMenuOpen}
				>
					<Avatar pubkey={me.pk} name={displayName} picture={myProfile?.picture} size={44} />
				</button>
				{#if accountMenuOpen}
					<div
						class="absolute bottom-0 left-[calc(100%+12px)] z-50 w-64 rounded-2xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] p-2 shadow-[var(--shadow-pop)]"
					>
						<a
							href="/profile"
							onclick={() => popovers.close()}
							class="mb-1 flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-[var(--interactive-hover-bg)]"
						>
							<Avatar pubkey={me.pk} name={displayName} picture={myProfile?.picture} size={34} />
							<span class="min-w-0">
								<span class="block truncate text-[13px] font-bold text-[var(--ui-text)]">
									{displayName}
								</span>
								<span class="block text-[11px] text-[var(--ui-text-muted)]">View profile</span>
							</span>
						</a>
						{#if identity.accounts.length > 1}
							<div class="my-1 h-px bg-[var(--ui-border-muted)]"></div>
							<p class="px-2 py-1 text-[10.5px] font-bold text-[var(--ui-text-dimmed)] uppercase">
								Switch account
							</p>
							{#each identity.accounts as account (account.pk)}
								<button
									type="button"
									onclick={() => switchAccount(account.pk)}
									disabled={account.active}
									class="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left transition hover:bg-[var(--interactive-hover-bg)] disabled:cursor-default disabled:opacity-70 disabled:hover:bg-transparent"
								>
									<Avatar
										pubkey={account.pk}
										name={accountName(account)}
										picture={accountPicture(account)}
										size={30}
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
						<div class="my-1 h-px bg-[var(--ui-border-muted)]"></div>
						<a
							href="/settings/account"
							onclick={() => popovers.close()}
							class="flex items-center gap-2 rounded-xl px-2 py-2 text-[12.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
						>
							<Icon name="i-lucide-user-plus" class="size-4" />
							Manage accounts
						</a>
					</div>
				{/if}
			</div>
		{/if}
	</div>
</nav>
