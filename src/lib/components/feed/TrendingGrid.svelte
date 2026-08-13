<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import Sparkline from '$lib/components/ui/Sparkline.svelte';
	import { formatCompact } from '$lib/utils/format';
	import type { Trend } from '$lib/components/premium/data';

	/**
	 * Explore trending card: category + rank, the tag, note/sat counts, and a
	 * random sparkline. Clicking emits onSelect with the bare tag.
	 */
	let {
		trend,
		rank,
		onSelect
	}: { trend: Trend; rank: number; onSelect?: (tag: string) => void } = $props();
</script>

<button
	type="button"
	onclick={() => onSelect?.(trend.tag)}
	class="premium-card block p-4 text-left"
>
	<div class="flex items-start justify-between">
		<div>
			<div class="text-[11px] tracking-wider text-[var(--ui-text-muted)] uppercase">
				{trend.category} · #{rank}
			</div>
			<div class="mt-1 text-lg font-bold text-[var(--ui-color-primary-500)]">{trend.tag}</div>
		</div>
		<Icon name="i-lucide-trending-up" class="size-4 text-[var(--tone-success-text)] opacity-60" />
	</div>
	<div class="mt-3 flex gap-4 font-mono text-xs text-[var(--ui-text-muted)]">
		<span>{formatCompact(trend.notes)} notes</span>
		<span class="text-[var(--ui-color-primary-500)]">{formatCompact(trend.sats)} sats</span>
	</div>
	<Sparkline bars={20} height={24} class="mt-2.5" />
</button>
