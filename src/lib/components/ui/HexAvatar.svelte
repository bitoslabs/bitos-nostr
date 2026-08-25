<script lang="ts">
	import { initialsFrom, hueFromKey } from '$lib/utils/format';
	import { cn } from '$lib/utils/cn';

	/**
	 * Hexagon-clipped avatar with an optional verified (lightning) badge.
	 * Renders the Nostr picture when available, otherwise a deterministic
	 * gradient + initials derived from the pubkey/name. Pure presentation —
	 * the caller owns the data.
	 */
	let {
		name = null,
		picture = null,
		pubkey = '',
		size = 40,
		verified = false,
		lightning = false,
		ring = false,
		class: cls
	}: {
		name?: string | null;
		picture?: string | null;
		pubkey?: string;
		size?: number;
		verified?: boolean;
		lightning?: boolean;
		ring?: boolean;
		class?: string;
	} = $props();

	let failed = $state(false);
	// Re-evaluate the fallback whenever the picture changes.
	$effect(() => {
		void picture;
		failed = false;
	});
	const showImg = $derived(!!picture && !failed);
	const hue = $derived(hueFromKey(pubkey || name || ''));
	const initials = $derived(initialsFrom(name));
	const badgeSize = $derived(Math.max(11, Math.round(size * 0.32)));
</script>

<span class={cn('relative inline-block shrink-0', cls)} style="width:{size}px;height:{size}px">
	<span
		class="hex-clip block size-full overflow-hidden"
		style={ring
			? `padding:2px;background:linear-gradient(135deg,var(--ui-color-primary-500),var(--color-warm-500));`
			: ''}
	>
		<span
			class="block size-full"
			style="background:hsl({hue} 70% 45%);{ring ? 'border-radius:22%;' : ''}"
		>
			{#if showImg}
				<img
					src={picture!}
					alt=""
					class="size-full object-cover"
					onerror={() => (failed = true)}
					loading="lazy"
				/>
			{:else}
				<span
					class="grid size-full place-items-center font-semibold text-white"
					style="font-size:{Math.round(size * 0.36)}px"
					aria-hidden="true">{initials}</span
				>
			{/if}
		</span>
	</span>
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
		<!-- NIP-05 verified badge — z-index above the hexagon layers, ring for
		     separation (design: .hex-avatar.verified::after, z-index 2 + border). -->
		<span
			class="glow-success absolute -right-0.5 -bottom-0.5 z-[2] grid place-items-center rounded-full bg-[var(--tone-success-text)] text-[var(--ui-text-inverted)] ring-[1.5px] ring-[var(--surface-bg)]"
			style="width:{badgeSize}px;height:{badgeSize}px;font-size:{Math.round(badgeSize * 0.5)}px"
			aria-label="Verified (NIP-05)"
			title="Verified (NIP-05)"
		>
			<svg viewBox="0 0 24 24" class="size-[62%]" fill="currentColor" aria-hidden="true">
				<path d="M9.6 16.6 5.4 12.4 4 13.8l5.6 5.6 10.4-10.4L18.6 7.6 9.6 16.6Z" />
			</svg>
		</span>
	{/if}
</span>
