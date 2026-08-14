<script lang="ts">
	import { cn } from '$lib/utils/cn';
	import PowId from '$lib/components/ui/PowId.svelte';

	/** Proof-of-Work visualization: a row of 16 segments whose fill count maps
	 * to the mined difficulty (bits), plus the numeric label. Used on notes,
	 * quotes, and the composer. `micro` renders a dense shield + bits inline
	 * variant for comment rows where a full segment bar would be noise. */
	let {
		bits = 0,
		max = 32,
		showLabel = true,
		compact = false,
		micro = false,
		id,
		class: cls
	}: {
		bits?: number;
		max?: number;
		showLabel?: boolean;
		compact?: boolean;
		/** Dense inline variant (shield + bits) for comment/list rows. */
		micro?: boolean;
		/** Optional event id — full variant appends the raw `00009215` receipt;
		 * micro adds it to the tooltip. */
		id?: string;
		class?: string;
	} = $props();

	// Map [0..max] bits onto 16 segments.
	const SEGMENTS = 16;
	const filled = $derived(Math.min(SEGMENTS, Math.round((Math.min(bits, max) / max) * SEGMENTS)));
	const segments = $derived(Array.from({ length: SEGMENTS }, (_, i) => i < filled));
</script>

{#if micro}
	<span
		class={cn(
			'inline-flex shrink-0 items-center gap-0.5 rounded-md border px-1 py-px',
			'bg-[color-mix(in_oklab,var(--ui-color-primary-500)_7%,transparent)]',
			'border-[color-mix(in_oklab,var(--ui-color-primary-500)_18%,transparent)]',
			cls
		)}
		title="{bits} bits of Proof-of-Work{id ? ` — ${id.slice(0, 10)}…` : ''}"
	>
		<svg
			class="size-2.5 shrink-0 text-[var(--ui-color-primary-500)]"
			viewBox="0 0 24 24"
			fill="currentColor"
			aria-hidden="true"
		>
			<path d="M12 1 3 6v6c0 5 3.8 9.7 9 11 5.2-1.3 9-6 9-11V6l-9-5Z" opacity=".25" />
			<path
				d="M12 2 4 6.2v5.6c0 4.5 3.4 8.7 8 9.9 4.6-1.2 8-5.4 8-9.9V6.2L12 2Zm-1 14-4-4 1.4-1.4L11 13.2l4.6-4.6L17 10l-6 6Z"
			/>
		</svg>
		<span
			class="font-mono text-[9.5px] leading-none font-semibold text-[var(--ui-color-primary-500)]"
		>
			{bits}
		</span>
	</span>
{:else}
	<span
		class={cn(
			'inline-flex items-center gap-2 rounded-lg border px-2.5 py-1',
			'tone-info border-transparent bg-transparent',
			'bg-[color-mix(in_oklab,var(--ui-color-primary-500)_7%,transparent)]',
			'border-[color-mix(in_oklab,var(--ui-color-primary-500)_18%,transparent)]',
			cls
		)}
		title="{bits} bits of Proof-of-Work"
	>
		<svg
			class="size-3 shrink-0 text-[var(--ui-color-primary-500)]"
			viewBox="0 0 24 24"
			fill="currentColor"
			aria-hidden="true"
		>
			<path d="M12 1 3 6v6c0 5 3.8 9.7 9 11 5.2-1.3 9-6 9-11V6l-9-5Z" opacity=".25" />
			<path
				d="M12 2 4 6.2v5.6c0 4.5 3.4 8.7 8 9.9 4.6-1.2 8-5.4 8-9.9V6.2L12 2Zm-1 14-4-4 1.4-1.4L11 13.2l4.6-4.6L17 10l-6 6Z"
			/>
		</svg>
		{#if !compact}
			<span class="text-[10px] font-semibold tracking-wider text-[var(--ui-text-muted)] uppercase">
				PoW
			</span>
		{/if}
		<span class="pow-bar" aria-hidden="true">
			{#each segments as on, index (index)}
				<span class={on ? 'is-filled' : ''}></span>
			{/each}
		</span>
		{#if showLabel}
			<span class="font-mono text-[11px] font-semibold text-[var(--ui-color-primary-500)]">
				{bits}<span class="text-[var(--ui-text-muted)]">b</span>
			</span>
		{/if}
		{#if id}
			<PowId {id} {bits} chars={10} />
		{/if}
	</span>
{/if}
