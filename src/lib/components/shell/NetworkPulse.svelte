<script lang="ts">
	import WidgetCard from '$lib/components/ui/WidgetCard.svelte';
	import Sparkline from '$lib/components/ui/Sparkline.svelte';
	import LivePill from '$lib/components/ui/LivePill.svelte';
	import { formatCompact } from '$lib/utils/format';

	/**
	 * Right-rail "Network Pulse" widget: live network throughput stats and an
	 * animated sparkline. Pure display — all numbers come in as props so the
	 * caller can wire real relay/pool telemetry.
	 */
	let {
		activePubkeys = 47392,
		eventsPerMin = 312,
		relaysOnline = 1247,
		sats24h = 2_400_000,
		class: cls
	}: {
		activePubkeys?: number;
		eventsPerMin?: number;
		relaysOnline?: number;
		sats24h?: number;
		class?: string;
	} = $props();
</script>

<WidgetCard title="Network Pulse" class={cls}>
	{#snippet actions()}
		<LivePill label="Live" />
	{/snippet}
	<div class="grid grid-cols-2 gap-3 p-3.5">
		<div>
			<div class="text-[11px] tracking-wider text-[var(--ui-text-muted)] uppercase">
				Active pubkeys
			</div>
			<div class="mt-0.5 font-mono text-lg">{formatCompact(activePubkeys)}</div>
		</div>
		<div>
			<div class="text-[11px] tracking-wider text-[var(--ui-text-muted)] uppercase">
				Events / min
			</div>
			<div class="mt-0.5 font-mono text-lg">{eventsPerMin}</div>
		</div>
		<div>
			<div class="text-[11px] tracking-wider text-[var(--ui-text-muted)] uppercase">
				Relays online
			</div>
			<div class="mt-0.5 font-mono text-lg">{formatCompact(relaysOnline)}</div>
		</div>
		<div>
			<div class="text-[11px] tracking-wider text-[var(--ui-text-muted)] uppercase">
				Sats 24h
			</div>
			<div class="mt-0.5 font-mono text-lg text-[var(--ui-color-primary-500)]">
				{formatCompact(sats24h)}
			</div>
		</div>
	</div>
	<div class="px-3.5 pb-3.5">
		<div
			class="mb-1.5 flex items-center justify-between text-[10px] tracking-wider text-[var(--ui-text-muted)] uppercase"
		>
			<span>Throughput</span>
			<span class="font-mono text-[var(--ui-color-primary-500)]">{eventsPerMin} ev/min</span>
		</div>
		<div
			class="relative h-7 overflow-hidden rounded-md border border-[var(--ui-border-muted)] bg-[var(--interactive-hover-bg)]"
		>
			<div
				class="throughput-fill absolute inset-0 bg-[linear-gradient(90deg,transparent,color-mix(in_oklab,var(--ui-color-primary-500)_60%,transparent),transparent)] opacity-50"
			></div>
		</div>
		<Sparkline live={true} bars={30} class="mt-3" />
	</div>
</WidgetCard>
