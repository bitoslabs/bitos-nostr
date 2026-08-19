<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { cn } from '$lib/utils/cn';

	/**
	 * Settings/form panel built on the `.surface-card` primitive (opaque fill +
	 * soft shadow). Renders an optional header (icon + title + description +
	 * trailing actions snippet) above the body. Omit `title` for a raw card
	 * (custom hero content, banner breakouts). `bodyClass` swaps or removes
	 * body padding — pass `''` for full-bleed content.
	 */
	let {
		title,
		description,
		icon,
		actions,
		class: cls,
		bodyClass = 'p-5',
		children
	}: {
		title?: string;
		description?: string;
		icon?: string;
		actions?: Snippet;
		class?: string;
		bodyClass?: string;
		children: Snippet;
	} = $props();
</script>

<section
	class={cn(
		'overflow-hidden rounded-[var(--ui-radius)] border border-[var(--ui-border-muted)]',
		cls
	)}
>
	{#if title}
		<header class="flex items-center gap-2.5 px-5 pt-6">
			{#if icon}
				<!-- Title icon in the system hex tile (same language as the mobile
		     index / more tiles). -->
				<span
					class="hex-clip grid size-[26px] shrink-0 place-items-center bg-primary-500/10 text-primary-500"
				>
					<Icon name={icon} class="size-[14px]" />
				</span>
			{/if}
			<div class="min-w-0 flex-1">
				<h3 class="text-[15px] leading-tight font-bold text-[var(--ui-text)]">{title}</h3>
				{#if description}
					<p class="mt-0.5 text-[12px] leading-snug text-[var(--ui-text-muted)]">{description}</p>
				{/if}
			</div>
			{#if actions}
				<div class="ml-auto flex shrink-0 items-center gap-2">
					{@render actions()}
				</div>
			{/if}
		</header>
	{/if}
	<div class={bodyClass}>
		{@render children()}
	</div>
</section>
