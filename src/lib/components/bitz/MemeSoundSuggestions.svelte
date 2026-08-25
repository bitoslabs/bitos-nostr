<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import MenuDivider from '$lib/components/ui/MenuDivider.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import type { MemeSuggestion } from '$lib/ai/suggest';

	let {
		busy,
		analyzing,
		groups,
		onBuild,
		onApply
	}: {
		busy: boolean;
		analyzing: boolean;
		groups: MemeSuggestion[];
		onBuild: () => void;
		onApply: (suggestion: MemeSuggestion) => void;
	} = $props();

	const menuId = `meme-suggest-${Math.random().toString(36).slice(2, 8)}`;
</script>

<Popover
	id={menuId}
	float
	placement="top-start"
	width="auto"
	class="w-72 max-w-[80vw] p-0"
	label="Auto Meme — 3 editable timelines from your audio"
	triggerClass="flex items-center gap-1 rounded-full bg-primary-500/10 px-2.5 py-1 text-[11px] font-bold text-primary-600 transition hover:bg-primary-500/20 disabled:opacity-40"
	triggerActiveClass="bg-primary-500/20 text-primary-600"
>
	{#snippet trigger()}
		<Icon
			name={analyzing ? 'i-lucide-loader-circle' : 'i-lucide-sparkles'}
			class="size-3.5 {analyzing ? 'animate-spin' : ''}"
		/>
		Suggest
	{/snippet}
	<div class="p-1.5">
		<p class="px-2 pb-1.5 text-[11px] leading-snug text-[var(--ui-text-dimmed)]">
			Local audio analysis → 3 editable timelines. Nothing leaves your device.
		</p>
		{#if !groups.length}
			<button
				type="button"
				onclick={onBuild}
				disabled={analyzing || busy}
				class="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-primary-500/12 text-[12px] font-bold text-primary-600 transition hover:bg-primary-500/20 active:scale-[0.98] disabled:opacity-40"
			>
				<Icon name="i-lucide-wand-sparkles" class="size-4" />
				{analyzing ? 'Analyzing…' : 'Generate 3 vibes'}
			</button>
		{:else}
			{#each groups as group (group.intensity)}
				<button
					type="button"
					onclick={() => onApply(group)}
					disabled={busy}
					class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-[var(--ui-bg-muted)]"
				>
					<span
						class="grid size-7 shrink-0 place-items-center rounded-full {group.intensity === 'chaos'
							? 'bg-[var(--tone-error)]/15 text-[var(--tone-error-text)]'
							: group.intensity === 'funny'
								? 'bg-warm-500/15 text-warm-600'
								: 'bg-primary-500/10 text-primary-600'}"
					>
						<Icon
							name={group.intensity === 'chaos'
								? 'i-lucide-bomb'
								: group.intensity === 'funny'
									? 'i-lucide-laugh'
									: 'i-lucide-smile'}
							class="size-4"
						/>
					</span>
					<span class="min-w-0 flex-1">
						<span class="block text-[12.5px] font-bold capitalize">{group.intensity}</span>
						<span class="block text-[10.5px] text-[var(--ui-text-dimmed)]">
							{group.overlays.length} captions · {group.sfxCues.length} cues
							{group.zooms.length ? ` · ${group.zooms.length} zooms` : ''}
						</span>
					</span>
					<Icon name="i-lucide-arrow-right" class="size-4 shrink-0 text-[var(--ui-text-muted)]" />
				</button>
			{/each}
			<MenuDivider />
			<button
				type="button"
				onclick={onBuild}
				disabled={analyzing || busy}
				class="flex h-7 w-full items-center justify-center gap-1 rounded-lg text-[11px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-40"
			>
				<Icon name="i-lucide-refresh-cw" class="size-3.5" />
				Re-analyze
			</button>
		{/if}
	</div>
</Popover>
