<script lang="ts">
	import PageHeader from '$lib/components/premium/PageHeader.svelte';
	import PremiumPostCard from '$lib/components/feed/PremiumPostCard.svelte';
	import HexAvatar from '$lib/components/ui/HexAvatar.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import LivePill from '$lib/components/ui/LivePill.svelte';
	import { account, myPosts, posts } from '$lib/components/premium/data';

	/** Profile view: banner, hex avatar, identity, stats, public key, tabs, feed. */
	let {
		onBack = () => history.back()
	}: { onBack?: () => void } = $props();
	let activeTab = $state('notes');
	const tabs = [
		{ key: 'notes', label: 'Notes' },
		{ key: 'replies', label: 'Replies' },
		{ key: 'zaps', label: 'Zaps' },
		{ key: 'media', label: 'Media' },
		{ key: 'likes', label: 'Likes' }
	];
	const feed = [...myPosts, ...posts.slice(0, 1)];
</script>

<PageHeader title={account.name} subtitle="1,247 notes · 8 relays" back {onBack} />

<!-- Banner -->
<div
	class="h-40 bg-cover bg-center"
	style="background-image:linear-gradient(135deg,color-mix(in oklab,var(--ui-color-primary-500)_40%,transparent),color-mix(in oklab,var(--color-warm-500)_30%,transparent)),url('https://picsum.photos/seed/banner42/800/200.jpg');"
></div>

<div class="relative px-4">
	<div class="-mt-12 inline-block">
		<HexAvatar name={account.name} picture={account.picture} pubkey={account.pubkey} verified={account.verified} size={96} ring />
	</div>

	<div class="mt-3 flex items-start justify-between gap-2">
		<div class="min-w-0">
			<div class="flex items-center gap-2">
				<h2 class="text-xl font-bold tracking-tight">{account.name}</h2>
				<Icon name="i-lucide-badge-check" class="size-4 text-[var(--tone-success-text)]" />
			</div>
			<div class="mt-0.5 font-mono text-xs text-[var(--ui-text-muted)]">npub1volt0dsey4f7k2m8x3q9r…k7q3</div>
			<div class="mt-1"><LivePill label="volt@nostr.directory" tone="success" icon /></div>
		</div>
		<div class="flex shrink-0 gap-2">
			<button type="button" class="rounded-full border border-[var(--ui-border-accented)] py-2 px-4 text-sm transition hover:bg-[var(--interactive-hover-bg)]"><Icon name="i-lucide-pencil" class="mr-1.5 inline size-3.5" />Edit</button>
			<button type="button" class="glow-accent inline-flex items-center gap-1 rounded-full bg-[var(--ui-color-primary-500)] py-2 px-4 text-sm font-semibold text-[var(--ui-text-inverted)]"><Icon name="i-lucide-zap" class="size-3.5" />Zap</button>
		</div>
	</div>

	<p class="my-3.5 text-sm leading-relaxed text-[var(--ui-text-muted)]">
		Building decentralized social on Nostr. Running relays since 2022. Mining my notes with PoW since that was a thing. Cypherpunk fundamentals, lightning-native economics. ⚡
	</p>

	<div class="mb-3.5 flex gap-4 text-sm">
		<span class="text-[var(--ui-text-muted)]"><span class="font-mono font-semibold text-[var(--ui-text)]">427</span> Following</span>
		<span class="text-[var(--ui-text-muted)]"><span class="font-mono font-semibold text-[var(--ui-text)]">3,892</span> Followers</span>
		<span class="text-[var(--ui-text-muted)]"><span class="font-mono font-semibold text-[var(--ui-color-primary-500)]">2.4M</span> Sats Received</span>
	</div>

	<div class="mb-4">
		<div class="mb-1.5 text-[11px] tracking-wider text-[var(--ui-text-muted)] uppercase">Public Key</div>
		<div class="rounded-lg border border-[var(--ui-border-muted)] bg-[var(--interactive-hover-bg)] p-2.5 font-mono text-[11px] leading-relaxed text-[var(--tone-info-text)] break-all">npub1volt0dsey4f7k2m8x3q9r2p7n3k8s5t4u8v9w2x3y4z5a6b7c8d9e0f1g2h3i4j5k6l7m8n9o0p1q2r3</div>
	</div>
</div>

<PageHeader {tabs} activeTab={activeTab} onTabChange={(k) => (activeTab = k)} />
<div class="divide-y divide-[var(--ui-border-muted)]">
	{#each feed as post (post.id)}
		<PremiumPostCard
			author={post.author}
			time={post.time}
			content={post.content}
			kind={post.kind}
			pow={post.pow}
			stats={post.stats}
			liked={post.liked}
			zapped={post.zapped}
		/>
	{/each}
</div>
