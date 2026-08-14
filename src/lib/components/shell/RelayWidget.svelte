<script lang="ts">
	import WidgetCard from '$lib/components/ui/WidgetCard.svelte';
	import RelayDot from '$lib/components/ui/RelayDot.svelte';
	import { formatCompact } from '$lib/utils/format';

	type Mode = 'read' | 'write' | 'both';
	type Status = 'connected' | 'connecting' | 'down';

	/** A relay row for the RelayWidget. */
	export type RelayRow = {
		url: string;
		status: Status;
		latency: number;
		events: number;
		mode: Mode;
		paid?: boolean;
	};

	/**
	 * Compact active-relay list (right rail). Shows a status dot, the host,
	 * latency/events, and the read/write mode chip. A footer link lets the
	 * caller route to the full relay manager.
	 */
	let {
		relays = [],
		onManage,
		class: cls
	}: { relays?: RelayRow[]; onManage?: () => void; class?: string } = $props();

	const connected = $derived(relays.filter((r) => r.status === 'connected').length);
</script>

<WidgetCard title="Active Relays" class={cls}>
	{#snippet actions()}
		<span class="font-mono text-xs font-normal text-[var(--ui-text-muted)]">
			{connected}/{relays.length}
		</span>
	{/snippet}
	<ul class="py-1">
		{#each relays as r (r.url)}
			<li class="flex items-center gap-2.5 px-4 py-2 transition hover:bg-[var(--interactive-hover-bg)]">
				<RelayDot status={r.status} />
				<div class="min-w-0 flex-1">
					<div
						class="truncate font-mono text-xs {r.status === 'down'
							? 'text-[var(--ui-text-muted)] line-through'
							: 'text-[var(--ui-text)]'}"
					>
						{r.url}
					</div>
					<div
						class="text-[10px] {r.status === 'down'
							? 'text-[var(--tone-warning-text)]'
							: r.status === 'connecting'
								? 'text-[var(--ui-color-primary-500)]'
								: 'text-[var(--ui-text-muted)]'}"
					>
						{r.status === 'down'
							? 'unreachable'
							: r.status === 'connecting'
								? 'connecting…'
								: r.events
									? `${r.latency}ms · ${formatCompact(r.events)} events`
									: `${r.latency}ms`}
					</div>
				</div>
				<span
					class="rounded-full border border-[var(--ui-border-muted)] bg-[var(--interactive-hover-bg)] px-2 py-0.5 font-mono text-[10px] text-[var(--ui-text-muted)] uppercase"
				>
					{r.mode}
				</span>
			</li>
		{/each}
	</ul>
	{#if onManage}
		<button
			type="button"
			onclick={onManage}
			class="w-full border-t border-[var(--ui-border-muted)] px-4 py-2.5 text-left text-sm text-[var(--ui-color-primary-500)] transition hover:bg-[color-mix(in_oklab,var(--ui-color-primary-500)_6%,transparent)]"
		>
			Manage relays →
		</button>
	{/if}
</WidgetCard>
