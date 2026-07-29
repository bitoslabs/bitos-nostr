<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import { feed } from '$lib/nostr/feed.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';

	let {
		open = $bindable(false),
		onposted = () => {}
	}: { open?: boolean; onposted?: () => void } = $props();

	const MIN_OPTIONS = 2;
	const MAX_OPTIONS = 6;
	const MAX_QUESTION = 280;
	const MAX_OPTION = 80;

	let question = $state('');
	let options = $state<string[]>(['', '']);
	let posting = $state(false);

	const me = $derived(identity.current);
	const myProfile = $derived(me ? profiles.get(me.pk) : undefined);
	const myName = $derived(myProfile?.display_name || myProfile?.name || 'You');

	const cleanOptions = $derived(options.map((o) => o.trim()).filter(Boolean));
	const validQuestion = $derived(question.trim().length > 0);
	const canPost = $derived(
		validQuestion && cleanOptions.length >= MIN_OPTIONS && !posting && question.length <= MAX_QUESTION
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
	}

	function close() {
		open = false;
		reset();
	}

	async function post() {
		if (!canPost || posting) return;
		posting = true;
		try {
			await feed.postPoll(question, cleanOptions);
			toasts.success('Poll posted to Nostr');
			onposted();
			close();
		} catch (e) {
			toasts.error((e as Error).message);
		} finally {
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
				<Avatar
					pubkey={me.pk}
					name={myName}
					picture={myProfile?.picture}
					size={36}
				/>
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
			{#each options as _, i (i)}
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
						placeholder={`Option ${i + 1}`}
						class="h-10 flex-1 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3.5 text-[13.5px] text-[var(--ui-text)] outline-none transition placeholder:text-[var(--ui-text-dimmed)] focus:border-primary-500 focus:bg-[var(--surface-bg)] focus:ring-2 focus:ring-primary-500/20"
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
