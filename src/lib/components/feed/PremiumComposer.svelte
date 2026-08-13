<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import HexAvatar from '$lib/components/ui/HexAvatar.svelte';
	import HashViz from '$lib/components/ui/HashViz.svelte';
	import RelayDot from '$lib/components/ui/RelayDot.svelte';
	import { cn } from '$lib/utils/cn';
	import { untrack } from 'svelte';

	const MAX_CHARS = 280;

	/**
	 * Premium composer: avatar, auto-growing textarea, a collapsible Proof-of-
	 * Work panel (slider → hash viz → broadcast relay chips), a tool row, a live
	 * character counter, and the broadcast button. Emits `onPost` with the
	 * composed payload; the parent owns publishing.
	 */
	let {
		name = 'You',
		picture = null,
		pubkey = '',
		verified = false,
		relays = [],
		defaultPow = 20,
		onPost
	}: {
		name?: string;
		picture?: string | null;
		pubkey?: string;
		verified?: boolean;
		relays?: { url: string; status?: 'connected' | 'connecting' | 'down' }[];
		defaultPow?: number;
		onPost?: (payload: { content: string; pow: number }) => void;
	} = $props();

	let text = $state('');
	let pow = $state(untrack(() => defaultPow));
	let showTools = $state(false);

	const remaining = $derived(MAX_CHARS - text.length);
	const overLimit = $derived(remaining < 0);
	const nearLimit = $derived(remaining < 40 && !overLimit);
	const canPost = $derived(text.trim().length > 0 && !overLimit);

	function submit() {
		if (!canPost) return;
		onPost?.({ content: text.trim(), pow });
		text = '';
	}

	function onKeydown(e: KeyboardEvent) {
		// Cmd/Ctrl+Enter broadcasts.
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			submit();
		}
	}
</script>

<div
	class="border-b border-[var(--ui-border-muted)] p-3.5 px-4 transition-all focus-within:bg-[color-mix(in_oklab,var(--ui-color-primary-500)_3%,transparent)]"
>
	<div class="flex gap-3">
		<HexAvatar {name} {picture} {pubkey} {verified} size={40} class="flex-shrink-0" />
		<div class="min-w-0 flex-1">
			<textarea
				bind:value={text}
				onkeydown={onKeydown}
				placeholder="Mine a new note… what's on the timeline?"
				rows="2"
				class="min-h-[48px] w-full resize-none border-none bg-transparent text-lg text-[var(--ui-text)] outline-none placeholder:text-[var(--ui-text-dimmed)]"
			></textarea>
			{#if showTools}
				<div class="mt-2.5 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--interactive-hover-bg)] p-3">
					<div class="mb-2.5 flex items-center justify-between">
						<span class="text-xs tracking-wider text-[var(--ui-text-muted)] uppercase">
							Proof of Work
						</span>
						<span class="font-mono text-sm font-semibold text-[var(--ui-color-primary-500)]">
							{pow} bits
						</span>
					</div>
					<input
						type="range"
						min="0"
						max="32"
						bind:value={pow}
						class="pow-slider w-full"
						aria-label="Proof of Work difficulty"
					/>
					<HashViz bits={pow} class="mt-2.5" />
					{#if relays.length}
						<div class="mt-3 border-t border-[var(--ui-border-muted)] pt-3">
							<div class="mb-2 text-xs tracking-wider text-[var(--ui-text-muted)] uppercase">
								Broadcast to Relays
							</div>
							<div class="flex flex-wrap gap-1.5">
								{#each relays.slice(0, 4) as r (r.url)}
									<span
										class="inline-flex items-center gap-1.5 rounded-full border border-[color-mix(in_oklab,var(--tone-success-text)_22%,transparent)] bg-[color-mix(in_oklab,var(--tone-success-text)_10%,transparent)] px-2 py-0.5 font-mono text-[10px] text-[var(--tone-success-text)]"
									>
										<RelayDot status={r.status ?? 'connected'} size={4} />
										{r.url}
									</span>
								{/each}
								{#if relays.length > 4}
									<span
										class="rounded-full border border-[var(--ui-border-muted)] bg-[var(--interactive-hover-bg)] px-2 py-0.5 font-mono text-[10px] text-[var(--ui-text-muted)]"
									>
										+ {relays.length - 4} more
									</span>
								{/if}
							</div>
						</div>
					{/if}
				</div>
			{/if}

			<div class="mt-3 flex items-center justify-between">
				<div class="flex gap-1">
					<button type="button" class="icon-btn size-9" aria-label="Attach image">
						<Icon name="i-lucide-image" class="size-[13px]" />
					</button>
					<button type="button" class="icon-btn size-9" aria-label="Attach file">
						<Icon name="i-lucide-paperclip" class="size-[13px]" />
					</button>
					<button type="button" class="icon-btn size-9" aria-label="Zap recipients">
						<Icon name="i-lucide-zap" class="size-[13px]" />
					</button>
					<button
						type="button"
						onclick={() => (showTools = !showTools)}
						class="icon-btn size-9"
						aria-label="Proof of Work"
						aria-pressed={showTools}
					>
						<Icon name="i-lucide-shield-check" class="size-[13px]" />
					</button>
				</div>
				<div class="flex items-center gap-3">
					<span
						class={cn(
							'font-mono text-sm',
							overLimit
								? 'text-[var(--tone-warning-text)]'
								: nearLimit
									? 'text-[var(--ui-color-primary-500)]'
									: 'text-[var(--ui-text-muted)]'
						)}
					>
						{remaining}
					</span>
					<button
						type="button"
						disabled={!canPost}
						onclick={submit}
						class="glow-accent rounded-full bg-[var(--ui-color-primary-500)] px-5 py-2.5 font-semibold text-[var(--ui-text-inverted)] transition-all hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-50"
					>
						Post Note
					</button>
				</div>
			</div>
		</div>
	</div>
</div>
