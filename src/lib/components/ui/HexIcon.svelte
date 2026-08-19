<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { cn } from '$lib/utils/cn';

	/**
	 * Hexagon icon tile — the BitOS design-language pattern used across the
	 * premium shell (/more tiles, meta rows): a flat-top hexagon with a 2px
	 * gradient border ring and an inner surface carrying the icon. Pass
	 * `icon` for a plain icon, or a `children` snippet to host richer
	 * content (e.g. the HexMark brand symbol in the About hero).
	 *
	 * `interactive` intensifies the ring gradient on `.group:hover` — add
	 * `group` to the interactive ancestor, exactly like the /more tiles.
	 */
	let {
		icon,
		children,
		size = 40,
		iconClass = 'size-5',
		tone = 'gradient',
		interactive = false,
		class: cls
	}: {
		icon?: string;
		children?: Snippet;
		size?: number | string;
		iconClass?: string;
		tone?: 'gradient' | 'warm';
		interactive?: boolean;
		class?: string;
	} = $props();

	const tones = {
		gradient: 'border-primary-500/25 from-primary-500/20 to-warm-500/15 text-primary-500',
		warm: 'border-warm-500/30 from-warm-500/25 to-warm-500/10 text-warm-600'
	} as const;
	const hovers = {
		gradient: 'group-hover:from-primary-500/30 group-hover:to-warm-500/20',
		warm: 'group-hover:from-warm-500/35 group-hover:to-warm-500/15'
	} as const;
</script>

<span
	class={cn(
		'hex-clip box-border grid shrink-0 place-items-center overflow-hidden border bg-gradient-to-br p-[2px]',
		tones[tone],
		interactive && 'transition',
		interactive && hovers[tone],
		cls
	)}
	style="width:{size}px;height:{size}px"
>
	<span class="hex-clip grid size-full place-items-center overflow-hidden bg-[var(--surface-bg)]">
		{#if children}
			{@render children?.()}
		{:else if icon}
			<Icon name={icon} class={iconClass} />
		{/if}
	</span>
</span>
