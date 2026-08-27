<script lang="ts">
	import type { MemeMediaFormat } from './MemeStudioDropZone.svelte';
	import { PICK_FORMATS } from './meme-studio-config';

	let {
		fileInput = $bindable(null),
		otherSourceInput = $bindable(null),
		layerInput = $bindable(null),
		queueInput = $bindable(null),
		soundInput = $bindable(null),
		replaceInput = $bindable(null),
		pickFormat,
		onFile,
		onOtherSource,
		onLayer,
		onReplace,
		onQueue,
		onSound
	}: {
		fileInput: HTMLInputElement | null;
		otherSourceInput: HTMLInputElement | null;
		layerInput: HTMLInputElement | null;
		queueInput: HTMLInputElement | null;
		soundInput: HTMLInputElement | null;
		replaceInput: HTMLInputElement | null;
		pickFormat: 'all' | MemeMediaFormat;
		onFile: (event: Event) => void;
		onOtherSource: (event: Event) => void;
		onLayer: (event: Event) => void;
		onReplace: (event: Event) => void;
		onQueue: (event: Event) => void;
		onSound: (file: File | null) => void;
	} = $props();

	const mediaAccept = $derived(
		pickFormat === 'all'
			? 'image/*,video/mp4,video/webm,video/quicktime,image/gif'
			: (PICK_FORMATS.find((format) => format.id === pickFormat)?.accept ?? 'image/*,video/*')
	);

	function handleSound(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		onSound(input.files?.[0] ?? null);
		input.value = '';
	}
</script>

<input bind:this={fileInput} type="file" accept={mediaAccept} class="hidden" onchange={onFile} />
<input
	bind:this={otherSourceInput}
	type="file"
	accept="image/*,video/mp4,video/webm,video/quicktime,image/gif"
	class="hidden"
	onchange={onOtherSource}
/>
<input
	bind:this={layerInput}
	type="file"
	accept="image/png,image/gif,image/jpeg,image/webp,image/svg+xml"
	multiple
	class="hidden"
	onchange={onLayer}
/>
<input
	bind:this={replaceInput}
	type="file"
	accept="image/png,image/gif,image/jpeg,image/webp,image/svg+xml"
	class="hidden"
	onchange={onReplace}
/>
<input
	bind:this={queueInput}
	type="file"
	accept="image/*,video/mp4,video/webm,video/quicktime,image/gif"
	multiple
	class="hidden"
	onchange={onQueue}
/>
<input bind:this={soundInput} type="file" accept="audio/*" class="hidden" onchange={handleSound} />
