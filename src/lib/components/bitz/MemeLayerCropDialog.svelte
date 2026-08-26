<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import { MIN_CROP, type MemeImageOverlay } from '$lib/meme/image-overlay';

	/**
	 * MemeLayerCropDialog — source-image crop editor for an image layer
	 * (user request 2026-08-26: layers could move/resize but not CROP).
	 *
	 * The crop window is normalized to the natural image (x/y/w/h in 0–1),
	 * so it restores on any artboard and rides the wire `c` field. Draggable
	 * + edge-resizable with pointer events (touch-friendly, mirrors the
	 * stage's layer drag), aspect-ratio presets (free / 1:1 / 4:3 / 16:9)
	 * and numeric inputs for precision. Pure controls — the parent owns the
	 * layer; the accepted crop flows back through `onApply`.
	 */
	let {
		layer,
		renderSrc,
		onApply,
		onCancel
	}: {
		layer: MemeImageOverlay;
		/** Same-origin blob URL when bytes are held (preferred preview src). */
		renderSrc: string | null;
		onApply: (crop: { x: number; y: number; w: number; h: number } | undefined) => void;
		onCancel: () => void;
	} = $props();

	type Crop = { x: number; y: number; w: number; h: number };

	let draft = $state<Crop>({ ...(layer.crop ?? { x: 0, y: 0, w: 1, h: 1 }) });
	/** Aspect lock: null = free, else w/h of the crop box. */
	let lockAspect: number | null = $state(null);
	let frameEl = $state<HTMLElement | null>(null);
	let drag: { mode: 'move' | Corner | null; px: number; py: number } | null = null;
	type Corner = 'nw' | 'ne' | 'sw' | 'se';

	function clamp01(v: number): number {
		return Math.min(1, Math.max(0, v));
	}

	/** Keep the box inside the unit square; lock the aspect when requested.
	 *  Any degenerate edge clamps to MIN_CROP so the crop stays pickable. */
	function constrain(next: Crop): Crop {
		let { x, y, w, h } = next;
		w = Math.min(1, Math.max(MIN_CROP, w));
		h = Math.min(1, Math.max(MIN_CROP, h));
		if (lockAspect) {
			// Width leads; height follows, clamped to [MIN_CROP, 1].
			h = Math.min(1, Math.max(MIN_CROP, w / lockAspect));
			w = h * lockAspect;
			w = Math.min(1, Math.max(MIN_CROP, w));
			h = Math.min(1, Math.max(MIN_CROP, w / lockAspect));
		}
		x = Math.min(clamp01(x), 1 - w);
		y = Math.min(clamp01(y), 1 - h);
		return { x, y, w, h };
	}

	function pointerPos(e: PointerEvent): { px: number; py: number } {
		const box = frameEl?.getBoundingClientRect();
		if (!box) return { px: 0, py: 0 };
		return {
			px: clamp01((e.clientX - box.left) / box.width),
			py: clamp01((e.clientY - box.top) / box.height)
		};
	}

	function onFramePointerDown(e: PointerEvent, mode: 'move' | Corner | null) {
		if (mode !== 'move' && !mode) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		const { px, py } = pointerPos(e);
		drag = { mode, px, py };
	}

	function onFramePointerMove(e: PointerEvent) {
		if (!drag) return;
		const { px, py } = pointerPos(e);
		const dx = px - drag.px;
		const dy = py - drag.py;
		drag.px = px;
		drag.py = py;
		if (drag.mode === 'move') {
			draft = constrain({ ...draft, x: draft.x + dx, y: draft.y + dy });
			return;
		}
		const corner = drag.mode;
		if (corner === 'nw') {
			const w = draft.w - dx;
			const h = lockAspect ? w / lockAspect : draft.h - dy;
			draft = constrain({
				x: draft.x + (draft.w - w),
				y: draft.y + (draft.h - h),
				w,
				h
			});
		} else if (corner === 'ne') {
			const w = draft.w + dx;
			const h = lockAspect ? w / lockAspect : draft.h - dy;
			draft = constrain({ x: draft.x, y: draft.y + (draft.h - h), w, h });
		} else if (corner === 'sw') {
			const w = draft.w - dx;
			const h = lockAspect ? w / lockAspect : draft.h + dy;
			draft = constrain({ x: draft.x + (draft.w - w), y: draft.y, w, h });
		} else {
			const w = draft.w + dx;
			const h = lockAspect ? w / lockAspect : draft.h + dy;
			draft = constrain({ x: draft.x, y: draft.y, w, h });
		}
	}

	function endDrag() {
		drag = null;
	}

	/** Apply an aspect preset to the CURRENT box (anchored at its top-left,
	 *  clamped). null = unlock. */
	function applyLock(ratio: number | null) {
		lockAspect = ratio;
		if (!ratio) return;
		draft = constrain({ ...draft, h: draft.w / ratio });
	}

	function resetCrop() {
		lockAspect = null;
		draft = { x: 0, y: 0, w: 1, h: 1 };
	}

	const hasCrop = $derived(layer.crop !== undefined);
</script>

<div
	class="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4"
	role="dialog"
	aria-modal="true"
	aria-label="Crop image layer"
>
	<div class="surface-card w-full max-w-sm rounded-2xl p-4">
		<div class="flex items-center justify-between gap-2">
			<h3 class="flex items-center gap-1.5 text-[14px] font-bold">
				<Icon name="i-lucide-crop" class="size-4 text-warm-500" />
				Crop layer image
			</h3>
			<button
				type="button"
				onclick={onCancel}
				aria-label="Close crop editor"
				class="grid size-7 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]"
			>
				<Icon name="i-lucide-x" class="size-4" />
			</button>
		</div>

		<!-- Frame: the natural image with a draggable crop window over it.
		     Pointer math is normalized to the frame box, so it works at any
		     rendered size; the frame hugs the CROP's aspect so what you see
		     is what the layer box will become. -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			bind:this={frameEl}
			class="relative mt-3 max-h-[46dvh] touch-none overflow-hidden rounded-xl bg-black/70 select-none"
			style="aspect-ratio:{layer.aspect * (draft.w / draft.h) || 1};"
			onpointerdown={(e) => onFramePointerDown(e, 'move')}
			onpointermove={onFramePointerMove}
			onpointerup={endDrag}
			onpointercancel={endDrag}
		>
			<!-- Whole image, cover-fit into the frame — exactly how the cropped
			     region will fill the layer box on the stage. -->
			<img
				src={renderSrc ?? layer.src}
				alt=""
				crossOrigin="anonymous"
				draggable="false"
				class="pointer-events-none absolute inset-0 h-full w-full object-cover"
				style="transform:scale({1 / Math.min(draft.w, draft.h)});"
			/>
			<!-- Dim everything OUTSIDE the crop window (evenodd hole). -->
			<div
				class="pointer-events-none absolute inset-0 bg-black/55"
				style="clip-path:polygon(evenodd, 0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, {draft.x *
					100}% {draft.y * 100}%, {(draft.x + draft.w) * 100}% {draft.y * 100}%, {(draft.x +
					draft.w) *
					100}% {(draft.y + draft.h) * 100}%, {draft.x * 100}% {(draft.y + draft.h) *
					100}%, {draft.x * 100}% {draft.y * 100}%);"
			></div>
			<!-- Crop window + corner handles -->
			<div
				class="absolute cursor-move border-2 border-warm-500"
				style="left:{draft.x * 100}%; top:{draft.y * 100}%; width:{draft.w *
					100}%; height:{draft.h * 100}%;"
			>
				{#each ['nw', 'ne', 'sw', 'se'] as corner (corner)}
					<span
						role="button"
						tabindex="-1"
						onpointerdown={(e) => {
							e.stopPropagation();
							onFramePointerDown(e, corner as Corner);
						}}
						aria-label={`Crop ${corner} handle`}
						class="absolute grid size-5 place-items-center rounded-full border border-warm-500 bg-black/80 {corner ===
						'nw'
							? '-top-2.5 -left-2.5 cursor-nwse-resize'
							: corner === 'ne'
								? '-top-2.5 -right-2.5 cursor-nesw-resize'
								: corner === 'sw'
									? '-bottom-2.5 -left-2.5 cursor-nesw-resize'
									: '-right-2.5 -bottom-2.5 cursor-nwse-resize'}"
					>
					</span>
				{/each}
			</div>
		</div>

		<!-- Aspect locks -->
		<div class="mt-2.5 flex flex-wrap items-center gap-1">
			<span class="mr-0.5 text-[10.5px] font-bold text-[var(--ui-text-muted)]">Shape</span>
			{#each [{ id: 'free', label: 'Free', ratio: null }, { id: '1:1', label: '1:1', ratio: 1 }, { id: '4:3', label: '4:3', ratio: 4 / 3 }, { id: '16:9', label: '16:9', ratio: 16 / 9 }, { id: '9:16', label: '9:16', ratio: 9 / 16 }] as preset (preset.id)}
				<button
					type="button"
					onclick={() => applyLock(preset.ratio)}
					aria-pressed={lockAspect === preset.ratio ||
						(preset.ratio === null && lockAspect === null)}
					class="h-6 rounded-full px-2 text-[10.5px] font-bold transition {(preset.ratio === null &&
						lockAspect === null) ||
					lockAspect === preset.ratio
						? 'bg-warm-500 text-white'
						: 'bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]'}"
				>
					{preset.label}
				</button>
			{/each}
		</div>

		<!-- Fine-tune inputs (accessible path) -->
		<div class="mt-2 grid grid-cols-4 gap-1.5">
			{#each [['x', 'X', '%'], ['y', 'Y', '%'], ['w', 'W', '%'], ['h', 'H', '%']] as [key, label, unit] (key)}
				<label class="text-[10px] font-bold text-[var(--ui-text-muted)]">
					{label}
					<input
						type="number"
						min="0"
						max="100"
						step="1"
						value={Math.round(draft[key as keyof Crop] * 100)}
						oninput={(e) => {
							const pct = Number((e.currentTarget as HTMLInputElement).value);
							if (!Number.isFinite(pct)) return;
							const next = { ...draft, [key]: pct / 100 } as Crop;
							draft = constrain(next);
						}}
						class="mt-0.5 w-full rounded-md border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-1 py-0.5 text-center font-mono text-[11px] tabular-nums"
					/>
					{unit}
				</label>
			{/each}
		</div>

		<p class="mt-2 text-[10.5px] leading-snug text-[var(--ui-text-dimmed)]">
			Cropping hides the rest of the image — zoom keeps the cropped ratio (no stretching).
		</p>

		<div class="mt-3 flex items-center gap-2">
			<button
				type="button"
				onclick={resetCrop}
				title="Show the whole image again"
				class="h-9 rounded-full border border-[var(--ui-border-muted)] px-3 text-[12px] font-bold transition hover:bg-[var(--ui-bg-muted)] disabled:opacity-40"
				disabled={!hasCrop && draft.w === 1 && draft.h === 1 && draft.x === 0 && draft.y === 0}
			>
				<Icon name="i-lucide-undo-2" class="mr-1 inline size-3.5" />
				Reset
			</button>
			<button
				type="button"
				onclick={onCancel}
				class="h-9 flex-1 rounded-full border border-[var(--ui-border-muted)] text-[13px] font-bold transition hover:bg-[var(--ui-bg-muted)]"
			>
				Cancel
			</button>
			<button
				type="button"
				onclick={() =>
					onApply(
						draft.w >= 1 && draft.h >= 1 && draft.x <= 0 && draft.y <= 0 ? undefined : { ...draft }
					)}
				class="h-9 flex-1 rounded-full bg-warm-500 text-[13px] font-bold text-white transition hover:brightness-110"
			>
				<Icon name="i-lucide-check" class="mr-1 inline size-3.5" />
				Apply crop
			</button>
		</div>
	</div>
</div>
