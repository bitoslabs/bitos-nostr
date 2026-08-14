<script lang="ts">
	import PageHeader from '$lib/components/premium/PageHeader.svelte';
	import PremiumComposer from '$lib/components/feed/PremiumComposer.svelte';
	import PremiumPostCard from '$lib/components/feed/PremiumPostCard.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import LivePill from '$lib/components/ui/LivePill.svelte';
	import { account, posts as seedPosts, relays, type Post } from '$lib/components/premium/data';

	/** Home view: feed tabs, composer, and the ranked post stream. */
	let activeTab = $state('foryou');
	const tabs = [
		{ key: 'foryou', label: 'For You' },
		{ key: 'following', label: 'Following' },
		{ key: 'zapped', label: 'Zapped' },
		{ key: 'local', label: 'Local' }
	];

	let posts = $state<Post[]>([...seedPosts]);

	function toggle(post: Post, key: 'liked' | 'zapped' | 'reposted') {
		posts = posts.map((p) => {
			if (p.id !== post.id) return p;
			const next = !p[key];
			const stats = { ...p.stats };
			if (key === 'liked') stats.likes += next ? 1 : -1;
			if (key === 'reposted') stats.reposts += next ? 1 : -1;
			if (key === 'zapped' && next) stats.sats += 21;
			return { ...p, [key]: next, stats };
		});
	}

	function handlePost({ content, pow }: { content: string; pow: number }) {
		posts = [
			{
				id: 'ev' + Math.random().toString(36).slice(2, 8),
				author: { ...account },
				time: 'now',
				content,
				kind: 1,
				pow,
				stats: { replies: 0, reposts: 0, likes: 0, zaps: 0, sats: 0 },
				liked: false,
				zapped: false,
				reposted: false
			},
			...posts
		];
	}
</script>

<PageHeader
	title="Home"
	{tabs}
	activeTab={activeTab}
	onTabChange={(k) => (activeTab = k)}
>
	{#snippet actions()}
		<button type="button" class="icon-btn size-9" aria-label="Relays">
			<Icon name="i-lucide-server" class="size-[13px]" />
		</button>
		<button type="button" class="icon-btn size-9" aria-label="Feed settings">
			<Icon name="i-lucide-sliders-horizontal" class="size-[13px]" />
		</button>
	{/snippet}
</PageHeader>

<PremiumComposer
	name={account.name}
	picture={account.picture}
	pubkey={account.pubkey}
	verified={account.verified}
	relays={relays.map((r) => ({ url: r.url, status: r.status }))}
	onPost={handlePost}
/>

<div class="divide-y divide-[var(--ui-border-muted)]">
	{#each posts as post, i (post.id)}
		<div class="premium-rise" style="animation-delay:{Math.min(i, 6) * 0.05}s">
			<PremiumPostCard
				author={post.author}
				time={post.time}
				content={post.content}
				image={post.image}
				kind={post.kind}
				pow={post.pow}
				stats={post.stats}
				quote={post.quote}
				liked={post.liked}
				zapped={post.zapped}
				reposted={post.reposted}
				onLike={() => toggle(post, 'liked')}
				onRepost={() => toggle(post, 'reposted')}
				onZap={() => toggle(post, 'zapped')}
			/>
		</div>
	{/each}
</div>

<footer class="flex items-center justify-center gap-1.5 p-8 text-center text-sm text-[var(--ui-text-muted)]">
	<Icon name="i-lucide-zap" class="size-4 text-[var(--ui-color-primary-500)]" />
	Streaming events from <span class="font-mono text-[var(--ui-text)]">{relays.length} relays</span>
	<LivePill label="Live" tone="success" />
</footer>
