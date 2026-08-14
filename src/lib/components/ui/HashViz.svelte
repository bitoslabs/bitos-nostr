<script lang="ts">
	import { cn } from '$lib/utils/cn';

	/**
	 * Leading-bits hash visualization (NIP-13 style). Renders `length`
	 * segments; the first `bits` are lit. Used to preview mined difficulty
	 * in the composer.
	 */
	let {
		bits = 0,
		length = 32,
		mining = false,
		class: cls
	}: { bits?: number; length?: number; mining?: boolean; class?: string } = $props();

	const segments = $derived(Array.from({ length }, (_, i) => i < Math.min(bits, length)));
</script>

<span
	class={cn('hash-viz', mining && 'is-mining', cls)}
	aria-label={mining ? `Mining for ${bits} leading bits` : `${bits} leading bits`}
	role="img"
>
	{#each segments as on, index (index)}
		<span class={on ? 'is-on' : ''}></span>
	{/each}
</span>
