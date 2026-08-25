<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import VideoFrameStrip from '$lib/components/bitz/VideoFrameStrip.svelte';

	let {
		collapsed = $bindable(false),
		active,
		showFrames,
		durationSec,
		thumbUrls,
		playheadSec,
		trimStartSec,
		trimEndSec,
		posterSec,
		posterUrl,
		busy,
		onScrub,
		onPickPoster,
		timeline
	}: {
		collapsed?: boolean;
		active: boolean;
		showFrames: boolean;
		durationSec: number;
		thumbUrls: string[];
		playheadSec: number;
		trimStartSec: number;
		trimEndSec: number | null;
		posterSec: number | null;
		posterUrl: string | null;
		busy: boolean;
		onScrub: (seconds: number) => void;
		onPickPoster: (seconds: number) => void;
		timeline: Snippet;
	} = $props();
</script>

<div
	class="relative shrink-0 border-t border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)]/40 px-3 py-2 sm:px-4"
>
	<button
		type="button"
		onclick={() => (collapsed = !collapsed)}
		aria-expanded={!collapsed}
		aria-label={collapsed ? 'Show timeline' : 'Hide timeline'}
		title={collapsed ? 'Show the timeline' : 'Hide the timeline — more stage'}
		class="absolute top-1.5 right-2 z-10 grid size-6 place-items-center rounded-full text-[var(--ui-text-dimmed)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]"
	>
		<Icon name={collapsed ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'} class="size-4" />
	</button>
	{#if collapsed}
		<p class="py-1 text-center text-[10.5px] font-semibold text-[var(--ui-text-dimmed)]">
			Timeline hidden — Space still plays · {active
				? 'chevron to reopen'
				: 'add a sound cue to unlock it'}
		</p>
	{:else}
		{#if showFrames}
			<VideoFrameStrip
				{durationSec}
				{thumbUrls}
				{playheadSec}
				{trimStartSec}
				{trimEndSec}
				{posterSec}
				{posterUrl}
				{busy}
				{onScrub}
				{onPickPoster}
			/>
		{/if}
		{#if active}
			{@render timeline()}
		{:else}
			<p class="py-1.5 text-center text-[10.5px] font-semibold text-[var(--ui-text-dimmed)]">
				Static meme — add a sound cue to unlock the timeline
			</p>
		{/if}
		<p
			class="mt-1.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[9.5px] font-semibold text-[var(--ui-text-dimmed)]"
		>
			<span class="flex items-center gap-1"><kbd>Space</kbd> play / pause</span>
			<span class="flex items-center gap-1"><kbd>←</kbd><kbd>→</kbd> nudge playhead</span>
			<span class="flex items-center gap-1"><kbd>1</kbd>–<kbd>9</kbd> cue a sound</span>
			<span class="flex items-center gap-1"><kbd>Ctrl ↵</kbd> publish</span>
			<span class="flex items-center gap-1"><kbd>M</kbd> preview sound</span>
		</p>
	{/if}
</div>

<style>
	kbd {
		border: 1px solid var(--ui-border-muted);
		border-radius: 0.25rem;
		background: var(--ui-bg);
		padding: 1px 0.25rem;
		font-family: monospace;
		font-size: 9px;
		font-weight: 700;
		color: var(--ui-text-muted);
	}
</style>
