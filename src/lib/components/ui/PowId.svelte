<script lang="ts">
	import { cn } from '$lib/utils/cn';
	import { toasts } from '$lib/stores/toasts.svelte';

	/**
	 * Raw NIP-13 receipt: an event-ID prefix where the leading zero hex
	 * chars — the actual proof — glow and the rest stays dimmed, separated
	 * by a "·" boundary marker. Click copies the full event id.
	 */
	let {
		id,
		bits,
		chars = 10,
		class: cls
	}: { id: string; bits: number; chars?: number; class?: string } = $props();

	const prefix = $derived(id.slice(0, chars));
	const zeroChars = $derived(Math.min(Math.floor(bits / 4), chars));
	const truncated = $derived(id.length > chars);

	async function copyId() {
		try {
			await navigator.clipboard.writeText(id);
			toasts.success('Event ID copied');
		} catch {
			toasts.error('Could not copy event ID');
		}
	}
</script>

<button
	type="button"
	onclick={copyId}
	class={cn(
		'group inline-flex shrink-0 items-baseline gap-px rounded-md px-1 font-mono leading-none',
		'transition hover:bg-[color-mix(in_oklab,var(--ui-color-primary-500)_10%,transparent)]',
		cls
	)}
	title="Click to copy — leading zeros are the mined Proof-of-Work"
>
	{#each prefix as char, index (index)}
		{#if index === zeroChars && zeroChars > 0}
			<span class="text-[var(--ui-text-dimmed)]" aria-hidden="true">·</span>
		{/if}
		<span
			class={cn(
				'text-[10px]',
				index < zeroChars
					? 'font-bold text-[var(--ui-color-primary-500)] [text-shadow:0_0_5px_color-mix(in_oklab,var(--ui-color-primary-500)_55%,transparent)]'
					: 'font-medium text-[var(--ui-text-dimmed)] group-hover:text-[var(--ui-text-muted)]'
			)}
		>
			{char}
		</span>
	{/each}
	{#if truncated}
		<span class="text-[10px] font-medium text-[var(--ui-text-dimmed)]" aria-hidden="true">…</span>
	{/if}
	<span class="sr-only">{bits} bits of Proof-of-Work, copy event id</span>
</button>
