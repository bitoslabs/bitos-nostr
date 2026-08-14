<script lang="ts">
	import PageHeader from '$lib/components/premium/PageHeader.svelte';
	import StatTile from '$lib/components/ui/StatTile.svelte';
	import RelayCard from '$lib/components/feed/RelayCard.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { relays as seedRelays, type RelayRow } from '$lib/components/premium/data';

	/** Relays view: connection stat tiles, active relay cards, and a connect form. */
	let list = $state<RelayRow[]>([...seedRelays]);
	let newUrl = $state('');
	const suggested = ['wss://nostr.wine', 'wss://relay.nostr.band', 'wss://nostr.mom'];

	const connected = $derived(list.filter((r) => r.status === 'connected').length);
	const avgLatency = $derived(
		Math.round(
			list.filter((r) => r.latency).reduce((s, r) => s + r.latency, 0) /
				Math.max(1, list.filter((r) => r.latency).length)
		)
	);
	const totalEvents = $derived(list.reduce((s, r) => s + r.events, 0));

	function connect() {
		const url = newUrl.trim().replace(/^wss:\/\//, '');
		if (!url) return;
		list = [{ url, status: 'connecting', latency: 0, events: 0, mode: 'both' }, ...list];
		newUrl = '';
	}
	function remove(r: RelayRow) {
		list = list.filter((x) => x.url !== r.url);
	}
</script>

<PageHeader title="Relays" subtitle="Your gateway to the Nostr network">
	{#snippet actions()}
		<button type="button" onclick={connect} class="glow-accent inline-flex items-center gap-1 rounded-full bg-[var(--ui-color-primary-500)] px-4 py-2 text-sm font-semibold text-[var(--ui-text-inverted)]">
			<Icon name="i-lucide-plus" class="size-3.5" /> Add Relay
		</button>
	{/snippet}
</PageHeader>

<div class="grid grid-cols-2 gap-2.5 p-4 sm:grid-cols-4">
	<StatTile label="Connected" value={`${connected}/${list.length}`} tone="success" />
	<StatTile label="Avg Latency" value={avgLatency} unit="ms" />
	<StatTile label="Events Cached" value="2.3" unit="GB" />
	<StatTile label="Total Events" value={(totalEvents / 1000).toFixed(0)} unit="k" />
</div>

<div class="px-4 pb-4">
	<h2 class="mb-3 text-xs tracking-wider text-[var(--ui-text-muted)] uppercase">Active Connections</h2>
	<div class="flex flex-col gap-2.5">
		{#each list as r (r.url)}
			<RelayCard relay={r} onRemove={remove} />
		{/each}
	</div>
</div>

<div class="px-4 pb-8">
	<h2 class="mb-3 text-xs tracking-wider text-[var(--ui-text-muted)] uppercase">Connect New Relay</h2>
	<div class="flex gap-2">
		<input
			bind:value={newUrl}
			onkeydown={(e) => e.key === 'Enter' && connect()}
			type="text"
			placeholder="wss://relay.example.com"
			class="flex-1 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--interactive-hover-bg)] px-3.5 py-2.5 font-mono text-sm text-[var(--ui-text)] outline-none transition focus:border-[var(--ui-color-primary-500)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--ui-color-primary-500)_20%,transparent)]"
		/>
		<button type="button" onclick={connect} class="glow-accent rounded-full bg-[var(--ui-color-primary-500)] px-5 py-2.5 text-sm font-semibold text-[var(--ui-text-inverted)]">Connect</button>
	</div>
	<div class="mt-3 flex flex-wrap items-center gap-1.5">
		<span class="mr-1 text-[11px] text-[var(--ui-text-muted)]">Suggested:</span>
		{#each suggested as s (s)}
			<button type="button" onclick={() => (newUrl = s)} class="cursor-pointer rounded-full border border-[var(--ui-border-muted)] bg-[var(--interactive-hover-bg)] px-2 py-0.5 font-mono text-[10px] text-[var(--ui-text-muted)] transition hover:text-[var(--ui-text)]">{s}</button>
		{/each}
	</div>
</div>
