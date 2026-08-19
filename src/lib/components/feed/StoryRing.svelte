<script lang="ts">
	/**
	 * Wraps an avatar (or any element) with an Instagram-style story ring that
	 * appears only when the user has an active status/note:
	 *
	 *   • gradient ring  → has an UNSEEN story
	 *   • muted ring     → has a story you've already seen
	 *   • no ring        → no active status (children render untouched)
	 *
	 * The ring gradient is a separate clipped layer BEHIND the children (same
	 * layering as `Avatar`'s `frame` prop). Children must never be clipped by
	 * this wrapper: the avatar's verified bolt badge hangs over the bottom-right
	 * corner, and a `clip-path` on the wrapper would cut it off — no `z-index`
	 * can escape a clip. Children clip themselves to the shape instead.
	 *
	 * When interactive (default) tapping a ringed avatar opens the story viewer.
	 */
	import { stories, type StoryAuthor } from '$lib/nostr/stories.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import StoryViewer from './StoryViewer.svelte';
	import type { Snippet } from 'svelte';

	let {
		pubkey,
		rounded = 'hex-clip',
		interactive = true,
		children
	}: {
		pubkey: string;
		/** Shape of the ring — match the inner avatar's border-radius. */
		rounded?: string;
		/** Tap to open the viewer (disable for tiny avatars / non-avatars). */
		interactive?: boolean;
		children: Snippet;
	} = $props();

	const author = $derived(
		stories.authors.find((a) => a.pubkey === pubkey?.toLowerCase()) as StoryAuthor | undefined
	);
	const hasStory = $derived(!!author && author.slides.length > 0);

	let viewing = $state(false);

	const ringClass = $derived(
		!author
			? ''
			: // Your own story always shows the gradient (it's never "unseen" to you).
				author.pubkey === identity.current?.pk?.toLowerCase() || author.hasUnseen
				? 'bg-gradient-to-tr from-primary-500 via-accent-500 to-warm-500'
				: 'bg-[var(--ui-border-accented)]'
	);
</script>

{#if hasStory}
	{#if interactive}
		<button
			type="button"
			onclick={() => author && (viewing = true)}
			class="story-ring-frame relative cursor-pointer p-[3px] transition-transform hover:scale-105"
			aria-label="View story"
			title="View story"
		>
			<!-- Ring gradient layer — clipped to the shape, but behind the children
			so it can never clip the avatar's verified bolt badge. -->
			<span class="absolute inset-0 -z-10 {rounded} {ringClass}"></span>
			{@render children()}
		</button>
	{:else}
		<div class="story-ring-frame relative p-[3px]">
			<span class="absolute inset-0 -z-10 {rounded} {ringClass}"></span>
			{@render children()}
		</div>
	{/if}
	{#if viewing && author}
		<StoryViewer {author} onclose={() => (viewing = false)} />
	{/if}
{:else}
	{@render children()}
{/if}
