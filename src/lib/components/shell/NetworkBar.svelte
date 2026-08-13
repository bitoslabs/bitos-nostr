<script lang="ts">
	import { onMount } from 'svelte';

	/**
	 * Slim top-of-viewport throughput bar. Reflects live relay activity by
	 * animating its fill width between bounds. Mount once at the shell root.
	 */
	let { connected = 6, total = 7 }: { connected?: number; total?: number } = $props();

	let width = $state(30);

	onMount(() => {
		const base = (connected / Math.max(1, total)) * 100;
		const id = window.setInterval(() => {
			width = Math.min(96, base + Math.random() * 35);
		}, 2200);
		return () => window.clearInterval(id);
	});
</script>

<div
	class="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 bg-[var(--interactive-hover-bg)]"
	aria-hidden="true"
>
	<div
		class="h-full bg-[linear-gradient(90deg,var(--ui-color-primary-500),var(--color-warm-500))] transition-[width] duration-700 ease-out"
		style="width:{width}%;box-shadow:0 0 10px color-mix(in oklab,var(--ui-color-primary-500) 45%,transparent);"
	></div>
</div>
