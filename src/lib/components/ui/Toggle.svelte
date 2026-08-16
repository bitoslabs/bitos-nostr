<script lang="ts">
	import { cn } from '$lib/utils/cn';

	/**
	 * iOS-style toggle switch. Controlled via `checked` + `onToggle`; the parent
	 * owns the state. Token-driven so it matches the active accent.
	 */
	let {
		checked = false,
		onToggle,
		label,
		class: cls
	}: { checked?: boolean; onToggle?: (next: boolean) => void; label?: string; class?: string } = $props();

	function toggle() {
		onToggle?.(!checked);
	}
</script>

<button
	type="button"
	role="switch"
	aria-checked={checked}
	aria-label={label}
	onclick={toggle}
	class={cn(
		'toggle relative shrink-0 cursor-pointer rounded-full transition-colors',
		cls
	)}
	class:on={checked}
></button>
