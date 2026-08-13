<script lang="ts">
	/**
	 * Wraps an avatar (or any element) with an Instagram-style story ring that
	 * appears only when the user has an active status/note:
	 *
	 *   • gradient ring  → has an UNSEEN story
	 *   • muted ring     → has a story you've already seen
	 *   • no ring        → no active status (children render untouched)
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
			class="story-ring-frame {rounded} cursor-pointer p-[3px] {ringClass} transition-transform hover:scale-105"
			aria-label="View story"
		>
			{@render children()}
		</button>
	{:else}
		<div class="story-ring-frame {rounded} p-[3px] {ringClass}">
			{@render children()}
		</div>
	{/if}
	{#if viewing && author}
		<StoryViewer {author} onclose={() => (viewing = false)} />
	{/if}
{:else}
	{@render children()}
{/if}
