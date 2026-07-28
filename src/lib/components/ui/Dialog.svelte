<script lang="ts">
	import type { Snippet } from 'svelte';

	/** Centered modal dialog. Closes on overlay click / ESC. */
	let {
		open = $bindable(false),
		title,
		children,
		footer
	}: { open?: boolean; title?: string; children?: Snippet; footer?: Snippet } = $props();

	const onKey = (e: KeyboardEvent) => {
		if (open && e.key === 'Escape') open = false;
	};
</script>

<svelte:window onkeydown={onKey} />

{#if open}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
		<button
			type="button"
			aria-label="Close dialog"
			tabindex="-1"
			class="animate-fade absolute inset-0 bg-black/45 backdrop-blur-[3px]"
			onclick={() => (open = false)}
		></button>
		<div
			class="surface-card animate-rise relative z-10 flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden shadow-2xl shadow-black/30"
			role="dialog"
			aria-modal="true"
		>
			{#if title}
				<header class="flex h-14 shrink-0 items-center border-b border-[var(--ui-border)] px-5">
					<h2 class="text-[16px] font-bold tracking-tight">{title}</h2>
				</header>
			{/if}
			<div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
				{@render children?.()}
			</div>
			{#if footer}
				<footer
					class="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--ui-border)] px-5 py-3.5"
				>
					{@render footer()}
				</footer>
			{/if}
		</div>
	</div>
{/if}
