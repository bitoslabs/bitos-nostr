<script lang="ts">
	/**
	 * Bitz grid for the profile page: the author's short-form media (NIP-71
	 * video + NIP-68 pictures) as a TikTok-discover-style 9/16 tile grid.
	 * Videos preview (muted) on hover with a duration badge; pictures show a
	 * lazy thumbnail. Sensitive media is blurred until tapped.
	 *
	 * Clicking a tile opens the immersive in-profile viewer (same surface as
	 * the Discover media viewer): full MediaPlayer with autoplay + controls,
	 * prev/next browsing through the profile's bitz, caption, and an
	 * "Open note" link to the full thread.
	 */
	import Icon from '$lib/components/ui/Icon.svelte';
	import MediaPlayer from '$lib/components/media/MediaPlayer.svelte';
	import { lazyVideoMetadata } from '$lib/utils/media';
	import { formatDuration } from '$lib/utils/format';
	import { sensitiveMediaReason } from '$lib/utils/sensitive-media';
	import { privacyNotificationSettings } from '$lib/stores/privacy-notification-settings.svelte';
	import type { ReelNote } from '$lib/stores/bitz-session.svelte';

	let { reels, loading = false }: { reels: ReelNote[]; loading?: boolean } = $props();

	let durations = $state<Record<string, number>>({});
	let failed = $state<Record<string, boolean>>({});
	let revealed = $state<Record<string, boolean>>({});
	/** Immersive viewer state — open with the clicked reel's index. */
	let viewerOpen = $state(false);
	let viewerIndex = $state(0);
	const viewerReel = $derived(viewerOpen ? (reels[viewerIndex] ?? null) : null);

	const imageExtPattern = /\.(?:apng|avif|gif|jpe?g|png|webp)$/i;
	const videoExtPattern = /\.(?:m3u8|m4v|mov|mp4|webm)$/i;

	/** Caption without media URLs — mirrors the Bitz page's captionFor. */
	function captionFor(reel: ReelNote) {
		let caption = reel.content.split(reel.mediaUrl).join(' ');
		for (const match of reel.content.matchAll(/https?:\/\/[^\s<>()]+/gi)) {
			const core = match[0].replace(/[),.!?;:\]]+$/, '');
			if (videoExtPattern.test(core) || imageExtPattern.test(core))
				caption = caption.split(core).join(' ');
		}
		return caption.replace(/\s+/g, ' ').trim();
	}

	function likesOf(reel: ReelNote) {
		return reel.reactions.reduce((sum, reaction) => sum + reaction.count, 0);
	}

	function noteHref(reel: ReelNote) {
		return `/note/${reel.id}?from=reels&returnTo=${encodeURIComponent(location.pathname)}`;
	}

	function openViewer(reel: ReelNote) {
		const index = reels.findIndex((item) => item.id === reel.id);
		if (index < 0) return;
		viewerIndex = index;
		viewerOpen = true;
	}

	function prevReel() {
		if (viewerIndex > 0) viewerIndex -= 1;
	}

	function nextReel() {
		if (viewerIndex < reels.length - 1) viewerIndex += 1;
	}

	/** Viewer keyboard: Esc closes, ←/→ browse. */
	function handleKeydown(event: KeyboardEvent) {
		if (!viewerOpen) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			viewerOpen = false;
		} else if (event.key === 'ArrowLeft') {
			event.preventDefault();
			prevReel();
		} else if (event.key === 'ArrowRight') {
			event.preventDefault();
			nextReel();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if loading && !reels.length}
	<div
		class="flex items-center justify-center gap-2 py-10 text-[13px] font-semibold text-[var(--ui-text-dimmed)]"
	>
		<Icon name="i-lucide-loader-circle" class="size-4 animate-spin" />
		Loading bitz…
	</div>
{:else if !reels.length}
	<div
		class="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--ui-border-accented)] bg-[var(--ui-bg-muted)] px-4 py-12 text-center"
	>
		<span
			class="grid size-11 place-items-center rounded-2xl bg-[var(--surface-bg)] text-[var(--ui-text-dimmed)] ring-1 ring-[var(--ui-border-muted)]"
		>
			<Icon name="i-lucide-clapperboard" class="size-5" />
		</span>
		<p class="text-[13px] font-semibold">No bitz yet</p>
		<p class="max-w-xs text-[12px] text-[var(--ui-text-muted)]">
			Short videos and pictures this profile publishes as bitz will collect here.
		</p>
	</div>
{:else}
	<div class="grid grid-cols-3 gap-1.5 pb-2 sm:gap-2 xl:grid-cols-4">
		{#each reels as reel (reel.id)}
			{@const caption = captionFor(reel)}
			{@const covered =
				privacyNotificationSettings.state.hideSensitiveMedia &&
				!!sensitiveMediaReason(reel.tags, reel.content) &&
				!revealed[reel.id]}
			<a
				href={noteHref(reel)}
				onclick={(event) => {
					// First tap on a covered tile reveals it; every other tap plays
					// the bitz in the in-profile viewer (modifier clicks — cmd/ctrl,
					// middle — fall through to the note link).
					if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
					event.preventDefault();
					if (covered) revealed = { ...revealed, [reel.id]: true };
					else openViewer(reel);
				}}
				class="group focus-brand relative aspect-[9/16] overflow-hidden rounded-xl bg-[var(--ui-bg-muted)] ring-1 ring-[var(--ui-border-muted)] transition"
				aria-label="Play bitz {caption ? `“${caption.slice(0, 40)}”` : 'post'}"
			>
				{#if failed[reel.id]}
					<div class="grid size-full place-items-center text-white/50" title="Media unavailable">
						<Icon name="i-lucide-image-off" class="size-5" />
					</div>
				{:else if reel.mediaType === 'video'}
					<video
						use:lazyVideoMetadata
						src={reel.mediaUrl}
						class="absolute inset-0 size-full object-cover transition group-hover:scale-105 {covered
							? 'scale-105 blur-2xl saturate-50'
							: ''}"
						playsinline
						preload="none"
						muted
						onmouseenter={(event) => {
							if (covered) return;
							void (event.currentTarget as HTMLVideoElement).play().catch(() => {
								/* Autoplay can be blocked; the thumbnail simply stays. */
							});
						}}
						onmouseleave={(event) => {
							const video = event.currentTarget as HTMLVideoElement;
							video.pause();
							video.currentTime = 0;
						}}
						onloadedmetadata={(event) => {
							const video = event.currentTarget as HTMLVideoElement;
							if (Number.isFinite(video.duration))
								durations = { ...durations, [reel.id]: video.duration };
						}}
					></video>
					{#if durations[reel.id]}
						<span
							class="absolute top-1.5 right-1.5 rounded-md bg-black/60 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white tabular-nums backdrop-blur"
						>
							{formatDuration(durations[reel.id])}
						</span>
					{:else}
						<span
							class="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-black/50 text-white backdrop-blur"
							aria-hidden="true"
						>
							<Icon name="i-lucide-play" class="size-3 fill-current" />
						</span>
					{/if}
				{:else}
					<img
						src={reel.mediaUrl}
						alt={caption || 'Bitz picture'}
						loading="lazy"
						referrerpolicy="no-referrer"
						onerror={() => (failed = { ...failed, [reel.id]: true })}
						class="absolute inset-0 size-full object-cover transition group-hover:scale-105 {covered
							? 'scale-105 blur-2xl saturate-50'
							: ''}"
					/>
				{/if}

				{#if covered}
					<span
						class="absolute inset-0 z-10 grid place-items-center bg-black/30 text-center text-white"
					>
						<span class="flex flex-col items-center gap-1 text-[10px] font-bold">
							<Icon name="i-lucide-eye-off" class="size-5" />
							Sensitive
						</span>
					</span>
				{:else}
					<span
						class="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-2 pt-7 text-white opacity-90 transition group-hover:opacity-100"
					>
						{#if caption}
							<span class="line-clamp-1 text-[11px] leading-tight font-semibold">{caption}</span>
						{/if}
						<span class="flex items-center gap-2 text-[10px] font-bold">
							<span class="inline-flex items-center gap-0.5">
								<Icon name="i-lucide-heart" class="size-3 fill-current" />
								{likesOf(reel)}
							</span>
							{#if reel.zapCount}
								<span class="inline-flex items-center gap-0.5">
									<Icon name="i-lucide-zap" class="size-3 fill-current" />
									{reel.zapCount}
								</span>
							{/if}
						</span>
					</span>
				{/if}
			</a>
		{/each}
	</div>
{/if}

{#if viewerOpen && viewerReel}
	{@const caption = captionFor(viewerReel)}
	{@const covered =
		privacyNotificationSettings.state.hideSensitiveMedia &&
		!!sensitiveMediaReason(viewerReel.tags, viewerReel.content) &&
		!revealed[viewerReel.id]}
	<!-- Immersive in-profile bitz viewer (mirrors the Discover media viewer) -->
	<div class="animate-fade fixed inset-0 z-[60] flex flex-col bg-black/95 backdrop-blur-sm">
		<!-- Top bar: counter + open-note + close -->
		<header class="flex items-center gap-2 p-3 text-white">
			<span
				class="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 text-white/80"
				aria-hidden="true"
			>
				<Icon name="i-lucide-clapperboard" class="size-4.5" />
			</span>
			<div class="min-w-0 flex-1 leading-tight">
				<p class="truncate text-[14px] font-bold">Bitz</p>
				<p class="text-[11.5px] text-white/65 tabular-nums">
					{viewerIndex + 1} / {reels.length}
				</p>
			</div>
			<a
				href={noteHref(viewerReel)}
				class="hidden h-9 items-center rounded-full border border-white/20 px-4 text-[12px] font-bold transition hover:bg-white/10 sm:inline-flex"
			>
				Open note
			</a>
			<button
				type="button"
				onclick={() => (viewerOpen = false)}
				class="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 transition hover:bg-white/20"
				aria-label="Close viewer"
			>
				<Icon name="i-lucide-x" class="size-5" />
			</button>
		</header>

		<!-- Media stage -->
		<div class="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-2">
			{#if viewerIndex > 0}
				<button
					type="button"
					onclick={prevReel}
					class="absolute top-1/2 left-2 z-10 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20"
					aria-label="Previous bitz"
				>
					<Icon name="i-lucide-chevron-left" class="size-6" />
				</button>
			{/if}

			<div class="relative min-h-0 w-full overflow-hidden">
				{#if covered}
					<div class="grid min-h-[60vh] place-items-center px-4">
						<button
							type="button"
							onclick={() => (revealed = { ...revealed, [viewerReel.id]: true })}
							class="max-w-sm rounded-3xl bg-white/10 px-6 py-5 text-center text-white shadow-xl backdrop-blur"
						>
							<Icon name="i-lucide-eye-off" class="mx-auto mb-3 size-8 text-white/90" />
							<p class="text-[15px] font-bold">Sensitive media hidden</p>
							{#if privacyNotificationSettings.state.sensitiveReason}
								<p class="mt-1 text-[12px] text-white/75">
									{privacyNotificationSettings.state.sensitiveReason}
								</p>
							{/if}
							<span
								class="mt-4 inline-flex rounded-full bg-white px-4 py-2 text-[12px] font-bold text-black"
							>
								Show media
							</span>
						</button>
					</div>
				{:else if viewerReel.mediaType === 'video'}
					<!-- Full BitOS player: seek bar, speed, volume, fallback chain. -->
					<MediaPlayer
						src={viewerReel.mediaUrl}
						label="Profile bitz"
						fallbackSrcs={viewerReel.mediaFallbacks ?? []}
						class="relative mx-auto w-full max-w-5xl"
						mediaClass="mx-auto max-h-[80vh] w-full bg-black object-contain"
						overlayControls
						autoplay
					/>
				{:else}
					<img
						src={viewerReel.mediaUrl}
						alt={caption || 'Bitz picture'}
						class="mx-auto max-h-[80vh] w-auto rounded-xl object-contain"
					/>
				{/if}
			</div>

			{#if viewerIndex < reels.length - 1}
				<button
					type="button"
					onclick={nextReel}
					class="absolute top-1/2 right-2 z-10 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20"
					aria-label="Next bitz"
				>
					<Icon name="i-lucide-chevron-right" class="size-6" />
				</button>
			{/if}
		</div>

		<!-- Caption footer -->
		{#if caption}
			<footer
				class="mx-auto max-h-28 max-w-2xl overflow-y-auto px-4 py-2 text-center text-[13px] leading-relaxed whitespace-pre-wrap text-white/90"
			>
				{caption}
			</footer>
		{/if}
		<div class="flex justify-center gap-2 px-4 pt-1 pb-3 sm:hidden">
			<a
				href={noteHref(viewerReel)}
				class="inline-flex h-9 items-center rounded-full border border-white/20 px-4 text-[12px] font-bold text-white transition hover:bg-white/10"
			>
				Open note
			</a>
		</div>
	</div>
{/if}
