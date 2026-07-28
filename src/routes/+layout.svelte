<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { registerIcons } from '$lib/icons';
	import { preferences } from '$lib/theme/preferences.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { relays } from '$lib/nostr/relays.svelte';
	import { feed } from '$lib/nostr/feed.svelte';
	import { dms } from '$lib/nostr/dms.svelte';
	import { ensureConnected } from '$lib/nostr/pool';
	import NavRail from '$lib/components/shell/NavRail.svelte';
	import MobileTabBar from '$lib/components/shell/MobileTabBar.svelte';
	import Onboarding from '$lib/components/Onboarding.svelte';
	import Toaster from '$lib/components/ui/Toaster.svelte';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();

	registerIcons();

	onMount(() => {
		preferences.load();
		preferences.apply();
		preferences.startSystemWatcher();
		identity.load();
		relays.load();
	});

	// React to login/logout (onboarding) at runtime: start/stop subscriptions.
	let lastPk = $state<string | null>(null);
	$effect(() => {
		const pk = identity.current?.pk ?? null;
		if (pk === lastPk) return;
		lastPk = pk;
		if (pk) {
			ensureConnected();
			feed.start();
			dms.start();
		} else {
			feed.stop();
			dms.stop();
		}
	});

	// React to relay list changes — restart the feed subscription.
	let lastRelays = $state<string>('');
	$effect(() => {
		const sig = relays.urls.join(',');
		if (sig === lastRelays || !identity.current) return;
		lastRelays = sig;
		ensureConnected();
		feed.start();
		dms.start();
	});

	const hasIdentity = $derived(identity.ready && !!identity.current);
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

{#if !identity.ready}
	<!-- brief boot state -->
	<div class="grid h-screen place-items-center">
		<div
			class="size-7 animate-spin rounded-full border-2 border-[var(--ui-border)] border-t-primary-500"
		></div>
	</div>
{:else if !hasIdentity}
	<Onboarding />
{:else}
	<div class="flex h-screen w-full overflow-hidden">
		<!-- Desktop nav rail (Pulse icon rail) -->
		<aside
			class="z-20 hidden w-[76px] shrink-0 border-r border-[var(--ui-border-muted)] bg-[var(--surface-bg)] lg:flex lg:flex-col"
		>
			<NavRail />
		</aside>

		<!-- Main view (full-bleed; each route renders its own Pulse layout) -->
		<main class="min-w-0 flex-1 bg-[var(--ui-bg)] pb-[calc(4.25rem+env(safe-area-inset-bottom))] lg:pb-0">
			{@render children?.()}
		</main>
	</div>

	<MobileTabBar />
{/if}

<Toaster />
