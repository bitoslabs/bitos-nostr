<script lang="ts">
	import { cn } from '$lib/utils/cn';

	/**
	 * Status dot for a relay / connection. `status` maps to a color; pulsing
	 * conveys an active link. Single concern: a colored presence indicator.
	 */
	type Status = 'connected' | 'connecting' | 'down';

	const map: Record<Status, { color: string; pulse: boolean }> = {
		connected: { color: 'var(--tone-success-text)', pulse: false },
		connecting: { color: 'var(--ui-color-primary-500)', pulse: true },
		down: { color: 'var(--tone-warning-text)', pulse: false }
	};

	let {
		status = 'connected',
		size = 6,
		class: cls
	}: { status?: Status; size?: number; class?: string } = $props();

	const cfg = $derived(map[status]);
</script>

<span
	class={cn('inline-block rounded-full', cfg.pulse && 'relay-pulse', cls)}
	style="width:{size}px;height:{size}px;background:{cfg.color};box-shadow:0 0 8px color-mix(in oklab,{cfg.color} 55%,transparent);"
	role="img"
	aria-label={status}
></span>
