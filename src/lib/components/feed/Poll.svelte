<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import { feed } from '$lib/nostr/feed.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import type { FeedNote } from '$lib/nostr/types';

	let {
		note,
		onVoted = () => {}
	}: { note: FeedNote; onVoted?: (note: FeedNote) => void } = $props();

	const poll = $derived(note.poll!);

	// Vote totals / percentages
	const totalVotes = $derived(poll.totalVotes);
	const hasVoted = $derived(poll.myVote !== undefined);
	const closed = $derived(!!poll.closedAt && poll.closedAt * 1000 <= Date.now());
	const pollType = $derived(
		note.tags.find((tag) => tag[0] === 'polltype')?.[1] === 'multiplechoice'
			? 'Multiple choice'
			: 'Single choice'
	);
	const closingLabel = $derived(
		poll.closedAt
			? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
					new Date(poll.closedAt * 1000)
				)
			: undefined
	);

	function pct(optionId: string) {
		if (!totalVotes) return 0;
		return Math.round(((poll.votes[optionId] ?? 0) / totalVotes) * 100);
	}

	function leadingId() {
		let best: string | undefined;
		let bestCount = -1;
		for (const o of poll.options) {
			const c = poll.votes[o.id] ?? 0;
			if (c > bestCount) {
				bestCount = c;
				best = o.id;
			}
		}
		return bestCount > 0 ? best : undefined;
	}

	let voting = $state<string | null>(null);

	async function vote(optionId: string) {
		if (closed || voting) return;
		voting = optionId;
		try {
			const updatedNote = await feed.votePoll(note, optionId);
			onVoted(updatedNote);
		} catch (e) {
			toasts.error((e as Error).message);
		} finally {
			voting = null;
		}
	}

	function plural(count: number, noun: string) {
		return `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`;
	}
</script>


<div class="mt-3 select-none space-y-2">
	<div class="flex items-center justify-between gap-2 px-0.5 text-[11px] text-[var(--ui-text-dimmed)]">
		<span class="inline-flex items-center gap-1.5">
			<Icon name="i-lucide-list-checks" class="size-3.5" />
			{pollType}
		</span>
		{#if closingLabel}
			<span class={closed ? 'font-semibold text-[var(--ui-text-muted)]' : ''}>
				{closed ? 'Closed' : `Ends ${closingLabel}`}
			</span>
		{/if}
	</div>
	{#each poll.options as option (option.id)}
		{@const isMine = poll.myVote === option.id}
		{@const isLeading = leadingId() === option.id}
		{@const showResults = hasVoted || totalVotes > 0}
		<button
			type="button"
			disabled={closed || voting !== null}
			onclick={() => vote(option.id)}
			class="group relative flex w-full items-center gap-3 overflow-hidden rounded-xl border px-3.5 py-2.5 text-left transition disabled:cursor-default
				{isMine
				? 'border-primary-500/60 bg-primary-500/10'
				: 'border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] hover:border-primary-500/40 hover:bg-primary-500/5'}"
		>
			<!-- Result bar -->
			{#if showResults}
				<span
					class="absolute inset-y-0 left-0 transition-[width] duration-500 ease-out
						{isMine ? 'bg-primary-500/15' : 'bg-[var(--ui-border-muted)]/60'}"
					style="width:{pct(option.id)}%"
				></span>
			{/if}

			<!-- Check / radio -->
			<span
				class="relative grid size-5 shrink-0 place-items-center rounded-full border-2 transition
					{isMine
					? 'border-primary-500 bg-primary-500 text-white'
					: 'border-[var(--ui-text-dimmed)] text-transparent group-hover:border-primary-500/60'}"
			>
				<Icon name="i-lucide-check" class="size-3.5" />
			</span>

			<!-- Label -->
			<span class="relative min-w-0 flex-1 truncate text-[13.5px] font-semibold text-[var(--ui-text)]">
				{option.label || 'Option'}
				{#if isMine}<span class="ml-1.5 text-[11px] font-bold text-primary-500">Your vote</span>{/if}
			</span>

			<!-- Percentage -->
			{#if showResults}
				<span
					class="relative shrink-0 text-[13px] font-bold tabular-nums
						{isLeading ? 'text-primary-500' : 'text-[var(--ui-text-muted)]'}"
				>
					{pct(option.id)}%
				</span>
			{/if}
		</button>
	{/each}

	<!-- Footer -->
	<div class="flex items-center gap-1.5 pt-0.5 text-[11.5px] text-[var(--ui-text-dimmed)]">
		<Icon name="i-lucide-bar-chart-3" class="size-3.5" />
		{#if voting !== null}
			<span class="flex items-center gap-1">
				<Icon name="i-lucide-loader-circle" class="size-3 animate-spin" />
				Voting…
			</span>
		{:else if closed}
			<span>Final results · {plural(totalVotes, 'vote')}</span>
		{:else if hasVoted}
			<span>Your vote is highlighted · {plural(totalVotes, 'vote')}</span>
		{:else}
			<span>{totalVotes > 0 ? plural(totalVotes, 'vote') : 'Be the first to vote'}</span>
		{/if}
	</div>
</div>
