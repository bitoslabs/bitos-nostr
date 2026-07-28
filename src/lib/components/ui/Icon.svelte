<script lang="ts" module>
	import Iconify from '@iconify/svelte';
	import { toIconify } from '$lib/icons';
</script>

<script lang="ts">
	/**
	 * App-level Icon wrapper around @iconify/svelte. Accepts Nuxt-Icon style
	 * names (`i-lucide-plus`) OR Iconify names (`lucide:plus`). The Lucide
	 * collection is registered offline in lib/icons.ts, so this works with SSR
	 * and no network.
	 */
	let {
		name,
		class: cls,
		size = '1em'
	}: { name: string; class?: string; size?: string } = $props();
</script>

{#if name}
	<Iconify icon={toIconify(name)} width={size} height={size} class={cls} />
{/if}
