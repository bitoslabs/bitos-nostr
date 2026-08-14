<script lang="ts">
	import PageHeader from '$lib/components/premium/PageHeader.svelte';
	import TrendingGrid from '$lib/components/feed/TrendingGrid.svelte';
	import PeopleGrid from '$lib/components/feed/PeopleGrid.svelte';
	import PremiumPostCard from '$lib/components/feed/PremiumPostCard.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import LivePill from '$lib/components/ui/LivePill.svelte';
	import { trends, people, posts, type Person } from '$lib/components/premium/data';

	/** Explore view: search + category tabs, trending grid, suggested people, global feed. */
	let activeTab = $state('trending');
	const tabs = [
		{ key: 'trending', label: 'Trending' },
		{ key: 'people', label: 'People' },
		{ key: 'tags', label: 'Tags' },
		{ key: 'live', label: 'Live' },
		{ key: 'global', label: 'Global' }
	];

	let followingIds = $state<Set<string>>(new Set());

	function follow(p: Person) {
		const next = new Set(followingIds);
		if (next.has(p.npub)) return;
		next.add(p.npub);
		followingIds = next;
	}
</script>

<PageHeader title="Explore" {tabs} activeTab={activeTab} onTabChange={(k) => (activeTab = k)}>
	{#snippet actions()}{/snippet}
</PageHeader>

<!-- Search -->
<div class="border-b border-[var(--ui-border-muted)] p-3.5 px-4">
	<label class="relative block">
		<Icon name="i-lucide-search" class="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-[var(--ui-text-dimmed)]" />
		<input
			type="search"
			placeholder="Search npubs, events, hashtags, relays…"
			class="w-full rounded-full border border-[var(--ui-border-muted)] bg-[var(--interactive-hover-bg)] py-2.5 pr-4 pl-11 text-sm text-[var(--ui-text)] outline-none transition focus:border-[var(--ui-color-primary-500)] focus:bg-[color-mix(in_oklab,var(--ui-color-primary-500)_8%,transparent)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--ui-color-primary-500)_20%,transparent)]"
		/>
	</label>
</div>

<!-- Trending grid -->
<div class="p-4">
	<h2 class="mb-3.5 text-base font-bold tracking-tight">Trending right now</h2>
	<div class="grid grid-cols-2 gap-3">
		{#each trends as t, i (t.tag)}
			<TrendingGrid trend={t} rank={i + 1} />
		{/each}
	</div>
</div>

<!-- Suggested people -->
<div class="px-4 pb-4">
	<h2 class="mb-3.5 text-base font-bold tracking-tight">People you might like</h2>
	<div class="grid grid-cols-2 gap-3">
		{#each people as p (p.npub)}
			<PeopleGrid person={p} following={followingIds.has(p.npub)} onFollow={follow} />
		{/each}
	</div>
</div>

<!-- Global feed -->
<div class="border-t border-[var(--ui-border-muted)]">
	<div class="flex items-center justify-between border-b border-[var(--ui-border-muted)] p-3.5 px-4">
		<div>
			<h2 class="text-base font-bold tracking-tight">Global Feed</h2>
			<div class="mt-0.5 text-xs text-[var(--ui-text-muted)]">Every kind:1 event from connected relays</div>
		</div>
		<LivePill label="Live · 312 ev/min" tone="success" />
	</div>
	<div class="divide-y divide-[var(--ui-border-muted)]">
		{#each posts.slice(0, 5) as post (post.id)}
			<PremiumPostCard
				author={post.author}
				time={post.time}
				content={post.content}
				kind={post.kind}
				pow={post.pow}
				stats={post.stats}
			/>
		{/each}
	</div>
</div>
