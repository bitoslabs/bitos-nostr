<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import { MAX_SPEED_WINDOWS, MIN_RATE, MAX_RATE, type SpeedWindow } from '$lib/meme/speed-track';

	/** Rate chips: 0.5× slow-mo through 2× speed-up (browser-safe span). */
	const RATES = [0.5, 0.75, 1.25, 1.5, 2] as const;

	/**
	 * MemeSpeedPicker — timed speed-ramp windows (Meme Pack V1 Layer 2:
	 * Slow Motion / Speed Up). Tap a rate to start a window at the playhead;
	 * rows list the track with per-window rate re-pick + delete. Pure
	 * controls: the parent owns `windows` via onAdd/onRate/onRemove, exactly
	 * like the FX picker.
	 */
	let {
		id,
		windows,
		stageSeconds,
		timelineActive,
		durationSec,
		busy = false,
		onAdd,
		onRate,
		onRemove
	}: {
		id: string;
		windows: SpeedWindow[];
		/** Current playhead in seconds (window start when adding). */
		stageSeconds: number;
		/** Expert timeline on — windows without it would never show. */
		timelineActive: boolean;
		/** Clip/export duration in seconds (window end default). */
		durationSec: number;
		busy?: boolean;
		onAdd: (rate: number, atMs: number) => void;
		onRate: (index: number, rate: number) => void;
		onRemove: (index: number) => void;
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
	label="Speed ramps"
	triggerClass="flex items-center gap-1 rounded-full bg-[var(--ui-bg-accented)] px-2.5 py-1 text-[11.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]"
	triggerActiveClass="bg-warm-500/15 text-warm-600"
>
	{#snippet trigger()}
		<Icon name="i-lucide-gauge" class="size-3.5" />
		Speed
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
				? 'Tap a rate — starts at the playhead'
				: 'Turn on the timeline first (ramps are timed)'}
		</p>
		<div class="flex flex-wrap gap-1">
			{#each RATES as r (r)}
				<button
					type="button"
					disabled={busy || !timelineActive || windows.length >= MAX_SPEED_WINDOWS}
					onclick={() => onAdd(r, Math.round(stageSeconds * 1000))}
					class="rounded-full bg-[var(--ui-bg-accented)] px-2.5 py-1 font-mono text-[11.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-warm-500/15 hover:text-warm-600 disabled:opacity-30"
					title={r < 1 ? `Slow-mo ${r}×` : `Speed-up ${r}×`}
				>
					{r}×
				</button>
			{/each}
		</div>
		{#if windows.length}
			<div class="mt-2 flex max-h-44 flex-col gap-1 overflow-y-auto">
				{#each windows as win, i (i)}
					<div class="flex items-center gap-1.5 rounded-lg bg-[var(--ui-bg-accented)] px-2 py-1">
						<span class="flex-1 truncate text-[11px] font-bold text-[var(--ui-text)]">
							<span class="font-mono {win.rate < 1 ? 'text-sky-500' : 'text-warm-600'}">
								{win.rate}×
							</span>
							<span class="font-mono text-[10px] text-[var(--ui-text-dimmed)]">
								{fmt(win.startMs)}–{fmt(win.endMs)}
							</span>
						</span>
						{#each RATES as r (r)}
							<button
								type="button"
								aria-label={`Set ${r}×`}
								onclick={() => onRate(i, r)}
								class="grid size-5 place-items-center rounded-full font-mono text-[9.5px] font-bold transition {win.rate ===
								r
									? 'bg-warm-500 text-white'
									: 'bg-[var(--ui-bg-muted)] text-[var(--ui-text-dimmed)] hover:text-warm-600'}"
							>
								{r}
							</button>
						{/each}
						<button
							type="button"
							onclick={() => onRemove(i)}
							aria-label="Remove speed window"
							class="grid size-5 place-items-center rounded-full text-[var(--ui-text-dimmed)] transition hover:bg-red-500/10 hover:text-red-500"
						>
							<Icon name="i-lucide-x" class="size-3" />
						</button>
					</div>
				{/each}
			</div>
		{/if}
		<p class="px-1 pt-1.5 text-[10px] leading-snug text-[var(--ui-text-dimmed)]">
			Ramps ride on top of the base speed — rates clamp to {MIN_RATE}×–{MAX_RATE}×.
		</p>
	</div>
</Popover>
