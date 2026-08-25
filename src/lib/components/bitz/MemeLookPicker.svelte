<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import { MEME_LOOKS, memeLookOf, type MemeLookId } from '$lib/meme/look';

	/**
	 * MemeLookPicker — one-tap color-grade presets for the BASE media.
	 * Preview = CSS filter, export = ctx.filter (same syntax) — WYSIWYG by
	 * construction. Pure controls: the parent owns `lookId` via onPick.
	 * (Extracted from MemeStudio's tool rail — SRP split.)
	 */
	let {
		id,
		lookId,
		onPick,
		float = true
	}: {
		id: string;
		lookId: string;
		onPick: (id: MemeLookId) => void;
		float?: boolean;
	} = $props();
</script>

<Popover
	{id}
	{float}
	placement="top-start"
	width="auto"
	label="Pick a look"
	triggerClass="flex items-center gap-1 rounded-full bg-[var(--ui-bg-accented)] px-2.5 py-1 text-[11.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]"
	triggerActiveClass="bg-warm-500/15 text-warm-600"
>
	{#snippet trigger()}
		<Icon name="i-lucide-sparkles" class="size-3.5" />
		Look
		{#if lookId !== 'none'}
			<span class="rounded-full bg-warm-500/20 px-1.5 text-[10px] font-extrabold text-warm-600">
				{MEME_LOOKS.find((look) => look.id === lookId)?.label}
			</span>
		{/if}
	{/snippet}
	<div class="flex w-56 max-w-[80vw] flex-wrap gap-1 p-1.5">
		{#each MEME_LOOKS as look (look.id)}
			<button
				type="button"
				onclick={() => onPick(memeLookOf(look.id))}
				aria-pressed={lookId === look.id}
				class="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-bold transition {lookId ===
				look.id
					? 'bg-warm-500 text-white'
					: 'bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
			>
				{look.label}
			</button>
		{/each}
	</div>
</Popover>
