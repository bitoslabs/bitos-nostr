<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import GifPicker, { type GifChoice } from '$lib/components/feed/GifPicker.svelte';
	import MemeSourceLibrary from '$lib/components/bitz/MemeSourceLibrary.svelte';
	import MemeStudioDropZone, {
		type MemeMediaFormat
	} from '$lib/components/bitz/MemeStudioDropZone.svelte';
	import type { MediaSource } from '$lib/stores/media-library.svelte';
	import { BLANK_CANVAS_COLORS, PICK_FORMATS } from './meme-studio-config';

	let {
		remixLabel = '',
		remixing = false,
		staging = false,
		busy = false,
		gifPickerId,
		blankPickerId,
		sourceLibraryId,
		showUrl = $bindable(false),
		url = $bindable(''),
		urlBusy = false,
		onChooseMedia,
		onChooseFormat,
		onDropFile,
		onPickGif,
		onPickGifs,
		onBlank,
		onSubmitUrl,
		onOpenSource,
		onAddSourceLayer
	}: {
		remixLabel?: string;
		remixing?: boolean;
		staging?: boolean;
		busy?: boolean;
		gifPickerId: string;
		blankPickerId: string;
		sourceLibraryId: string;
		showUrl?: boolean;
		url?: string;
		urlBusy?: boolean;
		onChooseMedia: () => void;
		onChooseFormat: (format: MemeMediaFormat) => void | Promise<void>;
		onDropFile: (file: File | null) => void;
		onPickGif: (gif: GifChoice) => void | Promise<void>;
		onPickGifs: (gifs: GifChoice[]) => void | Promise<void>;
		onBlank: (color: string) => void;
		onSubmitUrl: () => void | Promise<void>;
		onOpenSource: (source: MediaSource) => void;
		onAddSourceLayer: (source: MediaSource) => void;
	} = $props();
</script>

<div class="flex min-h-[420px] flex-col items-center justify-center p-6">
	{#if remixing}
		<div
			class="mb-4 flex w-full max-w-sm items-center gap-3 rounded-2xl border border-warm-500/30 bg-warm-500/10 px-4 py-3"
		>
			<span class="grid size-9 shrink-0 place-items-center rounded-xl bg-warm-500/15 text-warm-500">
				<Icon name="i-lucide-repeat" class="size-5" />
			</span>
			<div class="min-w-0">
				<p class="text-[13.5px] font-bold text-[var(--ui-text-highlighted)]">
					Remixing “{remixLabel}”
				</p>
				<p class="text-[12px] leading-relaxed text-[var(--ui-text-muted)]">
					Loading the source clip + applying its captions &amp; sounds…
				</p>
			</div>
		</div>
	{/if}
	<MemeStudioDropZone formats={PICK_FORMATS} {onChooseMedia} {onChooseFormat} {onDropFile} />
	<div class="mt-3 flex w-full max-w-sm flex-wrap items-center justify-center gap-1.5">
		<Popover
			id={gifPickerId}
			float
			placement="top-start"
			width="auto"
			class="w-72 max-w-[80vw] p-0 sm:w-80"
			label="Pick a GIF from the library"
			triggerClass="flex items-center gap-1 rounded-full bg-warm-500/10 px-3 py-1.5 text-[11.5px] font-bold text-warm-600 transition hover:bg-warm-500/20"
			triggerActiveClass="bg-warm-500/20"
		>
			{#snippet trigger()}
				<Icon name="i-lucide-film" class="size-3.5" />
				GIF library
				{#if staging}
					<Icon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
				{/if}
			{/snippet}
			<GifPicker multiple max={6} onpick={onPickGif} onpickmany={onPickGifs} />
		</Popover>
		<Popover
			id={blankPickerId}
			float
			placement="top-start"
			width="auto"
			label="Start from a blank canvas"
			triggerClass="flex items-center gap-1 rounded-full px-3 py-1.5 text-[11.5px] font-semibold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg)] hover:text-[var(--ui-text)]"
		>
			{#snippet trigger()}
				<Icon name="i-lucide-square-plus" class="size-3.5" />
				Blank canvas
			{/snippet}
			<div class="flex items-center gap-1.5 p-1.5">
				{#each BLANK_CANVAS_COLORS as color (color)}
					<button
						type="button"
						aria-label={`Start a blank ${color} canvas`}
						title={color}
						disabled={staging}
						onclick={() => onBlank(color)}
						class="size-7 rounded-full border border-black/10 transition hover:scale-110 active:scale-95 dark:border-white/20"
						style="background:{color};"
					></button>
				{/each}
			</div>
		</Popover>
		<button
			type="button"
			class="flex items-center gap-1 rounded-full px-3 py-1.5 text-[11.5px] font-semibold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg)] hover:text-[var(--ui-text)]"
			onclick={() => (showUrl = !showUrl)}
		>
			<Icon name="i-lucide-link" class="size-3.5" />
			{showUrl ? 'Hide URL' : 'Paste URL'}
		</button>
		<MemeSourceLibrary
			id={sourceLibraryId}
			busy={staging || busy}
			onOpenBase={onOpenSource}
			onAddLayer={onAddSourceLayer}
		/>
	</div>
	{#if showUrl}
		<form
			class="mt-2 flex w-full max-w-sm items-center gap-1.5"
			onsubmit={(event) => {
				event.preventDefault();
				void onSubmitUrl();
			}}
		>
			<label class="sr-only" for="meme-gif-url">Image or GIF URL</label>
			<input
				id="meme-gif-url"
				type="url"
				bind:value={url}
				placeholder="Paste an image / GIF / video URL"
				class="h-9 min-w-0 flex-1 rounded-full border border-[var(--ui-border-muted)] bg-transparent px-3.5 text-[12.5px] outline-none placeholder:text-[var(--ui-text-dimmed)] focus:border-warm-500"
				disabled={urlBusy}
			/>
			<button
				type="submit"
				class="flex h-9 shrink-0 items-center gap-1 rounded-full bg-warm-500/10 px-3 text-[11.5px] font-bold text-warm-600 transition hover:bg-warm-500/20 disabled:opacity-50"
				disabled={urlBusy || !url.trim()}
			>
				<Icon
					name={urlBusy ? 'i-lucide-loader-circle' : 'i-lucide-link'}
					class="size-3.5 {urlBusy ? 'animate-spin' : ''}"
				/>
				{urlBusy ? 'Loading…' : 'Use URL'}
			</button>
		</form>
	{/if}
</div>
