<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils/cn';

	let {
		class: cls,
		tone = 'neutral',
		children
	}: {
		class?: string;
		tone?: 'neutral' | 'primary' | 'success' | 'info' | 'warning' | 'error';
		children?: Snippet;
	} = $props();

	const toneClass: Record<string, string> = {
		neutral: 'tone-neutral',
		primary: 'is-active-badge',
		success: 'tone-success',
		info: 'tone-info',
		warning: 'tone-warning',
		error: 'tone-error'
	};
</script>

<span
	class={cn(
		'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums',
		toneClass[tone],
		cls
	)}
>
	{@render children?.()}
</span>
