<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import { formatDuration } from '$lib/utils/format';

	/**
	 * MemeTrimPanel — the export-duration card. Video variant: the trim window
	 * (start/end marks + playhead buttons), length presets, speed, preview cut.
	 * GIF variant: length presets only — the GIF loops to fill the chosen
	 * length. Pure controls — the parent owns the state. (Extracted from
	 * MemeStudio — SRP split.)
	 */
	let {
		durationSec,
		trimStart = 0,
		trimEnd = null,
		trimDurationSec = 0,
		exportDurationSec = 0,
		rate = 1,
		playheadSec = 0,
		variant = 'video',
		lengthSec = null,
		busy = false,
		canPreview = false,
		onTrim = () => undefined,
		onRate = () => undefined,
		/** Set the window's LENGTH in seconds (from the current start). */
		onSetLength,
		onReset,
		onPreviewCut = () => undefined
	}: {
		durationSec: number;
		trimStart?: number;
		/** null = through the end. */
		trimEnd?: number | null;
		trimDurationSec?: number;
		exportDurationSec?: number;
		rate?: number;
		playheadSec?: number;
		/** 'video' = full trim/speed card; 'gif'/'cues' = length presets only. */
		variant?: 'video' | 'gif' | 'cues';
		/** Length variants: chosen export length (null = the source's own duration). */
		lengthSec?: number | null;
		busy?: boolean;
		canPreview?: boolean;
		/** Patch the window (either bound, end null = through the end). */
		onTrim?: (patch: { start?: number; end?: number | null }) => void;
		onRate?: (rate: number) => void;
		onSetLength: (sec: number | null) => void;
		onReset: () => void;
		onPreviewCut?: () => void;
	} = $props();

	const LENGTH_PRESETS = [3, 5, 10, 15, 30, 60];

	/** Length-only variants: 'gif' (GIF base — loops to fill) and 'cues'
	 *  (static image + sound cues — the cue track is the default duration). */
	const lengthOnly = $derived(variant === 'gif' || variant === 'cues');
	const activeLength = $derived(lengthOnly ? (lengthSec ?? durationSec) : (trimDurationSec ?? 0));
	const loops = $derived(variant === 'gif' && activeLength > durationSec + 0.05);
</script>

{#if lengthOnly}
	<div
		class="rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-border-muted)] px-3.5 py-3"
	>
		<div class="flex items-center justify-between gap-2">
			<p
				class="flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
			>
				<Icon name="i-lucide-timer" class="size-3.5" />
				Length
			</p>
			<p class="text-[11px] font-bold text-warm-600 tabular-nums">
				{formatDuration(activeLength)}
				{#if loops}· loops ×{Math.ceil(activeLength / durationSec)}{/if}
			</p>
		</div>
		<div class="mt-2 flex flex-wrap items-center gap-1.5">
			<button
				type="button"
				disabled={busy}
				onclick={() => onSetLength(null)}
				aria-pressed={lengthSec === null}
				title={variant === 'gif'
					? "Export runs the GIF's own duration"
					: 'Export runs the sound track\u2019s length'}
				class="h-7 rounded-full px-2.5 text-[11px] font-bold transition {lengthSec === null
					? 'bg-warm-500 text-white'
					: 'bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]'} disabled:opacity-40"
			>
				Full
			</button>
			{#each LENGTH_PRESETS.filter((n) => Math.abs(n - durationSec) > 0.25) as n (n)}
				<button
					type="button"
					disabled={busy}
					onclick={() => onSetLength(n)}
					aria-pressed={lengthSec === n}
					title={`Export a ${n}s video${variant === 'gif' ? ' — the GIF loops to fill it' : ''}`}
					class="h-7 rounded-full px-2.5 text-[11px] font-bold tabular-nums transition {lengthSec ===
					n
						? 'bg-warm-500 text-white'
						: 'bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]'} disabled:opacity-40"
				>
					{n}s
				</button>
			{/each}
			<label class="flex items-center gap-1 text-[10.5px] font-bold text-[var(--ui-text-dimmed)]">
				custom
				<input
					type="number"
					min="0.5"
					step="0.5"
					value={activeLength.toFixed(1)}
					disabled={busy}
					aria-label="Custom export length in seconds"
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							(e.currentTarget as HTMLInputElement).blur();
						}
					}}
					onchange={(e) => onSetLength(Number((e.currentTarget as HTMLInputElement).value))}
					class="h-7 w-16 rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-1.5 text-center font-mono text-[11px] tabular-nums outline-none focus:border-warm-500"
				/>
				s
			</label>
			<button
				type="button"
				disabled={busy}
				onclick={onReset}
				class="h-7 rounded-lg px-2.5 text-[11px] font-semibold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-40"
			>
				Reset
			</button>
		</div>
		<p class="mt-1.5 text-[10px] leading-snug text-[var(--ui-text-dimmed)]">
			{#if variant === 'gif'}
				The video runs this long — the {formatDuration(durationSec)} GIF
				{loops ? 'loops to fill it' : 'trims to fit'}. Sound cues fire on the export clock.
			{:else}
				The video runs this long — the sound track lasts {formatDuration(durationSec)}; shorter
				drops late cues, longer adds a silent tail.
			{/if}
		</p>
	</div>
{:else}
	<div
		class="rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-border-muted)] px-3.5 py-3"
	>
		<div class="flex items-center justify-between gap-2">
			<p
				class="flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
			>
				<Icon name="i-lucide-scissors" class="size-3.5" />
				Trim &amp; speed
			</p>
			<p class="text-[11px] font-bold text-warm-600 tabular-nums">
				{formatDuration(trimDurationSec)} @ {rate}× → {formatDuration(exportDurationSec)}
			</p>
		</div>
		<div class="mt-2 flex flex-wrap items-center gap-1.5">
			<input
				type="number"
				min="0"
				max={durationSec}
				step="0.1"
				value={trimStart.toFixed(1)}
				oninput={(e) => {
					const v = Number((e.currentTarget as HTMLInputElement).value);
					onTrim({
						start: Number.isFinite(v) ? Math.min(Math.max(0, v), durationSec) : 0
					});
				}}
				disabled={busy}
				aria-label="Trim start seconds"
				class="h-8 w-20 rounded-lg border border-[var(--ui-border-muted)] bg-transparent px-2 text-[11.5px] tabular-nums outline-none focus:border-warm-500"
			/>
			<input
				type="number"
				min="0"
				max={durationSec}
				step="0.1"
				value={(trimEnd ?? durationSec).toFixed(1)}
				oninput={(e) => {
					const raw = (e.currentTarget as HTMLInputElement).value;
					const v = Number(raw);
					onTrim({
						end: raw !== '' && Number.isFinite(v) && v > 0 ? Math.min(v, durationSec) : null
					});
				}}
				disabled={busy}
				aria-label="Trim end seconds"
				class="h-8 w-20 rounded-lg border border-[var(--ui-border-muted)] bg-transparent px-2 text-[11.5px] tabular-nums outline-none focus:border-warm-500"
			/>
			<button
				type="button"
				disabled={busy}
				onclick={() =>
					onTrim({ start: Math.max(0, Math.min(playheadSec, (trimEnd ?? durationSec) - 0.1)) })}
				title="Set the start mark at the playhead"
				class="h-8 rounded-lg bg-[var(--ui-bg-accented)] px-2.5 text-[11px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-40"
			>
				Start = playhead
			</button>
			<button
				type="button"
				disabled={busy}
				onclick={() => onTrim({ end: Math.max(playheadSec, trimStart + 0.1) })}
				title="Set the end mark at the playhead"
				class="h-8 rounded-lg bg-[var(--ui-bg-accented)] px-2.5 text-[11px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-40"
			>
				End = playhead
			</button>
			<select
				value={rate}
				disabled={busy}
				aria-label="Playback speed"
				onchange={(e) => onRate(Number((e.currentTarget as HTMLSelectElement).value))}
				class="h-8 rounded-lg border border-[var(--ui-border-muted)] bg-transparent px-2 text-[11.5px] font-bold outline-none focus:border-warm-500"
			>
				{#each [0.5, 0.75, 1, 1.25, 1.5, 2] as r (r)}
					<option value={r}>{r}×</option>
				{/each}
			</select>
			<button
				type="button"
				disabled={busy}
				onclick={onReset}
				class="h-8 rounded-lg px-2.5 text-[11px] font-semibold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-40"
			>
				Reset
			</button>
			{#if canPreview}
				<button
					type="button"
					disabled={busy}
					onclick={onPreviewCut}
					title="Preview the trimmed window at speed"
					class="h-8 rounded-lg bg-warm-500/10 px-2.5 text-[11px] font-bold text-warm-600 transition hover:bg-warm-500/20 disabled:opacity-40"
				>
					<Icon name="i-lucide-play" class="mr-1 inline size-3" />
					Preview cut
				</button>
			{/if}
		</div>
		<!-- Length presets: set the window's length from the current start mark;
	     the parent caps at the source's remaining time and the video limit. -->
		<div class="mt-2 flex flex-wrap items-center gap-1.5">
			<span class="text-[10.5px] font-bold text-[var(--ui-text-dimmed)]">Length</span>
			{#each LENGTH_PRESETS as n (n)}
				<button
					type="button"
					disabled={busy}
					onclick={() => onSetLength(n)}
					aria-pressed={Math.abs(trimDurationSec - n) < 0.05}
					title={`Make the export window ${n}s long from the start mark`}
					class="h-7 rounded-full px-2.5 text-[11px] font-bold tabular-nums transition {Math.abs(
						trimDurationSec - n
					) < 0.05
						? 'bg-warm-500 text-white'
						: 'bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]'} disabled:opacity-40"
				>
					{n}s
				</button>
			{/each}
			<label class="flex items-center gap-1 text-[10.5px] font-bold text-[var(--ui-text-dimmed)]">
				custom
				<input
					type="number"
					min="0.5"
					step="0.5"
					value={trimDurationSec.toFixed(1)}
					disabled={busy}
					aria-label="Custom window length in seconds"
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							(e.currentTarget as HTMLInputElement).blur();
						}
					}}
					onchange={(e) => onSetLength(Number((e.currentTarget as HTMLInputElement).value))}
					class="h-7 w-16 rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-1.5 text-center font-mono text-[11px] tabular-nums outline-none focus:border-warm-500"
				/>
				s
			</label>
			<span class="ml-auto text-[10px] font-semibold text-[var(--ui-text-dimmed)] tabular-nums">
				source {formatDuration(durationSec)}
			</span>
		</div>
	</div>
{/if}
