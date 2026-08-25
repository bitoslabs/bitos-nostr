<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import { MEME_LOOKS } from '$lib/meme/look';
	import { MAX_IMAGE_SIZE, MIN_IMAGE_SIZE, type MemeImageOverlay } from '$lib/meme/image-overlay';

	/**
	 * MemeLayerEditor — the inspector card for the SELECTED image layer:
	 * explicit resize (size slider + fine steps) and per-layer effects
	 * (opacity, rotation, mirror flips, color look). Pure controls — the
	 * parent owns the layer state; patches flow back through `onPatch`.
	 * The stage and the canvas renderer mirror every field, so what this
	 * card shows is what exports.
	 */
	let {
		layer,
		index,
		renderSrc,
		busy = false,
		onPatch,
		onRemove
	}: {
		layer: MemeImageOverlay;
		/** 1-based display number of this layer. */
		index: number;
		/** Same-origin blob URL when bytes are held (CORS-free preview). */
		renderSrc: string | null;
		busy?: boolean;
		onPatch: (id: string, patch: Partial<MemeImageOverlay>) => void;
		onRemove: (id: string) => void;
	} = $props();

	const sizePct = $derived(Math.round(layer.size * 100));
	const opacityPct = $derived(Math.round((layer.opacity ?? 1) * 100));

	function setSize(pct: number) {
		onPatch(layer.id, {
			size: Math.min(MAX_IMAGE_SIZE, Math.max(MIN_IMAGE_SIZE, pct / 100))
		});
	}

	function nudgeRotate(delta: number) {
		const next = (((layer.rotate ?? 0) + delta + 540) % 360) - 180;
		onPatch(layer.id, { rotate: next === 0 ? undefined : next });
	}
</script>

<div
	class="rounded-xl border border-warm-500/40 bg-warm-500/[0.05] px-3.5 py-3"
	aria-label={`Image layer ${index} editor`}
>
	<div class="flex items-center justify-between gap-2">
		<p
			class="flex min-w-0 items-center gap-1.5 text-[11px] font-bold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
		>
			<Icon name="i-lucide-layers" class="size-3.5 shrink-0" />
			Layer {index}
		</p>
		<div class="flex items-center gap-1">
			<!-- Mirror flips — instant, reversible, wire-cheap. -->
			<button
				type="button"
				disabled={busy}
				onclick={() => onPatch(layer.id, { flipH: layer.flipH ? undefined : true })}
				aria-pressed={layer.flipH === true}
				title="Flip horizontally"
				class="grid size-6 place-items-center rounded-full transition {layer.flipH
					? 'bg-warm-500/15 text-warm-600'
					: 'text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]'} disabled:opacity-40"
			>
				<Icon name="i-lucide-flip-horizontal-2" class="size-3.5" />
			</button>
			<button
				type="button"
				disabled={busy}
				onclick={() => onPatch(layer.id, { flipV: layer.flipV ? undefined : true })}
				aria-pressed={layer.flipV === true}
				title="Flip vertically"
				class="grid size-6 place-items-center rounded-full transition {layer.flipV
					? 'bg-warm-500/15 text-warm-600'
					: 'text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]'} disabled:opacity-40"
			>
				<Icon name="i-lucide-flip-vertical-2" class="size-3.5" />
			</button>
			<button
				type="button"
				disabled={busy}
				onclick={() => onRemove(layer.id)}
				aria-label={`Remove layer ${index}`}
				title="Remove this layer"
				class="grid size-6 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--tone-error-text)]/10 hover:text-[var(--tone-error-text)] disabled:opacity-40"
			>
				<Icon name="i-lucide-x" class="size-3.5" />
			</button>
		</div>
	</div>

	<div class="mt-1.5 flex items-center gap-2.5">
		<span class="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-black/40">
			{#if renderSrc}
				<img src={renderSrc} alt="" class="max-h-full max-w-full" />
			{:else}
				<Icon name="i-lucide-image" class="size-4 text-white/60" />
			{/if}
		</span>

		<!-- Resize: slider + fine steps (the corner handle stays for direct
		     manipulation — this is the precise, accessible path). -->
		<label
			class="flex min-w-0 flex-1 items-center gap-2 text-[10.5px] font-bold text-[var(--ui-text-muted)]"
		>
			Size
			<input
				type="range"
				min={Math.round(MIN_IMAGE_SIZE * 100)}
				max={Math.round(MAX_IMAGE_SIZE * 100)}
				step="1"
				value={sizePct}
				disabled={busy}
				oninput={(e) => setSize(Number((e.currentTarget as HTMLInputElement).value))}
				aria-label="Layer size percent of stage height"
				class="h-1.5 min-w-0 flex-1 accent-warm-500"
			/>
			<span class="w-9 shrink-0 text-right font-mono tabular-nums">{sizePct}%</span>
		</label>
		<div class="flex shrink-0 items-center gap-0.5">
			<button
				type="button"
				disabled={busy}
				onclick={() => setSize(sizePct - 5)}
				aria-label="Shrink layer 5 percent"
				class="grid size-5 place-items-center rounded-full text-[var(--ui-text-dimmed)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-40"
			>
				<Icon name="i-lucide-minus" class="size-3" />
			</button>
			<button
				type="button"
				disabled={busy}
				onclick={() => setSize(sizePct + 5)}
				aria-label="Grow layer 5 percent"
				class="grid size-5 place-items-center rounded-full text-[var(--ui-text-dimmed)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-40"
			>
				<Icon name="i-lucide-plus" class="size-3" />
			</button>
		</div>
	</div>

	<!-- Opacity -->
	<label
		class="mt-2 flex min-w-0 items-center gap-2 text-[10.5px] font-bold text-[var(--ui-text-muted)]"
	>
		Opacity
		<input
			type="range"
			min="10"
			max="100"
			step="5"
			value={opacityPct}
			disabled={busy}
			oninput={(e) => {
				const pct = Number((e.currentTarget as HTMLInputElement).value);
				onPatch(layer.id, { opacity: pct >= 100 ? undefined : pct / 100 });
			}}
			aria-label="Layer opacity percent"
			class="h-1.5 min-w-0 flex-1 accent-warm-500"
		/>
		<span class="w-9 shrink-0 text-right font-mono tabular-nums">{opacityPct}%</span>
	</label>

	<!-- Rotation: 90° steps + free angle slider -->
	<div class="mt-2 flex items-center gap-2">
		<span class="text-[10.5px] font-bold text-[var(--ui-text-muted)]">Rotate</span>
		<div class="flex items-center gap-0.5">
			<button
				type="button"
				disabled={busy}
				onclick={() => nudgeRotate(-90)}
				title="Rotate 90° left"
				class="grid size-6 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-40"
			>
				<Icon name="i-lucide-rotate-ccw" class="size-3.5" />
			</button>
			<button
				type="button"
				disabled={busy}
				onclick={() => nudgeRotate(90)}
				title="Rotate 90° right"
				class="grid size-6 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-40"
			>
				<Icon name="i-lucide-rotate-cw" class="size-3.5" />
			</button>
		</div>
		<input
			type="range"
			min="-180"
			max="180"
			step="5"
			value={layer.rotate ?? 0}
			disabled={busy}
			oninput={(e) => {
				const deg = Number((e.currentTarget as HTMLInputElement).value);
				onPatch(layer.id, { rotate: deg === 0 ? undefined : deg });
			}}
			aria-label="Layer rotation degrees"
			class="h-1.5 min-w-0 flex-1 accent-warm-500"
		/>
		<button
			type="button"
			disabled={busy || !layer.rotate}
			onclick={() => onPatch(layer.id, { rotate: undefined })}
			title="Reset rotation"
			class="grid size-5 shrink-0 place-items-center rounded-full text-[var(--ui-text-dimmed)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-30"
		>
			<Icon name="i-lucide-undo-2" class="size-3" />
		</button>
	</div>

	<!-- Per-layer look: same presets the base media uses, scoped to the layer. -->
	<div class="mt-2 flex flex-wrap items-center gap-1">
		<span class="mr-0.5 text-[10.5px] font-bold text-[var(--ui-text-muted)]">Look</span>
		{#each MEME_LOOKS as look (look.id)}
			<button
				type="button"
				disabled={busy}
				onclick={() => onPatch(layer.id, { lookId: look.id === 'none' ? undefined : look.id })}
				aria-pressed={(layer.lookId ?? 'none') === look.id}
				title={look.label}
				class="rounded-full px-2 py-0.5 text-[10.5px] font-bold transition {(layer.lookId ??
					'none') === look.id
					? 'bg-warm-500 text-white'
					: 'bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]'} disabled:opacity-40"
			>
				{look.label}
			</button>
		{/each}
	</div>
</div>
