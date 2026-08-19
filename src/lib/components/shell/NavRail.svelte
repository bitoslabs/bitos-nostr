<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Logo from '$lib/components/ui/Logo.svelte';
	import HexMark from '$lib/components/ui/HexMark.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { dms } from '$lib/nostr/dms.svelte';
	import { nip29 } from '$lib/nostr/groups.svelte';
	import { notifications } from '$lib/nostr/notifications.svelte';
	import { popovers } from '$lib/stores/popovers.svelte';
	import { privacyNotificationSettings } from '$lib/stores/privacy-notification-settings.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { shortKey } from '$lib/utils/format';
	import { hasNip05 } from '$lib/utils/verification';

	// Full section list. Guests see every item; `requiresAuth` items render
	// locked (not clickable) until login.
	const nav = [
		{ to: '/', label: 'Home', icon: 'i-lucide-house' },
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
		{
			to: '/communities',
			label: 'Communities',
			icon: 'i-lucide-users-round',
			communities: true,
			requiresAuth: true
		},
		{ to: '/zaps', label: 'Zaps', icon: 'i-lucide-zap', requiresAuth: true },
		{ to: '/bookmarks', label: 'Bookmarks', icon: 'i-lucide-bookmark', requiresAuth: true },
		{ to: '/profile', label: 'Profile', icon: 'i-lucide-user', requiresAuth: true },
		{ to: '/settings', label: 'Settings', icon: 'i-lucide-settings-2', requiresAuth: true }
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
	const communitiesUnread = $derived(nip29.groups.reduce((sum, g) => sum + g.unread, 0));
	const accountMenuId = 'nav-account-switcher';
	const accountMenuOpen = $derived(popovers.isOpen(accountMenuId));
	let accountButton = $state<HTMLButtonElement | null>(null);
	let accountMenuPosition = $state({ left: 12, bottom: 12 });

	function positionAccountMenu() {
		if (!accountButton) return;
		const rect = accountButton.getBoundingClientRect();
		accountMenuPosition = {
			left: Math.max(12, Math.min(rect.right + 12, window.innerWidth - 268)),
			bottom: Math.max(12, window.innerHeight - rect.bottom)
		};
	}

	function portal(node: HTMLElement) {
		if (!browser) return;
		document.body.appendChild(node);
		return {
			destroy() {
				node.remove();
			}
		};
	}

	$effect(() => {
		if (!accountMenuOpen || !browser) return;
		positionAccountMenu();
		window.addEventListener('resize', positionAccountMenu);
		window.addEventListener('scroll', positionAccountMenu, true);
		return () => {
			window.removeEventListener('resize', positionAccountMenu);
			window.removeEventListener('scroll', positionAccountMenu, true);
		};
	});

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

	function focusComposer(event: MouseEvent) {
		// A repeat click on /#composer does not emit `hashchange`, so explicitly
		// notify the mounted composer when the user is already on the home feed.
		if (page.url.pathname !== '/') return;
		event.preventDefault();
		if (window.location.hash !== '#composer') window.history.pushState(null, '', '#composer');
		window.dispatchEvent(new CustomEvent('bitos:focus-composer'));
	}

	// --- Short-viewport handling ------------------------------------------------
	// The section list scrolls on its own when the rail is taller than the
	// viewport (small screen heights), and the active section is auto-scrolled
	// into view so the user never loses track of where they are.
	let navList = $state<HTMLDivElement | null>(null);

	function revealActiveItem() {
		const list = navList;
		if (!browser || !list || list.scrollHeight <= list.clientHeight) return;
		const active = list.querySelector<HTMLElement>('[aria-current="page"]');
		if (!active) return;
		const listRect = list.getBoundingClientRect();
		const itemRect = active.getBoundingClientRect();
		const pad = 12;
		if (itemRect.top < listRect.top + pad) {
			list.scrollTop += itemRect.top - listRect.top - pad;
		} else if (itemRect.bottom > listRect.bottom - pad) {
			list.scrollTop += itemRect.bottom - listRect.bottom + pad;
		}
	}

	$effect(() => {
		// Re-run on route changes and when auth toggles footer widgets; resize
		// covers viewport-height changes while dragging the window.
		void page.url.pathname;
		void me;
		if (!browser) return;
		revealActiveItem();
		window.addEventListener('resize', revealActiveItem);
		return () => window.removeEventListener('resize', revealActiveItem);
	});
</script>

<nav class="ui4-nav flex h-full flex-col p-3.5">
	<!-- Brand -->
	<a
		href="/"
		aria-label="BitOS home"
		class="ui4-nav-brand mb-4 flex shrink-0 items-center gap-2.5 px-3 transition-opacity hover:opacity-85"
	>
		<Logo height={28} />
	</a>

	<!-- Sections: independently scrollable on short viewports (see .ui4-nav-list). -->
	<div
		bind:this={navList}
		class="ui4-nav-list flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain pl-3"
	>
		{#each nav as item (item.to)}
			{@const active = isActive(item.to)}
			{@const locked = !me && item.requiresAuth}
			{#if locked}
				<!-- Guest: section stays visible but cannot be accessed without a key. -->
				<div
					class="ui4-nav-row relative flex cursor-not-allowed items-center gap-4 rounded-xl px-4 py-3 text-[17px] font-medium opacity-55 select-none"
					aria-disabled="true"
					title="Sign in to unlock {item.label}"
				>
					<span class="shrink-0">
						<Icon name={item.icon} class="size-5 text-[var(--ui-text-dimmed)]" />
					</span>
					<span class="flex-1 text-[var(--ui-text-muted)]">{item.label}</span>
					<Icon
						name="i-lucide-lock"
						class="size-3.5 shrink-0 text-[var(--ui-text-dimmed)]"
						title="Login required"
					/>
				</div>
			{:else}
				<a
					href={item.to}
					class="ui4-nav-item ui4-nav-row group relative flex items-center gap-4 rounded-xl px-4 py-3 text-[17px] font-medium transition-all"
					aria-label={item.label}
					aria-current={active ? 'page' : undefined}
				>
					<span class="relative z-10 grid shrink-0 place-items-center">
						<!-- Active marker — the hex system design: borderless gradient hex
					     glow behind the icon (a separate clipped layer, so the unread
					     badge can never be clipped) + primary label. No background pill
					     — the hex is the active state. -->
						{#if active}
							<span
								class="hex-clip absolute -inset-[7px] bg-gradient-to-br from-primary-500/25 to-warm-500/20"
								aria-hidden="true"
							></span>
						{/if}
						<Icon
							name={item.icon}
							class="relative size-5 transition-transform {active
								? 'scale-105 text-primary-500 dark:text-primary-500'
								: 'text-[var(--ui-text-muted)] group-hover:text-primary-500'}"
						/>
						{#if (item.badge && unread > 0) || (item.notifications && notificationUnread > 0) || (item.communities && communitiesUnread > 0)}
							<span
								class="absolute -top-2.5 -right-3 z-30 grid min-w-[1.2rem] place-items-center rounded-full bg-warm-500 px-1 py-[1px] text-[9px] leading-none font-extrabold text-white shadow-[var(--glow-primary)] ring-2 ring-[var(--surface-bg)]"
								>{item.notifications
									? notificationUnread > 9
										? '9+'
										: notificationUnread
									: item.communities
										? communitiesUnread > 9
											? '9+'
											: communitiesUnread
										: unread > 9
											? '9+'
											: unread}</span
							>
						{/if}
					</span>
					<span
						class="relative z-10 flex-1 {active
							? 'font-semibold text-primary-500 dark:text-primary-500'
							: ''}">{item.label}</span
					>
				</a>
			{/if}
		{/each}
	</div>

	{#if me}
		<div class="ui4-nav-cta shrink-0 px-2 pb-1">
			<a
				href="/#composer"
				onclick={focusComposer}
				class="ui4-compose flex items-center justify-center gap-2 rounded-full py-2.5 font-semibold transition-all"
			>
				<Icon name="i-lucide-pen-line" class="size-4" />
				<span>New Note</span>
			</a>
		</div>
	{/if}

	<div class="flex shrink-0 flex-col gap-2">
		{#if me}
			<div class="relative">
				<button
					bind:this={accountButton}
					type="button"
					onclick={(event) => {
						event.stopPropagation();
						positionAccountMenu();
						popovers.toggle(accountMenuId);
					}}
					class="ui4-account relative w-full overflow-hidden rounded-xl p-2.5 text-left transition-all hover:bg-[var(--interactive-hover-bg)]"
					aria-label="Account menu"
					aria-expanded={accountMenuOpen}
				>
					<div class="flex items-center gap-2.5">
						<Avatar
							pubkey={me.pk}
							name={displayName}
							picture={myProfile?.picture}
							verified={hasNip05(myProfile)}
							size={44}
							frame
						/>
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
						use:portal
						class="fixed z-[60] w-64 rounded-2xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] p-2 shadow-[var(--shadow-pop)]"
						style:left={`${accountMenuPosition.left}px`}
						style:bottom={`${accountMenuPosition.bottom}px`}
					>
						<a
							href="/profile"
							onclick={() => popovers.close()}
							class="mb-1 flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-[var(--interactive-hover-bg)]"
						>
							<Avatar
								pubkey={me.pk}
								name={displayName}
								picture={myProfile?.picture}
								verified={hasNip05(myProfile)}
								size={34}
								frame
							/>
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
										verified={hasNip05(profiles.get(account.pk) ?? account.profile)}
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
			<!-- Guest: full login card with help text (replaces icon-only button). -->
			<div class="px-2">
				<div
					class="rounded-2xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] p-3.5"
				>
					<div class="flex items-center gap-2.5">
						<!-- BitOS brand hex badge (HexMark) -->
						<HexMark size={36} class="rounded-[22%]" />
						<p class="text-[13px] leading-snug font-bold">Sign in to unlock everything</p>
					</div>
					<p class="mt-2 text-[11.5px] leading-relaxed text-[var(--ui-text-muted)]">
						Create or import your Nostr key to access chats, notifications, zaps, bookmarks, and
						settings.
					</p>
					<a
						href="/welcome"
						class="ui4-compose mt-3 flex items-center justify-center gap-2 rounded-full py-2.5 text-[13px] font-semibold"
						aria-label="Login — create or import a key"
					>
						<img src="/bitos-lightning-bolt.svg" alt="" draggable="false" class="h-4 w-auto" />
						<span>Login</span>
					</a>
				</div>
			</div>
		{/if}
	</div>
</nav>

<style>
	.ui4-nav-item {
		color: var(--ui-text-muted);
	}
	.ui4-nav-item:hover {
		color: var(--ui-text);
	}
	/* Section list: thin, unobtrusive scrollbar — only visible while it can scroll. */
	.ui4-nav-list {
		scrollbar-width: thin;
		scrollbar-color: color-mix(in oklab, var(--ui-text-muted) 32%, transparent) transparent;
	}
	.ui4-nav-list::-webkit-scrollbar {
		width: 5px;
	}
	.ui4-nav-list::-webkit-scrollbar-track {
		background: transparent;
	}
	.ui4-nav-list::-webkit-scrollbar-thumb {
		border-radius: 9999px;
		background: color-mix(in oklab, var(--ui-text-muted) 32%, transparent);
	}
	/* Compact rhythm on short viewports: tighten paddings so the full section
	   list usually fits without scrolling at all. */
	@media (max-height: 780px) {
		.ui4-nav-brand {
			margin-bottom: 0.625rem;
		}
		.ui4-nav-row {
			padding-block: 0.5rem;
		}
		.ui4-nav-cta {
			padding-block: 0.125rem;
		}
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
