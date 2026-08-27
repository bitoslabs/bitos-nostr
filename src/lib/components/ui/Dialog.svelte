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
		zIndex = 100,
		onClose,
		children,
		footer
	}: {
		open?: boolean;
		title?: string;
		closeOnOverlay?: boolean;
		/** Raise this when a dialog is opened from another dialog. */
		zIndex?: number;
		onClose?: () => void;
		children?: Snippet;
		footer?: Snippet;
	} = $props();
	let portalNode: HTMLElement | null = null;

	const dismiss = () => {
		if (!closeOnOverlay) return;
		open = false;
		onClose?.();
	};

	const onKey = (e: KeyboardEvent) => {
		if (open && e.key === 'Escape' && closeOnOverlay && isTopmost()) {
			open = false;
			onClose?.();
		}
	};

	/** Nested dialogs each receive window key events; only the visual top layer
	 * should react, so Escape closes one dialog per press. */
	function isTopmost() {
		if (!portalNode) return false;
		const layers = [...document.querySelectorAll<HTMLElement>('[data-dialog-layer]')];
		const top = layers.reduce<HTMLElement | null>((current, layer) => {
			if (!current) return layer;
			const currentZ = Number.parseInt(getComputedStyle(current).zIndex, 10) || 0;
			const layerZ = Number.parseInt(getComputedStyle(layer).zIndex, 10) || 0;
			// A later node wins when layers share a z-index.
			return layerZ >= currentZ ? layer : current;
		}, null);
		return top === portalNode;
	}

	/**
	 * Dialogs can be declared inside a scrolling or multi-column route. Move the
	 * live overlay to `body` so `position: fixed` always uses the viewport rather
	 * than that route's layout box (especially important on narrow screens).
	 */
	function portal(node: HTMLElement) {
		portalNode = node;
		document.body.append(node);
		return {
			destroy() {
				if (portalNode === node) portalNode = null;
				node.remove();
			}
		};
	}
</script>

<svelte:window onkeydown={onKey} />

{#if open}
	<div
		use:portal
		data-dialog-layer
		style:z-index={zIndex}
		class="fixed inset-0 flex items-center justify-center p-4"
	>
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
				<header
					class="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--ui-border)] px-5"
				>
					<h2 class="text-[16px] font-bold tracking-tight">{title}</h2>
					{#if closeOnOverlay}
						<button
							type="button"
							onclick={dismiss}
							aria-label="Close dialog"
							class="grid size-8 shrink-0 place-items-center rounded-full text-lg leading-none text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
						>
							×
						</button>
					{/if}
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
