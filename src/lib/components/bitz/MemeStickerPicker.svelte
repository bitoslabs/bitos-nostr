<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import { STICKER_PACKS } from '$lib/meme/stickers';
	import { isEmojiOnly } from '$lib/meme/stickers';
	import { toasts } from '$lib/stores/toasts.svelte';

	/**
	 * MemeStickerPicker — the emoji sticker tool: curated packs + a
	 * type-any-emoji input. Owns only view state (active pack, draft input);
	 * picking hands the emoji back through `onAdd` — the parent turns it into
	 * an overlay. (Extracted from MemeStudio's tool rail — SRP split.)
	 */
	let {
		id,
		onAdd,
		float = true
	}: {
		id: string;
		onAdd: (emoji: string) => void;
		float?: boolean;
	} = $props();

	let activePackId = $state(STICKER_PACKS[0]?.id ?? '');
	const activePack = $derived(STICKER_PACKS.find((p) => p.id === activePackId));
	let customSticker = $state('');

	function addCustom(): void {
		const text = customSticker.trim();
		if (!text) return;
		if (!isEmojiOnly(text)) {
			toasts.error('Stickers are emoji only — paste or type emoji (😂🔥💀)');
			return;
		}
		onAdd(text);
		customSticker = '';
	}
</script>

<Popover
	{id}
	{float}
	placement="top-start"
	width="auto"
	label="Add a sticker"
	triggerClass="flex items-center gap-1 rounded-full bg-[var(--ui-bg-accented)] px-2.5 py-1 text-[11.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]"
	triggerActiveClass="bg-warm-500/15 text-warm-600"
>
	{#snippet trigger()}
		<Icon name="i-lucide-smile-plus" class="size-3.5" />
		Stickers
	{/snippet}
	<div class="w-64 max-w-[80vw] p-2">
		<!-- Custom sticker input: type/paste ANY emoji from the keyboard.
		     NOTE: no <form> here — popover panels unmount on the layout's global
		     click-close before a deferred form submit can fire (the established
		     pattern is keydown-Enter + button onclick, like the slot/template savers). -->
		<div class="mb-2 flex items-center gap-1">
			<label class="sr-only" for="meme-custom-sticker">Custom emoji sticker</label>
			<input
				id="meme-custom-sticker"
				onclick={(e) => e.stopPropagation()}
				type="text"
				bind:value={customSticker}
				placeholder="Type any emoji… 😎"
				maxlength="8"
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						addCustom();
					}
				}}
				class="h-8 min-w-0 flex-1 rounded-full border border-[var(--ui-border-muted)] bg-transparent px-3 text-center text-[15px] outline-none placeholder:text-[11px] placeholder:font-normal placeholder:text-[var(--ui-text-dimmed)] focus:border-warm-500"
			/>
			<button
				type="button"
				onclick={addCustom}
				title="Add this emoji as a sticker"
				class="grid size-8 shrink-0 place-items-center rounded-full bg-warm-500/12 text-warm-500 transition hover:bg-warm-500/20 active:scale-95"
			>
				<Icon name="i-lucide-plus" class="size-4" />
			</button>
		</div>
		<div class="flex items-center gap-1 overflow-x-auto pb-1.5">
			{#each STICKER_PACKS as pack (pack.id)}
				<button
					type="button"
					onclick={(e) => {
						// keep the popover open — the global click-close would eat it
						e.stopPropagation();
						activePackId = pack.id;
					}}
					class="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold transition {activePackId ===
					pack.id
						? 'bg-warm-500 text-white'
						: 'bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
				>
					{pack.label}
				</button>
			{/each}
		</div>
		{#if activePack}
			<div class="grid grid-cols-8 gap-1">
				{#each activePack.stickers as emoji (emoji)}
					<button
						type="button"
						onclick={() => onAdd(emoji)}
						aria-label={`Add ${emoji} sticker`}
						class="grid size-7 place-items-center rounded-lg text-[17px] leading-none transition hover:scale-110 hover:bg-[var(--ui-bg-muted)] active:scale-95"
					>
						{emoji}
					</button>
				{/each}
			</div>
		{/if}
	</div>
</Popover>
