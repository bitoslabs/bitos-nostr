<script lang="ts">
	import { onMount } from 'svelte';
	import { noteEncode } from 'nostr-tools/nip19';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { queryOnce } from '$lib/nostr/pool';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { NOSTR_KINDS } from '$lib/nostr/types';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { shortKey, timeAgo } from '$lib/utils/format';

	type ReelNote = {
		id: string;
		pubkey: string;
		content: string;
		createdAt: number;
		videoUrl: string;
	};

	const videoPattern = /https?:\/\/\S+\.(?:m3u8|m4v|mov|mp4|webm)(?:[?#]\S*)?/i;

	let loading = $state(true);
	let reels = $state<ReelNote[]>([]);
	let liked = $state<Record<string, boolean>>({});
	let saved = $state<Record<string, boolean>>({});

	function extractVideo(content: string) {
		return content.match(videoPattern)?.[0] ?? '';
	}

	async function loadReels() {
		loading = true;
		try {
			const events = await queryOnce([{ kinds: [NOSTR_KINDS.TEXT_NOTE], limit: 400 }]);
			const seen: Record<string, true> = {};
			reels = events
				.sort((a, b) => b.created_at - a.created_at)
				.map((event) => ({ event, videoUrl: extractVideo(event.content) }))
				.filter(({ event, videoUrl }) => {
					if (!videoUrl || seen[event.id]) return false;
					seen[event.id] = true;
					return true;
				})
				.slice(0, 40)
				.map(({ event, videoUrl }) => ({
					id: event.id,
					pubkey: event.pubkey,
					content: event.content,
					createdAt: event.created_at,
					videoUrl
				}));
			profiles.ensure(reels.map((reel) => reel.pubkey));
		} catch (e) {
			toasts.error((e as Error).message || 'Could not load reels');
		} finally {
			loading = false;
		}
	}

	function toggleLike(id: string) {
		liked = { ...liked, [id]: !liked[id] };
	}

	function toggleSave(id: string) {
		saved = { ...saved, [id]: !saved[id] };
		toasts.success(saved[id] ? 'Removed from saved' : 'Saved');
	}

	onMount(() => {
		void loadReels();
	});
</script>

<svelte:head><title>Reels · BitOS</title></svelte:head>

<div class="relative h-full bg-[var(--ui-bg)] text-[var(--ui-text)]">
	<div
		class="reel-container h-full snap-y snap-mandatory [scrollbar-width:none] overflow-y-auto [&::-webkit-scrollbar]:hidden"
	>
		{#if loading}
			<div class="flex h-full items-center justify-center">
				<div
					class="size-8 animate-spin rounded-full border-2 border-[var(--ui-border)] border-t-primary-500"
				></div>
			</div>
		{:else if reels.length}
			{#each reels as reel (reel.id)}
				{@const profile = profiles.get(reel.pubkey)}
				{@const name = profile?.display_name || profile?.name || shortKey(reel.pubkey)}
				<div
					class="reel-card relative flex h-full w-full snap-start items-center justify-center overflow-hidden bg-black text-white"
				>
					<!-- svelte-ignore a11y_media_has_caption -->
					<video
						src={reel.videoUrl}
						class="absolute inset-0 size-full object-cover"
						aria-label="Relay video note"
						controls
						loop
						playsinline
						preload="metadata"
					></video>
					<div
						class="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/70"
					></div>

					<div class="absolute inset-x-0 top-0 z-10 flex items-center justify-between p-5">
						<h2 class="font-display text-[26px] font-extrabold text-white">Reels</h2>
						<button
							type="button"
							onclick={loadReels}
							class="grid size-10 place-items-center rounded-xl bg-white/15 text-white backdrop-blur transition hover:bg-white/25"
							aria-label="Refresh reels"
						>
							<Icon name="i-lucide-rotate-cw" class="size-5" />
						</button>
					</div>

					<div class="absolute right-4 bottom-24 z-10 flex flex-col gap-5">
						<button type="button" onclick={() => toggleLike(reel.id)} class="reel-action">
							<span class="icon-circle">
								<Icon
									name="i-lucide-heart"
									class="size-5 {liked[reel.id] ? 'fill-primary-500 text-primary-500' : ''}"
								/>
							</span>
							<span class="text-[11px] font-semibold">Like</span>
						</button>
						<button
							type="button"
							onclick={() => {
								navigator.clipboard.writeText(`nostr:${noteEncode(reel.id)}`);
								toasts.success('Note ID copied');
							}}
							class="reel-action"
						>
							<span class="icon-circle"><Icon name="i-lucide-share" class="size-5" /></span>
							<span class="text-[11px] font-semibold">Share</span>
						</button>
						<button type="button" onclick={() => toggleSave(reel.id)} class="reel-action">
							<span class="icon-circle">
								<Icon
									name={saved[reel.id] ? 'i-lucide-bookmark-check' : 'i-lucide-bookmark'}
									class="size-5"
								/>
							</span>
							<span class="text-[11px] font-semibold">Save</span>
						</button>
						<a
							href={`/profile/${reel.pubkey}`}
							class="spin-slow mt-2 size-10 overflow-hidden rounded-full border-2 border-white"
							aria-label="Open profile"
						>
							<Avatar pubkey={reel.pubkey} {name} picture={profile?.picture} size={40} />
						</a>
					</div>

					<div class="absolute inset-x-0 bottom-0 z-10 p-5 pr-20 text-white">
						<div class="mb-3 flex items-center gap-3">
							<Avatar
								pubkey={reel.pubkey}
								{name}
								picture={profile?.picture}
								size={40}
								class="ring-2 ring-white"
							/>
							<div class="min-w-0 flex-1">
								<a href={`/profile/${reel.pubkey}`} class="truncate text-[14px] font-bold">
									{name}
								</a>
								<p class="text-[11px] opacity-80">{timeAgo(reel.createdAt)}</p>
							</div>
						</div>
						<p class="line-clamp-4 text-[13.5px] leading-relaxed">{reel.content}</p>
					</div>
				</div>
			{/each}
		{:else}
			<div class="flex h-full items-center justify-center px-6">
				<div class="max-w-sm text-center">
					<div
						class="mx-auto mb-4 grid size-16 place-items-center rounded-2xl bg-[var(--ui-bg-muted)] text-[var(--ui-text-dimmed)]"
					>
						<Icon name="i-lucide-clapperboard" class="size-8" />
					</div>
					<h1 class="font-display text-[28px] font-extrabold">No reels found</h1>
					<p class="mt-2 text-[13px] leading-relaxed text-[var(--ui-text-muted)]">
						Your configured relays did not return kind-1 notes with video links.
					</p>
					<button
						type="button"
						onclick={loadReels}
						class="mt-5 rounded-full bg-primary-500 px-5 py-2.5 text-[13px] font-bold text-white shadow-[var(--glow-primary)] transition hover:bg-primary-600"
					>
						Refresh
					</button>
				</div>
			</div>
		{/if}
	</div>
</div>
