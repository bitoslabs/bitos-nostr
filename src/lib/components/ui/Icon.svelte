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
	 *
	 * `title` renders an accessible tooltip (native title attribute) — used
	 * sparingly for icon-only buttons that need extra explanation.
	 */
	let {
		name,
		class: cls,
		size = '1em',
		title
	}: { name: string; class?: string; size?: string; title?: string } = $props();
</script>

{#if name}
	{#if title}
		<span class="inline-flex" {title}>
			<Iconify icon={toIconify(name)} width={size} height={size} class={cls} />
		</span>
	{:else}
		<Iconify icon={toIconify(name)} width={size} height={size} class={cls} />
	{/if}
{/if}
