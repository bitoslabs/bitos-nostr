<script lang="ts">
	import type { Snippet } from 'svelte';
	import NetworkBar from '$lib/components/shell/NetworkBar.svelte';
	import PremiumSidebar from '$lib/components/shell/PremiumSidebar.svelte';
	import RightRail from '$lib/components/shell/RightRail.svelte';
	import type { NavEntry, AccountChip } from '$lib/components/shell/PremiumSidebar.svelte';
	import type { Trend } from '$lib/components/shell/TrendingWidget.svelte';
	import type { RelayRow } from '$lib/components/shell/RelayWidget.svelte';

	type NetworkStats = {
		activePubkeys?: number;
		eventsPerMin?: number;
		relaysOnline?: number;
		sats24h?: number;
	};

	/**
	 * The full premium application shell: ambient backdrop, film grain, the top
	 * throughput bar, and a responsive 3-column grid (sidebar · content · rail).
	 *
	 * The center column is the page's `children`. The sidebar is wired from data
	 * props (and supports in-app SPA navigation via `onNavigate` + `activePage`).
	 * The right column defaults to the home rail (search + pulse + trending +
	 * relays); pass a `rail` snippet to render page-specific widgets instead.
	 */
	let {
		nav = [],
		account = null,
		activePage,
		onNavigate,
		trends = [],
		relays = [],
		network = {},
		balance = 12847,
		connected = 6,
		total = 7,
		onNewNote,
		onDeposit,
		onWithdraw,
		onAccount,
		onSearch,
		onSelectTag,
		onManageRelays,
		rail,
		children
	}: {
		nav?: NavEntry[];
		account?: AccountChip | null;
		activePage?: string;
		onNavigate?: (page: string) => void;
		trends?: Trend[];
		relays?: RelayRow[];
		network?: NetworkStats;
		balance?: number;
		connected?: number;
		total?: number;
		onNewNote?: () => void;
		onDeposit?: () => void;
		onWithdraw?: () => void;
		onAccount?: () => void;
		onSearch?: (value: string) => void;
		onSelectTag?: (tag: string) => void;
		onManageRelays?: () => void;
		rail?: Snippet;
		children: Snippet;
	} = $props();
</script>

<div class="pulse-theme min-h-screen" data-ui="ui4">
	<div class="grain" aria-hidden="true"></div>
	<NetworkBar {connected} {total} />

	<div
		class="prem-grid relative z-10 mx-auto grid min-h-screen max-w-[1280px] grid-cols-[260px_1fr_340px]"
	>
		<div class="prem-left">
			<PremiumSidebar
				{nav}
				{account}
				{balance}
				{activePage}
				{onNewNote}
				{onNavigate}
				{onDeposit}
				{onWithdraw}
				{onAccount}
			/>
		</div>

		<main class="prem-center min-w-0 border-r border-[var(--ui-border-muted)]">
			{@render children()}
		</main>

		<div class="prem-right">
			{#if rail}
				{@render rail()}
			{:else}
				<RightRail {trends} {relays} {network} {onSearch} {onSelectTag} {onManageRelays} />
			{/if}
		</div>
	</div>
</div>

<style>
	/* Right rail drops below ~1100px, sidebar below ~800px. */
	@media (max-width: 1100px) {
		.prem-grid {
			grid-template-columns: 260px 1fr;
		}
		.prem-right {
			display: none;
		}
	}
	@media (max-width: 800px) {
		.prem-grid {
			grid-template-columns: 1fr;
		}
		.prem-left {
			display: none;
		}
	}
</style>
