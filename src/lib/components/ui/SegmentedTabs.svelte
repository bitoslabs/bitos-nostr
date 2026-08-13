<script lang="ts">
	import { cn } from '$lib/utils/cn';

	/** A single tab in a SegmentedTabs row. */
	export type Tab = { key: string; label: string; badge?: string | number };

	/**
	 * Underline tab bar: a row of labels with an accent underline on the active
	 * item. Controlled — the parent owns the active key and reacts via onChange.
	 * Horizontally scrollable for many tabs (e.g. pinned hashtags).
	 */
	let {
		tabs = [],
		active,
		onChange,
		class: cls
	}: {
		tabs?: Tab[];
		active: string;
		onChange?: (key: string) => void;
		class?: string;
	} = $props();
</script>

<div
	class={cn(
		'flex [scrollbar-width:none] items-center gap-1 overflow-x-auto [&::-webkit-scrollbar]:hidden',
		cls
	)}
>
	{#each tabs as tab (tab.key)}
		{@const on = tab.key === active}
		<button
			type="button"
			onclick={() => onChange?.(tab.key)}
			aria-current={on ? 'page' : undefined}
			class={cn(
				'pulse-tab-active relative flex shrink-0 items-center gap-1.5 px-3.5 py-4 text-center text-sm font-semibold whitespace-nowrap transition-colors',
				on
					? 'text-[var(--ui-color-primary-500)]'
					: 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'
			)}
		>
			{tab.label}
			{#if tab.badge !== undefined}
				<span
					class={cn(
						'rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold',
						on
							? 'bg-[color-mix(in_oklab,var(--ui-color-primary-500)_18%,transparent)] text-[var(--ui-color-primary-500)]'
							: 'bg-[var(--interactive-hover-bg)] text-[var(--ui-text-muted)]'
					)}
				>
					{tab.badge}
				</span>
			{/if}
			<span
				class="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[var(--ui-color-primary-500)] transition-opacity"
				style="opacity:{on
					? 1
					: 0};box-shadow:0 0 12px color-mix(in oklab,var(--ui-color-primary-500) 40%,transparent);"
			></span>
		</button>
	{/each}
</div>
