<script lang="ts">
	import type { HTMLTextareaAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils/cn';

	let {
		class: cls,
		value = $bindable(),
		autoGrow = false,
		...rest
	}: { class?: string; value?: string; autoGrow?: boolean } & HTMLTextareaAttributes = $props();

	let el: HTMLTextAreaElement | undefined = $state();

	$effect(() => {
		// re-run when value changes (typing) and on mount
		void value;
		if (autoGrow && el) {
			el.style.height = 'auto';
			el.style.height = Math.min(el.scrollHeight, 400) + 'px';
		}
	});
</script>

<textarea
	bind:this={el}
	bind:value
	class={cn(
		'w-full resize-none rounded-lg border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 py-2.5 text-[14px] leading-relaxed text-[var(--ui-text)] transition-colors placeholder:text-[var(--ui-text-dimmed)] focus:border-[var(--ui-color-primary-500)] focus:outline-none',
		cls
	)}
	{...rest}></textarea>
