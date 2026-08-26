<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Centered modal dialog. Closes on overlay click / ESC by default.
	 * Pass `closeOnOverlay={false}` to make the overlay non-dismissing
	 * (useful for destructive confirmations).
	 */
	let {
		open = $bindable(false),
		title,
		closeOnOverlay = true,
		onClose,
		children,
		footer
	}: {
		open?: boolean;
		title?: string;
		closeOnOverlay?: boolean;
		onClose?: () => void;
		children?: Snippet;
		footer?: Snippet;
	} = $props();

	const dismiss = () => {
		if (!closeOnOverlay) return;
		open = false;
		onClose?.();
	};

	const onKey = (e: KeyboardEvent) => {
		if (open && e.key === 'Escape' && closeOnOverlay) {
			open = false;
			onClose?.();
		}
	};

	/**
	 * Dialogs can be declared inside a scrolling or multi-column route. Move the
	 * live overlay to `body` so `position: fixed` always uses the viewport rather
	 * than that route's layout box (especially important on narrow screens).
	 */
	function portal(node: HTMLElement) {
		document.body.append(node);
	}
</script>

<svelte:window onkeydown={onKey} />

{#if open}
	<div use:portal class="fixed inset-0 z-[100] flex items-center justify-center p-4">
		<button
			type="button"
			aria-label="Close dialog"
			tabindex="-1"
			class="animate-fade absolute inset-0 bg-black/45 backdrop-blur-[3px]"
			onclick={dismiss}
		></button>
		<div
			class="surface-card animate-rise relative z-10 flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden border-white/30 shadow-2xl ring-1 shadow-black/30 ring-white/15"
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
