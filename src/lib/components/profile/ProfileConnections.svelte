<script lang="ts">
	import { onMount } from 'svelte';
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

	type ConnectionTab = 'followers' | 'following';

	let { pubkey }: { pubkey: string } = $props();
	let following = $state<string[]>([]);
	let followers = $state<string[]>([]);
	let loading = $state(true);
	let loadedFor = $state('');
	let dialogOpen = $state(false);
	let activeTab = $state<ConnectionTab>('followers');
	let pending = $state<Set<string>>(new Set());

	const me = $derived(identity.current?.pk ?? '');
	const followsYou = $derived(!!me && followers.includes(me));
	const mutual = $derived(!!me && followsYou && following.includes(me));
	const visibleUsers = $derived(activeTab === 'followers' ? followers : following);

	function latestContactLists(
		events: Array<{ pubkey: string; created_at: number; tags: string[][] }>
	) {
		const latest = new Map<string, { created_at: number; tags: string[][] }>();
		for (const event of events) {
			const previous = latest.get(event.pubkey);
			if (!previous || event.created_at > previous.created_at) {
				latest.set(event.pubkey, event);
			}
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

			// A relay query using #p can include an older contact list. Re-check the
			// newest list for each candidate before presenting it as a follower.
			const candidates = [...new Set(followerMentions.map((event) => event.pubkey))].filter(
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
		const next = new Set(pending);
		next.add(target);
		pending = next;
		try {
			if (contacts.isFollowing(target)) await contacts.unfollow(target);
			else await contacts.follow(target);
		} catch (error) {
			toasts.error((error as Error).message || 'Could not update follow status');
		} finally {
			const done = new Set(pending);
			done.delete(target);
			pending = done;
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

<div class="post-card mb-5 flex flex-wrap items-center gap-1 p-2">
	<button
		type="button"
		onclick={() => open('followers')}
		class="rounded-lg px-3 py-2 text-left transition hover:bg-[var(--ui-bg-muted)]"
	>
		<strong class="block text-[15px] font-extrabold">{loading ? '—' : followers.length}</strong>
		<span class="text-[11px] text-[var(--ui-text-muted)]">Followers</span>
	</button>
	<button
		type="button"
		onclick={() => open('following')}
		class="rounded-lg px-3 py-2 text-left transition hover:bg-[var(--ui-bg-muted)]"
	>
		<strong class="block text-[15px] font-extrabold">{loading ? '—' : following.length}</strong>
		<span class="text-[11px] text-[var(--ui-text-muted)]">Following</span>
	</button>
	{#if mutual}
		<span
			class="ml-auto inline-flex items-center gap-1 rounded-full bg-primary-500/10 px-3 py-1.5 text-[11px] font-bold text-primary-600"
		>
			<Icon name="i-lucide-users" class="size-3.5" /> Mutual follow
		</span>
	{:else if followsYou}
		<span
			class="ml-auto inline-flex items-center gap-1 rounded-full bg-primary-500/10 px-3 py-1.5 text-[11px] font-bold text-primary-600"
		>
			<Icon name="i-lucide-user-check" class="size-3.5" /> Follows you
		</span>
	{/if}
</div>

<Dialog bind:open={dialogOpen} title={activeTab === 'followers' ? 'Followers' : 'Following'}>
	{#if loading}
		<div
			class="flex items-center justify-center gap-2 py-8 text-[13px] text-[var(--ui-text-muted)]"
		>
			<Icon name="i-lucide-loader-circle" class="size-4 animate-spin" /> Loading connections…
		</div>
	{:else if visibleUsers.length}
		<div class="space-y-1">
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
								<span class="flex items-center gap-1 truncate text-[11px] text-primary-600">
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
	{:else}
		<div class="py-8 text-center text-[13px] text-[var(--ui-text-muted)]">
			No {activeTab} found.
		</div>
	{/if}
</Dialog>
