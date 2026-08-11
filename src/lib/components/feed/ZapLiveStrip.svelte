<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { naddrEncode } from 'nostr-tools/nip19';
	import type { Event } from '$lib/nostr/types';
	import { NOSTR_KINDS } from '$lib/nostr/types';
	import { queryUrls } from '$lib/nostr/pool';
	import { relays } from '$lib/nostr/relays.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';

	type LiveActivity = {
		id: string;
		pubkey: string;
		d: string;
		title: string;
		summary: string;
		image?: string;
		participants: number;
		category?: string;
		createdAt: number;
	};

	const ZAP_STREAM_RELAY = 'wss://relay.zap.stream';
	const CACHE_KEY = 'bitos:zap-live-activities:v1';
	const CACHE_TTL_MS = 60_000;
	const PAGE_SIZE = 24;
	let activities = $state<LiveActivity[]>([]);
	let loading = $state(true);
	let loadingMore = $state(false);
	let hasMore = $state(false);
	let visibleCount = $state(4);

	function tag(event: Event, name: string) {
		return event.tags.find((item) => item[0] === name)?.[1]?.trim() || '';
	}

	function parseActivity(event: Event): LiveActivity | null {
		const d = tag(event, 'd');
		const status = tag(event, 'status').toLowerCase();
		if (!d || (status && status !== 'live')) return null;
		const participants = Number(tag(event, 'current_participants'));
		return {
			id: event.id,
			pubkey: event.pubkey,
			d,
			title: tag(event, 'title') || event.content.trim() || 'Live broadcast',
			summary: tag(event, 'summary'),
			image: tag(event, 'image') || undefined,
			participants: Number.isFinite(participants) ? participants : 0,
			category: tag(event, 't') || undefined,
			createdAt: event.created_at
		};
	}

	function zapUrl(activity: LiveActivity) {
		const naddr = naddrEncode({
			identifier: activity.d,
			pubkey: activity.pubkey,
			kind: NOSTR_KINDS.LIVE_ACTIVITY
		});
		return `https://zap.stream/${naddr}`;
	}

	function cacheActivities() {
		if (!browser) return;
		try {
			localStorage.setItem(CACHE_KEY, JSON.stringify({ cachedAt: Date.now(), activities }));
		} catch {
			/* Cache is best-effort. */
		}
	}

	function readCache() {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(CACHE_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw) as { cachedAt?: number; activities?: LiveActivity[] };
			if (!parsed.cachedAt || !Array.isArray(parsed.activities)) return;
			if (Date.now() - parsed.cachedAt > CACHE_TTL_MS * 10) return;
			activities = parsed.activities;
			profiles.ensure(activities.map((item) => item.pubkey));
		} catch {
			/* Ignore a corrupt or unavailable cache. */
		}
	}

	function refresh(events: Event[], append = false) {
		const current = events
			.map(parseActivity)
			.filter((item): item is LiveActivity => !!item)
			.sort((a, b) => b.participants - a.participants);
		const seen = new Set<string>();
		activities = (append ? [...activities, ...current] : current)
			.filter((item) => {
				if (seen.has(item.pubkey + ':' + item.d)) return false;
				seen.add(item.pubkey + ':' + item.d);
				return true;
			})
			.sort((a, b) => b.participants - a.participants);
		hasMore = current.length >= PAGE_SIZE;
		cacheActivities();
		profiles.ensure(activities.map((item) => item.pubkey));
	}

	async function loadMore() {
		if (loadingMore || !hasMore) return;
		loadingMore = true;
		try {
			const oldest = activities.reduce(
				(value, item) => Math.min(value, item.createdAt),
				Math.floor(Date.now() / 1000)
			);
			const urls = [...new Set([ZAP_STREAM_RELAY, ...relays.orderedReadUrls])];
			const events = await queryUrls(urls, [
				{ kinds: [NOSTR_KINDS.LIVE_ACTIVITY], limit: PAGE_SIZE, until: oldest - 1 }
			]);
			refresh(events, true);
			if (!events.length) hasMore = false;
			visibleCount += 4;
		} finally {
			loadingMore = false;
		}
	}

	onMount(() => {
		let cancelled = false;
		readCache();
		const urls = [...new Set([ZAP_STREAM_RELAY, ...relays.orderedReadUrls])];
		void queryUrls(urls, [{ kinds: [NOSTR_KINDS.LIVE_ACTIVITY], limit: PAGE_SIZE }])
			.then((events) => {
				if (!cancelled) {
					refresh(events);
					visibleCount = 4;
				}
			})
			.catch(() => {
				/* Live discovery is optional and should never block the feed. */
			})
			.finally(() => {
				if (!cancelled) loading = false;
			});
		const refreshTimer = window.setInterval(() => {
			void queryUrls(urls, [{ kinds: [NOSTR_KINDS.LIVE_ACTIVITY], limit: PAGE_SIZE }]).then(
				(events) => {
					if (!cancelled) refresh(events);
				}
			);
		}, CACHE_TTL_MS);
		return () => {
			cancelled = true;
			window.clearInterval(refreshTimer);
		};
	});
</script>

{#if loading || activities.length}
	<section
		class="mb-5 overflow-hidden rounded-[22px] border border-primary-500/20 bg-[linear-gradient(135deg,color-mix(in_oklab,var(--surface-bg)_94%,#7c3aed),var(--surface-bg))] shadow-[0_12px_36px_color-mix(in_srgb,#7c3aed_8%,transparent)]"
		aria-labelledby="live-on-zap-stream"
	>
		<div class="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
			<div class="flex min-w-0 items-center gap-2.5">
				<span
					class="grid size-8 shrink-0 place-items-center rounded-xl bg-primary-500 text-white shadow-lg shadow-primary-500/25"
				>
					<Icon name="i-lucide-radio" class="size-4" />
				</span>
				<div class="min-w-0">
					<h2 id="live-on-zap-stream" class="text-[13px] font-extrabold tracking-tight">
						Live on zap.stream
					</h2>
					<p class="text-[11px] text-[var(--ui-text-muted)]">
						Watch the Nostr community, right now
					</p>
				</div>
			</div>
			<a
				href="https://zap.stream/app"
				target="_blank"
				rel="noreferrer"
				class="shrink-0 rounded-full px-2.5 py-1.5 text-[11px] font-bold text-primary-600 transition hover:bg-primary-500/10"
				>Open web <Icon name="i-lucide-arrow-up-right" class="ml-0.5 inline size-3.5" /></a
			>
		</div>

		{#if loading}
			<div class="flex gap-3 overflow-hidden px-4 pb-4">
				{#each [1, 2] as item}
					<div
						class="h-24 min-w-[210px] animate-pulse rounded-2xl bg-[var(--ui-bg-muted)]"
						aria-hidden="true"
					></div>
				{/each}
			</div>
		{:else}
			<div
				class="flex snap-x [scrollbar-width:none] gap-3 overflow-x-auto px-4 pb-4 [&::-webkit-scrollbar]:hidden"
			>
				{#each activities.slice(0, visibleCount) as activity (activity.pubkey + activity.d)}
					<a
						href={zapUrl(activity)}
						target="_blank"
						rel="noreferrer"
						class="group relative flex min-h-24 min-w-[230px] snap-start overflow-hidden rounded-2xl border border-white/10 bg-[#17131f] text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
					>
						{#if activity.image}<img
								src={activity.image}
								alt=""
								loading="lazy"
								class="absolute inset-0 size-full object-cover opacity-40 transition duration-500 group-hover:scale-105 group-hover:opacity-50"
							/>{/if}
						<div
							class="absolute inset-0 bg-gradient-to-t from-[#17131f] via-[#17131f]/65 to-transparent"
						></div>
						<div class="relative mt-auto w-full p-3">
							<div
								class="mb-1 flex items-center gap-1.5 text-[10px] font-bold tracking-[0.12em] text-red-300 uppercase"
							>
								<span class="live-dot size-1.5"></span> Live {#if activity.participants}<span
										class="text-white/55">· {activity.participants} watching</span
									>{/if}
							</div>
							<div class="flex items-center gap-2">
								<Avatar
									pubkey={activity.pubkey}
									name="Host"
									picture={profiles.get(activity.pubkey)?.picture}
									size={22}
								/><span class="line-clamp-2 text-[12px] leading-tight font-extrabold"
									>{activity.title}</span
								>
							</div>
							{#if activity.category}<span class="mt-1 block truncate text-[10px] text-white/55"
									>#{activity.category}</span
								>{/if}
						</div>
					</a>
				{/each}
			</div>
			{#if activities.length > visibleCount || hasMore}
				<div class="px-4 pb-4">
					<button
						type="button"
						onclick={loadMore}
						disabled={loadingMore}
						class="w-full rounded-xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-3 py-2 text-[11px] font-bold text-[var(--ui-text-muted)] transition hover:text-primary-600 disabled:opacity-60"
					>
						{#if loadingMore}
							<Icon name="i-lucide-loader-circle" class="mr-1 inline size-3.5 animate-spin" /> Loading
							more…
						{:else}
							Load more live streams <Icon
								name="i-lucide-arrow-down"
								class="ml-1 inline size-3.5"
							/>
						{/if}
					</button>
				</div>
			{/if}
		{/if}
	</section>
{/if}
