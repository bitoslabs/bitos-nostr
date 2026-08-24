<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import MenuDivider from '$lib/components/ui/MenuDivider.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import { memeTemplates } from '$lib/stores/meme-templates.svelte';
	import { memeSlots } from '$lib/stores/meme-slots.svelte';
	import { TEMPLATES, type MemeStudioTemplate } from './meme-studio-config';
	import type { MemeTextOverlay } from '$lib/meme/schema';

	let {
		overlays,
		busy,
		dirty,
		slotBusyId,
		templateName = $bindable(''),
		showTemplateSave = $bindable(false),
		slotName = $bindable(''),
		showSlotSave = $bindable(false),
		applyTemplate,
		addOverlay,
		applySavedTemplate,
		removeSavedTemplate,
		saveCurrentTemplate,
		openSlot,
		removeSlot,
		saveCurrentSlot
	}: {
		overlays: MemeTextOverlay[];
		busy: boolean;
		dirty: boolean;
		slotBusyId: string | null;
		templateName: string;
		showTemplateSave: boolean;
		slotName: string;
		showSlotSave: boolean;
		applyTemplate: (template: MemeStudioTemplate) => void;
		addOverlay: () => void;
		applySavedTemplate: (id: string) => void;
		removeSavedTemplate: (id: string) => void;
		saveCurrentTemplate: () => void;
		openSlot: (id: string) => void | Promise<void>;
		removeSlot: (id: string) => void;
		saveCurrentSlot: () => void | Promise<void>;
	} = $props();

	const templateMenuId = `meme-templates-${Math.random().toString(36).slice(2, 8)}`;
	const slotsMenuId = `meme-slots-${Math.random().toString(36).slice(2, 8)}`;
</script>

<!-- Templates -->
<div class="flex flex-wrap items-center gap-1.5">
	<span class="text-[10px] font-bold tracking-wider text-[var(--ui-text-dimmed)] uppercase">
		Template
	</span>
	{#each TEMPLATES as template (template.id)}
		<button
			type="button"
			onclick={() => applyTemplate(template)}
			disabled={busy}
			title={template.hint}
			class="inline-flex items-center gap-1 rounded-full bg-[var(--ui-bg-accented)] px-2.5 py-1 text-[11px] font-bold text-[var(--ui-text)] transition hover:bg-warm-500/15 hover:text-warm-500 active:scale-95 disabled:opacity-40"
		>
			<Icon name={template.icon} class="size-3.5" />
			{template.label}
		</button>
	{/each}
	<button
		type="button"
		onclick={() => addOverlay()}
		disabled={busy || overlays.length >= 12}
		class="inline-flex items-center gap-1 rounded-full bg-warm-500/12 px-2.5 py-1 text-[11px] font-bold text-warm-500 transition hover:bg-warm-500/20 active:scale-95 disabled:opacity-40"
	>
		<Icon name="i-lucide-plus" class="size-3.5" />
		Caption
	</button>
	<!-- Saved templates: user layouts persisted locally -->
	<Popover
		id={templateMenuId}
		float
		placement="bottom-start"
		width="auto"
		class="w-72 max-w-[80vw] p-0"
		label="Saved templates"
		triggerClass="inline-flex items-center gap-1 rounded-full bg-[var(--ui-bg-accented)] px-2.5 py-1 text-[11px] font-bold text-[var(--ui-text)] transition hover:bg-warm-500/15 hover:text-warm-500"
		triggerActiveClass="bg-warm-500/15 text-warm-500"
	>
		{#snippet trigger()}
			<Icon name="i-lucide-bookmark" class="size-3.5" />
			Saved
			{#if memeTemplates.list.length}
				<span class="rounded-full bg-warm-500/15 px-1.5 font-mono text-[10px] text-warm-500">
					{memeTemplates.list.length}
				</span>
			{/if}
		{/snippet}
		<div class="max-h-64 overflow-y-auto p-1.5">
			{#if memeTemplates.list.length}
				{#each memeTemplates.list as saved (saved.id)}
					<div
						class="group flex items-center gap-1 rounded-lg px-1.5 py-1 transition hover:bg-[var(--ui-bg-muted)]"
					>
						<button
							type="button"
							onclick={() => applySavedTemplate(saved.id)}
							disabled={busy}
							title="Apply this layout"
							class="flex min-w-0 flex-1 items-center gap-2 text-left"
						>
							<Icon name={saved.icon} class="size-4 shrink-0 text-warm-500" />
							<span class="min-w-0 flex-1">
								<span class="block truncate text-[12.5px] font-bold">
									{saved.label}
								</span>
								<span class="block text-[10.5px] text-[var(--ui-text-dimmed)]">
									{saved.overlays.length} caption{saved.overlays.length === 1 ? '' : 's'}
								</span>
							</span>
						</button>
						<button
							type="button"
							onclick={() => removeSavedTemplate(saved.id)}
							aria-label={`Delete template ${saved.label}`}
							class="grid size-6 shrink-0 place-items-center rounded-full text-[var(--ui-text-muted)] opacity-0 transition group-hover:opacity-100 hover:text-[var(--tone-error-text)] focus-visible:opacity-100"
						>
							<Icon name="i-lucide-trash-2" class="size-3.5" />
						</button>
					</div>
				{/each}
			{:else}
				<p class="px-2 py-3 text-center text-[12px] text-[var(--ui-text-muted)]">
					No saved templates yet — build a layout and hit
					<span class="font-bold">Save</span>.
				</p>
			{/if}
		</div>
		{#if memeTemplates.list.length}
			<div class="border-t border-[var(--ui-border-muted)] p-1.5">
				<MenuDivider />
			</div>
		{/if}
		<div class="p-1.5 pt-0">
			{#if showTemplateSave}
				<div class="flex items-center gap-1.5">
					<input
						type="text"
						bind:value={templateName}
						maxlength="40"
						placeholder="Template name"
						aria-label="Template name"
						onkeydown={(e) => {
							if (e.key === 'Enter') saveCurrentTemplate();
							if (e.key === 'Escape') showTemplateSave = false;
						}}
						class="h-8 min-w-0 flex-1 rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-2.5 text-[12.5px] font-semibold outline-none focus:border-warm-500/60"
					/>
					<button
						type="button"
						onclick={saveCurrentTemplate}
						disabled={busy || !overlays.length}
						class="grid size-8 shrink-0 place-items-center rounded-lg bg-warm-500 text-white transition hover:brightness-110 active:scale-95 disabled:opacity-40"
						aria-label="Save template"
					>
						<Icon name="i-lucide-check" class="size-4" />
					</button>
				</div>
			{:else}
				<button
					type="button"
					onclick={() => (showTemplateSave = true)}
					disabled={busy || !overlays.length}
					class="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-warm-500/12 text-[12px] font-bold text-warm-500 transition hover:bg-warm-500/20 active:scale-[0.98] disabled:opacity-40"
				>
					<Icon name="i-lucide-bookmark-plus" class="size-4" />
					Save current layout{overlays.length
						? ` (${overlays.length} caption${overlays.length === 1 ? '' : 's'})`
						: ''}
				</button>
			{/if}
		</div>
	</Popover>

	<!-- Draft slots: named WIP snapshots (save now, resume later) -->
	<Popover
		id={slotsMenuId}
		float
		placement="bottom-start"
		width="auto"
		class="w-72 max-w-[80vw] p-0"
		label="Draft slots"
		triggerClass="inline-flex items-center gap-1 rounded-full bg-[var(--ui-bg-accented)] px-2.5 py-1 text-[11px] font-bold text-[var(--ui-text)] transition hover:bg-primary-500/15 hover:text-primary-600"
		triggerActiveClass="bg-primary-500/15 text-primary-600"
	>
		{#snippet trigger()}
			<Icon name="i-lucide-save" class="size-3.5" />
			Slots
			{#if memeSlots.list.length}
				<span class="rounded-full bg-primary-500/15 px-1.5 font-mono text-[10px] text-primary-600">
					{memeSlots.list.length}
				</span>
			{/if}
		{/snippet}
		<div class="max-h-64 overflow-y-auto p-1.5">
			{#if memeSlots.list.length}
				{#each memeSlots.list as slot (slot.id)}
					<div
						class="group flex items-center gap-1 rounded-lg px-1.5 py-1 transition hover:bg-[var(--ui-bg-muted)]"
					>
						<button
							type="button"
							onclick={() => void openSlot(slot.id)}
							disabled={busy || !!slotBusyId}
							title="Restore this work-in-progress"
							class="flex min-w-0 flex-1 items-center gap-2 text-left"
						>
							<Icon
								name={slotBusyId === slot.id ? 'i-lucide-loader-circle' : 'i-lucide-history'}
								class="size-4 shrink-0 text-primary-600 {slotBusyId === slot.id
									? 'animate-spin'
									: ''}"
							/>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-[12.5px] font-bold">
									{slot.label}
								</span>
								<span class="block text-[10.5px] text-[var(--ui-text-dimmed)]">
									{new Date(slot.savedAt).toLocaleDateString()} ·
									{slot.overlays.length} caption{slot.overlays.length === 1 ? '' : 's'}
									{slot.sfxCues.length
										? ` · ${slot.sfxCues.length} cue${slot.sfxCues.length === 1 ? '' : 's'}`
										: ''}
									{#if !slot.media}
										· no media
									{/if}
								</span>
							</span>
						</button>
						<button
							type="button"
							onclick={() => removeSlot(slot.id)}
							aria-label={`Delete slot ${slot.label}`}
							class="grid size-6 shrink-0 place-items-center rounded-full text-[var(--ui-text-muted)] opacity-0 transition group-hover:opacity-100 hover:text-[var(--tone-error-text)] focus-visible:opacity-100"
						>
							<Icon name="i-lucide-trash-2" class="size-3.5" />
						</button>
					</div>
				{/each}
			{:else}
				<p class="px-2 py-3 text-center text-[12px] text-[var(--ui-text-muted)]">
					No slots yet — save a work-in-progress and pick it back up later.
				</p>
			{/if}
		</div>
		{#if memeSlots.list.length}
			<div class="border-t border-[var(--ui-border-muted)] p-1.5">
				<MenuDivider />
			</div>
		{/if}
		<div class="p-1.5 pt-0">
			{#if showSlotSave}
				<div class="flex items-center gap-1.5">
					<input
						type="text"
						bind:value={slotName}
						maxlength="40"
						placeholder="Slot name"
						aria-label="Slot name"
						onkeydown={(e) => {
							if (e.key === 'Enter') void saveCurrentSlot();
							if (e.key === 'Escape') showSlotSave = false;
						}}
						class="h-8 min-w-0 flex-1 rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-2.5 text-[12.5px] font-semibold outline-none focus:border-primary-500/60"
					/>
					<button
						type="button"
						onclick={() => void saveCurrentSlot()}
						disabled={busy || !dirty}
						class="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-500 text-white transition hover:brightness-110 active:scale-95 disabled:opacity-40"
						aria-label="Save slot"
					>
						<Icon name="i-lucide-check" class="size-4" />
					</button>
				</div>
			{:else}
				<button
					type="button"
					onclick={() => (showSlotSave = true)}
					disabled={busy || !dirty}
					class="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-primary-500/12 text-[12px] font-bold text-primary-600 transition hover:bg-primary-500/20 active:scale-[0.98] disabled:opacity-40"
				>
					<Icon name="i-lucide-save" class="size-4" />
					Save work-in-progress
				</button>
			{/if}
		</div>
	</Popover>
</div>
