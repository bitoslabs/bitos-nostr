<script lang="ts">
	import WidgetCard from '$lib/components/ui/WidgetCard.svelte';
	import { formatCompact } from '$lib/utils/format';

	type Stat = { label: string; value: number; tone?: 'default' | 'success' | 'accent' };
	const toneClass = {
		default: 'text-[var(--ui-text)]',
		success: 'text-[var(--tone-success-text)]',
		accent: 'text-[var(--ui-color-primary-500)]'
	} as const;

	/** Explore right-rail network-scale stats 2×2 grid. */
	let {
		stats = [] as Stat[]
	}: { stats?: Stat[] } = $props();
</script>

<WidgetCard title="Network Stats">
	<div class="grid grid-cols-2 gap-3 p-3.5">
		{#each stats as s (s.label)}
			<div>
				<div class="text-[11px] tracking-wider text-[var(--ui-text-muted)] uppercase">{s.label}</div>
				<div class="mt-0.5 font-mono text-xl {toneClass[s.tone ?? 'default']}">{formatCompact(s.value)}</div>
			</div>
		{/each}
	</div>
</WidgetCard>
