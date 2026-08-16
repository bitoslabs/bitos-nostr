<script lang="ts">
	/**
	 * Skeleton placeholder for PostCard while the first relay fetch is in
	 * flight. Mirrors the real card's rail layout (44px hex avatar + content
	 * column) so the swap to live notes causes no layout shift.
	 */
	let { index = 0 }: { index?: number } = $props();
</script>

<article
	class="post-card fade-up relative flex gap-3 px-4 pt-4"
	style="animation-delay:{index * 0.08}s"
	aria-hidden="true"
>
	<div class="hex-clip shimmer size-11 shrink-0 bg-[var(--ui-bg-muted)]"></div>
	<div class="min-w-0 flex-1">
		<div class="flex items-center gap-2.5 pt-1.5">
			<div class="shimmer h-3.5 w-28 rounded bg-[var(--ui-bg-muted)]"></div>
			<div class="shimmer h-3 w-16 rounded bg-[var(--ui-bg-muted)]"></div>
		</div>
		<div class="mt-3 space-y-2.5">
			<div class="shimmer h-3 w-full rounded bg-[var(--ui-bg-muted)]"></div>
			<div class="shimmer h-3 w-[92%] rounded bg-[var(--ui-bg-muted)]"></div>
			<div class="shimmer h-3 w-[45%] rounded bg-[var(--ui-bg-muted)]"></div>
		</div>
		<div class="mt-4.5 flex items-center gap-10 pb-1">
			{#each Array(4) as _, i (i)}
				<div class="shimmer size-4 rounded-full bg-[var(--ui-bg-muted)]"></div>
			{/each}
		</div>
	</div>
</article>
