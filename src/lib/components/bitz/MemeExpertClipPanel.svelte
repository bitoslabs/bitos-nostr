<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import { clipsDuration, type VideoClip } from '$lib/meme/video-clips';
	import { formatDuration } from '$lib/utils/format';

	let {
		clips,
		selectedId = $bindable(null),
		onSelect,
		onMove
	}: {
		clips: VideoClip[];
		selectedId: string | null;
		onSelect: (clip: VideoClip, index: number) => void;
		onMove: (direction: -1 | 1) => void;
	} = $props();
</script>

<div class="mt-2 rounded-lg border border-violet-500/20 bg-violet-500/5 p-2">
	<div class="mb-1 flex items-center justify-between gap-2">
		<p class="text-[10px] font-bold tracking-wider text-violet-700 uppercase">Expert clips</p>
		<span class="text-[10px] text-[var(--ui-text-dimmed)]">
			{clips.length} clips · {formatDuration(clipsDuration(clips))}
		</span>
	</div>
	<div class="flex flex-wrap gap-1">
		{#each clips as clip, index (clip.id)}
			<button
				type="button"
				onclick={() => onSelect(clip, index)}
				class="rounded-md border px-2 py-1 text-left text-[10px] font-bold transition {selectedId ===
				clip.id
					? 'border-violet-500 bg-violet-500 text-white'
					: 'border-violet-500/20 bg-[var(--ui-bg)] text-[var(--ui-text-muted)] hover:border-violet-500/50'}"
				title="Select clip {index + 1}"
			>
				{index + 1} · {clip.startSec.toFixed(1)}–{clip.endSec.toFixed(1)}s
			</button>
		{/each}
	</div>
	{#if selectedId}
		<div class="mt-1.5 flex gap-1">
			<button
				type="button"
				onclick={() => onMove(-1)}
				class="rounded px-2 py-1 text-[10px] font-bold text-violet-700 hover:bg-violet-500/10"
			>
				<Icon name="i-lucide-arrow-left" class="mr-0.5 inline size-3" />Earlier
			</button>
			<button
				type="button"
				onclick={() => onMove(1)}
				class="rounded px-2 py-1 text-[10px] font-bold text-violet-700 hover:bg-violet-500/10"
			>
				Later<Icon name="i-lucide-arrow-right" class="ml-0.5 inline size-3" />
			</button>
		</div>
	{/if}
</div>
