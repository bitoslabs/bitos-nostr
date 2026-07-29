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
	const myProfile = $derived(me ? profiles.get(me.pk) : undefined);
	const myName = $derived(myProfile?.display_name || myProfile?.name || 'You');

	let viewing = $state<StoryAuthor | null>(null);
	let composing = $state(false);

	function openAuthor(author: StoryAuthor) {
		viewing = author;
	}

	function nextAuthor() {
		const current = viewing;
		if (!current) return;
		const idx = otherAuthors.findIndex((a) => a.pubkey === current.pubkey);
		viewing = otherAuthors[idx + 1] ?? null;
	}

	function nameFor(pubkey: string) {
		const p = profiles.get(pubkey);
		return p?.display_name || p?.name || pubkey.slice(0, 8);
	}

	function noteFor(author?: StoryAuthor) {
		return author?.slides.find((slide) => slide.content.trim())?.content.trim() ?? '';
	}

	function noteBadge(author?: StoryAuthor) {
		const note = noteFor(author);
		return note.length > 18 ? `${note.slice(0, 18).trimEnd()}…` : note;
	}
</script>

<div class="post-card p-4">
	<div class="flex [scrollbar-width:none] gap-4 overflow-x-auto pt-5 pb-0.5 [&::-webkit-scrollbar]:hidden">
		<!-- Your story / add (container is a div so the + badge button doesn't nest) -->
		<div class="flex w-[78px] shrink-0 cursor-pointer flex-col items-center gap-1.5">
			<div class="relative">
				{#if noteBadge(myAuthor)}
					<span
						class="absolute -top-5 left-1/2 z-10 max-w-[96px] -translate-x-1/2 truncate rounded-full border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-2 py-0.5 text-[10.5px] leading-tight font-semibold text-[var(--ui-text)] shadow-[var(--shadow-pop)]"
					>
						{noteBadge(myAuthor)}
					</span>
				{/if}
				<button
					type="button"
					onclick={() => (myAuthor ? openAuthor(myAuthor) : (composing = true))}
					class="rounded-full p-[3px] {myAuthor && myAuthor.slides.length
						? 'bg-gradient-to-tr from-primary-500 via-accent-500 to-warm-500'
						: 'bg-transparent'}"
					aria-label={myAuthor && myAuthor.slides.length ? 'View your story' : 'Add story'}
				>
					{#if me}
						<Avatar pubkey={me.pk} name={myName} picture={myProfile?.picture} size={60} />
					{:else}
						<div
							class="grid size-15 place-items-center rounded-full bg-warm-500 font-bold text-white"
						>
							YO
						</div>
					{/if}
				</button>
				<button
					type="button"
					onclick={() => (composing = true)}
					class="absolute -right-0.5 -bottom-0.5 grid size-6 place-items-center rounded-full bg-primary-500 text-white ring-2 ring-[var(--surface-bg)] transition hover:bg-primary-600"
					aria-label="Add story"
				>
					<Icon name="i-lucide-plus" class="size-3.5" />
				</button>
			</div>
			<span class="max-w-full truncate text-[11px] font-medium text-[var(--ui-text-muted)]">
				{myAuthor && myAuthor.slides.length ? 'Your story' : 'Add story'}
			</span>
		</div>

		<!-- Other authors -->
		{#each otherAuthors as author (author.pubkey)}
			<button
				type="button"
				onclick={() => openAuthor(author)}
				class="group flex w-[82px] shrink-0 cursor-pointer flex-col items-center gap-1.5 text-center"
			>
				<div class="relative">
					{#if noteBadge(author)}
						<span
							class="absolute -top-5 left-1/2 z-10 max-w-[96px] -translate-x-1/2 truncate rounded-full border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-2 py-0.5 text-[10.5px] leading-tight font-semibold text-[var(--ui-text)] shadow-[var(--shadow-pop)] transition group-hover:border-primary-500/30 group-hover:text-primary-500"
						>
							{noteBadge(author)}
						</span>
					{/if}
					<div
						class="rounded-full p-[3px] {author.hasUnseen
							? 'bg-gradient-to-tr from-primary-500 via-accent-500 to-warm-500'
							: 'bg-[var(--ui-border-accented)]'}"
					>
						<Avatar
							pubkey={author.pubkey}
							name={nameFor(author.pubkey)}
							picture={profiles.get(author.pubkey)?.picture}
							size={60}
						/>
					</div>
					{#if author.hasUnseen}
						<span
							class="absolute -top-0.5 -right-0.5 size-3 rounded-full bg-accent-500 ring-2 ring-[var(--surface-bg)]"
						></span>
					{/if}
				</div>
				<span
					class="max-w-full truncate text-[11px] font-medium {author.hasUnseen
						? 'text-[var(--ui-text)]'
						: 'text-[var(--ui-text-muted)]'}"
				>
					{nameFor(author.pubkey)}
				</span>
			</button>
		{/each}

		{#if otherAuthors.length === 0 && !stories.loading}
			<button
				type="button"
				onclick={() => (composing = true)}
				class="flex shrink-0 items-center gap-2 rounded-xl border border-dashed border-[var(--ui-border)] px-3 text-[12px] font-medium text-[var(--ui-text-muted)] transition hover:border-primary-500/40 hover:text-primary-500"
			>
				<Icon name="i-lucide-sparkles" class="size-4 text-accent-500" />
				Be the first to post a story
			</button>
		{/if}
	</div>
</div>

{#if viewing}
	<StoryViewer author={viewing} onclose={() => (viewing = null)} onnext={nextAuthor} />
{/if}

<StoryComposer bind:open={composing} onposted={() => stories.start()} />
