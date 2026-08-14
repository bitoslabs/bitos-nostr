<script lang="ts">
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { cn } from '$lib/utils/cn';
	import { formatCompact, timeAgo } from '$lib/utils/format';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import type { ZapEntry } from '$lib/nostr/wallet.svelte';

	/**
	 * A single zap ledger row for the Zaps page. Renders real profile data
	 * (avatar/name/nip05 badge) resolved from the pubkey, the direction, the
	 * sats amount, an optional memo, and a copyable truncated bolt11 "txid".
	 */
	let {
		entry,
		onCopy
	}: {
		entry: ZapEntry;
		onCopy?: (entry: ZapEntry) => void;
	} = $props();

	const received = $derived(entry.direction === 'received');
	const otherPubkey = $derived(received ? entry.senderPubkey : entry.recipientPubkey);
	const profile = $derived(profiles.get(otherPubkey));
	const name = $derived(profile?.display_name || profile?.name || `${otherPubkey.slice(0, 8)}…${otherPubkey.slice(-4)}`);
	const txid = $derived(entry.bolt11 ? `${entry.bolt11.slice(0, 8)}…${entry.bolt11.slice(-4)}` : 'local');
</script>

<div
	role="button"
	tabindex="0"
	class="group flex cursor-pointer items-center gap-3 p-3.5 px-4 transition-all hover:bg-[var(--interactive-hover-bg)] focus-visible:outline-none focus-visible:bg-[var(--interactive-hover-bg)]"
	onclick={() => onCopy?.(entry)}
	onkeydown={(e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onCopy?.(entry);
		}
	}}
>
	<span
		class={cn(
			'grid size-9 shrink-0 place-items-center rounded-full',
			received
				? 'bg-[color-mix(in_oklab,var(--ui-color-primary-500)_12%,transparent)] text-[var(--ui-color-primary-500)]'
				: 'bg-[var(--interactive-hover-bg)] text-[var(--ui-text-muted)]'
		)}
	>
		<Icon name="i-lucide-zap" class="size-4" />
	</span>
	<a
		href={`/profile/${otherPubkey}`}
		class="shrink-0 transition hover:opacity-80"
		onclick={(e) => e.stopPropagation()}
		aria-label={`View ${name} profile`}
	>
		<Avatar pubkey={otherPubkey} name={name} picture={profile?.picture} size={36} />
	</a>
	<div class="min-w-0 flex-1">
		<div class="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
			<span class="truncate text-sm font-semibold">{name}</span>
			{#if profile?.nip05}
				<Icon name="i-lucide-badge-check" class="size-3 shrink-0 text-[var(--ui-color-primary-500)]" />
			{/if}
			<span class="text-xs text-[var(--ui-text-muted)]">{received ? 'zapped you' : 'you zapped'}</span>
			<span
				class={cn(
					'font-mono text-[13px] font-semibold',
					received ? 'text-[var(--ui-color-primary-500)]' : 'text-[var(--tone-warning-text)]'
				)}
			>
				{received ? '+' : '−'}{formatCompact(entry.amountSats)} sats
			</span>
		</div>
		{#if entry.memo}
			<div class="mt-1 text-[13px] leading-relaxed text-[var(--ui-text-muted)]">“{entry.memo}”</div>
		{/if}
		<div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] text-[var(--ui-text-muted)]">
			<span>{timeAgo(entry.createdAt)}</span>
			<span class="inline-flex items-center gap-1 transition hover:text-[var(--ui-text)]">
				{txid}
				<Icon name="i-lucide-copy" class="size-[9px] opacity-0 transition group-hover:opacity-100" />
			</span>
		</div>
	</div>
</div>
