<script lang="ts">
	/**
	 * Renders a single inline `nostr:` mention as a resolved, clickable link.
	 *
	 *  - `nostr:npub1…` / `nostr:nprofile1…` → `@<display name>` linking to the
	 *    profile (resolved from the profile cache; fetched if missing).
	 *  - `nostr:note1…` / `nostr:nevent1…` → a short link to the note page.
	 *  - anything undecodable → a neutral link to the raw value.
	 *
	 * Used by both the main note body and threaded comments so mentions render
	 * consistently (and as names, not raw npubs) across the app.
	 */
	import { decode } from 'nostr-tools/nip19';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { shortKey } from '$lib/utils/format';
	import { stripNostrPrefix } from '$lib/utils/note-content';

	let { value, class: cls = '' }: { value: string; class?: string } = $props();

	const raw = $derived(stripNostrPrefix(value));
	const decoded = $derived.by(() => {
		try {
			return decode(raw);
		} catch {
			return null;
		}
	});

	const pubkey = $derived(
		decoded?.type === 'npub'
			? (decoded.data as string)
			: decoded?.type === 'nprofile'
				? (decoded.data as { pubkey: string }).pubkey
				: undefined
	);
	const noteId = $derived(
		decoded?.type === 'note'
			? (decoded.data as string)
			: decoded?.type === 'nevent'
				? (decoded.data as { id: string }).id
				: undefined
	);

	const profile = $derived(pubkey ? profiles.get(pubkey) : undefined);
	const isProfile = $derived(!!pubkey);
	const label = $derived(
		profile?.display_name || profile?.name || (pubkey ? shortKey(pubkey) : shortKey(raw, 12, 6))
	);
	const href = $derived(pubkey ? `/profile/${pubkey}` : noteId ? `/note/${noteId}` : value);

	// Lazy-load metadata so the name resolves shortly after first paint.
	$effect(() => {
		if (pubkey) profiles.ensure([pubkey]);
	});
</script>

<a
	href={href}
	class={cls
		? cls
		: isProfile
			? 'font-bold text-primary-500 transition hover:text-primary-600 hover:underline'
			: 'font-semibold text-accent-500 transition hover:text-accent-600 hover:underline'}
>
	{#if isProfile}@{/if}{label}
</a>
