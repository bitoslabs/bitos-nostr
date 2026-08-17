<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteDate, SvelteMap, SvelteSet } from 'svelte/reactivity';
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
	const THROUGHPUT_BUCKETS = 30;
	const HISTORY_WINDOW_MS = 24 * 60 * 60_000;
	const HISTORY_BUCKETS = 24;
	const TELEMETRY_BUCKET_MS = 5 * 60_000;
	const TELEMETRY_RETENTION_MS = 7 * 24 * 60 * 60_000;
	const TELEMETRY_CACHE_KEY = 'bitos:relay-telemetry:v1';
	const LIVE_THROUGHPUT_CACHE_KEY = 'bitos:live-throughput:v1';
	const TREND_WINDOW_MS = 24 * 60 * 60_000;
	const TREND_BUCKETS = 24;
	const TREND_CACHE_KEY = 'bitos:trending-tags:v1';
	const MAX_TRACKED_TREND_EVENTS = 5_000;
	const TREND_DAILY_RETENTION_DAYS = 30;
	const TREND_HOUR_MS = 60 * 60_000;
	const LIVE_RENDER_DEBOUNCE_MS = 400;
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
	let trendRange = $state<'day' | 'week'>('day');
	let suggested = $state<Array<{ pubkey: string; count: number; latest: number }>>([]);
	let network = $state({
		activePubkeys: 0,
		eventsPerMin: 0,
		relaysOnline: 0,
		sats24h: 0,
		throughput: Array<number>(THROUGHPUT_BUCKETS).fill(0),
		throughputBucketSeconds: 2,
		history: Array<number>(HISTORY_BUCKETS).fill(0),
		events24h: 0
	});
	const liveEventTimes = new SvelteMap<string, number>();
	/** Five-minute observed-event buckets, retained locally for seven days. */
	const telemetryBuckets = new SvelteMap<number, number>();
	let telemetrySaveTimer: ReturnType<typeof window.setTimeout> | undefined;
	let liveRenderTimer: ReturnType<typeof window.setTimeout> | undefined;
	/** ID, timestamp, and hashtags only — no note content is stored. */
	const trendEvents = new SvelteMap<string, { tags: string[]; at: number }>();
	/** UTC-hour start → tag → observed-note count. Drives the 24h chart. */
	const trendHourlyTotals = new SvelteMap<number, SvelteMap<string, number>>();
	const trendDailyTotals = new SvelteMap<string, SvelteMap<string, number>>();
	let lastTrendPruneAt = 0;
	let trendSaveTimer: ReturnType<typeof window.setTimeout> | undefined;
	/** zap receipt id → { sats, received ms } — feeds the rolling Sats 24h total. */
	const trackedZaps = new SvelteMap<string, { sats: number; at: number }>();
	const me = $derived(identity.current?.pk ?? '');
	const visibleSuggested = $derived(
		suggested
			.filter((person) => person.pubkey !== me && !contacts.isFollowing(person.pubkey))
			.slice(0, SUGGESTION_LIMIT)
	);
	const trendWindowLabel = $derived(trendRange === 'day' ? '24h hourly' : '7 days');

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

	function throughputBucketSeconds(eventCount: number) {
		if (eventCount <= 2) return 30;
		if (eventCount <= 6) return 10;
		if (eventCount <= 20) return 5;
		return 2;
	}

	function throughputBuckets(now = Date.now()) {
		const seconds = throughputBucketSeconds(liveEventTimes.size);
		const bucketMs = seconds * 1_000;
		const buckets = Array<number>(THROUGHPUT_WINDOW_MS / bucketMs).fill(0);
		for (const receivedAt of liveEventTimes.values()) {
			const bucket = Math.floor((receivedAt - (now - THROUGHPUT_WINDOW_MS)) / bucketMs);
			if (bucket >= 0 && bucket < buckets.length) buckets[bucket] += 1;
		}
		const peak = Math.max(...buckets, 1);
		return { data: buckets.map((count) => count / peak), seconds };
	}

	function refreshTelemetryHistory(now = Date.now()) {
		const retentionStart = now - TELEMETRY_RETENTION_MS;
		for (const [bucketStart] of telemetryBuckets) {
			if (bucketStart < retentionStart) telemetryBuckets.delete(bucketStart);
		}
		const hourMs = HISTORY_WINDOW_MS / HISTORY_BUCKETS;
		const buckets = Array<number>(HISTORY_BUCKETS).fill(0);
		const historyStart = now - HISTORY_WINDOW_MS;
		for (const [bucketStart, count] of telemetryBuckets) {
			// A five-minute bucket may start just before the rolling 24h boundary.
			// Keep it when it overlaps the visible period instead of dropping recent events.
			if (bucketStart + TELEMETRY_BUCKET_MS <= historyStart) continue;
			const bucket = Math.max(0, Math.floor((bucketStart - historyStart) / hourMs));
			if (bucket >= 0 && bucket < HISTORY_BUCKETS) buckets[bucket] += count;
		}
		const peak = Math.max(...buckets, 1);
		network = {
			...network,
			history: buckets.map((count) => count / peak),
			events24h: buckets.reduce((sum, count) => sum + count, 0)
		};
	}

	function saveTelemetry() {
		try {
			localStorage.setItem(TELEMETRY_CACHE_KEY, JSON.stringify([...telemetryBuckets]));
		} catch {
			/* Storage is optional; live telemetry continues without it. */
		}
	}

	function saveLiveThroughput() {
		try {
			const cutoff = Date.now() - THROUGHPUT_WINDOW_MS;
			const recent = [...liveEventTimes].filter(([, receivedAt]) => receivedAt >= cutoff);
			localStorage.setItem(LIVE_THROUGHPUT_CACHE_KEY, JSON.stringify(recent));
		} catch {
			/* Storage is optional; the live subscription remains the source of truth. */
		}
	}

	function loadLiveThroughput() {
		try {
			const cached = JSON.parse(localStorage.getItem(LIVE_THROUGHPUT_CACHE_KEY) ?? '[]') as unknown;
			if (!Array.isArray(cached)) return;
			const cutoff = Date.now() - THROUGHPUT_WINDOW_MS;
			for (const entry of cached) {
				if (!Array.isArray(entry) || entry.length !== 2) continue;
				const [id, receivedAt] = entry;
				if (typeof id === 'string' && typeof receivedAt === 'number' && receivedAt >= cutoff)
					liveEventTimes.set(id, receivedAt);
			}
		} catch {
			/* Ignore malformed or unavailable local cache. */
		}
		refreshLiveThroughput();
	}

	function scheduleTelemetrySave() {
		if (telemetrySaveTimer) return;
		telemetrySaveTimer = window.setTimeout(() => {
			telemetrySaveTimer = undefined;
			saveTelemetry();
			saveLiveThroughput();
		}, 5_000);
	}

	function loadTelemetry() {
		try {
			const cached = JSON.parse(localStorage.getItem(TELEMETRY_CACHE_KEY) ?? '[]') as unknown;
			if (!Array.isArray(cached)) return;
			for (const entry of cached) {
				if (!Array.isArray(entry) || entry.length !== 2) continue;
				const [bucketStart, count] = entry;
				if (typeof bucketStart === 'number' && typeof count === 'number' && count > 0)
					telemetryBuckets.set(bucketStart, count);
			}
		} catch {
			/* Ignore malformed or unavailable local cache. */
		}
		refreshTelemetryHistory();
	}

	function recordTelemetryEvent(receivedAt: number) {
		const bucketStart = Math.floor(receivedAt / TELEMETRY_BUCKET_MS) * TELEMETRY_BUCKET_MS;
		telemetryBuckets.set(bucketStart, (telemetryBuckets.get(bucketStart) ?? 0) + 1);
		scheduleTelemetrySave();
	}

	/** Coalesce busy relay traffic so charts update at most 2.5 times per second. */
	function scheduleLiveRender() {
		if (liveRenderTimer) return;
		liveRenderTimer = window.setTimeout(() => {
			liveRenderTimer = undefined;
			refreshLiveThroughput();
			refreshTrends();
			refreshTelemetryHistory();
		}, LIVE_RENDER_DEBOUNCE_MS);
	}

	function saveTrendCache() {
		try {
			localStorage.setItem(
				TREND_CACHE_KEY,
				JSON.stringify({
					version: 3,
					events: [...trendEvents],
					hourly: [...trendHourlyTotals].map(([hour, tags]) => [hour, [...tags]]),
					daily: [...trendDailyTotals].map(([day, tags]) => [day, [...tags]])
				})
			);
		} catch {
			/* Storage is optional; the live trending view still works. */
		}
	}

	function scheduleTrendSave() {
		if (trendSaveTimer) return;
		trendSaveTimer = window.setTimeout(() => {
			trendSaveTimer = undefined;
			saveTrendCache();
		}, 5_000);
	}

	function loadTrendCache() {
		try {
			const cached = JSON.parse(localStorage.getItem(TREND_CACHE_KEY) ?? '[]') as unknown;
			const cachedObject =
				cached && typeof cached === 'object' && !Array.isArray(cached) ? cached : null;
			const eventEntries = Array.isArray(cached)
				? cached
				: (cachedObject as { events?: unknown })?.events;
			const hourlyEntries = (cachedObject as { hourly?: unknown })?.hourly;
			const dailyEntries = (cachedObject as { daily?: unknown })?.daily;
			if (!Array.isArray(eventEntries)) return;
			for (const entry of eventEntries) {
				if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') continue;
				const [id, value] = entry;
				if (!value || typeof value !== 'object') continue;
				const { tags, at } = value as { tags?: unknown; at?: unknown };
				if (typeof at !== 'number' || !Array.isArray(tags)) continue;
				const normalizedTags = tags.filter((tag): tag is string => typeof tag === 'string');
				if (normalizedTags.length === tags.length)
					trendEvents.set(id, { tags: normalizedTags, at });
			}
			if (Array.isArray(dailyEntries)) {
				for (const entry of dailyEntries) {
					if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') continue;
					const [day, tags] = entry;
					if (!Array.isArray(tags)) continue;
					const totals = new SvelteMap<string, number>();
					for (const tagEntry of tags) {
						if (!Array.isArray(tagEntry) || tagEntry.length !== 2) continue;
						const [tag, count] = tagEntry;
						if (typeof tag === 'string' && typeof count === 'number' && count > 0)
							totals.set(tag, count);
					}
					if (totals.size) trendDailyTotals.set(day, totals);
				}
			}
			if (Array.isArray(hourlyEntries)) {
				for (const entry of hourlyEntries) {
					if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'number') continue;
					const [hour, tags] = entry;
					if (!Array.isArray(tags)) continue;
					const totals = new SvelteMap<string, number>();
					for (const tagEntry of tags) {
						if (!Array.isArray(tagEntry) || tagEntry.length !== 2) continue;
						const [tag, count] = tagEntry;
						if (typeof tag === 'string' && typeof count === 'number' && count > 0)
							totals.set(tag, count);
					}
					if (totals.size) trendHourlyTotals.set(hour, totals);
				}
			}
			if (!trendDailyTotals.size) {
				for (const event of trendEvents.values()) incrementTrendDailyTotals(event.tags, event.at);
				scheduleTrendSave();
			}
			if (!trendHourlyTotals.size) {
				for (const event of trendEvents.values()) incrementTrendHourlyTotals(event.tags, event.at);
				scheduleTrendSave();
			}
		} catch {
			/* Ignore malformed or unavailable local cache. */
		}
		refreshTrends();
	}

	function utcDay(at: number) {
		return new Date(at).toISOString().slice(0, 10);
	}

	function incrementTrendDailyTotals(tags: string[], at: number) {
		const day = utcDay(at);
		const totals = trendDailyTotals.get(day) ?? new SvelteMap<string, number>();
		for (const tag of tags) totals.set(tag, (totals.get(tag) ?? 0) + 1);
		trendDailyTotals.set(day, totals);
	}

	function incrementTrendHourlyTotals(tags: string[], at: number) {
		const hour = Math.floor(at / TREND_HOUR_MS) * TREND_HOUR_MS;
		const totals = trendHourlyTotals.get(hour) ?? new SvelteMap<string, number>();
		for (const tag of tags) totals.set(tag, (totals.get(tag) ?? 0) + 1);
		trendHourlyTotals.set(hour, totals);
	}

	function recentUtcHours(now: number, hours: number) {
		const currentHour = Math.floor(now / TREND_HOUR_MS) * TREND_HOUR_MS;
		return Array.from(
			{ length: hours },
			(_, index) => currentHour - (hours - 1 - index) * TREND_HOUR_MS
		);
	}

	function recentUtcDays(now: number, days: number) {
		return Array.from({ length: days }, (_, index) => {
			const date = new SvelteDate(now);
			date.setUTCDate(date.getUTCDate() - (days - 1 - index));
			return date.toISOString().slice(0, 10);
		});
	}

	function refreshLiveThroughput() {
		const cutoff = Date.now() - THROUGHPUT_WINDOW_MS;
		for (const [id, receivedAt] of liveEventTimes) {
			if (receivedAt < cutoff) liveEventTimes.delete(id);
		}
		const throughput = throughputBuckets();
		network = {
			...network,
			eventsPerMin: liveEventTimes.size,
			relaysOnline: relayRows.filter((relay) => relay.status === 'connected').length,
			throughput: throughput.data,
			throughputBucketSeconds: throughput.seconds
		};
	}

	function addTrendEvent(event: {
		id: string;
		tags: string[][];
		content: string;
		created_at: number;
	}) {
		if (trendEvents.has(event.id)) return;
		const tags = [
			...new Set([
				...event.tags.filter((tag) => tag[0] === 't' && tag[1]).map((tag) => tag[1].toLowerCase()),
				...tagsFromContent(event.content)
			])
		];
		if (tags.length) {
			const at = event.created_at * 1000;
			trendEvents.set(event.id, { tags, at });
			incrementTrendHourlyTotals(tags, at);
			incrementTrendDailyTotals(tags, at);
			scheduleTrendSave();
		}
	}

	function refreshTrends(now = Date.now()) {
		const tagCounts = new SvelteMap<string, number>();
		const tagBuckets = new SvelteMap<string, number[]>();
		const hiddenTags = new Set(feedPreferences.state.hiddenTrendTags);
		const activeDays = trendRange === 'day' ? 1 : 7;
		const activeBuckets = trendRange === 'day' ? TREND_BUCKETS : activeDays;

		if (now - lastTrendPruneAt >= TREND_HOUR_MS || trendEvents.size > MAX_TRACKED_TREND_EVENTS) {
			let pruned = false;
			const cutoff = now - TREND_WINDOW_MS;
			for (const [id, event] of trendEvents) {
				if (event.at < cutoff) {
					trendEvents.delete(id);
					pruned = true;
				}
			}
			if (trendEvents.size > MAX_TRACKED_TREND_EVENTS) {
				const oldest = [...trendEvents.entries()].sort((a, b) => a[1].at - b[1].at);
				for (const [id] of oldest.slice(0, trendEvents.size - MAX_TRACKED_TREND_EVENTS))
					trendEvents.delete(id);
				pruned = true;
			}
			const retainedDays = new Set(recentUtcDays(now, TREND_DAILY_RETENTION_DAYS));
			for (const day of trendDailyTotals.keys()) {
				if (!retainedDays.has(day)) {
					trendDailyTotals.delete(day);
					pruned = true;
				}
			}
			const retainedHours = new Set(recentUtcHours(now, TREND_BUCKETS));
			for (const hour of trendHourlyTotals.keys()) {
				if (!retainedHours.has(hour)) {
					trendHourlyTotals.delete(hour);
					pruned = true;
				}
			}
			lastTrendPruneAt = now;
			if (pruned) scheduleTrendSave();
		}

		if (trendRange === 'day') {
			for (const [hourIndex, hour] of recentUtcHours(now, TREND_BUCKETS).entries()) {
				for (const [tag, count] of trendHourlyTotals.get(hour) ?? []) {
					if (hiddenTags.has(tag)) continue;
					tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + count);
					const buckets = tagBuckets.get(tag) ?? Array<number>(TREND_BUCKETS).fill(0);
					buckets[hourIndex] = count;
					tagBuckets.set(tag, buckets);
				}
			}
		} else {
			for (const [dayIndex, day] of recentUtcDays(now, activeDays).entries()) {
				for (const [tag, count] of trendDailyTotals.get(day) ?? []) {
					if (hiddenTags.has(tag)) continue;
					tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + count);
					const buckets = tagBuckets.get(tag) ?? Array<number>(activeBuckets).fill(0);
					buckets[dayIndex] = count;
					tagBuckets.set(tag, buckets);
				}
			}
		}
		trends = [...tagCounts.entries()]
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
			.slice(0, TREND_LIMIT)
			.map(([tag, notes]) => ({
				tag,
				category: 'Nostr',
				notes,
				sats: 0,
				showSats: false,
				bars: tagBuckets.get(tag) ?? []
			}));
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
		const authors = new SvelteSet<string>();
		const authorStats = new SvelteMap<string, { count: number; latest: number }>();
		for (const event of events) {
			authors.add(event.pubkey);
			if (event.pubkey !== me) {
				const stats = authorStats.get(event.pubkey) ?? { count: 0, latest: 0 };
				stats.count += 1;
				stats.latest = Math.max(stats.latest, event.created_at);
				authorStats.set(event.pubkey, stats);
			}
			addTrendEvent(event);
		}

		refreshTrends();
		suggested = [...authorStats.entries()]
			.sort((a, b) => b[1].count - a[1].count || b[1].latest - a[1].latest)
			.slice(0, SUGGESTION_LIMIT * 3)
			.map(([pubkey, stats]) => ({ pubkey, ...stats }));
		void profiles.ensure(suggested.map((person) => person.pubkey));
		network = {
			activePubkeys: authors.size,
			eventsPerMin: liveEventTimes.size,
			relaysOnline: relayRows.filter((relay) => relay.status === 'connected').length,
			sats24h: network.sats24h, // maintained by refreshZapVolume — do not reset here
			throughput: network.throughput,
			throughputBucketSeconds: network.throughputBucketSeconds
		};
		hasLoaded = true;
	}

	async function loadRelayData() {
		loading = true;
		try {
			const events = await queryPrimaryFirst(
				[
					{
						kinds: [NOSTR_KINDS.TEXT_NOTE],
						since: Math.floor((Date.now() - TREND_WINDOW_MS) / 1000),
						limit: SAMPLE_LIMIT
					}
				],
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

	function setTrendRange(range: 'day' | 'week') {
		trendRange = range;
		refreshTrends();
	}

	function hideTrend(tag: string) {
		feedPreferences.hideTrendTag(tag);
		for (const [id, event] of trendEvents) {
			const tags = event.tags.filter((item) => item !== tag);
			if (!tags.length) trendEvents.delete(id);
			else if (tags.length !== event.tags.length) trendEvents.set(id, { ...event, tags });
		}
		for (const [hour, totals] of trendHourlyTotals) {
			totals.delete(tag);
			if (!totals.size) trendHourlyTotals.delete(hour);
		}
		for (const [day, totals] of trendDailyTotals) {
			totals.delete(tag);
			if (!totals.size) trendDailyTotals.delete(day);
		}
		scheduleTrendSave();
		refreshTrends();
	}

	function trendBucketLabel(index: number, count: number, length: number) {
		if (trendRange === 'week') {
			return `${recentUtcDays(Date.now(), length)[index]}: ${count} ${count === 1 ? 'note' : 'notes'}`;
		}
		const hoursAgo = length - index - 1;
		return `${hoursAgo ? `${hoursAgo}h ago` : 'Now'}: ${count} ${count === 1 ? 'note' : 'notes'}`;
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
		loadTelemetry();
		loadLiveThroughput();
		feedPreferences.load();
		loadTrendCache();
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
					const receivedAt = Date.now();
					const isNew = !liveEventTimes.has(event.id);
					liveEventTimes.set(event.id, receivedAt);
					if (isNew) recordTelemetryEvent(receivedAt);
					addTrendEvent(event);
					scheduleLiveRender();
				}
			}
		);
		const timer = window.setInterval(() => {
			refreshLiveThroughput();
			refreshTrends();
			refreshTelemetryHistory();
		}, 5_000);
		// Roll the 24h window and periodically re-fill the sampled zap volume.
		const zapTimer = window.setInterval(refreshZapVolume, 30_000);
		const zapBackfillTimer = window.setInterval(() => void loadZapVolume(), ZAP_REFRESH_MS);

		return () => {
			unsubscribe();
			window.clearInterval(timer);
			window.clearInterval(zapTimer);
			window.clearInterval(zapBackfillTimer);
			if (telemetrySaveTimer) window.clearTimeout(telemetrySaveTimer);
			if (liveRenderTimer) window.clearTimeout(liveRenderTimer);
			if (trendSaveTimer) window.clearTimeout(trendSaveTimer);
			saveTelemetry();
			saveLiveThroughput();
			saveTrendCache();
		};
	});
</script>

{#snippet trendingContent()}
	<section aria-label="Trending now">
		<div class="mb-3 flex items-center justify-between px-3.5">
			<div>
				<h2 class="font-display text-[18px] font-extrabold">Trending now</h2>
				<p class="text-[10px] text-[var(--ui-text-dimmed)]">
					Observed on your relays · {trendWindowLabel}
				</p>
			</div>
			<div class="flex items-center gap-1">
				<button
					type="button"
					onclick={() => setTrendRange('day')}
					aria-pressed={trendRange === 'day'}
					class="rounded px-1.5 py-1 font-mono text-[10px] transition {trendRange === 'day'
						? 'bg-primary-500/10 text-primary-600'
						: 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}">24h</button
				>
				<button
					type="button"
					onclick={() => setTrendRange('week')}
					aria-pressed={trendRange === 'week'}
					class="rounded px-1.5 py-1 font-mono text-[10px] transition {trendRange === 'week'
						? 'bg-primary-500/10 text-primary-600'
						: 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}">7d</button
				>
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
					{@const peak = Math.max(...(trend.bars ?? []), 1)}
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
								{formatCompact(trend.notes)} notes · {trendRange === 'day' ? '24h' : '7d'}
								{#if trend.showSats !== false && trend.sats > 0}
									<span class="ml-1.5 text-[var(--ui-color-primary-500)]"
										>{formatCompact(trend.sats)} sats</span
									>
								{/if}
							</p>
							<div class="mt-2 flex h-6 items-end justify-between gap-[2px]">
								{#each trend.bars ?? [] as count, barIndex (barIndex)}
									<span
										class="min-w-[2px] flex-1 rounded-sm {count > 0
											? 'bg-[var(--ui-color-primary-500)]'
											: 'bg-[var(--ui-border-muted)]'}"
										style={`height:${count > 0 ? Math.max(14, (count / peak) * 100) : 8}%; opacity:${count > 0 ? 0.45 + (barIndex / (trend.bars?.length || 1)) * 0.55 : 0.65}`}
										title={trendBucketLabel(barIndex, count, trend.bars?.length ?? 0)}
									></span>
								{/each}
							</div>
						</a>
						<div
							class="mt-1 flex gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100"
						>
							<button
								type="button"
								onclick={() => feedPreferences.togglePinnedTag(trend.tag)}
								class="grid size-6 place-items-center rounded-md text-[var(--ui-text-dimmed)] transition hover:bg-primary-500/10 hover:text-primary-600"
								aria-label={feedPreferences.isPinned(trend.tag)
									? `Unpin #${trend.tag}`
									: `Pin #${trend.tag}`}
							>
								<Icon
									name={feedPreferences.isPinned(trend.tag) ? 'i-lucide-pin-off' : 'i-lucide-pin'}
									class="size-4"
								/>
							</button>
							<button
								type="button"
								onclick={() => hideTrend(trend.tag)}
								class="grid size-6 place-items-center rounded-md text-[var(--ui-text-dimmed)] transition hover:bg-red-500/10 hover:text-red-600"
								aria-label={`Hide #${trend.tag} from trending`}
								title="Hide this tag"
							>
								<Icon name="i-lucide-eye-off" class="size-4" />
							</button>
						</div>
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
