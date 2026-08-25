<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import {
		ARTBOARDS,
		BLANK_CANVAS_COLORS as SWATCHES,
		type MemeArtboardId
	} from './meme-studio-config';

	/**
	 * MemeArtboardCard — the output canvas controls: size presets (Source /
	 * 9:16 / 16:9 / 1:1 / 4:5 with a live pixel readout), background color
	 * (swatches + custom picker → blank-canvas swap), and crop & zoom framing
	 * of the base media (zoom + pan + reset). Pure controls — the parent owns
	 * every value; patches flow back through callbacks. (Extracted from
	 * MemeStudio — SRP split.)
	 */
	let {
		artboardId,
		width,
		height,
		customWidth,
		customHeight,
		busy = false,
		staging = false,
		blankBg = null,
		zoom = 1,
		panX = 0,
		panY = 0,
		onArtboard,
		onCustomSize,
		onBackground,
		onFraming
	}: {
		artboardId: string;
		width: number;
		height: number;
		customWidth: number;
		customHeight: number;
		busy?: boolean;
		/** Base-media staging (bg swap / source load) disables the controls. */
		staging?: boolean;
		/** Active blank-canvas color for the swatch highlight. */
		blankBg?: string | null;
		zoom?: number;
		panX?: number;
		panY?: number;
		onArtboard: (id: MemeArtboardId) => void;
		onCustomSize: (width: number, height: number) => void;
		onBackground: (color: string) => void;
		/** Patch the framing (any subset of zoom / panX / panY; reset via zoom 1). */
		onFraming: (patch: { zoom?: number; panX?: number; panY?: number }) => void;
	} = $props();

	const framingActive = $derived(zoom !== 1 || panX !== 0 || panY !== 0);
	const CUSTOM_MIN = 160;
	const CUSTOM_MAX = 3840;
	function setCustomSize(widthValue: number, heightValue: number) {
		const w = Math.round(Math.max(CUSTOM_MIN, Math.min(CUSTOM_MAX, widthValue)));
		const h = Math.round(Math.max(CUSTOM_MIN, Math.min(CUSTOM_MAX, heightValue)));
		onCustomSize(w, h);
	}
	/** Keep the common aspect-ratio choices compact; background and framing are
	 * available on demand and automatically revealed when either is active. */
	let customizeOpen = $state(false);
	$effect(() => {
		if (blankBg || framingActive) customizeOpen = true;
	});
</script>

<div
	class="rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-border-muted)] px-3.5 py-3"
>
	<div class="flex items-center justify-between gap-2">
		<p
			class="flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
		>
			<Icon name="i-lucide-frame" class="size-3.5" />
			Artboard
		</p>
		<p class="font-mono text-[11px] font-bold text-warm-600 tabular-nums">
			{width}×{height}
		</p>
	</div>
	<div class="mt-2 flex flex-wrap items-center gap-1.5">
		{#each ARTBOARDS as ab (ab.id)}
			<button
				type="button"
				disabled={busy}
				onclick={() => onArtboard(ab.id)}
				aria-pressed={artboardId === ab.id}
				title={ab.hint}
				class="h-7 rounded-full px-2.5 font-mono text-[11px] font-bold tabular-nums transition {artboardId ===
				ab.id
					? 'bg-warm-500 text-white'
					: 'bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]'} disabled:opacity-40"
			>
				{ab.label}
			</button>
		{/each}
		<button
			type="button"
			disabled={busy}
			onclick={() => onArtboard('custom')}
			aria-pressed={artboardId === 'custom'}
			title="Set a custom output size"
			class="h-7 rounded-full px-2.5 font-mono text-[11px] font-bold transition {artboardId ===
			'custom'
				? 'bg-warm-500 text-white'
				: 'bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]'} disabled:opacity-40"
		>
			Custom
		</button>
	</div>
	{#if artboardId === 'custom'}
		<div class="mt-2 flex flex-wrap items-center gap-1.5 rounded-lg bg-[var(--ui-bg-accented)] p-2">
			<span class="text-[10.5px] font-bold text-[var(--ui-text-muted)]">Custom size</span>
			<input
				type="number"
				min={CUSTOM_MIN}
				max={CUSTOM_MAX}
				value={customWidth}
				disabled={busy}
				aria-label="Custom artboard width in pixels"
				onchange={(e) =>
					setCustomSize(Number((e.currentTarget as HTMLInputElement).value), customHeight)}
				class="h-7 w-18 rounded-md border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-1.5 text-center font-mono text-[11px] outline-none focus:border-warm-500"
			/>
			<span class="text-[var(--ui-text-dimmed)]">×</span>
			<input
				type="number"
				min={CUSTOM_MIN}
				max={CUSTOM_MAX}
				value={customHeight}
				disabled={busy}
				aria-label="Custom artboard height in pixels"
				onchange={(e) =>
					setCustomSize(customWidth, Number((e.currentTarget as HTMLInputElement).value))}
				class="h-7 w-18 rounded-md border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-1.5 text-center font-mono text-[11px] outline-none focus:border-warm-500"
			/>
			<span class="text-[10px] text-[var(--ui-text-dimmed)]">px · {CUSTOM_MIN}–{CUSTOM_MAX}</span>
		</div>
	{/if}
	<div class="mt-2 flex items-center justify-between gap-2">
		{#if artboardId !== 'source'}
			<p class="min-w-0 text-[10.5px] leading-snug text-[var(--ui-text-dimmed)]">
				Media cover-fits the {artboardId} canvas.
			</p>
		{:else}
			<p class="text-[10.5px] text-[var(--ui-text-dimmed)]">Keeps the source dimensions.</p>
		{/if}
		<button
			type="button"
			disabled={busy}
			onclick={() => (customizeOpen = !customizeOpen)}
			aria-expanded={customizeOpen}
			class="flex shrink-0 items-center gap-1 rounded-full bg-[var(--ui-bg-accented)] px-2.5 py-1 text-[10.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-warm-500/10 hover:text-warm-600 disabled:opacity-40"
		>
			<Icon
				name={customizeOpen ? 'i-lucide-chevron-up' : 'i-lucide-sliders-horizontal'}
				class="size-3"
			/>
			{customizeOpen ? 'Hide' : 'Customize'}
		</button>
	</div>

	{#if customizeOpen}
		<!-- Background: swap the base media to a solid-color canvas at the
	     artboard's size. Swatches + a native custom color picker;
	     captions/layers/sounds survive the swap. -->
		<div class="mt-2 flex flex-wrap items-center gap-1.5">
			<span class="text-[10.5px] font-bold text-[var(--ui-text-muted)]">Bg</span>
			{#each SWATCHES as color (color)}
				<button
					type="button"
					disabled={busy || staging}
					aria-label={`Set the background to ${color}`}
					title={color}
					onclick={() => onBackground(color)}
					class="size-6 rounded-full border transition hover:scale-110 active:scale-95 {blankBg ===
					color
						? 'ring-2 ring-warm-500 ring-offset-1'
						: ''} border-black/10 disabled:opacity-40 dark:border-white/20"
					style="background:{color};"
				></button>
			{/each}
			<label
				class="relative grid size-6 cursor-pointer place-items-center overflow-hidden rounded-full border border-dashed transition hover:scale-110 {blankBg &&
				!SWATCHES.includes(blankBg)
					? 'border-warm-500 ring-2 ring-warm-500 ring-offset-1'
					: 'border-[var(--ui-border-accented)]'}"
				title="Custom background color"
				style={blankBg && !SWATCHES.includes(blankBg) ? `background:${blankBg};` : ''}
			>
				{#if !(blankBg && !SWATCHES.includes(blankBg))}
					<Icon name="i-lucide-pipette" class="size-3 text-[var(--ui-text-muted)]" />
				{/if}
				<input
					type="color"
					class="absolute inset-0 size-full cursor-pointer opacity-0"
					aria-label="Custom background color"
					disabled={busy || staging}
					oninput={(e) => {
						const color = (e.currentTarget as HTMLInputElement).value;
						if (/^#[0-9a-f]{6}$/i.test(color)) onBackground(color);
					}}
				/>
			</label>
		</div>
		<p class="mt-1.5 text-[10px] leading-snug text-[var(--ui-text-dimmed)]">
			A color replaces the media with a blank canvas — captions, layers and sounds stay.
		</p>

		<!-- Crop & zoom: frame the base media inside the artboard. Zoom ≥1
	     magnifies the cover fit; pan travels the overflow; captions and
	     layers stay fixed to the artboard. -->
		<div class="mt-2.5 border-t border-[var(--ui-border-muted)] pt-2">
			<div class="flex items-center justify-between gap-2">
				<span class="text-[10.5px] font-bold text-[var(--ui-text-muted)]">
					<Icon name="i-lucide-crop" class="mr-0.5 inline size-3" />
					Crop &amp; zoom
				</span>
				<button
					type="button"
					disabled={busy || !framingActive}
					onclick={() => onFraming({ zoom: 1, panX: 0, panY: 0 })}
					title="Reset the framing"
					class="rounded-full px-2 py-0.5 text-[10px] font-bold text-[var(--ui-text-dimmed)] transition hover:text-[var(--ui-text)] disabled:opacity-30"
				>
					<Icon name="i-lucide-undo-2" class="mr-0.5 inline size-3" />
					Reset
				</button>
			</div>
			<label
				class="mt-1.5 flex min-w-0 items-center gap-2 text-[10.5px] font-bold text-[var(--ui-text-muted)]"
			>
				Zoom
				<input
					type="range"
					min="100"
					max="400"
					step="5"
					value={Math.round(zoom * 100)}
					disabled={busy}
					oninput={(e) =>
						onFraming({ zoom: Number((e.currentTarget as HTMLInputElement).value) / 100 })}
					aria-label="Media zoom percent"
					class="h-1.5 min-w-0 flex-1 accent-warm-500"
				/>
				<span class="w-9 shrink-0 text-right font-mono tabular-nums">{Math.round(zoom * 100)}%</span
				>
			</label>
			<label
				class="mt-1.5 flex min-w-0 items-center gap-2 text-[10.5px] font-bold text-[var(--ui-text-muted)]"
			>
				X
				<input
					type="range"
					min="-100"
					max="100"
					step="5"
					value={Math.round(panX * 100)}
					disabled={busy}
					oninput={(e) =>
						onFraming({ panX: Number((e.currentTarget as HTMLInputElement).value) / 100 })}
					aria-label="Media horizontal pan"
					class="h-1.5 min-w-0 flex-1 accent-warm-500"
				/>
				<span class="w-9 shrink-0 text-right font-mono tabular-nums"
					>{panX > 0 ? '+' : ''}{Math.round(panX * 100)}</span
				>
			</label>
			<label
				class="mt-1.5 flex min-w-0 items-center gap-2 text-[10.5px] font-bold text-[var(--ui-text-muted)]"
			>
				Y
				<input
					type="range"
					min="-100"
					max="100"
					step="5"
					value={Math.round(panY * 100)}
					disabled={busy}
					oninput={(e) =>
						onFraming({ panY: Number((e.currentTarget as HTMLInputElement).value) / 100 })}
					aria-label="Media vertical pan"
					class="h-1.5 min-w-0 flex-1 accent-warm-500"
				/>
				<span class="w-9 shrink-0 text-right font-mono tabular-nums"
					>{panY > 0 ? '+' : ''}{Math.round(panY * 100)}</span
				>
			</label>
		</div>
	{/if}
</div>
