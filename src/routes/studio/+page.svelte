<script lang="ts">
	import StudioHome from '$lib/components/studio/StudioHome.svelte';

	/**
	 * /studio — the studio home (dashboard: quick-start, WIP slots, layouts).
	 * Rides the normal app shell (right rail included) and owns its scroll
	 * root, like /more; the editors live at /studio/create as full-bleed
	 * surfaces that opt out of the shell's centered container.
	 */
</script>

<svelte:head>
	<title>Studio · BitOS</title>
</svelte:head>

<div class="h-full scrollbar-thin overflow-y-auto">
	<StudioHome />
</div>
