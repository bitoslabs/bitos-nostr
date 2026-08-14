<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { cn } from '$lib/utils/cn';

	/**
	 * System-settings row: `label` (+ optional `hint`, `icon`) on the left with
	 * the `control` snippet on the right (toggle, select, pill…). When default
	 * `children` are passed the row stacks — the header line on top and
	 * full-width content below (swatch grids, preview tiles, buttons).
	 */
	let {
		label,
		hint,
		icon,
		tint = 'text-primary-500',
		control,
		class: cls,
		children
	}: {
		label?: string;
		hint?: string;
		icon?: string;
		tint?: string;
		control?: Snippet;
		class?: string;
		children?: Snippet;
	} = $props();
</script>

<div class={cls}>
	<div class="flex min-h-[52px] items-center gap-3 px-4 py-2.5">
		{#if icon}
			<Icon name={icon} class={cn('size-[18px] shrink-0', tint)} />
		{/if}
		<div class="min-w-0 flex-1">
			{#if label}
				<p class="text-[14px] leading-snug font-semibold text-[var(--ui-text)]">{label}</p>
			{/if}
			{#if hint}
				<p class="mt-0.5 text-[12px] leading-snug text-[var(--ui-text-muted)]">{hint}</p>
			{/if}
		</div>
		{#if control}
			<div class="ml-auto flex shrink-0 items-center gap-2">
				{@render control()}
			</div>
		{/if}
	</div>
	{#if children}
		<div class="px-4 pb-4 {icon ? 'pl-[30px]' : ''}">
			{@render children()}
		</div>
	{/if}
</div>
