<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import { OUTPUT_FORMATS, type MemeExportFormat } from './meme-studio-config';

	let {
		captionCount,
		kindLabel,
		mediaKind,
		width,
		height,
		mediaLoaded,
		busy,
		canPost,
		progressLabel,
		destination,
		exportFormat,
		videoExportSupported,
		onFormat,
		onCancel,
		onExport,
		onPublish
	}: {
		captionCount: number;
		kindLabel: string;
		mediaKind: 'image' | 'video' | null;
		width: number;
		height: number;
		mediaLoaded: boolean;
		busy: boolean;
		canPost: boolean;
		progressLabel: string;
		destination: 'bitz' | 'story' | 'note';
		exportFormat: MemeExportFormat;
		videoExportSupported: boolean;
		onFormat: (format: MemeExportFormat) => void;
		onCancel: () => void;
		onExport: () => void;
		onPublish: () => void;
	} = $props();
</script>

<footer
	class="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--ui-border-muted)] px-4 py-3"
>
	<div class="flex min-w-0 items-center gap-2 text-[11px] text-[var(--ui-text-dimmed)]">
		<Icon name="i-lucide-info" class="size-3.5 shrink-0" />
		<span class="truncate">
			{captionCount} caption{captionCount === 1 ? '' : 's'} · {kindLabel}
			{width}×{height}
		</span>
	</div>
	<div
		class="hidden items-center gap-0.5 rounded-full bg-[var(--ui-bg-muted)] p-0.5 sm:flex"
		role="group"
		aria-label="Output format"
	>
		{#each OUTPUT_FORMATS as format (format.id)}
			{@const disabled =
				format.id === 'gif' && mediaKind === 'video'
					? 'GIF export needs an image or GIF base'
					: format.id === 'video' && !videoExportSupported
						? 'This browser cannot record video'
						: ''}
			<button
				type="button"
				disabled={busy || !!disabled}
				onclick={() => onFormat(format.id)}
				aria-pressed={exportFormat === format.id}
				title={disabled || format.hint}
				class="rounded-full px-2.5 py-1 text-[11px] font-bold transition {exportFormat === format.id
					? 'bg-[var(--ui-bg)] text-[var(--ui-text)] shadow-sm'
					: disabled
						? 'cursor-not-allowed text-[var(--ui-text-dimmed)] opacity-50'
						: 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
			>
				{format.label}
			</button>
		{/each}
	</div>
	<div class="flex items-center gap-2">
		<button
			type="button"
			onclick={onCancel}
			disabled={busy}
			class="h-9 rounded-full px-4 text-[13px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-40"
		>
			Cancel
		</button>
		<button
			type="button"
			onclick={onExport}
			disabled={!mediaLoaded || busy}
			title="Render and download the meme as a file — same output as publishing"
			class="inline-flex h-9 items-center gap-2 rounded-full border border-[var(--ui-border-muted)] px-4 text-[13px] font-bold text-[var(--ui-text)] transition hover:border-warm-500/50 hover:bg-warm-500/10 hover:text-warm-600 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
		>
			<Icon name="i-lucide-download" class="size-4" />
			<span class="hidden sm:inline">Export</span>
		</button>
		<button
			type="button"
			onclick={onPublish}
			disabled={!canPost || busy}
			class="inline-flex h-9 items-center gap-2 rounded-full bg-warm-500 px-5 text-[13px] font-bold text-white transition hover:brightness-110 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
		>
			{#if busy}
				<Icon name="i-lucide-loader-circle" class="size-4 animate-spin" />
				{progressLabel || 'Working…'}
			{:else}
				<Icon name="i-lucide-send" class="size-4" />
				{destination === 'story'
					? 'Post story'
					: destination === 'note'
						? 'Post note'
						: 'Publish meme'}
			{/if}
		</button>
	</div>
</footer>
