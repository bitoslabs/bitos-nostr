<script lang="ts">
	/**
	 * Rich renderer for a single comment's body (used for both top-level replies
	 * and nested child replies inside PostCard).
	 *
	 *  - parses text / url / nostr / hashtag tokens (shared tokenizer)
	 *  - resolves `nostr:npub1…` mentions to the author's display name via the
	 *    shared <MentionLink> component (same renderer as the main feed)
	 *  - extracts NIP-92 `imeta` + content image/gif/video URLs and renders them
	 *    through NotificationMedia (blurhash placeholder, thumbnail-first, lightbox)
	 *  - media URLs are stripped from the prose so it reads cleanly
	 *  - honours content-warning / sensitive tags with a tap-to-reveal cover
	 */
	import MentionLink from './MentionLink.svelte';
	import NostrEventPreview from './NostrEventPreview.svelte';
	import NotificationMedia from '$lib/components/feed/NotificationMedia.svelte';
	import { isEventReference, parseContent } from '$lib/utils/note-content';
	import { extractNotificationMedia, cleanNotificationPreview } from '$lib/utils/imeta';

	let {
		content,
		tags = [],
		compact = false
	}: { content: string; tags?: string[][]; compact?: boolean } = $props();

	const media = $derived(extractNotificationMedia({ content, tags }));
	const cleanText = $derived(cleanNotificationPreview({ content, tags }));
	const tokens = $derived(parseContent(cleanText));
</script>

{#if tokens.length}
	<div
		class="mt-0.5 {compact
			? 'text-[12.5px]'
			: 'text-[13px]'} leading-relaxed break-words whitespace-pre-wrap"
	>
		{#each tokens as token, i (`${i}:${token.type}:${token.value}`)}
			{#if token.type === 'text'}
				{token.value}
			{:else if token.type === 'hashtag'}
				<a
					href={`/?tag=${encodeURIComponent(token.tag)}`}
					class="font-bold text-primary-500 transition hover:text-primary-600 hover:underline"
				>
					{token.value}
				</a>
			{:else if token.type === 'nostr'}
				{#if isEventReference(token.value)}
					<NostrEventPreview value={token.value} {compact} />
				{:else}
					<MentionLink value={token.value} />
				{/if}
			{:else}
				<a
					href={token.value}
					target="_blank"
					rel="noreferrer"
					class="font-semibold text-accent-500 transition hover:text-accent-600 hover:underline"
				>
					{token.host}
				</a>
			{/if}
		{/each}
	</div>
{/if}

{#if media.length}
	<div class="mt-2 max-w-[360px]">
		<NotificationMedia {media} {tags} {content} />
	</div>
{/if}
