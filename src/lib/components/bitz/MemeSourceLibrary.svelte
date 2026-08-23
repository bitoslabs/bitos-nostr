<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import { mediaLibrary, type MediaSource } from '$lib/stores/media-library.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';

	/**
	 * MemeSourceLibrary — the studio's recently-used sources (images, GIFs,
	 * videos that actually loaded). One tap re-opens a source as the BASE
	 * media; image/GIF items also drop as LAYERS at the playhead. This is the
	 * mass-production loop: the logo/sticker/clip you used yesterday is one
	 * tap away — no re-browsing Giphy, the device or the clipboard.
	 */
	let {
		id,
		onOpenBase,
		onAddLayer,
		busy = false,
		float = true,
		triggerLabel = 'Library'
	}: {
		id: string;
		/** Load a source as the base media (fetch → File → accept). */
		onOpenBase: (source: MediaSource) => void;
		/** Drop an image/GIF source as a layer at the playhead. */
		onAddLayer: (source: MediaSource) => void;
		busy?: boolean;
		float?: boolean;
		triggerLabel?: string;
	} = $props();

	const KIND_META: Record<MediaSource['kind'], { icon: string; label: string }> = {
		image: { icon: 'i-lucide-image', label: 'Image' },
		gif: { icon: 'i-lucide-film', label: 'GIF' },
		video: { icon: 'i-lucide-clapperboard', label: 'Video' }
	};
</script>

<Popover
	{id}
	{float}
	placement="top-start"
	width="auto"
	label="Recent sources"
	triggerClass="flex items-center gap-1 rounded-full bg-[var(--ui-bg-accented)] px-2.5 py-1 text-[11.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]"
	triggerActiveClass="bg-warm-500/15 text-warm-600"
>
	{#snippet trigger()}
		<Icon name="i-lucide-library" class="size-3.5" />
		{triggerLabel}
		{#if mediaLibrary.list.length}
			<span class="rounded-full bg-primary-500/15 px-1 text-[9.5px] font-bold text-primary-600">
				{mediaLibrary.list.length}
			</span>
		{/if}
	{/snippet}
	<div class="w-80 max-w-[85vw] p-2">
		{#if mediaLibrary.list.length}
			<p class="px-1 pb-1.5 text-[10.5px] text-[var(--ui-text-dimmed)]">
				Tap to open as the media · the layer button drops image/GIF sources at the playhead
			</p>
			<div class="flex max-h-72 flex-col gap-1 overflow-y-auto">
				{#each mediaLibrary.list as source (source.id)}
					<div class="flex items-center gap-2 rounded-lg bg-[var(--ui-bg-accented)] px-2 py-1.5">
						<button
							type="button"
							disabled={busy}
							onclick={() => onOpenBase(source)}
							title={`Open ${source.label} as the base media`}
							class="flex min-w-0 flex-1 items-center gap-2 text-left"
						>
							<span
								class="grid size-8 shrink-0 place-items-center overflow-hidden rounded-md bg-black/40"
							>
								{#if source.kind !== 'video'}
									<img
										src={source.url}
										alt=""
										loading="lazy"
										class="max-h-full max-w-full object-contain"
									/>
								{:else}
									<Icon name="i-lucide-clapperboard" class="size-4 text-white/60" />
								{/if}
							</span>
							<span class="min-w-0">
								<span class="block truncate text-[11.5px] font-bold text-[var(--ui-text)]">
									{source.label || 'Source'}
								</span>
								<span class="flex items-center gap-1 text-[10px] text-[var(--ui-text-dimmed)]">
									<Icon name={KIND_META[source.kind].icon} class="size-3" />
									{KIND_META[source.kind].label}
								</span>
							</span>
						</button>
						{#if source.kind !== 'video'}
							<button
								type="button"
								disabled={busy}
								onclick={() => onAddLayer(source)}
								title="Drop as a movable layer at the playhead"
								aria-label={`Add ${source.label} as a layer`}
								class="grid size-7 shrink-0 place-items-center rounded-full text-emerald-600 transition hover:bg-emerald-500/15 disabled:opacity-40"
							>
								<Icon name="i-lucide-plus" class="size-4" />
							</button>
						{/if}
						<button
							type="button"
							onclick={(e) => {
								e.stopPropagation();
								mediaLibrary.remove(source.id);
							}}
							title="Remove from history"
							aria-label={`Remove ${source.label} from history`}
							class="grid size-7 shrink-0 place-items-center rounded-full text-[var(--ui-text-dimmed)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--tone-error-text)]"
						>
							<Icon name="i-lucide-x" class="size-3.5" />
						</button>
					</div>
				{/each}
			</div>
			<button
				type="button"
				onclick={(e) => {
					e.stopPropagation();
					mediaLibrary.clear();
					toasts.info('Source history cleared');
				}}
				class="mx-auto mt-1.5 flex h-7 items-center gap-1 rounded-full px-3 text-[10.5px] font-bold text-[var(--ui-text-dimmed)] transition hover:text-[var(--tone-error-text)]"
			>
				<Icon name="i-lucide-eraser" class="size-3" />
				Clear history
			</button>
		{:else}
			<p class="py-6 text-center text-[11px] text-[var(--ui-text-dimmed)]">
				Every GIF, image and video you use lands here for one-tap reuse.
			</p>
		{/if}
	</div>
</Popover>
