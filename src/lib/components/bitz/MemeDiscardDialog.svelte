<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';

	let {
		intent,
		onKeep,
		onDiscard,
		onSave
	}: {
		intent: 'close' | 'new';
		onKeep: () => void;
		onDiscard: () => void;
		onSave: () => void;
	} = $props();
</script>

<div class="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4">
	<div class="surface-card w-full max-w-xs rounded-2xl p-5 text-center">
		<Icon
			name={intent === 'new' ? 'i-lucide-file-plus' : 'i-lucide-trash-2'}
			class="mx-auto size-8 {intent === 'new' ? 'text-warm-500' : 'text-[var(--tone-error-text)]'}"
		/>
		<h3 class="mt-2 text-[15px] font-bold">
			{intent === 'new' ? 'Start a new meme?' : 'Discard this meme?'}
		</h3>
		<p class="mt-1 text-[12.5px] text-[var(--ui-text-muted)]">
			{intent === 'new'
				? 'The canvas resets — media, captions, sounds and remix lineage are cleared.'
				: 'Captions and the chosen media will be lost.'}
		</p>
		<div class="mt-4 flex gap-2">
			<button
				type="button"
				onclick={onKeep}
				class="h-9 flex-1 rounded-full border border-[var(--ui-border-muted)] text-[13px] font-bold transition hover:bg-[var(--ui-bg-muted)]"
			>
				Keep editing
			</button>
			<button
				type="button"
				onclick={onDiscard}
				class="h-9 flex-1 rounded-full {intent === 'new'
					? 'bg-warm-500'
					: 'bg-[var(--tone-error-text)]'} text-[13px] font-bold text-white transition hover:brightness-110"
			>
				{intent === 'new' ? 'Start over' : 'Discard'}
			</button>
		</div>
		<button
			type="button"
			onclick={onSave}
			class="mt-2 h-9 w-full rounded-full bg-primary-500/10 text-[12.5px] font-bold text-primary-600 transition hover:bg-primary-500/20"
		>
			<Icon name="i-lucide-save" class="mr-1 inline size-3.5" />
			Save to slots instead{intent === 'new' ? ', then start over' : ''}
		</button>
	</div>
</div>
