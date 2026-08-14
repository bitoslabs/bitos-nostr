<script lang="ts">
	import { cn } from '$lib/utils/cn';

	/** A single chat message bubble. `mine` flips it to the outgoing style. */
	let {
		text,
		mine = false,
		class: cls
	}: { text: string; mine?: boolean; class?: string } = $props();
</script>

<div class={cn('flex', mine ? 'justify-end' : 'justify-start')}>
	<div
		class={cn(
			'max-w-[70%] px-3.5 py-2.5 text-sm leading-relaxed',
			mine
				? 'bubble-out'
				: 'bubble-in'
		)}
	>
		{text}
	</div>
</div>
