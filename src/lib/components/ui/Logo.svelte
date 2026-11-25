<script lang="ts">
	import { cn } from '$lib/utils/cn';

	/**
	 * Official BitOS logo with automatic dark/light artwork switching.
	 * - `wordmark` renders the horizontal logo: the animated bee mark from
	 *   bitos.space (`bitos-logo-animated.svg` on light surfaces, the
	 *   white-line variant on dark) beside the Outfit wordmark artwork
	 *   (`logo-wordmark.png` / `logo-wordmark-white.png`). Both pairs are
	 *   driven by the class-based `dark:` variant (see app.css), so the swap
	 *   respects the in-app theme toggle from first paint — app.html seeds
	 *   `.dark` before the bundle loads.
	 * - `icon` renders the square app badge (same artwork in both modes).
	 *
	 * Size with `height` (px). Widths scale automatically from the artwork.
	 */
	let {
		variant = 'wordmark',
		height = 28,
		class: cls,
		alt = 'BitOS'
	}: {
		variant?: 'wordmark' | 'icon';
		height?: number;
		class?: string;
		alt?: string;
	} = $props();
</script>

{#if variant === 'icon'}
	<img
		src="/icons/icon-192-192.png"
		{alt}
		width={height}
		{height}
		style="height:{height}px;width:{height}px"
		class={cn('rounded-[22%] object-contain', cls)}
		draggable="false"
	/>
{:else}
	<span
		class={cn('inline-flex items-center', cls)}
		style="height:{height}px;gap:{Math.round(height * 0.177 * 1000) / 1000}px"
	>
		<img
			src="/icons/bitos-logo-animated.svg"
			alt=""
			aria-hidden="true"
			width="399"
			height="268"
			class="h-full w-auto dark:hidden"
			draggable="false"
		/>
		<img
			src="/icons/bitos-logo-animated-dark.svg"
			alt=""
			aria-hidden="true"
			width="399"
			height="268"
			class="hidden h-full w-auto dark:block"
			draggable="false"
		/>
		<img
			src="/icons/logo-wordmark.png"
			{alt}
			width="568"
			height="216"
			style="height:{height * 0.5625}px;width:auto"
			class="dark:hidden"
			draggable="false"
		/>
		<img
			src="/icons/logo-wordmark-white.png"
			{alt}
			width="568"
			height="216"
			style="height:{height * 0.5625}px;width:auto"
			class="hidden dark:block"
			draggable="false"
		/>
	</span>
{/if}
