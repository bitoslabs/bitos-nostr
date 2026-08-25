<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import MemeLayerEditor from './MemeLayerEditor.svelte';
	import { MAX_IMAGE_OVERLAYS, type MemeImageOverlay } from '$lib/meme/image-overlay';

	/**
	 * MemeImageLayersCard — the RIGHT-PANEL home for every image layer
	 * (2026-08-25 UX merge): the list (select, z-order, timing, replace,
	 * remove) and the SELECTED layer's editor live in ONE widget. Before,
	 * the list floated in a toolbar popover over the stage while the editor
	 * sat in this panel — two competing surfaces for the same selection.
	 * Adding stays in the left rail popover; everything that edits an
	 * EXISTING layer lives here.
	 */
	let {
		layers,
		selectedLayerId = $bindable(null),
		timingId = $bindable(null),
		bitmaps,
		renderSrcs,
		mediaKind,
		timelineActive,
		busy,
		loading = false,
		onAdd,
		onMove,
		onPatch,
		onRemove,
		onReplace,
		onDuplicate
	}: {
		layers: MemeImageOverlay[];
		selectedLayerId: string | null;
		timingId: string | null;
		/** Decoded-bitmap cache (drives thumbnails + loaded state). */
		bitmaps: { has(key: string): boolean };
		/** Same-origin render srcs per layer src. */
		renderSrcs: Map<string, string>;
		mediaKind: 'image' | 'video' | null;
		timelineActive: boolean;
		busy: boolean;
		loading?: boolean;
		/** Open the left-rail add-image popover / file picker. */
		onAdd: () => void;
		onMove: (id: string, direction: -1 | 1) => void;
		onPatch: (id: string, patch: Partial<MemeImageOverlay>) => void;
		onRemove: (id: string) => void;
		onReplace: (id: string) => void;
		onDuplicate: (id: string) => void;
	} = $props();

	const selectedLayer = $derived(layers.find((l) => l.id === selectedLayerId) ?? null);
	const selectedIndex = $derived(layers.findIndex((l) => l.id === selectedLayerId) + 1);
	const selectedRenderSrc = $derived(
		selectedLayer ? (renderSrcs.get(selectedLayer.src) ?? null) : null
	);
</script>

<div
	class="rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-3 py-2.5"
	aria-label="Image layers"
>
	<div class="flex items-center justify-between gap-2">
		<p
			class="flex min-w-0 items-center gap-1.5 text-[11px] font-bold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
		>
			<Icon name="i-lucide-layers" class="size-3.5 shrink-0" />
			Image layers
			<span class="font-mono tracking-normal">
				{layers.length}/{MAX_IMAGE_OVERLAYS}
			</span>
			{#if loading}
				<Icon name="i-lucide-loader-circle" class="size-3 animate-spin text-warm-500" />
			{/if}
		</p>
		<button
			type="button"
			onclick={onAdd}
			disabled={busy || layers.length >= MAX_IMAGE_OVERLAYS}
			title="Add an image layer"
			class="flex h-6.5 shrink-0 items-center gap-1 rounded-full bg-warm-500/10 px-2.5 text-[10.5px] font-bold text-warm-600 transition hover:bg-warm-500/20 disabled:opacity-40"
		>
			<Icon name="i-lucide-plus" class="size-3" />
			Add
		</button>
	</div>

	{#if !layers.length}
		<button
			type="button"
			onclick={onAdd}
			disabled={busy}
			class="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--ui-border-accented)] px-2 py-3 text-[11px] font-semibold text-[var(--ui-text-dimmed)] transition hover:border-warm-500/50 hover:bg-warm-500/5 hover:text-warm-600 disabled:opacity-40"
		>
			<Icon name="i-lucide-image-plus" class="size-4" />
			Drop a PNG, GIF, WebP or SVG sticker onto the meme
		</button>
	{/if}

	<div class="mt-1.5 flex flex-col gap-0.5">
		{#each layers as layer, li (layer.id)}
			{@const isSelected = selectedLayerId === layer.id}
			<div
				class="rounded-lg transition {isSelected
					? 'bg-warm-500/15'
					: 'hover:bg-[var(--ui-bg-muted)]'}"
			>
				<div class="flex items-center gap-1.5 px-1 py-1">
					<button
						type="button"
						onclick={() => {
							selectedLayerId = isSelected ? null : layer.id;
							timingId = null;
						}}
						aria-pressed={isSelected}
						aria-label={`Select image layer ${li + 1}`}
						class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
					>
						<span
							class="grid size-7 shrink-0 place-items-center overflow-hidden rounded-md bg-black/40"
						>
							{#if bitmaps.has(layer.src)}
								<img
									src={renderSrcs.get(layer.src) ?? layer.src}
									alt=""
									class="max-h-full max-w-full"
								/>
							{:else}
								<Icon name="i-lucide-image" class="size-3.5 text-white/60" />
							{/if}
						</span>
						<span class="truncate text-[11px] font-semibold text-[var(--ui-text)]">
							Layer {li + 1}
						</span>
					</button>
					<!-- Z-order: later layers paint on top. -->
					<button
						type="button"
						onclick={() => onMove(layer.id, 1)}
						disabled={busy || li === layers.length - 1}
						aria-label={`Bring layer ${li + 1} forward`}
						title="Bring forward (on top)"
						class="grid size-5 place-items-center rounded-full text-[var(--ui-text-dimmed)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-30"
					>
						<Icon name="i-lucide-chevron-up" class="size-3" />
					</button>
					<button
						type="button"
						onclick={() => onMove(layer.id, -1)}
						disabled={busy || li === 0}
						aria-label={`Send layer ${li + 1} backward`}
						title="Send backward (behind)"
						class="grid size-5 place-items-center rounded-full text-[var(--ui-text-dimmed)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-30"
					>
						<Icon name="i-lucide-chevron-down" class="size-3" />
					</button>
					{#if timelineActive}
						<button
							type="button"
							onclick={() => (timingId = timingId === layer.id ? null : layer.id)}
							disabled={busy}
							aria-expanded={timingId === layer.id}
							title="Show this layer only during part of the timeline"
							class="shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[9.5px] font-bold transition {timingId ===
								layer.id ||
							layer.startMs !== undefined ||
							layer.endMs !== undefined
								? 'bg-emerald-500/15 text-emerald-600'
								: 'text-[var(--ui-text-dimmed)] hover:text-[var(--ui-text)]'}"
						>
							{layer.startMs !== undefined || layer.endMs !== undefined
								? `${((layer.startMs ?? 0) / 1000).toFixed(1)}–${layer.endMs !== undefined ? (layer.endMs / 1000).toFixed(1) : '∞'}s`
								: 'always'}
						</button>
					{/if}
					<!-- Replace image in place: keeps position, size, timing, look. -->
					<button
						type="button"
						onclick={() => onReplace(layer.id)}
						aria-label={`Replace layer ${li + 1} image`}
						title="Replace this layer's image (keeps position + timing)"
						class="grid size-6 place-items-center rounded-full text-[var(--ui-text-dimmed)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]"
					>
						<Icon name="i-lucide-image-up" class="size-3.5" />
					</button>
					<button
						type="button"
						onclick={() => onRemove(layer.id)}
						aria-label={`Remove layer ${li + 1}`}
						class="grid size-6 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--tone-error-text)]"
					>
						<Icon name="i-lucide-x" class="size-3.5" />
					</button>
				</div>

				{#if timelineActive && timingId === layer.id}
					<div
						class="mb-1 flex flex-wrap items-center gap-2 rounded-lg bg-[var(--ui-bg-accented)] px-2.5 py-2"
					>
						<label
							class="flex items-center gap-1.5 text-[10.5px] font-bold text-[var(--ui-text-muted)]"
						>
							Show from
							<input
								type="number"
								min="0"
								step="0.1"
								value={((layer.startMs ?? 0) / 1000).toFixed(1)}
								oninput={(e) => {
									const seconds = Number((e.currentTarget as HTMLInputElement).value);
									onPatch(layer.id, {
										startMs:
											Number.isFinite(seconds) && seconds > 0
												? Math.round(seconds * 1000)
												: undefined
									});
								}}
								class="w-16 rounded-md border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-1.5 py-0.5 text-center font-mono text-[11px] tabular-nums"
							/>
							s
						</label>
						<label
							class="flex items-center gap-1.5 text-[10.5px] font-bold text-[var(--ui-text-muted)]"
						>
							until
							<input
								type="number"
								min="0"
								step="0.1"
								value={layer.endMs !== undefined ? (layer.endMs / 1000).toFixed(1) : ''}
								placeholder="end"
								oninput={(e) => {
									const raw = (e.currentTarget as HTMLInputElement).value;
									const seconds = Number(raw);
									onPatch(layer.id, {
										endMs:
											raw !== '' && Number.isFinite(seconds) && seconds > 0
												? Math.round(seconds * 1000)
												: undefined
									});
								}}
								class="w-16 rounded-md border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-1.5 py-0.5 text-center font-mono text-[11px] tabular-nums"
							/>
							s
						</label>
						<button
							type="button"
							onclick={() => onPatch(layer.id, { startMs: undefined, endMs: undefined })}
							class="ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold text-[var(--ui-text-muted)] transition hover:text-[var(--ui-text)]"
						>
							Always visible
						</button>
					</div>
				{/if}

				{#if isSelected && selectedLayer}
					<!-- The selected layer's editor opens INLINE under its row —
					     list + editor are one surface, one selection state. -->
					<div class="px-0.5 pb-1">
						{#key selectedLayer.id}
							<MemeLayerEditor
								layer={selectedLayer}
								index={selectedIndex}
								renderSrc={selectedRenderSrc}
								{busy}
								{onPatch}
								{onDuplicate}
							/>
						{/key}
					</div>
				{/if}
			</div>
		{/each}
	</div>
</div>
