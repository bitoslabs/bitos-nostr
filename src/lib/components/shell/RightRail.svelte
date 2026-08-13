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
		};
		onSearch?: (value: string) => void;
		onSubmit?: (value: string) => void;
		onSelectTag?: (tag: string) => void;
		onManageRelays?: () => void;
		extra?: Snippet;
	} = $props();
</script>

<aside class="flex flex-col gap-3.5 p-3.5">
	<label class="relative block">
		<Icon
			name="i-lucide-search"
			class="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-[var(--ui-text-dimmed)]"
		/>
		<input
			type="search"
			value={search}
			placeholder="Search npubs, events…"
			oninput={(e) => onSearch?.((e.currentTarget as HTMLInputElement).value)}
			onkeydown={(e) => {
				if (e.key === 'Enter') onSubmit?.((e.currentTarget as HTMLInputElement).value);
			}}
			class="w-full rounded-full border border-[var(--ui-border-muted)] bg-[var(--interactive-hover-bg)] py-2.5 pr-4 pl-11 text-sm text-[var(--ui-text)] outline-none transition focus:border-[var(--ui-color-primary-500)] focus:bg-[color-mix(in_oklab,var(--ui-color-primary-500)_8%,transparent)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--ui-color-primary-500)_20%,transparent)]"
		/>
	</label>

	<NetworkPulse {...network} />

	{#if showTrending}
		<TrendingWidget {trends} onSelect={onSelectTag} />
	{/if}

	<RelayWidget {relays} onManage={onManageRelays} />

	{#if extra}{@render extra()}{/if}

	<div class="px-3.5 py-2 text-[11px] leading-relaxed text-[var(--ui-text-dimmed)]">
		<div class="mb-2 flex flex-wrap gap-3">
			<a href="/about" class="text-[var(--ui-text-muted)] transition hover:text-[var(--ui-color-primary-500)]">NIPs</a>
			<a href="/about" class="text-[var(--ui-text-muted)] transition hover:text-[var(--ui-color-primary-500)]">SDKs</a>
			<a href="/privacy" class="text-[var(--ui-text-muted)] transition hover:text-[var(--ui-color-primary-500)]">Privacy</a>
		</div>
		<div class="font-mono">v0.4.2 · built on NIP-01</div>
	</div>
</aside>
