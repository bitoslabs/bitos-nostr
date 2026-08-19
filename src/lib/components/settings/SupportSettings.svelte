<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import SectionCard from '$lib/components/settings/SectionCard.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import type { SettingsSectionKey } from '$lib/settings/sections';
	import SupportWidget from '$lib/components/support/SupportWidget.svelte';
	import ContributorsWidget from '$lib/components/support/ContributorsWidget.svelte';

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

	const APP_VERSION = __APP_VERSION__;
	const logo = '/icons/icon-192-192.png';
	const launchDate = 'August 8, 2026';

	const aboutDetails = [
		{ icon: 'i-lucide-tag', label: 'Version', value: APP_VERSION },
		{ icon: 'i-lucide-rocket', label: 'Launch', value: launchDate },
		{ icon: 'i-lucide-radio-tower', label: 'Network', value: 'Nostr' },
		{ icon: 'i-lucide-shield-check', label: 'Identity', value: 'Local (nsec)' },
		{ icon: 'i-lucide-scale', label: 'License', value: 'Open source' }
	];

	const aboutLinks = [
		{
			label: 'About BitOS',
			href: '/about',
			icon: 'i-lucide-info',
			color: 'text-primary-500',
			external: false,
			hint: 'What is Nostr?'
		},
		{
			label: 'Privacy Policy',
			href: '/privacy',
			icon: 'i-lucide-lock',
			color: 'text-accent-500',
			external: false,
			hint: ''
		},
		{
			label: 'Terms of Service',
			href: '/terms',
			icon: 'i-lucide-file-text',
			color: 'text-warm-500',
			external: false,
			hint: ''
		},
		{
			label: 'Source code',
			href: 'https://github.com/bitoslabs/bitos-svelte',
			icon: 'i-lucide-github',
			color: 'text-[var(--ui-text-muted)]',
			external: true,
			hint: 'bitoslabs/bitos-svelte'
		},
		{
			label: 'Website',
			href: 'https://bitos.space',
			icon: 'i-lucide-globe',
			color: 'text-[var(--ui-text-muted)]',
			external: true,
			hint: 'bitos.space'
		},
		{
			label: 'Nostr protocol',
			href: 'https://github.com/nostr-protocol/nips',
			icon: 'i-lucide-radio-tower',
			color: 'text-[var(--ui-text-muted)]',
			external: true,
			hint: 'NIPs'
		}
	];
</script>

{#if section === 'language'}
	<h2 class="mb-1 font-display text-[24px] font-extrabold">Language & Region</h2>
	<p class="mb-6 text-[13px] text-[var(--ui-text-muted)]">
		Set your language and regional preferences
	</p>
	<SectionCard title="Language" class="mb-5">
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
	</SectionCard>
	<SectionCard title="Region">
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
	</SectionCard>
{/if}

{#if section === 'help'}
	<h2 class="mb-1 font-display text-[24px] font-extrabold">Help & Support</h2>
	<p class="mb-6 text-[13px] text-[var(--ui-text-muted)]">Find answers and get support</p>
	<SectionCard
		title="Get help"
		icon="i-lucide-circle-help"
		description="Browse guides, reach the team, or report issues"
		class="mb-5"
	>
		<div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
			{#each helpCards as h (h.t)}
				<button
					type="button"
					onclick={() => toasts.info(h.t)}
					class="group flex items-center gap-3.5 rounded-xl border border-[var(--ui-border-muted)] p-3.5 text-left transition hover:border-primary-500/25 hover:bg-[var(--interactive-hover-bg)]"
				>
					<span class="hex-clip grid size-10 shrink-0 place-items-center bg-current/10">
						<Icon name={h.i} class="size-5 {h.c}" />
					</span>
					<span class="min-w-0 flex-1">
						<span class="block text-[13.5px] font-bold">{h.t}</span>
						<span class="block text-[11.5px] text-[var(--ui-text-muted)]">{h.d}</span>
					</span>
					<Icon
						name="i-lucide-chevron-right"
						class="size-4 shrink-0 text-[var(--ui-text-dimmed)] opacity-60 transition group-hover:translate-x-0.5"
					/>
				</button>
			{/each}
		</div>
	</SectionCard>
	<SectionCard title="Popular articles">
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
	</SectionCard>
{/if}

{#if section === 'about'}
	<h2 class="mb-1 font-display text-[24px] font-extrabold">About</h2>
	<p class="mb-6 text-[13px] text-[var(--ui-text-muted)]">Information about BitOS</p>
	<div class="mb-5">
		<SupportWidget compact />
	</div>
	<div class="mb-5">
		<ContributorsWidget compact />
	</div>

	<!-- Hero -->
	<div
		class="relative mb-5 overflow-hidden rounded-2xl bg-primary-500 p-6 text-white shadow-[var(--glow-primary)]"
	>
		<div
			class="pointer-events-none absolute -top-12 -right-10 size-40 rounded-full bg-white/15 blur-2xl"
		></div>
		<div class="relative mb-3 flex items-center gap-3">
			<div class="size-12 overflow-hidden rounded-2xl bg-white/20 p-1.5 backdrop-blur">
				<img src={logo} alt="BitOS logo" class="size-full rounded-[1rem] object-cover" />
			</div>
			<div>
				<h3 class="font-display text-[22px] leading-none font-extrabold">BitOS</h3>
				<p class="text-[12px] opacity-90">v{APP_VERSION} · Nostr client</p>
				<p class="mt-1 text-[11px] opacity-80">Launches {launchDate}</p>
			</div>
		</div>
		<p class="relative text-[13px] leading-relaxed opacity-95">
			A local-first, decentralized social client. Your keys never leave this device. Built on the
			open Nostr protocol.
		</p>
		<div class="relative mt-5 flex flex-wrap gap-2">
			<a
				href="https://github.com/bitoslabs/bitos-svelte"
				target="_blank"
				rel="noreferrer"
				class="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-[12px] font-bold backdrop-blur transition hover:bg-white/25"
			>
				<Icon name="i-lucide-github" class="size-3.5" />
				Source
			</a>
			<a
				href="https://bitos.space"
				target="_blank"
				rel="noreferrer"
				class="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-[12px] font-bold backdrop-blur transition hover:bg-white/25"
			>
				<Icon name="i-lucide-globe" class="size-3.5" />
				bitos.space
			</a>
			<a
				href="/about"
				class="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-[12px] font-bold backdrop-blur transition hover:bg-white/25"
			>
				<Icon name="i-lucide-info" class="size-3.5" />
				Learn more
			</a>
		</div>
	</div>

	<!-- App details -->
	<SectionCard bodyClass="p-1.5" class="mb-5">
		{#each aboutDetails as d, i (d.label)}
			<div
				class="flex items-center gap-3 px-3.5 py-3 {i !== 0
					? 'border-t border-[var(--ui-border-muted)]'
					: ''}"
			>
				<Icon name={d.icon} class="size-4 shrink-0 text-[var(--ui-text-dimmed)]" />
				<dt class="text-[13px] text-[var(--ui-text-muted)]">{d.label}</dt>
				<dd class="ml-auto text-right text-[13px] font-semibold text-[var(--ui-text)]">
					{d.value}
				</dd>
			</div>
		{/each}
	</SectionCard>

	<!-- Links -->
	<SectionCard bodyClass="p-1.5" class="mb-5">
		{#each aboutLinks as l, i (l.label)}
			<a
				href={l.href}
				target={l.external ? '_blank' : undefined}
				rel={l.external ? 'noreferrer' : undefined}
				class="group flex items-center gap-3 px-3.5 py-3 transition hover:bg-[var(--interactive-hover-bg)] {i !==
				0
					? 'border-t border-[var(--ui-border-muted)]'
					: ''}"
			>
				<Icon name={l.icon} class="size-4 shrink-0 {l.color}" />
				<span class="text-[13.5px] font-semibold text-[var(--ui-text)]">{l.label}</span>
				<span class="ml-auto flex items-center gap-1 text-[11.5px] text-[var(--ui-text-dimmed)]">
					{#if l.hint}{l.hint}{/if}
					<Icon
						name={l.external ? 'i-lucide-external-link' : 'i-lucide-chevron-right'}
						class="size-3.5 transition group-hover:translate-x-0.5"
					/>
				</span>
			</a>
		{/each}
	</SectionCard>

	<div class="py-4 text-center">
		<p class="text-[12px] text-[var(--ui-text-muted)]">
			Built on NIP-01 · NIP-04 · NIP-19 · NIP-25 · NIP-38 · NIP-57
		</p>
		<p class="mt-1 text-[11px] text-[var(--ui-text-dimmed)]">
			Decentralized · censorship-resistant · yours.
		</p>
	</div>
{/if}
