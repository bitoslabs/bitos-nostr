<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { identity } from '$lib/nostr/identity.svelte';
	import { preferences } from '$lib/theme/preferences.svelte';
	import Logo from '$lib/components/ui/Logo.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import DocToc from '$lib/components/public/DocToc.svelte';

	/**
	 * Shell for public, pre-login pages (About / Privacy / Terms). Renders a
	 * sticky BitOS top bar with the dynamic (theme-aware) logo, section nav,
	 * a light/dark toggle, the page body, and a shared footer. Long legal
	 * pages (Privacy / Terms) get a docs layout: a sticky "On this page"
	 * table of contents beside a comfortable reading column. Works whether
	 * or not a user is signed in.
	 */
	let { children }: { children?: Snippet } = $props();

	const year = new Date().getFullYear();
	const path = $derived(page.url.pathname);
	const me = $derived(identity.current);
	/** Docs treatment: sidebar TOC + reading column for long legal pages. */
	const isDocs = $derived(path === '/privacy' || path === '/terms');

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

	function toggleTheme() {
		preferences.setMode(preferences.resolvedDark ? 'light' : 'dark');
	}
</script>

<div class="min-h-screen bg-[var(--ui-bg)] text-[var(--ui-text)]">
	<!-- Top bar -->
	<header
		class="sticky top-0 z-10 border-b border-[var(--ui-border-muted)] bg-[color-mix(in_oklab,var(--ui-bg)_85%,transparent)] backdrop-blur-md"
	>
		<div class="mx-auto flex w-full max-w-[1064px] items-center gap-3 px-4 py-3 sm:px-6">
			<a
				href="/"
				class="flex shrink-0 items-center transition-opacity hover:opacity-85"
				aria-label="BitOS home"
			>
				<Logo height={26} />
			</a>
			<nav
				class="ml-auto flex items-center gap-1 text-[12.5px] font-semibold"
				aria-label="Public pages"
			>
				{#each nav as item (item.href)}
					<a
						href={item.href}
						class="rounded-full px-2.5 py-1.5 transition sm:px-3 {navClass(item.href)}"
						aria-current={path === item.href ? 'page' : undefined}
					>
						{item.label}
					</a>
				{/each}
				<button
					type="button"
					onclick={toggleTheme}
					aria-label="Toggle light or dark theme"
					title="Toggle theme"
					class="ml-1.5 grid size-8 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]"
				>
					<Icon name="i-lucide-sun" class="size-4 dark:hidden" />
					<Icon name="i-lucide-moon" class="hidden size-4 dark:block" />
				</button>
				{#if !me}
					<a
						href="/welcome"
						class="rounded-full bg-primary-500 px-3.5 py-1.5 text-white shadow-[var(--glow-primary)] transition hover:bg-primary-600"
					>
						Sign in
					</a>
				{:else}
					<a
						href="/"
						class="rounded-full bg-primary-500 px-3.5 py-1.5 text-white shadow-[var(--glow-primary)] transition hover:bg-primary-600"
					>
						Open app
					</a>
				{/if}
			</nav>
		</div>
	</header>

	{#if isDocs}
		<!-- Docs layout: sticky TOC beside a reading-measure column. -->
		<main class="mx-auto w-full max-w-[1064px] px-4 pt-8 pb-16 sm:px-6 sm:pt-12">
			<div class="grid gap-10 lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-14">
				<aside class="hidden lg:block">
					<div class="sticky top-[84px]">
						<DocToc />
					</div>
				</aside>
				<article data-doc class="max-w-[720px] min-w-0">
					{@render children?.()}
				</article>
			</div>
		</main>
	{:else}
		<main class="page-container page-container--public py-10 sm:py-14">
			{@render children?.()}
		</main>
	{/if}

	<!-- Footer -->
	<footer class="border-t border-[var(--ui-border-muted)]">
		<div class="mx-auto w-full max-w-[1064px] px-4 py-10 sm:px-6">
			<div class="flex flex-col gap-9 lg:flex-row lg:items-start lg:justify-between">
				<div class="max-w-sm">
					<a
						href="/"
						class="inline-flex items-center transition-opacity hover:opacity-85"
						aria-label="BitOS home"
					>
						<Logo height={22} />
					</a>
					<p class="mt-3.5 text-[12.5px] leading-relaxed text-[var(--ui-text-muted)]">
						A local-first client for the Nostr protocol. No central server, no accounts — your keys,
						your data, your device.
					</p>
				</div>
				<div class="grid grid-cols-2 gap-x-12 gap-y-8 text-[12.5px] font-semibold sm:grid-cols-3">
					<div>
						<p
							class="text-[10.5px] font-bold tracking-[0.14em] text-[var(--ui-text-dimmed)] uppercase"
						>
							Product
						</p>
						<ul class="mt-3 space-y-2.5">
							<li>
								<a href="/" class="text-[var(--ui-text-muted)] transition hover:text-primary-500"
									>Open BitOS</a
								>
							</li>
							<li>
								<a
									href="/about"
									class="text-[var(--ui-text-muted)] transition hover:text-primary-500">About</a
								>
							</li>
						</ul>
					</div>
					<div>
						<p
							class="text-[10.5px] font-bold tracking-[0.14em] text-[var(--ui-text-dimmed)] uppercase"
						>
							Legal
						</p>
						<ul class="mt-3 space-y-2.5">
							<li>
								<a
									href="/privacy"
									class="text-[var(--ui-text-muted)] transition hover:text-primary-500"
									>Privacy Policy</a
								>
							</li>
							<li>
								<a
									href="/terms"
									class="text-[var(--ui-text-muted)] transition hover:text-primary-500"
									>Terms of Service</a
								>
							</li>
						</ul>
					</div>
					<div>
						<p
							class="text-[10.5px] font-bold tracking-[0.14em] text-[var(--ui-text-dimmed)] uppercase"
						>
							Resources
						</p>
						<ul class="mt-3 space-y-2.5">
							<li>
								<a
									href="https://github.com/bitoslabs/bitos-nostr"
									target="_blank"
									rel="noreferrer"
									class="inline-flex items-center gap-1 text-[var(--ui-text-muted)] transition hover:text-primary-500"
								>
									GitHub ↗
								</a>
							</li>
							<li>
								<a
									href="https://bitos.space"
									target="_blank"
									rel="noreferrer"
									class="inline-flex items-center gap-1 text-[var(--ui-text-muted)] transition hover:text-primary-500"
								>
									bitos.space ↗
								</a>
							</li>
						</ul>
					</div>
				</div>
			</div>
			<div
				class="mt-9 flex flex-col gap-2 border-t border-[var(--ui-border-muted)] pt-5 text-[11.5px] text-[var(--ui-text-dimmed)] sm:flex-row sm:items-center sm:justify-between"
			>
				<p>© {year} BitOS</p>
				<p>Open source · No trackers · No ads</p>
			</div>
		</div>
	</footer>
</div>
