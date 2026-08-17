<script lang="ts">
	import WidgetCard from '$lib/components/ui/WidgetCard.svelte';
	import Sparkline from '$lib/components/ui/Sparkline.svelte';
	import LivePill from '$lib/components/ui/LivePill.svelte';
	import { formatCompact } from '$lib/utils/format';

	/**
	 * Right-rail "Network Pulse" widget: live network throughput stats and an
	 * sparkline. Pure display — all numbers come in as props so the caller can
	 * wire real relay/pool telemetry.
	 */
	let {
		activePubkeys = 47392,
		eventsPerMin = 312,
		relaysOnline = 1247,
		sats24h = 2_400_000,
		throughput = [],
		throughputBucketSeconds = 2,
		history = [],
		events24h = 0,
		class: cls
	}: {
		activePubkeys?: number;
		eventsPerMin?: number;
		relaysOnline?: number;
		sats24h?: number;
		/** Event counts in consecutive time buckets, normalised for the sparkline. */
		throughput?: number[];
		throughputBucketSeconds?: number;
		/** Hourly values from the locally observed relay-event cache. */
		history?: number[];
		events24h?: number;
		class?: string;
	} = $props();

	let timeRange = $state<'minute' | 'day'>('minute');
	const visibleSeries = $derived(timeRange === 'minute' ? throughput : history);
	const hasVisibleData = $derived(visibleSeries.some((value) => value > 0));
	const timeLabels = $derived(
		visibleSeries.map((_, index) => {
			const slotsAgo = visibleSeries.length - index - 1;
			if (timeRange === 'minute')
				return slotsAgo ? `${slotsAgo * throughputBucketSeconds}s ago` : 'Now';
			return slotsAgo ? `${slotsAgo}h ago` : 'Now';
		})
	);
	const axisStart = $derived(timeRange === 'minute' ? '1m ago' : '24h ago');

	function selectRange(range: 'minute' | 'day') {
		timeRange = range;
	}
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
			<div class="text-[11px] tracking-wider text-[var(--ui-text-muted)] uppercase">Sats 24h</div>
			<div class="mt-0.5 font-mono text-lg text-[var(--ui-color-primary-500)]">
				{formatCompact(sats24h)}
			</div>
		</div>
	</div>
	<div class="px-3.5 pb-3.5">
		<div
			class="mb-1.5 flex items-center justify-between gap-2 text-[10px] tracking-wider text-[var(--ui-text-muted)] uppercase"
		>
			<span>Throughput</span>
			<div class="flex items-center gap-1">
				<button
					type="button"
					onclick={() => selectRange('minute')}
					class="rounded px-1.5 py-0.5 font-mono transition {timeRange === 'minute'
						? 'bg-primary-500/10 text-[var(--ui-color-primary-500)]'
						: 'hover:text-[var(--ui-text)]'}"
					aria-pressed={timeRange === 'minute'}>1m</button
				>
				<button
					type="button"
					onclick={() => selectRange('day')}
					class="rounded px-1.5 py-0.5 font-mono transition {timeRange === 'day'
						? 'bg-primary-500/10 text-[var(--ui-color-primary-500)]'
						: 'hover:text-[var(--ui-text)]'}"
					aria-pressed={timeRange === 'day'}>24h</button
				>
				<span class="font-mono text-[var(--ui-color-primary-500)]"
					>{timeRange === 'minute'
						? `${eventsPerMin} ev/min · ${throughputBucketSeconds}s`
						: `${formatCompact(events24h)} observed`}</span
				>
			</div>
		</div>
		{#if hasVisibleData}
			<div
				class="relative h-7 overflow-hidden rounded-md border border-[var(--ui-border-muted)] bg-[var(--interactive-hover-bg)]"
			>
				<div
					class="throughput-fill absolute inset-0 bg-[linear-gradient(90deg,transparent,color-mix(in_oklab,var(--ui-color-primary-500)_60%,transparent),transparent)] opacity-50"
				></div>
			</div>
			<Sparkline
				data={visibleSeries}
				labels={timeLabels}
				bars={timeRange === 'minute' ? 30 : 24}
				fill={timeRange === 'day'}
				class="mt-3 {timeRange === 'minute' && visibleSeries.length <= 12 ? 'justify-center' : ''}"
			/>
			<div class="mt-1 flex justify-between font-mono text-[9px] text-[var(--ui-text-dimmed)]">
				<span>{axisStart}</span><span>Now</span>
			</div>
		{:else}
			<p class="py-3 text-center font-mono text-[10px] text-[var(--ui-text-dimmed)]">
				Waiting for observed events…
			</p>
		{/if}
	</div>
</WidgetCard>
