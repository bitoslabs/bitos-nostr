<script lang="ts">
	import WidgetCard from '$lib/components/ui/WidgetCard.svelte';
	import { formatCompact } from '$lib/utils/format';

	/** A trending tag entry for the TrendingWidget. */
	export type Trend = { tag: string; category: string; notes: number; sats: number };

	/**
	 * Ranked list of trending tags (right rail + explore). Each row shows the
	 * rank context, the tag, and note/sat counts. Clicking a row invokes
	 * onSelect with the tag (without the leading #).
	 */
	let {
		trends = [],
		onSelect,
		class: cls
	}: { trends?: Trend[]; onSelect?: (tag: string) => void; class?: string } = $props();
</script>

<WidgetCard title="Trending Tags" class={cls}>
	<ul class="divide-y divide-[var(--ui-border-muted)]">
		{#each trends as t, i (t.tag)}
			<li>
				<button
					type="button"
					onclick={() => onSelect?.(t.tag)}
					class="block w-full px-4 py-2.5 text-left transition hover:bg-[var(--interactive-hover-bg)]"
				>
					<div class="text-[11px] text-[var(--ui-text-muted)]">
						{t.category} · #{i + 1}
					</div>
					<div class="mt-0.5 font-semibold text-[var(--ui-color-primary-500)]">{t.tag}</div>
					<div class="mt-0.5 font-mono text-xs text-[var(--ui-text-muted)]">
						{formatCompact(t.notes)} notes · {formatCompact(t.sats)} sats
					</div>
				</button>
			</li>
		{/each}
	</ul>
</WidgetCard>
