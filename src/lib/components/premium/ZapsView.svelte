<script lang="ts">
	import PageHeader from '$lib/components/premium/PageHeader.svelte';
	import StatTile from '$lib/components/ui/StatTile.svelte';
	import ZapRow from '$lib/components/feed/ZapRow.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { zapHistory, type Zap } from '$lib/components/premium/data';

	/** Zaps view: wallet hero, 4-up 30-day stats, activity tabs, zap history. */
	let activeTab = $state('all');
	let history = $state<Zap[]>([...zapHistory]);
	const tabs = [
		{ key: 'all', label: 'All Activity' },
		{ key: 'sent', label: 'Sent' },
		{ key: 'received', label: 'Received' }
	];
	const filtered = $derived(activeTab === 'all' ? history : history.filter((z) => z.type === activeTab));
</script>

<PageHeader title="Zaps" {tabs} activeTab={activeTab} onTabChange={(k) => (activeTab = k)}>
	{#snippet actions()}
		<button type="button" class="icon-btn size-9" aria-label="Export"><Icon name="i-lucide-download" class="size-4" /></button>
	{/snippet}
</PageHeader>

<!-- Wallet hero -->
<div class="p-4">
	<div class="premium-card overflow-hidden border-[color-mix(in_oklab,var(--ui-color-primary-500)_22%,transparent)] bg-[linear-gradient(135deg,color-mix(in_oklab,var(--ui-color-primary-500)_12%,transparent),color-mix(in_oklab,var(--color-warm-500)_6%,transparent))] p-5">
		<div class="mb-5 flex items-start justify-between">
			<div>
				<div class="text-xs tracking-wider text-[var(--ui-text-muted)] uppercase">Total Balance</div>
				<div class="mt-1 font-mono text-4xl font-bold tracking-tight">12,847 <span class="text-lg text-[var(--ui-color-primary-500)]">sats</span></div>
				<div class="mt-1 text-xs text-[var(--ui-text-muted)]">≈ $4.32 USD · synced with Alby</div>
			</div>
			<span class="hex-clip grid size-11 place-items-center bg-[linear-gradient(135deg,var(--ui-color-primary-500),var(--color-warm-500))] text-black"><Icon name="i-lucide-zap" class="size-5" /></span>
		</div>
		<div class="flex gap-2">
			<button type="button" class="glow-accent flex-1 rounded-full bg-[var(--ui-color-primary-500)] py-2.5 px-5 font-semibold text-[var(--ui-text-inverted)] transition-all hover:-translate-y-0.5">Deposit</button>
			<button type="button" class="flex-1 rounded-full border border-[var(--ui-border-accented)] bg-transparent py-2.5 px-5 text-sm transition hover:bg-[var(--interactive-hover-bg)]">Withdraw</button>
		</div>
	</div>
</div>

<!-- 30-day stats -->
<div class="grid grid-cols-2 gap-2.5 px-4 pb-4 sm:grid-cols-4">
	<StatTile label="Sent" value="8,432" caption="sats · 30d" tone="warm" center />
	<StatTile label="Received" value="21,279" caption="sats · 30d" tone="accent" center />
	<StatTile label="Zaps Sent" value="87" caption="this month" center />
	<StatTile label="Avg Zap" value="97" caption="sats" center />
</div>

<!-- History -->
<div>
	{#each filtered as z (z.id)}
		<ZapRow zap={z} />
	{/each}
</div>
