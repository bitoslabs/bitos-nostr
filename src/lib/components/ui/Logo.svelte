<script lang="ts">
	import { cn } from '$lib/utils/cn';

	/**
	 * Official BitOS logo with automatic dark/light artwork switching.
	 * - `wordmark` renders the horizontal logo: dark artwork (`logo.png`) on
	 *   light surfaces, the white variant (`logo-white.png`) when the app
	 *   theme is dark. Both are driven by the class-based `dark:` variant
	 *   (see app.css), so the swap respects the in-app theme toggle from
	 *   first paint — app.html seeds `.dark` before the bundle loads.
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
	<span class={cn('inline-flex items-center', cls)} style="height:{height}px">
		<img
			src="/icons/logo.png"
			{alt}
			width="156"
			height="62"
			class="h-full w-auto dark:hidden"
			draggable="false"
		/>
		<img
			src="/icons/logo-white.png"
			{alt}
			width="640"
			height="219"
			class="hidden h-full w-auto dark:block"
			draggable="false"
		/>
	</span>
{/if}
