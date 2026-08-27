<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import { BUDDY_FIGURES, type BuddyFigure } from '$lib/meme/bitz-buddy';
	import { BITZVERSE_PROPS } from '$lib/meme/bitzverse';

	/**
	 * MemeBuddyPicker — Bitz Buddy sticker drop (tp-bitcoin.md §16–17):
	 * the BitOS mascot as image layers. Each figure is a bundled SVG that
	 * rides the existing layer pipeline (movable/resizable/timed/remix-
	 * wired) — tap a face, it lands at the playhead. Pure controls: the
	 * parent owns layers via onAdd, exactly like the sticker picker.
	 */
	let {
		id,
		busy = false,
		layerCount,
		onAdd
	}: {
		id: string;
		busy?: boolean;
		/** Live image-layer count (cap feedback, badge context). */
		layerCount: number;
		onAdd: (figure: BuddyFigure, atMs: number | undefined) => void;
	} = $props();
</script>

<Popover
	{id}
	float
	placement="top-start"
	width="auto"
	label="Bitz Buddy"
	triggerClass="flex items-center gap-1 rounded-full bg-[var(--ui-bg-accented)] px-2.5 py-1 text-[11.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]"
	triggerActiveClass="bg-warm-500/15 text-warm-600"
>
	{#snippet trigger()}
		<span class="text-[13px] leading-none">🪙</span>
		Buddy
	{/snippet}
	<div class="w-64 max-w-[80vw] p-2">
		<p
			class="px-1 pb-1.5 text-[10px] font-bold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
		>
			Bitz Buddy — drop a reaction
		</p>
		<div class="grid grid-cols-4 gap-1">
			{#each BUDDY_FIGURES as figure (figure.id)}
				<button
					type="button"
					disabled={busy}
					onclick={() => onAdd(figure, undefined)}
					class="flex flex-col items-center gap-0.5 rounded-xl bg-[var(--ui-bg-accented)] p-1.5 transition hover:bg-warm-500/15 disabled:opacity-30"
					title={`${figure.label} — add as image layer`}
				>
					<img
						src={figure.src}
						alt={figure.label}
						width="36"
						height="36"
						decoding="async"
						class="size-9"
					/>
					<span class="truncate text-[9px] font-bold text-[var(--ui-text-muted)]">
						{figure.emoji}
						{figure.label}
					</span>
				</button>
			{/each}
		</div>
		<!-- Bitzverse (§14): scene props — cloud, sats, portals, monsters. -->
		<p
			class="mt-2 px-1 pb-1.5 text-[10px] font-bold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
		>
			Bitzverse — set the scene
		</p>
		<div class="grid max-h-40 grid-cols-4 gap-1 overflow-y-auto">
			{#each BITZVERSE_PROPS as prop (prop.id)}
				<button
					type="button"
					disabled={busy}
					onclick={() => onAdd(prop, undefined)}
					class="flex flex-col items-center gap-0.5 rounded-xl bg-[var(--ui-bg-accented)] p-1.5 transition hover:bg-warm-500/15 disabled:opacity-30"
					title={`${prop.label} — add as image layer`}
				>
					<img
						src={prop.src}
						alt={prop.label}
						width="36"
						height="36"
						decoding="async"
						class="size-9"
					/>
					<span class="truncate text-[9px] font-bold text-[var(--ui-text-muted)]">
						{prop.emoji}
						{prop.label}
					</span>
				</button>
			{/each}
		</div>
		<p class="px-1 pt-1.5 text-[10px] text-[var(--ui-text-dimmed)]">
			{layerCount}/6 layers — buddy figures are movable, resizable and timed like any sticker.
		</p>
	</div>
</Popover>
