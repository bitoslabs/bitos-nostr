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
	const otherAuthors = $derived(stories.authors.filter((a) => a.pubkey !== me?.pk?.toLowerCase()));
	const myAuthor = $derived(stories.authors.find((a) => a.pubkey === me?.pk?.toLowerCase()));
	const storyAuthors = $derived(myAuthor ? [myAuthor, ...otherAuthors] : otherAuthors);
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

	function noteFor(author: StoryAuthor) {
		return author.slides.find((slide) => slide.content.trim())?.content.trim() ?? '';
	}

	function latestSlide(author?: StoryAuthor) {
		return author?.slides[0];
	}

	function previewStyle(author?: StoryAuthor) {
		const slide = latestSlide(author);
		if (slide?.imageUrl) return '';
		return slide?.bg ?? 'linear-gradient(135deg, var(--ui-color-primary-500), var(--color-accent-500))';
	}
</script>

<div class="overflow-hidden border-y border-[var(--ui-border-muted)] bg-[var(--ui-bg)] py-3">
	<div
		class="flex [scrollbar-width:none] gap-3 overflow-x-auto px-4 pb-0.5 [&::-webkit-scrollbar]:hidden"
	>
		<!-- Create story -->
		<div
			class="relative h-[150px] w-[112px] shrink-0 overflow-hidden rounded-2xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] shadow-sm"
		>
			<button
				type="button"
				onclick={() => (composing = true)}
				class="group absolute inset-0 text-left"
				aria-label="Add story"
			>
				<div class="absolute inset-x-0 top-0 h-[66%] bg-[var(--ui-text-highlighted)]"></div>
				<div class="absolute inset-x-0 bottom-0 h-[42%] bg-[var(--ui-bg-elevated)]"></div>
				<span
					class="absolute inset-x-2 bottom-4 text-center text-[14px] leading-tight font-extrabold text-[var(--ui-text)]"
				>
					Your story
				</span>
				<span
					class="absolute right-0 bottom-[52px] left-0 mx-auto grid size-12 place-items-center rounded-full bg-primary-500 text-white ring-4 ring-[var(--ui-bg-elevated)] shadow-[var(--glow-primary)] transition group-hover:bg-primary-600"
				>
					<Icon name="i-lucide-plus" class="size-7" />
				</span>
			</button>
		</div>

		<!-- Story authors: your current story first, then following -->
		{#each storyAuthors as author (author.pubkey)}
			<button
				type="button"
				onclick={() => openAuthor(author)}
				class="group relative h-[150px] w-[112px] shrink-0 overflow-hidden rounded-2xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary-500/30"
			>
				{#if latestSlide(author)?.imageUrl}
					<img
						src={latestSlide(author)?.imageUrl}
						alt=""
						class="absolute inset-0 size-full object-cover object-center transition duration-300 group-hover:scale-105"
					/>
				{:else}
					<div class="absolute inset-0" style="background:{previewStyle(author)}"></div>
				{/if}
				<div class="absolute inset-0 bg-gradient-to-b from-black/10 via-black/0 to-black/75"></div>
				<div
					class="absolute top-4 left-1/2 -translate-x-1/2 rounded-full p-[3px] {author.hasUnseen
						? 'bg-primary-500'
						: 'bg-white/35'}"
				>
					<Avatar
						pubkey={author.pubkey}
						name={nameFor(author.pubkey)}
						picture={profiles.get(author.pubkey)?.picture}
						size={42}
						frame
					/>
				</div>
				<p
					class="absolute inset-x-3 top-[62px] line-clamp-2 text-center text-[14px] leading-tight font-extrabold text-white"
				>
					{noteFor(author) || nameFor(author.pubkey)}
				</p>
				{#if author.hasUnseen}
					<span
						class="absolute top-3 right-3 size-2.5 rounded-full bg-primary-500 ring-2 ring-white/80"
					></span>
				{/if}
				<span class="absolute inset-x-3 bottom-4 truncate text-[14px] leading-tight font-extrabold text-white">
					{nameFor(author.pubkey)}
				</span>
			</button>
		{/each}

		{#if storyAuthors.length === 0 && !stories.loading}
			<button
				type="button"
				onclick={() => (composing = true)}
				class="flex h-[150px] w-[112px] shrink-0 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--ui-border)] bg-[var(--surface-bg)] px-3 text-center text-[12px] font-bold text-[var(--ui-text-muted)] transition hover:border-primary-500/40 hover:text-primary-500"
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
