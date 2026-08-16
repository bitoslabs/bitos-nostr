<script lang="ts">
	import { page } from '$app/state';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Nip29Groups from '$lib/components/groups/Nip29Groups.svelte';
	import { normalizeGroupRelay, normalizeGroupId } from '$lib/nostr/groups.svelte';

	/**
	 * Communities — public NIP-29 group rooms hosted on group relays, open to
	 * every Nostr app. This is a root surface (nav entry) rather than a
	 * Messages tab: like Discord servers, communities are public spaces, while
	 * Messages stays purely private (DMs + encrypted groups).
	 *
	 * Deep links: `/communities?relay=wss://…&id=<group-id>` opens the join
	 * dialog prefilled — shareable invite links for any group.
	 */
	const joinPreset = $derived.by(() => {
		const relay = page.url.searchParams.get('relay');
		const id = page.url.searchParams.get('id');
		if (!relay || !id) return undefined;
		const cleanRelay = normalizeGroupRelay(relay);
		const cleanId = normalizeGroupId(id);
		if (!cleanRelay || !cleanId) return undefined;
		return { relay: cleanRelay, id: cleanId };
	});
</script>

<svelte:head><title>Communities · BitOS</title></svelte:head>

<div class="flex h-full min-h-0 flex-col">
	<PageHeader title="Communities">
		{#snippet subtitle()}Public rooms on group relays — anyone from any Nostr app can join{/snippet}
		{#snippet actions()}
			<div class="icon-btn size-9" aria-hidden="true">
				<Icon name="i-lucide-users-round" class="size-[18px]" />
			</div>
		{/snippet}
	</PageHeader>
	<div class="min-h-0 flex-1">
		<Nip29Groups {joinPreset} />
	</div>
</div>
