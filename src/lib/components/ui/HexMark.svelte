<script lang="ts">
	import { cn } from '$lib/utils/cn';

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

	// Lightning bolt extracted from the BitOS logo (static/bitos-lightning-bolt.svg).
	const BOLT_PATH =
		'M 0,296 C 37,254 69,222 99,195 C 135,163 168,139 199,121 L 313,51 C 317,49 320,52 318,57 L 306,119 C 370,81 429,55 484,36 C 547,14 606,3 664,0 C 619,14 580,29 548,45 C 508,65 472,83 441,99 C 397,122 354,149 312,180 L 231,243 C 227,246 228,241 229,236 L 241,160 C 195,184 148,211 101,241 C 65,264 31,282 0,296 Z';

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
				<stop offset="0" stop-color="#FFD83D" />
				<stop offset="0.5" stop-color="#FFB51B" />
				<stop offset="1" stop-color="#F7931A" />
			</linearGradient>
		</defs>
		<path d={BOLT_PATH} fill={`url(#${gradId})`} fill-rule="evenodd" />
	</svg>
{/if}
