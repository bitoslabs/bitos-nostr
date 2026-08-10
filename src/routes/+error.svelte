<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Icon from '$lib/components/ui/Icon.svelte';

	let { status, error }: { status: number; error: { message?: string } } = $props();
	// Client-side navigation can surface an unmatched route with a generic
	// status; a null route id is the reliable missing-route signal.
	const isNotFound = $derived(status === 404 || page.route.id === null);

	function goBack() {
		if (history.length > 1) history.back();
		else void goto('/');
	}
</script>

<svelte:head>
	<title>{isNotFound ? 'Page not found' : `Something went wrong · ${status}`} · BitOS</title>
	<meta
		name="description"
		content={isNotFound
			? 'The BitOS page you are looking for could not be found.'
			: 'BitOS encountered an unexpected error.'}
	/>
</svelte:head>

<div
	class="relative flex min-h-[calc(100vh-1rem)] items-center justify-center overflow-hidden px-5 py-12 sm:min-h-[calc(100vh-3rem)]"
>
	<div class="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
		<div class="absolute top-[12%] left-[8%] size-48 rounded-full bg-primary-500/8 blur-3xl"></div>
		<div
			class="absolute right-[4%] bottom-[10%] size-64 rounded-full bg-accent-500/8 blur-3xl"
		></div>
		<div
			class="absolute inset-0 [background-image:linear-gradient(var(--ui-text)_1px,transparent_1px),linear-gradient(90deg,var(--ui-text)_1px,transparent_1px)] [background-size:32px_32px] opacity-[0.035]"
		></div>
	</div>

	<div class="relative w-full max-w-2xl text-center">
		<div
			class="mx-auto mb-6 flex items-center justify-center gap-2 text-[11px] font-bold tracking-[0.2em] text-[var(--ui-text-dimmed)] uppercase"
		>
			<span class="size-1.5 rounded-full bg-primary-500"></span>
			<span>BitOS / Nostr</span>
			<span class="size-1.5 rounded-full bg-accent-500"></span>
		</div>

		<div class="relative mx-auto mb-7 w-fit">
			<div
				class="font-display text-[clamp(7rem,24vw,13rem)] leading-[0.75] font-extrabold tracking-[-0.1em] text-[var(--ui-text)] opacity-[0.11] select-none"
			>
				{status}
			</div>
		</div>

		<span
			class="inline-flex items-center gap-1.5 rounded-full border border-primary-500/20 bg-primary-500/8 px-3 py-1.5 text-[11px] font-bold text-primary-600"
		>
			<Icon name="i-lucide-route-off" class="size-3.5" />
			{isNotFound ? 'Route not found' : 'Unexpected relay error'}
		</span>
		<h1
			class="mt-4 font-display text-[30px] leading-tight font-extrabold tracking-tight sm:text-[38px]"
		>
			{isNotFound ? 'This page went off relay.' : 'The relays hit a snag.'}
		</h1>
		<p class="mx-auto mt-3 max-w-md text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
			{isNotFound
				? 'The address is valid, but this destination does not exist in BitOS. Let’s get you back to a useful place.'
				: 'Something unexpected happened while loading this view. Try the previous page or return to your feed.'}
		</p>

		<div class="mt-7 flex flex-wrap items-center justify-center gap-2.5">
			<a
				href="/"
				class="inline-flex items-center gap-2 rounded-full bg-primary-500 px-5 py-2.5 text-[13px] font-bold text-white shadow-[var(--glow-primary)] transition hover:bg-primary-600"
			>
				<Icon name="i-lucide-house" class="size-4" />
				Back to feed
			</a>
			<button
				type="button"
				onclick={goBack}
				class="inline-flex items-center gap-2 rounded-full border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-5 py-2.5 text-[13px] font-bold text-[var(--ui-text)] transition hover:border-primary-500/40 hover:text-primary-500"
			>
				<Icon name="i-lucide-arrow-left" class="size-4" />
				Go back
			</button>
			<a
				href="/discover"
				class="inline-flex items-center gap-2 rounded-full border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-5 py-2.5 text-[13px] font-bold text-[var(--ui-text-muted)] transition hover:border-primary-500/40 hover:text-primary-500"
			>
				<Icon name="i-lucide-compass" class="size-4" />
				Discover
			</a>
		</div>

		<div
			class="mx-auto mt-10 flex max-w-md items-center gap-3 rounded-2xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] p-3 text-left shadow-[var(--shadow-card)]"
		>
			<div
				class="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--ui-bg-muted)] text-[var(--ui-text-dimmed)]"
			>
				<Icon name="i-lucide-link-2-off" class="size-4" />
			</div>
			<div class="min-w-0 flex-1">
				<p class="text-[11px] font-bold tracking-wide text-[var(--ui-text-dimmed)] uppercase">
					Requested path
				</p>
				<p class="mt-0.5 truncate font-mono text-[12px] text-[var(--ui-text-muted)]">
					{page.url.pathname}
				</p>
			</div>
			{#if !isNotFound && error?.message}<span
					class="hidden max-w-[160px] truncate text-[10px] text-[var(--ui-text-dimmed)] sm:block"
					>{error.message}</span
				>{/if}
		</div>
		<p class="mt-6 text-[11px] text-[var(--ui-text-dimmed)]">
			Your identity is safe. No keys were changed.
		</p>
	</div>
</div>
