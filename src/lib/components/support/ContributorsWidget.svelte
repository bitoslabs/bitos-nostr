<script lang="ts">
	import { onMount } from 'svelte';
	import { decode } from 'nostr-tools/nip19';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { shortKey } from '$lib/utils/format';

	type Props = { compact?: boolean };
	let { compact = false }: Props = $props();

	const contributors = ['npub1ujh9lp7vw38yatm0vsxy7xuwxl3j98qvnyatyyg9xszufpyxn2fskqagph'];

	let pubkeys = $state<string[]>([]);
	let copied = $state('');

	onMount(() => {
		pubkeys = contributors.flatMap((npub) => {
			try {
				const decoded = decode(npub);
				return decoded.type === 'npub' ? [decoded.data as string] : [];
			} catch {
				return [];
			}
		});
		void profiles.refresh(pubkeys);
	});

	function npubFor(pubkey: string) {
		const index = pubkeys.indexOf(pubkey);
		return contributors[index] ?? '';
	}

	async function copyNpub(npub: string) {
		await navigator.clipboard.writeText(npub);
		copied = npub;
		setTimeout(() => (copied = ''), 1800);
	}
</script>

<section
	class="surface-card rounded-2xl border border-[var(--ui-border-muted)] {compact
		? 'p-4'
		: 'p-5 sm:p-6'}"
>
	<div class="flex items-start gap-3">
		<div
			class="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary-500/10 text-primary-500"
		>
			<Icon name="i-lucide-heart-handshake" class="size-5" />
		</div>
		<div>
			<h2 class="font-display text-[18px] font-extrabold tracking-tight">Contributors</h2>
			<p class="mt-1 text-[12.5px] leading-relaxed text-[var(--ui-text-muted)]">
				People helping BitOS grow as an open, independent Nostr client.
			</p>
		</div>
	</div>

	<div class="mt-4 space-y-2">
		{#each pubkeys as pubkey (pubkey)}
			{@const npub = npubFor(pubkey)}
			{@const profile = profiles.get(pubkey)}
			{@const name = profile?.display_name || profile?.name || shortKey(npub, 10, 8)}
			<div class="flex items-center gap-3 rounded-xl border border-[var(--ui-border-muted)] p-3">
				<Avatar {pubkey} {name} picture={profile?.picture} size={40} />
				<div class="min-w-0 flex-1">
					<a
						href={`/profile/${npub}`}
						class="block truncate text-[13.5px] font-bold hover:text-primary-500">{name}</a
					>
					<p class="truncate font-mono text-[10.5px] text-[var(--ui-text-dimmed)]">
						{shortKey(npub, 14, 10)}
					</p>
				</div>
				<button
					type="button"
					title="Copy npub"
					onclick={() => copyNpub(npub)}
					class="grid size-8 shrink-0 place-items-center rounded-lg text-[var(--ui-text-dimmed)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-primary-500"
				>
					<Icon name={copied === npub ? 'i-lucide-check' : 'i-lucide-copy'} class="size-4" />
				</button>
			</div>
		{/each}
	</div>
</section>
