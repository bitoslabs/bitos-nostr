<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import HexIcon from '$lib/components/ui/HexIcon.svelte';
	import HexMark from '$lib/components/ui/HexMark.svelte';
	import SupportWidget from '$lib/components/support/SupportWidget.svelte';
	import ContributorsWidget from '$lib/components/support/ContributorsWidget.svelte';

	const features = [
		{
			icon: 'i-lucide-shield-check',
			title: 'Local-first identity',
			body: 'Your private key is generated and stored on your device. There is no signup, no email, and no password to forget — and no server that can lose or leak it.'
		},
		{
			icon: 'i-lucide-radio-tower',
			title: 'Open relays',
			body: 'BitOS speaks the Nostr protocol and connects to relays you choose. Add, remove, or switch relays any time — your social graph belongs to you, not a silo.'
		},
		{
			icon: 'i-lucide-lock',
			title: 'Encrypted messages',
			body: 'Direct messages are end-to-end encrypted on your device (NIP-04) before they ever touch a relay.'
		},
		{
			icon: 'i-lucide-images',
			title: 'Stories & media',
			body: 'Ephemeral 24-hour stories, image and video posts, and a discover grid — all published as standard Nostr events.'
		},
		{
			icon: 'i-lucide-zap',
			title: 'Value, peer-to-peer',
			body: 'Send sats over the Lightning Network natively. Nostr makes money a first-class interaction, not an afterthought.'
		},
		{
			icon: 'i-lucide-palette',
			title: 'Premium, private UX',
			body: 'A calm, Apple-faithful interface with light/dark themes, no trackers, and no ads — ever.'
		}
	];

	const version = `v${__APP_VERSION__}`;
	const launchDate = 'August 8, 2026';
</script>

<svelte:head><title>About · BitOS</title></svelte:head>

<!-- Hero -->
<section class="text-center">
	<h1 class="sr-only">BitOS</h1>
	<!-- Brand mark in the shell's hex language: gradient border ring +
	     inner surface carrying the B + bolt symbol (same treatment as the
	     /more page tiles). -->
	<div class="mx-auto mb-5 grid size-16 place-items-center">
		<HexIcon size={64} class="p-[3px] shadow-[var(--glow-primary)]">
			<HexMark badge={false} size={40} />
		</HexIcon>
	</div>
	<p
		class="mt-2 inline-flex items-center rounded-full border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-3 py-1 text-[11px] font-semibold tracking-[0.16em] text-[var(--ui-text-muted)] uppercase"
	>
		{version}
	</p>
	<p class="mt-2 text-[12px] font-medium text-[var(--ui-text-dimmed)]">Launches {launchDate}</p>
	<p class="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-[var(--ui-text-muted)]">
		A <strong class="text-[var(--ui-text)]">local-first</strong> social client for the
		<strong class="text-[var(--ui-text)]">Nostr</strong> protocol. Your keys never leave your device —
		there is no central server, no company holding your account, and no lock-in.
	</p>
	<div class="mt-6 flex flex-wrap items-center justify-center gap-2.5">
		<a
			href="/"
			class="inline-flex items-center gap-2 rounded-full bg-primary-500 px-5 py-2.5 text-[13px] font-bold text-white shadow-[var(--glow-primary)] transition hover:bg-primary-600"
		>
			<Icon name="i-lucide-arrow-right" class="size-4" />
			Open BitOS
		</a>
		<a
			href="https://github.com/bitoslabs/bitos-svelte"
			target="_blank"
			rel="noreferrer"
			class="inline-flex items-center gap-2 rounded-full border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-5 py-2.5 text-[13px] font-bold text-[var(--ui-text)] transition hover:border-primary-500/40 hover:text-primary-500"
		>
			<Icon name="i-lucide-github" class="size-4" />
			Source code
		</a>
		<a
			href="https://bitos.space"
			target="_blank"
			rel="noreferrer"
			class="inline-flex items-center gap-2 rounded-full border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-5 py-2.5 text-[13px] font-bold text-[var(--ui-text)] transition hover:border-primary-500/40 hover:text-primary-500"
		>
			<Icon name="i-lucide-globe" class="size-4" />
			bitos.space
		</a>
	</div>
</section>

<section class="mt-12">
	<SupportWidget />
</section>

<section class="mt-5">
	<ContributorsWidget />
</section>

<!-- What is Nostr -->
<section class="mt-14">
	<h2 class="font-display text-[20px] font-bold tracking-tight">What is Nostr?</h2>
	<p class="mt-3 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
		<strong class="text-[var(--ui-text)]">Nostr</strong> (“Notes and Other Stuff Transmitted by
		Relays”) is a simple, open protocol for censorship-resistant social networking. Instead of one
		company’s servers, notes are signed by your cryptographic key and passed around by
		<strong class="text-[var(--ui-text)]">relays</strong> — independent servers that anyone can run.
	</p>
	<p class="mt-3 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
		Because your identity is just a keypair, you can move between Nostr clients freely, taking your
		follows, posts, and messages with you. BitOS is one such client — a window onto the open Nostr
		network, with a focus on a calm, private, premium experience.
	</p>
</section>

<!-- Features -->
<section class="mt-12">
	<h2 class="font-display text-[20px] font-bold tracking-tight">What makes BitOS different</h2>
	<div class="mt-5 grid gap-3 sm:grid-cols-2">
		{#each features as f (f.title)}
			<div
				class="surface-card group rounded-2xl p-4 transition hover:shadow-[var(--shadow-card-hover)]"
			>
				<HexIcon icon={f.icon} size={36} iconClass="size-[18px]" interactive class="mb-2.5" />
				<h3 class="text-[14px] font-bold">{f.title}</h3>
				<p class="mt-1 text-[12.5px] leading-relaxed text-[var(--ui-text-muted)]">{f.body}</p>
			</div>
		{/each}
	</div>
</section>

<!-- Open source -->
<section
	class="mt-12 rounded-2xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] p-5"
>
	<div class="flex flex-wrap items-center gap-4">
		<div class="min-w-0 flex-1">
			<h2 class="font-display text-[17px] font-bold tracking-tight">Open source & self-hostable</h2>
			<p class="mt-1 text-[13px] leading-relaxed text-[var(--ui-text-muted)]">
				BitOS is open source. Read the code, run it yourself, or contribute on GitHub.
			</p>
			<p class="mt-2 text-[12px] text-[var(--ui-text-dimmed)]">Public launch: {launchDate}</p>
		</div>
		<a
			href="https://github.com/bitoslabs/bitos-svelte"
			target="_blank"
			rel="noreferrer"
			class="inline-flex shrink-0 items-center gap-2 rounded-full bg-primary-500 px-4 py-2 text-[12.5px] font-bold text-white transition hover:bg-primary-600"
		>
			<Icon name="i-lucide-github" class="size-4" />
			bitoslabs/bitos-svelte
		</a>
	</div>
</section>

<!-- Legal -->
<section class="mt-10 rounded-2xl bg-[var(--ui-bg-muted)] p-5 text-center">
	<p class="text-[13px] text-[var(--ui-text-muted)]">
		By using BitOS you agree to our
		<a href="/terms" class="font-bold text-primary-500 hover:underline">Terms</a>
		and
		<a href="/privacy" class="font-bold text-primary-500 hover:underline">Privacy Policy</a>.
	</p>
</section>
