<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import {
		FRAME_FX_LABELS,
		FRAME_FX_IDS,
		MAX_FX_WINDOWS,
		type FrameFxId,
		type FrameFxWindow
	} from '$lib/meme/fx-track';

	/**
	 * MemeFxPicker — timed frame-FX windows (Meme Pack V1 Layer 2). Tap an
	 * effect to start a window at the playhead; rows list the track with
	 * per-window delete + strength. Pure controls: the parent owns the
	 * `windows` state via onAdd/onRemove/onIntensity, exactly like the look
	 * picker owns nothing but `onPick`.
	 */
	let {
		id,
		windows,
		stageSeconds,
		timelineActive,
		durationSec,
		busy = false,
		onAdd,
		onRemove,
		onIntensity
	}: {
		id: string;
		windows: FrameFxWindow[];
		/** Current playhead in seconds (window start when adding). */
		stageSeconds: number;
		/** Expert timeline on — windows without it would never show. */
		timelineActive: boolean;
		/** Clip/export duration in seconds (window end default). */
		durationSec: number;
		busy?: boolean;
		onAdd: (fx: FrameFxId, atMs: number) => void;
		onRemove: (index: number) => void;
		onIntensity: (index: number, intensity: number) => void;
	} = $props();

	function fmt(ms: number): string {
		return `${(ms / 1000).toFixed(1)}s`;
	}
</script>

<Popover
	{id}
	float
	placement="top-start"
	width="auto"
	label="Frame FX"
	triggerClass="flex items-center gap-1 rounded-full bg-[var(--ui-bg-accented)] px-2.5 py-1 text-[11.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]"
	triggerActiveClass="bg-warm-500/15 text-warm-600"
>
	{#snippet trigger()}
		<Icon name="i-lucide-wand-sparkles" class="size-3.5" />
		FX
		{#if windows.length}
			<span class="rounded-full bg-warm-500/20 px-1.5 text-[10px] font-extrabold text-warm-600">
				{windows.length}
			</span>
		{/if}
	{/snippet}
	<div class="w-64 max-w-[80vw] p-2">
		<p
			class="px-1 pb-1.5 text-[10px] font-bold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
		>
			{timelineActive
				? 'Tap an effect — starts at the playhead'
				: 'Turn on the timeline first (fx are timed)'}
		</p>
		<div class="flex flex-wrap gap-1">
			{#each FRAME_FX_IDS as fx (fx)}
				<button
					type="button"
					disabled={busy || !timelineActive || windows.length >= MAX_FX_WINDOWS}
					onclick={() => onAdd(fx, Math.round(stageSeconds * 1000))}
					class="rounded-full bg-[var(--ui-bg-accented)] px-2.5 py-1 text-[11.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-warm-500/15 hover:text-warm-600 disabled:opacity-30"
					title={FRAME_FX_LABELS[fx]}
				>
					{FRAME_FX_LABELS[fx]}
				</button>
			{/each}
		</div>
		{#if windows.length}
			<div class="mt-2 flex max-h-44 flex-col gap-1 overflow-y-auto">
				{#each windows as win, i (i)}
					<div class="flex items-center gap-1.5 rounded-lg bg-[var(--ui-bg-accented)] px-2 py-1">
						<span class="flex-1 truncate text-[11px] font-bold text-[var(--ui-text)]">
							{FRAME_FX_LABELS[win.fx]}
							<span class="font-mono text-[10px] text-[var(--ui-text-dimmed)]">
								{fmt(win.startMs)}–{fmt(win.endMs)}
							</span>
						</span>
						<input
							type="range"
							min="0.1"
							max="1"
							step="0.1"
							value={win.intensity}
							aria-label={`${FRAME_FX_LABELS[win.fx]} intensity`}
							oninput={(e) => onIntensity(i, Number((e.currentTarget as HTMLInputElement).value))}
							class="h-1 w-16 accent-warm-500"
						/>
						<button
							type="button"
							onclick={() => onRemove(i)}
							aria-label={`Remove ${FRAME_FX_LABELS[win.fx]}`}
							class="grid size-5 place-items-center rounded-full text-[var(--ui-text-dimmed)] transition hover:bg-red-500/10 hover:text-red-500"
						>
							<Icon name="i-lucide-x" class="size-3" />
						</button>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</Popover>
