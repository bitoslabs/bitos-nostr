<script lang="ts">
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { feed } from '$lib/nostr/feed.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import Textarea from '$lib/components/ui/Textarea.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';

	let text = $state('');
	let posting = $state(false);

	const me = $derived(identity.current);
	const SOFT_LIMIT = 4_000;
	const HARD_LIMIT = 16_000;
	const remaining = $derived(HARD_LIMIT - text.length);
	const overSoftLimit = $derived(text.length > SOFT_LIMIT);
	const overHardLimit = $derived(text.length > HARD_LIMIT);
	const countLabel = $derived(
		text.length <= SOFT_LIMIT
			? `${text.length.toLocaleString()} / ${SOFT_LIMIT.toLocaleString()}`
			: `${text.length.toLocaleString()} / ${HARD_LIMIT.toLocaleString()}`
	);

	const actions = [
		{ icon: 'i-lucide-image', label: 'Photo', color: 'text-primary-500', toast: 'Photo upload' },
		{ icon: 'i-lucide-video', label: 'Video', color: 'text-accent-500', toast: 'Video upload' },
		{ icon: 'i-lucide-clapperboard', label: 'Reel', color: 'text-warm-500', toast: 'Reel creator' },
		{ icon: 'i-lucide-bar-chart-3', label: 'Poll', color: 'text-ink', toast: 'Poll creator' }
	];

	async function submit() {
		if (!text.trim() || posting) return;
		if (overHardLimit) {
			toasts.error(`Normal notes are limited to ${HARD_LIMIT.toLocaleString()} characters`);
			return;
		}
		posting = true;
		try {
			await feed.post(text);
			text = '';
			toasts.success('Posted to Nostr');
		} catch (e) {
			toasts.error((e as Error).message);
		} finally {
			posting = false;
		}
	}

	function onKey(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			submit();
		}
	}
</script>

{#if me}
	{@const displayName = profiles.get(me.pk)?.display_name || profiles.get(me.pk)?.name || 'You'}
	<div class="post-card p-4">
		<div class="flex items-start gap-3">
			<div
				class="grid size-10 shrink-0 place-items-center rounded-xl bg-warm-500 text-sm font-bold text-white"
			>
				{displayName.slice(0, 2).toUpperCase()}
			</div>
			<div class="min-w-0 flex-1">
				<Textarea
					id="composer-input"
					bind:value={text}
					autoGrow
					rows={2}
					placeholder="What's happening on Nostr?"
					onkeydown={onKey}
					maxlength={HARD_LIMIT + 1000}
					class="min-h-[64px] rounded-xl border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-4 py-3"
				/>
				{#if overSoftLimit}
					<p
						class="mt-2 text-[11.5px] {overHardLimit
							? 'text-[var(--tone-error-text)]'
							: 'text-warm-500'}"
					>
						{#if overHardLimit}
							This is too long for a normal note. Shorten it or use a long-form article later.
						{:else}
							Long note. Most relays should accept it, but shorter posts render better in feeds.
						{/if}
					</p>
				{/if}
			</div>
		</div>

		<div
			class="mt-3 flex items-center justify-between border-t border-[var(--ui-border-muted)] pt-3"
		>
			<div class="flex gap-1">
				{#each actions as a (a.label)}
					<button
						type="button"
						onclick={() => toasts.info(a.toast)}
						class="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-primary-500/5"
					>
						<Icon name={a.icon} class="size-4 {a.color}" />
						<span class="hidden sm:inline">{a.label}</span>
					</button>
				{/each}
			</div>
			<div class="flex items-center gap-2">
				{#if text.length > 0}
					<span
						class="text-[11.5px] font-medium tabular-nums {overHardLimit
							? 'text-[var(--tone-error-text)]'
							: overSoftLimit
								? 'text-warm-500'
								: 'text-[var(--ui-text-dimmed)]'}">{countLabel}</span
					>
				{/if}
				<button
					type="button"
					onclick={submit}
					disabled={posting || !text.trim() || overHardLimit}
					class="flex items-center gap-1.5 rounded-lg bg-primary-500 px-4 py-2 text-[13px] font-bold text-white shadow-[var(--glow-primary)] transition-all hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
				>
					<Icon
						name={posting ? 'i-lucide-loader-circle' : 'i-lucide-send-horizontal'}
						class="size-4 {posting ? 'animate-spin' : ''}"
					/>
					{posting ? 'Posting…' : 'Post'}
				</button>
			</div>
		</div>
	</div>
{/if}
