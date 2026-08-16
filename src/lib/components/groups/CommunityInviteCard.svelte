<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import { nip29, DEFAULT_GROUP_RELAYS } from '$lib/nostr/groups.svelte';
	import { browser } from '$app/environment';

	/**
	 * Community invite card — rendered where a `nostr:naddr1…` entity resolves
	 * to a NIP-29 group metadata address (kind 39000).
	 *
	 * The naddr carries `39000:<relay-key>:<group-id>` — the group *id* and the
	 * hosting relay's key, but not the relay's wss:// URL. So the card probes
	 * the known group relays (defaults + the user's joined ones) for a kind
	 * 39000 with that id; once found it renders a rich join card linking to
	 * `/communities?relay=…&id=…` (the prefilled deep-link join flow). If no
	 * relay answers, it still links with the default relay prefilled.
	 */
	let {
		groupId,
		compact = false
	}: {
		/** Group id from the naddr identifier. */
		groupId: string;
		compact?: boolean;
	} = $props();

	let name = $state('');
	let about = $state('');
	let picture = $state<string | undefined>(undefined);
	let relay = $state<string | undefined>(undefined);
	let resolved = $state(false);

	$effect(() => {
		const id = groupId;
		if (!browser || resolved) return;
		name = id.slice(0, 12);
		const candidates = [...DEFAULT_GROUP_RELAYS, ...nip29.groups.map((g) => g.relay)].filter(
			(r, i, list) => list.indexOf(r) === i
		);
		let cancelled = false;
		void (async () => {
			for (const candidate of candidates) {
				if (cancelled) return;
				try {
					const listing = (await nip29.discover(candidate)).find((l) => l.id === id);
					if (listing) {
						if (cancelled) return;
						name = listing.name;
						about = listing.about ?? '';
						picture = listing.picture;
						relay = candidate;
						resolved = true;
						return;
					}
				} catch {
					/* try next relay */
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	const joinHref = $derived(
		`/communities?relay=${encodeURIComponent(relay ?? DEFAULT_GROUP_RELAYS[0])}&id=${encodeURIComponent(groupId)}`
	);
</script>

<a
	href={joinHref}
	class="flex items-center gap-2.5 rounded-xl border {compact
		? 'px-2 py-1.5'
		: 'px-3 py-2.5'} border-[color-mix(in_oklab,var(--ui-color-primary-500)_25%,transparent)] bg-[color-mix(in_oklab,var(--ui-color-primary-500)_7%,transparent)] transition hover:border-[color-mix(in_oklab,var(--ui-color-primary-500)_45%,transparent)]"
	aria-label={`Join the ${name} community`}
>
	<span
		class="grid {compact
			? 'size-7'
			: 'size-9'} shrink-0 place-items-center rounded-lg bg-primary-500 text-white"
	>
		{#if picture}
			<img src={picture} alt="" class="size-full rounded-lg object-cover" />
		{:else}
			<Icon name="i-lucide-users-round" class={compact ? 'size-4' : 'size-[18px]'} />
		{/if}
	</span>
	<span class="min-w-0 flex-1">
		<span class="flex items-center gap-1.5 truncate text-[13px] font-bold">
			{name}
			<Icon name="i-lucide-badge-check" class="size-3.5 shrink-0 text-primary-500" />
		</span>
		<span class="block truncate text-[11px] text-[var(--ui-text-dimmed)]">
			{about || 'Community · tap to join'}
		</span>
	</span>
	<span class="shrink-0 rounded-full bg-primary-500 px-2.5 py-1 text-[11px] font-bold text-white"
		>Join</span
	>
</a>
