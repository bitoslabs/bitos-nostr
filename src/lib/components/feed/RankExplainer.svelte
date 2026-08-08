<script lang="ts">
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { shortKey } from '$lib/utils/format';
	import type { ScoreBreakdown } from '$lib/algorithm';

	const SIGNAL_COLORS: Record<string, string> = {
		recency: '#3b82f6',
		engagement: '#f97316',
		zaps: '#eab308',
		affinity: '#ec4899',
		wot: '#22c55e',
		topics: '#14b8a6',
		novelty: '#8b5cf6'
	};
	const SIGNAL_ICONS: Record<string, string> = {
		recency: 'i-lucide-clock',
		engagement: 'i-lucide-flame',
		zaps: 'i-lucide-zap',
		affinity: 'i-lucide-heart-handshake',
		wot: 'i-lucide-shield-check',
		topics: 'i-lucide-hash',
		novelty: 'i-lucide-shuffle'
	};

	let {
		open = $bindable(),
		breakdown
	}: { open?: boolean; breakdown: ScoreBreakdown | null } = $props();

	const profile = $derived(breakdown ? profiles.get(breakdown.note.pubkey) : undefined);
	const authorName = $derived(
		breakdown
			? profile?.display_name || profile?.name || shortKey(breakdown.note.pubkey)
			: ''
	);
	const maxContribution = $derived(
		breakdown ? Math.max(0.0001, ...breakdown.contributions.map((c) => c.contribution)) : 1
	);
</script>

<Dialog bind:open title="Why you're seeing this">
	{#if breakdown}
		<div class="space-y-4">
			<!-- Author context -->
			<div class="flex items-center gap-3">
				<Avatar
					pubkey={breakdown.note.pubkey}
					name={authorName}
					picture={profile?.picture}
					size={40}
				/>
				<div class="min-w-0 flex-1">
					<p class="truncate text-[14px] font-bold text-[var(--ui-text)]">{authorName}</p>
					<p class="text-[12px] text-[var(--ui-text-muted)]">
						Ranked #
						<span class="font-bold text-primary-500"
							>{(breakdown.score * 100).toFixed(0)}</span
						>
						in your feed
					</p>
				</div>
			</div>

			<!-- Score preview -->
			{#if breakdown.note.content}
				<p class="line-clamp-3 rounded-xl bg-[var(--ui-bg-muted)] p-3 text-[13px] text-[var(--ui-text-muted)]">
					{breakdown.note.content}
				</p>
			{/if}

			<!-- Per-signal contribution bars -->
			<div class="space-y-2.5">
				<p class="text-[11px] font-bold tracking-wide text-[var(--ui-text-muted)] uppercase">
					What influenced this
				</p>
				{#each breakdown.contributions as contribution (contribution.signalId)}
					{@const color = SIGNAL_COLORS[contribution.signalId] ?? '#94a3b8'}
					<div class="flex items-center gap-3">
						<span style="color:{color}" class="shrink-0">
							<Icon
								name={SIGNAL_ICONS[contribution.signalId] ?? 'i-lucide-sparkles'}
								class="size-4"
							/>
						</span>
						<span class="w-20 shrink-0 text-[12.5px] font-semibold text-[var(--ui-text)]"
							>{contribution.label}</span>
						<div class="h-2 flex-1 overflow-hidden rounded-full bg-[var(--ui-bg-muted)]">
							<div
								class="h-full rounded-full transition-all duration-300"
								style="width:{(contribution.contribution / maxContribution) * 100}%; background:{color}"
							></div>
						</div>
						<span class="w-10 shrink-0 text-right text-[11px] font-bold tabular-nums text-[var(--ui-text-muted)]"
							>{(contribution.contribution * 100).toFixed(0)}%</span
						>
					</div>
				{/each}
			</div>

			{#if breakdown.topSignal}
				<div class="rounded-xl border border-primary-500/20 bg-primary-500/5 p-3 text-[12px] text-[var(--ui-text-muted)]">
					<Icon name="i-lucide-info" class="mb-0.5 mr-1 inline size-3.5 text-primary-500" />
					Top reason:
					<span class="font-bold text-[var(--ui-text)]">{breakdown.topSignal.label}</span>.
					Adjust these weights anytime in
					<a href="/settings/algorithm" class="font-bold text-primary-500 hover:underline"
						>Algorithm settings</a
					>.
				</div>
			{/if}
		</div>
	{/if}

	{#snippet footer()}
		<a
			href="/settings/algorithm"
			class="inline-flex h-9 items-center gap-2 rounded-full bg-primary-500 px-4 text-[13px] font-bold text-white transition hover:bg-primary-600"
		>
			<Icon name="i-lucide-sliders-horizontal" class="size-4" />
			Tune your feed
		</a>
	{/snippet}
</Dialog>
