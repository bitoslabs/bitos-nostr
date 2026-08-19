<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { finalizeEvent } from 'nostr-tools/pure';
	import SectionCard from '$lib/components/settings/SectionCard.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import AppearanceSettings from '$lib/components/settings/AppearanceSettings.svelte';
	import AlgorithmSettings from '$lib/components/settings/AlgorithmSettings.svelte';
	import MediaSettings from '$lib/components/settings/MediaSettings.svelte';
	import PrivacyNotificationSettings from '$lib/components/settings/PrivacyNotificationSettings.svelte';
	import SecuritySettings from '$lib/components/settings/SecuritySettings.svelte';
	import LightningSettings from '$lib/components/settings/LightningSettings.svelte';
	import SupportSettings from '$lib/components/settings/SupportSettings.svelte';
	import {
		isSettingsSectionKey,
		settingsSections,
		mobileSettingsGroups
	} from '$lib/settings/sections';
	import { media, providerLabel } from '$lib/stores/media.svelte';
	import type { MediaProviderId } from '$lib/media/uploaders';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { publish } from '$lib/nostr/pool';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { confirms } from '$lib/stores/confirms.svelte';
	import { shortKey } from '$lib/utils/format';
	import { hexToBytes } from '$lib/nostr/hex';
	import type { AccountSummary } from '$lib/nostr/identity.svelte';

	const me = $derived(identity.current);
	const myProfile = $derived(me ? (profiles.get(me.pk) ?? me.profile) : undefined);

	onMount(() => {
		const pubkeys = identity.accounts.map((account) => account.pk);
		if (!pubkeys.length) return;
		void profiles.refresh(pubkeys).then(() => {
			for (const pubkey of pubkeys) {
				const profile = profiles.get(pubkey);
				if (profile) identity.updateAccountProfile(pubkey, profile);
			}
		});
	});

	const section = $derived(
		isSettingsSectionKey(page.params.section) ? page.params.section : 'account'
	);
	const sections = settingsSections;
	const mobileGroups = mobileSettingsGroups();
	/** On mobile, the root `/settings` route shows the iOS index instead of content. */
	const mobileIndex = $derived(!page.params.section);
	/** Shared Tailwind class string for the sticky iOS-style nav bar (used twice). */
	const iosNavBar =
		'sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-[var(--ui-border-muted)] bg-[color-mix(in_oklab,var(--surface-bg)_88%,transparent)] px-3 pt-[calc(0.625rem+env(safe-area-inset-top))] pb-2.5 backdrop-blur-xl backdrop-saturate-150';
	const sectionTitle = $derived(
		settingsSections.find((item) => item.key === section)?.label ?? 'Settings'
	);

	// --- account / profile ---
	let editingUsername = $state('');
	let editingDisplayName = $state('');
	let editingAbout = $state('');
	let editingPicture = $state('');
	let editingBanner = $state('');
	let editingWebsite = $state('');
	let editingNip05 = $state('');
	let editingLightning = $state('');
	let savingProfile = $state(false);
	let accountSecret = $state('');
	let accountBusy = $state(false);
	let createdAccountNsec = $state('');

	// avatar / banner upload via the configured media provider
	let avatarInput = $state<HTMLInputElement | null>(null);
	let bannerInput = $state<HTMLInputElement | null>(null);
	let uploadingMedia = $state<'avatar' | 'banner' | null>(null);

	function activeUploadProvider(): MediaProviderId | 'none' {
		const def = media.state.defaultProvider;
		if (def !== 'none' && media.isConfigured(def)) return def;
		return media.configured[0]?.id ?? 'none';
	}

	async function uploadProfileImage(file: File, target: 'avatar' | 'banner') {
		const provider = activeUploadProvider();
		uploadingMedia = target;
		try {
			const result = await media.upload(file, provider === 'none' ? undefined : provider, {
				pubkey: me?.pk,
				purpose: 'profile'
			});
			if (target === 'avatar') editingPicture = result.url;
			else editingBanner = result.url;
			toasts.success(`Uploaded via ${providerLabel(provider === 'none' ? 'server' : provider)}`);
		} catch (e) {
			toasts.error((e as Error).message);
		} finally {
			uploadingMedia = null;
		}
	}

	function onProfileImageInput(e: Event, target: 'avatar' | 'banner') {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (file) void uploadProfileImage(file, target);
		input.value = '';
	}

	function clean(value: string) {
		return value.trim() || undefined;
	}

	function resetProfileForm() {
		editingUsername = myProfile?.name || '';
		editingDisplayName = myProfile?.display_name || '';
		editingAbout = myProfile?.about || '';
		editingPicture = myProfile?.picture || '';
		editingBanner = myProfile?.banner || '';
		editingWebsite = myProfile?.website || '';
		editingNip05 = myProfile?.nip05 || '';
		editingLightning = myProfile?.lud16 || myProfile?.lud06 || '';
	}

	let loadedProfileKey = $state('');
	$effect(() => {
		const signature = JSON.stringify(myProfile ?? {});
		if (signature === loadedProfileKey) return;
		loadedProfileKey = signature;
		resetProfileForm();
	});

	async function saveProfile() {
		if (!me) return;
		savingProfile = true;
		try {
			const meta = {
				name: clean(editingUsername),
				display_name: clean(editingDisplayName) ?? clean(editingUsername),
				about: clean(editingAbout),
				picture: clean(editingPicture),
				banner: clean(editingBanner),
				website: clean(editingWebsite),
				nip05: clean(editingNip05),
				lud16: clean(editingLightning)
			};
			const event = finalizeEvent(
				{
					kind: 0,
					content: JSON.stringify(meta),
					created_at: Math.floor(Date.now() / 1000),
					tags: []
				},
				hexToBytes(me.sk)
			);
			await publish(event);
			identity.setProfile({ pubkey: me.pk, ...meta });
			profiles.byPubkey = { ...profiles.byPubkey, [me.pk]: { pubkey: me.pk, ...meta } };
			toasts.success('Profile updated');
		} catch (e) {
			toasts.error((e as Error).message);
		} finally {
			savingProfile = false;
		}
	}

	function logout() {
		void confirms
			.danger({
				title: 'Remove active account?',
				message:
					'This removes the active account from this device and signs you out. Make sure you backed up your nsec.',
				confirmLabel: 'Remove and sign out'
			})
			.then((ok) => {
				if (!ok) return;
				identity.logout();
				toasts.info('Active account removed from this device');
			});
	}

	function accountDisplayName(account: AccountSummary) {
		return account.profile?.display_name || account.profile?.name || shortKey(account.npub);
	}

	async function copyAccountSecret() {
		if (!createdAccountNsec) return;
		await navigator.clipboard.writeText(createdAccountNsec);
		toasts.success('nsec copied');
	}

	function switchAccount(pubkey: string) {
		if (identity.current?.pk === pubkey) return;
		try {
			identity.switchTo(pubkey);
			toasts.info('Switched account');
		} catch (e) {
			toasts.error((e as Error).message);
		}
	}

	function createAccount() {
		accountBusy = true;
		try {
			const id = identity.create();
			createdAccountNsec = id.nsec;
			accountSecret = '';
			toasts.success('New account created');
		} catch (e) {
			toasts.error((e as Error).message);
		} finally {
			accountBusy = false;
		}
	}

	function importAccount() {
		if (!accountSecret.trim()) return;
		accountBusy = true;
		try {
			identity.importSecret(accountSecret);
			accountSecret = '';
			createdAccountNsec = '';
			toasts.success('Account imported');
		} catch (e) {
			toasts.error((e as Error).message);
		} finally {
			accountBusy = false;
		}
	}

	async function removeAccount(pubkey: string) {
		if (
			!(await confirms.danger({
				title: 'Remove saved account?',
				message: 'This removes the account from this device. Make sure its nsec is backed up.',
				confirmLabel: 'Remove'
			}))
		)
			return;
		identity.removeAccount(pubkey);
		toasts.info('Account removed from this device');
	}
</script>

<svelte:head><title>{sectionTitle} · Settings · BitOS</title></svelte:head>

<div class="flex h-full flex-col sm:flex-row">
	<!-- Settings sidebar -->
	<aside
		class="hidden w-[260px] shrink-0 flex-col overflow-y-auto border-r border-[var(--ui-border-muted)] sm:flex"
	>
		<div class="border-b border-[var(--ui-border-muted)] p-5">
			<h1 class="font-display text-[24px] font-extrabold tracking-tight">Settings</h1>
			<p class="mt-1 text-[12px] text-[var(--ui-text-muted)]">
				Manage your account and preferences
			</p>
		</div>
		<div class="flex-1 p-3">
			{#each sections as s (s.key)}
				<a
					href={`/settings/${s.key}`}
					class="settings-nav-item w-full {section === s.key ? 'active' : ''}"
				>
					<span class="relative grid shrink-0 place-items-center">
						<!-- Active marker — borderless gradient hex glow behind the icon
						     (same system design as the NavRail). No background pill. -->
						{#if section === s.key}
							<span
								class="hex-clip absolute -inset-[6px] bg-gradient-to-br from-primary-500/25 to-warm-500/20"
								aria-hidden="true"
							></span>
						{/if}
						<Icon name={s.icon} class="relative size-[18px]" />
					</span>
					<span>{s.label}</span>
				</a>
			{/each}
			<div class="my-3 border-t border-[var(--ui-border-muted)]"></div>
			<button
				type="button"
				onclick={logout}
				class="settings-nav-item w-full text-primary-500 hover:bg-primary-500/5"
			>
				<Icon name="i-lucide-log-out" class="size-[18px] shrink-0" /><span>Log out</span>
			</button>
		</div>
	</aside>

	<!-- MOBILE: iOS-style settings index (shown only at the `/settings` root) -->
	{#if mobileIndex}
		<div class="flex h-full flex-col sm:hidden">
			<div class={iosNavBar}>
				<a
					href="/"
					class="-ml-1 grid size-8 shrink-0 place-items-center text-primary-500 transition hover:opacity-70"
					aria-label="Back to home"
				>
					<Icon name="i-lucide-chevron-left" class="size-6" />
				</a>
			</div>

			<div
				class="flex-1 overflow-y-auto bg-[var(--ui-bg-muted)] pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
			>
				<h1
					class="px-4 pt-3 pb-1 text-[32px] leading-none font-bold tracking-[-0.03em] text-[var(--ui-text)]"
				>
					Settings
				</h1>
				<!-- Profile hero row = Account entry (Apple-Account style) -->
				{#if me}
					<a
						href="/settings/account"
						class="mx-4 mt-2 mb-[18px] flex items-center gap-3.5 rounded-[14px] bg-[var(--surface-bg)] p-2.5 transition active:bg-[var(--interactive-hover-bg)]"
					>
						<Avatar
							pubkey={me.pk}
							name={myProfile?.display_name || myProfile?.name}
							picture={myProfile?.picture}
							size={44}
						/>
						<div class="min-w-0 flex-1">
							<p class="truncate text-[17px] font-bold tracking-tight">
								{myProfile?.display_name || myProfile?.name || 'You'}
							</p>
							<p class="truncate font-mono text-[12px] text-[var(--ui-text-muted)]">
								{shortKey(me.npub)}
							</p>
						</div>
						<Icon
							name="i-lucide-chevron-right"
							class="ml-auto size-5 shrink-0 text-[var(--ui-text-dimmed)] opacity-60"
						/>
					</a>
				{/if}

				<div class="space-y-[18px]">
					{#each mobileGroups as group (group.id)}
						<section>
							{#if group.label}
								<p
									class="mr-8 mb-2 ml-8 text-[13px] font-semibold tracking-[-0.01em] text-[var(--ui-text-muted)]"
								>
									{group.label}
								</p>
							{/if}
							<div class="mx-4 overflow-hidden rounded-[14px] bg-[var(--surface-bg)]">
								{#each group.items as s (s.key)}
									<a
										href={`/settings/${s.key}`}
										class="ios-row relative flex min-h-[44px] items-center gap-3.5 py-2 pr-3 pl-[11px] transition active:bg-[var(--interactive-hover-bg)]"
									>
										<span
											class="grid size-[30px] shrink-0 place-items-center rounded-[10px]"
											style="background-color:color-mix(in oklab,{s.tint} 14%, transparent);color:{s.tint}"
										>
											<Icon name={s.icon} class="size-[18px]" />
										</span>
										<span
											class="min-w-0 flex-1 text-[16px] tracking-[-0.01em] text-[var(--ui-text)]"
											>{s.label}</span
										>
										<Icon
											name="i-lucide-chevron-right"
											class="size-[18px] shrink-0 text-[var(--ui-text-dimmed)] opacity-60"
										/>
									</a>
								{/each}
							</div>
						</section>
					{/each}

					<section>
						<div
							class="mx-4 flex min-h-[44px] items-center justify-center overflow-hidden rounded-[14px] bg-[var(--surface-bg)]"
						>
							<button
								type="button"
								class="w-full py-2 text-[16px] font-medium text-[#FF3B30] transition active:bg-[var(--interactive-hover-bg)]"
								onclick={logout}
							>
								Log Out
							</button>
						</div>
					</section>
				</div>
			</div>
		</div>
	{/if}

	<!-- Content pane: hidden on mobile while the iOS index is open -->
	<div class="min-h-0 min-w-0 flex-1 overflow-y-auto {mobileIndex ? 'hidden sm:block' : 'block'}">
		<!-- Mobile detail header (iOS-style) shown only inside a section -->
		<div class="{iosNavBar} sm:hidden">
			<a
				href="/settings"
				class="flex items-center gap-0.5 text-primary-500 transition hover:opacity-70"
				aria-label="Back to settings"
			>
				<Icon name="i-lucide-chevron-left" class="size-6" />
				<span class="text-[17px]">Settings</span>
			</a>
			<span class="text-[17px] font-bold tracking-[-0.02em] text-[var(--ui-text)]"
				>{sectionTitle}</span
			>
			<span class="w-8 shrink-0"></span>
		</div>
		<div class="page-container py-5 sm:py-6">
			<!-- ACCOUNT -->
			{#if section === 'account'}
				<input
					bind:this={avatarInput}
					type="file"
					accept="image/*"
					class="hidden"
					onchange={(e) => onProfileImageInput(e, 'avatar')}
				/>
				<input
					bind:this={bannerInput}
					type="file"
					accept="image/*"
					class="hidden"
					onchange={(e) => onProfileImageInput(e, 'banner')}
				/>
				<h2 class="mb-1 font-display text-[24px] font-extrabold">Account</h2>
				<p class="mb-6 text-[13px] text-[var(--ui-text-muted)]">
					Update your Nostr profile — changes are published to relays.
				</p>

				<SectionCard class="mb-5">
					{#if editingBanner}
						<div class="-mx-5 -mt-5 mb-5 overflow-hidden rounded-t-2xl">
							<img src={editingBanner} alt="banner preview" class="h-24 w-full object-cover" />
						</div>
					{/if}
					<div class="mb-5 flex flex-wrap items-center gap-4">
						<div
							class="size-16 shrink-0 overflow-hidden mask-squircle bg-primary-500/8 shadow-[var(--glow-primary)] ring-1 ring-primary-500/20"
						>
							{#if editingPicture}
								<img src={editingPicture} alt="avatar preview" class="size-16 object-cover" />
							{:else}
								<div
									class="grid size-16 place-items-center mask-squircle bg-warm-500 font-bold text-white"
								>
									{(editingDisplayName || editingUsername || 'Y').slice(0, 2).toUpperCase()}
								</div>
							{/if}
						</div>
						<div class="min-w-0 flex-1">
							<p class="text-[15px] font-bold">{editingDisplayName || editingUsername || 'You'}</p>
							<p class="text-[12px] text-[var(--ui-text-muted)]">{me ? shortKey(me.npub) : ''}</p>
						</div>
						<Button
							color="neutral"
							variant="subtle"
							class="w-full sm:w-auto"
							icon={uploadingMedia === 'avatar' ? 'i-lucide-loader-circle' : 'i-lucide-camera'}
							onclick={() => avatarInput?.click()}
							disabled={uploadingMedia !== null}
							>{uploadingMedia === 'avatar' ? 'Uploading…' : 'Change photo'}</Button
						>
					</div>
					<div class="grid gap-4 sm:grid-cols-2">
						<div>
							<label
								for="profile-username"
								class="mb-1.5 block text-[12px] font-bold tracking-wide text-[var(--ui-text-muted)] uppercase"
								>Username</label
							>
							<Input
								id="profile-username"
								bind:value={editingUsername}
								icon="i-lucide-at-sign"
								placeholder="username"
								class="w-full"
							/>
						</div>
						<div>
							<label
								for="profile-display-name"
								class="mb-1.5 block text-[12px] font-bold tracking-wide text-[var(--ui-text-muted)] uppercase"
								>Display name</label
							>
							<Input
								id="profile-display-name"
								bind:value={editingDisplayName}
								icon="i-lucide-user"
								placeholder="Your name"
								class="w-full"
							/>
						</div>
						<div class="sm:col-span-2">
							<label
								for="profile-bio"
								class="mb-1.5 block text-[12px] font-bold tracking-wide text-[var(--ui-text-muted)] uppercase"
								>Bio</label
							>
							<textarea
								id="profile-bio"
								bind:value={editingAbout}
								rows="3"
								maxlength="300"
								class="w-full resize-none rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-4 py-2.5 text-[14px] transition outline-none focus:border-primary-500 focus:bg-[var(--surface-bg)]"
							></textarea>
							<p class="mt-1 text-[11px] text-[var(--ui-text-dimmed)]">
								{editingAbout.length} / 300 characters
							</p>
						</div>
						<div>
							<label
								for="profile-picture"
								class="mb-1.5 block text-[12px] font-bold tracking-wide text-[var(--ui-text-muted)] uppercase"
								>Avatar URL</label
							>
							<Input
								id="profile-picture"
								bind:value={editingPicture}
								icon="i-lucide-image"
								placeholder="https://..."
								type="url"
								class="w-full"
							>
								{#snippet trailing()}
									<button
										type="button"
										title="Upload via {providerLabel(
											activeUploadProvider() === 'none' ? 'server' : activeUploadProvider()
										)}"
										onclick={() => avatarInput?.click()}
										disabled={uploadingMedia !== null}
										class="grid size-6 place-items-center rounded-md text-[var(--ui-text-dimmed)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-primary-500 disabled:opacity-50"
									>
										<Icon
											name={uploadingMedia === 'avatar'
												? 'i-lucide-loader-circle'
												: 'i-lucide-upload'}
											class="size-3.5 {uploadingMedia === 'avatar' ? 'animate-spin' : ''}"
										/>
									</button>
								{/snippet}
							</Input>
						</div>
						<div>
							<label
								for="profile-banner"
								class="mb-1.5 block text-[12px] font-bold tracking-wide text-[var(--ui-text-muted)] uppercase"
								>Banner URL</label
							>
							<Input
								id="profile-banner"
								bind:value={editingBanner}
								icon="i-lucide-panorama"
								placeholder="https://..."
								type="url"
								class="w-full"
							>
								{#snippet trailing()}
									<button
										type="button"
										title="Upload via {providerLabel(
											activeUploadProvider() === 'none' ? 'server' : activeUploadProvider()
										)}"
										onclick={() => bannerInput?.click()}
										disabled={uploadingMedia !== null}
										class="grid size-6 place-items-center rounded-md text-[var(--ui-text-dimmed)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-primary-500 disabled:opacity-50"
									>
										<Icon
											name={uploadingMedia === 'banner'
												? 'i-lucide-loader-circle'
												: 'i-lucide-upload'}
											class="size-3.5 {uploadingMedia === 'banner' ? 'animate-spin' : ''}"
										/>
									</button>
								{/snippet}
							</Input>
						</div>
						<div>
							<label
								for="profile-website"
								class="mb-1.5 block text-[12px] font-bold tracking-wide text-[var(--ui-text-muted)] uppercase"
								>Website</label
							>
							<Input
								id="profile-website"
								bind:value={editingWebsite}
								icon="i-lucide-link"
								placeholder="https://example.com"
								class="w-full"
							/>
						</div>
						<div>
							<label
								for="profile-nip05"
								class="mb-1.5 block text-[12px] font-bold tracking-wide text-[var(--ui-text-muted)] uppercase"
								>NIP-05</label
							>
							<Input
								id="profile-nip05"
								bind:value={editingNip05}
								icon="i-lucide-badge-check"
								placeholder="name@example.com"
								class="w-full"
							/>
						</div>
						<div class="sm:col-span-2">
							<label
								for="profile-lightning"
								class="mb-1.5 block text-[12px] font-bold tracking-wide text-[var(--ui-text-muted)] uppercase"
								>Lightning address</label
							>
							<Input
								id="profile-lightning"
								bind:value={editingLightning}
								icon="i-lucide-zap"
								placeholder="name@getalby.com"
								class="w-full"
							/>
						</div>
					</div>
					<div class="mt-5 flex gap-2 border-t border-[var(--ui-border-muted)] pt-5">
						<Button
							color="primary"
							icon={savingProfile ? 'i-lucide-loader-circle' : 'i-lucide-save'}
							onclick={saveProfile}
							disabled={savingProfile}>{savingProfile ? 'Saving…' : 'Save changes'}</Button
						>
						<Button color="neutral" variant="ghost" onclick={resetProfileForm}>Cancel</Button>
					</div>
				</SectionCard>

				<SectionCard title="Accounts" icon="i-lucide-users-round" class="mb-5">
					{#snippet actions()}
						<span class="text-[11px] text-[var(--ui-text-dimmed)]">
							{identity.accounts.length} saved
						</span>
					{/snippet}
					<div class="space-y-2">
						{#each identity.accounts as account (account.pk)}
							<div
								class="flex items-center gap-3 rounded-xl border border-[var(--ui-border-muted)] p-3"
							>
								<Avatar
									pubkey={account.pk}
									name={accountDisplayName(account)}
									picture={account.profile?.picture}
									size={40}
								/>
								<div class="min-w-0 flex-1">
									<p class="truncate text-[13.5px] font-bold">
										{accountDisplayName(account)}
									</p>
									<p class="truncate font-mono text-[11px] text-[var(--ui-text-muted)]">
										{shortKey(account.npub, 10, 8)}
									</p>
								</div>
								{#if account.active}
									<span
										class="rounded-full bg-primary-500/10 px-2 py-1 text-[11px] font-bold text-primary-600"
									>
										Active
									</span>
								{:else}
									<Button
										color="neutral"
										variant="subtle"
										size="sm"
										onclick={() => switchAccount(account.pk)}>Switch</Button
									>
									<Button
										square
										color="error"
										variant="ghost"
										size="sm"
										icon="i-lucide-trash-2"
										onclick={() => removeAccount(account.pk)}
									/>
								{/if}
							</div>
						{/each}
					</div>
					<div class="mt-4 grid gap-3 border-t border-[var(--ui-border-muted)] pt-4">
						<div class="grid gap-2 sm:grid-cols-[1fr_auto]">
							<Input
								bind:value={accountSecret}
								icon="i-lucide-key-round"
								placeholder="Import nsec1… or 64-char hex"
								class="w-full font-mono text-[12.5px]"
							/>
							<Button
								color="primary"
								variant="subtle"
								icon="i-lucide-log-in"
								onclick={importAccount}
								disabled={accountBusy || !accountSecret.trim()}>Import</Button
							>
						</div>
						<Button
							color="neutral"
							variant="subtle"
							icon="i-lucide-sparkles"
							onclick={createAccount}
							disabled={accountBusy}
						>
							Create and switch to new account
						</Button>
						{#if createdAccountNsec}
							<div
								class="rounded-xl border border-[var(--tone-warning-text)]/25 bg-[var(--tone-warning-bg)] p-3"
							>
								<p class="mb-2 text-[12px] font-bold text-[var(--tone-warning-text)]">
									Back up this new account nsec before leaving.
								</p>
								<div class="flex gap-2">
									<Input value={createdAccountNsec} readonly class="flex-1 font-mono text-[11px]" />
									<Button
										square
										color="neutral"
										variant="subtle"
										icon="i-lucide-copy"
										onclick={copyAccountSecret}
									/>
								</div>
							</div>
						{/if}
					</div>
				</SectionCard>

				<SectionCard title="Danger zone" description="Clear local data on this device.">
					<div class="space-y-2">
						<div
							class="flex items-center justify-between rounded-xl p-3 transition hover:bg-[var(--interactive-hover-bg)]"
						>
							<div>
								<p class="text-[13px] font-semibold">Clear cache</p>
								<p class="text-[11px] text-[var(--ui-text-muted)]">
									Remove cached profiles & notes
								</p>
							</div>
							<Button
								color="neutral"
								variant="subtle"
								onclick={() => toasts.success('Cache cleared')}>Clear</Button
							>
						</div>
						<div
							class="flex items-center justify-between rounded-xl p-3 transition hover:bg-primary-500/5"
						>
							<div>
								<p class="text-[13px] font-semibold text-primary-500">Log out (remove key)</p>
								<p class="text-[11px] text-[var(--ui-text-muted)]">
									Permanently removes your identity from this device
								</p>
							</div>
							<Button color="error" variant="subtle" onclick={logout}>Log out</Button>
						</div>
					</div>
				</SectionCard>
			{/if}

			{#if section === 'privacy' || section === 'notifications'}
				<PrivacyNotificationSettings {section} />
			{/if}

			<!-- LIGHTNING (wallet connection + default zap amounts + zap prefs) -->
			{#if section === 'lightning'}
				<LightningSettings />
			{/if}

			<!-- APPEARANCE (wired to real preferences) -->
			{#if section === 'appearance'}
				<AppearanceSettings />
			{/if}

			<!-- ALGORITHM (feed / reels / discover ranking) -->
			{#if section === 'algorithm'}
				<AlgorithmSettings />
			{/if}

			<!-- SECURITY (Nostr keys + relays) -->
			{#if section === 'security' && me}
				<SecuritySettings {me} />
			{/if}

			<!-- MEDIA & UPLOADS -->
			{#if section === 'media'}
				<MediaSettings />
			{/if}
			{#if section === 'language' || section === 'help' || section === 'about'}
				<SupportSettings {section} />
			{/if}
		</div>
	</div>
</div>
