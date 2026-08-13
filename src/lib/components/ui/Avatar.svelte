<script lang="ts">
	import { initialsFrom, hueFromKey } from '$lib/utils/format';
	import { cn } from '$lib/utils/cn';

	/**
	 * Profile avatar. Shows the Nostr picture if available, else a deterministic
	 * flat color + initials derived from the pubkey. The docs/ui.html design
	 * system uses hexagon avatars, so `hex` is the default shape; pass `squircle`
	 * or `circle` to override per use.
	 */
	let {
		pubkey,
		name,
		picture,
		size = 40,
		shape = 'hex',
		frame = false,
		class: cls
	}: {
		pubkey: string;
		name?: string | null;
		picture?: string | null;
		size?: number;
		shape?: 'hex' | 'squircle' | 'circle';
		frame?: boolean;
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
</script>

<div
	class={cn(
		'relative grid shrink-0 place-items-center overflow-hidden font-semibold',
		shapeClass,
		frame && 'border border-[var(--ui-border-muted)]',
		cls
	)}
	style="width:{size}px;height:{size}px;font-size:{Math.round(
		size * 0.38
	)}px;background:{fallbackBg};color:#fff"
	aria-hidden="true"
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
