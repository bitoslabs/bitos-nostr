<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { reels as initialReels, pic, type Reel } from '$lib/data/mock';

	let reels = $state<Reel[]>(initialReels.map((r) => ({ ...r })));

	const colorBg: Record<string, string> = {
		primary: 'bg-primary-500',
		accent: 'bg-accent-500',
		warm: 'bg-warm-500'
	};

	function toggleLike(r: Reel) {
		r.liked = !r.liked;
		reels = [...reels];
		if (r.liked) toasts.success('Liked reel');
	}
</script>

<svelte:head><title>Reels · BitOS</title></svelte:head>

<div class="relative h-full bg-ink">
	<div
		class="reel-container h-full [scrollbar-width:none] overflow-y-auto [&::-webkit-scrollbar]:hidden"
	>
		{#each reels as r (r.id)}
			<div
				class="reel-card relative flex h-full w-full items-center justify-center overflow-hidden"
			>
				<img src={pic(r.seed, 800, 1400)} class="absolute inset-0 size-full object-cover" alt="" />
				<div class="absolute inset-0 bg-black/45"></div>

				<!-- Top bar -->
				<div class="absolute inset-x-0 top-0 z-10 flex items-center justify-between p-5">
					<h2 class="font-display text-[26px] font-extrabold text-white">Reels</h2>
					<button
						type="button"
						onclick={() => toasts.info('Reel camera')}
						class="grid size-10 place-items-center rounded-xl bg-white/15 text-white backdrop-blur transition hover:bg-white/25"
					>
						<Icon name="i-lucide-camera" class="size-5" />
					</button>
				</div>

				<!-- Right action rail -->
				<div class="absolute right-4 bottom-24 z-10 flex flex-col gap-5">
					<button type="button" onclick={() => toggleLike(r)} class="reel-action">
						<span class="icon-circle"
							><Icon
								name="i-lucide-heart"
								class="size-5 {r.liked ? 'fill-primary-500 text-primary-500' : ''}"
							/></span
						>
						<span class="text-[11px] font-semibold">{r.likes}</span>
					</button>
					<button type="button" onclick={() => toasts.info('Comments')} class="reel-action">
						<span class="icon-circle"><Icon name="i-lucide-message-circle" class="size-5" /></span>
						<span class="text-[11px] font-semibold">{r.comments}</span>
					</button>
					<button type="button" onclick={() => toasts.success('Shared!')} class="reel-action">
						<span class="icon-circle"><Icon name="i-lucide-share" class="size-5" /></span>
						<span class="text-[11px] font-semibold">Share</span>
					</button>
					<button type="button" onclick={() => toasts.success('Saved!')} class="reel-action">
						<span class="icon-circle"><Icon name="i-lucide-bookmark" class="size-5" /></span>
						<span class="text-[11px] font-semibold">Save</span>
					</button>
					<div class="spin-slow mt-2 size-10 overflow-hidden rounded-full border-2 border-white">
						<img src={pic(r.avatarSeed, 80, 80)} class="size-full object-cover" alt="" />
					</div>
				</div>

				<!-- Bottom info -->
				<div class="absolute inset-x-0 bottom-0 z-10 p-5 pr-20 text-white">
					<div class="mb-3 flex items-center gap-3">
						<div
							class="grid size-10 place-items-center rounded-full text-sm font-bold ring-2 ring-white {colorBg[
								r.color
							]}"
						>
							{r.initials}
						</div>
						<div class="flex-1">
							<p class="text-[14px] font-bold">{r.handle}</p>
							<p class="text-[11px] opacity-80">{r.role}</p>
						</div>
						<button
							type="button"
							class="rounded-full bg-primary-500 px-4 py-1.5 text-[12px] font-bold text-white shadow-[var(--glow-primary)] transition hover:bg-primary-600"
							>Follow</button
						>
					</div>
					<p class="mb-3 text-[13.5px] leading-relaxed">{r.caption}</p>
					<div class="flex items-center gap-2 text-[12px]">
						<Icon name="i-lucide-music" class="size-4" />
						<span class="font-semibold">{r.audio}</span>
					</div>
				</div>
			</div>
		{/each}
	</div>

	<!-- side dots -->
	<div class="absolute top-1/2 right-2 z-20 hidden -translate-y-1/2 flex-col gap-2">
		<div class="h-8 w-1 rounded-full bg-white"></div>
		<div class="h-4 w-1 rounded-full bg-white/40"></div>
		<div class="h-4 w-1 rounded-full bg-white/40"></div>
	</div>
</div>
