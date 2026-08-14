<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils/cn';

	/**
	 * Right-rail widget container. Renders a header (title + optional trailing
	 * snippet such as a "Live" pill or count) and a body. Pure chrome — content
	 * is provided by the caller via the body/action snippets.
	 */
	let {
		title,
		class: cls,
		actions,
		children
	}: {
		title: string;
		class?: string;
		actions?: Snippet;
		children: Snippet;
	} = $props();
</script>

<section class={cn('border border-[var(--ui-border-muted)] rounded-[var(--ui-radius)]', cls)}>
	<header class="premium-widget-header">
		<h2 class="text-[var(--ui-text)]">{title}</h2>
		{#if actions}
			{@render actions()}
		{/if}
	</header>
	{@render children()}
</section>
