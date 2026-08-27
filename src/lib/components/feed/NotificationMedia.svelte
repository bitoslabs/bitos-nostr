<script lang="ts">
	/**
	 * Premium media grid for notification rows.
	 *
	 * Renders attachments parsed from NIP-92 `imeta` + content URLs with:
	 *  - instant BlurHash placeholders (no layout shift, perceived-instant paint)
	 *  - thumbnail-first loading when a `thumb` url is provided, full-res in lightbox
	 *  - reserved aspect-ratio from `dim` (zero CLS)
	 *  - multi-image masonry + GIF / dimension badges
	 *  - graceful failure fallback and a sensitive-media cover
	 * Clicking a tile opens the shared full-screen ImageLightbox gallery.
	 */
	import { browser } from '$app/environment';
	import ImageLightbox from '$lib/components/ui/ImageLightbox.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import MediaPlayer from '$lib/components/media/MediaPlayer.svelte';
	import { blurhashToDataUrl } from '$lib/utils/blurhash';
	import { sensitiveMediaReason as getSensitiveMediaReason } from '$lib/utils/sensitive-media';
	import { privacyNotificationSettings } from '$lib/stores/privacy-notification-settings.svelte';
	import type { ImageMeta } from '$lib/utils/imeta';

	let {
		media,
		tags = [],
		content = '',
		/** A quoted post's single video behaves like a normal feed video: it
		 * plays in place and exposes transport controls instead of opening an
		 * image-only lightbox. */
		playSingleVideo = false,
		/** Preserve the entire frame for GIF and WebP attachments in compact
		 * contexts such as comment lists. */
		containGifAndWebp = false
	}: {
		media: ImageMeta[];
		tags?: string[][];
		content?: string;
		playSingleVideo?: boolean;
		containGifAndWebp?: boolean;
	} = $props();

	const MAX_VISIBLE = 4;

	let lightboxOpen = $state(false);
	let lightboxIndex = $state(0);
	let failed = $state<Record<string, boolean>>({});
	let loaded = $state<Record<string, boolean>>({});
	let revealed = $state<Record<string, boolean>>({});

	const visible = $derived(media.slice(0, MAX_VISIBLE));
	const hiddenCount = $derived(Math.max(0, media.length - visible.length));
	const fullResUrls = $derived(media.map((item) => item.url));
	const sensitive = $derived(getSensitiveMediaReason(tags, content));
	const singleVideo = $derived(
		playSingleVideo && media.length === 1 && media[0]?.kind === 'video' ? media[0] : undefined
	);

	function placeholderFor(item: ImageMeta): string | undefined {
		if (!browser || !item.blurhash) return undefined;
		const h = item.dim ? Math.round((32 * item.dim.h) / Math.max(1, item.dim.w)) : 32;
		return blurhashToDataUrl(item.blurhash, 32, Math.max(8, h));
	}

	function aspectStyle(item: ImageMeta): string {
		if (item.dim) return `aspect-ratio:${item.dim.w} / ${item.dim.h};`;
		return 'aspect-ratio:16 / 9;';
	}

	function gridClass(count: number): string {
		if (count <= 1) return 'grid-cols-1';
		if (count === 2) return 'grid-cols-2';
		if (count === 3) return 'grid-cols-2';
		return 'grid-cols-2';
	}

	function reasonFor(item: ImageMeta): string {
		return getSensitiveMediaReason(tags, content, item);
	}

	function shouldContain(item: ImageMeta): boolean {
		return (
			containGifAndWebp &&
			(item.kind === 'gif' || item.mime === 'image/webp' || /\.webp(?:[?#]|$)/i.test(item.url))
		);
	}

	function isCovered(item: ImageMeta): boolean {
		return (
			privacyNotificationSettings.state.hideSensitiveMedia &&
			!!reasonFor(item) &&
			!revealed[item.url]
		);
	}

	function openLightbox(index: number) {
		lightboxIndex = index;
		lightboxOpen = true;
	}

	function onTileClick(item: ImageMeta, index: number) {
		if (isCovered(item)) {
			revealed = { ...revealed, [item.url]: true };
			return;
		}
		openLightbox(index);
	}
</script>

{#if media.length}
	{#if singleVideo}
		{@const covered = isCovered(singleVideo)}
		<div
			class="relative overflow-hidden rounded-2xl border border-[var(--ui-border-muted)] bg-black"
			style={aspectStyle(singleVideo)}
		>
			{#if !covered}
				<MediaPlayer
					src={singleVideo.url}
					label={singleVideo.alt ?? 'Embedded note video'}
					fallbackSrcs={singleVideo.fallbacks}
					variant="reel"
					class="absolute inset-0"
					mediaClass="size-full object-cover"
					preload="metadata"
				/>
			{:else}
				<button
					type="button"
					class="absolute inset-0 grid place-items-center bg-black/45 p-3 text-white backdrop-blur-xl"
					onclick={() => (revealed = { ...revealed, [singleVideo.url]: true })}
					aria-label="Reveal sensitive video"
				>
					<span class="flex flex-col items-center gap-1">
						<Icon name="i-lucide-eye-off" class="size-5" />
						<span class="text-[11px] font-bold">Tap to view video</span>
					</span>
				</button>
			{/if}
		</div>
	{:else}
		<div
			class="grid {gridClass(
				visible.length
			)} gap-0.5 overflow-hidden rounded-2xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)]"
		>
			{#each visible as item, i (item.url)}
				{@const ph = placeholderFor(item)}
				{@const isFailed = failed[item.url]}
				{@const isLoaded = loaded[item.url]}
				{@const covered = isCovered(item)}
				{@const contain = shouldContain(item)}
				{@const itemReason = reasonFor(item)}
				{@const showMore = hiddenCount > 0 && i === visible.length - 1}
				<button
					type="button"
					class="group relative block w-full overflow-hidden bg-[var(--ui-bg-muted)]"
					style={aspectStyle(item)}
					onclick={() => onTileClick(item, i)}
					aria-label={item.alt ?? (covered ? 'Reveal media' : 'Open media')}
				>
					<!-- Loading shimmer when there's no blurhash and the image hasn't painted -->
					{#if !ph && !isLoaded && !isFailed}
						<div
							class="absolute inset-0 animate-pulse bg-gradient-to-br from-[var(--ui-bg-muted)] to-[var(--ui-bg-accented)]"
						></div>
					{/if}

					<!-- Instant blurhash placeholder (painted before bytes arrive) -->
					{#if ph}
						<img
							src={ph}
							alt=""
							aria-hidden="true"
							class="absolute inset-0 size-full scale-110 object-cover"
						/>
					{/if}

					<!-- Real media: thumb first (faster), fades in over the placeholder -->
					{#if !isFailed && item.kind === 'video'}
						<video
							src={item.url}
							poster={item.thumb}
							muted
							autoplay
							loop
							playsinline
							preload="metadata"
							class="absolute inset-0 size-full object-cover transition duration-500 group-hover:scale-[1.03] {isLoaded
								? 'opacity-100'
								: 'opacity-0'}"
							onloadeddata={() => (loaded = { ...loaded, [item.url]: true })}
							onerror={() => (failed = { ...failed, [item.url]: true })}
						></video>
					{:else if !isFailed}
						<img
							src={item.thumb ?? item.url}
							alt={item.alt ?? 'Notification media'}
							loading="lazy"
							decoding="async"
							referrerpolicy="no-referrer"
							class="absolute inset-0 size-full {contain
								? 'object-contain'
								: 'object-cover'} transition duration-500 group-hover:scale-[1.03] {isLoaded
								? 'opacity-100'
								: 'opacity-0'}"
							onload={() => (loaded = { ...loaded, [item.url]: true })}
							onerror={() => (failed = { ...failed, [item.url]: true })}
						/>
					{/if}

					<!-- Failure fallback -->
					{#if isFailed}
						<a
							href={item.url}
							target="_blank"
							rel="noreferrer"
							class="absolute inset-0 grid place-items-center p-3 text-center transition hover:bg-[var(--interactive-hover-bg)]"
						>
							<span class="flex flex-col items-center gap-1 text-[var(--ui-text-dimmed)]">
								<Icon name="i-lucide-image-off" class="size-5" />
								<span class="text-[10.5px] font-semibold">Open original</span>
							</span>
						</a>
					{/if}

					<!-- Kind / dimension badges -->
					{#if item.kind === 'gif' && isLoaded && !covered}
						<span
							class="absolute top-2 left-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[9.5px] font-extrabold tracking-wide text-white uppercase backdrop-blur-sm"
						>
							GIF
						</span>
					{:else if item.kind === 'video' && isLoaded && !covered}
						<span
							class="absolute top-2 left-2 grid size-6 place-items-center rounded-full bg-black/60 text-white backdrop-blur-sm"
						>
							<Icon name="i-lucide-play" class="size-3.5" />
						</span>
					{/if}

					{#if item.dim && isLoaded && !covered}
						<span
							class="absolute top-2 right-2 rounded-md bg-black/45 px-1.5 py-0.5 text-[9.5px] font-semibold text-white/90 tabular-nums backdrop-blur-sm"
						>
							{item.dim.w}×{item.dim.h}
						</span>
					{/if}

					<!-- Hover zoom hint -->
					{#if isLoaded && !covered}
						<span
							class="absolute right-2 bottom-2 grid size-7 place-items-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur-sm transition group-hover:opacity-100"
						>
							<Icon name="i-lucide-maximize-2" class="size-3.5" />
						</span>
					{/if}

					<!-- "+N more" overlay on the last visible tile -->
					{#if showMore && !covered}
						<span
							class="absolute inset-0 grid place-items-center bg-black/55 text-lg font-extrabold text-white"
						>
							+{hiddenCount}
						</span>
					{/if}

					<!-- Sensitive cover -->
					{#if covered}
						<span class="absolute inset-0 grid place-items-center bg-black/35 backdrop-blur-xl">
							<span class="flex flex-col items-center gap-1 text-white">
								<Icon name="i-lucide-eye-off" class="size-5" />
								<span class="text-[10.5px] font-bold">Tap to view</span>
								{#if privacyNotificationSettings.state.sensitiveReason && itemReason}
									<span class="max-w-48 text-center text-[10px] text-white/75">{itemReason}</span>
								{/if}
							</span>
						</span>
					{/if}
				</button>
			{/each}
		</div>
	{/if}

	{#if sensitive}
		{#if privacyNotificationSettings.state.sensitiveReason}
			<p class="mt-1.5 flex items-center gap-1 text-[11px] text-[var(--ui-text-dimmed)]">
				<Icon name="i-lucide-shield-alert" class="size-3" />
				Sensitive — {sensitive}
			</p>
		{/if}
	{/if}

	<ImageLightbox bind:open={lightboxOpen} images={fullResUrls} bind:index={lightboxIndex} />
{/if}
