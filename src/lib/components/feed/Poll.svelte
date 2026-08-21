<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import { feed } from '$lib/nostr/feed.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { hasNip05 } from '$lib/utils/verification';
	import { npubEncode } from 'nostr-tools/nip19';
	import { timeAgo } from '$lib/utils/format';
	import type { FeedNote, PollVoter } from '$lib/nostr/types';

	let {
		note,
		onVoted = () => {}
	}: { note: FeedNote; onVoted?: (note: FeedNote) => void } = $props();

	const poll = $derived(note.poll!);

	// Vote totals / percentages
	const totalVotes = $derived(poll.totalVotes);
	const hasVoted = $derived(poll.myVote !== undefined);
	// Ticking clock so "5m left" counts down and `closed` flips exactly on time.
	let now = $state(Date.now());
	$effect(() => {
		const timer = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(timer);
	});
	const closed = $derived(!!poll.closedAt && poll.closedAt * 1000 <= now);
	const timeLeftLabel = $derived.by(() => {
		if (!poll.closedAt || closed) return undefined;
		const seconds = Math.floor((poll.closedAt * 1000 - now) / 1000);
		if (seconds >= 86_400) return `${Math.floor(seconds / 86_400)}d left`;
		if (seconds >= 3_600) return `${Math.floor(seconds / 3_600)}h left`;
		if (seconds >= 60) return `${Math.floor(seconds / 60)}m left`;
		return '<1m left';
	});
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

	// ---- Voters detail panel --------------------------------------------------

	let votersOpen = $state(false);
	let selectedOptionId = $state<string | null>(null);
	let expanded = $state(false);
	const VOTER_PREVIEW_COUNT = 10;

	const voters = $derived(poll.voters ?? []);
	/** Voters for an option (or all, previewed) in the order we render them. */
	const shownVoters = $derived.by(() => {
		if (selectedOptionId) return voters.filter((voter) => voter.optionId === selectedOptionId);
		return voters.slice(0, expanded ? voters.length : VOTER_PREVIEW_COUNT);
	});

	function optionLabel(optionId: string) {
		return poll.options.find((option) => option.id === optionId)?.label ?? 'Option';
	}

	// Hydrate profiles for whichever voters we may render.
	$effect(() => {
		const keys = shownVoters.map((voter) => voter.pubkey);
		if (keys.length) void profiles.ensure(keys);
	});

	function openVoters() {
		votersOpen = true;
	}

	function resetPanel() {
		selectedOptionId = null;
		expanded = false;
	}

	function displayName(voter: PollVoter) {
		const profile = profiles.get(voter.pubkey);
		return profile?.display_name || profile?.name || shortNpub(voter.pubkey);
	}

	function shortNpub(pubkey: string) {
		const npub = npubEncode(pubkey);
		return `${npub.slice(0, 10)}…${npub.slice(-4)}`;
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
				{closed ? 'Closed' : `${timeLeftLabel} · ends ${closingLabel}`}
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

			<!-- Count + percentage -->
			{#if showResults}
				<span class="relative flex shrink-0 items-center gap-1.5">
					<span class="text-[11px] font-medium tabular-nums text-[var(--ui-text-dimmed)]">
						{plural(poll.votes[option.id] ?? 0, 'vote')}
					</span>
					<span
						class="text-[13px] font-bold tabular-nums
							{isLeading ? 'text-primary-500' : 'text-[var(--ui-text-muted)]'}"
					>
						{pct(option.id)}%
					</span>
				</span>
			{/if}
		</button>
	{/each}

	<!-- Footer -->
	<div class="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-[11.5px] text-[var(--ui-text-dimmed)]">
		<span class="inline-flex items-center gap-1.5">
			<Icon name="i-lucide-bar-chart-3" class="size-3.5" />
			{#if voting !== null}
				<span class="flex items-center gap-1">
					<Icon name="i-lucide-loader-circle" class="size-3 animate-spin" />
					Voting…
				</span>
			{:else if closed}
				<span>Final results · {plural(totalVotes, 'vote')}</span>
			{:else if hasVoted}
				<span>{plural(totalVotes, 'vote')}</span>
			{:else}
				<span>{totalVotes > 0 ? plural(totalVotes, 'vote') : 'Be the first to vote'}</span>
			{/if}
		</span>
		{#if totalVotes > 0}
			<button
				type="button"
				class="font-semibold text-primary-500 transition hover:text-primary-600"
				onclick={openVoters}
			>
				View voters
			</button>
		{/if}
		{#if hasVoted && !closed}
			<span class="inline-flex items-center gap-1">
				<Icon name="i-lucide-refresh-cw" class="size-3" />
				Tap an option to change your vote
			</span>
		{/if}
	</div>

	<!-- Voter avatars preview -->
	{#if voters.length > 0}
		<div class="flex items-center gap-2 pt-0.5">
			<div class="flex -space-x-1.5">
				{#each voters.slice(0, 5) as voter (voter.pubkey)}
					<a
					href={`/profile/${voter.pubkey}`}
					class="rounded-full transition hover:z-10 hover:scale-110"
					aria-label={displayName(voter)}
				>
						<Avatar
							pubkey={voter.pubkey}
							name={displayName(voter)}
							picture={profiles.get(voter.pubkey)?.picture}
							size={22}
							shape="circle"
						/>
					</a>
				{/each}
			</div>
			<button
				type="button"
				class="text-[11px] font-semibold text-[var(--ui-text-dimmed)] transition hover:text-[var(--ui-text)]"
				onclick={openVoters}
			>
				{totalVotes > voters.length ? `+${totalVotes - voters.length} more` : 'Show all'}
			</button>
		</div>
	{/if}
</div>

<!-- Voters dialog -->
<Dialog
	bind:open={votersOpen}
	title={selectedOptionId ? `Voters · ${optionLabel(selectedOptionId)}` : 'Poll voters'}
	onClose={resetPanel}
>
	<div class="space-y-3">
		<!-- Per-option breakdown; tap to filter the voter list -->
		{#if !selectedOptionId}
			<div class="space-y-1.5">
				{#each poll.options as option (option.id)}
					{@const count = poll.votes[option.id] ?? 0}
					<button
						type="button"
						class="flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3.5 py-2.5 text-left transition hover:border-primary-500/40 disabled:pointer-events-none disabled:opacity-50"
						onclick={() => (selectedOptionId = option.id)}
						disabled={count === 0}
					>
						<span class="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-[var(--ui-text)]">
							{option.label || 'Option'}
						</span>
						<span class="shrink-0 text-[12px] font-bold tabular-nums text-[var(--ui-text-muted)]">
							{count}
						</span>
					</button>
				{/each}
			</div>
			<p class="text-[11px] text-[var(--ui-text-dimmed)]">Tap an option to see who voted for it.</p>
		{:else}
			<button
				type="button"
				class="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-bold text-primary-500 transition hover:bg-primary-500/10"
				onclick={() => (selectedOptionId = null)}
			>
				<Icon name="i-lucide-arrow-left" class="size-3.5" />
				All options
			</button>
		{/if}

		{#if shownVoters.length === 0}
			<div class="py-6 text-center text-[13px] text-[var(--ui-text-muted)]">
				{selectedOptionId
					? 'No votes recorded for this option yet.'
					: 'Voter list unavailable from your relays.'}
			</div>
		{:else}
			<div class="space-y-1">
				{#each shownVoters as voter (voter.pubkey)}
					{@const profile = profiles.get(voter.pubkey)}
					{@const mine = voter.pubkey === identity.current?.pk?.toLowerCase()}
					<a
						href={`/profile/${voter.pubkey}`}
						class="flex items-center gap-3 rounded-xl px-2.5 py-2 transition hover:bg-[var(--interactive-hover-bg)]"
					>
						<Avatar
							pubkey={voter.pubkey}
							name={displayName(voter)}
							picture={profile?.picture}
							size={34}
							verified={hasNip05(profile)}
						/>
						<span class="min-w-0 flex-1 leading-tight">
							<span class="flex items-center gap-1.5">
								<span class="truncate text-[13.5px] font-bold text-[var(--ui-text)]">
									{displayName(voter)}
								</span>
								{#if mine}
									<span class="rounded bg-primary-500/15 px-1.5 py-0.5 text-[10px] font-bold text-primary-500">You</span>
								{/if}
							</span>
							<span class="block truncate text-[11.5px] text-[var(--ui-text-dimmed)]">
								{#if !selectedOptionId}Voted “{optionLabel(voter.optionId)}” · {/if}{timeAgo(voter.at)}
							</span>
						</span>
					</a>
				{/each}
			</div>
			{#if !selectedOptionId && voters.length > VOTER_PREVIEW_COUNT && !expanded}
				<button
					type="button"
					class="w-full rounded-xl border border-dashed border-[var(--ui-border)] py-2 text-[12.5px] font-bold text-primary-500 transition hover:border-primary-500/50 hover:bg-primary-500/5"
					onclick={() => (expanded = true)}
					>
					Show all {voters.length} voters
				</button>
			{/if}
		{/if}

		<p class="pt-1 text-[10.5px] leading-relaxed text-[var(--ui-text-dimmed)]">
			Poll votes are public Nostr events — anyone can see how you voted.
		</p>
	</div>
</Dialog>
