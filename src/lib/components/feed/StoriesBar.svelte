<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { stories, type StoryAuthor } from '$lib/nostr/stories.svelte';
	import StoryViewer from './StoryViewer.svelte';
	import StoryComposer from './StoryComposer.svelte';

	const me = $derived(identity.current);

	// Authors excluding the current user (their tile is rendered separately).
	const otherAuthors = $derived(
		stories.authors.filter((a) => a.pubkey !== me?.pk?.toLowerCase() && !a.isPublicDiscovery)
	);
	const publicAuthors = $derived(stories.authors.filter((a) => a.isPublicDiscovery));
	const myAuthor = $derived(stories.authors.find((a) => a.pubkey === me?.pk?.toLowerCase()));
	const storyAuthors = $derived(
		myAuthor ? [myAuthor, ...otherAuthors, ...publicAuthors] : [...otherAuthors, ...publicAuthors]
	);
	let viewing = $state<StoryAuthor | null>(null);
	let composing = $state(false);

	function openAuthor(author: StoryAuthor) {
		viewing = author;
	}

	function nextAuthor() {
		const current = viewing;
		if (!current) return;
		const idx = storyAuthors.findIndex((a) => a.pubkey === current.pubkey);
		viewing = storyAuthors[idx + 1] ?? null;
	}

	function nameFor(pubkey: string) {
		const p = profiles.get(pubkey);
		return p?.display_name || p?.name || pubkey.slice(0, 8);
	}

	function latestSlide(author?: StoryAuthor) {
		return author?.slides[0];
	}

	function noteFor(author: StoryAuthor) {
		return author.slides.find((slide) => slide.content.trim())?.content.trim() ?? '';
	}

	function previewStyle(author?: StoryAuthor) {
		const slide = latestSlide(author);
		if (slide?.imageUrl) return '';
		return (
			slide?.bg ?? 'linear-gradient(135deg, var(--ui-color-primary-500), var(--color-accent-500))'
		);
	}

	// Signature FB/IG gradient ring for unseen, muted ring for seen.
	// Your own story always reads as "unseen" to you.
	function ringClass(author: StoryAuthor) {
		const mine = author.pubkey === me?.pk?.toLowerCase();
		return mine || author.hasUnseen
			? 'bg-gradient-to-tr from-primary-500 via-accent-500 to-warm-500'
			: 'bg-[var(--ui-border-accented)]';
	}

	const myProfile = $derived(me ? profiles.get(me.pk) : undefined);
	const myPicture = $derived(myProfile?.picture);
</script>

{#snippet storyCard(author: StoryAuthor)}
	<button
		type="button"
		onclick={() => openAuthor(author)}
		class="group relative h-[200px] w-[112px] shrink-0 overflow-hidden rounded-[18px] bg-[var(--ui-bg-muted)] text-left shadow-sm ring-1 ring-[var(--ui-border-muted)] transition duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/10"
	>
		{#if latestSlide(author)?.imageUrl}
			<img
				src={latestSlide(author)?.imageUrl}
				alt=""
				class="absolute inset-0 size-full object-cover object-center transition duration-300 group-hover:scale-105"
				loading="lazy"
			/>
		{:else}
			<div
				class="absolute inset-0 transition duration-300 group-hover:scale-[1.03]"
				style="background:{previewStyle(author)}"
			>
				<div class="flex h-full items-center justify-center p-3 pb-7">
					<p
						class="line-clamp-4 text-center text-[14px] leading-snug font-bold break-words text-white [text-shadow:0_1px_4px_rgba(0,0,0,0.45)]"
					>
						{noteFor(author) || nameFor(author.pubkey)}
					</p>
				</div>
			</div>
		{/if}

		<div class="absolute inset-0 bg-gradient-to-b from-black/5 via-transparent to-black/70"></div>

		<div class="story-ring-frame hex-clip absolute top-3 left-3 p-[3px] {ringClass(author)}">
			<div class="story-ring-inner hex-clip bg-[var(--ui-bg-elevated)] p-[2px] shadow-sm">
				<Avatar
					pubkey={author.pubkey}
					name={nameFor(author.pubkey)}
					picture={profiles.get(author.pubkey)?.picture}
					size={34}
				/>
			</div>
		</div>

		{#if author.isPublicDiscovery}
			<span
				class="absolute top-3 right-2 rounded-full bg-black/45 px-1.5 py-0.5 text-[9px] font-bold text-white"
				>Public</span
			>
		{/if}

		<span
			class="absolute inset-x-3 bottom-3 flex items-center gap-1 text-left text-[13px] font-bold text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.55)]"
		>
			<span class="truncate">{nameFor(author.pubkey)}</span>
			{#if profiles.get(author.pubkey)?.nip05}
				<Icon name="i-lucide-badge-check" class="size-3 shrink-0 text-white/90" />
			{/if}
		</span>
	</button>
{/snippet}

<div class="overflow-hidden border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-0.5 py-4">
	<div
		class="flex [scrollbar-width:none] gap-2.5 overflow-x-auto pb-2 [&::-webkit-scrollbar]:hidden"
	>
		<!-- Create story -->
		<div
			class="relative h-[200px] w-[112px] shrink-0 overflow-hidden rounded-2xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-elevated)] shadow-sm transition hover:shadow-md"
		>
			<button
				type="button"
				onclick={() => (composing = true)}
				class="group absolute inset-0 text-left"
				aria-label="Create story"
			>
				<!-- Cover: your own avatar / picture as cover -->
				<div class="absolute inset-x-0 top-0 h-[68%] overflow-hidden">
					{#if myPicture}
						<img
							src={myPicture}
							alt=""
							class="size-full object-cover transition duration-300 group-hover:scale-105"
						/>
					{:else}
						<div class="size-full bg-gradient-to-br from-primary-500/80 to-accent-500/80"></div>
						{#if me}
							<div class="absolute inset-0 grid place-items-center">
								<Avatar
									pubkey={me.pk}
									name={myProfile?.display_name || myProfile?.name || 'You'}
									picture={myPicture}
									size={56}
								/>
							</div>
						{/if}
					{/if}
					<div class="absolute inset-0 bg-gradient-to-t from-black/35 to-transparent"></div>
				</div>

				<!-- Create button overlapping the boundary -->
				<span
					class="absolute right-0 bottom-[36%] left-0 mx-auto grid size-9 place-items-center rounded-full bg-primary-500 text-white shadow-[var(--glow-primary)] ring-4 ring-[var(--ui-bg-elevated)] transition group-hover:scale-105 group-hover:bg-primary-600"
				>
					<Icon name="i-lucide-plus" class="size-5" />
				</span>

				<!-- Label -->
				<span
					class="absolute inset-x-2 bottom-3 text-center text-[13px] leading-tight font-bold text-[var(--ui-text)]"
				>
					Create story
				</span>
			</button>
		</div>

		<!-- Story authors: your current story first, then following -->
		{#if myAuthor}
			{@render storyCard(myAuthor)}
		{/if}

		{#each otherAuthors as author (author.pubkey)}
			{@render storyCard(author)}
		{/each}

		{#if publicAuthors.length}
			<div class="flex h-[200px] shrink-0 items-center px-1" aria-hidden="true">
				<div class="h-3/4 w-px bg-[var(--ui-border-muted)]"></div>
			</div>
			<div class="flex h-[200px] w-[112px] shrink-0 flex-col justify-center gap-2 px-1 text-center">
				<Icon name="i-lucide-compass" class="mx-auto size-5 text-accent-500" />
				<span class="text-[11px] leading-tight font-bold text-[var(--ui-text-muted)]"
					>Public stories</span
				>
			</div>
			{#each publicAuthors as author (author.pubkey)}
				{@render storyCard(author)}
			{/each}
			{#if stories.publicHasMore}
				<button
					type="button"
					onclick={() => stories.loadMorePublic()}
					disabled={stories.publicLoading || stories.loading}
					class="flex h-[200px] w-[112px] shrink-0 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--ui-border)] px-3 text-center text-[12px] font-bold text-[var(--ui-text-muted)] transition hover:border-primary-500/40 hover:text-primary-500 disabled:cursor-wait disabled:opacity-60"
					aria-label="Load more public stories"
				>
					{#if stories.publicLoading}
						<Icon name="i-lucide-loader-circle" class="size-5 animate-spin text-accent-500" />
						Loading more
					{:else}
						<Icon name="i-lucide-plus" class="size-5 text-accent-500" />
						Load more
					{/if}
				</button>
			{/if}
		{/if}

		{#if storyAuthors.length === 0 && !stories.loading}
			<button
				type="button"
				onclick={() => (composing = true)}
				class="flex h-[200px] w-[112px] shrink-0 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--ui-border)] bg-[var(--surface-bg)] px-3 text-center text-[12px] font-bold text-[var(--ui-text-muted)] transition hover:border-primary-500/40 hover:text-primary-500"
			>
				<Icon name="i-lucide-sparkles" class="size-5 text-accent-500" />
				Be the first to post a story
			</button>
		{/if}
	</div>
</div>

{#if viewing}
	<StoryViewer author={viewing} onclose={() => (viewing = null)} onnext={nextAuthor} />
{/if}

<StoryComposer bind:open={composing} onposted={() => stories.start()} />
