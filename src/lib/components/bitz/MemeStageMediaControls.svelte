<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import GifPicker, { type GifChoice } from '$lib/components/feed/GifPicker.svelte';
	import MemeSourceLibrary from './MemeSourceLibrary.svelte';
	import type { MediaSource } from '$lib/stores/media-library.svelte';

	let {
		busy,
		staging,
		sourceLibraryId,
		gifPickerId,
		keepLayout = $bindable(false),
		showUrlForm = $bindable(false),
		url = $bindable(''),
		urlBusy,
		onChooseFile,
		onQueue,
		onOpenSource,
		onAddLayer,
		onPickGif,
		onSubmitUrl,
		onRemove,
		onNew
	}: {
		busy: boolean;
		staging: boolean;
		sourceLibraryId: string;
		gifPickerId: string;
		keepLayout: boolean;
		showUrlForm: boolean;
		url: string;
		urlBusy: boolean;
		onChooseFile: () => void;
		onQueue: () => void;
		onOpenSource: (source: MediaSource) => void;
		onAddLayer: (source: MediaSource) => void;
		onPickGif: (gif: GifChoice) => void;
		onSubmitUrl: () => void;
		onRemove: () => void;
		onNew: () => void;
	} = $props();
</script>

<div class="mt-2 flex flex-wrap items-center justify-between gap-2">
	<div class="flex flex-wrap items-center gap-1">
		<button
			type="button"
			onclick={onChooseFile}
			disabled={busy}
			class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-40"
		>
			<Icon name="i-lucide-repeat-2" class="size-3" /> Replace
		</button>
		<button
			type="button"
			onclick={onQueue}
			disabled={busy}
			title="Queue more clips — each publish loads the next one"
			class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-[var(--ui-text-muted)] transition hover:bg-warm-500/15 hover:text-warm-600 disabled:opacity-40"
		>
			<Icon name="i-lucide-list-video" class="size-3" /> Queue clips
		</button>
		<MemeSourceLibrary
			id={sourceLibraryId}
			busy={staging || busy}
			triggerLabel="Library"
			onOpenBase={onOpenSource}
			{onAddLayer}
		/>
		<Popover
			id={gifPickerId}
			float
			placement="top-start"
			width="auto"
			class="w-72 max-w-[80vw] p-0 sm:w-80"
			label="Swap the base GIF from the library"
			triggerClass="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-40"
			triggerActiveClass="bg-warm-500/15 text-warm-600"
		>
			{#snippet trigger()}<Icon name="i-lucide-film" class="size-3" /> GIFs {#if staging}<Icon
						name="i-lucide-loader-circle"
						class="size-3 animate-spin"
					/>{/if}{/snippet}
			<GifPicker onpick={onPickGif} />
		</Popover>
		<label
			class="inline-flex cursor-pointer items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold transition {keepLayout
				? 'bg-warm-500/15 text-warm-600'
				: 'text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]'}"
			title="Keep captions, image layers and sound cues when the base media changes"
		>
			<input
				type="checkbox"
				bind:checked={keepLayout}
				disabled={busy}
				class="size-3 accent-[var(--color-warm-500)]"
			/> Keep captions
		</label>
		<button
			type="button"
			onclick={() => (showUrlForm = !showUrlForm)}
			disabled={busy || urlBusy}
			class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-40"
		>
			<Icon name="i-lucide-link" class="size-3" />
			{showUrlForm ? 'Hide URL' : 'URL'}
		</button>
	</div>
	<button
		type="button"
		onclick={onRemove}
		disabled={busy}
		class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--tone-error-text)] disabled:opacity-40"
		><Icon name="i-lucide-trash-2" class="size-3" /> Remove</button
	>
	<button
		type="button"
		onclick={onNew}
		disabled={busy}
		title="Clear everything and start a new meme"
		class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-warm-600 transition hover:bg-warm-500/15 disabled:opacity-40"
		><Icon name="i-lucide-file-plus" class="size-3" /> New</button
	>
</div>
{#if showUrlForm}
	<form
		class="mt-2 flex items-center gap-1.5"
		onsubmit={(event) => {
			event.preventDefault();
			onSubmitUrl();
		}}
	>
		<input
			type="url"
			inputmode="url"
			bind:value={url}
			placeholder="https://example.com/meme.gif"
			class="h-8 min-w-0 flex-1 rounded-full border border-[var(--ui-border-muted)] bg-transparent px-3 text-[12px] outline-none placeholder:text-[var(--ui-text-dimmed)] focus:border-warm-500"
			disabled={urlBusy}
		/>
		<button
			type="submit"
			class="flex h-8 shrink-0 items-center gap-1 rounded-full bg-warm-500/10 px-3 text-[11px] font-bold text-warm-600 transition hover:bg-warm-500/20 disabled:opacity-50"
			disabled={urlBusy || !url.trim()}
			><Icon
				name={urlBusy ? 'i-lucide-loader-circle' : 'i-lucide-check'}
				class="size-3 {urlBusy ? 'animate-spin' : ''}"
			/>
			{urlBusy ? 'Loading…' : 'Swap'}</button
		>
	</form>
{/if}
