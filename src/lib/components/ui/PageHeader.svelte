<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Design-system page header (docs/ui.html). A compact, sticky, blurred
	 * title bar with optional subtitle, accent icon-action buttons, and an
	 * optional tab row — the chrome every content route shares. Place it as
	 * the first child of a page's scroll container so it sticks to the top.
	 */
	let {
		title,
		subtitle,
		actions,
		tabs,
		class: cls
	}: {
		title: string;
		subtitle?: Snippet;
		actions?: Snippet;
		tabs?: Snippet;
		class?: string;
	} = $props();
</script>

<header
	class="sticky top-0 z-30 border-b border-[var(--ui-border-muted)] bg-[color-mix(in_oklab,var(--ui-bg)_72%,transparent)] backdrop-blur-xl {cls ?? ''}"
>
	<div class="flex items-center justify-between gap-3 px-4 py-2.5">
		<div class="min-w-0">
			<h1 class="truncate text-xl leading-tight font-bold tracking-tight">{title}</h1>
			{#if subtitle}
				<div class="mt-0.5 truncate text-xs text-[var(--ui-text-muted)]">
					{@render subtitle()}
				</div>
			{/if}
		</div>
		{#if actions}
			<div class="flex shrink-0 items-center gap-2">{@render actions()}</div>
		{/if}
	</div>
	{#if tabs}
		<div class="flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
			{@render tabs()}
		</div>
	{/if}
</header>
