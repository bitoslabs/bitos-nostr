<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { profileStats, highlights, profilePosts, pic } from '$lib/data/mock';
	import { shortKey } from '$lib/utils/format';

	const me = $derived(identity.current);
	const myProfile = $derived(me ? profiles.get(me.pk) : undefined);
	const displayName = $derived(myProfile?.display_name || myProfile?.name || 'You');

	const tabs = ['Posts', 'Reels', 'Saved', 'Tagged'];
	let activeTab = $state('Posts');

	const badgeColor: Record<string, string> = {
		REEL: 'bg-primary-500',
		VIDEO: 'bg-accent-500'
	};
</script>

<svelte:head><title>Profile · BitOS</title></svelte:head>

<div class="h-full overflow-y-auto">
	<!-- Cover -->
	<div class="relative h-[180px] bg-primary-500 sm:h-[200px]">
		<img
			src={pic('cover', 1200, 300)}
			class="absolute inset-0 size-full object-cover opacity-20 mix-blend-overlay"
			alt=""
		/>
		<button
			type="button"
			onclick={() => toasts.info('Edit cover')}
			class="absolute top-4 right-4 flex items-center gap-1.5 rounded-lg bg-black/30 px-3 py-1.5 text-[12px] font-semibold text-white backdrop-blur transition hover:bg-black/50"
		>
			<Icon name="i-lucide-camera" class="size-3.5" /> Edit cover
		</button>
	</div>

	<div class="mx-auto max-w-[900px] px-6">
		<!-- Header -->
		<div class="relative -mt-16 mb-5 flex flex-col gap-4 sm:flex-row sm:items-end">
			<div
				class="grid size-32 shrink-0 place-items-center rounded-3xl bg-warm-500 font-display text-4xl font-extrabold text-white shadow-xl ring-4 ring-[var(--ui-bg)]"
			>
				{(displayName || 'Y').slice(0, 2).toUpperCase()}
			</div>
			<div class="flex-1 pb-2">
				<h1
					class="font-display text-[28px] leading-tight font-extrabold tracking-tight sm:text-[30px]"
				>
					{displayName}
				</h1>
				<p class="text-[14px] text-[var(--ui-text-muted)]">
					{#if me}<span class="font-mono">{shortKey(me.npub, 10, 8)}</span>{/if}
				</p>
				<div class="mt-2 flex gap-4 text-[13px]">
					<span
						><strong class="font-bold">{profileStats.posts}</strong>
						<span class="text-[var(--ui-text-muted)]">posts</span></span
					>
					<span
						><strong class="font-bold">{profileStats.followers}</strong>
						<span class="text-[var(--ui-text-muted)]">followers</span></span
					>
					<span
						><strong class="font-bold">{profileStats.following}</strong>
						<span class="text-[var(--ui-text-muted)]">following</span></span
					>
				</div>
			</div>
			<div class="flex gap-2 pb-2">
				<a
					href="/settings"
					class="rounded-full bg-primary-500 px-5 py-2.5 text-[13px] font-bold text-white shadow-[var(--glow-primary)] transition hover:bg-primary-600"
					>Edit profile</a
				>
				<button
					type="button"
					onclick={() => toasts.success('Profile link copied')}
					class="grid size-10 place-items-center rounded-full border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] text-[var(--ui-text-muted)] transition hover:text-primary-500"
					><Icon name="i-lucide-share-2" class="size-5" /></button
				>
			</div>
		</div>

		<!-- Bio -->
		<div class="post-card mb-5 p-4">
			<p class="text-[14px] leading-relaxed">
				{myProfile?.about ||
					'Designing delightful experiences ✨ Coffee enthusiast. Probably overthinking spacing right now.'}
			</p>
			<div class="mt-3 flex flex-wrap gap-4 text-[12px] text-[var(--ui-text-muted)]">
				<span class="flex items-center gap-1.5"
					><Icon name="i-lucide-map-pin" class="size-3.5 text-primary-500" /> San Francisco, CA</span
				>
				<span class="flex items-center gap-1.5"
					><Icon name="i-lucide-link" class="size-3.5 text-primary-500" />
					{myProfile?.website || 'bitos.app'}</span
				>
				<span class="flex items-center gap-1.5"
					><Icon name="i-lucide-cake" class="size-3.5 text-primary-500" /> Joined 2024</span
				>
				{#if myProfile?.nip05}<span class="flex items-center gap-1.5"
						><Icon name="i-lucide-badge-check" class="size-3.5 text-primary-500" />
						{myProfile.nip05}</span
					>{/if}
			</div>
		</div>

		<!-- Highlights -->
		<div class="mb-5">
			<h3 class="mb-3 font-display text-[16px] font-extrabold">Highlights</h3>
			<div
				class="flex [scrollbar-width:none] gap-3 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden"
			>
				<button
					type="button"
					onclick={() => toasts.info('New highlight')}
					class="flex shrink-0 cursor-pointer flex-col items-center gap-1.5"
				>
					<div
						class="grid size-16 place-items-center rounded-2xl border-2 border-dashed border-[var(--ui-border-accented)] bg-[var(--ui-bg-muted)] text-[var(--ui-text-dimmed)]"
					>
						<Icon name="i-lucide-plus" />
					</div>
					<span class="text-[11px] font-medium text-[var(--ui-text-muted)]">New</span>
				</button>
				{#each highlights as h (h.label)}
					<button
						type="button"
						onclick={() => toasts.info(`Highlight: ${h.label}`)}
						class="flex shrink-0 cursor-pointer flex-col items-center gap-1.5"
					>
						<div
							class="grid size-16 place-items-center rounded-2xl bg-primary-500 text-xl text-white"
						>
							{h.emoji}
						</div>
						<span class="text-[11px] font-medium text-[var(--ui-text-muted)]">{h.label}</span>
					</button>
				{/each}
			</div>
		</div>

		<!-- Tabs -->
		<div class="mb-5 border-b border-[var(--ui-border-muted)]">
			<div class="flex gap-1">
				{#each tabs as t (t)}
					<button
						type="button"
						onclick={() => (activeTab = t)}
						class="border-b-2 px-4 py-3 text-[13px] font-bold transition {activeTab === t
							? 'border-primary-500 text-[var(--ui-text)]'
							: 'border-transparent text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
					>
						{t}
					</button>
				{/each}
			</div>
		</div>

		<!-- Posts grid -->
		<div class="mb-8 grid grid-cols-3 gap-2">
			{#each profilePosts as p (p.seed)}
				<div class="group relative aspect-square cursor-pointer overflow-hidden rounded-xl">
					<img src={pic(p.seed, 300, 300)} class="size-full object-cover" alt="" />
					{#if p.badge}<span
							class="absolute top-2 right-2 rounded-full px-2 py-0.5 text-[10px] font-bold text-white {badgeColor[
								p.badge
							] ?? 'bg-primary-500'}">{p.badge}</span
						>{/if}
					{#if p.likes}
						<div
							class="absolute inset-0 flex items-center justify-center gap-4 bg-black/0 text-white opacity-0 transition group-hover:bg-black/50 group-hover:opacity-100"
						>
							<span class="flex items-center gap-1.5 text-[13px] font-bold"
								><Icon name="i-lucide-heart" class="size-4" /> {p.likes}</span
							>
							<span class="flex items-center gap-1.5 text-[13px] font-bold"
								><Icon name="i-lucide-message-circle" class="size-4" /> {p.comments}</span
							>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</div>
</div>
