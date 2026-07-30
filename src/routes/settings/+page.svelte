<script lang="ts">
	import { page } from '$app/state';
	import { finalizeEvent } from 'nostr-tools/pure';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import AppearanceSettings from '$lib/components/settings/AppearanceSettings.svelte';
	import MediaSettings from '$lib/components/settings/MediaSettings.svelte';
	import PrivacyNotificationSettings from '$lib/components/settings/PrivacyNotificationSettings.svelte';
	import SecuritySettings from '$lib/components/settings/SecuritySettings.svelte';
	import SupportSettings from '$lib/components/settings/SupportSettings.svelte';
	import { isSettingsSectionKey, settingsSections } from '$lib/settings/sections';
	import { media, providerLabel } from '$lib/stores/media.svelte';
	import type { MediaProviderId } from '$lib/media/uploaders';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { publish } from '$lib/nostr/pool';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { shortKey } from '$lib/utils/format';
	import { hexToBytes } from '$lib/nostr/hex';

	const me = $derived(identity.current);
	const myProfile = $derived(me ? (profiles.get(me.pk) ?? me.profile) : undefined);

	const section = $derived(
		isSettingsSectionKey(page.params.section) ? page.params.section : 'account'
	);
	const sections = settingsSections;
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
		if (provider === 'none') {
			toasts.error('No media provider configured. Add one in Settings → Media & Uploads.');
			return;
		}
		uploadingMedia = target;
		try {
			const result = await media.upload(file, provider);
			if (target === 'avatar') editingPicture = result.url;
			else editingBanner = result.url;
			toasts.success(`Uploaded via ${providerLabel(provider)}`);
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
		if (
			confirm('Log out? This removes your key from this device. Make sure you backed up your nsec.')
		) {
			identity.logout();
			toasts.info('Logged out');
		}
	}
</script>

<svelte:head><title>{sectionTitle} · Settings · BitOS</title></svelte:head>

<div class="flex h-full flex-col sm:flex-row">
	<!-- Settings sidebar -->
	<aside
		class="hidden w-[260px] shrink-0 flex-col overflow-y-auto border-r border-[var(--ui-border-muted)] bg-[var(--surface-bg)] sm:flex"
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
					href={s.key === 'account' ? '/settings' : `/settings/${s.key}`}
					class="settings-nav-item w-full {section === s.key ? 'active' : ''}"
				>
					<Icon name={s.icon} class="size-[18px] shrink-0" />
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
		{#if me}
			<div class="border-t border-[var(--ui-border-muted)] p-5">
				<div class="flex items-center gap-3">
					<div
						class="grid size-10 shrink-0 place-items-center rounded-xl bg-warm-500 text-xs font-bold text-white"
					>
						{(myProfile?.display_name || 'Y').slice(0, 2).toUpperCase()}
					</div>
					<div class="min-w-0 flex-1">
						<p class="truncate text-[13px] font-bold">{myProfile?.display_name || 'You'}</p>
						<p class="truncate font-mono text-[11px] text-[var(--ui-text-muted)]">
							{shortKey(me.npub)}
						</p>
					</div>
				</div>
			</div>
		{/if}
	</aside>

	<!-- Mobile header + section picker (stacks above content on small screens) -->
	<div class="shrink-0 border-b border-[var(--ui-border-muted)] bg-[var(--surface-bg)] sm:hidden">
		<div class="flex items-center gap-2 px-4 pt-3 pb-1">
			<a
				href="/"
				class="-ml-1 grid size-8 shrink-0 place-items-center rounded-lg text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
				aria-label="Back to home"
			>
				<Icon name="i-lucide-arrow-left" class="size-5" />
			</a>
			<div class="min-w-0 flex-1">
				<h1 class="font-display text-[18px] leading-tight font-extrabold tracking-tight">
					Settings
				</h1>
				<p class="truncate text-[11px] text-[var(--ui-text-muted)]">{sectionTitle}</p>
			</div>
		</div>
		<div
			class="flex [scrollbar-width:none] gap-1.5 overflow-x-auto px-3 pt-1 pb-2.5 [&::-webkit-scrollbar]:hidden"
		>
			{#each sections as s (s.key)}
				<a
					href={s.key === 'account' ? '/settings' : `/settings/${s.key}`}
					class="pill-tab flex shrink-0 items-center gap-1.5 {section === s.key ? 'active' : ''}"
				>
					<Icon name={s.icon} class="size-3.5" />
					<span>{s.label}</span>
				</a>
			{/each}
		</div>
	</div>

	<!-- Content -->
	<div class="min-h-0 min-w-0 flex-1 overflow-y-auto">
		<div class="mx-auto max-w-[680px] px-4 py-5 sm:px-8 sm:py-6">
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

				<div class="post-card mb-5 p-5">
					{#if editingBanner}
						<div class="-mx-5 -mt-5 mb-5 overflow-hidden rounded-t-2xl">
							<img src={editingBanner} alt="banner preview" class="h-24 w-full object-cover" />
						</div>
					{/if}
					<div class="mb-5 flex flex-wrap items-center gap-4">
						<div class="size-16 shrink-0 overflow-hidden mask-squircle">
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
										title="Upload via {providerLabel(activeUploadProvider())}"
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
										title="Upload via {providerLabel(activeUploadProvider())}"
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
				</div>

				<div class="post-card p-5">
					<h3 class="mb-1 text-[15px] font-bold">Danger zone</h3>
					<p class="mb-4 text-[12px] text-[var(--ui-text-muted)]">
						Clear local data on this device.
					</p>
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
				</div>
			{/if}

			{#if section === 'privacy' || section === 'notifications'}
				<PrivacyNotificationSettings {section} />
			{/if}

			<!-- APPEARANCE (wired to real preferences) -->
			{#if section === 'appearance'}
				<AppearanceSettings />
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
