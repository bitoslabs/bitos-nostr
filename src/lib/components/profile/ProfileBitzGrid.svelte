<script lang="ts">
	/**
	 * Bitz grid for the profile page: the author's short-form media (NIP-71
	 * video + NIP-68 pictures) as a TikTok-discover-style 9/16 tile grid.
	 * Videos preview (muted) on hover with a duration badge; pictures show a
	 * lazy thumbnail. Sensitive media is blurred until tapped.
	 *
	 * Tapping a tile launches the SHARED reels player (`/bitz?author=<npub>
	 * #bitz=<id>`) — the same swipe-up/down surface as the Bitz tab, with the
	 * full action rail (like, comments, zap, share/repost, remix). One player,
	 * context-aware data — the TikTok/Instagram grid→player pattern.
	 */
	import { goto } from '$app/navigation';
	import { npubEncode } from 'nostr-tools/nip19';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { lazyVideoMetadata } from '$lib/utils/media';
	import { formatDuration } from '$lib/utils/format';
	import { bitzHashLink } from '$lib/utils/bitz-links';
	import { sensitiveMediaReason } from '$lib/utils/sensitive-media';
	import { privacyNotificationSettings } from '$lib/stores/privacy-notification-settings.svelte';
	import type { ReelNote } from '$lib/stores/bitz-session.svelte';

	let {
		reels,
		pubkey,
		loading = false
	}: { reels: ReelNote[]; pubkey: string; loading?: boolean } = $props();

	let durations = $state<Record<string, number>>({});
	let failed = $state<Record<string, boolean>>({});
	let revealed = $state<Record<string, boolean>>({});

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

	/** No-JS / modifier-click fallback: the note thread. */
	function noteHref(reel: ReelNote) {
		return `/note/${reel.id}?from=bitz&returnTo=${encodeURIComponent(location.pathname)}`;
	}

	/** Open the shared reels player scoped to this author, starting at this
	 *  bitz. Chronological author order means the tapped tile is the first
	 *  thing on screen; swipe up/down walks the author's bitz. */
	function openInPlayer(reel: ReelNote) {
		goto(`/bitz?author=${npubEncode(pubkey)}${bitzHashLink(reel.id)}`);
	}
</script>

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
					// the bitz in the shared reels player. Modifier clicks (cmd/ctrl,
					// shift, alt) fall through to the note link natively.
					if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
					event.preventDefault();
					if (covered) revealed = { ...revealed, [reel.id]: true };
					else openInPlayer(reel);
				}}
				class="group focus-brand relative aspect-[9/16] overflow-hidden rounded-xl bg-black ring-1 ring-[var(--ui-border-muted)] transition"
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
