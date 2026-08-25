<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import type { MemeSfxCue } from '$lib/meme/schema';
	import { formatDuration } from '$lib/utils/format';

	let {
		cues,
		busy,
		timelineActive,
		labelFor,
		iconFor,
		onSeek,
		onPreview,
		onRemove
	}: {
		cues: MemeSfxCue[];
		busy: boolean;
		timelineActive: boolean;
		labelFor: (cue: MemeSfxCue) => string;
		iconFor: (cue: MemeSfxCue) => string;
		onSeek: (seconds: number) => void;
		onPreview: (cue: MemeSfxCue) => void;
		onRemove: (id: string) => void;
	} = $props();
</script>

{#if cues.length}
	<ul class="mt-2 flex flex-col gap-1">
		{#each cues as cue (cue.id)}
			<li
				class="flex items-center justify-between gap-2 rounded-lg bg-[var(--ui-bg)] px-2.5 py-1.5 text-[12px]"
			>
				<span class="flex items-center gap-1.5 font-semibold">
					<Icon name={iconFor(cue)} class="size-3.5 text-warm-500" />
					{labelFor(cue)}
					<button
						type="button"
						disabled={busy || !timelineActive}
						title="Jump the playhead to this cue"
						onclick={() => onSeek(cue.atMs / 1000)}
						class="rounded-full bg-[var(--ui-bg-muted)] px-1.5 py-px font-mono text-[10.5px] font-bold text-[var(--ui-text-muted)] tabular-nums transition hover:bg-warm-500/15 hover:text-warm-600 disabled:opacity-40"
					>
						@ {formatDuration(cue.atMs / 1000)}
					</button>
				</span>
				<span class="flex items-center gap-1">
					<button
						type="button"
						class="rounded-md p-1 text-[var(--ui-text-dimmed)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]"
						aria-label={`Preview ${labelFor(cue)}`}
						onclick={() => onPreview(cue)}
					>
						<Icon name="i-lucide-play" class="size-3.5" />
					</button>
					<button
						type="button"
						class="rounded-md p-1 text-[var(--ui-text-dimmed)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--tone-error-text)]"
						aria-label={`Remove ${labelFor(cue)}`}
						onclick={() => onRemove(cue.id)}
					>
						<Icon name="i-lucide-x" class="size-3.5" />
					</button>
				</span>
			</li>
		{/each}
	</ul>
{:else}
	<p
		class="mt-1.5 text-[11px] text-[var(--ui-text-dimmed)]"
		title="Cue a sound at the playhead — it gets mixed into the export. All synthesized, no licensing headaches."
	>
		No cues yet — tap “Cue @” or press 1–9.
	</p>
{/if}
