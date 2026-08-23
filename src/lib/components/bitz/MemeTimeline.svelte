<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import type { MemeTextOverlay } from '$lib/meme/schema';
	import type { MemeSfxCue } from '$lib/meme/schema';
	import type { MemeImageOverlay } from '$lib/meme/image-overlay';

	/**
	 * MemeTimeline — the studio's scrub surface: a playhead over per-layer
	 * rows (captions, image layers, SFX cues) on the media clock. Pure
	 * UI — the parent owns the clock (playing state + seconds in/out) so the
	 * component stays byte-cheap and the stage stays the single source of
	 * truth. Reading is open to everyone; dragging emits `onscrub`.
	 */

	let {
		durationSec,
		seconds,
		playing,
		overlays = [],
		layers = [],
		cues = [],
		busy = false,
		soundOn = false,
		onToggleSound,
		onPlayPause,
		onScrub
	}: {
		durationSec: number;
		/** Playhead position (media seconds). */
		seconds: number;
		playing: boolean;
		overlays?: MemeTextOverlay[];
		layers?: MemeImageOverlay[];
		cues?: MemeSfxCue[];
		busy?: boolean;
		/** Preview sound (source audio + live cue firing) — parent owns the audio. */
		soundOn?: boolean;
		onToggleSound?: () => void;
		onPlayPause: () => void;
		onScrub: (sec: number) => void;
	} = $props();

	const ROW_HEIGHT = 18;
	const duration = $derived(Math.max(durationSec, 0.001));
	const pct = (sec: number) => Math.min(100, Math.max(0, (sec / duration) * 100));

	function spanLeft(item: { startMs?: number }) {
		return pct((item.startMs ?? 0) / 1000);
	}
	function spanWidth(item: { startMs?: number; endMs?: number; duration?: number }) {
		const startSec = (item.startMs ?? 0) / 1000;
		const endSec =
			item.endMs !== undefined
				? item.endMs / 1000
				: item.duration !== undefined
					? startSec + item.duration
					: duration;
		return Math.max(1.5, pct(endSec - startSec));
	}

	let trackEl = $state<HTMLDivElement | null>(null);
	let dragging = false;

	function secondsFromEvent(e: PointerEvent | MouseEvent) {
		const box = trackEl?.getBoundingClientRect();
		if (!box) return seconds;
		const ratio = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
		return ratio * duration;
	}
	function startDrag(e: PointerEvent) {
		if (busy) return;
		dragging = true;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		onScrub(secondsFromEvent(e));
	}
	function moveDrag(e: PointerEvent) {
		if (!dragging || busy) return;
		onScrub(secondsFromEvent(e));
	}
	function endDrag() {
		dragging = false;
	}

	/** Long clips read as m:ss (2:05 beats "125s"); short ones keep decimals. */
	function fmt(sec: number): string {
		if (sec >= 60) {
			const m = Math.floor(sec / 60);
			const s = Math.round(sec % 60);
			return `${m}:${String(Math.min(59, s)).padStart(2, '0')}`;
		}
		return sec >= 10 ? `${sec.toFixed(0)}s` : `${sec.toFixed(1)}s`;
	}
</script>

<div
	class="rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)]/40 p-2 select-none"
>
	<!-- Transport: play/pause + time readout -->
	<div class="mb-1.5 flex items-center gap-2">
		<button
			type="button"
			onclick={onPlayPause}
			disabled={busy}
			aria-label={playing ? 'Pause preview' : 'Play preview'}
			class="grid size-7 shrink-0 place-items-center rounded-full bg-warm-500 text-white transition hover:brightness-110 active:scale-95 disabled:opacity-40"
		>
			<Icon
				name={playing ? 'i-lucide-pause' : 'i-lucide-play'}
				class="size-4 {playing ? '' : 'ml-0.5'}"
			/>
		</button>
		<span class="font-mono text-[10.5px] font-bold text-[var(--ui-text-muted)] tabular-nums">
			{fmt(seconds)} / {fmt(duration)}
		</span>
		<!-- Preview sound: unmutes source audio AND fires cue sounds live
		     (the parent owns the audio — this is just the toggle). -->
		{#if onToggleSound}
			<button
				type="button"
				onclick={onToggleSound}
				disabled={busy}
				aria-pressed={soundOn}
				aria-label={soundOn ? 'Mute preview sound' : 'Play preview with sound'}
				title={soundOn
					? 'Preview sound on — source audio + cue sounds'
					: 'Preview sound off — tap to hear source audio + cue sounds'}
				class="grid size-6 shrink-0 place-items-center rounded-full transition {soundOn
					? 'bg-warm-500/15 text-warm-600'
					: 'text-[var(--ui-text-dimmed)] hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]'} disabled:opacity-40"
			>
				<Icon name={soundOn ? 'i-lucide-volume-2' : 'i-lucide-volume-x'} class="size-3.5" />
			</button>
		{/if}
		<span
			class="ml-auto text-[9.5px] font-bold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
		>
			Timeline · drag to scrub
		</span>
	</div>

	<!-- Track: rows + shared playhead -->
	<div
		bind:this={trackEl}
		class="relative cursor-ew-resize touch-none"
		role="slider"
		aria-label="Preview position"
		aria-valuemin="0"
		aria-valuemax={Math.round(duration)}
		aria-valuenow={Math.round(seconds)}
		tabindex="-1"
		onpointerdown={startDrag}
		onpointermove={moveDrag}
		onpointerup={endDrag}
		onpointercancel={endDrag}
	>
		<!-- Row 1: caption windows (+ fx dot) -->
		{#if overlays.length}
			<div class="relative" style="height:{ROW_HEIGHT * Math.min(overlays.length, 4)}px">
				{#each overlays.slice(0, 4) as overlay, i (overlay.id)}
					{@const left = spanLeft(overlay)}
					{@const width = spanWidth(overlay)}
					<span
						class="absolute h-3.5 rounded-md {overlay.fx && overlay.fx !== 'none'
							? 'bg-primary-500/45'
							: 'bg-primary-500/30'}"
						style="top:{i * ROW_HEIGHT + 1}px; left:{left}%; width:{width}%;"
						title="“{overlay.text.slice(0, 40)}”{overlay.fx && overlay.fx !== 'none'
							? ` · ${overlay.fx}`
							: ''}"
					></span>
				{/each}
			</div>
		{/if}

		<!-- Row 2: image layers -->
		{#if layers.length}
			<div class="relative" style="height:{ROW_HEIGHT * Math.min(layers.length, 3)}px">
				{#each layers.slice(0, 3) as layer, i (layer.id)}
					<span
						class="absolute h-3.5 rounded-md bg-emerald-500/35"
						style="top:{i * ROW_HEIGHT + 1}px; left:{spanLeft(layer)}%; width:{spanWidth(layer)}%;"
						title="Image layer {i + 1}"
					></span>
				{/each}
			</div>
		{/if}

		<!-- Row 3: SFX cue ticks -->
		{#if cues.length}
			<div class="relative h-3.5">
				{#each cues as cue (cue.id)}
					<span
						class="absolute top-0 h-3.5 w-1 rounded-sm bg-warm-500"
						style="left:{pct(cue.atMs / 1000)}%;"
						title="Sound cue at {(cue.atMs / 1000).toFixed(1)}s"
					></span>
				{/each}
			</div>
		{/if}

		{#if !overlays.length && !layers.length && !cues.length}
			<p class="py-1.5 text-center text-[10.5px] font-semibold text-[var(--ui-text-dimmed)]">
				Add captions, layers or sound cues and their windows appear here
			</p>
		{/if}

		<!-- Shared playhead -->
		<div
			class="pointer-events-none absolute top-0 bottom-0 z-10 w-0.5 bg-warm-500"
			style="left:{pct(seconds)}%;"
			aria-hidden="true"
		>
			<span
				class="absolute top-0 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-warm-500 shadow"
			></span>
		</div>
	</div>
</div>
