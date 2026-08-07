<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { identity } from '$lib/nostr/identity.svelte';

	/**
	 * Shell for public, pre-login pages (About / Privacy / Terms). Renders a
	 * sticky BitOS top bar with section nav, the page body, and a shared footer
	 * with the GitHub source, website, and cross-links. Works whether or not a
	 * user is signed in.
	 */
	let { children }: { children?: Snippet } = $props();

	const year = new Date().getFullYear();
	const path = $derived(page.url.pathname);
	const me = $derived(identity.current);
	const logo = '/icons/icon-192-192.png';

	const nav = [
		{ href: '/about', label: 'About' },
		{ href: '/privacy', label: 'Privacy' },
		{ href: '/terms', label: 'Terms' }
	];

	function navClass(href: string) {
		return path === href
			? 'bg-primary-500/10 text-primary-600'
			: 'text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]';
	}
</script>

<div class="min-h-screen bg-[var(--ui-bg)] text-[var(--ui-text)]">
	<!-- Top bar -->
	<header
		class="sticky top-0 z-10 border-b border-[var(--ui-border-muted)] bg-[color-mix(in_oklab,var(--ui-bg)_85%,transparent)] backdrop-blur-md"
	>
		<div class="mx-auto flex max-w-3xl items-center gap-3 px-5 py-3">
			<a href="/" class="flex items-center gap-2" aria-label="BitOS home">
				<img src={logo} alt="BitOS logo" class="size-8 rounded-lg shadow-[var(--glow-primary)]" />
				<span class="font-display text-[15px] font-bold tracking-tight">BitOS</span>
			</a>
			<nav class="ml-auto flex items-center gap-1 text-[12.5px] font-semibold">
				{#each nav as item (item.href)}
					<a
						href={item.href}
						class="rounded-full px-3 py-1.5 transition {navClass(item.href)}"
						aria-current={path === item.href ? 'page' : undefined}
					>
						{item.label}
					</a>
				{/each}
				{#if !me}
					<a
						href="/welcome"
						class="ml-2 rounded-full bg-primary-500 px-3 py-1.5 text-white shadow-[var(--glow-primary)] transition hover:bg-primary-600"
					>
						Sign in
					</a>
				{/if}
			</nav>
		</div>
	</header>

	<main class="mx-auto max-w-3xl px-5 py-10 sm:py-14">
		{@render children?.()}
	</main>

	<!-- Footer -->
	<footer class="border-t border-[var(--ui-border-muted)]">
		<div class="mx-auto max-w-3xl px-5 py-8">
			<div class="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] font-semibold">
				<a
					href="https://github.com/bitoslabs/bitos-svelte"
					target="_blank"
					rel="noreferrer"
					class="inline-flex items-center gap-1.5 text-[var(--ui-text-muted)] transition hover:text-primary-500"
				>
					Source code ↗
				</a>
				<a
					href="https://bitos.space"
					target="_blank"
					rel="noreferrer"
					class="inline-flex items-center gap-1.5 text-[var(--ui-text-muted)] transition hover:text-primary-500"
				>
					bitos.space ↗
				</a>
				<a href="/about" class="text-[var(--ui-text-muted)] transition hover:text-primary-500">About</a>
				<a href="/privacy" class="text-[var(--ui-text-muted)] transition hover:text-primary-500"
					>Privacy</a
				>
				<a href="/terms" class="text-[var(--ui-text-muted)] transition hover:text-primary-500">Terms</a>
			</div>
			<p class="mt-4 text-[11.5px] text-[var(--ui-text-dimmed)]">
				© {year} BitOS · A local-first client for the Nostr protocol. No central server, no
				accounts — your keys, your data, your device.
			</p>
		</div>
	</footer>
</div>
