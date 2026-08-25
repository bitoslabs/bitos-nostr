<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import type { MemeBatchItem } from '$lib/stores/meme-batch-queue.svelte';

	let {
		items,
		startIndex,
		peekLabel,
		busy,
		staging,
		onCaption,
		onSkip,
		onClear
	}: {
		items: MemeBatchItem[];
		startIndex: number;
		peekLabel: string;
		busy: boolean;
		staging: boolean;
		onCaption: (id: number, caption: string | undefined) => void;
		onSkip: () => void;
		onClear: () => void;
	} = $props();
</script>

{#if items.length}
	<div
		class="flex shrink-0 items-start justify-between gap-2 border-b border-warm-500/25 bg-warm-500/10 px-4 py-2"
	>
		<div class="flex min-w-0 flex-1 flex-col gap-1.5">
			<div class="flex items-center gap-2 text-[12px] font-semibold text-warm-600">
				<Icon name="i-lucide-list-video" class="size-4 shrink-0" />
				<span class="truncate">
					Batch queue: {items.length} clip{items.length === 1 ? '' : 's'} left — each post loads the next
				</span>
			</div>
			<div class="flex flex-col gap-1">
				{#each items as item, index (item.id)}
					<div class="flex items-center gap-1.5">
						<span
							class="grid size-5 shrink-0 place-items-center rounded-full bg-warm-500/15 font-mono text-[10px] font-bold text-warm-600"
							title={item.label}
						>
							{startIndex + index + 1}
						</span>
						<input
							type="text"
							value={item.caption ?? ''}
							maxlength="280"
							placeholder={`Caption for ${item.label}…`}
							aria-label={`Caption for queued clip ${startIndex + index + 1}`}
							oninput={(event) =>
								onCaption(item.id, (event.currentTarget as HTMLInputElement).value || undefined)}
							class="h-7 min-w-0 flex-1 rounded-lg border border-warm-500/20 bg-[var(--ui-bg)] px-2 text-[12px] outline-none focus:border-warm-500/60"
						/>
					</div>
				{/each}
			</div>
		</div>
		<span class="flex shrink-0 items-center gap-1">
			<button
				type="button"
				onclick={onSkip}
				disabled={staging || busy}
				title={`Skip this one and load the next queued clip (${peekLabel})`}
				class="rounded-full px-2.5 py-1 text-[11px] font-bold text-warm-600 transition hover:bg-warm-500/20 disabled:opacity-50"
			>
				Skip →
			</button>
			<button
				type="button"
				onclick={onClear}
				title="Drop every queued GIF"
				class="rounded-full px-2.5 py-1 text-[11px] font-semibold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]"
			>
				Clear
			</button>
		</span>
	</div>
{/if}
