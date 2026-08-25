<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import NoteZapDialog from '$lib/components/feed/NoteZapDialog.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { shortKey } from '$lib/utils/format';
	import { TEMPLATE_CATEGORIES } from '$lib/meme/template-marketplace';
	import { templateMarketplace } from '$lib/stores/template-marketplace.svelte';
	import { sharedTemplatesStore } from '$lib/stores/meme-shared-templates.svelte';

	let {
		open = $bindable(false),
		onImport
	}: {
		open?: boolean;
		onImport?: (eventId: string) => void;
	} = $props();

	// Mirror the dialog state into the store so external triggers open it.
	$effect(() => {
		templateMarketplace.open = open;
	});
	$effect(() => {
		open = templateMarketplace.open;
	});

	const zapOpen = $derived(!!templateMarketplace.zapTarget);
	const zapCreator = $derived(templateMarketplace.zapTarget?.creatorPubkey ?? '');

	$effect(() => {
		if (open) profiles.ensure([...new Set(sharedTemplatesStore.list.map((t) => t.creatorPubkey))]);
	});
</script>

<Dialog bind:open title="Bitz Templates">
	<div class="flex flex-col gap-3">
		<!-- Category rail -->
		<div class="flex flex-wrap gap-1.5">
			{#each TEMPLATE_CATEGORIES as cat (cat.id)}
				<button
					type="button"
					onclick={() => templateMarketplace.setCategory(cat.id)}
					class="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition {templateMarketplace.activeCategory ===
					cat.id
						? 'bg-primary-500/20 text-primary-600'
						: 'bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)] hover:bg-primary-500/10 hover:text-primary-600'}"
				>
					<Icon name={cat.icon} class="size-3.5" />
					{cat.label}
				</button>
			{/each}
		</div>

		{#if sharedTemplatesStore.loading}
			<div class="flex h-40 items-center justify-center text-[var(--ui-text-dimmed)]">
				<Icon name="i-lucide-loader-circle" class="size-6 animate-spin" />
			</div>
		{:else if !templateMarketplace.rows.length}
			<div class="flex h-40 flex-col items-center justify-center gap-2 text-center">
				<Icon name="i-lucide-store" class="size-8 text-[var(--ui-text-dimmed)]" />
				<p class="text-[12.5px] text-[var(--ui-text-dimmed)]">
					No templates in this category yet — share yours and be the first
				</p>
			</div>
		{:else}
			<div class="flex max-h-[52vh] flex-col gap-1.5 overflow-y-auto">
				{#each templateMarketplace.rows as row (row.template.eventId)}
					{@const t = row.template}
					<div class="flex items-center gap-2.5 rounded-xl bg-[var(--ui-bg-accented)] px-3 py-2.5">
						<span
							class="grid size-9 shrink-0 place-items-center rounded-full bg-primary-500/12 text-primary-600"
						>
							<Icon name={t.icon} class="size-4.5" />
						</span>
						<div class="min-w-0 flex-1">
							<p class="truncate text-[13px] font-bold">
								{t.label}
								{#if row.own}<span class="text-[10px] text-[var(--ui-text-dimmed)]">· yours</span
									>{/if}
							</p>
							<p class="flex items-center gap-1.5 text-[10.5px] text-[var(--ui-text-dimmed)]">
								<Avatar pubkey={t.creatorPubkey} size={14} />
								{profiles.displayName(t.creatorPubkey) || shortKey(t.creatorPubkey)}
								· {t.overlays.length} caption{t.overlays.length === 1 ? '' : 's'}
							</p>
						</div>
						{#if row.unlocked}
							<button
								type="button"
								onclick={() => {
									void templateMarketplace.importUnlocked(t).then(() => onImport?.(t.eventId));
								}}
								class="flex items-center gap-1 rounded-full bg-warm-500/15 px-2.5 py-1 text-[11px] font-bold text-warm-600 transition hover:bg-warm-500/25 active:scale-[0.98]"
							>
								<Icon name="i-lucide-plus" class="size-3.5" />
								Use
							</button>
						{:else if row.priceSats > 0}
							<button
								type="button"
								onclick={() => templateMarketplace.startZap(t)}
								disabled={zapOpen}
								class="flex items-center gap-1 rounded-full bg-primary-500/15 px-2.5 py-1 text-[11px] font-bold text-primary-600 transition hover:bg-primary-500/25 active:scale-[0.98] disabled:opacity-40"
							>
								<Icon name="i-lucide-zap" class="size-3.5" />
								{row.priceSats} sats
							</button>
						{:else}
							<button
								type="button"
								onclick={() => {
									void templateMarketplace.importUnlocked(t).then(() => onImport?.(t.eventId));
								}}
								class="flex items-center gap-1 rounded-full bg-warm-500/15 px-2.5 py-1 text-[11px] font-bold text-warm-600 transition hover:bg-warm-500/25 active:scale-[0.98]"
							>
								<Icon name="i-lucide-plus" class="size-3.5" />
								Free
							</button>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</Dialog>

{#if templateMarketplace.zapTarget}
	{@const target = templateMarketplace.zapTarget}
	<NoteZapDialog
		open={zapOpen}
		recipientPubkey={zapCreator}
		lightningAddress={profiles.get(zapCreator)?.lud16 ?? ''}
		eventId={target.eventId}
		eventKind={30078}
		onPaid={() => void templateMarketplace.completeZap()}
		onClose={() => templateMarketplace.clearZap()}
	/>
{/if}
