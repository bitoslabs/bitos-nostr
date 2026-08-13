<script lang="ts">
	import HexAvatar from '$lib/components/ui/HexAvatar.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { cn } from '$lib/utils/cn';
	import { formatCompact } from '$lib/utils/format';
	import type { Zap } from '$lib/components/premium/data';

	/** A single zap history row (Zaps page). Shows direction, amount, memo. */
	let {
		zap,
		onCopy
	}: { zap: Zap; onCopy?: (z: Zap) => void } = $props();

	const received = $derived(zap.type === 'received');
</script>

<div class="flex cursor-pointer items-center gap-3 border-b border-[var(--ui-border-muted)] p-3.5 px-4 transition-all hover:bg-[var(--interactive-hover-bg)]">
	<span class={cn(
		'grid size-9 shrink-0 place-items-center rounded-full',
		received
			? 'bg-[color-mix(in_oklab,var(--ui-color-primary-500)_12%,transparent)] text-[var(--ui-color-primary-500)]'
			: 'bg-[var(--interactive-hover-bg)] text-[var(--ui-text-muted)]'
	)}>
		<Icon name="i-lucide-zap" class="size-4" />
	</span>
	<HexAvatar name={zap.name} picture={zap.picture} pubkey={zap.npub} size={36} />
	<div class="min-w-0 flex-1">
		<div class="flex flex-wrap items-center gap-1.5">
			<span class="text-sm font-semibold">{zap.name}</span>
			<span class="text-xs text-[var(--ui-text-muted)]">{received ? 'zapped you' : 'you zapped'}</span>
			<span class={cn('font-mono text-[13px] font-semibold', received ? 'text-[var(--ui-color-primary-500)]' : 'text-[var(--tone-warning-text)]')}>
				{received ? '+' : '−'}{formatCompact(zap.amount)} sats
			</span>
		</div>
		{#if zap.memo}
			<div class="mt-1 text-[13px] leading-relaxed text-[var(--ui-text-muted)]">"{zap.memo}"</div>
		{/if}
		<div class="mt-1 flex gap-3 font-mono text-[11px] text-[var(--ui-text-muted)]">
			<span>{zap.time}</span>
			<button type="button" onclick={() => onCopy?.(zap)} class="transition hover:text-[var(--ui-text)]">
				{zap.txid} <Icon name="i-lucide-copy" class="inline size-[9px]" />
			</button>
		</div>
	</div>
</div>
