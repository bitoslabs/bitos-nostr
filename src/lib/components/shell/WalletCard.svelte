<script lang="ts">
	import { cn } from '$lib/utils/cn';
	import { formatCompact } from '$lib/utils/format';

	/**
	 * Lightning wallet balance card shown in the left sidebar. Displays a
	 * balance (sats), a fiat estimate, and deposit / withdraw actions. The
	 * caller handles the button clicks (real wallet integration lives higher).
	 */
	let {
		balance = 12847,
		fiat = '$4.32',
		provider = 'Alby',
		onDeposit,
		onWithdraw,
		class: cls
	}: {
		balance?: number;
		fiat?: string;
		provider?: string;
		onDeposit?: () => void;
		onWithdraw?: () => void;
		class?: string;
	} = $props();
</script>

<div
	class={cn(
		'rounded-2xl border p-3.5',
		'border-[color-mix(in_oklab,var(--ui-color-primary-500)_22%,transparent)]',
		'bg-[linear-gradient(135deg,color-mix(in_oklab,var(--ui-color-primary-500)_10%,transparent),color-mix(in_oklab,var(--color-warm-500)_5%,transparent))]',
		cls
	)}
>
	<div class="mb-2 flex items-center justify-between">
		<span class="text-[11px] tracking-wider text-[var(--ui-text-muted)] uppercase">
			Lightning Wallet
		</span>
		<svg class="size-3.5 text-[var(--ui-color-primary-500)]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5Z" />
		</svg>
	</div>
	<div class="font-mono text-[22px] font-semibold">
		{balance.toLocaleString()} <span class="text-sm text-[var(--ui-color-primary-500)]">sats</span>
	</div>
	<div class="text-[11px] text-[var(--ui-text-muted)]">≈ {fiat} · synced with {provider}</div>
	<div class="mt-2.5 flex gap-1.5">
		<button
			type="button"
			onclick={onDeposit}
			class="flex-1 rounded-lg border border-[color-mix(in_oklab,var(--ui-color-primary-500)_22%,transparent)] bg-[color-mix(in_oklab,var(--ui-color-primary-500)_12%,transparent)] py-1.5 text-xs font-semibold text-[var(--ui-color-primary-500)] transition hover:bg-[color-mix(in_oklab,var(--ui-color-primary-500)_20%,transparent)]"
		>
			Deposit
		</button>
		<button
			type="button"
			onclick={onWithdraw}
			class="flex-1 rounded-lg border border-[var(--ui-border-muted)] bg-transparent py-1.5 text-xs text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)]"
		>
			Withdraw
		</button>
	</div>
</div>
