<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import { STICKER_PACKS, isEmojiOnly } from '$lib/meme/stickers';
	import type { NostrEmoji, NostrEmojiPack } from '$lib/meme/emoji-packs';
	import { emojiPacks } from '$lib/stores/emoji-packs.svelte';
	import MemeNostrPackDialog from '$lib/components/bitz/MemeNostrPackDialog.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';

	/**
	 * MemeStickerPicker — the sticker tool with two sources:
	 *   • Emoji — curated packs + a type-any-emoji input (glyph stickers)
	 *   • Nostr packs — installed kind-30030 collections as a card grid;
	 *     "Browse relays" opens the full dialog (search + preview + install).
	 *     Picking a custom emoji hands the URL up through `onPickCustom` —
	 *     custom emojis are pictures, so they become image layers.
	 */
	let {
		id,
		onAdd,
		onPickCustom,
		float = true
	}: {
		id: string;
		onAdd: (emoji: string) => void;
		/** Custom (kind-30030) emoji pick — becomes an image layer. */
		onPickCustom?: (emoji: NostrEmoji) => void;
		float?: boolean;
	} = $props();

	let source = $state<'emoji' | 'nostr'>('emoji');

	// ---- emoji (glyph) source -------------------------------------------------
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

	// ---- nostr pack source ----------------------------------------------------
	/** 'packs' = the installed-packs card grid; an eventId = that pack's grid. */
	let openPackView = $state<'packs' | string>('packs');
	const pack = $derived(
		openPackView === 'packs'
			? null
			: (emojiPacks.list.find((p) => p.eventId === openPackView) ?? null)
	);
	let browseOpen = $state(false);
	/** Shortcode filter inside the open pack. */
	let packFilter = $state('');
	const visiblePackEmojis = $derived.by(() => {
		if (!pack) return [];
		const q = packFilter.trim().toLowerCase();
		if (!q) return pack.emojis;
		return pack.emojis.filter((e) => e.name.toLowerCase().includes(q));
	});

	function switchToNostr() {
		source = 'nostr';
		openPackView = 'packs';
		packFilter = '';
	}
</script>

<MemeNostrPackDialog
	bind:open={browseOpen}
	onOpenPack={(p: NostrEmojiPack) => {
		switchToNostr();
		openPackView = p.eventId;
	}}
/>

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
	<div class="w-72 max-w-[85vw] p-2">
		<!-- Source switch -->
		<div class="mb-2 flex items-center gap-0.5 rounded-full bg-[var(--ui-bg-muted)] p-0.5">
			<button
				type="button"
				onclick={(e) => {
					e.stopPropagation();
					source = 'emoji';
				}}
				aria-pressed={source === 'emoji'}
				class="flex flex-1 items-center justify-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold transition {source ===
				'emoji'
					? 'bg-[var(--ui-bg)] text-[var(--ui-text)] shadow-sm'
					: 'text-[var(--ui-text-dimmed)]'}"
			>
				<Icon name="i-lucide-smile" class="size-3" />
				Emoji
			</button>
			<button
				type="button"
				onclick={(e) => {
					e.stopPropagation();
					switchToNostr();
				}}
				aria-pressed={source === 'nostr'}
				title="Custom emoji packs from Nostr (kind 30030)"
				class="flex flex-1 items-center justify-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold transition {source ===
				'nostr'
					? 'bg-[var(--ui-bg)] text-[var(--ui-text)] shadow-sm'
					: 'text-[var(--ui-text-dimmed)]'}"
			>
				<Icon name="i-lucide-package-open" class="size-3" />
				Nostr packs
				{#if emojiPacks.list.length}
					<span class="rounded-full bg-primary-500/15 px-1 text-[9.5px] font-bold text-primary-600">
						{emojiPacks.list.length}
					</span>
				{/if}
			</button>
		</div>

		{#if source === 'emoji'}
			<!-- Custom sticker input: type/paste ANY emoji from the keyboard.
			     NOTE: no <form> here — popover panels unmount on the layout's global
			     click-close before a deferred form submit can fire. -->
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
				{#each STICKER_PACKS as p (p.id)}
					<button
						type="button"
						onclick={(e) => {
							e.stopPropagation();
							activePackId = p.id;
						}}
						class="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold transition {activePackId ===
						p.id
							? 'bg-warm-500 text-white'
							: 'bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
					>
						{p.label}
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
		{:else if pack}
			<!-- One installed pack: header + emoji grid -->
			<div class="mb-1.5 flex items-center justify-between gap-2">
				<button
					type="button"
					onclick={(e) => {
						e.stopPropagation();
						openPackView = 'packs';
					}}
					class="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]"
				>
					<Icon name="i-lucide-chevron-left" class="size-3" />
					Packs
				</button>
				<p
					class="min-w-0 flex-1 truncate text-center text-[11px] font-bold text-[var(--ui-text-muted)]"
				>
					{pack.title} · {pack.emojis.length}
				</p>
				<button
					type="button"
					onclick={(e) => {
						e.stopPropagation();
						emojiPacks.uninstall(pack.eventId);
						openPackView = 'packs';
					}}
					title="Remove this pack from the device"
					class="shrink-0 rounded-full p-1 text-[var(--ui-text-dimmed)] transition hover:text-[var(--tone-error-text)]"
				>
					<Icon name="i-lucide-trash-2" class="size-3.5" />
				</button>
			</div>
			<!-- Shortcode filter — big packs need finding, not scrolling. -->
			<div
				class="mb-1.5 flex items-center gap-1.5 rounded-full border border-[var(--ui-border-muted)] px-2.5 py-1"
			>
				<Icon name="i-lucide-search" class="size-3 shrink-0 text-[var(--ui-text-dimmed)]" />
				<input
					type="search"
					bind:value={packFilter}
					onclick={(e) => e.stopPropagation()}
					placeholder="Filter :emojis…"
					class="w-full bg-transparent text-[11px] outline-none placeholder:text-[var(--ui-text-dimmed)]"
				/>
				{#if packFilter}
					<span class="shrink-0 text-[9.5px] font-bold text-[var(--ui-text-dimmed)]">
						{visiblePackEmojis.length}/{pack.emojis.length}
					</span>
				{/if}
			</div>
			<div class="grid max-h-56 grid-cols-6 gap-1 overflow-y-auto">
				{#each visiblePackEmojis as emoji (emoji.name)}
					<button
						type="button"
						onclick={() => onPickCustom?.(emoji)}
						aria-label={`Add :${emoji.name}: as a sticker layer`}
						title={`:${emoji.name}:`}
						class="grid size-9 place-items-center rounded-lg transition hover:scale-110 hover:bg-[var(--ui-bg-muted)] active:scale-95"
					>
						<img
							src={emoji.url}
							alt={emoji.name}
							loading="lazy"
							class="max-h-8 max-w-8 object-contain"
						/>
					</button>
				{/each}
				{#if !visiblePackEmojis.length}
					<p class="col-span-6 py-4 text-center text-[10.5px] text-[var(--ui-text-dimmed)]">
						Nothing matches “{packFilter}”
					</p>
				{/if}
			</div>
		{:else}
			<!-- Installed packs as cards + the browse entry -->
			<div class="grid grid-cols-2 gap-1.5">
				<button
					type="button"
					onclick={(e) => {
						e.stopPropagation();
						browseOpen = true;
					}}
					title="Search your relays for kind-30030 packs — preview + install"
					class="flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-[var(--ui-border-accented)] px-2 py-3 text-[var(--ui-text-muted)] transition hover:border-primary-500/60 hover:bg-primary-500/5 hover:text-primary-600"
				>
					<Icon name="i-lucide-globe-2" class="size-5" />
					<span class="text-[10.5px] font-bold">Browse relays</span>
				</button>
				{#each emojiPacks.list as p (p.eventId)}
					<div class="group relative">
						<button
							type="button"
							onclick={(e) => {
								e.stopPropagation();
								openPackView = p.eventId;
								packFilter = '';
							}}
							title={`${p.title} — ${p.emojis.length} emojis`}
							class="flex w-full items-center gap-2 rounded-xl bg-[var(--ui-bg-accented)] px-2 py-2 text-left transition hover:bg-[var(--ui-bg-muted)]"
						>
							<span
								class="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-black/40"
							>
								{#if p.cover}
									<img src={p.cover} alt="" class="max-h-full max-w-full object-cover" />
								{/if}
							</span>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-[11px] font-bold text-[var(--ui-text)]">
									{p.title}
								</span>
								<span class="block truncate text-[9.5px] text-[var(--ui-text-dimmed)]">
									{p.emojis.length} emojis
								</span>
							</span>
							<!-- Emoji preview thumbs — judge a pack before opening it. -->
							<span class="hidden shrink-0 items-center gap-0.5 sm:flex">
								{#each p.emojis.slice(0, 3) as emoji (emoji.name)}
									<img
										src={emoji.url}
										alt=""
										loading="lazy"
										title={`:${emoji.name}:`}
										class="size-5 rounded object-contain"
									/>
								{/each}
							</span>
						</button>
						<!-- Hover uninstall — no round-trip into the pack view. -->
						<button
							type="button"
							onclick={(e) => {
								e.stopPropagation();
								emojiPacks.uninstall(p.eventId);
							}}
							aria-label={`Remove ${p.title} from the device`}
							title="Remove this pack"
							class="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-[var(--ui-bg)]/90 text-[var(--ui-text-dimmed)] opacity-0 transition group-hover:opacity-100 hover:text-[var(--tone-error-text)]"
						>
							<Icon name="i-lucide-x" class="size-3" />
						</button>
					</div>
				{/each}
			</div>
			{#if !emojiPacks.list.length}
				<p
					class="px-1 pt-2 pb-1 text-center text-[10.5px] leading-snug text-[var(--ui-text-dimmed)]"
				>
					Install a pack from your relays — it caches to this device and works offline.
				</p>
			{/if}
		{/if}
	</div>
</Popover>
