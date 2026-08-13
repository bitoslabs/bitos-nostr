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
		{
			to: '/messages',
			label: 'Chats',
			icon: 'i-lucide-message-circle-more',
			badge: true,
			requiresAuth: true
		},
		{
			to: '/notifications',
			label: 'Notifications',
			icon: 'i-lucide-bell',
			notifications: true,
			requiresAuth: true
		},
		{ to: '/bits', label: 'Bits', icon: 'i-lucide-circle-play' },
		{ to: '/discover', label: 'Discover', icon: 'i-lucide-compass' },
		{ to: '/bookmarks', label: 'Bookmarks', icon: 'i-lucide-bookmark', requiresAuth: true },
		{ to: '/profile', label: 'Profile', icon: 'i-lucide-user', requiresAuth: true },
		{ to: '/settings', label: 'Settings', icon: 'i-lucide-settings-2', requiresAuth: true }
	];

	function isActive(to: string) {
		const path = page.url.pathname;
		return to === '/' ? path === '/' : path.startsWith(to);
	}

	const me = $derived(identity.current);
	const visibleNav = $derived(nav.filter((item) => me || !item.requiresAuth));
	const myProfile = $derived(me ? profiles.get(me.pk) : undefined);
	const displayName = $derived(myProfile?.display_name || myProfile?.name || 'You');
	const unread = $derived(privacyNotificationSettings.state.dms ? dms.unreadCount : 0);
	const notificationUnread = $derived(notifications.unreadCount);
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

<nav class="ui4-nav flex h-full flex-col p-3.5">
	<!-- Brand -->
	<a
		href="/"
		aria-label="BitOS home"
		class="ui4-brand mb-6 flex items-center gap-2.5 px-3 pt-2 transition-opacity hover:opacity-85"
	>
		<span class="ui4-brand-mark grid size-7 place-items-center">⚡</span>
		<span class="ui4-brand-name">nostr</span>
	</a>

	<div class="flex flex-1 flex-col gap-1 pl-3">
		{#each visibleNav as item (item.to)}
			{@const active = isActive(item.to)}
			<a
				href={item.to}
				class="ui4-nav-item group relative flex items-center gap-4 rounded-xl px-4 py-3 text-[17px] font-medium transition-all"
				aria-label={item.label}
				aria-current={active ? 'page' : undefined}
			>
				<span
					class="ui4-nav-surface absolute inset-0 rounded-xl transition-all {active
						? 'is-active'
						: ''}"
					aria-hidden="true"
				></span>
				{#if active}
					<span
						class="absolute left-0 z-10 h-7 w-1 rounded-r-full bg-primary-500 shadow-[var(--glow-primary)]"
						aria-hidden="true"
					></span>
				{/if}
				<Icon
					name={item.icon}
					class="relative z-10 size-5 shrink-0 transition-transform {active
						? 'scale-105 text-primary-500 dark:text-primary-300'
						: 'text-[var(--ui-text-muted)] group-hover:text-primary-500'}"
				/>
				<span class="relative z-10">{item.label}</span>
				{#if (item.badge && unread > 0) || (item.notifications && notificationUnread > 0)}
					<span
						class="absolute -top-1.5 -right-1.5 z-30 grid min-w-[1.2rem] place-items-center rounded-full bg-warm-500 px-1 py-[1px] text-[9px] leading-none font-extrabold text-white shadow-[var(--glow-primary)] ring-2 ring-[var(--surface-bg)]"
						>{item.notifications
							? notificationUnread > 9
								? '9+'
								: notificationUnread
							: unread > 9
								? '9+'
								: unread}</span
					>
				{/if}
			</a>
		{/each}
	</div>

	{#if me}
		<div class="px-2 pb-1">
			<a
				href="/"
				class="ui4-compose flex items-center justify-center gap-2 rounded-full py-2.5 font-semibold transition-all"
			>
				<Icon name="i-lucide-pen-line" class="size-4" />
				<span>New Note</span>
			</a>
		</div>
	{/if}

	<div class="flex flex-col gap-2">
		{#if me}
			<div class="relative">
				<button
					type="button"
					onclick={(event) => {
						event.stopPropagation();
						popovers.toggle(accountMenuId);
					}}
					class="ui4-account relative w-full overflow-hidden rounded-xl p-2.5 text-left transition-all hover:bg-[var(--interactive-hover-bg)]"
					aria-label="Account menu"
					aria-expanded={accountMenuOpen}
				>
					<div class="flex items-center gap-2.5">
						<Avatar pubkey={me.pk} name={displayName} picture={myProfile?.picture} size={44} />
						<span class="min-w-0 flex-1">
							<span class="block truncate text-sm font-semibold">{displayName}</span>
							<span class="block truncate font-mono text-[11px] text-[var(--ui-text-muted)]"
								>{shortKey(me.pk, 8, 5)}</span
							>
						</span>
						<Icon name="i-lucide-ellipsis" class="size-4 text-[var(--ui-text-muted)]" />
					</div>
				</button>
				{#if accountMenuOpen}
					<div
						class="absolute right-0 bottom-0 z-50 w-64 rounded-2xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] p-2 shadow-[var(--shadow-pop)]"
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
		{:else}
			<a
				href="/welcome"
				class="grid size-12 place-items-center rounded-xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] text-primary-500 transition hover:border-primary-500/30 hover:bg-primary-500/10"
				aria-label="Create or import a key"
			>
				<Icon name="i-lucide-log-in" class="size-[18px]" />
			</a>
		{/if}
	</div>
</nav>

<style>
	.ui4-brand-mark {
		clip-path: polygon(25% 5%, 75% 5%, 100% 50%, 75% 95%, 25% 95%, 0% 50%);
		background: linear-gradient(135deg, var(--ui-color-primary-500), var(--color-warm-500));
		color: #050507;
		font-size: 13px;
		font-weight: 800;
	}
	.ui4-brand-name {
		background: linear-gradient(135deg, var(--ui-color-primary-500), var(--color-warm-500));
		background-clip: text;
		color: transparent;
		font-size: 1.5rem;
		font-weight: 700;
		letter-spacing: -0.025em;
	}
	.ui4-nav-item {
		color: var(--ui-text-muted);
	}
	.ui4-nav-item:hover {
		color: var(--ui-text);
	}
	.ui4-nav-surface {
		z-index: 0;
	}
	.ui4-nav-surface.is-active {
		background: color-mix(in oklab, var(--ui-color-primary-500) 12%, transparent);
	}
	.ui4-account :global(.mask-squircle) {
		clip-path: polygon(25% 5%, 75% 5%, 100% 50%, 75% 95%, 25% 95%, 0% 50%);
	}
	.ui4-compose {
		background: var(--ui-color-primary-500);
		color: #ffffff;
		box-shadow: var(--glow-primary);
	}
	:global(.dark) .ui4-compose {
		color: #050507;
	}
	.ui4-compose:hover {
		transform: translateY(-1px);
		box-shadow: 0 0 28px color-mix(in oklab, var(--ui-color-primary-500) 45%, transparent);
	}
	.ui4-compose:active {
		transform: translateY(0);
	}
</style>
