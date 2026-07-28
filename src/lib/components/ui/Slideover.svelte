<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils/cn';

	/** Side panel drawer — overlay + panel, click-outside / ESC to close. */
	let {
		open = $bindable(false),
		side = 'right',
		width = 'w-80',
		title,
		children,
		actions
	}: {
		open?: boolean;
		side?: 'left' | 'right';
		width?: string;
		title?: string;
		children?: Snippet;
		actions?: Snippet;
	} = $props();

	const onKey = (e: KeyboardEvent) => {
		if (open && e.key === 'Escape') open = false;
	};
</script>

<svelte:window onkeydown={onKey} />

{#if open}
	<button
		type="button"
		aria-label="Close panel"
		tabindex="-1"
		class="animate-fade fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]"
		onclick={() => (open = false)}
	></button>
	<div
		class="animate-fade glass fixed top-0 z-50 flex h-screen flex-col border-[var(--glass-border)] backdrop-blur-xl {side ===
		'left'
			? 'left-0 border-r'
			: 'right-0 border-l'} {width}"
		role="dialog"
		aria-modal="true"
	>
		{#if title || actions}
			<header
				class="flex h-14 shrink-0 items-center justify-between border-b border-[var(--glass-border)] px-4"
			>
				<h2 class="truncate text-[15px] font-bold tracking-tight">{title}</h2>
				<div class="flex items-center gap-1">
					{@render actions?.()}
					<button
						type="button"
						onclick={() => (open = false)}
						class="grid size-8 place-items-center rounded-lg text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
						aria-label="Close"
					>
						<svg
							viewBox="0 0 24 24"
							class="size-4 fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
							><path d="M18 6 6 18M6 6l12 12" /></svg
						>
					</button>
				</div>
			</header>
		{/if}
		<div class={cn('min-h-0 flex-1 overflow-y-auto')}>
			{@render children?.()}
		</div>
	</div>
{/if}
