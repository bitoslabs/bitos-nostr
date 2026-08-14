<script lang="ts" module>
	import type { Snippet } from 'svelte';
	import type { Tab } from '$lib/components/ui/SegmentedTabs.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import SegmentedTabs from '$lib/components/ui/SegmentedTabs.svelte';
</script>

<script lang="ts">
	/**
	 * Sticky premium page header. The top row (back button, title, subtitle,
	 * actions) only renders when there's something to show; the underline tab
	 * row renders when `tabs` + `activeTab` are provided. Pure chrome shared by
	 * every premium view.
	 */
	let {
		title,
		subtitle,
		back = false,
		onBack,
		actions,
		tabs,
		activeTab,
		onTabChange,
		children
	}: {
		title?: string;
		subtitle?: string;
		back?: boolean;
		onBack?: () => void;
		actions?: Snippet;
		tabs?: Tab[];
		activeTab?: string;
		onTabChange?: (key: string) => void;
		children?: Snippet;
	} = $props();

	const showTopRow = $derived(!!title || back || !!actions);
</script>

<header
	class="sticky top-0 z-30 border-b border-[var(--ui-border-muted)] bg-[color-mix(in_oklab,var(--ui-bg)_75%,transparent)] backdrop-blur-xl"
>
	{#if showTopRow}
		<div class="flex items-center gap-3 p-2.5 px-4">
			{#if back}
				<button type="button" onclick={onBack} class="icon-btn size-9" aria-label="Back">
					<Icon name="i-lucide-arrow-left" class="size-4" />
				</button>
			{/if}
			<div class="min-w-0">
				{#if title}<h1 class="m-0 text-xl font-bold tracking-tight">{title}</h1>{/if}
				{#if subtitle}
					<p class="m-0 mt-0.5 text-xs text-[var(--ui-text-muted)]">{subtitle}</p>
				{/if}
			</div>
			<div class="ml-auto flex gap-2">
				{#if actions}{@render actions()}{/if}
			</div>
		</div>
	{/if}
	{#if children}
		{@render children()}
	{/if}
	{#if tabs && activeTab}
		<SegmentedTabs tabs={tabs} active={activeTab} onChange={onTabChange} />
	{/if}
</header>
