<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import GifPicker, { type GifChoice } from '$lib/components/feed/GifPicker.svelte';
	import { MAX_IMAGE_OVERLAYS, type MemeImageOverlay } from '$lib/meme/image-overlay';
	import { formatDuration } from '$lib/utils/format';

	let {
		id,
		layers,
		showUrlForm = $bindable(false),
		url = $bindable(''),
		mediaKind,
		timelineActive,
		stageSeconds,
		loading,
		urlBusy,
		onBrowse,
		onInsertFrame,
		onAddUrl,
		onAddGif
	}: {
		id: string;
		layers: MemeImageOverlay[];
		showUrlForm: boolean;
		url: string;
		mediaKind: 'image' | 'video' | null;
		timelineActive: boolean;
		stageSeconds: number;
		loading: boolean;
		urlBusy: boolean;
		onBrowse: () => void;
		onInsertFrame: () => void;
		onAddUrl: () => void;
		onAddGif: (gif: GifChoice, atMs?: number) => void;
	} = $props();
</script>

<Popover
	{id}
	float
	placement="top-start"
	width="auto"
	label="Add an image layer"
	triggerClass="flex items-center gap-1 rounded-full bg-[var(--ui-bg-accented)] px-2.5 py-1 text-[11.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]"
	triggerActiveClass="bg-warm-500/15 text-warm-600"
>
	{#snippet trigger()}
		<Icon name="i-lucide-image-plus" class="size-3.5" />
		Image
		{#if loading}
			<Icon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
		{/if}
	{/snippet}
	<div class="w-auto max-w-[100vw] p-2">
		<div class="flex items-center gap-1">
			<button
				type="button"
				onclick={onBrowse}
				disabled={loading}
				class="flex flex-1 items-center gap-1.5 rounded-lg bg-[var(--ui-bg-accented)] px-2.5 py-2 text-[11.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-50"
			>
				<Icon name="i-lucide-upload" class="size-3.5" />
				Upload file
			</button>
			<button
				type="button"
				onclick={(e) => {
					// keep the popover open — the global click-close would eat it
					e.stopPropagation();
					showUrlForm = !showUrlForm;
				}}
				disabled={loading}
				class="flex flex-1 items-center gap-1.5 rounded-lg bg-[var(--ui-bg-accented)] px-2.5 py-2 text-[11.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-50"
			>
				<Icon name="i-lucide-link" class="size-3.5" />
				URL
			</button>
		</div>
		<!-- Insert another source from the stage itself: grab the current video
								     frame at the playhead and drop it in as a movable layer. -->
		{#if mediaKind === 'video'}
			<button
				type="button"
				onclick={() => void onInsertFrame()}
				disabled={loading}
				title="Grab the frame at the playhead and add it as a movable image layer"
				class="mt-1.5 flex w-full items-center gap-1.5 rounded-lg bg-warm-500/10 px-2.5 py-2 text-[11.5px] font-bold text-warm-600 transition hover:bg-warm-500/20 disabled:opacity-50"
			>
				<Icon
					name={loading ? 'i-lucide-loader-circle' : 'i-lucide-image-up'}
					class="size-3.5 {loading ? 'animate-spin' : ''}"
				/>
				Frame from video @ {formatDuration(stageSeconds)}
			</button>
		{/if}
		{#if showUrlForm}
			<!-- keydown-Enter (not a <form> submit) — popover panels unmount
										     on the global click-close before deferred submits fire. -->
			<div class="mt-1.5 flex items-center gap-1">
				<input
					type="url"
					inputmode="url"
					bind:value={url}
					placeholder="https://…/sticker.png"
					class="h-8 min-w-0 flex-1 rounded-full border border-[var(--ui-border-muted)] bg-transparent px-3 text-[11.5px] outline-none placeholder:text-[var(--ui-text-dimmed)] focus:border-warm-500"
					disabled={urlBusy}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							void onAddUrl();
						}
					}}
				/>
				<button
					type="button"
					class="flex h-8 shrink-0 items-center gap-1 rounded-full bg-warm-500/10 px-3 text-[11px] font-bold text-warm-600 transition hover:bg-warm-500/20 disabled:opacity-50"
					disabled={urlBusy || !url.trim()}
					onclick={() => void onAddUrl()}
				>
					<Icon
						name={urlBusy ? 'i-lucide-loader-circle' : 'i-lucide-check'}
						class="size-3 {urlBusy ? 'animate-spin' : ''}"
					/>
				</button>
			</div>
		{/if}
		<p class="mt-1.5 flex items-center gap-1 px-0.5 text-[10.5px] text-[var(--ui-text-dimmed)]">
			<Icon name="i-lucide-sticker" class="size-3" />
			pick GIFs or transparent stickers — SVG files convert automatically
		</p>
		<!-- Multi-select for mass production: tap several stickers,
									     confirm once — each lands as a layer with a 2s window at
									     the playhead, staggered 250ms apart. -->
		<GifPicker
			multiple
			max={Math.max(1, MAX_IMAGE_OVERLAYS - layers.length)}
			onpick={(g) => void onAddGif(g)}
			onbrowse={onBrowse}
			onpickmany={(gifs) => {
				const base = Math.round(stageSeconds * 1000);
				for (let i = 0; i < gifs.length; i++) {
					void onAddGif(gifs[i]!, timelineActive ? base + i * 250 : undefined);
				}
			}}
		/>
	</div>
</Popover>
