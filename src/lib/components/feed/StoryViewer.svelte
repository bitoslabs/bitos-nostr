<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import { stories, type StoryAuthor } from '$lib/nostr/stories.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { timeAgo } from '$lib/utils/format';

	let {
		author,
		onclose,
		onnext
	}: { author: StoryAuthor; onclose: () => void; onnext?: () => void } = $props();

	let slideIndex = $state(0);
	let paused = $state(false);

	const profile = $derived(profiles.get(author.pubkey));
	const displayName = $derived(profile?.display_name || profile?.name || 'Someone');
	const slides = $derived(author.slides);
	const slide = $derived(slides[slideIndex]);
	const durationMs = $derived(slide?.imageUrl ? 5000 : 7000);

	// Auto-advance: restart the timer whenever the slide / pause state changes.
	$effect(() => {
		if (paused || !slide) return;
		const ms = durationMs;
		const t = setTimeout(() => advance(), ms);
		return () => clearTimeout(t);
	});

	// Mark seen as soon as the viewer opens.
	$effect(() => {
		stories.markSeen(author.pubkey);
	});

	function advance() {
		if (slideIndex < slides.length - 1) {
			slideIndex += 1;
		} else if (onnext) {
			onnext();
		} else {
			onclose();
		}
	}

	function back() {
		if (slideIndex > 0) slideIndex -= 1;
	}

	function onViewportClick(e: MouseEvent) {
		const target = e.currentTarget as HTMLElement;
		const x = e.clientX - target.getBoundingClientRect().left;
		if (x < target.clientWidth / 2) back();
		else advance();
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
		else if (e.key === 'ArrowRight') advance();
		else if (e.key === 'ArrowLeft') back();
		else if (e.key === ' ') {
			e.preventDefault();
			paused = !paused;
		}
	}
</script>

<svelte:window onkeydown={onKey} />

<div class="fixed inset-0 z-50 flex items-center justify-center bg-black">
	<div
		class="relative aspect-[9/16] h-full max-h-screen w-auto overflow-hidden bg-black sm:h-[92vh] sm:rounded-xl"
	>
		<!-- Progress bars -->
		<div class="absolute inset-x-0 top-0 z-20 flex gap-1 p-2">
			{#each slides as _, i (i)}
				<div class="h-[3px] flex-1 overflow-hidden rounded-full bg-white/30">
					{#if i < slideIndex}
						<div class="h-full w-full bg-white"></div>
					{:else if i === slideIndex}
						<div
							class="h-full bg-white"
							style="animation: story-progress {durationMs}ms linear forwards; animation-play-state: {paused
								? 'paused'
								: 'running'}"
						></div>
					{/if}
				</div>
			{/each}
		</div>

		<!-- Header -->
		<div class="absolute inset-x-0 top-0 z-40 flex items-center gap-2 p-3 pt-6">
			<a
				href={`/profile/${author.pubkey}`}
				onclick={onclose}
				class="flex min-w-0 flex-1 items-center gap-2 rounded-full pr-2 transition hover:bg-white/10"
				aria-label={`View ${displayName}'s profile`}
			>
				<Avatar
					pubkey={author.pubkey}
					name={displayName}
					picture={profile?.picture}
					size={32}
					class="ring-2 ring-black/30"
				/>
				<div class="min-w-0 flex-1">
					<p class="truncate text-[13px] font-bold text-white">{displayName}</p>
					<p class="text-[11px] text-white/70">{slide ? timeAgo(slide.createdAt) : ''}</p>
				</div>
			</a>
			<button
				type="button"
				onclick={() => (paused = !paused)}
				class="grid size-8 place-items-center rounded-full text-white/80 transition hover:bg-white/10"
				aria-label={paused ? 'Play' : 'Pause'}
			>
				<Icon name={paused ? 'i-lucide-play' : 'i-lucide-pause'} class="size-4" />
			</button>
			<button
				type="button"
				onclick={onclose}
				class="grid size-8 place-items-center rounded-full text-white/80 transition hover:bg-white/10"
				aria-label="Close"
			>
				<Icon name="i-lucide-x" class="size-5" />
			</button>
		</div>

		<!-- Slide -->
		{#if slide}
			{#if slide.imageUrl}
				<img src={slide.imageUrl} alt="" class="size-full object-cover" />
				{#if slide.content.trim()}
					<div
						class="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-4 pb-6"
					>
						<p class="text-[15px] font-semibold break-words whitespace-pre-wrap text-white">
							{slide.content}
						</p>
					</div>
				{/if}
			{:else}
				<div
					class="flex size-full items-center justify-center p-6"
					style={slide.bg
						? `background:${slide.bg}`
						: 'background:linear-gradient(135deg, var(--color-primary-600), var(--color-accent-500))'}
				>
					<p
						class="max-h-full overflow-auto text-center text-[24px] leading-snug font-extrabold break-words whitespace-pre-wrap text-white"
					>
						{slide.content || ' '}
					</p>
				</div>
			{/if}

			<!-- Tap zones -->
			<button
				type="button"
				class="absolute inset-y-0 left-0 z-30 w-1/3 focus:outline-none"
				onclick={back}
				aria-label="Previous"
				tabindex="-1"
			></button>
			<button
				type="button"
				class="absolute inset-y-0 right-0 z-30 w-2/3 focus:outline-none"
				onclick={onViewportClick}
				aria-label="Next"
				tabindex="-1"
			></button>
		{/if}

		{#if slides.length > 1}
			<div
				class="absolute bottom-2 left-1/2 z-20 -translate-x-1/2 rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-semibold text-white/80"
			>
				{slideIndex + 1} / {slides.length}
			</div>
		{/if}
	</div>
</div>

<style>
	@keyframes story-progress {
		from {
			width: 0%;
		}
		to {
			width: 100%;
		}
	}
</style>
