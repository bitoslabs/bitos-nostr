<script lang="ts">
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { finalizeEvent } from 'nostr-tools/pure';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { preferences, accentOptions, neutralOptions } from '$lib/theme/preferences.svelte';
	import type { DensityMode, RoundedMode } from '$lib/theme/preferences.svelte';
	import { relays } from '$lib/nostr/relays.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { publish } from '$lib/nostr/pool';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { shortKey } from '$lib/utils/format';
	import { hexToBytes } from '$lib/nostr/hex';

	const me = $derived(identity.current);
	const myProfile = $derived(me ? (profiles.get(me.pk) ?? me.profile) : undefined);

	const sections = [
		{ key: 'account', label: 'Account', icon: 'i-lucide-user' },
		{ key: 'privacy', label: 'Privacy', icon: 'i-lucide-lock' },
		{ key: 'notifications', label: 'Notifications', icon: 'i-lucide-bell' },
		{ key: 'appearance', label: 'Appearance', icon: 'i-lucide-palette' },
		{ key: 'security', label: 'Security', icon: 'i-lucide-shield-check' },
		{ key: 'language', label: 'Language & Region', icon: 'i-lucide-languages' },
		{ key: 'help', label: 'Help & Support', icon: 'i-lucide-circle-help' },
		{ key: 'about', label: 'About', icon: 'i-lucide-info' }
	];
	const sectionKeys = $derived(sections.map((s) => s.key));
	const section = $derived(
		sectionKeys.includes(page.params.section ?? '') ? (page.params.section as string) : 'account'
	);
	const sectionTitle = $derived(sections.find((item) => item.key === section)?.label ?? 'Settings');

	// --- appearance ---
	const modes = [
		{ key: 'light', label: 'Light', icon: 'i-lucide-sun' },
		{ key: 'dark', label: 'Dark', icon: 'i-lucide-moon' },
		{ key: 'system', label: 'System', icon: 'i-lucide-monitor' }
	] as const;
	const fontSizes = [
		{ key: 'sm', label: 'Small' },
		{ key: 'md', label: 'Default' },
		{ key: 'lg', label: 'Large' }
	] as const;
	const roundedOptions: { key: RoundedMode; label: string; radius: string }[] = [
		{ key: 'sharp', label: 'Sharp', radius: '0.25rem' },
		{ key: 'soft', label: 'Soft', radius: '0.625rem' },
		{ key: 'round', label: 'Round', radius: '0.875rem' },
		{ key: 'pillowy', label: 'Pillowy', radius: '1.5rem' }
	];
	const densityOptions: { key: DensityMode; label: string; description: string }[] = [
		{ key: 'normal', label: 'Normal', description: 'Comfortable spacing' },
		{ key: 'compact', label: 'Compact', description: 'More content on screen' }
	];
	const sizeLabels = ['Extra Small', 'Small', 'Medium', 'Large', 'Extra Large'];
	let textSize = $state(2);
	let reducedMotion = $state(false);
	let highContrast = $state(false);

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

	// --- relays ---
	let newRelay = $state('');
	let testingRelays = $state<Record<string, boolean>>({});
	function addRelay() {
		const res = relays.add(newRelay);
		if (!res.ok) toasts.error(res.error ?? 'Invalid relay');
		else {
			toasts.success('Relay added');
			newRelay = '';
		}
	}

	function formatRelayTime(unixSeconds: number | undefined) {
		if (!unixSeconds) return 'not tested';
		return new Date(unixSeconds * 1000).toLocaleTimeString(undefined, {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	}

	async function testRelay(url: string) {
		if (!browser || testingRelays[url]) return;
		testingRelays = { ...testingRelays, [url]: true };
		relays.setStatus(url, 'connecting');
		const started = performance.now();
		try {
			const latency = await new Promise<number>((resolve, reject) => {
				const ws = new WebSocket(url);
				const timeout = window.setTimeout(() => {
					ws.close();
					reject(new Error('Connection timed out'));
				}, 6000);
				ws.onopen = () => {
					window.clearTimeout(timeout);
					const ms = Math.round(performance.now() - started);
					ws.close();
					resolve(ms);
				};
				ws.onerror = () => {
					window.clearTimeout(timeout);
					reject(new Error('Connection failed'));
				};
			});
			relays.setStatus(url, 'ok', latency);
			toasts.success(`${url} connected in ${latency}ms`);
		} catch {
			relays.setStatus(url, 'fail', null);
			toasts.error(`${url} failed`);
		} finally {
			testingRelays = { ...testingRelays, [url]: false };
		}
	}

	function testAllRelays() {
		for (const relay of relays.list) void testRelay(relay.url);
	}

	// --- keys ---
	let revealKey = $state(false);
	async function copy(text: string, label: string) {
		await navigator.clipboard.writeText(text);
		toasts.success(`${label} copied`);
	}
	function logout() {
		if (
			confirm('Log out? This removes your key from this device. Make sure you backed up your nsec.')
		) {
			identity.logout();
			toasts.info('Logged out');
		}
	}

	// generic toggles for the decorative sections
	let t = $state<Record<string, boolean>>({
		privateAcc: false,
		activity: true,
		readReceipts: true,
		storyShare: true,
		likes: true,
		comments: true,
		followers: true,
		dms: true,
		mentions: false
	});
	function toggle(k: string) {
		t[k] = !t[k];
		t = { ...t };
	}
</script>

<svelte:head><title>{sectionTitle} · Settings · BitOS</title></svelte:head>

<div class="flex h-full">
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

	<!-- Mobile section picker -->
	<div
		class="flex [scrollbar-width:none] gap-1 overflow-x-auto border-b border-[var(--ui-border-muted)] p-2 sm:hidden [&::-webkit-scrollbar]:hidden"
	>
		{#each sections as s (s.key)}
			<a
				href={s.key === 'account' ? '/settings' : `/settings/${s.key}`}
				class="pill-tab shrink-0 {section === s.key ? 'active' : ''}">{s.label}</a
			>
		{/each}
	</div>

	<!-- Content -->
	<div class="min-w-0 flex-1 overflow-y-auto">
		<div class="mx-auto max-w-[680px] px-5 py-6 sm:px-8">
			<!-- ACCOUNT -->
			{#if section === 'account'}
				<h2 class="mb-1 font-display text-[24px] font-extrabold">Account</h2>
				<p class="mb-6 text-[13px] text-[var(--ui-text-muted)]">
					Update your Nostr profile — changes are published to relays.
				</p>

				<div class="post-card mb-5 p-5">
					<div class="mb-5 flex items-center gap-4">
						<div
							class="grid size-16 shrink-0 place-items-center rounded-2xl bg-warm-500 font-bold text-white"
						>
							{(editingDisplayName || editingUsername || 'Y').slice(0, 2).toUpperCase()}
						</div>
						<div class="flex-1">
							<p class="text-[15px] font-bold">{editingDisplayName || editingUsername || 'You'}</p>
							<p class="text-[12px] text-[var(--ui-text-muted)]">{me ? shortKey(me.npub) : ''}</p>
						</div>
						<Button
							color="neutral"
							variant="subtle"
							onclick={() => toasts.info('Paste an image URL in Avatar URL')}>Change photo</Button
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
							/>
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
							/>
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

				<div class="mb-5 grid grid-cols-3 gap-3">
					{#each [{ l: 'Notes', v: '348', d: '+12 this month', c: 'text-accent-500' }, { l: 'Followers', v: '12.4K', d: '+248 this week', c: 'text-accent-500' }, { l: 'Reactions', v: '1.2M', d: '+89% growth', c: 'text-primary-500' }] as s (s.l)}
						<div class="post-card p-4">
							<p
								class="text-[11px] font-semibold tracking-wide text-[var(--ui-text-muted)] uppercase"
							>
								{s.l}
							</p>
							<p class="mt-1 font-display text-[24px] font-extrabold">{s.v}</p>
							<p class="mt-1 text-[11px] font-semibold {s.c}">{s.d}</p>
						</div>
					{/each}
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

			<!-- PRIVACY -->
			{#if section === 'privacy'}
				<h2 class="mb-1 font-display text-[24px] font-extrabold">Privacy</h2>
				<p class="mb-6 text-[13px] text-[var(--ui-text-muted)]">
					Control who can see and interact with your content
				</p>
				<div class="post-card mb-5 p-5">
					<h3 class="mb-4 text-[15px] font-bold">Account privacy</h3>
					<div class="space-y-3">
						{#each [['privateAcc', 'Private account', 'Only approved followers can see your posts'], ['activity', 'Activity status', "Show when you're active"], ['readReceipts', 'Read receipts', 'Let others know you saw their messages']] as [k, title, desc] (k)}
							<div
								class="flex items-center justify-between {k !== 'privateAcc'
									? 'border-t border-[var(--ui-border-muted)] pt-3'
									: ''}"
							>
								<div>
									<p class="text-[13.5px] font-semibold">{title}</p>
									<p class="text-[11px] text-[var(--ui-text-muted)]">{desc}</p>
								</div>
								<button type="button" class="toggle {t[k] ? 'on' : ''}" onclick={() => toggle(k)}
								></button>
							</div>
						{/each}
					</div>
				</div>
				<div class="post-card p-5">
					<h3 class="mb-4 text-[15px] font-bold">Interactions</h3>
					<div class="space-y-3">
						<div class="flex items-center justify-between">
							<div>
								<p class="text-[13.5px] font-semibold">Who can message you</p>
								<p class="text-[11px] text-[var(--ui-text-muted)]">
									Everyone, followers, or no one
								</p>
							</div>
							<select
								class="rounded-lg bg-[var(--ui-bg-muted)] px-3 py-1.5 text-[12px] font-semibold outline-none"
								><option>Followers</option><option>Everyone</option><option>No one</option></select
							>
						</div>
						<div
							class="flex items-center justify-between border-t border-[var(--ui-border-muted)] pt-3"
						>
							<div>
								<p class="text-[13.5px] font-semibold">Who can comment on posts</p>
								<p class="text-[11px] text-[var(--ui-text-muted)]">
									Control who can leave comments
								</p>
							</div>
							<select
								class="rounded-lg bg-[var(--ui-bg-muted)] px-3 py-1.5 text-[12px] font-semibold outline-none"
								><option>Everyone</option><option>Followers</option><option>Friends</option></select
							>
						</div>
						<div
							class="flex items-center justify-between border-t border-[var(--ui-border-muted)] pt-3"
						>
							<div>
								<p class="text-[13.5px] font-semibold">Story sharing</p>
								<p class="text-[11px] text-[var(--ui-text-muted)]">
									Allow others to share your stories
								</p>
							</div>
							<button
								type="button"
								class="toggle {t.storyShare ? 'on' : ''}"
								onclick={() => toggle('storyShare')}
							></button>
						</div>
					</div>
				</div>
			{/if}

			<!-- NOTIFICATIONS -->
			{#if section === 'notifications'}
				<h2 class="mb-1 font-display text-[24px] font-extrabold">Notifications</h2>
				<p class="mb-6 text-[13px] text-[var(--ui-text-muted)]">
					Choose what you want to be notified about
				</p>
				<div class="post-card mb-5 p-5">
					<h3 class="mb-4 text-[15px] font-bold">Push notifications</h3>
					<div class="space-y-3">
						{#each [['likes', 'i-lucide-heart', 'text-primary-500', 'Likes and reactions', 'When someone likes your post'], ['comments', 'i-lucide-message-circle', 'text-accent-500', 'Comments', 'When someone comments on your post'], ['followers', 'i-lucide-user-plus', 'text-warm-500', 'New followers', 'When you get a new follower'], ['dms', 'i-lucide-send', 'text-primary-500', 'Direct messages', 'When you receive a message'], ['mentions', 'i-lucide-at-sign', 'text-accent-500', 'Mentions', 'When someone mentions you']] as [k, ic, col, title, desc] (k)}
							<div
								class="flex items-center justify-between {k !== 'likes'
									? 'border-t border-[var(--ui-border-muted)] pt-3'
									: ''}"
							>
								<div class="flex items-center gap-3">
									<div class="grid size-9 place-items-center rounded-xl bg-current/10">
										<Icon name={ic} class="size-4 {col}" />
									</div>
									<div>
										<p class="text-[13.5px] font-semibold">{title}</p>
										<p class="text-[11px] text-[var(--ui-text-muted)]">{desc}</p>
									</div>
								</div>
								<button type="button" class="toggle {t[k] ? 'on' : ''}" onclick={() => toggle(k)}
								></button>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- APPEARANCE (wired to real preferences) -->
			{#if section === 'appearance'}
				<h2 class="mb-1 font-display text-[24px] font-extrabold">Appearance</h2>
				<p class="mb-6 text-[13px] text-[var(--ui-text-muted)]">
					Customize how BitOS looks for you
				</p>

				<div class="post-card mb-5 p-5">
					<h3 class="mb-4 text-[15px] font-bold">Theme</h3>
					<div class="grid grid-cols-3 gap-3">
						{#each modes as m (m.key)}
							<button
								type="button"
								onclick={() => preferences.setMode(m.key)}
								class="rounded-xl border-2 p-3 transition {preferences.state.mode === m.key
									? 'border-primary-500'
									: 'border-[var(--ui-border-muted)] hover:border-[var(--ui-border-accented)]'}"
							>
								<div
									class="mb-2 grid h-16 place-items-center rounded-lg {m.key === 'light'
										? 'bg-[var(--ui-bg-muted)]'
										: m.key === 'dark'
											? 'bg-ink'
											: 'bg-[var(--ui-bg-accented)]'}"
								>
									<Icon
										name={m.icon}
										class={m.key === 'dark'
											? 'size-5 text-white'
											: m.key === 'light'
												? 'size-5 text-warm-500'
												: 'size-5 text-[var(--ui-text-muted)]'}
									/>
								</div>
								<p class="text-center text-[12px] font-bold">{m.label}</p>
							</button>
						{/each}
					</div>
				</div>

				<div class="post-card mb-5 p-5">
					<h3 class="mb-4 text-[15px] font-bold">Accent color</h3>
					<div class="flex flex-wrap gap-3">
						{#each accentOptions as a (a.key)}
							<button
								type="button"
								onclick={() => preferences.setAccent(a.key)}
								class="size-10 cursor-pointer rounded-full transition-transform hover:scale-110 {preferences
									.state.accent === a.key
									? 'ring-2 ring-offset-2 ring-offset-[var(--surface-bg)]'
									: ''}"
								style="background:{a.hex}; --tw-ring-color:{a.hex}"
								aria-label={a.label}
							>
								{#if preferences.state.accent === a.key}<Icon
										name="i-lucide-check"
										class="mx-auto size-4 text-white"
									/>{/if}
							</button>
						{/each}
					</div>
				</div>

				<div class="post-card mb-5 p-5">
					<h3 class="mb-4 text-[15px] font-bold">Neutral color</h3>
					<div class="flex flex-wrap gap-3">
						{#each neutralOptions as n (n.key)}
							<button
								type="button"
								onclick={() => preferences.setNeutral(n.key)}
								class="size-10 cursor-pointer rounded-full transition-transform hover:scale-110 {preferences
									.state.neutral === n.key
									? 'ring-2 ring-offset-2 ring-offset-[var(--surface-bg)]'
									: ''}"
								style="background:{n.hex}; --tw-ring-color:{n.hex}"
								aria-label={n.label}
							>
								{#if preferences.state.neutral === n.key}<Icon
										name="i-lucide-check"
										class="mx-auto size-4 text-white"
									/>{/if}
							</button>
						{/each}
					</div>
				</div>

				<div class="post-card mb-5 p-5">
					<h3 class="mb-4 text-[15px] font-bold">Rounded</h3>
					<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
						{#each roundedOptions as r (r.key)}
							<button
								type="button"
								onclick={() => preferences.setRounded(r.key)}
								class="border p-3 text-left transition {preferences.state.rounded === r.key
									? 'border-primary-500 bg-primary-500/10 text-primary-500'
									: 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:bg-[var(--interactive-hover-bg)]'}"
								style="border-radius:{r.radius}"
							>
								<div
									class="mx-auto mb-3 h-8 w-full border border-current/25 bg-[var(--ui-bg-muted)]"
									style="border-radius:{r.radius}"
								></div>
								<p class="text-center text-[12px] font-bold">{r.label}</p>
							</button>
						{/each}
					</div>
				</div>

				<div class="post-card mb-5 p-5">
					<h3 class="mb-4 text-[15px] font-bold">Density</h3>
					<div class="grid grid-cols-2 gap-2">
						{#each densityOptions as d (d.key)}
							<button
								type="button"
								onclick={() => preferences.setDensity(d.key)}
								class="rounded-xl border p-4 text-left transition {preferences.state.density ===
								d.key
									? 'border-primary-500 bg-primary-500/10 text-primary-500'
									: 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:bg-[var(--interactive-hover-bg)]'}"
							>
								<div class="mb-3 space-y-1.5">
									<div class="h-2 rounded-full bg-current/25"></div>
									<div
										class="h-2 rounded-full bg-current/20 {d.key === 'compact' ? 'w-3/4' : 'w-5/6'}"
									></div>
									<div
										class="h-2 rounded-full bg-current/15 {d.key === 'compact' ? 'w-1/2' : 'w-2/3'}"
									></div>
								</div>
								<p class="text-[13px] font-bold text-[var(--ui-text)]">{d.label}</p>
								<p class="mt-0.5 text-[11px] text-[var(--ui-text-muted)]">{d.description}</p>
							</button>
						{/each}
					</div>
				</div>

				<div class="post-card p-5">
					<h3 class="mb-4 text-[15px] font-bold">Text size</h3>
					<div
						class="mb-3 flex items-center justify-between text-[12px] text-[var(--ui-text-muted)]"
					>
						<span>A</span><span class="font-bold text-[var(--ui-text)]">{sizeLabels[textSize]}</span
						><span class="text-base">A</span>
					</div>
					<div class="mb-4 flex gap-2">
						{#each fontSizes as f (f.key)}
							<button
								type="button"
								onclick={() => preferences.setFontSize(f.key)}
								class="flex-1 rounded-lg border px-3 py-2 text-[13px] font-medium transition {preferences
									.state.fontSize === f.key
									? 'border-primary-500 bg-primary-500/10 text-primary-500'
									: 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:bg-[var(--interactive-hover-bg)]'}"
								>{f.label}</button
							>
						{/each}
					</div>
					<div class="mt-5 space-y-3 border-t border-[var(--ui-border-muted)] pt-5">
						<div class="flex items-center justify-between">
							<div>
								<p class="text-[13.5px] font-semibold">Reduced motion</p>
								<p class="text-[11px] text-[var(--ui-text-muted)]">Minimize animations</p>
							</div>
							<button
								type="button"
								class="toggle {reducedMotion ? 'on' : ''}"
								onclick={() => (reducedMotion = !reducedMotion)}
							></button>
						</div>
						<div
							class="flex items-center justify-between border-t border-[var(--ui-border-muted)] pt-3"
						>
							<div>
								<p class="text-[13.5px] font-semibold">High contrast</p>
								<p class="text-[11px] text-[var(--ui-text-muted)]">Increase visual contrast</p>
							</div>
							<button
								type="button"
								class="toggle {highContrast ? 'on' : ''}"
								onclick={() => (highContrast = !highContrast)}
							></button>
						</div>
					</div>
				</div>
			{/if}

			<!-- SECURITY (Nostr keys + relays) -->
			{#if section === 'security' && me}
				<h2 class="mb-1 font-display text-[24px] font-extrabold">Security</h2>
				<p class="mb-6 text-[13px] text-[var(--ui-text-muted)]">
					Your local keys and relay connections
				</p>

				<!-- Keys -->
				<div class="post-card mb-5 p-5">
					<div class="mb-4 flex items-center gap-2">
						<Icon name="i-lucide-key-round" class="size-[18px] text-primary-500" />
						<h3 class="text-[15px] font-bold">Keys</h3>
						<Badge tone="primary" class="ml-auto">local-first</Badge>
					</div>
					<div class="space-y-4">
						<div>
							<p class="mb-1.5 text-[12px] font-semibold text-[var(--ui-text-muted)]">
								Public key (npub)
							</p>
							<div class="flex gap-2">
								<Input value={me.npub} readonly class="flex-1 font-mono text-[11.5px]" /><Button
									square
									color="neutral"
									variant="subtle"
									onclick={() => copy(me.npub, 'npub')}
									icon="i-lucide-copy"
								/>
							</div>
						</div>
						<div>
							<p
								class="mb-1.5 flex items-center justify-between text-[12px] font-semibold text-[var(--ui-text-muted)]"
							>
								<span>Private key (nsec)</span>
								<button
									type="button"
									onclick={() => (revealKey = !revealKey)}
									class="flex items-center gap-1 text-[11px] font-medium text-primary-500"
									><Icon
										name={revealKey ? 'i-lucide-eye-off' : 'i-lucide-eye'}
										class="size-3.5"
									/>{revealKey ? 'Hide' : 'Reveal'}</button
								>
							</p>
							<div class="flex gap-2">
								<Input
									value={revealKey ? me.nsec : '•'.repeat(32)}
									readonly
									class="flex-1 font-mono text-[11.5px]"
								/><Button
									square
									color="neutral"
									variant="subtle"
									onclick={() => copy(me.nsec, 'nsec')}
									icon="i-lucide-copy"
								/>
							</div>
							<p
								class="mt-1.5 flex items-start gap-1.5 text-[11px] text-[var(--tone-warning-text)]"
							>
								<Icon name="i-lucide-triangle-alert" class="mt-px size-3.5 shrink-0" />Never share
								your nsec. Anyone with it controls your identity.
							</p>
						</div>
					</div>
				</div>

				<!-- Relays -->
				<div class="post-card mb-5 p-5">
					<div class="mb-4 flex items-center gap-2">
						<Icon name="i-lucide-radio" class="size-[18px] text-primary-500" />
						<h3 class="text-[15px] font-bold">Relays</h3>
						<span class="ml-auto text-[11px] text-[var(--ui-text-dimmed)]"
							>{relays.list.length} configured</span
						>
					</div>
					<div class="mb-3 flex gap-2">
						<Input
							bind:value={newRelay}
							icon="i-lucide-globe"
							placeholder="wss://relay.example.com"
							class="flex-1 font-mono text-[12.5px]"
						/>
						<Button
							color="primary"
							variant="subtle"
							icon="i-lucide-plus"
							onclick={addRelay}
							disabled={!newRelay.trim()}>Add</Button
						>
						<Button
							color="neutral"
							variant="subtle"
							icon="i-lucide-wifi"
							onclick={testAllRelays}
							disabled={!relays.list.length}>Test all</Button
						>
					</div>
					<ul
						class="divide-y divide-[var(--ui-border-muted)] overflow-hidden rounded-lg border border-[var(--ui-border)]"
					>
						{#each relays.list as r (r.url)}
							<li class="flex items-center gap-2.5 px-3 py-2.5">
								<span
									class="size-2 shrink-0 rounded-full {r.status === 'ok'
										? 'bg-[var(--tone-success-text)]'
										: r.status === 'fail'
											? 'bg-[var(--tone-error-text)]'
											: r.status === 'connecting'
												? 'animate-pulse bg-primary-500'
												: 'bg-[var(--ui-text-dimmed)]'}"
								></span>
								<div class="min-w-0 flex-1 leading-tight">
									<div class="truncate font-mono text-[12px]">{r.url}</div>
									<div class="text-[10.5px] text-[var(--ui-text-dimmed)]">
										{r.read ? 'read' : '—'} · {r.write ? 'write' : '—'}{#if r.latency != null}
											· {r.latency}ms{/if}
										· {formatRelayTime(r.checkedAt)}
									</div>
								</div>
								<div class="flex shrink-0 items-center gap-0.5">
									<button
										type="button"
										onclick={() => testRelay(r.url)}
										disabled={!!testingRelays[r.url]}
										class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] font-semibold text-primary-500 transition hover:bg-primary-500/10 disabled:opacity-60"
									>
										<Icon
											name={testingRelays[r.url] ? 'i-lucide-loader-circle' : 'i-lucide-wifi'}
											class="size-3 {testingRelays[r.url] ? 'animate-spin' : ''}"
										/>
									</button>
									<button
										type="button"
										onclick={() => relays.toggle(r.url, 'read')}
										class="rounded-md px-1.5 py-1 text-[10.5px] font-semibold transition {r.read
											? 'text-primary-500'
											: 'text-[var(--ui-text-dimmed)] hover:bg-[var(--interactive-hover-bg)]'}"
										>R</button
									>
									<button
										type="button"
										onclick={() => relays.toggle(r.url, 'write')}
										class="rounded-md px-1.5 py-1 text-[10.5px] font-semibold transition {r.write
											? 'text-primary-500'
											: 'text-[var(--ui-text-dimmed)] hover:bg-[var(--interactive-hover-bg)]'}"
										>W</button
									>
									<button
										type="button"
										onclick={() => relays.remove(r.url)}
										class="grid size-7 place-items-center rounded-md text-[var(--ui-text-dimmed)] transition hover:bg-[var(--tone-error-bg)] hover:text-[var(--tone-error-text)]"
										><Icon name="i-lucide-trash-2" class="size-4" /></button
									>
								</div>
							</li>
						{/each}
					</ul>
				</div>
			{/if}

			<!-- LANGUAGE -->
			{#if section === 'language'}
				<h2 class="mb-1 font-display text-[24px] font-extrabold">Language & Region</h2>
				<p class="mb-6 text-[13px] text-[var(--ui-text-muted)]">
					Set your language and regional preferences
				</p>
				<div class="post-card mb-5 p-5">
					<h3 class="mb-4 text-[15px] font-bold">Language</h3>
					<div class="space-y-2">
						{#each [{ l: 'English (US)', d: 'Default' }, { l: 'Español' }, { l: 'Français' }, { l: 'Deutsch' }, { l: '日本語' }] as lang, i (lang.l)}
							<label
								class="flex cursor-pointer items-center gap-3 rounded-xl p-3 transition hover:bg-[var(--interactive-hover-bg)]"
							>
								<input type="radio" name="lang" checked={i === 0} class="accent-primary-500" />
								<span class="text-[14px] font-semibold">{lang.l}</span>
								{#if lang.d}<span class="ml-auto text-[11px] text-[var(--ui-text-muted)]"
										>{lang.d}</span
									>{/if}
							</label>
						{/each}
					</div>
				</div>
				<div class="post-card p-5">
					<h3 class="mb-4 text-[15px] font-bold">Region</h3>
					<div class="space-y-3">
						<div>
							<label
								class="mb-1.5 block text-[12px] font-bold tracking-wide text-[var(--ui-text-muted)] uppercase"
								>Time zone</label
							>
							<select
								class="w-full rounded-xl bg-[var(--ui-bg-muted)] px-4 py-2.5 text-[14px] font-semibold outline-none"
								><option>(GMT-08:00) Pacific Time</option><option>(GMT-05:00) Eastern Time</option
								><option>(GMT+00:00) UTC</option><option>(GMT+09:00) Japan Standard Time</option
								></select
							>
						</div>
						<div>
							<label
								class="mb-1.5 block text-[12px] font-bold tracking-wide text-[var(--ui-text-muted)] uppercase"
								>Date format</label
							>
							<select
								class="w-full rounded-xl bg-[var(--ui-bg-muted)] px-4 py-2.5 text-[14px] font-semibold outline-none"
								><option>MM/DD/YYYY</option><option>DD/MM/YYYY</option><option>YYYY-MM-DD</option
								></select
							>
						</div>
					</div>
				</div>
			{/if}

			<!-- HELP -->
			{#if section === 'help'}
				<h2 class="mb-1 font-display text-[24px] font-extrabold">Help & Support</h2>
				<p class="mb-6 text-[13px] text-[var(--ui-text-muted)]">Find answers and get support</p>
				<div class="mb-5 grid grid-cols-2 gap-3">
					{#each [{ i: 'i-lucide-circle-help', c: 'text-primary-500', t: 'Help Center', d: 'Browse guides and FAQs' }, { i: 'i-lucide-headset', c: 'text-accent-500', t: 'Contact Support', d: 'Chat with our team 24/7' }, { i: 'i-lucide-flag', c: 'text-warm-500', t: 'Report a Problem', d: "Tell us what's wrong" }, { i: 'i-lucide-lightbulb', c: 'text-ink', t: 'Feature Request', d: 'Suggest new features' }] as h (h.t)}
						<button
							type="button"
							onclick={() => toasts.info(h.t)}
							class="post-card cursor-pointer p-5 text-left"
						>
							<div class="mb-3 grid size-10 place-items-center rounded-xl bg-current/10">
								<Icon name={h.i} class="size-5 {h.c}" />
							</div>
							<h4 class="mb-1 text-[14px] font-bold">{h.t}</h4>
							<p class="text-[12px] text-[var(--ui-text-muted)]">{h.d}</p>
						</button>
					{/each}
				</div>
				<div class="post-card p-5">
					<h3 class="mb-3 text-[15px] font-bold">Popular articles</h3>
					<div class="space-y-2">
						{#each ['How Nostr identities work', 'Backing up your nsec', 'Understanding relays', 'Sending encrypted DMs (NIP-04)'] as a (a)}
							<button
								type="button"
								class="flex w-full items-center justify-between rounded-lg p-3 text-left transition hover:bg-[var(--interactive-hover-bg)]"
							>
								<span class="text-[13px] font-semibold">{a}</span>
								<Icon name="i-lucide-arrow-right" class="size-3.5 text-[var(--ui-text-dimmed)]" />
							</button>
						{/each}
					</div>
				</div>
			{/if}

			<!-- ABOUT -->
			{#if section === 'about'}
				<h2 class="mb-1 font-display text-[24px] font-extrabold">About</h2>
				<p class="mb-6 text-[13px] text-[var(--ui-text-muted)]">Information about BitOS</p>
				<div class="mb-5 rounded-2xl bg-primary-500 p-6 text-white shadow-[var(--glow-primary)]">
					<div class="mb-3 flex items-center gap-3">
						<div class="grid size-12 place-items-center rounded-2xl bg-white/20 backdrop-blur">
							<span class="font-display text-2xl font-extrabold">B</span>
						</div>
						<div>
							<h3 class="font-display text-[22px] leading-none font-extrabold">BitOS</h3>
							<p class="text-[12px] opacity-90">v0.1 · Nostr client</p>
						</div>
					</div>
					<p class="text-[13px] leading-relaxed opacity-90">
						A local-first, decentralized social client. Your keys never leave this device. Built on
						the open Nostr protocol.
					</p>
				</div>
				<div class="post-card mb-5 p-5">
					<div class="space-y-3">
						{#each ['Terms of Service', 'Privacy Policy', 'Community Guidelines', 'Open Source Licenses'] as l (l)}
							<a
								href="https://github.com/nostr-protocol/nostr"
								target="_blank"
								rel="noreferrer"
								class="flex items-center justify-between py-2 transition hover:text-primary-500 {l !==
								'Terms of Service'
									? 'border-t border-[var(--ui-border-muted)]'
									: ''}"
							>
								<span class="text-[13.5px] font-semibold">{l}</span><Icon
									name="i-lucide-external-link"
									class="size-3.5 text-[var(--ui-text-dimmed)]"
								/>
							</a>
						{/each}
					</div>
				</div>
				<div class="py-4 text-center">
					<p class="text-[12px] text-[var(--ui-text-muted)]">Built on NIP-01 · NIP-04 · NIP-19</p>
					<p class="mt-1 text-[11px] text-[var(--ui-text-dimmed)]">
						Decentralized · censorship-resistant · yours.
					</p>
				</div>
			{/if}
		</div>
	</div>
</div>
