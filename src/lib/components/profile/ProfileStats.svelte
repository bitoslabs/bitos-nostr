<script lang="ts">
	/**
	 * Unified profile stat bar: posts / replies / media are tappable tiles that
	 * switch the parent's content tab, while followers / following open a
	 * dialog listing the connection set (with inline follow toggles). Also
	 * surfaces the "Follows you" / "Mutual" relationship chip.
	 */
	import { onMount } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { contacts } from '$lib/nostr/contacts.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { queryPrimaryFirst } from '$lib/nostr/pool';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { NOSTR_KINDS } from '$lib/nostr/types';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { compactCount } from '$lib/utils/profile-stats';

	type StatTab = 'posts' | 'replies' | 'media';
	type ConnectionTab = 'followers' | 'following';

	let {
		pubkey,
		stats,
		onSelectStat
	}: {
		pubkey: string;
		stats: { posts: number; replies: number; media: number };
		onSelectStat: (tab: StatTab) => void;
	} = $props();

	let following = $state<string[]>([]);
	let followers = $state<string[]>([]);
	let loading = $state(true);
	let loadedFor = $state('');
	let dialogOpen = $state(false);
	let activeTab = $state<ConnectionTab>('followers');
	let pending = new SvelteSet<string>();

	const me = $derived(identity.current?.pk ?? '');
	const followsYou = $derived(!!me && followers.includes(me));
	const mutual = $derived(!!me && followsYou && following.includes(me));
	const visibleUsers = $derived(activeTab === 'followers' ? followers : following);

	function latestContactLists(
		events: Array<{ pubkey: string; created_at: number; tags: string[][] }>
	) {
		const latest = new SvelteMap<string, { created_at: number; tags: string[][] }>();
		for (const event of events) {
			const previous = latest.get(event.pubkey);
			if (!previous || event.created_at > previous.created_at) latest.set(event.pubkey, event);
		}
		return latest;
	}

	function hasPubkey(tags: string[][], target: string) {
		return tags.some((tag) => tag[0] === 'p' && tag[1]?.toLowerCase() === target);
	}

	async function loadConnections(nextPubkey: string) {
		if (!nextPubkey || loadedFor === nextPubkey) return;
		loadedFor = nextPubkey;
		loading = true;
		following = [];
		followers = [];
		try {
			const [followingEvents, followerMentions] = await Promise.all([
				queryPrimaryFirst([{ kinds: [NOSTR_KINDS.CONTACT_LIST], authors: [nextPubkey], limit: 1 }]),
				queryPrimaryFirst([{ kinds: [NOSTR_KINDS.CONTACT_LIST], '#p': [nextPubkey], limit: 500 }])
			]);

			const targetList = latestContactLists(followingEvents).get(nextPubkey);
			following = targetList
				? targetList.tags
						.filter((tag) => tag[0] === 'p' && /^[0-9a-f]{64}$/i.test(tag[1] ?? ''))
						.map((tag) => tag[1].toLowerCase())
						.filter((key, index, all) => all.indexOf(key) === index)
				: [];

			const candidates = [...new SvelteSet(followerMentions.map((event) => event.pubkey))].filter(
				(key) => key !== nextPubkey
			);
			if (candidates.length) {
				const latestFollowerEvents = await queryPrimaryFirst([
					{ kinds: [NOSTR_KINDS.CONTACT_LIST], authors: candidates, limit: candidates.length }
				]);
				followers = [...latestContactLists(latestFollowerEvents)]
					.filter(([, event]) => hasPubkey(event.tags, nextPubkey))
					.map(([key]) => key);
			}
			profiles.ensure([...following, ...followers]);
		} catch (error) {
			toasts.error((error as Error).message || 'Could not load followers');
		} finally {
			loading = false;
		}
	}

	function open(tab: ConnectionTab) {
		activeTab = tab;
		dialogOpen = true;
	}

	async function toggleFollow(target: string) {
		if (!me || target === me || pending.has(target)) return;
		pending.add(target);
		try {
			if (contacts.isFollowing(target)) await contacts.unfollow(target);
			else await contacts.follow(target);
		} catch (error) {
			toasts.error((error as Error).message || 'Could not update follow status');
		} finally {
			pending.delete(target);
		}
	}

	function nameFor(key: string) {
		const profile = profiles.get(key);
		return profile?.display_name || profile?.name || `${key.slice(0, 8)}…${key.slice(-4)}`;
	}

	onMount(() => {
		void loadConnections(pubkey);
	});

	$effect(() => {
		if (pubkey) void loadConnections(pubkey);
	});
</script>

<div class="post-card mb-5 overflow-hidden p-1.5">
	<div class="grid grid-cols-5 divide-x divide-[var(--ui-border-muted)]">
		<button
			type="button"
			onclick={() => onSelectStat('posts')}
			class="group focus-brand flex flex-col items-center gap-0.5 rounded-lg px-1 py-2.5 transition hover:bg-[var(--ui-bg-muted)]"
		>
			<span class="text-[16px] font-extrabold tabular-nums sm:text-[18px]">{stats.posts}</span>
			<span class="text-[10.5px] font-semibold text-[var(--ui-text-muted)]">Posts</span>
		</button>
		<button
			type="button"
			onclick={() => onSelectStat('replies')}
			class="group focus-brand flex flex-col items-center gap-0.5 rounded-lg px-1 py-2.5 transition hover:bg-[var(--ui-bg-muted)]"
		>
			<span class="text-[16px] font-extrabold tabular-nums sm:text-[18px]">{stats.replies}</span>
			<span class="text-[10.5px] font-semibold text-[var(--ui-text-muted)]">Replies</span>
		</button>
		<button
			type="button"
			onclick={() => onSelectStat('media')}
			class="group focus-brand flex flex-col items-center gap-0.5 rounded-lg px-1 py-2.5 transition hover:bg-[var(--ui-bg-muted)]"
		>
			<span class="text-[16px] font-extrabold tabular-nums sm:text-[18px]">{stats.media}</span>
			<span class="text-[10.5px] font-semibold text-[var(--ui-text-muted)]">Media</span>
		</button>
		<button
			type="button"
			onclick={() => open('followers')}
			class="group focus-brand flex flex-col items-center gap-0.5 rounded-lg px-1 py-2.5 transition hover:bg-[var(--ui-bg-muted)]"
		>
			<span class="text-[16px] font-extrabold tabular-nums sm:text-[18px]"
				>{loading ? '—' : compactCount(followers.length)}</span
			>
			<span class="text-[10.5px] font-semibold text-[var(--ui-text-muted)]">Followers</span>
		</button>
		<button
			type="button"
			onclick={() => open('following')}
			class="group focus-brand flex flex-col items-center gap-0.5 rounded-lg px-1 py-2.5 transition hover:bg-[var(--ui-bg-muted)]"
		>
			<span class="text-[16px] font-extrabold tabular-nums sm:text-[18px]"
				>{loading ? '—' : compactCount(following.length)}</span
			>
			<span class="text-[10.5px] font-semibold text-[var(--ui-text-muted)]">Following</span>
		</button>
	</div>

	{#if mutual || followsYou}
		<div class="flex justify-center pt-0.5 pb-1">
			{#if mutual}
				<span
					class="inline-flex items-center gap-1 rounded-full bg-primary-500/10 px-3 py-1 text-[11px] font-bold text-primary-600 dark:text-primary-400"
				>
					<Icon name="i-lucide-users" class="size-3.5" /> Mutual follow
				</span>
			{:else}
				<span
					class="inline-flex items-center gap-1 rounded-full bg-primary-500/10 px-3 py-1 text-[11px] font-bold text-primary-600 dark:text-primary-400"
				>
					<Icon name="i-lucide-user-check" class="size-3.5" /> Follows you
				</span>
			{/if}
		</div>
	{/if}
</div>

<Dialog bind:open={dialogOpen} title={activeTab === 'followers' ? 'Followers' : 'Following'}>
	<div class="mb-3 flex gap-1">
		<button
			type="button"
			onclick={() => (activeTab = 'followers')}
			class="pill-tab {activeTab === 'followers' ? 'active' : ''}">Followers</button
		>
		<button
			type="button"
			onclick={() => (activeTab = 'following')}
			class="pill-tab {activeTab === 'following' ? 'active' : ''}">Following</button
		>
	</div>
	{#if loading}
		<div
			class="flex items-center justify-center gap-2 py-8 text-[13px] text-[var(--ui-text-muted)]"
		>
			<Icon name="i-lucide-loader-circle" class="size-4 animate-spin" /> Loading connections…
		</div>
	{:else if visibleUsers.length}
		<div class="max-h-[60vh] space-y-1 overflow-y-auto pr-1">
			{#each visibleUsers as key (key)}
				{@const profile = profiles.get(key)}
				{@const name = nameFor(key)}
				<div
					class="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-[var(--ui-bg-muted)]"
				>
					<a
						href={`/profile/${key}`}
						onclick={() => (dialogOpen = false)}
						class="flex min-w-0 flex-1 items-center gap-3"
					>
						<Avatar pubkey={key} {name} picture={profile?.picture} size={40} />
						<span class="min-w-0">
							<span class="block truncate text-[13px] font-bold">{name}</span>
							{#if profile?.nip05}
								<span
									class="flex items-center gap-1 truncate text-[11px] text-primary-600 dark:text-primary-400"
								>
									<Icon name="i-lucide-badge-check" class="size-3" />
									{profile.nip05}
								</span>
							{:else if key === me}
								<span class="text-[11px] text-[var(--ui-text-muted)]">You</span>
							{/if}
						</span>
					</a>
					{#if key !== me}
						<Button
							size="sm"
							variant={contacts.isFollowing(key) ? 'subtle' : 'solid'}
							color={contacts.isFollowing(key) ? 'neutral' : 'primary'}
							disabled={pending.has(key)}
							onclick={() => void toggleFollow(key)}
						>
							{contacts.isFollowing(key) ? 'Following' : 'Follow'}
						</Button>
					{/if}
				</div>
			{/each}
		</div>
		<p class="pt-2 text-center text-[11px] text-[var(--ui-text-dimmed)]">
			{compactCount(visibleUsers.length)}
			{activeTab}
		</p>
	{:else}
		<div class="py-8 text-center text-[13px] text-[var(--ui-text-muted)]">
			No {activeTab} found.
		</div>
	{/if}
</Dialog>
