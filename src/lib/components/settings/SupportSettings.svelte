<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import type { SettingsSectionKey } from '$lib/settings/sections';

	type Props = {
		section: Extract<SettingsSectionKey, 'language' | 'help' | 'about'>;
	};

	let { section }: Props = $props();

	const languages = [
		{ l: 'English (US)', d: 'Default' },
		{ l: 'Español' },
		{ l: 'Français' },
		{ l: 'Deutsch' },
		{ l: '日本語' }
	];

	const helpCards = [
		{
			i: 'i-lucide-circle-help',
			c: 'text-primary-500',
			t: 'Help Center',
			d: 'Browse guides and FAQs'
		},
		{
			i: 'i-lucide-headset',
			c: 'text-accent-500',
			t: 'Contact Support',
			d: 'Chat with our team 24/7'
		},
		{ i: 'i-lucide-flag', c: 'text-warm-500', t: 'Report a Problem', d: "Tell us what's wrong" },
		{ i: 'i-lucide-lightbulb', c: 'text-ink', t: 'Feature Request', d: 'Suggest new features' }
	];

	const popularArticles = [
		'How Nostr identities work',
		'Backing up your nsec',
		'Understanding relays',
		'Sending encrypted DMs (NIP-04)'
	];

	const legalLinks = [
		'Terms of Service',
		'Privacy Policy',
		'Community Guidelines',
		'Open Source Licenses'
	];
</script>

{#if section === 'language'}
	<h2 class="mb-1 font-display text-[24px] font-extrabold">Language & Region</h2>
	<p class="mb-6 text-[13px] text-[var(--ui-text-muted)]">
		Set your language and regional preferences
	</p>
	<div class="post-card mb-5 p-5">
		<h3 class="mb-4 text-[15px] font-bold">Language</h3>
		<div class="space-y-2">
			{#each languages as lang, i (lang.l)}
				<label
					class="flex cursor-pointer items-center gap-3 rounded-xl p-3 transition hover:bg-[var(--interactive-hover-bg)]"
				>
					<input type="radio" name="lang" checked={i === 0} class="accent-primary-500" />
					<span class="text-[14px] font-semibold">{lang.l}</span>
					{#if lang.d}<span class="ml-auto text-[11px] text-[var(--ui-text-muted)]">{lang.d}</span
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
					for="settings-time-zone"
					class="mb-1.5 block text-[12px] font-bold tracking-wide text-[var(--ui-text-muted)] uppercase"
					>Time zone</label
				>
				<select
					id="settings-time-zone"
					class="w-full rounded-xl bg-[var(--ui-bg-muted)] px-4 py-2.5 text-[14px] font-semibold outline-none"
					><option>(GMT-08:00) Pacific Time</option><option>(GMT-05:00) Eastern Time</option><option
						>(GMT+00:00) UTC</option
					><option>(GMT+09:00) Japan Standard Time</option></select
				>
			</div>
			<div>
				<label
					for="settings-date-format"
					class="mb-1.5 block text-[12px] font-bold tracking-wide text-[var(--ui-text-muted)] uppercase"
					>Date format</label
				>
				<select
					id="settings-date-format"
					class="w-full rounded-xl bg-[var(--ui-bg-muted)] px-4 py-2.5 text-[14px] font-semibold outline-none"
					><option>MM/DD/YYYY</option><option>DD/MM/YYYY</option><option>YYYY-MM-DD</option></select
				>
			</div>
		</div>
	</div>
{/if}

{#if section === 'help'}
	<h2 class="mb-1 font-display text-[24px] font-extrabold">Help & Support</h2>
	<p class="mb-6 text-[13px] text-[var(--ui-text-muted)]">Find answers and get support</p>
	<div class="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
		{#each helpCards as h (h.t)}
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
			{#each popularArticles as a (a)}
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
			A local-first, decentralized social client. Your keys never leave this device. Built on the
			open Nostr protocol.
		</p>
	</div>
	<div class="post-card mb-5 p-5">
		<div class="space-y-3">
			{#each legalLinks as l (l)}
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
