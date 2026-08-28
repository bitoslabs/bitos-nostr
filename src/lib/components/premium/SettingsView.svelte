<script lang="ts">
	import PageHeader from '$lib/components/premium/PageHeader.svelte';
	import SettingRow from '$lib/components/premium/SettingRow.svelte';
	import Toggle from '$lib/components/ui/Toggle.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { cn } from '$lib/utils/cn';

	type SectionId = 'account' | 'lightning' | 'privacy' | 'appearance' | 'network' | 'keys' | 'about';

	const sections: { id: SectionId; label: string; icon: string }[] = [
		{ id: 'account', label: 'Account', icon: 'i-lucide-user' },
		{ id: 'lightning', label: 'Lightning', icon: 'i-lucide-zap' },
		{ id: 'privacy', label: 'Privacy', icon: 'i-lucide-shield-check' },
		{ id: 'appearance', label: 'Appearance', icon: 'i-lucide-palette' },
		{ id: 'network', label: 'Network', icon: 'i-lucide-network' },
		{ id: 'keys', label: 'Keys', icon: 'i-lucide-key-round' },
		{ id: 'about', label: 'About', icon: 'i-lucide-info' }
	];

	let active = $state<SectionId>('account');
	let prefs = $state({
		reactions: true,
		anonZaps: false,
		autoZapFollow: false,
		refuseLowPow: true,
		dmEncryption: true,
		showEventIds: true,
		showPowBadges: true
	});
	let powDefault = $state('20');
	let revealed = $state(false);

	const inputCls =
		'w-full rounded-xl border border-[var(--ui-border-muted)] bg-[var(--interactive-hover-bg)] px-3.5 py-2.5 text-sm outline-none focus:border-[var(--ui-color-primary-500)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--ui-color-primary-500)_20%,transparent)]';
</script>

<PageHeader title="Settings" />

<div class="grid min-h-[calc(100vh-60px)] grid-cols-[220px_1fr] max-[820px]:grid-cols-1">
	<!-- Section nav -->
	<aside class="border-r border-[var(--ui-border-muted)] py-3.5 max-[820px]:border-r-0 max-[820px]:border-b">
		<nav class="flex flex-col">
			{#each sections as s (s.id)}
				<button
					type="button"
					onclick={() => (active = s.id)}
					class={cn(
						'flex items-center gap-2.5 border-l-2 px-4 py-3 text-left text-sm font-medium transition-all',
						active === s.id
							? 'border-l-[var(--ui-color-primary-500)] bg-[color-mix(in_oklab,var(--ui-color-primary-500)_10%,transparent)] text-[var(--ui-color-primary-500)]'
							: 'border-l-transparent text-[var(--ui-text-muted)] hover:bg-[var(--interactive-hover-bg)]'
					)}
				>
					<Icon name={s.icon} class="size-4" />{s.label}
				</button>
			{/each}
		</nav>
	</aside>

	<div class="p-4">
		<!-- ACCOUNT -->
		{#if active === 'account'}
			<div class="premium-card mb-3.5 p-4">
				<h3 class="mb-3.5 text-base font-bold">Profile</h3>
				<div class="mb-4 flex gap-4">
					<img src="https://picsum.photos/seed/me42/200/200.jpg" alt="" class="hex-clip size-20 object-cover" />
					<div class="flex-1">
						<button type="button" class="rounded-full border border-[var(--ui-border-accented)] px-3.5 py-2 text-sm transition hover:bg-[var(--interactive-hover-bg)]">Change Avatar</button>
						<div class="mt-1.5 text-[11px] text-[var(--ui-text-muted)]">Hex-cropped · stored on nostr.build</div>
					</div>
				</div>
				<label class="mb-3 block">
					<span class="mb-1.5 block text-xs text-[var(--ui-text-muted)]">Display Name</span>
					<input value="Volt Dorsey" class={inputCls} />
				</label>
				<label class="mb-3 block">
					<span class="mb-1.5 block text-xs text-[var(--ui-text-muted)]">Username (handle)</span>
					<input value="volt" class={cn(inputCls, 'font-mono')} />
				</label>
				<label class="block">
					<span class="mb-1.5 block text-xs text-[var(--ui-text-muted)]">Bio</span>
					<textarea rows="3" class={inputCls}>Building decentralized social on Nostr. ⚡</textarea>
				</label>
			</div>
			<div class="premium-card p-4">
				<h3 class="mb-2 text-base font-bold">NIP-05 Verification</h3>
				<p class="mb-3.5 text-sm leading-relaxed text-[var(--ui-text-muted)]">Verify your identity with a domain. Adds a green checkmark to your profile.</p>
				<div class="flex items-center gap-3 rounded-xl border border-[color-mix(in_oklab,var(--tone-success-text)_22%,transparent)] bg-[color-mix(in_oklab,var(--tone-success-text)_6%,transparent)] p-3">
					<Icon name="i-lucide-badge-check" class="size-5 text-[var(--tone-success-text)]" />
					<div class="flex-1">
						<div class="text-sm font-semibold">volt@nostr.directory</div>
						<div class="text-[11px] text-[var(--ui-text-muted)]">Verified · expires in 287 days</div>
					</div>
					<button type="button" class="rounded-full border border-[var(--ui-border-accented)] px-3 py-1.5 text-xs transition hover:bg-[var(--interactive-hover-bg)]">Renew</button>
				</div>
			</div>
		{:else if active === 'lightning'}
			<div class="premium-card mb-3.5 p-4">
				<h3 class="mb-3.5 text-base font-bold">Wallet Connection</h3>
				<div class="flex items-center gap-3.5 rounded-xl border border-[color-mix(in_oklab,var(--ui-color-primary-500)_22%,transparent)] bg-[color-mix(in_oklab,var(--ui-color-primary-500)_6%,transparent)] p-3.5">
					<span class="hex-clip grid size-10 place-items-center bg-[linear-gradient(135deg,var(--ui-color-primary-500),var(--color-warm-500))] text-black"><Icon name="i-lucide-zap" class="size-5" /></span>
					<div class="flex-1">
						<div class="text-sm font-semibold">Alby Wallet</div>
						<div class="font-mono text-xs text-[var(--ui-text-muted)]">connected · 12,847 sats</div>
					</div>
					<button type="button" class="rounded-full border border-[var(--ui-border-accented)] px-3 py-1.5 text-xs transition hover:bg-[var(--interactive-hover-bg)]">Disconnect</button>
				</div>
			</div>
			<div class="premium-card mb-3.5 p-4">
				<h3 class="mb-3.5 text-base font-bold">Default Zap Amounts</h3>
				<div class="grid grid-cols-4 gap-2">
					{#each [21, 100, 500, 1000] as amt (amt)}
						<input value={amt} type="number" class="rounded-xl border border-[var(--ui-border-muted)] bg-[var(--interactive-hover-bg)] px-3.5 py-2.5 text-center font-mono text-sm outline-none focus:border-[var(--ui-color-primary-500)]" />
					{/each}
				</div>
			</div>
			<div class="premium-card flex flex-col gap-3.5 p-4">
				<h3 class="text-base font-bold">Zap Preferences</h3>
				<SettingRow label="Non-zap reactions" hint="Allow likes/reposts without zaps">
					<Toggle checked={prefs.reactions} onToggle={(v) => (prefs = { ...prefs, reactions: v })} />
				</SettingRow>
				<SettingRow label="Anonymous zaps" hint="Send zaps without revealing npub">
					<Toggle checked={prefs.anonZaps} onToggle={(v) => (prefs = { ...prefs, anonZaps: v })} />
				</SettingRow>
				<SettingRow label="Auto-zap on follow" hint="Send 21 sats when following someone">
					<Toggle checked={prefs.autoZapFollow} onToggle={(v) => (prefs = { ...prefs, autoZapFollow: v })} />
				</SettingRow>
			</div>
		{:else if active === 'privacy'}
			<div class="premium-card mb-3.5 p-4">
				<h3 class="mb-3.5 text-base font-bold">Note Privacy</h3>
				<SettingRow label="Default PoW difficulty" hint="Mine every note with at least N bits">
					<select bind:value={powDefault} class="rounded-xl border border-[var(--ui-border-muted)] bg-[var(--interactive-hover-bg)] px-3 py-2 font-mono text-sm outline-none">
						{#each ['0', '16', '20', '24', '28', '32'] as b (b)}<option value={b}>{b} bits</option>{/each}
					</select>
				</SettingRow>
				<div class="mt-3.5">
					<SettingRow label="Refuse low-PoW notes" hint="Hide incoming notes below 8 bits">
						<Toggle checked={prefs.refuseLowPow} onToggle={(v) => (prefs = { ...prefs, refuseLowPow: v })} />
					</SettingRow>
				</div>
			</div>
			<div class="premium-card mb-3.5 p-4">
				<h3 class="mb-3.5 text-base font-bold">Direct Messages</h3>
				<SettingRow label="Who can DM me" hint="Receive encrypted messages from">
					<select class="rounded-xl border border-[var(--ui-border-muted)] bg-[var(--interactive-hover-bg)] px-3 py-2 text-sm outline-none"><option>Everyone</option><option>Followed only</option><option>Nobody</option></select>
				</SettingRow>
				<div class="mt-3.5">
					<SettingRow label="DM encryption" hint="Use NIP-44 (recommended)">
						<Toggle checked={prefs.dmEncryption} onToggle={(v) => (prefs = { ...prefs, dmEncryption: v })} />
					</SettingRow>
				</div>
			</div>
			<div class="premium-card p-4">
				<h3 class="mb-3.5 text-base font-bold">Spam & Muting</h3>
				<SettingRow label="Muted pubkeys" hint="14 pubkeys currently muted">
					<button type="button" class="rounded-full border border-[var(--ui-border-accented)] px-3 py-1.5 text-xs transition hover:bg-[var(--interactive-hover-bg)]">Manage</button>
				</SettingRow>
				<div class="mt-3.5">
					<SettingRow label="Word muting" hint="Filter notes containing specific words">
						<button type="button" class="rounded-full border border-[var(--ui-border-accented)] px-3 py-1.5 text-xs transition hover:bg-[var(--interactive-hover-bg)]">Edit list</button>
					</SettingRow>
				</div>
			</div>
		{:else if active === 'appearance'}
			<div class="premium-card mb-3.5 p-4">
				<h3 class="mb-3.5 text-base font-bold">Theme</h3>
				<div class="grid grid-cols-3 gap-2.5">
					{#each [['Obsidian', true], ['Midnight', false], ['Lightning', false]] as [name, on] (name)}
						<button type="button" class={cn('rounded-xl p-3.5 text-left transition', on ? 'border-2 border-[var(--ui-color-primary-500)] bg-[color-mix(in_oklab,var(--ui-color-primary-500)_6%,transparent)]' : 'border border-[var(--ui-border-muted)]')}>
							<div class="mb-2 h-12 rounded-lg bg-[linear-gradient(135deg,var(--ui-bg),var(--surface-bg-soft))]"></div>
							<div class="text-sm font-semibold">{name}</div>
							{#if on}<div class="text-[11px] text-[var(--ui-color-primary-500)]">Current</div>{/if}
						</button>
					{/each}
				</div>
			</div>
			<div class="premium-card p-4">
				<h3 class="mb-3.5 text-base font-bold">Layout</h3>
				<SettingRow label="Show event IDs">
					<Toggle checked={prefs.showEventIds} onToggle={(v) => (prefs = { ...prefs, showEventIds: v })} />
				</SettingRow>
				<div class="mt-3.5">
					<SettingRow label="Show PoW badges">
						<Toggle checked={prefs.showPowBadges} onToggle={(v) => (prefs = { ...prefs, showPowBadges: v })} />
					</SettingRow>
				</div>
			</div>
		{:else if active === 'network'}
			<div class="premium-card mb-3.5 p-4">
				<h3 class="mb-3.5 text-base font-bold">Connection</h3>
				<SettingRow label="Max concurrent relay connections" hint="Higher uses more memory">
					<select class="rounded-xl border border-[var(--ui-border-muted)] bg-[var(--interactive-hover-bg)] px-3 py-2 font-mono text-sm outline-none">{#each ['4', '8', '16', '32'] as c (c)}<option>{c}</option>{/each}</select>
				</SettingRow>
				<div class="mt-3.5">
					<SettingRow label="Local cache size" hint="Currently 2.3GB used">
						<button type="button" class="rounded-full border border-[var(--ui-border-accented)] px-3 py-1.5 text-xs transition hover:bg-[var(--interactive-hover-bg)]">Clear Cache</button>
					</SettingRow>
				</div>
			</div>
			<div class="premium-card p-4">
				<h3 class="mb-3.5 text-base font-bold">Subscriptions</h3>
				<p class="mb-3.5 text-sm text-[var(--ui-text-muted)]">Control which event kinds you receive from relays.</p>
				<div class="flex flex-wrap gap-2">
					{#each ['kind:1 Text notes', 'kind:3 Contacts', 'kind:4 DMs', 'kind:9735 Zaps', 'kind:30023 Articles'] as k (k)}
						<span class="inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_oklab,var(--tone-success-text)_22%,transparent)] bg-[color-mix(in_oklab,var(--tone-success-text)_10%,transparent)] px-3 py-1.5 font-mono text-[11px] text-[var(--tone-success-text)]"><Icon name="i-lucide-check" class="size-3" />{k}</span>
					{/each}
				</div>
			</div>
		{:else if active === 'keys'}
			<div class="premium-card mb-3.5 border-[color-mix(in_oklab,var(--tone-warning-text)_25%,transparent)] p-4">
				<div class="mb-3 flex items-center gap-2">
					<Icon name="i-lucide-triangle-alert" class="size-5 text-[var(--tone-warning-text)]" />
					<h3 class="text-base font-bold">Secret Key (nsec)</h3>
				</div>
				<p class="mb-3.5 text-sm leading-relaxed text-[var(--ui-text-muted)]">Your private key controls your identity. Never share it. Back it up securely offline.</p>
				<div class="mb-3 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--interactive-hover-bg)] p-3">
					<button type="button" onclick={() => (revealed = !revealed)} class="block w-full text-left">
						<span class="font-mono text-xs text-[var(--tone-warning-text)] break-all transition" style="filter:{revealed ? 'none' : 'blur(6px)'}">nsec1volt0dsey4f7k2m8x3q9r2p7n3k8s5t4u8v9w2x3y4z5a6b7c8d9e0f1g2h3i4j5k6l7m8n9o0p1q2r3s4t5</span>
					</button>
					<div class="mt-2 text-center text-[11px] text-[var(--ui-text-muted)]">{revealed ? 'Click to hide' : 'Click to reveal · be careful with screenshots'}</div>
				</div>
				<div class="flex gap-2">
					<button type="button" class="rounded-full border border-[var(--ui-border-accented)] px-3.5 py-2 text-sm transition hover:bg-[var(--interactive-hover-bg)]"><Icon name="i-lucide-download" class="mr-1.5 inline size-3.5" />Export Encrypted</button>
					<button type="button" class="rounded-full border border-[var(--ui-border-accented)] px-3.5 py-2 text-sm transition hover:bg-[var(--interactive-hover-bg)]"><Icon name="i-lucide-qr-code" class="mr-1.5 inline size-3.5" />Show QR</button>
				</div>
			</div>
			<div class="premium-card p-4">
				<h3 class="mb-3.5 text-base font-bold">Public Key (npub)</h3>
				<div class="mb-3 rounded-lg border border-[var(--ui-border-muted)] bg-[var(--interactive-hover-bg)] p-3 font-mono text-[11px] leading-relaxed text-[var(--tone-info-text)] break-all">npub1volt0dsey4f7k2m8x3q9r2p7n3k8s5t4u8v9w2x3y4z5a6b7c8d9e0f1g2h3i4j5k6l7m8n9o0p1q2r3s4t5</div>
				<button type="button" class="rounded-full border border-[var(--ui-border-accented)] px-3.5 py-2 text-sm transition hover:bg-[var(--interactive-hover-bg)]"><Icon name="i-lucide-copy" class="mr-1.5 inline size-3.5" />Copy npub</button>
			</div>
		{:else}
			<div class="premium-card mb-3.5 p-4 text-center">
				<span class="hex-clip mx-auto mb-3.5 grid size-14 place-items-center bg-[linear-gradient(135deg,var(--ui-color-primary-500),var(--color-warm-500))] text-black"><Icon name="i-lucide-zap" class="size-6" /></span>
				<h2 class="text-xl font-bold">nostr client</h2>
				<div class="mb-3.5 mt-1 font-mono text-xs text-[var(--ui-text-muted)]">version {__APP_VERSION__} · built on NIP-01</div>
				<p class="mx-auto mb-4 max-w-sm text-sm leading-relaxed text-[var(--ui-text-muted)]">Open-source Nostr client. MIT licensed. Built with respect for the protocol and the people on it.</p>
				<div class="flex justify-center gap-2">
					<button type="button" class="rounded-full border border-[var(--ui-border-accented)] px-3.5 py-2 text-xs transition hover:bg-[var(--interactive-hover-bg)]"><Icon name="i-lucide-github" class="mr-1.5 inline size-3.5" />Source</button>
					<button type="button" class="rounded-full border border-[var(--ui-border-accented)] px-3.5 py-2 text-xs transition hover:bg-[var(--interactive-hover-bg)]"><Icon name="i-lucide-book-open" class="mr-1.5 inline size-3.5" />NIPs</button>
				</div>
			</div>
			<div class="premium-card p-4">
				<h3 class="mb-3 text-sm font-bold">Supported NIPs</h3>
				<div class="flex flex-wrap gap-1.5">
					{#each ['NIP-01', 'NIP-02', 'NIP-04', 'NIP-05', 'NIP-09', 'NIP-13', 'NIP-19', 'NIP-21', 'NIP-25', 'NIP-40', 'NIP-44', 'NIP-57', 'NIP-65'] as nip (nip)}
						<span class="rounded-full border border-[var(--ui-border-muted)] bg-[var(--interactive-hover-bg)] px-2 py-1 font-mono text-[10px] text-[var(--ui-text-muted)]">{nip}</span>
					{/each}
				</div>
			</div>
		{/if}
	</div>
</div>
