<script lang="ts">
	import PremiumShell from '$lib/components/shell/PremiumShell.svelte';
	import RightRail from '$lib/components/shell/RightRail.svelte';
	import NetworkStats from '$lib/components/shell/NetworkStats.svelte';
	import TopZapped from '$lib/components/shell/TopZapped.svelte';
	import NotificationSummary from '$lib/components/shell/NotificationSummary.svelte';
	import QuickActions from '$lib/components/shell/QuickActions.svelte';
	import YourStats from '$lib/components/shell/YourStats.svelte';
	import HomeView from '$lib/components/premium/HomeView.svelte';
	import ExploreView from '$lib/components/premium/ExploreView.svelte';
	import NotificationsView from '$lib/components/premium/NotificationsView.svelte';
	import MessagesView from '$lib/components/premium/MessagesView.svelte';
	import ZapsView from '$lib/components/premium/ZapsView.svelte';
	import RelaysView from '$lib/components/premium/RelaysView.svelte';
	import BookmarksView from '$lib/components/premium/BookmarksView.svelte';
	import ProfileView from '$lib/components/premium/ProfileView.svelte';
	import SettingsView from '$lib/components/premium/SettingsView.svelte';
	import { account, nav, trends, relays, posts } from '$lib/components/premium/data';

	/**
	 * Premium UI showcase router. Mirrors the docs/ui4.html SPA: the left nav
	 * switches the center view in-app, and the right rail re-contextualizes per
	 * page. This page is a thin orchestrator — every visual lives in a dedicated
	 * single-responsibility component.
	 */

	type Page =
		| 'home'
		| 'explore'
		| 'notifications'
		| 'messages'
		| 'zaps'
		| 'relays'
		| 'bookmarks'
		| 'profile'
		| 'settings';
	let page = $state<Page>('home');

	// Quick-action destinations for the default right rail.
	const quickActions = [
		{ label: 'New Note', icon: 'i-lucide-pen-line', tone: 'accent' as const },
		{ label: 'Manage Keys', icon: 'i-lucide-key-round', tone: 'warm' as const },
		{ label: 'Configure Relays', icon: 'i-lucide-server', tone: 'success' as const }
	];

	const notifBuckets = [
		{ type: 'Zaps', icon: 'i-lucide-zap', tone: 'accent' as const, count: 24 },
		{ type: 'Likes', icon: 'i-lucide-heart', tone: 'warm' as const, count: 89 },
		{ type: 'Reposts', icon: 'i-lucide-repeat-2', tone: 'success' as const, count: 12 },
		{ type: 'Follows', icon: 'i-lucide-user-plus', tone: 'info' as const, count: 7 },
		{ type: 'Mentions', icon: 'i-lucide-at-sign', tone: 'neutral' as const, count: 5 }
	];

	function onAction(label: string) {
		if (label === 'New Note') page = 'home';
		else if (label === 'Manage Keys') page = 'settings';
		else if (label === 'Configure Relays') page = 'relays';
	}
</script>

<svelte:head><title>Premium UI · BitOS</title></svelte:head>

<PremiumShell
	{nav}
	{account}
	activePage={page}
	onNavigate={(p) => (page = p as Page)}
	balance={12847}
	connected={relays.filter((r) => r.status === 'connected').length}
	total={relays.length}
	network={{ activePubkeys: 47392, eventsPerMin: 312, relaysOnline: 1247, sats24h: 2_400_000 }}
	{trends}
	{relays}
	onSelectTag={() => (page = 'explore')}
	onManageRelays={() => (page = 'relays')}
>
	<!-- Contextual right rail -->
	{#snippet rail()}
		{#if page === 'home'}
			<RightRail
				{trends}
				{relays}
				network={{
					activePubkeys: 47392,
					eventsPerMin: 312,
					relaysOnline: 1247,
					sats24h: 2_400_000
				}}
				onSelectTag={() => (page = 'explore')}
				onManageRelays={() => (page = 'relays')}
			/>
		{:else if page === 'explore'}
			<aside class="flex flex-col gap-3.5 p-3.5">
				<NetworkStats
					stats={[
						{ label: 'Total pubkeys', value: 847000 },
						{ label: 'Daily active', value: 47000, tone: 'success' },
						{ label: 'Notes today', value: 312000 },
						{ label: 'Zaps today', value: 2_400_000, tone: 'accent' }
					]}
				/>
				<TopZapped {posts} />
			</aside>
		{:else if page === 'notifications'}
			<aside class="p-3.5">
				<NotificationSummary buckets={notifBuckets} />
			</aside>
		{:else}
			<aside class="flex flex-col gap-3.5 p-3.5">
				<QuickActions actions={quickActions} {onAction} />
				<YourStats />
			</aside>
		{/if}
	{/snippet}

	<!-- Center view -->
	{#key page}
		<div class="animate-rise">
			{#if page === 'home'}
				<HomeView />
			{:else if page === 'explore'}
				<ExploreView />
			{:else if page === 'notifications'}
				<NotificationsView />
			{:else if page === 'messages'}
				<MessagesView />
			{:else if page === 'zaps'}
				<ZapsView />
			{:else if page === 'relays'}
				<RelaysView />
			{:else if page === 'bookmarks'}
				<BookmarksView />
			{:else if page === 'profile'}
				<ProfileView onBack={() => (page = 'home')} />
			{:else if page === 'settings'}
				<SettingsView />
			{/if}
		</div>
	{/key}
</PremiumShell>
