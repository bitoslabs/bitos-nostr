<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import HashViz from '$lib/components/ui/HashViz.svelte';
	import { feed } from '$lib/nostr/feed.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';

	let { open = $bindable(false), onposted = () => {} }: { open?: boolean; onposted?: () => void } =
		$props();

	const MIN_OPTIONS = 2;
	const MAX_OPTIONS = 6;
	const MAX_QUESTION = 280;
	const MAX_OPTION = 80;

	type Duration = { label: string; hours: number };
	const DURATIONS: Duration[] = [
		{ label: '1 hour', hours: 1 },
		{ label: '1 day', hours: 24 },
		{ label: '3 days', hours: 72 },
		{ label: '1 week', hours: 168 }
	];
	const openEnded: Duration = { label: 'No deadline', hours: 0 };
	const DURATION_CHOICES: Duration[] = [...DURATIONS, openEnded];

	let question = $state('');
	let options = $state<string[]>(['', '']);
	let posting = $state(false);
	let mining = $state(false);
	let showPow = $state(false);
	let pow = $state(0);
	let duration = $state<Duration>(DURATIONS[1]);

	const me = $derived(identity.current);
	const myProfile = $derived(me ? profiles.get(me.pk) : undefined);
	const myName = $derived(myProfile?.display_name || myProfile?.name || 'You');

	const cleanOptions = $derived(options.map((o) => o.trim()).filter(Boolean));
	const validQuestion = $derived(question.trim().length > 0);
	const canPost = $derived(
		validQuestion &&
			cleanOptions.length >= MIN_OPTIONS &&
			!posting &&
			question.length <= MAX_QUESTION
	);
	const remaining = $derived(MAX_QUESTION - question.length);

	function addOption() {
		if (options.length >= MAX_OPTIONS) return;
		options = [...options, ''];
	}

	function removeOption(index: number) {
		if (options.length <= MIN_OPTIONS) return;
		options = options.filter((_, i) => i !== index);
	}

	function reset() {
		question = '';
		options = ['', ''];
		posting = false;
		mining = false;
		showPow = false;
		pow = 0;
		duration = DURATIONS[1];
	}

	function close() {
		open = false;
		reset();
	}

	async function post() {
		if (!canPost || posting) return;
		posting = true;
		mining = showPow && pow > 0;
		try {
			// Yield once so the mining state is visible before the worker starts.
			if (mining) await new Promise((resolve) => setTimeout(resolve, 50));
			const endsAt =
				duration.hours > 0
					? Math.floor(Date.now() / 1000) + duration.hours * 3600
				: undefined;
			await feed.postPoll(question, cleanOptions, { pow: showPow ? pow : 0, endsAt });
			toasts.success('Poll posted to Nostr');
			onposted();
			close();
		} catch (e) {
			toasts.error((e as Error).message);
		} finally {
			mining = false;
			posting = false;
		}
	}

	// Reset when the dialog opens fresh.
	let lastOpen = false;
	$effect(() => {
		if (open && !lastOpen) reset();
		lastOpen = open;
	});

	function onKey(e: KeyboardEvent) {
		if (open && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			void post();
		}
	}
</script>

<svelte:window onkeydown={onKey} />

<Dialog bind:open title="Create a poll">
	<div class="space-y-4">
		<!-- Author -->
		<div class="flex items-center gap-2.5">
			{#if me}
				<Avatar pubkey={me.pk} name={myName} picture={myProfile?.picture} size={36} />
			{/if}
			<span class="text-[13px] font-bold text-[var(--ui-text)]">{myName}</span>
		</div>

		<!-- Question -->
		<div
			class="rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3.5 py-3 transition focus-within:border-primary-500 focus-within:bg-[var(--surface-bg)] focus-within:ring-2 focus-within:ring-primary-500/20"
		>
			<textarea
				bind:value={question}
				rows="2"
				maxlength={MAX_QUESTION}
				placeholder="Ask a question…"
				class="w-full resize-none bg-transparent text-[15px] leading-relaxed text-[var(--ui-text)] outline-none placeholder:text-[var(--ui-text-dimmed)]"
			></textarea>
		</div>
		{#if question.length > 0}
			<p
				class="-mt-2 text-right text-[11px] tabular-nums {remaining < 0
					? 'text-[var(--tone-error-text)]'
					: remaining < 40
						? 'text-warm-500'
						: 'text-[var(--ui-text-dimmed)]'}"
			>
				{question.length}/{MAX_QUESTION}
			</p>
		{/if}

		<!-- Options -->
		<div class="space-y-2">
			<p class="text-[12px] font-bold tracking-wide text-[var(--ui-text-muted)] uppercase">
				Choices
			</p>
			{#each options as option, i (i)}
				<div class="flex items-center gap-2">
					<div
						class="grid size-6 shrink-0 place-items-center rounded-full bg-primary-500/15 text-[11px] font-bold text-primary-500"
					>
						{i + 1}
					</div>
					<input
						bind:value={options[i]}
						type="text"
						maxlength={MAX_OPTION}
						placeholder={option ? `Option ${i + 1}` : `Option ${i + 1}`}
						class="h-10 flex-1 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3.5 text-[13.5px] text-[var(--ui-text)] transition outline-none placeholder:text-[var(--ui-text-dimmed)] focus:border-primary-500 focus:bg-[var(--surface-bg)] focus:ring-2 focus:ring-primary-500/20"
					/>
					{#if options.length > MIN_OPTIONS}
						<button
							type="button"
							onclick={() => removeOption(i)}
							class="grid size-8 shrink-0 place-items-center rounded-lg text-[var(--ui-text-dimmed)] transition hover:bg-[var(--tone-error-bg)] hover:text-[var(--tone-error-text)]"
							aria-label="Remove option"
						>
							<Icon name="i-lucide-x" class="size-4" />
						</button>
					{/if}
				</div>
			{/each}

			{#if options.length < MAX_OPTIONS}
				<button
					type="button"
					onclick={addOption}
					class="flex items-center gap-2 rounded-xl border border-dashed border-[var(--ui-border)] px-3.5 py-2.5 text-[13px] font-bold text-primary-500 transition hover:border-primary-500/50 hover:bg-primary-500/5"
				>
					<Icon name="i-lucide-plus" class="size-4" />
					Add option
					<span class="text-[11px] font-medium text-[var(--ui-text-dimmed)]">
						({options.length}/{MAX_OPTIONS})
					</span>
				</button>
			{/if}
		</div>

		<p class="text-[11px] text-[var(--ui-text-dimmed)]">
			Votes are published as Nostr reactions and are public. One vote per account (latest wins).
		</p>

		<!-- Poll duration -->
		<div class="space-y-2">
			<p class="text-[12px] font-bold tracking-wide text-[var(--ui-text-muted)] uppercase">
				Duration
			</p>
			<div class="flex flex-wrap gap-1.5" role="group" aria-label="Poll duration">
				{#each DURATION_CHOICES as choice (choice.label)}
					<button
						type="button"
						onclick={() => (duration = choice)}
						aria-pressed={duration.label === choice.label}
						class="rounded-lg px-3 py-1.5 text-[12px] font-bold transition {duration.label === choice.label
							? 'bg-primary-500 text-white shadow-[var(--glow-primary)]'
							: 'bg-[var(--ui-bg-muted)] text-[var(--ui-text-muted)] hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]'}"
					>
						{choice.label}
					</button>
				{/each}
			</div>
			{#if duration.hours > 0}
				<p class="text-[11px] text-[var(--ui-text-dimmed)]">
					Closes {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
						new Date(Date.now() + duration.hours * 3_600_000)
					)}
				</p>
			{/if}
		</div>

		<div class="rounded-xl border border-primary-500/15 bg-primary-500/5 p-3">
			<div class="flex items-center justify-between gap-3">
				<div>
					<p class="text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase">
						Proof of Work
					</p>
					<p class="mt-0.5 text-[11px] text-[var(--ui-text-dimmed)]">
						{mining
							? 'Mining your poll… keep this tab open.'
							: 'Optionally mine this poll before publishing.'}
					</p>
				</div>
				<button
					type="button"
					onclick={() => (showPow = !showPow)}
					aria-label="Enable Proof of Work"
					aria-pressed={showPow}
					class="rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition {showPow
						? 'bg-primary-500 text-white'
						: 'bg-[var(--interactive-hover-bg)] text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
				>
					{showPow ? `${pow} bits` : 'Off'}
				</button>
			</div>
			{#if showPow}
				<input
					type="range"
					min="0"
					max="30"
					bind:value={pow}
					class="pow-slider mt-2.5 w-full"
					aria-label="Proof of Work difficulty"
				/>
				<HashViz bits={pow} class="mt-2.5" />
			{/if}
		</div>
	</div>

	{#snippet footer()}
		<button
			type="button"
			onclick={close}
			class="rounded-lg px-3.5 py-2 text-[13px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)]"
		>
			Cancel
		</button>
		<button
			type="button"
			onclick={post}
			disabled={!canPost}
			class="flex items-center gap-1.5 rounded-lg bg-primary-500 px-4 py-2 text-[13px] font-bold text-white shadow-[var(--glow-primary)] transition-all hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
		>
			<Icon
				name={posting ? 'i-lucide-loader-circle' : 'i-lucide-bar-chart-3'}
				class="size-4 {posting ? 'animate-spin' : ''}"
			/>
			{posting ? 'Posting…' : 'Post poll'}
		</button>
	{/snippet}
</Dialog>
