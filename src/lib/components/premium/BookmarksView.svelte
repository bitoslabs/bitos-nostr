<script lang="ts">
	import PageHeader from '$lib/components/premium/PageHeader.svelte';
	import PremiumPostCard from '$lib/components/feed/PremiumPostCard.svelte';
	import { posts } from '$lib/components/premium/data';

	/** Bookmarks view: filter tabs + saved notes. */
	let activeTab = $state('all');
	const tabs = [
		{ key: 'all', label: 'All' },
		{ key: 'notes', label: 'Notes' },
		{ key: 'articles', label: 'Articles' },
		{ key: 'media', label: 'Media' }
	];
	const saved = posts.slice(1, 5);
</script>

<PageHeader title="Bookmarks" {tabs} activeTab={activeTab} onTabChange={(k) => (activeTab = k)} />

<div class="divide-y divide-[var(--ui-border-muted)]">
	{#each saved as post (post.id)}
		<PremiumPostCard
			author={post.author}
			time={post.time}
			content={post.content}
			image={post.image}
			kind={post.kind}
			pow={post.pow}
			stats={post.stats}
			liked={post.liked}
			zapped={post.zapped}
		/>
	{/each}
</div>
