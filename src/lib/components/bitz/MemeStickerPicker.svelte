<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import MemeMediaHubDialog from '$lib/components/bitz/MemeMediaHubDialog.svelte';
	import type { NostrEmoji } from '$lib/meme/emoji-packs';
	import type { GifChoice } from '$lib/components/feed/GifPicker.svelte';

	/**
	 * MemeStickerPicker — the studio's sticker trigger. One button, one dialog:
	 * the old popover tab-juggling (emoji / packs / svg) plus GIF mass-picking
	 * and the pack builder now live together in MemeMediaHubDialog.
	 */
	let {
		onAdd,
		onPickCustom,
		onPickSvg,
		onPickGif,
		onAddGifs,
		onBrowse,
		layerSlots = 6,
		triggerClass = 'flex items-center gap-1 rounded-full bg-[var(--ui-bg-accented)] px-2.5 py-1 text-[11.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]'
	}: {
		/** Glyph emoji pick → text-overlay sticker. */
		onAdd: (emoji: string) => void;
		/** Custom (kind-30030) emoji pick — becomes an image layer. */
		onPickCustom?: (emoji: NostrEmoji) => void;
		/** SVG catalog pick — fetched and rasterized into an image layer. */
		onPickSvg?: (icon: { name: string; url: string }) => void;
		/** GIF/sticker pick — becomes an image layer. */
		onPickGif?: (gif: GifChoice) => void;
		/** Multi-pick confirm — staggered image layers (mass production). */
		onAddGifs?: (gifs: GifChoice[]) => void;
		/** Open the host's file picker (image/GIF layers). */
		onBrowse?: () => void;
		/** Remaining image-layer slots. */
		layerSlots?: number;
		/** Style hook for hosts with a different toolbar look. */
		triggerClass?: string;
	} = $props();

	let hubOpen = $state(false);
</script>

<button
	type="button"
	onclick={() => (hubOpen = true)}
	class={triggerClass}
	title="Stickers, GIFs, emoji packs — one dialog"
>
	<Icon name="i-lucide-smile-plus" class="size-3.5" />
	Stickers
</button>

<MemeMediaHubDialog
	bind:open={hubOpen}
	{onAdd}
	{onPickCustom}
	{onPickSvg}
	{onPickGif}
	{onAddGifs}
	{onBrowse}
	{layerSlots}
/>
