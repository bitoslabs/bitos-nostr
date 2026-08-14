<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * A single settings list row: a label + hint on the left, a trailing
	 * control (toggle / select / button) on the right. Keeps the long Settings
	 * view declarative and consistent.
	 */
	let {
		label,
		hint = '',
		children
	}: { label: string; hint?: string; children: Snippet } = $props();
</script>

<div class="flex items-center justify-between gap-3">
	<div class="min-w-0">
		<div class="text-sm">{label}</div>
		{#if hint}<div class="text-xs text-[var(--ui-text-muted)]">{hint}</div>{/if}
	</div>
	<div class="shrink-0">{@render children()}</div>
</div>
