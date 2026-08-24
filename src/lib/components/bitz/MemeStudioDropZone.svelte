<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';

	export type MemeMediaFormat = 'image' | 'gif' | 'video';

	export interface MemeMediaFormatOption {
		id: MemeMediaFormat;
		label: string;
		hint: string;
		icon: string;
	}

	let {
		formats,
		onChooseMedia,
		onChooseFormat,
		onDropFile
	}: {
		formats: MemeMediaFormatOption[];
		onChooseMedia: () => void;
		onChooseFormat: (format: MemeMediaFormat) => void | Promise<void>;
		onDropFile: (file: File | null) => void;
	} = $props();

	let dragOver = $state(false);

	function chooseMedia(): void {
		onChooseMedia();
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		chooseMedia();
	}

	function onDrop(event: DragEvent): void {
		event.preventDefault();
		dragOver = false;
		onDropFile(event.dataTransfer?.files?.[0] ?? null);
	}
</script>

<div
	role="button"
	tabindex="0"
	aria-label="Choose a picture or video for your meme"
	class="group flex w-full max-w-sm cursor-pointer flex-col items-center gap-3 rounded-3xl border-2 border-dashed px-6 py-10 text-center transition {dragOver
		? 'border-warm-500 bg-warm-500/10'
		: 'border-[var(--ui-border-accented)] hover:border-warm-500/60 hover:bg-[var(--ui-bg-muted)]'}"
	onclick={chooseMedia}
	onkeydown={onKeydown}
	ondragover={(event) => {
		event.preventDefault();
		dragOver = true;
	}}
	ondragleave={() => (dragOver = false)}
	ondrop={onDrop}
>
	<span
		class="grid size-16 place-items-center rounded-2xl bg-warm-500/12 text-warm-500 transition group-hover:scale-105"
	>
		<Icon name="i-lucide-image-plus" class="size-8" />
	</span>
	<div>
		<p class="text-[15px] font-bold text-[var(--ui-text-highlighted)]">Drop a picture or video</p>
		<p class="mt-1 text-[13px] leading-relaxed text-[var(--ui-text-muted)]">
			Caption it, drag captions anywhere, export once — up to 200 MB.
		</p>
	</div>
	<span
		class="mt-1 inline-flex items-center gap-1.5 rounded-full bg-warm-500 px-4 py-2 text-[12.5px] font-bold text-white transition group-hover:brightness-110 active:scale-95"
	>
		<Icon name="i-lucide-upload" class="size-4" />
		Choose media
	</span>
	<p class="flex items-center gap-1 text-[11px] text-[var(--ui-text-dimmed)]">
		<Icon name="i-lucide-globe" class="size-3.5" />
		Captions are burned in — renders in every Nostr app
	</p>
	<div class="flex w-full flex-wrap items-stretch justify-center gap-2">
		{#each formats as format (format.id)}
			<button
				type="button"
				onclick={(event) => {
					event.stopPropagation();
					void onChooseFormat(format.id);
				}}
				class="group/fmt flex min-w-[104px] flex-1 flex-col items-center gap-1 rounded-2xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)]/60 px-3 py-2.5 transition hover:border-warm-500/50 hover:bg-warm-500/10 active:scale-95"
				title={`Start a ${format.label} — opens the ${format.id.toUpperCase()} picker`}
			>
				<span
					class="grid size-8 place-items-center rounded-xl bg-warm-500/12 text-warm-500 transition group-hover/fmt:scale-110"
				>
					<Icon name={format.icon} class="size-4.5" />
				</span>
				<span class="text-[11.5px] font-bold text-[var(--ui-text)]">{format.label}</span>
				<span class="text-[9.5px] leading-tight text-[var(--ui-text-dimmed)]">{format.hint}</span>
			</button>
		{/each}
	</div>
</div>
