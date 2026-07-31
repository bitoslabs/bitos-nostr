<script lang="ts">
	/**
	 * Thin separator between groups of MenuItems inside a Popover.
	 *   <MenuItem ...>Copy</MenuItem>
	 *   <MenuDivider />
	 *   <MenuItem tone="danger" ...>Block</MenuItem>
	 */
	let { class: cls = '' }: { class?: string } = $props();
</script>

<div class="my-1 h-px bg-[var(--ui-border-muted)] {cls}" role="separator"></div>
