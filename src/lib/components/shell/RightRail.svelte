<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import NetworkPulse from '$lib/components/shell/NetworkPulse.svelte';
	import TrendingWidget from '$lib/components/shell/TrendingWidget.svelte';
	import RelayWidget from '$lib/components/shell/RelayWidget.svelte';
	import type { Trend } from '$lib/components/shell/TrendingWidget.svelte';
	import type { RelayRow } from '$lib/components/shell/RelayWidget.svelte';

	/**
	 * Default right rail: search field, network pulse, trending tags, and
	 * active relays, plus a slim footer. The caller supplies the data; pages
	 * that need bespoke content can pass an `extra` snippet above the footer.
	 */
	let {
		search = '',
		trends = [],
		relays = [],
		showTrending = true,
		network = {},
		onSearch,
		onSubmit,
		onSelectTag,
		onManageRelays,
		trendingContent,
		afterTrending,
		extra
	}: {
		search?: string;
		trends?: Trend[];
		relays?: RelayRow[];
		showTrending?: boolean;
		network?: {
			activePubkeys?: number;
			eventsPerMin?: number;
			relaysOnline?: number;
			sats24h?: number;
			throughput?: number[];
			throughputBucketSeconds?: number;
			history?: number[];
			events24h?: number;
		};
		onSearch?: (value: string) => void;
		onSubmit?: (value: string) => void;
		onSelectTag?: (tag: string) => void;
		onManageRelays?: () => void;
		trendingContent?: Snippet;
		afterTrending?: Snippet;
		extra?: Snippet;
	} = $props();
</script>

<aside class="flex flex-col gap-3.5 border-l border-[var(--ui-border-muted)] p-3.5">
	<form
		class="flex items-center gap-2"
		onsubmit={(event) => {
			event.preventDefault();
			const value = new FormData(event.currentTarget).get('search');
			onSubmit?.(typeof value === 'string' ? value : '');
		}}
	>
		<label class="relative block min-w-0 flex-1">
			<Icon
				name="i-lucide-search"
				class="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-[var(--ui-text-dimmed)]"
			/>
			<input
				name="search"
				type="search"
				value={search}
				placeholder="Search npubs, events…"
				oninput={(e) => onSearch?.((e.currentTarget as HTMLInputElement).value)}
				class="w-full rounded-full border border-[var(--ui-border-muted)] bg-[var(--interactive-hover-bg)] py-2.5 pr-4 pl-11 text-sm text-[var(--ui-text)] transition outline-none focus:border-[var(--ui-color-primary-500)] focus:bg-[color-mix(in_oklab,var(--ui-color-primary-500)_8%,transparent)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--ui-color-primary-500)_20%,transparent)]"
			/>
		</label>
		{#if onSubmit}
			<button
				type="submit"
				class="grid size-10 shrink-0 place-items-center rounded-full border border-primary-500/25 bg-primary-500/10 text-primary-600 transition hover:bg-primary-500 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
				aria-label="Search Discover"
				title="Search Discover"
			>
				<Icon name="i-lucide-search" class="size-4" />
			</button>
		{/if}
	</form>

	<NetworkPulse {...network} />

	{#if showTrending}
		{#if trendingContent}
			{@render trendingContent()}
		{:else}
			<TrendingWidget {trends} onSelect={onSelectTag} />
		{/if}
		{#if afterTrending}{@render afterTrending()}{/if}
	{/if}

	<RelayWidget {relays} onManage={onManageRelays} />

	{#if extra}{@render extra()}{/if}

	<div class="px-3.5 py-2 text-[11px] leading-relaxed text-[var(--ui-text-dimmed)]">
		<div class="mb-2 flex flex-wrap gap-3">
			<a
				href="/about"
				class="text-[var(--ui-text-muted)] transition hover:text-[var(--ui-color-primary-500)]"
				>NIPs</a
			>
			<a
				href="/about"
				class="text-[var(--ui-text-muted)] transition hover:text-[var(--ui-color-primary-500)]"
				>SDKs</a
			>
			<a
				href="/privacy"
				class="text-[var(--ui-text-muted)] transition hover:text-[var(--ui-color-primary-500)]"
				>Privacy</a
			>
		</div>
		<div class="font-mono">v{__APP_VERSION__} · built on NIP-01</div>
	</div>
</aside>
