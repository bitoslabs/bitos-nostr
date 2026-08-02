<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import { cn } from '$lib/utils/cn';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { browser } from '$app/environment';

	/**
	 * Full-screen image lightbox — a true media viewer for note attachments.
	 * Click the image (or press +) to toggle a pan/zoom view, ← / → to move
	 * between images, ESC to close. The dark backdrop closes on click while the
	 * floating glass controls (close, prev/next, zoom, copy, open) stay fixed.
	 */
	let {
		open = $bindable(false),
		images = [],
		index = $bindable(0)
	}: { open?: boolean; images?: string[]; index?: number } = $props();

	let zoomed = $state(false);
	let failed = $state<Record<string, boolean>>({});

	const current = $derived(images[index]);
	const hasMany = $derived(images.length > 1);
	const canPrev = $derived(index > 0);
	const canNext = $derived(index < images.length - 1);

	// Reset interaction state whenever the lightbox closes.
	$effect(() => {
		if (!open) {
			zoomed = false;
		}
	});

	function close() {
		open = false;
	}
	function prev() {
		if (canPrev) index -= 1;
	}
	function next() {
		if (canNext) index += 1;
	}

	function onKey(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') close();
		else if (e.key === 'ArrowLeft') prev();
		else if (e.key === 'ArrowRight') next();
		else if (e.key === '+' || e.key === '=') zoomed = true;
		else if (e.key === '-' || e.key === '_') zoomed = false;
	}

	function onCanvasClick(e: MouseEvent) {
		// Only close when the dark canvas itself (not the image) is clicked.
		if (e.target === e.currentTarget) close();
	}

	function toggleZoom() {
		zoomed = !zoomed;
	}

	function portal(node: HTMLElement) {
		if (!browser) return;
		document.body.appendChild(node);
		return {
			destroy() {
				if (node.parentNode) node.parentNode.removeChild(node);
			}
		};
	}

	async function copyUrl() {
		if (!browser || !current) return;
		try {
			await navigator.clipboard.writeText(current);
			toasts.success('Image URL copied');
		} catch {
			toasts.error('Could not copy URL');
		}
	}
</script>

<svelte:window onkeydown={onKey} />

{#if open && current}
	<div
		use:portal
		class="fixed inset-0 z-[70] pointer-events-none"
	>
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div
			class={cn(
				'pointer-events-auto fixed inset-0 overflow-hidden bg-black/92 px-4 pt-16 pb-24 backdrop-blur-sm sm:px-8 sm:pt-20 sm:pb-28',
				zoomed ? 'flex items-start justify-start' : 'flex items-center justify-center'
			)}
			role="presentation"
			onclick={onCanvasClick}
		>
			{#if failed[current]}
				<div class="m-auto flex flex-col items-center gap-3 text-white/70">
					<div class="grid size-14 place-items-center rounded-full bg-white/10">
						<Icon name="i-lucide-image-off" class="size-7" />
					</div>
					<p class="text-[13px] font-semibold">Couldn’t load image</p>
					<a
						href={current}
						target="_blank"
						rel="noreferrer"
						class="text-[12px] font-bold text-[var(--ui-color-primary-400)] hover:underline"
					>
						Open original ↗
					</a>
				</div>
			{:else}
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<img
					src={current}
					alt=""
					referrerpolicy="no-referrer"
					draggable="false"
					onerror={() => (failed = { ...failed, [current]: true })}
					onclick={toggleZoom}
					class={cn(
						'select-none object-contain transition-[max-height,max-width] duration-300 ease-out',
						zoomed
							? 'max-h-none max-w-none cursor-zoom-out'
							: 'max-h-[calc(100dvh-10rem)] max-w-[calc(100vw-2rem)] cursor-zoom-in sm:max-h-[calc(100dvh-12rem)] sm:max-w-[calc(100vw-4rem)]'
					)}
				/>
			{/if}
		</div>

		<!-- Floating close -->
		<button
			type="button"
			onclick={close}
			class="pointer-events-auto fixed right-4 top-4 z-[71] grid size-10 place-items-center rounded-full bg-white/10 text-white backdrop-blur-md transition hover:bg-white/20"
			aria-label="Close preview"
		>
			<Icon name="i-lucide-x" class="size-5" />
		</button>

		<!-- Floating prev / next -->
		{#if hasMany}
			<button
				type="button"
				onclick={prev}
				disabled={!canPrev}
				class="pointer-events-auto fixed top-1/2 left-3 z-[71] grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white backdrop-blur-md transition hover:bg-white/20 disabled:pointer-events-none disabled:opacity-30"
				aria-label="Previous image"
			>
				<Icon name="i-lucide-chevron-left" class="size-6" />
			</button>
			<button
				type="button"
				onclick={next}
				disabled={!canNext}
				class="pointer-events-auto fixed top-1/2 right-3 z-[71] grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white backdrop-blur-md transition hover:bg-white/20 disabled:pointer-events-none disabled:opacity-30"
				aria-label="Next image"
			>
				<Icon name="i-lucide-chevron-right" class="size-6" />
			</button>
		{/if}

		<!-- Floating bottom toolbar -->
		<div class="pointer-events-none fixed inset-x-0 bottom-0 z-[71] flex items-center justify-center p-4">
			<div
				class="pointer-events-auto flex items-center gap-1 rounded-full border border-white/10 bg-white/10 px-2 py-1.5 text-white backdrop-blur-md"
			>
				{#if hasMany}
					<span class="px-2 text-[12px] font-bold tabular-nums">{index + 1} / {images.length}</span>
					<span class="mx-0.5 h-4 w-px bg-white/20"></span>
				{/if}
				<button
					type="button"
					onclick={toggleZoom}
					class="grid size-8 place-items-center rounded-full transition hover:bg-white/15"
					aria-label={zoomed ? 'Zoom out' : 'Zoom in'}
					title={zoomed ? 'Zoom out' : 'Zoom in'}
				>
					<Icon name={zoomed ? 'i-lucide-zoom-out' : 'i-lucide-zoom-in'} class="size-4" />
				</button>
				<button
					type="button"
					onclick={copyUrl}
					class="grid size-8 place-items-center rounded-full transition hover:bg-white/15"
					aria-label="Copy image URL"
					title="Copy image URL"
				>
					<Icon name="i-lucide-copy" class="size-4" />
				</button>
				<a
					href={current}
					target="_blank"
					rel="noreferrer"
					class="grid size-8 place-items-center rounded-full transition hover:bg-white/15"
					aria-label="Open original"
					title="Open original"
				>
					<Icon name="i-lucide-external-link" class="size-4" />
				</a>
			</div>
		</div>
	</div>
{/if}
