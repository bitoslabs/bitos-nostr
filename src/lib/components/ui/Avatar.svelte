<script lang="ts">
	import { initialsFrom, hueFromKey } from '$lib/utils/format';
	import { cn } from '$lib/utils/cn';

	/**
	 * Profile avatar. Shows the Nostr picture if available, else a deterministic
	 * flat color + initials derived from the pubkey. The docs/ui.html design
	 * system uses hexagon avatars, so `hex` is the default shape; pass `squircle`
	 * or `circle` to override per use.
	 *
	 * `frame` renders a 2px hexagonal border using the same layering as the
	 * docs/ui-page-more.html design (`.hex-border` + `.hex-inner`): a colored
	 * clipped layer behind the content, with the content inset 2px. A plain CSS
	 * border/ring would be sliced by the clip-path, so it must be a layer.
	 *
	 * The verified (NIP-05) badge sits on an unclipped layer above everything
	 * (`z-index: 2` + surface ring), matching the design's
	 * `.hex-avatar.verified::after`.
	 */
	let {
		pubkey,
		name,
		picture,
		size = 40,
		shape = 'hex',
		frame = false,
		verified = false,
		lightning = false,
		class: cls
	}: {
		pubkey: string;
		name?: string | null;
		picture?: string | null;
		size?: number;
		shape?: 'hex' | 'squircle' | 'circle';
		frame?: boolean;
		verified?: boolean;
		lightning?: boolean;
		class?: string;
	} = $props();

	let failed = $state(false);
	const showImg = $derived(!!picture && !failed);
	const hue = $derived(hueFromKey(pubkey));
	const fallbackBg = $derived(`hsl(${hue} 70% 50%)`);
	const initials = $derived(initialsFrom(name));
	const shapeClass = $derived(
		shape === 'hex' ? 'hex-clip' : shape === 'circle' ? 'rounded-full' : 'mask-squircle'
	);
	const badgeSize = $derived(Math.max(11, Math.round(size * 0.32)));
</script>

<div
	class={cn('relative grid shrink-0', cls)}
	style="width:{size}px;height:{size}px"
	aria-hidden="true"
>
	{#if frame}
		<!-- Hexagonal border layer (design-system .hex-border) -->
		<span
			class="{shapeClass} absolute inset-0 block bg-gradient-to-br from-primary-400/90 via-primary-500/80 to-warm-500/70"
		></span>
	{/if}

	<!-- Content layer (design-system .hex-inner — inset 2px when framed) -->
	<div
		class={cn(
			'grid place-items-center overflow-hidden font-semibold',
			shapeClass,
			frame ? 'absolute inset-[2px]' : 'absolute inset-0'
		)}
		style="font-size:{Math.round(size * 0.38)}px;background:{fallbackBg};color:#fff"
	>
		{#if showImg}
			<img
				src={picture!}
				alt=""
				class="absolute inset-0 size-full object-cover"
				onerror={() => (failed = true)}
				loading="lazy"
			/>
		{:else}
			<span class="relative">{initials}</span>
		{/if}
	</div>

	{#if lightning}
		<!-- Lightning badge — green chip with the zap bolt -->
		<span
			class="absolute -right-0.5 -bottom-0.5 z-[1] grid place-items-center rounded-full bg-green-500 text-[var(--ui-text-inverted)] ring-[1.5px] ring-[var(--surface-bg)] drop-shadow-[0_0_3px_rgba(34,197,94,0.55)]"
			style="width:{badgeSize}px;height:{badgeSize}px;font-size:{Math.round(badgeSize * 0.5)}px"
			aria-label="Lightning address"
			title="Lightning address"
		>
			<svg viewBox="0 0 24 24" class="size-[62%]" fill="currentColor" aria-hidden="true">
				<path
					d="M13.26 1.8a.6.6 0 0 1 1.07.51L12.96 9h4.99c.5 0 .76.6.42.98l-8.63 9.72a.6.6 0 0 1-1.05-.45L9.2 13H4.44a.6.6 0 0 1-.44-1.01l9.26-10.2Z"
				/>
			</svg>
		</span>
	{/if}

	{#if verified}
		<!-- NIP-05 verified badge — unclipped, above the hexagon layers -->
		<span
			class="absolute -right-0.5 -bottom-0.5 z-[2] grid place-items-center rounded-full bg-[var(--tone-success-text)] text-[var(--ui-text-inverted)] ring-[1.5px] ring-[var(--surface-bg)]"
			style="width:{badgeSize}px;height:{badgeSize}px;font-size:{Math.round(badgeSize * 0.5)}px"
			aria-label="Verified (NIP-05)"
			title="Verified (NIP-05)"
		>
			<svg viewBox="0 0 24 24" class="size-[62%]" fill="currentColor" aria-hidden="true">
				<path d="M9.6 16.6 5.4 12.4 4 13.8l5.6 5.6 10.4-10.4L18.6 7.6 9.6 16.6Z" />
			</svg>
		</span>
	{/if}
</div>
