<script lang="ts">
	import WidgetCard from '$lib/components/ui/WidgetCard.svelte';
	import HexAvatar from '$lib/components/ui/HexAvatar.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { formatCompact } from '$lib/utils/format';
	import type { Post } from '$lib/components/premium/data';

	/** Explore right-rail "Top Zapped (24h)" leaderboard. */
	let {
		posts = [] as Post[]
	}: { posts?: Post[] } = $props();

	const top = $derived([...posts].sort((a, b) => b.stats.sats - a.stats.sats).slice(0, 4));
</script>

<WidgetCard title="Top Zapped (24h)">
	<ul class="divide-y divide-[var(--ui-border-muted)]">
		{#each top as p, i (p.id)}
			<li class="flex cursor-pointer items-center gap-2 px-4 py-2.5 transition hover:bg-[var(--interactive-hover-bg)]">
				<span class="font-mono text-sm font-bold text-[var(--ui-color-primary-500)]">#{i + 1}</span>
				<HexAvatar name={p.author.name} picture={p.author.picture} pubkey={p.author.npub} verified={p.author.verified} size={20} />
				<span class="min-w-0 flex-1 truncate text-[13px] font-semibold">{p.author.name}</span>
				<span class="font-mono text-xs text-[var(--ui-text-muted)]">
					<Icon name="i-lucide-zap" class="mr-0.5 inline size-3 text-[var(--ui-color-primary-500)]" />{formatCompact(p.stats.sats)}
				</span>
			</li>
		{/each}
	</ul>
</WidgetCard>
