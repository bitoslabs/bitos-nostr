<script lang="ts">
	import { goto } from '$app/navigation';
	import RightRail from '$lib/components/shell/RightRail.svelte';
	import type { RelayRow } from '$lib/components/shell/RelayWidget.svelte';
	import type { Trend } from '$lib/components/shell/TrendingWidget.svelte';
	import { relays } from '$lib/nostr/relays.svelte';

	let { showTrending = true }: { showTrending?: boolean } = $props();

	/**
	 * App-wide right rail for the premium 3-column shell. Wires the generic
	 * {@link RightRail} (search · network pulse · trending · relays) to live
	 * relay telemetry from the relay store. Trending uses a curated seed of
	 * popular Nostr tags (clicking filters the home feed via ?tag=); per-relay
	 * event counts aren't tracked locally, so those rows show latency only.
	 */
	const TREND_SEED: Trend[] = [
		{ tag: 'nostr', category: 'Tech', notes: 4203, sats: 12400 },
		{ tag: 'bitcoin', category: 'Bitcoin', notes: 3920, sats: 9800 },
		{ tag: 'lightning', category: 'Bitcoin', notes: 1920, sats: 8200 },
		{ tag: 'plebchain', category: 'Community', notes: 1432, sats: 3120 },
		{ tag: 'proofofwork', category: 'Dev', notes: 892, sats: 1400 }
	];

	const relayRows = $derived(
		relays.list
			.map((r) => ({
				url: r.url.replace(/^wss?:\/\//i, ''),
				status:
					r.status === 'ok'
						? ('connected' as const)
						: r.status === 'fail'
							? ('down' as const)
							: ('connecting' as const),
				latency: r.latency ?? 0,
				events: 0,
				mode: (r.read && r.write ? 'both' : r.write ? 'write' : 'read') as RelayRow['mode'],
				paid: false
			}))
			.slice(0, 6)
	);

	function selectTag(tag: string) {
		void goto(`/?tag=${encodeURIComponent(tag)}`);
	}

	function manageRelays() {
		void goto('/settings/relays');
	}

	function search(_value: string) {
		/* live filtering is page-specific; the rail routes to Discover instead. */
	}

	function submitSearch() {
		void goto('/discover');
	}
</script>

<RightRail
	trends={TREND_SEED}
	relays={relayRows}
	{showTrending}
	onSearch={search}
	onSubmit={submitSearch}
	onSelectTag={selectTag}
	onManageRelays={manageRelays}
/>
