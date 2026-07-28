<script lang="ts">
	import { onMount } from 'svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { contacts } from '$lib/nostr/contacts.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { queryOnce } from '$lib/nostr/pool';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { NOSTR_KINDS } from '$lib/nostr/types';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { shortKey } from '$lib/utils/format';

	type Trend = {
		rank: string;
		category: string;
		tag: string;
		posts: string;
		dir: 'up' | 'hot';
		count: number;
	};

	type Suggestion = {
		pubkey: string;
		name: string;
		note: string;
		count: number;
	};

	const TREND_LIMIT = 5;
	const SUGGESTION_LIMIT = 5;
	const CACHE_MS = 5 * 60 * 1000;
	const CACHE_KEY = 'bitos:trending-rail-cache';
	const hashtagPattern = /(?:^|\s)#([\p{L}\p{N}_-]{2,60})/gu;

	let loading = $state(true);
	let loaded = $state(false);
	let trending = $state<Trend[]>([]);
	let suggested = $state<Suggestion[]>([]);
	const me = $derived(identity.current?.pk ?? '');
	const visibleSuggested = $derived(
		suggested
			.filter((person) => person.pubkey !== me && !contacts.isFollowing(person.pubkey))
			.slice(0, SUGGESTION_LIMIT)
	);

	function compactCount(count: number) {
		if (count >= 1000) return `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}K`;
		return count.toString();
	}

	function displayName(pubkey: string) {
		const profile = profiles.get(pubkey);
		return profile?.display_name || profile?.name || shortKey(pubkey);
	}

	function profileNote(pubkey: string, count: number) {
		const profile = profiles.get(pubkey);
		return profile?.about || `${count} recent ${count === 1 ? 'note' : 'notes'} from relays`;
	}

	function tagsFromContent(content: string) {
		return [...content.matchAll(hashtagPattern)].map((match) => match[1].toLowerCase());
	}

	function readCache() {
		try {
			const raw = localStorage.getItem(CACHE_KEY);
			if (!raw) return false;
			const cached = JSON.parse(raw) as {
				createdAt: number;
				trending: Trend[];
				suggested: Suggestion[];
			};
			if (Date.now() - cached.createdAt > CACHE_MS) return false;
			trending = cached.trending;
			suggested = cached.suggested;
			profiles.ensure(suggested.map((person) => person.pubkey));
			loaded = true;
			loading = false;
			return true;
		} catch {
			return false;
		}
	}

	function writeCache() {
		localStorage.setItem(CACHE_KEY, JSON.stringify({ createdAt: Date.now(), trending, suggested }));
	}

	async function loadRailData(options: { force?: boolean } = {}) {
		if (!options.force && readCache()) return;
		loading = true;
		try {
			const events = await queryOnce([{ kinds: [NOSTR_KINDS.TEXT_NOTE], limit: 300 }]);
			const seenEvents: Record<string, true> = {};
			const tagCounts: Record<string, number> = {};
			const authorCounts: Record<string, { count: number; latest: number }> = {};

			for (const ev of events) {
				if (seenEvents[ev.id]) continue;
				seenEvents[ev.id] = true;

				const eventTags = ev.tags
					.filter((tag) => tag[0] === 't' && tag[1])
					.map((tag) => tag[1].toLowerCase());
				const uniqueTags = [...eventTags, ...tagsFromContent(ev.content)].filter(
					(tag, index, tags) => tags.indexOf(tag) === index
				);
				for (const tag of uniqueTags) tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;

				if (ev.pubkey !== identity.current?.pk) {
					const author = authorCounts[ev.pubkey] ?? { count: 0, latest: 0 };
					author.count += 1;
					author.latest = Math.max(author.latest, ev.created_at);
					authorCounts[ev.pubkey] = author;
				}
			}

			trending = Object.entries(tagCounts)
				.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
				.slice(0, TREND_LIMIT)
				.map(([tag, count], index) => ({
					rank: `#${index + 1}`,
					category: 'Nostr',
					tag: `#${tag}`,
					posts: `${compactCount(count)} ${count === 1 ? 'note' : 'notes'}`,
					dir: index < 2 ? 'up' : 'hot',
					count
				}));

			suggested = Object.entries(authorCounts)
				.sort((a, b) => b[1].count - a[1].count || b[1].latest - a[1].latest)
				.slice(0, SUGGESTION_LIMIT * 3)
				.map(([pubkey, stats]) => ({
					pubkey,
					name: displayName(pubkey),
					note: profileNote(pubkey, stats.count),
					count: stats.count
				}));

			profiles.ensure(suggested.map((person) => person.pubkey));
			writeCache();
			loaded = true;
		} catch (e) {
			toasts.error((e as Error).message || 'Could not load relay trends');
		} finally {
			loading = false;
		}
	}

	async function toggleFollow(pubkey: string) {
		if (pubkey === identity.current?.pk) {
			toasts.warning("You can't follow yourself");
			return;
		}
		try {
			if (contacts.isFollowing(pubkey)) {
				await contacts.unfollow(pubkey);
				toasts.info('Unfollowed');
			} else {
				await contacts.follow(pubkey);
				toasts.success('Following');
			}
		} catch (e) {
			toasts.error((e as Error).message);
		}
	}

	onMount(() => {
		void loadRailData();
	});
</script>

<aside
	class="hidden w-[320px] shrink-0 overflow-y-auto border-l border-[var(--ui-border-muted)] p-5 xl:block"
>
	<!-- Trending -->
	<div class="mb-6">
		<div class="mb-3 flex items-center justify-between">
			<h3 class="font-display text-[18px] font-extrabold">Trending now</h3>
			<button
				type="button"
				onclick={() => loadRailData({ force: true })}
				class="grid size-8 place-items-center rounded-lg text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-primary-500"
				aria-label="Refresh trends"
			>
				<Icon name="i-lucide-rotate-cw" class="size-4 {loading ? 'animate-spin' : ''}" />
			</button>
		</div>
		{#if loading && !loaded}
			<div class="space-y-2">
				{#each [0, 1, 2] as i (i)}
					<div class="rounded-xl bg-[var(--ui-bg-muted)] p-3">
						<div class="mb-2 h-3 w-24 rounded bg-[var(--ui-bg-accented)]"></div>
						<div class="mb-2 h-4 w-32 rounded bg-[var(--ui-bg-accented)]"></div>
						<div class="h-3 w-16 rounded bg-[var(--ui-bg-accented)]"></div>
					</div>
				{/each}
			</div>
		{:else if trending.length}
			<div class="space-y-2">
				{#each trending as t (t.tag)}
					<a
						href={`/?tag=${encodeURIComponent(t.tag.slice(1))}`}
						class="block w-full cursor-pointer rounded-xl p-3 text-left transition-colors hover:bg-[var(--interactive-hover-bg)]"
					>
						<div class="mb-1 flex items-center justify-between">
							<span class="text-[11px] font-semibold text-[var(--ui-text-dimmed)]"
								>{t.rank} · {t.category}</span
							>
							<Icon
								name={t.dir === 'up' ? 'i-lucide-trending-up' : 'i-lucide-flame'}
								class={t.dir === 'up' ? 'size-3.5 text-accent-500' : 'size-3.5 text-warm-500'}
							/>
						</div>
						<p class="text-[14px] font-bold">{t.tag}</p>
						<p class="text-[11px] text-[var(--ui-text-dimmed)]">{t.posts}</p>
					</a>
				{/each}
			</div>
		{:else}
			<div class="rounded-xl bg-[var(--ui-bg-muted)] p-4 text-[13px] text-[var(--ui-text-muted)]">
				No relay hashtags found yet.
			</div>
		{/if}
	</div>

	<!-- Suggested -->
	<div class="mb-6">
		<h3 class="mb-3 font-display text-[18px] font-extrabold">Suggested for you</h3>
		{#if loading && !loaded}
			<div class="space-y-3">
				{#each [0, 1, 2] as i (i)}
					<div class="flex items-center gap-3">
						<div class="size-10 rounded-full bg-[var(--ui-bg-accented)]"></div>
						<div class="min-w-0 flex-1">
							<div class="mb-2 h-3 w-28 rounded bg-[var(--ui-bg-accented)]"></div>
							<div class="h-3 w-36 rounded bg-[var(--ui-bg-accented)]"></div>
						</div>
					</div>
				{/each}
			</div>
		{:else if visibleSuggested.length}
			<div class="space-y-3">
				{#each visibleSuggested as s (s.pubkey)}
					{@const profile = profiles.get(s.pubkey)}
					{@const name = displayName(s.pubkey)}
					<div class="flex items-center gap-3">
						<Avatar pubkey={s.pubkey} {name} picture={profile?.picture} size={40} />
						<div class="min-w-0 flex-1">
							<p class="truncate text-[13px] font-bold">{name}</p>
							<p class="truncate text-[11px] text-[var(--ui-text-dimmed)]">
								{profileNote(s.pubkey, s.count)}
							</p>
						</div>
						<button
							type="button"
							onclick={() => toggleFollow(s.pubkey)}
							class="rounded-full px-3 py-1.5 text-[11px] font-bold transition-colors {contacts.isFollowing(
								s.pubkey
							)
								? 'bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)]'
								: 'bg-primary-500 text-white hover:bg-primary-600'}"
						>
							{contacts.isFollowing(s.pubkey) ? 'Following' : 'Follow'}
						</button>
					</div>
				{/each}
			</div>
		{:else}
			<div class="rounded-xl bg-[var(--ui-bg-muted)] p-4 text-[13px] text-[var(--ui-text-muted)]">
				No active relay authors found yet.
			</div>
		{/if}
	</div>
</aside>
