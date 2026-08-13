<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils/cn';

	/**
	 * Compact stat tile: a small label, a large mono value, and an optional
	 * unit / caption. Tone drives the value color (accent | success | warm |
	 * info | default).
	 */
	type Tone = 'default' | 'accent' | 'success' | 'warm' | 'info';

	const toneClass: Record<Tone, string> = {
		default: 'text-[var(--ui-text)]',
		accent: 'text-[var(--ui-color-primary-500)]',
		success: 'text-[var(--tone-success-text)]',
		warm: 'text-[var(--tone-warning-text)]',
		info: 'text-[var(--tone-info-text)]'
	};

	let {
		label,
		value,
		unit,
		caption,
		tone = 'default',
		center = false,
		class: cls,
		children
	}: {
		label: string;
		value: string | number;
		unit?: string;
		caption?: string;
		tone?: Tone;
		center?: boolean;
		class?: string;
		children?: Snippet;
	} = $props();
</script>

<div
	class={cn(
		'premium-card p-3.5',
		center && 'text-center',
		cls
	)}
>
	<div class="text-[11px] font-semibold tracking-wider text-[var(--ui-text-muted)] uppercase">
		{label}
	</div>
	<div class="mt-1 flex items-baseline gap-1">
		<span class={cn('font-mono text-lg font-semibold', toneClass[tone])}>{value}</span>
		{#if unit}
			<span class="text-sm text-[var(--ui-text-muted)]">{unit}</span>
		{/if}
	</div>
	{#if caption}
		<div class="mt-0.5 text-[10px] text-[var(--ui-text-muted)]">{caption}</div>
	{/if}
	{#if children}
		{@render children()}
	{/if}
</div>
