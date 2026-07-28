<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { trendTags, topCreators, exploreTiles, pic } from '$lib/data/mock';

	const colorBg: Record<string, string> = {
		primary: 'bg-primary-500',
		accent: 'bg-accent-500',
		warm: 'bg-warm-500'
	};

	const tabs = ['For you', 'Photos', 'Videos', 'Reels'];
	let activeTab = $state('For you');
	let following = $state<Record<string, boolean>>({});
	const badgeColor: Record<string, string> = {
		REEL: 'bg-primary-500',
		PHOTO: 'bg-warm-500 text-ink',
		VIDEO: 'bg-accent-500'
	};
</script>

<svelte:head><title>Discover · BitOS</title></svelte:head>

<div class="h-full overflow-y-auto">
	<div class="mx-auto max-w-[1100px] px-6 py-6">
		<!-- Header -->
		<div class="mb-6">
			<h1 class="font-display text-[34px] leading-none font-extrabold tracking-tight">Discover</h1>
			<p class="mt-1.5 text-[13px] text-[var(--ui-text-muted)]">
				Explore what's trending across Pulse
			</p>
		</div>

		<!-- Search -->
		<div class="relative mb-6">
			<Icon
				name="i-lucide-search"
				class="absolute top-1/2 left-4 size-5 -translate-y-1/2 text-[var(--ui-text-dimmed)]"
			/>
			<input
				type="text"
				placeholder="Search creators, hashtags, sounds…"
				class="w-full rounded-2xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] py-3.5 pr-32 pl-12 text-[14px] transition outline-none placeholder:text-[var(--ui-text-dimmed)] focus:ring-2 focus:ring-primary-500/30"
			/>
			<button
				type="button"
				onclick={() => toasts.info('Searching…')}
				class="absolute top-1/2 right-2 -translate-y-1/2 rounded-xl bg-primary-500 px-4 py-2 text-[12px] font-bold text-white shadow-[var(--glow-primary)] transition hover:bg-primary-600"
				>Search</button
			>
		</div>

		<!-- Trending tags -->
		<div class="mb-6">
			<h3 class="mb-3 font-display text-[18px] font-extrabold">Trending tags</h3>
			<div class="flex flex-wrap gap-2">
				{#each trendTags as t (t.tag)}
					<button type="button" onclick={() => toasts.info(`Exploring ${t.tag}`)} class="trend-tag">
						{#if t.icon}<Icon
								name={t.icon}
								class={t.icon === 'i-lucide-flame'
									? 'size-3.5 text-primary-500'
									: 'size-3.5 text-accent-500'}
							/>{/if}
						{t.tag}
						<span class="font-normal text-[var(--ui-text-dimmed)]">{t.count}</span>
					</button>
				{/each}
			</div>
		</div>

		<!-- Top creators -->
		<div class="mb-8">
			<div class="mb-3 flex items-center justify-between">
				<h3 class="font-display text-[18px] font-extrabold">Top creators this week</h3>
				<button type="button" class="text-[12px] font-semibold text-primary-500 hover:underline"
					>See all</button
				>
			</div>
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
				{#each topCreators as c (c.name)}
					<div class="post-card cursor-pointer p-4 text-center">
						<div
							class="mx-auto mb-2 grid size-16 place-items-center rounded-2xl font-bold text-white {colorBg[
								c.color
							]}"
						>
							{c.initials}
						</div>
						<p class="text-[13px] font-bold">{c.name}</p>
						<p class="mb-2 text-[11px] text-[var(--ui-text-muted)]">{c.role} · {c.followers}</p>
						<button
							type="button"
							onclick={() => {
								following[c.name] = !following[c.name];
								following = { ...following };
							}}
							class="w-full rounded-full py-1.5 text-[11px] font-bold transition-colors {following[
								c.name
							]
								? 'bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)]'
								: 'bg-primary-500 text-white hover:bg-primary-600'}"
						>
							{following[c.name] ? 'Following' : 'Follow'}
						</button>
					</div>
				{/each}
			</div>
		</div>

		<!-- Explore grid -->
		<div class="mb-6">
			<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
				<h3 class="font-display text-[18px] font-extrabold">Explore</h3>
				<div class="flex gap-1">
					{#each tabs as t (t)}
						<button
							type="button"
							onclick={() => (activeTab = t)}
							class="pill-tab {activeTab === t ? 'active' : ''}">{t}</button
						>
					{/each}
				</div>
			</div>

			<div class="masonry">
				{#each exploreTiles as tile (tile.seed)}
					<div
						class="group relative cursor-pointer overflow-hidden rounded-xl transition-transform hover:scale-[0.97]"
					>
						<img
							src={pic(
								tile.seed,
								400,
								tile.seed === 'exp3' || tile.seed === 'exp12'
									? 600
									: tile.seed === 'exp1' || tile.seed === 'exp10'
										? 500
										: 400
							)}
							class="w-full"
							alt=""
						/>
						{#if tile.badge}
							<span
								class="absolute top-2 right-2 rounded-full px-2 py-0.5 text-[10px] font-bold text-white {badgeColor[
									tile.badge
								] ?? 'bg-primary-500'}">{tile.badge}</span
							>
						{/if}
						<div
							class="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/40"
						>
							<div class="text-center text-white opacity-0 transition group-hover:opacity-100">
								<Icon name="i-lucide-heart" class="mx-auto size-6" />
								<p class="mt-1 text-[12px] font-bold">2.4K</p>
							</div>
						</div>
					</div>
				{/each}
			</div>
		</div>
	</div>
</div>
