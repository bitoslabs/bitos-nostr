<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import MenuDivider from '$lib/components/ui/MenuDivider.svelte';
	import MenuItem from '$lib/components/ui/MenuItem.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import { memeTemplates } from '$lib/stores/meme-templates.svelte';
	import { memeSlots } from '$lib/stores/meme-slots.svelte';
	import { sharedTemplatesStore } from '$lib/stores/meme-shared-templates.svelte';
	import { popovers } from '$lib/stores/popovers.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { templateMarketplace } from '$lib/stores/template-marketplace.svelte';
	import MemeTemplateMarketplace from './MemeTemplateMarketplace.svelte';
	import MemeTemplateDialog from './MemeTemplateDialog.svelte';
	import {
		TEMPLATES,
		IMAGE_LAYOUTS,
		type MemeStudioTemplate,
		type MemeImageLayout
	} from './meme-studio-config';
	import {
		TEMPLATE_CATEGORIES,
		TEMPLATE_PRICE_TIERS,
		type TemplateCategoryId
	} from '$lib/meme/template-marketplace';
	import type { MemeTextOverlay } from '$lib/meme/schema';
	import type { SharedTemplate } from '$lib/meme/shared-templates';

	let marketOpen = $state(false);
	let templatesOpen = $state(false);
	let listingOpen = $state(false);
	let listingFor = $state('');
	let listingPrice = $state(0);
	let listingCategory = $state<TemplateCategoryId>('meme');

	const listingBusyId = $derived(
		listingFor && sharedTemplatesStore.sharingId === listingFor ? listingFor : ''
	);

	function openListing(id: string) {
		listingFor = id;
		listingPrice = 0;
		listingCategory = 'meme';
		listingOpen = true;
	}

	function shareWithListing() {
		const id = listingFor;
		listingFor = '';
		listingOpen = false;
		void sharedTemplatesStore.share(id, {
			...(listingPrice ? { priceSats: listingPrice } : {}),
			category: listingCategory
		});
	}

	let {
		overlays,
		mediaKind,
		busy,
		dirty,
		slotBusyId,
		templateName = $bindable(''),
		showTemplateSave = $bindable(false),
		slotName = $bindable(''),
		applyTemplate,
		applyImageLayout,
		addOverlay,
		applySavedTemplate,
		newDraftFromSavedTemplate,
		removeSavedTemplate,
		saveCurrentTemplate,
		openSlot,
		duplicateSlot,
		renameSlot,
		removeSlot,
		saveCurrentSlot,
		currentPubkey = ''
	}: {
		overlays: MemeTextOverlay[];
		mediaKind?: 'image' | 'video';
		busy: boolean;
		dirty: boolean;
		slotBusyId: string | null;
		templateName: string;
		showTemplateSave: boolean;
		slotName: string;
		applyTemplate: (template: MemeStudioTemplate) => void;
		applyImageLayout?: (layout: MemeImageLayout) => void;
		addOverlay: () => void;
		applySavedTemplate: (id: string) => void;
		newDraftFromSavedTemplate: (id: string) => void;
		removeSavedTemplate: (id: string) => void;
		saveCurrentTemplate: () => void;
		openSlot: (id: string) => void | Promise<void>;
		duplicateSlot: (id: string) => void;
		renameSlot: (id: string, label: string) => void;
		removeSlot: (id: string) => void;
		saveCurrentSlot: () => void | Promise<void>;
		currentPubkey?: string;
	} = $props();

	const templateMenuId = `meme-templates-${Math.random().toString(36).slice(2, 8)}`;
	const layoutsMenuId = `meme-image-layouts-${Math.random().toString(36).slice(2, 8)}`;
	const sharedMenuId = `meme-shared-templates-${Math.random().toString(36).slice(2, 8)}`;
	const slotsMenuId = `meme-slots-${Math.random().toString(36).slice(2, 8)}`;
	let renamingSlotId = $state<string | null>(null);
	let renamingSlotLabel = $state('');

	function beginRenameSlot(id: string, label: string) {
		renamingSlotId = id;
		renamingSlotLabel = label;
	}
	function commitRenameSlot() {
		if (!renamingSlotId) return;
		renameSlot(renamingSlotId, renamingSlotLabel);
		renamingSlotId = null;
		renamingSlotLabel = '';
	}

	/** NIP-78 import: save the shared layout locally, then apply it onto the
	 * stage through the same append-safe path as any saved template. */
	async function importSharedTemplate(template: SharedTemplate) {
		popovers.close();
		const saved = await sharedTemplatesStore.import(template);
		if (saved) {
			applySavedTemplate(saved.id);
			toasts.success(`Imported “${saved.label}” — applied to your meme`);
		}
	}

	/** Slot panels are floated/ported to document.body. Native listeners stay
	 * attached after that move, unlike delegated component click handlers. */
	function nativeClick(node: HTMLElement, handler: () => void) {
		node.addEventListener('click', handler);
		return {
			update(next: () => void) {
				node.removeEventListener('click', handler);
				handler = next;
				node.addEventListener('click', handler);
			},
			destroy() {
				node.removeEventListener('click', handler);
			}
		};
	}
</script>

<!-- Templates: the 48 builtins live in a categorized dialog (UX pass
     2026-08-25) — inline chips pushed the real tools below the fold. -->
<div class="flex flex-wrap items-center gap-1.5">
	<button
		type="button"
		onclick={() => (templatesOpen = true)}
		disabled={busy}
		title="Browse all templates by category"
		class="inline-flex items-center gap-1 rounded-full bg-warm-500/12 px-2.5 py-1 text-[11px] font-bold text-warm-500 transition hover:bg-warm-500/20 active:scale-95 disabled:opacity-40"
	>
		<Icon name="i-lucide-layout-template" class="size-3.5" />
		Templates
		<span class="rounded-full bg-warm-500/15 px-1.5 font-mono text-[10px]">
			{TEMPLATES.length}
		</span>
	</button>
	{#if mediaKind === 'image' && applyImageLayout}
		<!-- Layouts popover (UX pass 2026-08-25): 7 inline chips → one
		     trigger; hints + a caption-count line ride along. -->
		<Popover
			id={layoutsMenuId}
			float
			placement="bottom-start"
			width="auto"
			class="w-72 max-w-[80vw] p-0"
			label="Image layouts"
			triggerClass="inline-flex items-center gap-1 rounded-full bg-primary-500/10 px-2.5 py-1 text-[11px] font-bold text-primary-600 transition hover:bg-primary-500/20 disabled:opacity-40"
			triggerActiveClass="bg-primary-500/20 text-primary-600"
		>
			{#snippet trigger()}
				<Icon name="i-lucide-layout-grid" class="size-3.5" />
				Layouts
				<span class="rounded-full bg-primary-500/15 px-1.5 font-mono text-[10px]">
					{IMAGE_LAYOUTS.length}
				</span>
			{/snippet}
			<div class="p-1">
				{#each IMAGE_LAYOUTS as layout (layout.id)}
					<MenuItem onclick={() => applyImageLayout?.(layout)} disabled={busy}>
						<span class="flex min-w-0 items-center gap-2">
							<Icon name={layout.icon} class="size-4 shrink-0 text-primary-600" />
							<span class="min-w-0">
								<span class="block truncate text-[12.5px] font-bold">{layout.label}</span>
								<span class="block text-[10.5px] text-[var(--ui-text-dimmed)]">
									{layout.hint}
								</span>
							</span>
						</span>
					</MenuItem>
				{/each}
			</div>
			<p class="px-2.5 pb-2 text-[10.5px] text-[var(--ui-text-dimmed)]">
				A layout scaffolds caption slots — your picture and words fill it.
			</p>
		</Popover>
	{/if}
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
		keepOpenOnContentClick
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
							onclick={() => sharedTemplatesStore.share(saved.id)}
							disabled={busy || sharedTemplatesStore.sharingId === saved.id}
							aria-label={`Share template ${saved.label} to Nostr`}
							title={currentPubkey ? 'Share this layout to Nostr' : 'Sign in to share layouts'}
							class="grid size-6 shrink-0 place-items-center rounded-full text-[var(--ui-text-muted)] opacity-0 transition group-hover:opacity-100 hover:text-primary-600 focus-visible:opacity-100 disabled:opacity-40"
						>
							<Icon
								name={sharedTemplatesStore.sharingId === saved.id
									? 'i-lucide-loader-circle'
									: 'i-lucide-globe-2'}
								class="size-3.5 {sharedTemplatesStore.sharingId === saved.id ? 'animate-spin' : ''}"
							/>
						</button>
						<button
							type="button"
							onclick={() => newDraftFromSavedTemplate(saved.id)}
							disabled={busy}
							aria-label={`Create a new meme from template ${saved.label}`}
							title="Create a new meme from this template"
							class="grid size-6 shrink-0 place-items-center rounded-full text-[var(--ui-text-muted)] opacity-0 transition group-hover:opacity-100 hover:text-warm-500 focus-visible:opacity-100 disabled:opacity-40"
						>
							<Icon name="i-lucide-copy-plus" class="size-3.5" />
						</button>
						<button
							type="button"
							onclick={() => openListing(saved.id)}
							disabled={busy || sharedTemplatesStore.sharingId === saved.id}
							aria-label={`Share template ${saved.label} with a market price`}
							title="List on the marketplace with a zap price"
							class="grid size-6 shrink-0 place-items-center rounded-full text-[var(--ui-text-muted)] opacity-0 transition group-hover:opacity-100 hover:text-primary-600 focus-visible:opacity-100 disabled:opacity-40"
						>
							<Icon name="i-lucide-store" class="size-3.5" />
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
					Save as template{overlays.length
						? ` (${overlays.length} caption${overlays.length === 1 ? '' : 's'})`
						: ''}
				</button>
			{/if}
		</div>
	</Popover>

	<!-- Marketplace: priced/zapped community templates (tp-2 p.733) -->
	<button
		type="button"
		onclick={() => templateMarketplace.openMarket()}
		class="inline-flex items-center gap-1 rounded-full bg-primary-500/10 px-2.5 py-1 text-[11px] font-bold text-primary-600 transition hover:bg-primary-500/20"
	>
		<Icon name="i-lucide-store" class="size-3.5" />
		Market
	</button>

	<!-- Shared templates: NIP-78 layouts from other bitz creators -->
	<Popover
		id={sharedMenuId}
		float
		keepOpenOnContentClick
		placement="bottom-start"
		width="auto"
		class="w-72 max-w-[80vw] p-0"
		label="Shared templates"
		triggerClass="inline-flex items-center gap-1 rounded-full bg-[var(--ui-bg-accented)] px-2.5 py-1 text-[11px] font-bold text-[var(--ui-text)] transition hover:bg-primary-500/15 hover:text-primary-600"
		triggerActiveClass="bg-primary-500/15 text-primary-600"
	>
		{#snippet trigger()}
			<Icon name="i-lucide-globe-2" class="size-3.5" />
			Shared templates
			{#if sharedTemplatesStore.list.length}
				<span class="rounded-full bg-primary-500/15 px-1.5 font-mono text-[10px] text-primary-600">
					{sharedTemplatesStore.list.length}
				</span>
			{/if}
		{/snippet}
		<button
			type="button"
			class="flex w-full items-center justify-center gap-1 rounded-lg px-3 py-1.5 text-[11.5px] font-semibold text-primary-600 transition hover:bg-primary-500/10"
			disabled={sharedTemplatesStore.loading}
			use:nativeClick={() => sharedTemplatesStore.load()}
		>
			<Icon
				name="i-lucide-refresh-cw"
				class="size-3.5 {sharedTemplatesStore.loading ? 'animate-spin' : ''}"
			/>
			{sharedTemplatesStore.loading ? 'Searching relays…' : 'Refresh'}
		</button>
		{#if sharedTemplatesStore.list.length}
			<MenuDivider />
			<div class="max-h-64 overflow-y-auto p-1">
				{#each sharedTemplatesStore.list as shared (shared.eventId)}
					<button
						type="button"
						use:nativeClick={() => void importSharedTemplate(shared)}
						class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
					>
						<span class="flex min-w-0 items-center gap-2">
							<Icon name={shared.icon} class="size-3.5 shrink-0 text-primary-600" />
							<span class="min-w-0">
								<span class="block truncate">{shared.label}</span>
								<span class="block text-[10.5px] text-[var(--ui-text-dimmed)]">
									{shared.overlays.length} caption{shared.overlays.length === 1 ? '' : 's'}
									{#if shared.creatorPubkey === currentPubkey}· yours{/if}
								</span>
							</span>
						</span>
						<span class="ml-auto shrink-0">
							{#if sharedTemplatesStore.importingId === shared.eventId}
								<Icon
									name="i-lucide-loader-circle"
									class="size-3.5 animate-spin text-primary-600"
								/>
							{:else}
								<span
									class="text-[10px] font-bold tracking-wide text-[var(--ui-text-dimmed)] uppercase"
								>
									+ add
								</span>
							{/if}
						</span>
					</button>
				{/each}
			</div>
		{/if}
	</Popover>
	<!-- Slots: named checkpoints inside the current work, like save points. -->
	<Popover
		id={slotsMenuId}
		float
		keepOpenOnContentClick
		placement="bottom-start"
		width="auto"
		class="w-72 max-w-[80vw] p-0"
		label="Save points"
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
							use:nativeClick={() => {
								if (renamingSlotId !== slot.id) void openSlot(slot.id);
							}}
							disabled={busy || !!slotBusyId}
							title="Restore this save point"
							class="flex min-w-0 flex-1 items-center gap-2 text-left"
						>
							<Icon
								name={slotBusyId === slot.id ? 'i-lucide-loader-circle' : 'i-lucide-history'}
								class="size-4 shrink-0 text-primary-600 {slotBusyId === slot.id
									? 'animate-spin'
									: ''}"
							/>
							<span class="min-w-0 flex-1">
								{#if renamingSlotId === slot.id}
									<input
										bind:value={renamingSlotLabel}
										maxlength="40"
										aria-label="Save point name"
										onkeydown={(event) => {
											if (event.key === 'Enter') commitRenameSlot();
											if (event.key === 'Escape') renamingSlotId = null;
										}}
										class="h-6 w-full rounded border border-primary-500/50 bg-[var(--ui-bg)] px-1.5 text-[12.5px] font-bold outline-none"
									/>
								{:else}
									<span class="block truncate text-[12.5px] font-bold">{slot.label}</span>
								{/if}
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
							use:nativeClick={() => duplicateSlot(slot.id)}
							aria-label={`Duplicate save point ${slot.label}`}
							title="Duplicate this save point"
							class="grid size-6 shrink-0 place-items-center rounded-full text-[var(--ui-text-muted)] opacity-0 transition group-hover:opacity-100 hover:text-primary-600 focus-visible:opacity-100"
						>
							<Icon name="i-lucide-copy" class="size-3.5" />
						</button>
						<button
							type="button"
							use:nativeClick={() => beginRenameSlot(slot.id, slot.label)}
							aria-label={`Rename save point ${slot.label}`}
							title="Rename this save point"
							class="grid size-6 shrink-0 place-items-center rounded-full text-[var(--ui-text-muted)] opacity-0 transition group-hover:opacity-100 hover:text-primary-600 focus-visible:opacity-100"
						>
							<Icon name="i-lucide-pencil" class="size-3.5" />
						</button>
						{#if renamingSlotId === slot.id}
							<button
								type="button"
								use:nativeClick={commitRenameSlot}
								aria-label={`Save name for ${slot.label}`}
								class="grid size-6 shrink-0 place-items-center rounded-full text-primary-600 hover:bg-primary-500/10"
							>
								<Icon name="i-lucide-check" class="size-3.5" />
							</button>
						{/if}
						<button
							type="button"
							use:nativeClick={() => removeSlot(slot.id)}
							aria-label={`Delete save point ${slot.label}`}
							class="grid size-6 shrink-0 place-items-center rounded-full text-[var(--ui-text-muted)] opacity-0 transition group-hover:opacity-100 hover:text-[var(--tone-error-text)] focus-visible:opacity-100"
						>
							<Icon name="i-lucide-trash-2" class="size-3.5" />
						</button>
					</div>
				{/each}
			{:else}
				<p class="px-2 py-3 text-center text-[12px] text-[var(--ui-text-muted)]">
					No save points yet — save your work and return to it later.
				</p>
			{/if}
		</div>
		{#if memeSlots.list.length}
			<div class="border-t border-[var(--ui-border-muted)] p-1.5">
				<MenuDivider />
			</div>
		{/if}
		<div class="p-1.5 pt-0">
			<div class="flex items-center gap-1.5">
				<input
					type="text"
					bind:value={slotName}
					maxlength="40"
					placeholder="Name this save point"
					aria-label="Save point name"
					disabled={busy || !dirty}
					onkeydown={(e) => {
						if (e.key === 'Enter') void saveCurrentSlot();
					}}
					class="h-8 min-w-0 flex-1 rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-2.5 text-[12.5px] font-semibold outline-none focus:border-primary-500/60 disabled:opacity-40"
				/>
				<button
					type="button"
					use:nativeClick={() => void saveCurrentSlot()}
					disabled={busy || !dirty}
					class="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-primary-500 px-2.5 text-[11px] font-bold text-white transition hover:brightness-110 active:scale-95 disabled:opacity-40"
				>
					<Icon name="i-lucide-save" class="size-3.5" /> Save
				</button>
			</div>
		</div>
	</Popover>

	<MemeTemplateMarketplace bind:open={marketOpen} onImport={() => (marketOpen = false)} />

	<!-- Categorized builtin templates (replaces the 48 inline chips). -->
	<MemeTemplateDialog bind:open={templatesOpen} {busy} {applyTemplate} />

	<!-- Market listing: price + category for the next shared template -->
	<Dialog bind:open={listingOpen} title="List on Bitz Templates">
		<p class="pb-3 text-[11.5px] text-[var(--ui-text-dimmed)]">
			Buyers zap you directly to unlock — you keep the full amount.
		</p>
		<div class="flex flex-wrap gap-1.5 pb-3">
			{#each TEMPLATE_PRICE_TIERS as tier (tier)}
				<button
					type="button"
					onclick={() => (listingPrice = tier)}
					class="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition {listingPrice ===
					tier
						? 'bg-primary-500/20 text-primary-600'
						: 'bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)] hover:bg-primary-500/10'}"
				>
					{tier === 0 ? 'Free' : `⚡${tier}`}
				</button>
			{/each}
		</div>
		<div class="flex flex-wrap gap-1.5 pb-4">
			{#each TEMPLATE_CATEGORIES.filter((c) => c.id !== 'trending' && c.id !== 'new') as cat (cat.id)}
				<button
					type="button"
					onclick={() => (listingCategory = cat.id)}
					class="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition {listingCategory ===
					cat.id
						? 'bg-warm-500/20 text-warm-600'
						: 'bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)] hover:bg-warm-500/10'}"
				>
					{cat.label}
				</button>
			{/each}
		</div>
		<div class="flex justify-end gap-2">
			<button
				type="button"
				onclick={() => (listingOpen = false)}
				class="rounded-full px-3 py-1.5 text-[12px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)]"
				>Cancel</button
			>
			<button
				type="button"
				onclick={shareWithListing}
				disabled={!!listingBusyId}
				class="flex items-center gap-1 rounded-full bg-primary-500 px-3 py-1.5 text-[12px] font-bold text-white transition hover:brightness-110 active:scale-[0.98] disabled:opacity-40"
			>
				<Icon
					name={listingBusyId ? 'i-lucide-loader-circle' : 'i-lucide-zap'}
					class="size-3.5 {listingBusyId ? 'animate-spin' : ''}"
				/>
				Share
			</button>
		</div>
	</Dialog>
</div>
