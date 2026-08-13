<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import RelayDot from '$lib/components/ui/RelayDot.svelte';
	import { formatCompact } from '$lib/utils/format';
	import type { RelayRow } from '$lib/components/premium/data';

	/**
	 * Full relay card (Relays page): status dot, host + paid badge, latency,
	 * and a 4-up stats grid (events / latency / mode / paid). Two trailing
	 * action buttons are emitted via callbacks.
	 */
	let {
		relay,
		onConfigure,
		onRemove
	}: {
		relay: RelayRow;
		onConfigure?: (r: RelayRow) => void;
		onRemove?: (r: RelayRow) => void;
	} = $props();

	const statusLabel = $derived(
		relay.status === 'down' ? 'Offline' : relay.status === 'connecting' ? 'Connecting' : 'Connected'
	);
	const statusColor = $derived(
		relay.status === 'down'
			? 'text-[var(--tone-warning-text)]'
			: relay.status === 'connecting'
				? 'text-[var(--ui-color-primary-500)]'
				: 'text-[var(--tone-success-text)]'
	);
</script>

<div class="premium-card p-4">
	<div class="mb-3 flex items-center gap-3">
		<RelayDot status={relay.status} />
		<div class="min-w-0 flex-1">
			<div class="flex items-center gap-2">
				<span class={relay.status === 'down' ? 'font-mono text-sm font-semibold text-[var(--ui-text-muted)] line-through' : 'font-mono text-sm font-semibold'}>
					{relay.url}
				</span>
				{#if relay.paid}
					<span class="rounded-full border border-[color-mix(in_oklab,var(--ui-color-primary-500)_22%,transparent)] bg-[color-mix(in_oklab,var(--ui-color-primary-500)_12%,transparent)] px-2 py-0.5 font-mono text-[10px] text-[var(--ui-color-primary-500)]">PAID</span>
				{/if}
			</div>
			<div class="mt-0.5 font-mono text-[11px] {statusColor}">{statusLabel}{relay.latency ? ` · ${relay.latency}ms` : ''}</div>
		</div>
		<button type="button" onclick={() => onConfigure?.(relay)} class="icon-btn size-8" aria-label="Configure relay">
			<Icon name="i-lucide-sliders-horizontal" class="size-[11px]" />
		</button>
		<button type="button" onclick={() => onRemove?.(relay)} class="grid size-8 place-items-center rounded-full border border-[color-mix(in_oklab,var(--tone-warning-text)_18%,transparent)] bg-[color-mix(in_oklab,var(--tone-warning-text)_10%,transparent)] text-[var(--tone-warning-text)] transition hover:bg-[color-mix(in_oklab,var(--tone-warning-text)_20%,transparent)]" aria-label="Remove relay">
			<Icon name="i-lucide-trash-2" class="size-[11px]" />
		</button>
	</div>
	<div class="grid grid-cols-4 gap-2.5 border-t border-[var(--ui-border-muted)] pt-3">
		<div>
			<div class="text-[10px] tracking-wider text-[var(--ui-text-muted)] uppercase">Events</div>
			<div class="mt-0.5 font-mono text-[13px] font-semibold">{formatCompact(relay.events)}</div>
		</div>
		<div>
			<div class="text-[10px] tracking-wider text-[var(--ui-text-muted)] uppercase">Latency</div>
			<div class="mt-0.5 font-mono text-[13px] font-semibold">{relay.latency || '—'}ms</div>
		</div>
		<div>
			<div class="text-[10px] tracking-wider text-[var(--ui-text-muted)] uppercase">Mode</div>
			<div class="mt-0.5 font-mono text-[13px] font-semibold uppercase">{relay.mode}</div>
		</div>
		<div>
			<div class="text-[10px] tracking-wider text-[var(--ui-text-muted)] uppercase">Paid</div>
			<div class="mt-0.5 font-mono text-[13px] font-semibold">{relay.paid ? 'Yes' : 'Free'}</div>
		</div>
	</div>
</div>
