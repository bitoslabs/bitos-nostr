<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import type { MemeTextOverlay, MemeSfxCue } from '$lib/meme/schema';
	import type { MemeImageOverlay } from '$lib/meme/image-overlay';

	/**
	 * MemeTimeline — the studio's scrub surface: a playhead over per-layer
	 * rows (captions, image layers, SFX cues) on the media clock. Pure
	 * UI — the parent owns the clock (playing state + seconds in/out) so the
	 * component stays byte-cheap and the stage stays the single source of
	 * truth. Reading is open to everyone; dragging emits `onscrub`.
	 *
	 * Timeline editing:
	 *   • zoom — scroll/⌘-scroll zooms around the cursor, ⇧-scroll pans,
	 *     +/−/Fit buttons cover touch (zoom = px per media second)
	 *   • move/resize — caption + image-layer spans drag to move, their edge
	 *     handles resize the window (patches flow back via onPatch*)
	 *   • cue ticks drag to retime (onPatchCue)
	 *   • snaps — clip edges, the playhead and whole seconds
	 */

	let {
		durationSec,
		seconds,
		playing,
		overlays = [],
		layers = [],
		cues = [],
		baseTrack = null,
		busy = false,
		soundOn = false,
		selectedOverlayId = null,
		selectedLayerId = null,
		onToggleSound,
		onPlayPause,
		onScrub,
		onPatchOverlay,
		onPatchLayer,
		onPatchBase,
		onRemoveLayer,
		onReorderLayer,
		onPatchCue,
		cueMetaFor,
		onSelectOverlay,
		onSelectLayer
	}: {
		durationSec: number;
		/** Playhead position (media seconds). */
		seconds: number;
		playing: boolean;
		overlays?: MemeTextOverlay[];
		layers?: MemeImageOverlay[];
		cues?: MemeSfxCue[];
		/** The base media as the timeline's first row: the video's trim window
		 *  (draggable) or a GIF loop badge (display-only). */
		baseTrack?: {
			label: string;
			startSec: number;
			endSec: number;
			/** e.g. "loops ×2" — right-side hint chip. */
			badge?: string;
			draggable?: boolean;
		} | null;
		busy?: boolean;
		/** Preview sound (source audio + live cue firing) — parent owns the audio. */
		soundOn?: boolean;
		selectedOverlayId?: string | null;
		selectedLayerId?: string | null;
		onToggleSound?: () => void;
		onPlayPause: () => void;
		onScrub: (sec: number) => void;
		/** Drag-edit a caption's visibility window (span drag / edge resize). */
		onPatchOverlay?: (id: string, patch: { startMs?: number; endMs?: number }) => void;
		/** Drag-edit an image layer's visibility window. */
		onPatchLayer?: (id: string, patch: { startMs?: number; endMs?: number }) => void;
		/** Drag-edit the base video's trim window (video bases only). */
		onPatchBase?: (patch: { startMs?: number; endMs?: number }) => void;
		/** Row actions on image layers: remove + z-order moves. */
		onRemoveLayer?: (id: string) => void;
		onReorderLayer?: (id: string, dir: -1 | 1) => void;
		/** Drag a cue tick to a new time (ms). */
		onPatchCue?: (id: string, atMs: number) => void;
		/** Sound blocks: label + play length per cue — turns cue ticks into
		 *  duration spans on the timeline (falls back to ticks when absent). */
		cueMetaFor?: (cue: MemeSfxCue) => { label: string; durationSec: number } | null;
		onSelectOverlay?: (id: string) => void;
		onSelectLayer?: (id: string) => void;
	} = $props();

	const ROW_HEIGHT = 18;
	/** Shortest draggable window (seconds) — edges can't cross. */
	const MIN_WINDOW_SEC = 0.2;
	/** Snap strength in px, converted to seconds at the current zoom. */
	const SNAP_PX = 7;
	/** Zoom clamp (px per media second) + step for the +/− buttons. High
	 *  enough that even a 1s clip can zoom in past its fit width. */
	const MIN_PX_PER_SEC = 3;
	const MAX_PX_PER_SEC = 2000;
	const ZOOM_STEP = 1.6;
	/** Ruler label spacing floor (px) — picks the tick step from this. */
	const TICK_MIN_PX = 56;
	const TICK_STEPS = [0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

	const duration = $derived(Math.max(durationSec, 0.001));

	// ---- zoom + horizontal scroll --------------------------------------------
	let scrollEl = $state<HTMLDivElement | null>(null);
	let trackEl = $state<HTMLDivElement | null>(null);
	let viewportW = $state(0);
	/** User zoom (px/s); 0 = auto-fit the viewport. */
	let zoomPxPerSec = $state(0);
	/** Scale frozen for the duration of a drag. At fit zoom, dragging the
	 *  LAST cue extends the track, which re-fits pxPerSec under the cursor
	 *  mid-gesture — the span then slips and "moves sometimes don't work".
	 *  Freezing keeps the pointer math stable until pointerup. */
	let dragFrozenPx = $state<number | null>(null);
	const fitPxPerSec = $derived(viewportW > 0 ? viewportW / duration : 0);
	const pxPerSec = $derived(
		dragFrozenPx ?? (zoomPxPerSec > 0 ? zoomPxPerSec : Math.max(fitPxPerSec, 8))
	);
	const trackWidth = $derived(Math.max(duration * pxPerSec + 24, viewportW));
	/** Zoom readout relative to fit (Fit = 100%). */
	const zoomPct = $derived(fitPxPerSec > 0 ? Math.round((pxPerSec / fitPxPerSec) * 100) : 100);

	$effect(() => {
		const el = scrollEl;
		if (!el) return;
		viewportW = el.clientWidth;
		const ro = new ResizeObserver(() => (viewportW = el.clientWidth));
		ro.observe(el);
		return () => ro.disconnect();
	});

	/** Cleared stage → back to fit for the next media. Grown/shrunk clocks
	 *  (cue retimes, metadata landing) keep the zoom — flipping px/s mid-drag
	 *  would yank the span out from under the pointer. */
	$effect(() => {
		if (durationSec <= 0.001) zoomPxPerSec = 0;
	});

	/** Keep the playhead on screen while it plays past the viewport edge. */
	$effect(() => {
		void seconds;
		const el = scrollEl;
		if (!playing || !el) return;
		const x = seconds * pxPerSec;
		const view = el.clientWidth;
		if (x < el.scrollLeft + 16 || x > el.scrollLeft + view - 72) {
			el.scrollLeft = Math.max(0, x - view * 0.2);
		}
	});

	function zoomAt(factor: number, anchorSec: number | null) {
		const el = scrollEl;
		if (!el) return;
		const before = pxPerSec;
		const next = Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, before * factor));
		if (Math.abs(next - before) < 0.05) return;
		zoomPxPerSec = next;
		if (anchorSec !== null) {
			// Pin the time under the cursor to its viewport column.
			const anchorX = anchorSec * before - el.scrollLeft;
			el.scrollLeft = anchorSec * next - anchorX;
		}
	}

	function fitZoom() {
		zoomPxPerSec = 0;
		if (scrollEl) scrollEl.scrollLeft = 0;
	}

	function onWheel(e: WheelEvent) {
		if (busy) return;
		if (e.altKey) return; // Alt hands vertical wheel to the rows scroller
		e.preventDefault();
		if (e.shiftKey) {
			// ⇧-scroll pans (classic vertical→horizontal swap).
			scrollEl?.scrollBy({ left: e.deltaY || e.deltaX });
		} else if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
			// Trackpad two-finger horizontal swipe.
			scrollEl?.scrollBy({ left: e.deltaX });
		} else {
			// Scroll (or trackpad pinch — its deltas are tiny) zooms at the cursor.
			const amount = e.deltaY * (e.ctrlKey || e.metaKey ? 0.01 : 0.0022);
			zoomAt(Math.exp(-amount), timeAtClientX(e.clientX));
		}
	}

	// ---- scrub (track background: ruler + empty row space) --------------------
	function timeAtClientX(clientX: number): number {
		const box = trackEl?.getBoundingClientRect();
		if (!box) return 0;
		return Math.max(0, Math.min(duration, ((clientX - box.left) / (box.width || 1)) * duration));
	}

	/** Zoom buttons anchor the viewport's center time. */
	function centerSec(): number | null {
		const el = scrollEl;
		if (!el) return null;
		return (el.scrollLeft + el.clientWidth / 2) / pxPerSec;
	}

	let scrubbing = false;
	function startScrub(e: PointerEvent) {
		if (busy) return;
		scrubbing = true;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		onScrub(timeAtClientX(e.clientX));
	}
	function moveScrub(e: PointerEvent) {
		if (!scrubbing || busy) return;
		onScrub(timeAtClientX(e.clientX));
	}
	function endScrub() {
		scrubbing = false;
	}

	// ---- span drag: move / resize caption + layer windows ---------------------
	interface WindowItem {
		id: string;
		startMs?: number;
		endMs?: number;
	}
	interface SpanDrag {
		kind: 'overlay' | 'layer' | 'base';
		id: string;
		mode: 'move' | 'start' | 'end';
		/** Pointer time − window start, so the grab point stays put. */
		grabOffsetSec: number;
		baseStart: number;
		baseEnd: number;
	}
	let spanDrag: SpanDrag | null = null;
	let cueDragId: string | null = null;

	function windowOf(item: WindowItem): { start: number; end: number } {
		return {
			start: (item.startMs ?? 0) / 1000,
			end: item.endMs !== undefined ? item.endMs / 1000 : duration
		};
	}

	/** Snap points: clip edges, the playhead and the nearest whole second. */
	function snapSec(t: number): number {
		const threshold = SNAP_PX / pxPerSec;
		const cands = [0, duration, seconds, Math.round(t)];
		let best = t;
		let bestD = threshold;
		for (const c of cands) {
			const d = Math.abs(c - t);
			if (d < bestD) {
				best = c;
				bestD = d;
			}
		}
		return Math.max(0, Math.min(duration, Math.round(best * 1000) / 1000));
	}

	function emitSpanPatch(d: SpanDrag, patch: { startMs?: number; endMs?: number }) {
		if (d.kind === 'overlay') onPatchOverlay?.(d.id, patch);
		else if (d.kind === 'layer') onPatchLayer?.(d.id, patch);
		else onPatchBase?.(patch);
	}

	function onSpanPointerDown(
		e: PointerEvent,
		kind: 'overlay' | 'layer' | 'base',
		item: WindowItem,
		mode: 'move' | 'start' | 'end'
	) {
		if (busy) return;
		if (kind === 'overlay' ? !onPatchOverlay : kind === 'layer' ? !onPatchLayer : !onPatchBase)
			return;
		e.stopPropagation(); // a span grab never scrubs
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		if (kind === 'overlay') onSelectOverlay?.(item.id);
		else if (kind === 'layer') onSelectLayer?.(item.id);
		dragFrozenPx = pxPerSec;
		const w = windowOf(item);
		spanDrag = {
			kind,
			id: item.id,
			mode,
			grabOffsetSec: timeAtClientX(e.clientX) - w.start,
			baseStart: w.start,
			baseEnd: w.end
		};
	}

	function onSpanPointerMove(e: PointerEvent) {
		const d = spanDrag;
		if (!d || busy) return;
		// Auto-pan when the drag runs past the viewport edge.
		const el = scrollEl;
		if (el) {
			const box = el.getBoundingClientRect();
			if (e.clientX > box.right - 20) el.scrollLeft += 10;
			else if (e.clientX < box.left + 20) el.scrollLeft -= 10;
		}
		const t = timeAtClientX(e.clientX);
		const len = Math.max(MIN_WINDOW_SEC, d.baseEnd - d.baseStart);
		const ms = (sec: number) => Math.round(sec * 1000);
		if (d.mode === 'move') {
			let start = snapSec(Math.max(0, Math.min(duration - len, t - d.grabOffsetSec)));
			start = Math.min(start, duration - len);
			emitSpanPatch(d, { startMs: ms(start), endMs: ms(start + len) });
		} else if (d.mode === 'start') {
			const s = Math.min(snapSec(t), d.baseEnd - MIN_WINDOW_SEC);
			emitSpanPatch(d, { startMs: ms(Math.max(0, s)), endMs: ms(d.baseEnd) });
		} else {
			const en = Math.max(snapSec(t), d.baseStart + MIN_WINDOW_SEC);
			emitSpanPatch(d, { startMs: ms(d.baseStart), endMs: ms(Math.min(duration, en)) });
		}
	}

	function endSpanDrag() {
		spanDrag = null;
		cueDragId = null;
		dragFrozenPx = null;
	}

	function onCuePointerDown(e: PointerEvent, cue: MemeSfxCue) {
		if (busy || !onPatchCue) return;
		e.stopPropagation();
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		dragFrozenPx = pxPerSec;
		cueDragId = cue.id;
	}

	function onCuePointerMove(e: PointerEvent) {
		if (!cueDragId || busy) return;
		// Same edge auto-pan as caption/layer spans — drags past the viewport
		// keep going instead of dead-ending at the edge.
		const el = scrollEl;
		if (el) {
			const box = el.getBoundingClientRect();
			if (e.clientX > box.right - 20) el.scrollLeft += 10;
			else if (e.clientX < box.left + 20) el.scrollLeft -= 10;
		}
		onPatchCue?.(cueDragId, Math.round(snapSec(timeAtClientX(e.clientX)) * 1000));
	}

	// ---- ruler ----------------------------------------------------------------
	const tickStep = $derived.by(() => {
		for (const step of TICK_STEPS) if (step * pxPerSec >= TICK_MIN_PX) return step;
		return TICK_STEPS[TICK_STEPS.length - 1]!;
	});
	const ticks = $derived.by(() => {
		const out: number[] = [];
		for (let t = 0; t <= duration + 1e-6; t += tickStep) out.push(Math.round(t * 1000) / 1000);
		return out;
	});

	function tickLabel(t: number): string {
		if (tickStep < 1) return `${t.toFixed(1)}s`;
		if (t >= 60) {
			const m = Math.floor(t / 60);
			return `${m}:${String(Math.round(t % 60)).padStart(2, '0')}`;
		}
		return `${Math.round(t)}s`;
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

	const spanHandlers = {
		onpointermove: onSpanPointerMove,
		onpointerup: endSpanDrag,
		onpointercancel: endSpanDrag
	};
</script>

<div
	class="rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)]/40 p-2 select-none"
>
	<!-- Transport: play/pause + time readout + zoom -->
	<div class="mb-1.5 flex flex-wrap items-center gap-2">
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
			class="ml-auto hidden text-[9.5px] font-bold tracking-wider text-[var(--ui-text-dimmed)] uppercase sm:inline"
		>
			Timeline · drag to scrub · scroll to zoom
		</span>
		<!-- Zoom: +/− buttons + readout (click the % to fit). Scroll/pinch covers pointer users. -->
		<div class="flex items-center gap-0.5 rounded-full bg-[var(--ui-bg-accented)] p-0.5">
			<button
				type="button"
				onclick={() => zoomAt(1 / ZOOM_STEP, centerSec())}
				disabled={busy}
				aria-label="Zoom the timeline out"
				title="Zoom out"
				class="grid size-5 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-40"
			>
				<Icon name="i-lucide-zoom-out" class="size-3.5" />
			</button>
			<button
				type="button"
				onclick={fitZoom}
				disabled={busy}
				aria-label="Fit the whole clip in view"
				title="Fit the whole clip"
				class="min-w-[3.25rem] font-mono text-[9.5px] font-bold text-[var(--ui-text-muted)] tabular-nums transition hover:text-[var(--ui-text)] disabled:opacity-40"
			>
				{zoomPxPerSec === 0 ? 'Fit' : `${zoomPct}%`}
			</button>
			<button
				type="button"
				onclick={() => zoomAt(ZOOM_STEP, centerSec())}
				disabled={busy}
				aria-label="Zoom the timeline in"
				title="Zoom in"
				class="grid size-5 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-40"
			>
				<Icon name="i-lucide-zoom-in" class="size-3.5" />
			</button>
		</div>
	</div>

	<!-- Horizontal scroller: zooming grows the track past the viewport -->
	<div bind:this={scrollEl} class="scrollbar-thin overflow-x-auto" onwheel={onWheel}>
		<div
			bind:this={trackEl}
			class="relative cursor-ew-resize touch-none"
			style="width:{trackWidth}px"
			role="slider"
			aria-label="Preview position"
			aria-valuemin="0"
			aria-valuemax={Math.round(duration)}
			aria-valuenow={Math.round(seconds)}
			tabindex="-1"
			onpointerdown={startScrub}
			onpointermove={moveScrub}
			onpointerup={endScrub}
			onpointercancel={endScrub}
		>
			<!-- Ruler: adaptive second ticks + labels -->
			<div class="relative h-4 border-b border-[var(--ui-border-muted)]">
				{#each ticks as t (t)}
					<span
						class="absolute top-0 bottom-0 w-px bg-[var(--ui-border-muted)]"
						style="left:{t * pxPerSec}px"
						aria-hidden="true"
					></span>
					<span
						class="absolute top-0 -translate-x-1/2 font-mono text-[8.5px] leading-4 font-bold text-[var(--ui-text-dimmed)] tabular-nums"
						style="left:{t * pxPerSec}px"
						aria-hidden="true"
					>
						{tickLabel(t)}
					</span>
				{/each}
			</div>

			<!-- Rows: every caption/layer gets its own row; past ~9 rows they
			     scroll vertically (Alt+wheel or the scrollbar). -->
			<div class="relative max-h-[168px] scrollbar-thin overflow-y-auto">
				{#if baseTrack}
					<!-- Base media row: the video's trim window (draggable — same
					     move/resize grammar as captions) or the GIF loop (badge). -->
					{@const w = { start: baseTrack.startSec, end: Math.min(baseTrack.endSec, duration) }}
					<div class="relative" style="height:{ROW_HEIGHT}px">
						<span
							class="absolute top-px h-3.5 rounded-md bg-sky-500/40 {baseTrack.draggable &&
							onPatchBase
								? 'cursor-grab hover:brightness-125'
								: ''}"
							style="left:{w.start * pxPerSec}px; width:{Math.max(
								6,
								(w.end - w.start) * pxPerSec
							)}px;"
							title="{baseTrack.label} · {w.start.toFixed(1)}s–{baseTrack.endSec.toFixed(
								1
							)}s{baseTrack.badge ? ` · ${baseTrack.badge}` : ''}{baseTrack.draggable && onPatchBase
								? ' · drag to move, edges to resize (trim)'
								: ''}"
							aria-label={`${baseTrack.label} track`}
							onpointerdown={(e) => {
								if (!baseTrack.draggable || !onPatchBase) return;
								onSpanPointerDown(
									e,
									'base',
									{
										id: 'base',
										startMs: baseTrack.startSec * 1000,
										endMs: baseTrack.endSec * 1000
									},
									'move'
								);
							}}
							{...spanHandlers}
						>
							<span
								class="pointer-events-none absolute inset-y-0 left-1 flex items-center overflow-hidden text-[9px] font-bold whitespace-nowrap text-white/80"
								style="max-width:calc(100% - 4px)"
							>
								{baseTrack.label}
								{#if baseTrack.badge}
									<span class="ml-1 rounded bg-white/25 px-1">{baseTrack.badge}</span>
								{/if}
							</span>
							{#if baseTrack.draggable && onPatchBase}
								<span
									class="absolute inset-y-0 left-0 w-2 cursor-ew-resize rounded-l-md hover:bg-white/50"
									title="Trim start"
									onpointerdown={(e) =>
										onSpanPointerDown(
											e,
											'base',
											{
												id: 'base',
												startMs: baseTrack.startSec * 1000,
												endMs: baseTrack.endSec * 1000
											},
											'start'
										)}
									{...spanHandlers}
								></span>
								<span
									class="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r-md hover:bg-white/50"
									title="Trim end"
									onpointerdown={(e) =>
										onSpanPointerDown(
											e,
											'base',
											{
												id: 'base',
												startMs: baseTrack.startSec * 1000,
												endMs: baseTrack.endSec * 1000
											},
											'end'
										)}
									{...spanHandlers}
								></span>
							{/if}
						</span>
					</div>
				{/if}
				{#each overlays as overlay, i (overlay.id)}
					{@const w = windowOf(overlay)}
					{@const selected = selectedOverlayId === overlay.id}
					<div class="relative" style="height:{ROW_HEIGHT}px">
						<span
							class="absolute top-px h-3.5 rounded-md {overlay.fx && overlay.fx !== 'none'
								? 'bg-primary-500/45'
								: 'bg-primary-500/30'} {selected ? 'ring-1 ring-warm-500' : ''} {onPatchOverlay
								? 'cursor-grab hover:brightness-125'
								: ''}"
							style="left:{w.start * pxPerSec}px; width:{Math.max(
								6,
								(w.end - w.start) * pxPerSec
							)}px;"
							title="“{overlay.text.slice(0, 40)}”{overlay.fx && overlay.fx !== 'none'
								? ` · ${overlay.fx}`
								: ''}{onPatchOverlay ? ' · drag to move, edges to resize' : ''}"
							aria-label={`Caption ${i + 1} window`}
							onpointerdown={(e) => onSpanPointerDown(e, 'overlay', overlay, 'move')}
							{...spanHandlers}
						>
							<span
								class="pointer-events-none absolute inset-y-0 left-1 flex items-center overflow-hidden text-[9px] font-bold whitespace-nowrap text-white/80"
								style="max-width:calc(100% - 4px)"
							>
								{overlay.caps ? overlay.text.toUpperCase() : overlay.text}
							</span>
							{#if onPatchOverlay}
								<!-- Edge handles: left/right 8px zones resize the window. -->
								<span
									class="absolute inset-y-0 left-0 w-2 cursor-ew-resize rounded-l-md hover:bg-white/50"
									title="Resize the window start"
									onpointerdown={(e) => onSpanPointerDown(e, 'overlay', overlay, 'start')}
									{...spanHandlers}
								></span>
								<span
									class="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r-md hover:bg-white/50"
									title="Resize the window end"
									onpointerdown={(e) => onSpanPointerDown(e, 'overlay', overlay, 'end')}
									{...spanHandlers}
								></span>
							{/if}
						</span>
					</div>
				{/each}

				{#each layers as layer, i (layer.id)}
					{@const w = windowOf(layer)}
					{@const selected = selectedLayerId === layer.id}
					{@const canRow = !busy && (onRemoveLayer || onReorderLayer)}
					<div class="group relative" style="height:{ROW_HEIGHT}px">
						<span
							class="absolute top-px h-3.5 rounded-md bg-emerald-500/35 {selected
								? 'ring-1 ring-warm-500'
								: ''} {onPatchLayer ? 'cursor-grab hover:brightness-125' : ''}"
							style="left:{w.start * pxPerSec}px; width:{Math.max(
								6,
								(w.end - w.start) * pxPerSec
							)}px;"
							title="Image layer {i + 1}{onPatchLayer ? ' · drag to move, edges to resize' : ''}"
							aria-label={`Image layer ${i + 1} window`}
							onpointerdown={(e) => onSpanPointerDown(e, 'layer', layer, 'move')}
							{...spanHandlers}
						>
							<span
								class="pointer-events-none absolute inset-y-0 left-1 flex items-center overflow-hidden text-[9px] font-bold whitespace-nowrap text-white/80"
								style="max-width:calc(100% - 4px)"
							>
								L{i + 1}
							</span>
							{#if onPatchLayer}
								<span
									class="absolute inset-y-0 left-0 w-2 cursor-ew-resize rounded-l-md hover:bg-white/50"
									title="Resize the window start"
									onpointerdown={(e) => onSpanPointerDown(e, 'layer', layer, 'start')}
									{...spanHandlers}
								></span>
								<span
									class="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r-md hover:bg-white/50"
									title="Resize the window end"
									onpointerdown={(e) => onSpanPointerDown(e, 'layer', layer, 'end')}
									{...spanHandlers}
								></span>
							{/if}
						</span>
						<!-- Row actions (hover): z-order up/down + remove — the same
						     controls as the layers list, right on the timeline row. -->
						{#if canRow}
							<div
								class="absolute top-0 right-0 z-10 hidden h-3.5 items-center gap-px rounded bg-[var(--ui-bg)]/95 pl-0.5 shadow group-hover:flex"
							>
								{#if onReorderLayer}
									<button
										type="button"
										aria-label={`Bring layer ${i + 1} forward`}
										title="Bring layer forward (paints on top)"
										onclick={() => onReorderLayer(layer.id, 1)}
										class="grid size-3.5 place-items-center text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]"
									>
										<Icon name="i-lucide-arrow-up" class="size-2.5" />
									</button>
									<button
										type="button"
										aria-label={`Send layer ${i + 1} backward`}
										title="Send layer backward"
										onclick={() => onReorderLayer(layer.id, -1)}
										class="grid size-3.5 place-items-center text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]"
									>
										<Icon name="i-lucide-arrow-down" class="size-2.5" />
									</button>
								{/if}
								{#if onRemoveLayer}
									<button
										type="button"
										aria-label={`Remove layer ${i + 1}`}
										title="Remove this layer"
										onclick={() => onRemoveLayer(layer.id)}
										class="grid size-3.5 place-items-center text-[var(--ui-text-muted)] hover:text-red-500"
									>
										<Icon name="i-lucide-x" class="size-3" />
									</button>
								{/if}
							</div>
						{/if}
					</div>
				{/each}

				{#if cues.length}
					<div class="relative h-3.5">
						{#each cues as cue (cue.id)}
							{@const meta = cueMetaFor?.(cue) ?? null}
							{#if meta && meta.durationSec > 0}
								<!-- Sound block: a span as long as the sound plays, labeled
								     when there's room — reads like a real editor's audio row. -->
								<span
									role="button"
									tabindex="-1"
									class="absolute top-0 h-3.5 rounded-sm bg-warm-500/80 {onPatchCue
										? 'cursor-ew-resize hover:brightness-110'
										: ''}"
									style="left:{(cue.atMs / 1000) * pxPerSec}px; width:{Math.max(
										8,
										meta.durationSec * pxPerSec
									)}px;"
									title="{meta.label} @ {(cue.atMs / 1000).toFixed(1)}s · {meta.durationSec.toFixed(
										1
									)}s{onPatchCue ? ' · drag to retime' : ''}"
									aria-label={`${meta.label} cue at ${(cue.atMs / 1000).toFixed(1)}s`}
									onpointerdown={(e) => onCuePointerDown(e, cue)}
									onpointermove={onCuePointerMove}
									onpointerup={endSpanDrag}
									onpointercancel={endSpanDrag}
								>
									{#if meta.durationSec * pxPerSec > 34}
										<span
											class="pointer-events-none absolute inset-y-0 left-1 flex items-center overflow-hidden text-[8px] font-bold whitespace-nowrap text-white"
											style="max-width:calc(100% - 4px)"
										>
											{meta.label}
										</span>
									{/if}
								</span>
							{:else}
								<span
									role="button"
									tabindex="-1"
									class="absolute top-0 h-3.5 w-1.5 rounded-sm bg-warm-500 {onPatchCue
										? 'cursor-ew-resize hover:brightness-125'
										: ''}"
									style="left:{(cue.atMs / 1000) * pxPerSec}px;"
									title="Sound cue at {(cue.atMs / 1000).toFixed(1)}s{onPatchCue
										? ' · drag to retime'
										: ''}"
									aria-label={`Sound cue at ${(cue.atMs / 1000).toFixed(1)}s`}
									onpointerdown={(e) => onCuePointerDown(e, cue)}
									onpointermove={onCuePointerMove}
									onpointerup={endSpanDrag}
									onpointercancel={endSpanDrag}
								></span>
							{/if}
						{/each}
					</div>
				{/if}

				{#if !overlays.length && !layers.length && !cues.length}
					<p class="py-1.5 text-center text-[10.5px] font-semibold text-[var(--ui-text-dimmed)]">
						Add captions, layers or sound cues and their windows appear here
					</p>
				{/if}
			</div>

			<!-- Shared playhead -->
			<div
				class="pointer-events-none absolute top-0 bottom-0 z-10 w-0.5 bg-warm-500"
				style="left:{seconds * pxPerSec}px;"
				aria-hidden="true"
			>
				<span
					class="absolute top-0 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-warm-500 shadow"
				></span>
			</div>
		</div>
	</div>
</div>
