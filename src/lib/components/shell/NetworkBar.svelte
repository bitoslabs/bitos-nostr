<script lang="ts">
	/**
	 * Slim top-of-viewport network-health indicator. Its width is derived from
	 * real relay checks, rather than being a decorative activity animation.
	 */
	let {
		connected = 0,
		total = 0,
		checking = false
	}: { connected?: number; total?: number; checking?: boolean } = $props();

	const healthy = $derived(Math.min(Math.max(connected, 0), Math.max(total, 0)));
	const progress = $derived(total > 0 ? (healthy / total) * 100 : 0);
	const label = $derived(
		checking
			? 'Checking relay connections'
			: total === 0
				? 'No relays configured'
				: `${healthy} of ${total} relays connected`
	);
	const color = $derived(
		healthy === total && total > 0
			? 'bg-[linear-gradient(90deg,var(--color-warm-400),var(--color-warm-600))]'
			: healthy > 0
				? 'bg-[linear-gradient(90deg,var(--color-warm-500),var(--color-warm-600))]'
				: 'bg-[var(--tone-error-text)]'
	);
</script>

<div
	class="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 bg-[var(--interactive-hover-bg)]"
	role="progressbar"
	aria-label={label}
	aria-valuemin="0"
	aria-valuemax={total}
	aria-valuenow={checking ? undefined : healthy}
	aria-valuetext={label}
>
	<div
		class="h-full {color} transition-[width] duration-700 ease-out {checking
			? 'animate-pulse'
			: ''}"
		style="width:{checking
			? Math.max(progress, 8)
			: progress}%;box-shadow:0 0 10px color-mix(in oklab,var(--color-warm-500) 55%,transparent);"
	></div>
</div>
