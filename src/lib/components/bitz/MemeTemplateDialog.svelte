<script lang="ts">
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import {
		TEMPLATES,
		TEMPLATE_DIALOG_CATEGORIES,
		templateCategoryOf,
		type MemeStudioTemplate
	} from './meme-studio-config';
	import type { TemplateCategoryId } from '$lib/meme/template-marketplace';

	/**
	 * MemeTemplateDialog — the browsable home for the 48 builtin templates
	 * (2026-08-25 UX pass): before, every template rendered as an inline
	 * chip in the tool rail, pushing the real tools below the fold and
	 * fighting the image-layer tools for attention. One "Templates" button
	 * now opens this categorized dialog; picking a template applies it and
	 * closes, so the flow stays apply → keep editing.
	 */
	let {
		open = $bindable(false),
		busy = false,
		applyTemplate,
		onClose
	}: {
		open?: boolean;
		busy?: boolean;
		applyTemplate: (template: MemeStudioTemplate) => void;
		onClose?: () => void;
	} = $props();

	let categoryId = $state<TemplateCategoryId>('meme');
	let query = $state('');

	const results = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return TEMPLATES.filter((template) => {
			if (templateCategoryOf(template) !== categoryId) return false;
			if (!q) return true;
			return template.label.toLowerCase().includes(q) || template.hint.toLowerCase().includes(q);
		});
	});

	function pick(template: MemeStudioTemplate) {
		if (busy) return;
		applyTemplate(template);
		open = false;
		onClose?.();
	}

	function reset() {
		query = '';
		categoryId = 'meme';
	}
</script>

<Dialog
	bind:open
	title="Templates"
	onClose={() => {
		reset();
		onClose?.();
	}}
>
	<div class="flex min-w-0 flex-col gap-3">
		<div class="flex items-center gap-2">
			<label class="relative min-w-0 flex-1">
				<Icon
					name="i-lucide-search"
					class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-[var(--ui-text-dimmed)]"
				/>
				<input
					type="search"
					bind:value={query}
					maxlength="40"
					placeholder="Search templates…"
					aria-label="Search templates"
					class="h-9 w-full rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] pr-3 pl-8 text-[12.5px] font-medium outline-none placeholder:text-[var(--ui-text-dimmed)] focus:border-warm-500/60"
				/>
			</label>
		</div>
		<div class="flex flex-wrap gap-1.5" role="tablist" aria-label="Template categories">
			{#each TEMPLATE_DIALOG_CATEGORIES as category (category.id)}
				<button
					type="button"
					role="tab"
					aria-selected={categoryId === category.id}
					onclick={() => (categoryId = category.id)}
					class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition {categoryId ===
					category.id
						? 'bg-warm-500 text-white'
						: 'bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)] hover:bg-warm-500/15 hover:text-warm-600'}"
				>
					{#if category.icon}<Icon name={category.icon} class="size-3.5" />{/if}
					{category.label}
				</button>
			{/each}
		</div>
		<div class="grid max-h-[46vh] grid-cols-2 gap-1.5 overflow-y-auto pr-0.5">
			{#each results as template (template.id)}
				<button
					type="button"
					onclick={() => pick(template)}
					disabled={busy}
					title={template.hint}
					class="flex items-start gap-2 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-2.5 py-2 text-left transition hover:border-warm-500/50 hover:bg-warm-500/5 disabled:opacity-40"
				>
					<Icon name={template.icon} class="mt-0.5 size-4 shrink-0 text-warm-500" />
					<span class="min-w-0 flex-1">
						<span class="block truncate text-[12.5px] font-bold">{template.label}</span>
						<span class="block truncate text-[10.5px] text-[var(--ui-text-dimmed)]">
							{template.hint}
						</span>
					</span>
				</button>
			{:else}
				<p class="col-span-2 py-6 text-center text-[12px] text-[var(--ui-text-muted)]">
					{query ? `No templates match “${query.trim()}”` : 'No templates in this category'}
				</p>
			{/each}
		</div>
		<p class="flex items-center gap-1.5 text-[10.5px] text-[var(--ui-text-dimmed)]">
			<Icon name="i-lucide-info" class="size-3.5 shrink-0" />
			Picking a template adds its captions to your current work — your media and edits stay.
		</p>
	</div>
</Dialog>
