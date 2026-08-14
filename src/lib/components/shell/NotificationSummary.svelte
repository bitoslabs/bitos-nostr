<script lang="ts">
	import WidgetCard from '$lib/components/ui/WidgetCard.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { formatCompact } from '$lib/utils/format';

	type Bucket = { type: string; icon: string; tone: 'accent' | 'warm' | 'success' | 'info' | 'neutral'; count: number };
	const tone = {
		accent: 'var(--ui-color-primary-500)',
		warm: 'var(--tone-warning-text)',
		success: 'var(--tone-success-text)',
		info: 'var(--tone-info-text)',
		neutral: 'var(--ui-text-muted)'
	} as const;

	/** Notifications right-rail summary of the day's activity by type. */
	let {
		buckets = [] as Bucket[]
	}: { buckets?: Bucket[] } = $props();
</script>

<WidgetCard title="Notification Summary">
	<div class="flex flex-col gap-3 p-3.5">
		{#each buckets as b (b.type)}
			<div class="flex items-center justify-between">
				<span class="flex items-center gap-2">
					<span
						class="grid size-7 place-items-center rounded-full text-[11px]"
						style={`color:${tone[b.tone]};background:color-mix(in oklab,${tone[b.tone]} 12%,transparent)`}
					>
						<Icon name={b.icon} class="size-3.5" />
					</span>
					{b.type}
				</span>
				<span class="font-mono font-semibold" style={`color:${tone[b.tone]}`}>+{formatCompact(b.count)}</span>
			</div>
		{/each}
	</div>
</WidgetCard>
