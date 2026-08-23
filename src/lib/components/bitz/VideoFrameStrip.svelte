<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';

	/**
	 * Video frame strip: evenly spaced thumbnails across the clip, a draggable
	 * playhead (scrub the stage preview), trim-window shading, and a one-tap
	 * "make this the poster frame" action. Pure presentation — the parent owns
	 * the media element, thumb generation and poster state.
	 */
	let {
		durationSec,
		thumbUrls,
		playheadSec = 0,
		trimStartSec = 0,
		trimEndSec = null,
		posterSec = null,
		posterUrl = null,
		busy = false,
		onScrub,
		onPickPoster
	}: {
		durationSec: number;
		thumbUrls: string[];
		playheadSec?: number;
		trimStartSec?: number;
		trimEndSec?: number | null;
		posterSec?: number | null;
		posterUrl?: string | null;
		busy?: boolean;
		onScrub: (sec: number) => void;
		onPickPoster: (sec: number) => void;
	} = $props();

	let stripEl = $state<HTMLElement | null>(null);
	let dragging = $state(false);

	const safeDuration = $derived(Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0);
	const endSec = $derived(trimEndSec ?? safeDuration);
	const playheadPct = $derived(
		safeDuration ? Math.min(100, (playheadSec / safeDuration) * 100) : 0
	);
	const startPct = $derived(safeDuration ? Math.min(100, (trimStartSec / safeDuration) * 100) : 0);
	const endPct = $derived(safeDuration ? Math.min(100, (endSec / safeDuration) * 100) : 100);
	const posterPct = $derived(
		posterSec !== null && safeDuration ? Math.min(100, (posterSec / safeDuration) * 100) : null
	);

	function secFromEvent(e: PointerEvent): number {
		if (!stripEl || !safeDuration) return 0;
		const rect = stripEl.getBoundingClientRect();
		const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
		return ratio * safeDuration;
	}

	function onPointerDown(e: PointerEvent) {
		if (busy || !safeDuration) return;
		dragging = true;
		stripEl?.setPointerCapture(e.pointerId);
		onScrub(secFromEvent(e));
	}

	function onPointerMove(e: PointerEvent) {
		if (!dragging) return;
		onScrub(secFromEvent(e));
	}

	function onPointerUp() {
		dragging = false;
	}

	function fmt(sec: number): string {
		if (!Number.isFinite(sec) || sec < 0) return '0:00';
		const m = Math.floor(sec / 60);
		const s = Math.floor(sec % 60);
		return `${m}:${String(s).padStart(2, '0')}`;
	}

	function playheadFmt(): string {
		return fmt(posterSec ?? 0);
	}
</script>

<div class="flex flex-col gap-1">
	<div
		bind:this={stripEl}
		role="slider"
		tabindex="0"
		aria-label="Video timeline"
		aria-valuemin="0"
		aria-valuemax={Math.round(safeDuration)}
		aria-valuenow={Math.round(playheadSec)}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointercancel={onPointerUp}
		class="relative h-14 w-full cursor-pointer touch-none overflow-hidden rounded-lg bg-black/80 select-none"
	>
		<!-- Thumbnail bed -->
		<div class="absolute inset-0 flex">
			{#each thumbUrls as url, i (i)}
				<img
					src={url}
					alt=""
					draggable="false"
					class="h-full min-w-0 flex-1 object-cover opacity-80"
				/>
			{/each}
		</div>

		<!-- Out-of-trim shading -->
		{#if safeDuration}
			<div class="absolute top-0 bottom-0 left-0 bg-black/60" style="width:{startPct}%"></div>
			<div class="absolute top-0 right-0 bottom-0 bg-black/60" style="width:{100 - endPct}%"></div>
		{/if}

		<!-- Poster marker -->
		{#if posterPct !== null}
			<button
				type="button"
				class="absolute top-0.5 z-10 -translate-x-1/2"
				style="left:{posterPct}%"
				title={`Poster frame @ ${playheadFmt()}`}
				aria-label="Selected poster frame marker"
				onpointerdown={(e) => e.stopPropagation()}
				onclick={(e) => {
					e.stopPropagation();
					onScrub(posterSec ?? 0);
				}}
			>
				<Icon
					name="i-lucide-image"
					class="size-3.5 rounded-full bg-warm-500 p-0.5 text-white shadow"
				/>
			</button>
		{/if}

		<!-- Playhead -->
		<div
			class="pointer-events-none absolute top-0 bottom-0 z-10 w-0.5 bg-white shadow-[0_0_4px_rgba(0,0,0,0.8)]"
			style="left:{playheadPct}%"
		>
			<span class="absolute -top-0.5 left-1/2 size-2 -translate-x-1/2 rounded-full bg-white"></span>
		</div>
	</div>

	<div class="flex items-center justify-between gap-2 px-0.5">
		<p class="text-[10.5px] text-[var(--ui-text-dimmed)] tabular-nums">
			{fmt(playheadSec)} / {fmt(safeDuration)}
		</p>
		<button
			type="button"
			disabled={busy || !safeDuration}
			title="Use the frame at the playhead as the video's cover image"
			onclick={() => onPickPoster(playheadSec)}
			class="flex items-center gap-1 rounded-full bg-warm-500/10 px-2 py-0.5 text-[10.5px] font-bold text-warm-600 transition hover:bg-warm-500/20 disabled:opacity-40"
		>
			{#if posterUrl}
				<img src={posterUrl} alt="Staged poster frame" class="h-4 w-7 rounded-sm object-cover" />
			{/if}
			<Icon name="i-lucide-image-plus" class="size-3" />
			{posterPct !== null ? 'Re-pick poster @ playhead' : 'Set poster @ playhead'}
		</button>
	</div>
</div>
