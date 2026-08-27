<script lang="ts">
	/**
	 * Renders note-style content with #hashtags highlighted and @mentions
	 * (NIP-27 `nostr:` entities) as clickable links — the same token pipeline
	 * the feed uses, so public previews (meme publish details, shared-sound
	 * form) read exactly like the published post will.
	 */
	import { parseContent, isEventReference } from '$lib/utils/note-content';
	import MentionLink from './MentionLink.svelte';
	import NostrEventPreview from './NostrEventPreview.svelte';

	let {
		content,
		/** Render on a light/muted surface (public previews) vs. dark overlay. */
		variant = 'muted',
		class: cls = ''
	}: { content: string; variant?: 'muted' | 'overlay'; class?: string } = $props();

	const tokens = $derived(parseContent(content));
	const tagClass = $derived(
		variant === 'overlay'
			? 'font-bold text-primary-400 transition hover:text-primary-300 hover:underline'
			: 'font-bold text-primary-600 transition hover:text-primary-500 hover:underline'
	);
	const linkClass = $derived(
		variant === 'overlay'
			? 'font-semibold text-accent-400 transition hover:text-accent-300 hover:underline'
			: 'font-semibold text-accent-600 transition hover:text-accent-500 hover:underline'
	);
	const mentionClass = $derived(
		variant === 'overlay'
			? 'font-bold text-primary-400 transition hover:text-primary-300 hover:underline'
			: 'font-bold text-primary-600 transition hover:text-primary-500 hover:underline'
	);
</script>

<span class={cls}>
	{#each tokens as token, i (`${token.type}:${i}:${token.value}`)}
		{#if token.type === 'text'}{token.value}{:else if token.type === 'hashtag'}<a
				href={`/?tag=${encodeURIComponent(token.tag)}`}
				class={tagClass}>{token.value}</a
			>{:else if token.type === 'nostr'}{#if isEventReference(token.value)}<NostrEventPreview
					value={token.value}
					compact
				/>{:else}<MentionLink value={token.value} class={mentionClass} />{/if}{:else}<a
				href={token.value}
				target="_blank"
				rel="noreferrer"
				class={linkClass}>{token.host}</a
			>{/if}
	{/each}
</span>
