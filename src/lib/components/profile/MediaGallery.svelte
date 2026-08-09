<script lang="ts">
	/**
	 * Instagram-style media gallery for a profile. Collapses every image / gif /
	 * video attachment across the user's notes into one square thumbnail grid.
	 * Tapping a tile opens a full-screen lightbox carousel; each frame links
	 * back to the source note.
	 */
	import Icon from '$lib/components/ui/Icon.svelte';
	import ImageLightbox from '$lib/components/ui/ImageLightbox.svelte';
	import { extractProfileMedia, type ProfileMediaItem } from '$lib/utils/profile-stats';
	import type { FeedNote } from '$lib/nostr/types';

	let { notes }: { notes: FeedNote[] } = $props();

	const items = $derived(extractProfileMedia(notes)) as ProfileMediaItem[];
	const imageUrls = $derived(
		items.filter((m) => m.type === 'image' || m.type === 'gif').map((m) => m.url)
	);

	let lightboxOpen = $state(false);
	let lightboxIndex = $state(0);
	let failed = $state<Record<string, boolean>>({});

	function openLightbox(item: ProfileMediaItem) {
		const imageOnly = items.filter((m) => m.type === 'image' || m.type === 'gif');
		const idx = imageOnly.findIndex((m) => m.url === item.url);
		if (idx >= 0) {
			lightboxIndex = idx;
			lightboxOpen = true;
		}
	}
</script>

{#if items.length}
	<div class="grid grid-cols-3 gap-1.5 pb-2 sm:grid-cols-4 sm:gap-2">
		{#each items as item (item.url)}
			{@const isPlayable = item.type === 'video' || item.type === 'gif'}
			{@const activeNote = `/note/${item.noteId}`}
			<a
				href={isPlayable ? activeNote : undefined}
				onclick={(e) => {
					if (item.type === 'image' || item.type === 'gif') {
						e.preventDefault();
						openLightbox(item);
					}
				}}
				class="group focus-brand relative aspect-square overflow-hidden rounded-xl bg-[var(--ui-bg-muted)] ring-1 ring-[var(--ui-border-muted)] transition"
				aria-label={item.type === 'video' ? 'Open video post' : 'View image'}
			>
				{#if failed[item.url]}
					<div
						class="grid size-full place-items-center text-[var(--ui-text-dimmed)]"
						title="Media unavailable"
					>
						<Icon name="i-lucide-image-off" class="size-5" />
					</div>
				{:else if item.type === 'video'}
					<div class="grid size-full place-items-center bg-[var(--ui-bg-accented)]">
						<span
							class="grid size-9 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm transition group-hover:scale-110"
						>
							<Icon name="i-lucide-play" class="size-4 translate-x-0.5" />
						</span>
					</div>
				{:else}
					<img
						src={item.thumb || item.url}
						alt={item.alt || ''}
						loading="lazy"
						referrerpolicy="no-referrer"
						onerror={() => (failed = { ...failed, [item.url]: true })}
						class="size-full object-cover transition duration-300 group-hover:scale-[1.04]"
					/>
				{/if}

				<!-- Type badge for gifs / extra hints -->
				{#if item.type === 'gif'}
					<span
						class="absolute top-1 left-1 rounded bg-black/55 px-1 py-0.5 text-[9px] font-bold text-white backdrop-blur-sm"
						>GIF</span
					>
				{/if}

				<!-- Hover scrim with open-post affordance -->
				<div
					class="pointer-events-none absolute inset-0 flex items-end bg-gradient-to-t from-black/45 to-transparent p-1.5 opacity-0 transition group-hover:opacity-100"
				>
					<span class="inline-flex items-center gap-1 text-[10px] font-bold text-white">
						<Icon name="i-lucide-arrow-up-right" class="size-3" />
						Open post
					</span>
				</div>
			</a>
		{/each}
	</div>
{:else}
	<div
		class="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--ui-border-accented)] bg-[var(--ui-bg-muted)] px-4 py-12 text-center"
	>
		<span
			class="grid size-11 place-items-center rounded-2xl bg-[var(--surface-bg)] text-[var(--ui-text-dimmed)] ring-1 ring-[var(--ui-border-muted)]"
		>
			<Icon name="i-lucide-image" class="size-5" />
		</span>
		<p class="text-[13px] font-semibold">No media yet</p>
		<p class="text-[12px] text-[var(--ui-text-muted)]">
			Photos, GIFs and videos from posts show up here.
		</p>
	</div>
{/if}

<ImageLightbox bind:open={lightboxOpen} images={imageUrls} bind:index={lightboxIndex} />
