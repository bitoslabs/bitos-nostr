<script lang="ts">
	import { page } from '$app/state';
	import { decode } from 'nostr-tools/nip19';
	import ProfileView from '$lib/components/profile/ProfileView.svelte';

	/** Resolve a `npub1…` or 64-char hex pubkey from the route param. */
	function resolvePubkey(value: string | undefined) {
		if (!value) return '';
		if (/^[0-9a-f]{64}$/i.test(value)) return value.toLowerCase();
		if (value.startsWith('npub1')) {
			try {
				const decoded = decode(value);
				if (decoded.type === 'npub') return decoded.data as string;
			} catch {
				return '';
			}
		}
		return '';
	}

	const pubkey = $derived(resolvePubkey(page.params.pubkey));
</script>

<ProfileView {pubkey} />
