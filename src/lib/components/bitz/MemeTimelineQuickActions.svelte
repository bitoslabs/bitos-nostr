<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import { formatDuration } from '$lib/utils/format';

	let {
		busy,
		mediaKind,
		timelineActive,
		stageSeconds,
		selectedOverlayId,
		selectedLayerId,
		includeSourceAudio = $bindable(true),
		sourceAudioGain = $bindable(1),
		expertTimeline,
		hasSelectedClip,
		canDeleteClip,
		onOtherSource,
		onEnableExpert,
		onSplitVideo,
		onDeleteClip,
		onCutVideo,
		onSplitSelected,
		onAddCaption,
		onAddSound,
		onAutoMeme,
		autoMemeReady = false,
		analyzing = false
	}: {
		busy: boolean;
		mediaKind: 'image' | 'video' | null;
		timelineActive: boolean;
		stageSeconds: number;
		selectedOverlayId: string | null;
		selectedLayerId: string | null;
		includeSourceAudio: boolean;
		sourceAudioGain: number;
		expertTimeline: boolean;
		hasSelectedClip: boolean;
		canDeleteClip: boolean;
		onOtherSource: () => void;
		onEnableExpert: () => void;
		onSplitVideo: () => void;
		onDeleteClip: () => void;
		onCutVideo: (side: 'before' | 'after') => void;
		onSplitSelected: () => void;
		onAddCaption: () => void;
		onAddSound: () => void;
		/** Build (if needed) + surface the suggestion ladder — the one-tap
		 *  Auto Meme entry (`analyzing` drives its spinner). */
		onAutoMeme: () => void;
		autoMemeReady?: boolean;
		analyzing?: boolean;
	} = $props();
</script>

<div class="mt-1.5 flex flex-wrap items-center gap-1.5">
	<button
		type="button"
		onclick={onOtherSource}
		disabled={busy}
		title="Choose another image, GIF, or video while keeping this edit"
		class="flex items-center gap-1 rounded-full bg-sky-500/10 px-2.5 py-1 text-[10.5px] font-bold text-sky-600 transition hover:bg-sky-500/20 disabled:opacity-40"
		><Icon name="i-lucide-clapperboard" class="size-3.5" /> Other source</button
	>
	{#if mediaKind === 'video'}
		<div
			class="flex items-center gap-1 rounded-full bg-[var(--ui-bg-accented)] px-2 py-1 text-[10.5px] font-bold text-[var(--ui-text-muted)]"
			title="Source-video volume in preview and export"
		>
			<Icon
				name={includeSourceAudio ? 'i-lucide-volume-2' : 'i-lucide-volume-x'}
				class="size-3.5"
			/>
			<input
				aria-label="Source video volume"
				type="range"
				min="0"
				max="1"
				step="0.05"
				bind:value={sourceAudioGain}
				disabled={!includeSourceAudio || busy}
				class="h-1 w-14 accent-[var(--color-warm-500)]"
			/>
			<button
				type="button"
				onclick={() => (includeSourceAudio = !includeSourceAudio)}
				class="font-mono text-[9px] hover:text-[var(--ui-text)]"
				>{Math.round(sourceAudioGain * 100)}%</button
			>
		</div>
		<button
			type="button"
			onclick={onEnableExpert}
			disabled={busy || expertTimeline}
			title="Enable multi-clip video editing"
			class="flex items-center gap-1 rounded-full bg-violet-500/10 px-2.5 py-1 text-[10.5px] font-bold text-violet-600 transition hover:bg-violet-500/20 disabled:opacity-40"
			><Icon name="i-lucide-list-tree" class="size-3.5" />
			{expertTimeline ? 'Expert timeline' : 'Expert'}</button
		>
		{#if expertTimeline}
			<button
				type="button"
				onclick={onSplitVideo}
				disabled={busy}
				class="flex items-center gap-1 rounded-full bg-violet-500/10 px-2.5 py-1 text-[10.5px] font-bold text-violet-600 transition hover:bg-violet-500/20 disabled:opacity-40"
				><Icon name="i-lucide-scissors" class="size-3.5" /> Split video</button
			>
			<button
				type="button"
				onclick={onDeleteClip}
				disabled={busy || !hasSelectedClip || !canDeleteClip}
				class="flex items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-1 text-[10.5px] font-bold text-red-600 transition hover:bg-red-500/20 disabled:opacity-40"
				><Icon name="i-lucide-trash-2" class="size-3.5" /> Delete clip</button
			>
		{/if}
		<button
			type="button"
			onclick={() => onCutVideo('before')}
			disabled={busy}
			title="Cut at the playhead and keep the part before it"
			class="flex items-center gap-1 rounded-full bg-sky-500/10 px-2.5 py-1 text-[10.5px] font-bold text-sky-600 transition hover:bg-sky-500/20 disabled:opacity-40"
			><Icon name="i-lucide-scissors" class="size-3.5" /> Cut before</button
		>
		<button
			type="button"
			onclick={() => onCutVideo('after')}
			disabled={busy}
			title="Cut at the playhead and keep the part after it"
			class="flex items-center gap-1 rounded-full bg-sky-500/10 px-2.5 py-1 text-[10.5px] font-bold text-sky-600 transition hover:bg-sky-500/20 disabled:opacity-40"
			><Icon name="i-lucide-scissors" class="size-3.5" /> Cut after</button
		>
	{/if}
	<button
		type="button"
		onclick={onSplitSelected}
		disabled={busy || !timelineActive || (!selectedOverlayId && !selectedLayerId)}
		title="Split the selected caption or image layer at the playhead"
		class="flex items-center gap-1 rounded-full bg-primary-500/10 px-2.5 py-1 text-[10.5px] font-bold text-primary-600 transition hover:bg-primary-500/20 disabled:opacity-40"
		><Icon name="i-lucide-split" class="size-3.5" /> Split selected</button
	>
	<button
		type="button"
		onclick={onAutoMeme}
		disabled={busy || !mediaKind || analyzing}
		title="Generate 3 editable timelines — captions, cues and punch-in zooms from your audio, analyzed on-device"
		class="flex items-center gap-1 rounded-full bg-gradient-to-r from-primary-500/15 to-warm-500/15 px-3 py-1 text-[10.5px] font-bold text-primary-600 transition hover:from-primary-500/25 hover:to-warm-500/25 disabled:opacity-40"
		><Icon
			name={analyzing ? 'i-lucide-loader-circle' : 'i-lucide-wand-sparkles'}
			class="size-3.5 {analyzing ? 'animate-spin' : ''}"
		/>
		{#if analyzing}Analyzing…{:else if autoMemeReady}Auto Meme ✓{:else}Auto Meme{/if}</button
	>
	<button
		type="button"
		onclick={onAddCaption}
		disabled={busy}
		title="Add a caption with a 2s window starting at the playhead"
		class="flex items-center gap-1 rounded-full bg-primary-500/10 px-2.5 py-1 text-[10.5px] font-bold text-primary-600 transition hover:bg-primary-500/20 disabled:opacity-40"
		><Icon name="i-lucide-captions-plus" class="size-3.5" /> Caption @ {formatDuration(
			stageSeconds
		)}</button
	>
	<button
		type="button"
		onclick={onAddSound}
		disabled={busy || !mediaKind}
		title="Add a sound cue at the playhead"
		class="flex items-center gap-1 rounded-full bg-warm-500/10 px-2.5 py-1 text-[10.5px] font-bold text-warm-600 transition hover:bg-warm-500/20 disabled:opacity-40"
		><Icon name="i-lucide-music-plus" class="size-3.5" /> Sound @ {formatDuration(
			stageSeconds
		)}</button
	>
</div>
