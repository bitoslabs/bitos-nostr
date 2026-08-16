<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import RightRail from '$lib/components/shell/RightRail.svelte';
	import type { RelayRow } from '$lib/components/shell/RelayWidget.svelte';
	import type { Trend } from '$lib/components/shell/TrendingWidget.svelte';
	import { contacts } from '$lib/nostr/contacts.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { queryPrimaryFirst, subscribe } from '$lib/nostr/pool';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { relays } from '$lib/nostr/relays.svelte';
	import { NOSTR_KINDS } from '$lib/nostr/types';
	import { feedPreferences } from '$lib/stores/feed-preferences.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { formatCompact, shortKey } from '$lib/utils/format';

	let {
		showTrending = true,
		showSuggestions = true
	}: { showTrending?: boolean; showSuggestions?: boolean } = $props();

	const TREND_LIMIT = 6;
	const SUGGESTION_LIMIT = 4;
	const SAMPLE_LIMIT = 300;
	const THROUGHPUT_WINDOW_MS = 60_000;
	/** Rolling window for the “Sats 24h” network pulse stat. */
	const ZAP_WINDOW_MS = 24 * 60 * 60 * 1000;
	const ZAP_SAMPLE_LIMIT = 500;
	/** Re-pull the zap backfill periodically — relays cap query results, so the
	 * live total drifts low between refreshes without this. */
	const ZAP_REFRESH_MS = 10 * 60 * 1000;
	/** Upper bound on cached receipts so a chatty relay cannot grow memory. */
	const MAX_TRACKED_ZAPS = 5_000;
	const hashtagPattern = /(?:^|\s)#([\p{L}\p{N}_-]{2,60})/gu;

	let loading = $state(false);
	let hasLoaded = $state(false);
	let trends = $state<Trend[]>([]);
	let suggested = $state<Array<{ pubkey: string; count: number; latest: number }>>([]);
	let network = $state({ activePubkeys: 0, eventsPerMin: 0, relaysOnline: 0, sats24h: 0 });
	const liveEventTimes = new Map<string, number>();
	/** zap receipt id → { sats, received ms } — feeds the rolling Sats 24h total. */
	const trackedZaps = new Map<string, { sats: number; at: number }>();
	const me = $derived(identity.current?.pk ?? '');
	const visibleSuggested = $derived(
		suggested
			.filter((person) => person.pubkey !== me && !contacts.isFollowing(person.pubkey))
			.slice(0, SUGGESTION_LIMIT)
	);

	const relayRows = $derived(
		relays.list
			.map((relay) => ({
				url: relay.url.replace(/^wss?:\/\//i, ''),
				status:
					relay.status === 'ok'
						? ('connected' as const)
						: relay.status === 'fail'
							? ('down' as const)
							: ('connecting' as const),
				latency: relay.latency ?? 0,
				events: 0,
				mode: (relay.read && relay.write
					? 'both'
					: relay.write
						? 'write'
						: 'read') as RelayRow['mode'],
				paid: false
			}))
			.slice(0, 6)
	);

	function tagsFromContent(content: string) {
		return [...content.matchAll(hashtagPattern)].map((match) => match[1].toLowerCase());
	}

	function displayName(pubkey: string) {
		const profile = profiles.get(pubkey);
		return profile?.display_name || profile?.name || shortKey(pubkey);
	}

	function profileNote(pubkey: string, count: number) {
		return (
			profiles.get(pubkey)?.about || `${count} recent ${count === 1 ? 'note' : 'notes'} from relays`
		);
	}

	function trendBars(tag: string, rank: number) {
		// Stable, tag-specific bars give each live trend a recognisable signal
		// without inventing engagement data that the relays did not provide.
		let seed = rank * 47;
		for (let i = 0; i < tag.length; i++) seed = (seed * 31 + tag.charCodeAt(i)) >>> 0;
		return Array.from({ length: 18 }, (_, index) => {
			seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
			return 28 + (seed % 72) + (index > 14 ? 12 : 0);
		});
	}

	function refreshLiveThroughput() {
		const cutoff = Date.now() - THROUGHPUT_WINDOW_MS;
		for (const [id, receivedAt] of liveEventTimes) {
			if (receivedAt < cutoff) liveEventTimes.delete(id);
		}
		network = {
			...network,
			eventsPerMin: liveEventTimes.size,
			relaysOnline: relayRows.filter((relay) => relay.status === 'connected').length
		};
	}

	/** Sats carried by a kind 9735 zap receipt (NIP-57 `amount` tag, msat). */
	function zapSatsFromTags(tags: string[][]): number {
		const amount = tags.find((tag) => tag[0] === 'amount' && tag[1])?.[1];
		const msat = amount ? Number(amount) : 0;
		return Number.isFinite(msat) && msat > 0 ? Math.round(msat / 1000) : 0;
	}

	/** Fold received zap receipts into the tracked set (dedup by event id). */
	function applyZapSample(events: Awaited<ReturnType<typeof queryPrimaryFirst>>) {
		for (const event of events) {
			if (event.kind !== NOSTR_KINDS.ZAP) continue;
			if (trackedZaps.has(event.id)) continue;
			trackedZaps.set(event.id, { sats: zapSatsFromTags(event.tags), at: event.created_at * 1000 });
		}
		refreshZapVolume();
	}

	/** Recompute Sats 24h: drop receipts older than the window, sum the rest. */
	function refreshZapVolume() {
		const cutoff = Date.now() - ZAP_WINDOW_MS;
		for (const [id, zap] of trackedZaps) {
			if (zap.at < cutoff) trackedZaps.delete(id);
		}
		if (trackedZaps.size > MAX_TRACKED_ZAPS) {
			const byAge = [...trackedZaps.entries()].sort((a, b) => a[1].at - b[1].at);
			for (const [id] of byAge.slice(0, trackedZaps.size - MAX_TRACKED_ZAPS))
				trackedZaps.delete(id);
		}
		let sats24h = 0;
		for (const zap of trackedZaps.values()) sats24h += zap.sats;
		network = { ...network, sats24h };
	}

	/** Best-effort backfill of recent zap volume from the user's relays. */
	async function loadZapVolume() {
		try {
			const events = await queryPrimaryFirst(
				[
					{
						kinds: [NOSTR_KINDS.ZAP],
						since: Math.floor((Date.now() - ZAP_WINDOW_MS) / 1000),
						limit: ZAP_SAMPLE_LIMIT
					}
				],
				{ onSecondary: applyZapSample }
			);
			applyZapSample(events);
		} catch {
			/* zap telemetry is best-effort — keep the last known total */
		}
	}

	function applyRelaySample(events: Awaited<ReturnType<typeof queryPrimaryFirst>>) {
		const tagCounts = new Map<string, number>();
		const authors = new Set<string>();
		const authorStats = new Map<string, { count: number; latest: number }>();

		for (const event of events) {
			authors.add(event.pubkey);
			if (event.pubkey !== me) {
				const stats = authorStats.get(event.pubkey) ?? { count: 0, latest: 0 };
				stats.count += 1;
				stats.latest = Math.max(stats.latest, event.created_at);
				authorStats.set(event.pubkey, stats);
			}
			const tags = new Set([
				...event.tags.filter((tag) => tag[0] === 't' && tag[1]).map((tag) => tag[1].toLowerCase()),
				...tagsFromContent(event.content)
			]);
			for (const tag of tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
		}

		trends = [...tagCounts.entries()]
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
			.slice(0, TREND_LIMIT)
			.map(([tag, notes]) => ({ tag, category: 'Nostr', notes, sats: 0, showSats: false }));
		suggested = [...authorStats.entries()]
			.sort((a, b) => b[1].count - a[1].count || b[1].latest - a[1].latest)
			.slice(0, SUGGESTION_LIMIT * 3)
			.map(([pubkey, stats]) => ({ pubkey, ...stats }));
		void profiles.ensure(suggested.map((person) => person.pubkey));
		network = {
			activePubkeys: authors.size,
			eventsPerMin: liveEventTimes.size,
			relaysOnline: relayRows.filter((relay) => relay.status === 'connected').length,
			sats24h: network.sats24h // maintained by refreshZapVolume — do not reset here
		};
		hasLoaded = true;
	}

	async function loadRelayData() {
		loading = true;
		try {
			const events = await queryPrimaryFirst(
				[{ kinds: [NOSTR_KINDS.TEXT_NOTE], limit: SAMPLE_LIMIT }],
				{
					onSecondary: applyRelaySample
				}
			);
			applyRelaySample(events);
		} catch (error) {
			toasts.error((error as Error).message || 'Could not load relay trends');
		} finally {
			loading = false;
		}
	}

	function selectTag(tag: string) {
		void goto(`/?tag=${encodeURIComponent(tag)}`);
	}

	function submitSearch(value: string) {
		const query = value.trim();
		void goto(query ? `/discover?q=${encodeURIComponent(query)}` : '/discover');
	}

	function manageRelays() {
		void goto('/settings/security');
	}

	async function toggleFollow(pubkey: string) {
		try {
			if (contacts.isFollowing(pubkey)) await contacts.unfollow(pubkey);
			else await contacts.follow(pubkey);
		} catch (error) {
			toasts.error((error as Error).message || 'Could not update follow list');
		}
	}

	onMount(() => {
		void loadRelayData();
		void loadZapVolume();
		const receivedAt = Math.floor(Date.now() / 1000);
		const unsubscribe = subscribe(
			[
				{ kinds: [NOSTR_KINDS.TEXT_NOTE], since: receivedAt },
				// Live zap receipts keep Sats 24h growing between backfill refreshes.
				{ kinds: [NOSTR_KINDS.ZAP], since: receivedAt }
			],
			{
				onevent: (event) => {
					if (event.kind === NOSTR_KINDS.ZAP) {
						applyZapSample([event]);
						return;
					}
					liveEventTimes.set(event.id, Date.now());
					refreshLiveThroughput();
				}
			}
		);
		const timer = window.setInterval(refreshLiveThroughput, 5_000);
		// Roll the 24h window and periodically re-fill the sampled zap volume.
		const zapTimer = window.setInterval(refreshZapVolume, 30_000);
		const zapBackfillTimer = window.setInterval(() => void loadZapVolume(), ZAP_REFRESH_MS);

		return () => {
			unsubscribe();
			window.clearInterval(timer);
			window.clearInterval(zapTimer);
			window.clearInterval(zapBackfillTimer);
		};
	});
</script>

{#snippet trendingContent()}
	<section aria-label="Trending now">
		<div class="mb-3 flex items-center justify-between px-3.5">
			<div>
				<h2 class="font-display text-[18px] font-extrabold">Trending now</h2>
				<p class="text-[10px] text-[var(--ui-text-dimmed)]">Live signal from your relays</p>
			</div>
			<button
				type="button"
				onclick={loadRelayData}
				disabled={loading}
				class="grid size-8 place-items-center rounded-lg text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-primary-500 disabled:opacity-60"
				aria-label="Refresh trends"
			>
				<Icon name="i-lucide-rotate-cw" class="size-4 {loading ? 'animate-spin' : ''}" />
			</button>
		</div>
		{#if !hasLoaded && loading}
			<div class="space-y-2 px-3.5">
				{#each [0, 1, 2] as item (item)}<div
						class="h-14 animate-pulse rounded-xl bg-[var(--ui-bg-muted)]"
					></div>{/each}
			</div>
		{:else if trends.length}
			<div class="grid grid-cols-2 gap-x-2 gap-y-2 px-3.5">
				{#each trends as trend, index (trend.tag)}
					{@const bars = trendBars(trend.tag, index + 1)}
					<div
						class="group min-w-0 rounded-xl p-2.5 transition hover:bg-[var(--interactive-hover-bg)]"
					>
						<a href={`/?tag=${encodeURIComponent(trend.tag)}`} class="block">
							<div
								class="flex items-center justify-between gap-2 text-[10px] font-medium tracking-wide text-[var(--ui-text-dimmed)] uppercase"
							>
								<span>{trend.category} · #{index + 1}</span>
								<Icon
									name="i-lucide-trending-up"
									class="size-3.5 text-[var(--tone-success-text)]"
								/>
							</div>
							<p
								class="mt-1 truncate text-[15px] font-extrabold text-[var(--ui-color-primary-500)]"
							>
								#{trend.tag}
							</p>
							<p class="mt-1 font-mono text-[10.5px] text-[var(--ui-text-muted)]">
								{formatCompact(trend.notes)} notes
								{#if trend.showSats !== false && trend.sats > 0}
									<span class="ml-1.5 text-[var(--ui-color-primary-500)]"
										>{formatCompact(trend.sats)} sats</span
									>
								{/if}
							</p>
							<div class="mt-2 flex h-6 items-end gap-[2px]" aria-hidden="true">
								{#each bars as height, barIndex (barIndex)}
									<span
										class="w-[3px] rounded-sm bg-[var(--ui-color-primary-500)]"
										style={`height:${height}%; opacity:${0.35 + (barIndex / bars.length) * 0.65}`}
									></span>
								{/each}
							</div>
						</a>
						<button
							type="button"
							onclick={() => feedPreferences.togglePinnedTag(trend.tag)}
							class="mt-1 grid size-6 place-items-center rounded-md text-[var(--ui-text-dimmed)] opacity-0 transition group-hover:opacity-100 hover:bg-primary-500/10 hover:text-primary-600 focus:opacity-100"
							aria-label={feedPreferences.isPinned(trend.tag)
								? `Unpin #${trend.tag}`
								: `Pin #${trend.tag}`}
						>
							<Icon
								name={feedPreferences.isPinned(trend.tag) ? 'i-lucide-pin-off' : 'i-lucide-pin'}
								class="size-4"
							/>
						</button>
					</div>
				{/each}
			</div>
		{:else if hasLoaded}
			<p class="px-3.5 text-sm text-[var(--ui-text-muted)]">
				No hashtags found in this relay sample.
			</p>
		{/if}
	</section>
{/snippet}

{#snippet afterTrending()}
	{#if showSuggestions}
		<section class="px-3.5" aria-label="Suggested for you">
			<h2 class="mb-3 font-display text-[18px] font-extrabold">People you might like</h2>
			{#if !hasLoaded && loading}
				<div class="grid grid-cols-2 gap-2.5">
					{#each [0, 1, 2] as item (item)}<div
							class="h-36 animate-pulse rounded-xl bg-[var(--ui-bg-muted)]"
						></div>{/each}
				</div>
			{:else if visibleSuggested.length}
				<div class="grid grid-cols-2 gap-2.5">
					{#each visibleSuggested as person (person.pubkey)}
						{@const profile = profiles.get(person.pubkey)}
						{@const name = displayName(person.pubkey)}
						<div class="rounded-xl p-2.5 transition hover:bg-[var(--interactive-hover-bg)]">
							<div class="flex min-w-0 items-center gap-2">
								<a
									href={`/profile/${person.pubkey}`}
									class="shrink-0 mask-squircle transition hover:ring-2 hover:ring-primary-500/30"
									aria-label={`Open ${name} profile`}
									><Avatar pubkey={person.pubkey} {name} picture={profile?.picture} size={34} /></a
								><a
									href={`/profile/${person.pubkey}`}
									class="min-w-0 transition hover:text-primary-600"
								>
									<p class="truncate text-[12px] font-bold hover:underline">{name}</p>
									<p class="truncate font-mono text-[9.5px] text-[var(--ui-text-dimmed)]">
										{shortKey(person.pubkey, 8, 4)}
									</p>
								</a>
							</div>
							<p
								class="mt-2 line-clamp-2 min-h-8 text-[10.5px] leading-4 text-[var(--ui-text-muted)]"
							>
								{profileNote(person.pubkey, person.count)}
							</p>
							<div class="mt-2 flex items-center justify-between gap-2">
								<span class="font-mono text-[9.5px] text-[var(--ui-text-dimmed)]"
									>{formatCompact(person.count)} notes</span
								>
								<button
									type="button"
									onclick={() => toggleFollow(person.pubkey)}
									class="rounded-full bg-primary-500 px-2.5 py-1 text-[10px] font-bold text-[var(--ui-text-inverted)] transition hover:bg-primary-600"
									>Follow</button
								>
							</div>
						</div>
					{/each}
				</div>
			{:else if hasLoaded}
				<p class="text-sm text-[var(--ui-text-muted)]">No new relay authors to suggest.</p>
			{/if}
		</section>
	{/if}
{/snippet}

<RightRail
	{trends}
	relays={relayRows}
	{network}
	{showTrending}
	onSubmit={submitSearch}
	onSelectTag={selectTag}
	onManageRelays={manageRelays}
	{trendingContent}
	{afterTrending}
/>
