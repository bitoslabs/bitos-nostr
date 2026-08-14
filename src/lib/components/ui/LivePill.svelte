<script lang="ts" module>
	import { cn } from '$lib/utils/cn';

	export type LiveTone = 'success' | 'accent' | 'warm';
	const toneText: Record<LiveTone, string> = {
		success: 'var(--tone-success-text)',
		accent: 'var(--ui-color-primary-500)',
		warm: 'var(--tone-warning-text)'
	};
	export const liveToneText = toneText;
</script>

<script lang="ts">
	/**
	 * Small "Live" / status pill with a pulsing dot. `tone` picks the dot +
	 * text color; pass any short label.
	 */
	let {
		label = 'Live',
		tone = 'success',
		icon = false,
		class: cls
	}: { label?: string; tone?: LiveTone; icon?: boolean; class?: string } = $props();

	const color = $derived(liveToneText[tone]);
</script>

<span
	class={cn(
		'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 font-mono text-[11px] font-semibold tracking-wider uppercase',
		cls
	)}
	style="color:{color};background:color-mix(in oklab,{color} 12%,transparent);border-color:color-mix(in oklab,{color} 22%,transparent);"
>
	<span
		class="relay-pulse inline-block size-1.5 rounded-full"
		style="background:{color};box-shadow:0 0 8px color-mix(in oklab,{color} 60%,transparent);"
		aria-hidden="true"></span>
	{#if icon}<span aria-hidden="true">⚡</span>{/if}
	{label}
</span>
