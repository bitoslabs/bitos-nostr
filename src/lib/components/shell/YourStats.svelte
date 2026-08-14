<script lang="ts">
	import WidgetCard from '$lib/components/ui/WidgetCard.svelte';
	import { formatCompact } from '$lib/utils/format';

	/** Default right-rail "Your Stats" 2×2 grid. */
	let {
		notes = 1247,
		followers = 3892,
		satsSent = 8432,
		satsRecv = 2_400_000
	}: { notes?: number; followers?: number; satsSent?: number; satsRecv?: number } = $props();
</script>

<WidgetCard title="Your Stats">
	<div class="grid grid-cols-2 gap-3 p-3.5">
		<div>
			<div class="text-[11px] tracking-wider text-[var(--ui-text-muted)] uppercase">Notes</div>
			<div class="mt-0.5 font-mono text-lg">{formatCompact(notes)}</div>
		</div>
		<div>
			<div class="text-[11px] tracking-wider text-[var(--ui-text-muted)] uppercase">Followers</div>
			<div class="mt-0.5 font-mono text-lg text-[var(--tone-success-text)]">{formatCompact(followers)}</div>
		</div>
		<div>
			<div class="text-[11px] tracking-wider text-[var(--ui-text-muted)] uppercase">Sats sent</div>
			<div class="mt-0.5 font-mono text-lg text-[var(--tone-warning-text)]">{formatCompact(satsSent)}</div>
		</div>
		<div>
			<div class="text-[11px] tracking-wider text-[var(--ui-text-muted)] uppercase">Sats recv</div>
			<div class="mt-0.5 font-mono text-lg text-[var(--ui-color-primary-500)]">{formatCompact(satsRecv)}</div>
		</div>
	</div>
</WidgetCard>
