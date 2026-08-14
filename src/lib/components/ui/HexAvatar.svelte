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
		ring = false,
		class: cls
	}: {
		name?: string | null;
		picture?: string | null;
		pubkey?: string;
		size?: number;
		verified?: boolean;
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
		style="{ring
			? `padding:2px;background:linear-gradient(135deg,var(--ui-color-primary-500),var(--color-warm-500));`
			: ''}"
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
	{#if verified}
		<span
			class="absolute -right-0.5 -bottom-0.5 grid place-items-center rounded-full bg-[var(--tone-success-text)] text-black glow-success"
			style="width:{badgeSize}px;height:{badgeSize}px;font-size:{Math.round(
				badgeSize * 0.5
			)}px"
			aria-label="Verified"
			title="Verified"
		>
			<svg viewBox="0 0 24 24" class="size-[60%]" fill="currentColor" aria-hidden="true">
				<path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5Z" />
			</svg>
		</span>
	{/if}
</span>
