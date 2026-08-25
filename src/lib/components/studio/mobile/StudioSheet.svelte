<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import Icon from '$lib/components/ui/Icon.svelte';

	/**
	 * StudioSheet — the mobile-native bottom sheet primitive for the studio
	 * mobile shell (docs/studio-mobile-ux.md §3 zone 6): rounded-top panel,
	 * drag handle, backdrop, ESC dismissal. The editor owns open/close state
	 * (URL-driven via `?panel=`) so the hardware back button closes the sheet.
	 */

	let {
		open = false,
		title,
		icon,
		onclose,
		children
	}: {
		open?: boolean;
		title: string;
		icon?: string;
		onclose: () => void;
		children?: import('svelte').Snippet;
	} = $props();

	/** ESC is handled at the route level (the URL `?panel=` closes first),
	 *  so this sheet stays presentational: backdrop tap / ✕ only. */
</script>

{#if open}
	<div class="absolute inset-0 z-50" role="presentation">
		<!-- Backdrop -->
		<button
			type="button"
			aria-label="Close {title}"
			class="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
			transition:fade={{ duration: 150 }}
			onclick={onclose}
			tabindex="-1"
		></button>

		<!-- Sheet -->
		<div
			role="dialog"
			aria-modal="true"
			aria-label={title}
			class="absolute inset-x-0 bottom-0 flex max-h-[72%] flex-col rounded-t-3xl border-t border-[var(--ui-border-accented)] bg-[var(--surface-bg)] shadow-2xl"
			style="padding-bottom: env(safe-area-inset-bottom, 0px)"
			transition:fly={{ y: 320, duration: 260, opacity: 0.6 }}
		>
			<div class="flex flex-col items-center pt-2.5 pb-1">
				<span class="h-1 w-10 rounded-full bg-[var(--ui-border-accented)]"></span>
			</div>
			<header class="flex shrink-0 items-center justify-between px-5 pt-1 pb-3">
				<h3 class="flex items-center gap-2 text-[15px] font-bold text-[var(--ui-text-highlighted)]">
					{#if icon}
						<span class="text-warm-500">
							<Icon name={icon} class="size-4.5" />
						</span>
					{/if}
					{title}
				</h3>
				<button
					type="button"
					onclick={onclose}
					aria-label="Close"
					class="grid size-8 place-items-center rounded-full text-[var(--ui-text-dimmed)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] active:scale-95"
				>
					<svg
						viewBox="0 0 24 24"
						class="size-4.5"
						fill="none"
						stroke="currentColor"
						stroke-width="2.5"
						stroke-linecap="round"
					>
						<path d="M18 6 6 18M6 6l12 12" />
					</svg>
				</button>
			</header>
			<div class="min-h-0 flex-1 scrollbar-thin overflow-y-auto px-5 pb-5">
				{@render children?.()}
			</div>
		</div>
	</div>
{/if}
