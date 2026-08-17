<script lang="ts">
	import { cn } from '$lib/utils/cn';
	import { onMount, untrack } from 'svelte';

	/**
	 * Animated bar sparkline. Accepts an explicit `data` array (0..1) or, when
	 * `live` is set, generates a gently drifting series on an interval. Bars
	 * fade from dim → accent left-to-right and re-flow when the data updates.
	 */
	let {
		data = [],
		live = false,
		bars = 30,
		height = 32,
		color = 'var(--ui-color-primary-500)',
		labels = [],
		fill = false,
		class: cls
	}: {
		data?: number[];
		live?: boolean;
		bars?: number;
		height?: number;
		color?: string;
		/** Optional hover labels for data buckets, oldest first. */
		labels?: string[];
		/** Spread a short series across the available chart width. */
		fill?: boolean;
		class?: string;
	} = $props();

	function series(n: number): number[] {
		return Array.from({ length: n }, () => 0.35 + Math.random() * 0.65);
	}

	let liveSeries = $state<number[]>(untrack(() => (data.length ? [...data] : series(bars))));

	$effect(() => {
		liveSeries = data.length ? [...data] : liveSeries;
	});

	onMount(() => {
		if (!live) return;
		const id = window.setInterval(() => {
			liveSeries = [...liveSeries.slice(1), 0.35 + Math.random() * 0.65];
		}, 1600);
		return () => window.clearInterval(id);
	});
</script>

<div class={cn('flex items-end gap-[3px]', cls)} style="height:{height}px" aria-hidden="true">
	{#each liveSeries as v, i (i)}
		<span
			class="rounded-sm {fill ? 'min-w-[2px] flex-1' : 'w-[3px]'}"
			style="height:{Math.round(v * height)}px;background:{color};opacity:{0.3 +
				(i / liveSeries.length) * 0.7};transition:height 0.5s ease, opacity 0.5s ease;"
			title={labels[i]}
		></span>
	{/each}
</div>
