<script lang="ts">
	import { cn } from '$lib/utils/cn';
	import { BOLT_PATH, BOLT_GRADIENT_STOPS } from '$lib/brand';

	/**
	 * BitOS brand mark — the official lightning bolt from
	 * `static/bitos-lightning-bolt.svg`, kept in sync with that file.
	 * - `badge`: filled warm/orange gradient hexagon with the white bolt —
	 *   the boot-splash lockup look (bolt spans ~57% of the badge width).
	 * - bare: the bolt alone in its real yellow→Bitcoin-orange gradient —
	 *   sits inside a HexIcon ring (see the About page hero).
	 *
	 * `size` is the square box the bolt is scaled into (uniform, centered —
	 * same convention as the boot splash symbol).
	 */
	let {
		size = 34,
		badge = true,
		class: cls
	}: { size?: number | string; badge?: boolean; class?: string } = $props();

	// Unique gradient id per instance so multiple marks can coexist.
	const gradId = `hexbolt-${Math.random().toString(36).slice(2, 8)}`;
	// Prettier normalizes `size={34}` to `size="34"` — accept both.
	const px = $derived(typeof size === 'number' ? size : Number(size) || 0);
</script>

{#if badge}
	<span
		class={cn(
			'hex-clip grid shrink-0 place-items-center bg-[linear-gradient(135deg,#FFB51B,#F7931A)]',
			cls
		)}
		style="width:{px}px;height:{px}px"
		aria-hidden="true"
	>
		<svg viewBox="0 0 664 297" width={Math.round(px * 0.57)} aria-hidden="true">
			<path d={BOLT_PATH} fill="#fff" fill-rule="evenodd" />
		</svg>
	</span>
{:else}
	<svg viewBox="0 0 664 297" class={cls} style="width:{px}px;height:{px}px" aria-hidden="true">
		<defs>
			<linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
				{#each BOLT_GRADIENT_STOPS as color, i (color)}
					<stop offset={i / (BOLT_GRADIENT_STOPS.length - 1)} stop-color={color} />
				{/each}
			</linearGradient>
		</defs>
		<path d={BOLT_PATH} fill={`url(#${gradId})`} fill-rule="evenodd" />
	</svg>
{/if}
