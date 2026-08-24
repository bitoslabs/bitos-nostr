<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import GifPicker, { type GifChoice } from '$lib/components/feed/GifPicker.svelte';
	import { formatDuration } from '$lib/utils/format';

	let {
		id,
		seconds,
		busy,
		url = $bindable(''),
		showUrl = $bindable(false),
		urlBusy,
		onBrowse,
		onSubmitUrl,
		onPickGif
	}: {
		id: string;
		seconds: number;
		busy: boolean;
		url: string;
		showUrl: boolean;
		urlBusy: boolean;
		onBrowse: () => void;
		onSubmitUrl: () => void;
		onPickGif: (gif: GifChoice) => void;
	} = $props();
</script>

<Popover
	{id}
	float
	placement="top-start"
	width="auto"
	label="Add an image layer at the playhead"
	triggerClass="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10.5px] font-bold text-emerald-600 transition hover:bg-emerald-500/20 disabled:opacity-40"
	triggerActiveClass="bg-emerald-500/20"
>
	{#snippet trigger()}
		<Icon name="i-lucide-image-plus" class="size-3.5" />
		Image @ {formatDuration(seconds)}
	{/snippet}
	<div class="w-64 max-w-[80vw] p-1.5">
		<p class="px-1.5 pb-1.5 text-[10.5px] leading-snug text-[var(--ui-text-dimmed)]">
			Lands with a 2s window at {formatDuration(seconds)} — tweak it in the Image layers list.
		</p>
		<div class="flex items-center gap-1">
			<button
				type="button"
				onclick={onBrowse}
				disabled={busy}
				class="flex flex-1 items-center gap-1.5 rounded-lg bg-[var(--ui-bg-accented)] px-2.5 py-2 text-[11.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-50"
				><Icon name="i-lucide-upload" class="size-3.5" /> Upload file</button
			>
			<button
				type="button"
				onclick={(event) => {
					event.stopPropagation();
					showUrl = !showUrl;
				}}
				disabled={busy}
				class="flex flex-1 items-center gap-1.5 rounded-lg bg-[var(--ui-bg-accented)] px-2.5 py-2 text-[11.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-50"
				><Icon name="i-lucide-link" class="size-3.5" /> URL</button
			>
		</div>
		{#if showUrl}
			<div class="mt-1.5 flex items-center gap-1">
				<input
					type="url"
					inputmode="url"
					bind:value={url}
					placeholder="https://…/sticker.png"
					class="h-8 min-w-0 flex-1 rounded-full border border-[var(--ui-border-muted)] bg-transparent px-3 text-[11.5px] outline-none placeholder:text-[var(--ui-text-dimmed)] focus:border-warm-500"
					disabled={urlBusy}
					onkeydown={(event) => {
						if (event.key === 'Enter') {
							event.preventDefault();
							onSubmitUrl();
						}
					}}
				/>
				<button
					type="button"
					onclick={onSubmitUrl}
					disabled={urlBusy || !url.trim()}
					class="grid size-8 shrink-0 place-items-center rounded-full bg-emerald-500/12 text-emerald-600 transition hover:bg-emerald-500/20 disabled:opacity-50"
					aria-label="Add this URL as a timed layer"
					><Icon
						name={urlBusy ? 'i-lucide-loader-circle' : 'i-lucide-check'}
						class="size-3.5 {urlBusy ? 'animate-spin' : ''}"
					/></button
				>
			</div>
		{/if}
		<p class="mt-1.5 flex items-center gap-1 px-1 text-[10.5px] text-[var(--ui-text-dimmed)]">
			<Icon name="i-lucide-film" class="size-3" /> or pick a GIF sticker
		</p>
		<GifPicker onpick={onPickGif} onbrowse={onBrowse} />
	</div>
</Popover>
