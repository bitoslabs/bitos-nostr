<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import AccountIdentityBadges from '$lib/components/ui/AccountIdentityBadges.svelte';
	import HexIcon from '$lib/components/ui/HexIcon.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import StatTile from '$lib/components/ui/StatTile.svelte';
	import QrCode from '$lib/components/ui/QrCode.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { accountSwitcher } from '$lib/stores/account-switch.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { contacts } from '$lib/nostr/contacts.svelte';
	import { relays } from '$lib/nostr/relays.svelte';
	import { wallet } from '$lib/nostr/wallet.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { confirms } from '$lib/stores/confirms.svelte';
	import { shortKey } from '$lib/utils/format';
	import { hasNip05 } from '$lib/utils/verification';

	/**
	 * Mobile "You" hub — the avatar tab in the bottom bar lands here. A calm,
	 * card-based index: profile hero with in-person identity QR, wallet strip,
	 * grouped quick tiles, account switcher, and legal/meta rows. Guests get a
	 * freedom-first sign-in card instead. Cards rise in with a short stagger
	 * (disabled under prefers-reduced-motion).
	 */

	// Keep in sync with package.json
	const APP_VERSION = '0.4.8';

	type Tile = {
		to: string;
		label: string;
		caption: string;
		icon: string;
		requiresAuth?: boolean;
	};

	// Logged-in sections (iOS-settings style grouping)
	const exploreTiles: Tile[] = [
		{
			to: '/communities',
			label: 'Communities',
			caption: 'Group chats & feeds',
			icon: 'i-lucide-users-round',
			requiresAuth: true
		},
		{ to: '/bitz', label: 'Bitz', caption: 'Short video reels', icon: 'i-lucide-circle-play' },
		{
			to: '/more/sounds',
			label: 'Trending sounds',
			caption: 'Most-used meme SFX',
			icon: 'i-lucide-audio-lines'
		}
	];
	const libraryTiles: Tile[] = [
		{
			to: '/zaps',
			label: 'Zaps',
			caption: 'Value sent & received',
			icon: 'i-lucide-zap',
			requiresAuth: true
		},
		{
			to: '/bookmarks',
			label: 'Saved',
			caption: 'Notes for later',
			icon: 'i-lucide-bookmark',
			requiresAuth: true
		}
	];
	const accountTiles: Tile[] = [
		{
			to: '/profile',
			label: 'Profile',
			caption: 'Your public identity',
			icon: 'i-lucide-user',
			requiresAuth: true
		},
		{
			to: '/settings',
			label: 'Settings',
			caption: 'Relays, keys & privacy',
			icon: 'i-lucide-settings-2',
			requiresAuth: true
		}
	];

	const meta = [
		{ to: '/about', label: 'About BitOS', icon: 'i-lucide-info' },
		{ to: '/privacy', label: 'Privacy', icon: 'i-lucide-shield-check' },
		{ to: '/terms', label: 'Terms', icon: 'i-lucide-scale' }
	];

	const me = $derived(identity.current);
	const guestTiles = $derived([...exploreTiles, ...libraryTiles, ...accountTiles]);
	const visibleGuestTiles = $derived(guestTiles.filter((tile) => me || !tile.requiresAuth));
	const myProfile = $derived(me ? (profiles.get(me.pk) ?? me.profile) : undefined);
	const displayName = $derived(myProfile?.display_name || myProfile?.name || 'You');
	const followingCount = $derived(contacts.following.length);
	const relayTotal = $derived(relays.list.length);
	const relayOnline = $derived(relays.list.filter((r) => r.status === 'ok').length);
	const walletLive = $derived(wallet.weblnEnabled && wallet.weblnBalance !== null);

	let qrOpen = $state(false);

	async function copyNpub() {
		if (!me) return;
		try {
			await navigator.clipboard.writeText(me.npub);
			toasts.success('npub copied');
		} catch {
			toasts.error('Could not copy npub');
		}
	}

	function accountName(account: (typeof identity.accounts)[number]) {
		const profile = profiles.get(account.pk) ?? account.profile;
		return profile?.display_name || profile?.name || shortKey(account.npub, 8, 6);
	}

	function accountPicture(account: (typeof identity.accounts)[number]) {
		return (profiles.get(account.pk) ?? account.profile)?.picture;
	}

	function switchAccount(pubkey: string) {
		if (identity.current?.pk === pubkey) return;
		void accountSwitcher.switchTo(pubkey);
	}

	function signOut() {
		void confirms
			.danger({
				title: 'Sign out of this account?',
				message:
					'This removes the account from this device. Make sure you backed up your nsec — it is the only way to recover your identity.',
				confirmLabel: 'Sign out'
			})
			.then((ok) => {
				if (!ok) return;
				identity.logout();
				toasts.info('Account removed from this device');
			});
	}
</script>

<svelte:head><title>{me ? 'You' : 'More'} · BitOS</title></svelte:head>

<div class="h-full overflow-y-auto">
	<PageHeader title={me ? 'You' : 'More'}>
		{#snippet subtitle()}
			{me ? 'Your account and everything else' : 'Explore the free network'}
		{/snippet}
		{#snippet actions()}
			{#if me}
				<a href="/#composer" class="icon-btn size-9" aria-label="New note">
					<Icon name="i-lucide-pen-line" class="size-[18px]" />
				</a>
				<a href="/settings" class="icon-btn size-9" aria-label="Settings">
					<Icon name="i-lucide-settings-2" class="size-[18px]" />
				</a>
			{/if}
		{/snippet}
	</PageHeader>

	<div class="mx-auto w-full max-w-[560px] px-4 pt-5 pb-10">
		{#if me}
			<!-- Profile hero — one card, everything about you -->
			<a
				href="/profile"
				class="rise group flex items-center gap-4 rounded-[var(--ui-radius)] border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] p-4 transition hover:border-primary-500/40"
				style="--d:0"
			>
				<Avatar
					pubkey={me.pk}
					name={displayName}
					picture={myProfile?.picture}
					lightning={!!(myProfile?.lud16 || myProfile?.lud06)}
					size={56}
					frame
				/>
				<span class="min-w-0 flex-1">
					<span
						class="flex items-center gap-1.5 text-[17px] leading-tight font-bold"
						title={hasNip05(myProfile) ? 'NIP-05 verified' : undefined}
					>
						<span class="truncate">{displayName}</span>
						{#if hasNip05(myProfile)}
							<Icon
								name="i-lucide-badge-check"
								class="size-4 shrink-0 text-[var(--tone-success-text)]"
							/>
						{/if}
					</span>
					<span class="mt-1 block truncate font-mono text-[11.5px] text-[var(--ui-text-muted)]">
						{shortKey(me.npub, 12, 8)}
					</span>
					<span
						class="mt-1 block text-[12px] font-medium text-primary-500 opacity-80 transition group-hover:opacity-100"
					>
						View profile
					</span>
				</span>
				<Icon
					name="i-lucide-chevron-right"
					class="size-5 shrink-0 text-[var(--ui-text-dimmed)] transition group-hover:translate-x-0.5"
				/>
			</a>

			<!-- Identity: copy, in-person QR, key backup -->
			<div class="rise mt-2 grid grid-cols-3 gap-2" style="--d:1">
				<button
					type="button"
					onclick={copyNpub}
					class="flex flex-col items-center justify-center gap-1.5 rounded-[var(--ui-radius-sm)] border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-2 py-2.5 text-[11.5px] font-semibold text-[var(--ui-text-muted)] transition hover:border-primary-500/40 hover:text-[var(--ui-text)]"
				>
					<Icon name="i-lucide-fingerprint" class="size-[18px]" />
					Copy npub
				</button>
				<button
					type="button"
					onclick={() => (qrOpen = true)}
					class="flex flex-col items-center justify-center gap-1.5 rounded-[var(--ui-radius-sm)] border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-2 py-2.5 text-[11.5px] font-semibold text-[var(--ui-text-muted)] transition hover:border-primary-500/40 hover:text-[var(--ui-text)]"
				>
					<Icon name="i-lucide-qr-code" class="size-[18px]" />
					Identity QR
				</button>
				<a
					href="/settings/security"
					class="flex flex-col items-center justify-center gap-1.5 rounded-[var(--ui-radius-sm)] border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-2 py-2.5 text-[11.5px] font-semibold text-[var(--ui-text-muted)] transition hover:border-primary-500/40 hover:text-[var(--ui-text)]"
				>
					<Icon name="i-lucide-key-round" class="size-[18px]" />
					Backup key
				</a>
			</div>

			<!-- Stats -->
			<div class="rise mt-2 grid grid-cols-3 gap-2" style="--d:2">
				<StatTile label="Following" value={followingCount} center />
				<StatTile
					label="Relays"
					value="{relayOnline}/{relayTotal}"
					caption="online"
					tone={relayOnline > 0 ? 'success' : 'warm'}
					center
				/>
				<StatTile label="Accounts" value={identity.accounts.length} caption="on device" center />
			</div>

			<!-- Wallet strip: live balance when connected, connect CTA when not -->
			<a
				href="/zaps"
				class="rise mt-2 flex items-center gap-3 rounded-[var(--ui-radius)] border p-3.5 transition {walletLive
					? 'border-[color-mix(in_oklab,var(--ui-color-primary-500)_22%,transparent)] bg-[linear-gradient(135deg,color-mix(in_oklab,var(--ui-color-primary-500)_10%,transparent),color-mix(in_oklab,var(--color-warm-500)_5%,transparent))]'
					: 'border-[var(--ui-border-muted)] bg-[var(--surface-bg)] hover:border-primary-500/40'}"
				style="--d:3"
			>
				<span
					class="hex-clip grid size-9 shrink-0 place-items-center rounded-[var(--ui-radius-sm)] {walletLive
						? 'bg-warm-500/15 text-warm-500'
						: 'bg-primary-500/10 text-primary-500'}"
				>
					<Icon name="i-lucide-zap" class="size-[18px]" />
				</span>
				{#if walletLive}
					<span class="min-w-0 flex-1">
						<span class="block font-mono text-[15px] font-semibold">
							{wallet.weblnBalance?.toLocaleString()}
							<span class="text-[11px] text-primary-500">sats</span>
						</span>
						<span class="block text-[11px] text-[var(--ui-text-muted)]">
							Wallet connected · spendable now
						</span>
					</span>
				{:else}
					<span class="min-w-0 flex-1">
						<span class="block text-[13px] font-bold">Connect a Lightning wallet</span>
						<span class="block text-[11.5px] text-[var(--ui-text-muted)]">
							Send value to anyone on the network
						</span>
					</span>
					<Icon
						name="i-lucide-chevron-right"
						class="size-4 shrink-0 text-[var(--ui-text-dimmed)]"
					/>
				{/if}
			</a>

			<!-- Explore -->
			<p
				class="rise mt-5 px-1 text-[11px] font-bold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
				style="--d:4"
			>
				Explore
			</p>
			<div class="rise mt-1.5 grid grid-cols-2 gap-2.5" style="--d:5">
				{#each exploreTiles as tile (tile.to)}
					<a
						href={tile.to}
						class="group flex items-center gap-3.5 rounded-[var(--ui-radius)] border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] p-3.5 transition hover:border-primary-500/40 hover:bg-[var(--interactive-hover-bg)]"
					>
						<HexIcon icon={tile.icon} size="40" iconClass="size-5" interactive />
						<span class="min-w-0">
							<span class="block text-[13.5px] font-bold">{tile.label}</span>
							<span class="mt-0.5 block truncate text-[11.5px] text-[var(--ui-text-muted)]">
								{tile.caption}
							</span>
						</span>
					</a>
				{/each}
			</div>

			<!-- Library -->
			<p
				class="rise mt-5 px-1 text-[11px] font-bold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
				style="--d:6"
			>
				Your library
			</p>
			<div class="rise mt-1.5 grid grid-cols-2 gap-2.5" style="--d:7">
				{#each libraryTiles as tile (tile.to)}
					<a
						href={tile.to}
						class="group flex items-center gap-3.5 rounded-[var(--ui-radius)] border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] p-3.5 transition hover:border-primary-500/40 hover:bg-[var(--interactive-hover-bg)]"
					>
						<HexIcon icon={tile.icon} size="40" iconClass="size-5" interactive />
						<span class="min-w-0">
							<span class="block text-[13.5px] font-bold">{tile.label}</span>
							<span class="mt-0.5 block truncate text-[11.5px] text-[var(--ui-text-muted)]">
								{tile.caption}
							</span>
						</span>
					</a>
				{/each}
			</div>

			<!-- Account -->
			<p
				class="rise mt-5 px-1 text-[11px] font-bold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
				style="--d:8"
			>
				Account
			</p>
			<div class="rise mt-1.5 grid grid-cols-2 gap-2.5" style="--d:9">
				{#each accountTiles as tile (tile.to)}
					<a
						href={tile.to}
						class="group flex items-center gap-3.5 rounded-[var(--ui-radius)] border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] p-3.5 transition hover:border-primary-500/40 hover:bg-[var(--interactive-hover-bg)]"
					>
						<HexIcon icon={tile.icon} size={40} iconClass="size-5" interactive />
						<span class="min-w-0">
							<span class="block text-[13.5px] font-bold">{tile.label}</span>
							<span class="mt-0.5 block truncate text-[11.5px] text-[var(--ui-text-muted)]">
								{tile.caption}
							</span>
						</span>
					</a>
				{/each}
			</div>

			<!-- Switch account -->
			{#if identity.accounts.length > 1}
				<section
					class="rise mt-5 overflow-hidden rounded-[var(--ui-radius)] border border-[var(--ui-border-muted)] bg-[var(--surface-bg)]"
					style="--d:10"
				>
					<header class="premium-widget-header">
						<h2 class="text-[var(--ui-text)]">Accounts on this device</h2>
					</header>
					<div class="p-1.5">
						{#each identity.accounts as account (account.pk)}
							<button
								type="button"
								onclick={() => switchAccount(account.pk)}
								class="flex w-full items-center gap-3 rounded-[var(--ui-radius-sm)] px-2.5 py-2 text-left transition hover:bg-[var(--interactive-hover-bg)]"
							>
								<Avatar
									pubkey={account.pk}
									name={accountName(account)}
									picture={accountPicture(account)}
									lightning={!!(
										(profiles.get(account.pk) ?? account.profile)?.lud16 ||
										(profiles.get(account.pk) ?? account.profile)?.lud06
									)}
									size={34}
									frame
								/>
								<span class="min-w-0 flex-1">
									<span class="flex items-center gap-1 text-[13px] font-bold text-[var(--ui-text)]">
										<span class="truncate">{accountName(account)}</span>
									<AccountIdentityBadges
										profile={profiles.get(account.pk) ?? account.profile}
										showLightning={false}
									/>
									</span>
									<span class="block truncate font-mono text-[10.5px] text-[var(--ui-text-muted)]">
										{profiles.get(account.pk)?.nip05?.trim() || shortKey(account.npub, 8, 5)}
									</span>
								</span>
								{#if account.active}
									<span
										class="flex items-center gap-1 text-[10.5px] font-bold text-primary-500 uppercase"
									>
										<Icon name="i-lucide-check" class="size-3.5" />
										Active
									</span>
								{:else}
									<Icon
										name="i-lucide-arrow-left-right"
										class="size-4 text-[var(--ui-text-dimmed)]"
									/>
								{/if}
							</button>
						{/each}
					</div>
				</section>
			{/if}
		{:else}
			<!-- Guest: freedom-first sign-in card -->
			<section
				class="rise overflow-hidden rounded-[var(--ui-radius)] border border-[color-mix(in_oklab,var(--ui-color-primary-500)_22%,transparent)] bg-[linear-gradient(140deg,color-mix(in_oklab,var(--ui-color-primary-500)_9%,transparent),transparent_60%)] p-6 text-center"
				style="--d:0"
			>
				<div class="mx-auto grid size-14 place-items-center">
					<Avatar pubkey="bitos" name="BitOS" size={56} frame />
				</div>
				<h2 class="mt-4 text-[19px] font-bold tracking-tight">Own your social identity</h2>
				<p
					class="mx-auto mt-2 max-w-[380px] text-[13.5px] leading-relaxed text-[var(--ui-text-muted)]"
				>
					No phone number. No algorithm. One key that is yours — follow who you want, zap value
					across the network, and take your graph anywhere.
				</p>
				<a
					href="/welcome"
					class="mt-5 inline-flex items-center justify-center gap-2 rounded-full bg-primary-500 px-6 py-2.5 text-[13.5px] font-bold text-white shadow-[var(--glow-primary)] transition hover:-translate-y-0.5 hover:brightness-110"
				>
					<Icon name="i-lucide-key-round" class="size-4" />
					Create or import a key
				</a>
				<p
					class="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-[var(--ui-text-dimmed)]"
				>
					<Icon name="i-lucide-lock" class="size-3.5" />
					Your keys never leave this device
				</p>
			</section>

			<!-- Guests can still browse these -->
			<div class="rise mt-5 grid grid-cols-2 gap-2.5" style="--d:1">
				{#each visibleGuestTiles as tile (tile.to)}
					<a
						href={tile.to}
						class="group flex items-center gap-3.5 rounded-[var(--ui-radius)] border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] p-3.5 transition hover:border-primary-500/40 hover:bg-[var(--interactive-hover-bg)]"
					>
						<HexIcon icon={tile.icon} size="40" iconClass="size-5" interactive />
						<span class="min-w-0">
							<span class="block text-[13.5px] font-bold">{tile.label}</span>
							<span class="mt-0.5 block truncate text-[11.5px] text-[var(--ui-text-muted)]">
								{tile.caption}
							</span>
						</span>
					</a>
				{/each}
			</div>
		{/if}

		<!-- Meta / legal -->
		<nav
			class="rise mt-5 overflow-hidden rounded-[var(--ui-radius)] border border-[var(--ui-border-muted)] bg-[var(--surface-bg)]"
			aria-label="About BitOS"
			style="--d:11"
		>
			{#each meta as item, i (item.to)}
				<a
					href={item.to}
					class="flex items-center gap-3 px-4 py-3 text-[13px] font-semibold text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)] {i >
					0
						? 'border-t border-[var(--ui-border-muted)]'
						: ''}"
				>
					<!-- Same hex border treatment as the tiles above -->
					<HexIcon icon={item.icon} size="32" iconClass="size-[15px]" />
					{item.label}
					<Icon
						name="i-lucide-chevron-right"
						class="ml-auto size-4 shrink-0 text-[var(--ui-text-dimmed)]"
					/>
				</a>
			{/each}
			<a
				href="/about"
				class="flex items-center gap-3 border-t border-[var(--ui-border-muted)] px-4 py-3 text-[13px] font-semibold text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
			>
				<HexIcon icon="i-lucide-git-branch" size="32" iconClass="size-[15px]" />
				Version
				<span class="ml-auto font-mono text-[11.5px] text-[var(--ui-text-dimmed)]">
					v{APP_VERSION}
				</span>
			</a>
		</nav>

		{#if me}
			<button
				type="button"
				onclick={signOut}
				class="rise mt-4 flex w-full items-center justify-center gap-2 rounded-[var(--ui-radius)] border border-[var(--ui-border-muted)] px-4 py-3 text-[13px] font-bold text-[var(--tone-error-text)] transition hover:border-red-500/40 hover:bg-red-500/5 hover:text-red-500"
				style="--d:12"
			>
				<Icon name="i-lucide-log-out" class="size-4" />
				Sign out
			</button>
		{/if}

		<p class="mt-6 text-center text-[11px] text-[var(--ui-text-dimmed)]">
			BitOS · a free and open Nostr client
		</p>
	</div>
</div>

<!-- Identity QR — scan-to-follow in person -->
<Dialog bind:open={qrOpen} title="Your identity">
	{#if me}
		<div class="p-5 pt-2 text-center">
			<p class="text-[13px] text-[var(--ui-text-muted)]">
				Scan with any Nostr app to find <strong class="text-[var(--ui-text)]">{displayName}</strong>
			</p>
			<div class="mt-4 flex justify-center">
				<QrCode
					value={`nostr:${me.npub}`}
					theme="matrix"
					label="Your Nostr profile QR"
					size={250}
				/>
			</div>
			<p
				class="mx-auto mt-4 max-w-[300px] font-mono text-[10.5px] break-all text-[var(--ui-text-dimmed)]"
			>
				{me.npub}
			</p>
			<button
				type="button"
				onclick={copyNpub}
				class="mt-4 inline-flex items-center gap-2 rounded-full border border-[var(--ui-border-muted)] px-5 py-2 text-[12.5px] font-bold text-[var(--ui-text-muted)] transition hover:border-primary-500/40 hover:text-[var(--ui-text)]"
			>
				<Icon name="i-lucide-copy" class="size-4" />
				Copy npub
			</button>
		</div>
	{/if}
</Dialog>

<style>
	.rise {
		animation: more-rise 0.35s cubic-bezier(0.22, 1, 0.36, 1) both;
		animation-delay: calc(var(--d, 0) * 45ms);
	}
	@keyframes more-rise {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.rise {
			animation: none;
		}
	}
</style>
