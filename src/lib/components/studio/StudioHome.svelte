<script lang="ts">
	import { slide } from 'svelte/transition';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { memeSlots } from '$lib/stores/meme-slots.svelte';
	import { memeTemplates, type SavedMemeTemplate } from '$lib/stores/meme-templates.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { studioHandoff } from '$lib/stores/studio-handoff.svelte';

	/**
	 * Studio home — the /studio dashboard: quick-start tiles, resumable WIP
	 * slots and saved meme templates. One responsibility: route creators INTO
	 * the right studio (via the handoff store — never a direct studio import,
	 * so this page stays byte-cheap). The studios themselves never mount here.
	 */

	function agoLabel(savedAt: number): string {
		const sec = Math.max(1, Math.round((Date.now() - savedAt) / 1000));
		if (sec < 60) return `${sec}s ago`;
		const min = Math.round(sec / 60);
		if (min < 60) return `${min}m ago`;
		const hr = Math.round(min / 60);
		if (hr < 24) return `${hr}h ago`;
		return `${Math.round(hr / 24)}d ago`;
	}

	function slotSummary(slot: (typeof memeSlots.list)[number]): string {
		const bits: string[] = [];
		if (slot.overlays.length)
			bits.push(`${slot.overlays.length} caption${slot.overlays.length === 1 ? '' : 's'}`);
		if (slot.sfxCues.length)
			bits.push(`${slot.sfxCues.length} cue${slot.sfxCues.length === 1 ? '' : 's'}`);
		bits.push(
			slot.destination === 'story' ? 'story' : slot.destination === 'note' ? 'note' : 'bitz'
		);
		return bits.join(' · ');
	}

	function resumeSlot(id: string) {
		if (!memeSlots.list.find((s) => s.id === id)) return;
		studioHandoff.resumeSlot(id);
	}

	function removeSlot(id: string) {
		const slot = memeSlots.list.find((s) => s.id === id);
		memeSlots.remove(id);
		if (slot) toasts.info(`“${slot.label}” deleted`);
	}

	function useTemplate(tpl: SavedMemeTemplate) {
		studioHandoff.useTemplate(tpl.id, tpl.overlays);
	}

	function removeTemplate(id: string) {
		const tpl = memeTemplates.list.find((t) => t.id === id);
		memeTemplates.remove(id);
		if (tpl) toasts.info(`Template “${tpl.label}” deleted`);
	}
</script>

<div
	class="mx-auto w-full max-w-4xl px-4 pt-5 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:px-6"
>
	<header class="mb-5">
		<h1 class="flex items-center gap-2.5 text-[22px] font-bold text-[var(--ui-text-highlighted)]">
			<span class="grid size-10 place-items-center rounded-2xl bg-warm-500/12 text-warm-500">
				<Icon name="i-lucide-clapperboard" class="size-5.5" />
			</span>
			Create
		</h1>
		<p class="mt-1.5 text-[13px] text-[var(--ui-text-muted)]">
			Studio home — pick a surface, resume work in progress, or reuse a saved layout.
		</p>
	</header>

	<!-- Quick start -->
	<section aria-label="Start something new">
		<div class="grid gap-3 sm:grid-cols-2">
			<button
				type="button"
				onclick={() => studioHandoff.openInStudio('bitz')}
				class="group flex items-start gap-3 rounded-2xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)]/50 p-4 text-left transition hover:border-primary-500/40 hover:bg-primary-500/10"
			>
				<span
					class="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-500/15 text-primary-600"
				>
					<Icon name="i-lucide-circle-play" class="size-5" />
				</span>
				<span class="min-w-0">
					<span class="block text-[14px] font-bold">Bitz video</span>
					<span class="mt-0.5 block text-[12px] leading-snug text-[var(--ui-text-muted)]">
						Quick camera-roll clip or picture straight to the Bitz feed — trim, cover frame, done.
					</span>
					<span class="mt-1.5 flex items-center gap-1 text-[11px] font-bold text-primary-600">
						Open
						<Icon
							name="i-lucide-arrow-right"
							class="size-3 transition group-hover:translate-x-0.5"
						/>
					</span>
				</span>
			</button>
			<button
				type="button"
				onclick={() => studioHandoff.openInStudio('meme')}
				class="group flex items-start gap-3 rounded-2xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)]/50 p-4 text-left transition hover:border-warm-500/40 hover:bg-warm-500/10"
			>
				<span
					class="grid size-11 shrink-0 place-items-center rounded-xl bg-warm-500/15 text-warm-600"
				>
					<Icon name="i-lucide-laugh" class="size-5" />
				</span>
				<span class="min-w-0">
					<span class="block text-[14px] font-bold">Meme studio</span>
					<span class="mt-0.5 block text-[12px] leading-snug text-[var(--ui-text-muted)]">
						Captioned pictures, videos &amp; GIFs — sounds, looks, trim, batch queue. Publishes as a
						bitz, story or note.
					</span>
					<span class="mt-1.5 flex items-center gap-1 text-[11px] font-bold text-warm-600">
						Open
						<Icon
							name="i-lucide-arrow-right"
							class="size-3 transition group-hover:translate-x-0.5"
						/>
					</span>
				</span>
			</button>
		</div>
	</section>

	<!-- Draft slots -->
	{#if memeSlots.list.length}
		<section class="mt-7" aria-label="Resume work in progress">
			<div class="mb-2.5 flex items-center justify-between">
				<h2
					class="flex items-center gap-1.5 text-[13px] font-bold tracking-wide text-[var(--ui-text-dimmed)] uppercase"
				>
					<Icon name="i-lucide-history" class="size-4" />
					Work in progress
				</h2>
				<span class="text-[11px] text-[var(--ui-text-dimmed)]">{memeSlots.list.length}/6 slots</span
				>
			</div>
			<div class="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
				{#each memeSlots.list as slot (slot.id)}
					<div
						class="group flex items-start gap-3 rounded-2xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)]/40 p-3.5 transition hover:border-warm-500/35"
					>
						<span
							class="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)]"
						>
							{#if slot.mediaKindValue === 'video'}
								<Icon name="i-lucide-film" class="size-4.5" />
							{:else if slot.mediaKindValue === 'image'}
								<Icon name="i-lucide-image" class="size-4.5" />
							{:else}
								<Icon name="i-lucide-type" class="size-4.5" />
							{/if}
						</span>
						<div class="min-w-0 flex-1">
							<button
								type="button"
								onclick={() => resumeSlot(slot.id)}
								class="block w-full truncate text-left text-[13.5px] font-bold transition hover:text-warm-600"
								title="Resume this draft in the Meme Studio"
							>
								{slot.label}
							</button>
							<p class="mt-0.5 truncate text-[11px] text-[var(--ui-text-muted)]">
								{slotSummary(slot)}
							</p>
							<p class="mt-0.5 text-[10.5px] text-[var(--ui-text-dimmed)]">
								{agoLabel(slot.savedAt)}
							</p>
						</div>
						<button
							type="button"
							onclick={() => removeSlot(slot.id)}
							aria-label="Delete {slot.label}"
							class="grid size-7 shrink-0 place-items-center rounded-full text-[var(--ui-text-dimmed)] opacity-0 transition group-hover:opacity-100 hover:bg-[var(--ui-bg-muted)] hover:text-[var(--tone-error-text)] focus-visible:opacity-100"
						>
							<Icon name="i-lucide-trash-2" class="size-3.5" />
						</button>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Saved templates -->
	{#if memeTemplates.list.length}
		<section class="mt-7" aria-label="Saved meme templates">
			<div class="mb-2.5 flex items-center justify-between">
				<h2
					class="flex items-center gap-1.5 text-[13px] font-bold tracking-wide text-[var(--ui-text-dimmed)] uppercase"
				>
					<Icon name="i-lucide-bookmark" class="size-4" />
					Your layouts
				</h2>
				<span class="text-[11px] text-[var(--ui-text-dimmed)]">tap to start a new meme with it</span
				>
			</div>
			<div class="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
				{#each memeTemplates.list as tpl (tpl.id)}
					<div
						class="group relative overflow-hidden rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)]/40 transition hover:border-warm-500/40"
					>
						<button
							type="button"
							onclick={() => useTemplate(tpl)}
							class="flex w-full flex-col items-start gap-1.5 p-3 text-left"
							title="Start a new meme with “{tpl.label}”"
						>
							<span
								class="grid size-8 place-items-center rounded-lg bg-[var(--ui-bg-accented)] text-warm-500"
							>
								<Icon name={tpl.icon} class="size-4" />
							</span>
							<span class="line-clamp-2 min-h-[2em] text-[12px] leading-tight font-bold"
								>{tpl.label}</span
							>
							<span class="text-[10px] text-[var(--ui-text-dimmed)]"
								>{tpl.overlays.length} captions</span
							>
						</button>
						{#if memeTemplates.list.length > 0}
							{#key tpl.id}
								<span
									class="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-warm-500/60 opacity-0 transition group-hover:opacity-100"
									transition:slide={{ duration: 0 }}
								></span>
							{/key}
						{/if}
						<button
							type="button"
							onclick={() => removeTemplate(tpl.id)}
							aria-label="Delete template {tpl.label}"
							class="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-[var(--ui-bg)]/80 text-[var(--ui-text-dimmed)] opacity-0 backdrop-blur transition group-hover:opacity-100 hover:text-[var(--tone-error-text)] focus-visible:opacity-100"
						>
							<Icon name="i-lucide-trash-2" class="size-3" />
						</button>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Empty hint -->
	{#if !memeSlots.list.length && !memeTemplates.list.length}
		<section
			class="mt-7 rounded-2xl border border-dashed border-[var(--ui-border-accented)] bg-[var(--ui-bg-muted)]/30 p-5 text-center"
			aria-label="Tips"
		>
			<p
				class="flex items-center justify-center gap-2 text-[13px] font-bold text-[var(--ui-text-muted)]"
			>
				<Icon name="i-lucide-lightbulb" class="size-4 text-warm-500" />
				Nothing saved yet
			</p>
			<p class="mx-auto mt-1.5 max-w-md text-[12px] leading-relaxed text-[var(--ui-text-dimmed)]">
				While editing a meme, save a <strong>draft slot</strong> to resume it later or a
				<strong>layout template</strong> to reuse your captions on any media — both land here.
			</p>
		</section>
	{/if}
</div>
