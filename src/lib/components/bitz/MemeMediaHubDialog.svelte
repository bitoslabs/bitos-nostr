<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import GifPicker, { type GifChoice } from '$lib/components/feed/GifPicker.svelte';
	import MemeSvgIconPicker from '$lib/components/bitz/MemeSvgIconPicker.svelte';
	import { STICKER_PACKS, isEmojiOnly } from '$lib/meme/stickers';
	import {
		parseEmojiPack,
		rankEmojiPacks,
		type NostrEmoji,
		type NostrEmojiPack
	} from '$lib/meme/emoji-packs';
	import {
		MAX_PACK_EMOJIS,
		normalizeShortcode,
		packEventParts,
		packToJson,
		parsePackJson,
		sanitizePackEntries,
		slugifyPackD,
		type PackEntry
	} from '$lib/meme/pack-builder';
	import { emojiPacks } from '$lib/stores/emoji-packs.svelte';
	import { queryOnce, publish } from '$lib/nostr/pool';
	import { identity } from '$lib/nostr/identity.svelte';
	import { signMined } from '$lib/auth/signer';
	import { clientTag } from '$lib/nostr/client-tag';
	import { toasts } from '$lib/stores/toasts.svelte';

	/**
	 * MemeMediaHubDialog — ONE dialog for every sticker source in the studio:
	 *   • Emoji   — glyph stickers (curated packs + type-any-emoji)
	 *   • Packs   — installed kind-30030 packs + relay browse/install inline
	 *   • GIFs    — Giphy gifs & transparent stickers, multi-pick = mass add
	 *   • Icons   — Iconify SVG catalog
	 *   • My pack — the builder: curate emojis from any tab into a basket,
	 *               then publish as kind-30030 or export JSON (mass production).
	 *
	 * Replaces the old popover-tab juggling (sticker popover + separate browse
	 * dialog) with a single roomy, searchable surface.
	 */
	let {
		open = $bindable(false),
		/** Glyph emoji pick → text-overlay sticker. */
		onAdd,
		/** Custom (kind-30030) emoji pick → image layer. */
		onPickCustom,
		/** SVG catalog pick → rasterized image layer. */
		onPickSvg,
		/** GIF/sticker pick → image layer. */
		onPickGif,
		/** Multi-pick confirm → staggered image layers (mass production). */
		onAddGifs,
		/** Open the host's file picker (image/GIF layers). */
		onBrowse,
		/** Remaining image-layer slots (caps GIF multi-pick). */
		layerSlots = 6
	}: {
		open?: boolean;
		onAdd: (emoji: string) => void;
		onPickCustom?: (emoji: NostrEmoji) => void;
		onPickSvg?: (icon: { name: string; url: string }) => void;
		onPickGif?: (gif: GifChoice) => void;
		onAddGifs?: (gifs: GifChoice[]) => void;
		onBrowse?: () => void;
		layerSlots?: number;
	} = $props();

	type HubTab = 'emoji' | 'packs' | 'gifs' | 'icons' | 'build';
	let tab = $state<HubTab>('emoji');

	// ---- emoji (glyph) source -------------------------------------------------
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

	// ---- nostr pack source (installed grids + relay browse, one surface) -----
	/** 'packs' = the installed-packs card grid; an eventId = that pack's grid. */
	let openPackView = $state<'packs' | string>('packs');
	const openPack = $derived(
		openPackView === 'packs'
			? null
			: (emojiPacks.list.find((p) => p.eventId === openPackView) ?? null)
	);
	/** Shortcode filter inside the open pack. */
	let packFilter = $state('');
	const visiblePackEmojis = $derived.by(() => {
		if (!openPack) return [];
		const q = packFilter.trim().toLowerCase();
		if (!q) return openPack.emojis;
		return openPack.emojis.filter((e) => e.name.toLowerCase().includes(q));
	});

	// relay browse (absorbed from the old MemeNostrPackDialog)
	let discovered = $state<NostrEmojiPack[]>([]);
	let discovering = $state(false);
	let fetchedAt = 0;
	let query = $state('');
	let expanded = $state<string | null>(null);
	const PAGE_LIMIT = 60;
	let exhausted = $state(false);

	async function discover(force = false) {
		if (discovering) return;
		if (!force && Date.now() - fetchedAt < 60_000 && discovered.length) return;
		discovering = true;
		exhausted = false;
		try {
			const events = await queryOnce([{ kinds: [30030], limit: PAGE_LIMIT }]);
			discovered = rankEmojiPacks(
				events.map((e) => parseEmojiPack(e)).filter((p): p is NostrEmojiPack => p !== null),
				identity.current?.pk ?? ''
			);
			fetchedAt = Date.now();
			exhausted = discovered.length < PAGE_LIMIT;
			if (!discovered.length) toasts.info('No emoji packs on your relays yet');
		} catch {
			toasts.error('Could not reach relays for emoji packs');
		} finally {
			discovering = false;
		}
	}

	async function loadMore() {
		if (discovering || exhausted) return;
		const cursor = discovered.reduce(
			(min, p) => (p.createdAt && (!min || p.createdAt < min) ? p.createdAt : min),
			0
		);
		if (!cursor) {
			exhausted = true;
			return;
		}
		discovering = true;
		try {
			const events = await queryOnce([{ kinds: [30030], limit: PAGE_LIMIT, until: cursor - 1 }]);
			const fresh = rankEmojiPacks(
				events.map((e) => parseEmojiPack(e)).filter((p): p is NostrEmojiPack => p !== null),
				identity.current?.pk ?? ''
			);
			const seen = new Set(discovered.map((p) => p.eventId));
			discovered = [...discovered, ...fresh.filter((p) => !seen.has(p.eventId))];
			if (!fresh.length) exhausted = true;
		} catch {
			toasts.error('Could not load more packs');
		} finally {
			discovering = false;
		}
	}

	/** Relay results with installed packs merged in (installed first). */
	const results = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const installed = emojiPacks.list;
		const seen = new Set(installed.map((p) => p.eventId));
		const rows = [...installed, ...discovered.filter((p) => !seen.has(p.eventId))];
		if (!q) return rows;
		return rows.filter(
			(p) =>
				p.title.toLowerCase().includes(q) || p.emojis.some((e) => e.name.toLowerCase().includes(q))
		);
	});

	function install(pack: NostrEmojiPack) {
		if (!emojiPacks.install(pack)) {
			toasts.info(`Install cap reached (${emojiPacks.list.length}) — remove one first`);
			return;
		}
		toasts.success(`“${pack.title}” installed — cached to this device`);
	}

	$effect(() => {
		if (open && tab === 'packs') void discover();
	});

	// ---- pack builder (mass production) --------------------------------------
	/** Armed = taps in Packs/GIFs/Icons feed the basket instead of the stage. */
	let collectMode = $state(false);
	let basket = $state<PackEntry[]>([]);
	let packName = $state('');
	let publishing = $state(false);
	let importInput = $state<HTMLInputElement | null>(null);

	const cleanBasket = $derived(sanitizePackEntries(basket));
	const canExport = $derived(cleanBasket.length > 0);

	function addToBasket(entry: PackEntry): void {
		const name = normalizeShortcode(entry.name);
		if (!name) {
			toasts.info('Could not name that sticker — skip it or rename in My pack');
			return;
		}
		if (basket.length >= MAX_PACK_EMOJIS) {
			toasts.info(`Packs cap at ${MAX_PACK_EMOJIS} emojis`);
			return;
		}
		if (basket.some((e) => normalizeShortcode(e.name) === name)) {
			toasts.info(`:${name}: is already in your pack`);
			return;
		}
		basket = [...basket, { name, url: entry.url }];
	}

	function removeFromBasket(i: number): void {
		basket = basket.filter((_, idx) => idx !== i);
	}

	/** Inline rename in the builder grid — normalized on blur. */
	function renameBasketEntry(i: number, raw: string): void {
		const next = [...basket];
		next[i] = { ...next[i]!, name: raw };
		basket = next;
	}

	function normalizeBasketNames(): void {
		basket = sanitizePackEntries(basket);
	}

	function gifEntry(gif: GifChoice, seq: number): PackEntry {
		const fromTitle = normalizeShortcode(gif.title ?? '');
		return { name: fromTitle || `sticker${seq}`, url: gif.url };
	}

	function iconEntry(icon: { name: string; url: string }): PackEntry {
		const leaf = icon.name.split(':').pop() ?? icon.name;
		return { name: normalizeShortcode(leaf) || 'icon', url: icon.url };
	}

	function importPackJson(file: File | null): void {
		if (!file) return;
		void file
			.text()
			.then((text) => {
				const parsed = parsePackJson(JSON.parse(text));
				if (!parsed) throw new Error('bad file');
				packName = parsed.title;
				basket = sanitizePackEntries([...basket, ...parsed.emojis]);
				if (!collectMode) collectMode = true;
				toasts.success(`Imported ${parsed.emojis.length} emojis — review them in My pack`);
			})
			.catch(() => toasts.error('That file is not a BitOS pack export'));
	}

	function downloadPack(): void {
		const entries = cleanBasket;
		if (!entries.length) return;
		const json = packToJson({ title: packName, emojis: entries });
		const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = `${slugifyPackD(packName || 'my-pack')}.json`;
		document.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
		// Give the download a beat to start before revoking the blob URL
		// (same pattern as the studio's mobile export).
		setTimeout(() => URL.revokeObjectURL(url), 30_000);
		toasts.success('Pack exported — the JSON re-imports here and anywhere NIP-30 lives');
	}

	async function publishPack(): Promise<void> {
		const me = identity.current;
		if (!me) {
			toasts.error('Sign in to publish a pack');
			return;
		}
		const entries = cleanBasket;
		if (!entries.length || publishing) return;
		publishing = true;
		try {
			const parts = packEventParts({ title: packName, emojis: entries, clientTag: clientTag() });
			const event = await signMined({
				kind: 30030,
				content: '',
				created_at: Math.floor(Date.now() / 1000),
				tags: parts.tags
			});
			await publish(event);
			const pack = parseEmojiPack(event);
			if (pack && emojiPacks.install(pack)) {
				openPackView = pack.eventId;
				toasts.success(`Published “${parts.title}” — installed on this device too`);
			} else {
				toasts.success(`Published “${parts.title}”`);
			}
			basket = [];
			packName = '';
			collectMode = false;
			tab = 'packs';
		} catch (e) {
			toasts.error(e instanceof Error ? e.message : 'Could not publish the pack');
		} finally {
			publishing = false;
		}
	}

	const TABS: { key: HubTab; label: string; icon: string }[] = [
		{ key: 'emoji', label: 'Emoji', icon: 'i-lucide-smile' },
		{ key: 'packs', label: 'Packs', icon: 'i-lucide-package-open' },
		{ key: 'gifs', label: 'GIFs', icon: 'i-lucide-image-play' },
		{ key: 'icons', label: 'Icons', icon: 'i-lucide-shapes' },
		{ key: 'build', label: 'My pack', icon: 'i-lucide-package-plus' }
	];
</script>

<Dialog bind:open title="Stickers & GIFs" width="max-w-2xl">
	<div class="flex h-[64vh] max-h-[calc(85vh-6rem)] flex-col gap-2">
		<!-- One-dialog source switch: every sticker source lives behind these five tabs. -->
		<div
			class="flex shrink-0 items-center gap-0.5 overflow-x-auto rounded-full bg-[var(--ui-bg-muted)] p-0.5"
		>
			{#each TABS as t (t.key)}
				<button
					type="button"
					onclick={() => (tab = t.key)}
					aria-pressed={tab === t.key}
					class="flex flex-1 items-center justify-center gap-1 rounded-full px-2.5 py-1.5 text-[12px] font-bold whitespace-nowrap transition {tab ===
					t.key
						? 'bg-[var(--ui-bg)] text-[var(--ui-text)] shadow-sm'
						: 'text-[var(--ui-text-dimmed)] hover:text-[var(--ui-text-muted)]'}"
				>
					<Icon name={t.icon} class="size-3.5" />
					{t.label}
					{#if t.key === 'packs' && emojiPacks.list.length}
						<span
							class="rounded-full bg-primary-500/15 px-1 font-mono text-[10px] text-primary-600"
						>
							{emojiPacks.list.length}
						</span>
					{/if}
					{#if t.key === 'build' && basket.length}
						<span class="rounded-full bg-warm-500/20 px-1 font-mono text-[10px] text-warm-600">
							{basket.length}
						</span>
					{/if}
				</button>
			{/each}
		</div>

		<!-- Collect-mode banner: taps feed the pack basket (mass production). -->
		{#if tab !== 'emoji' && tab !== 'build'}
			<button
				type="button"
				onclick={() => (collectMode = !collectMode)}
				aria-pressed={collectMode}
				title="Tap stickers to collect them into your own exportable pack"
				class="flex shrink-0 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-bold transition {collectMode
					? 'bg-warm-500/15 text-warm-600 ring-1 ring-warm-500/40'
					: 'bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
			>
				<Icon
					name={collectMode ? 'i-lucide-package-check' : 'i-lucide-package-plus'}
					class="size-3.5"
				/>
				{collectMode
					? `Collecting for My pack — ${basket.length}/${MAX_PACK_EMOJIS}`
					: 'Build my own pack'}
			</button>
		{/if}

		<div class="min-h-0 flex-1 overflow-y-auto pr-0.5">
			<!-- ── EMOJI ─────────────────────────────────────────────────────── -->
			{#if tab === 'emoji'}
				<div class="mb-2 flex items-center gap-1">
					<label class="sr-only" for="hub-custom-sticker">Custom emoji sticker</label>
					<input
						id="hub-custom-sticker"
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
						class="h-9 min-w-0 flex-1 rounded-full border border-[var(--ui-border-muted)] bg-transparent px-3 text-center text-[16px] outline-none placeholder:text-[11px] placeholder:font-normal placeholder:text-[var(--ui-text-dimmed)] focus:border-warm-500"
					/>
					<button
						type="button"
						onclick={addCustom}
						title="Add this emoji as a sticker"
						class="grid size-9 shrink-0 place-items-center rounded-full bg-warm-500/12 text-warm-500 transition hover:bg-warm-500/20 active:scale-95"
					>
						<Icon name="i-lucide-plus" class="size-4" />
					</button>
				</div>
				<div class="space-y-3">
					{#each STICKER_PACKS as pack (pack.id)}
						<section>
							<h3
								class="mb-1.5 text-[10px] font-bold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
							>
								{pack.label}
							</h3>
							<div class="grid grid-cols-9 gap-1 sm:grid-cols-11">
								{#each pack.stickers as emoji (emoji)}
									<button
										type="button"
										onclick={() => onAdd(emoji)}
										aria-label={`Add ${emoji} sticker`}
										class="grid aspect-square place-items-center rounded-lg text-[19px] leading-none transition hover:scale-110 hover:bg-[var(--ui-bg-muted)] active:scale-95"
									>
										{emoji}
									</button>
								{/each}
							</div>
						</section>
					{/each}
				</div>
			{/if}

			<!-- ── PACKS: installed grids + relay browse, one surface ─────────── -->
			{#if tab === 'packs'}
				{#if openPack}
					<!-- One installed pack: header + emoji grid -->
					<div class="mb-2 flex items-center justify-between gap-2">
						<button
							type="button"
							onclick={() => (openPackView = 'packs')}
							class="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]"
						>
							<Icon name="i-lucide-chevron-left" class="size-3" />
							Packs
						</button>
						<p
							class="min-w-0 flex-1 truncate text-center text-[12px] font-bold text-[var(--ui-text-muted)]"
						>
							{openPack.title} · {openPack.emojis.length}
						</p>
						<button
							type="button"
							onclick={() => {
								emojiPacks.uninstall(openPack.eventId);
								openPackView = 'packs';
							}}
							title="Remove this pack from the device"
							class="shrink-0 rounded-full p-1 text-[var(--ui-text-dimmed)] transition hover:text-[var(--tone-error-text)]"
						>
							<Icon name="i-lucide-trash-2" class="size-4" />
						</button>
					</div>
					<div
						class="mb-2 flex items-center gap-1.5 rounded-full border border-[var(--ui-border-muted)] px-2.5 py-1.5"
					>
						<Icon name="i-lucide-search" class="size-3.5 shrink-0 text-[var(--ui-text-dimmed)]" />
						<input
							type="search"
							bind:value={packFilter}
							placeholder="Filter :emojis…"
							class="w-full bg-transparent text-[12px] outline-none placeholder:text-[var(--ui-text-dimmed)]"
						/>
						{#if packFilter}
							<span class="shrink-0 font-mono text-[10px] text-[var(--ui-text-dimmed)]">
								{visiblePackEmojis.length}/{openPack.emojis.length}
							</span>
						{/if}
					</div>
					<div class="grid grid-cols-7 gap-1.5 sm:grid-cols-9">
						{#each visiblePackEmojis as emoji (emoji.name)}
							<button
								type="button"
								onclick={() =>
									collectMode
										? addToBasket({ name: emoji.name, url: emoji.url })
										: onPickCustom?.(emoji)}
								aria-label={collectMode
									? `Collect :${emoji.name}: into your pack`
									: `Add :${emoji.name}: as a sticker layer`}
								title={`:${emoji.name}:`}
								class="grid aspect-square place-items-center rounded-lg transition hover:scale-110 hover:bg-[var(--ui-bg-muted)] active:scale-95 {collectMode
									? 'ring-1 ring-warm-500/30'
									: ''}"
							>
								<img
									src={emoji.url}
									alt={emoji.name}
									loading="lazy"
									class="max-h-9 max-w-9 object-contain"
								/>
							</button>
						{/each}
						{#if !visiblePackEmojis.length}
							<p class="col-span-full py-6 text-center text-[11.5px] text-[var(--ui-text-dimmed)]">
								Nothing matches “{packFilter}”
							</p>
						{/if}
					</div>
				{:else}
					<!-- Browse relays + installed packs (search covers both) -->
					<div
						class="mb-2 flex items-center gap-2 rounded-full border border-[var(--ui-border-muted)] px-3 py-1.5"
					>
						<Icon name="i-lucide-search" class="size-4 shrink-0 text-[var(--ui-text-dimmed)]" />
						<input
							type="search"
							bind:value={query}
							placeholder="Search packs or :shortcodes…"
							class="w-full bg-transparent text-[13px] outline-none placeholder:text-[var(--ui-text-dimmed)]"
						/>
						<button
							type="button"
							onclick={() => void discover(true)}
							disabled={discovering}
							title="Re-query your relays for kind-30030 packs"
							class="grid size-7 shrink-0 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-50"
						>
							<Icon
								name="i-lucide-refresh-cw"
								class="size-3.5 {discovering ? 'animate-spin' : ''}"
							/>
						</button>
					</div>
					<div class="flex flex-col gap-1.5">
						{#each results as pack (pack.eventId)}
							{@const isInstalled = emojiPacks.has(pack.eventId)}
							{@const isOpen = expanded === pack.eventId}
							<div
								class="rounded-xl border {isOpen
									? 'border-primary-500/40 bg-primary-500/[0.04]'
									: 'border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)]'} px-3 py-2.5"
							>
								<div class="flex items-center gap-2.5">
									<button
										type="button"
										onclick={() => (expanded = isOpen ? null : pack.eventId)}
										aria-expanded={isOpen}
										class="flex min-w-0 flex-1 items-center gap-2.5 text-left"
										title={isOpen ? 'Collapse preview' : 'Preview emojis'}
									>
										<span
											class="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-black/40"
										>
											{#if pack.cover}
												<img src={pack.cover} alt="" class="max-h-full max-w-full object-cover" />
											{:else}
												<Icon name="i-lucide-package-open" class="size-5 text-white/60" />
											{/if}
										</span>
										<span class="min-w-0 flex-1">
											<span class="block truncate text-[13px] font-bold text-[var(--ui-text)]">
												{pack.title}
											</span>
											<span class="block text-[10.5px] text-[var(--ui-text-dimmed)]">
												{pack.emojis.length} emojis · {pack.pubkey.slice(0, 10)}…
											</span>
										</span>
										<span class="hidden shrink-0 items-center gap-0.5 sm:flex">
											{#each pack.emojis.slice(0, 4) as emoji (emoji.name)}
												<img
													src={emoji.url}
													alt={emoji.name}
													loading="lazy"
													title={`:${emoji.name}:`}
													class="size-6 rounded-md object-contain"
												/>
											{/each}
											{#if pack.emojis.length > 4}
												<span class="text-[10px] font-bold text-[var(--ui-text-dimmed)]">
													+{pack.emojis.length - 4}
												</span>
											{/if}
										</span>
										<Icon
											name={isOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'}
											class="size-4 shrink-0 text-[var(--ui-text-dimmed)]"
										/>
									</button>
									{#if isInstalled}
										<button
											type="button"
											onclick={() => {
												packFilter = '';
												openPackView = pack.eventId;
											}}
											title="Open this pack's emojis"
											class="h-8 shrink-0 rounded-full bg-primary-500 px-3 text-[11.5px] font-bold text-white transition hover:bg-primary-600"
										>
											Open
										</button>
										<button
											type="button"
											onclick={() => {
												emojiPacks.uninstall(pack.eventId);
												if (expanded === pack.eventId) expanded = null;
											}}
											title="Remove this pack from the device"
											aria-label={`Uninstall ${pack.title}`}
											class="grid size-8 shrink-0 place-items-center rounded-full text-[var(--ui-text-dimmed)] transition hover:bg-[var(--ui-bg)] hover:text-[var(--tone-error-text)]"
										>
											<Icon name="i-lucide-trash-2" class="size-4" />
										</button>
									{:else}
										<button
											type="button"
											onclick={() => install(pack)}
											class="flex h-8 shrink-0 items-center gap-1 rounded-full bg-primary-500 px-3 text-[11.5px] font-bold text-white transition hover:bg-primary-600"
										>
											<Icon name="i-lucide-download" class="size-3.5" />
											Install
										</button>
									{/if}
								</div>
								{#if isOpen}
									<div
										class="mt-2.5 grid grid-cols-8 gap-1 border-t border-[var(--ui-border-muted)] pt-2.5 sm:grid-cols-12"
									>
										{#each pack.emojis.slice(0, 48) as emoji (emoji.name)}
											<button
												type="button"
												onclick={() =>
													collectMode
														? addToBasket({ name: emoji.name, url: emoji.url })
														: onPickCustom?.(emoji)}
												title={`:${emoji.name}:`}
												class="grid aspect-square place-items-center rounded-lg bg-[var(--ui-bg)] transition hover:scale-110 active:scale-95"
											>
												<img
													src={emoji.url}
													alt={emoji.name}
													loading="lazy"
													class="max-h-7 max-w-7 object-contain"
												/>
											</button>
										{/each}
										{#if pack.emojis.length > 48}
											<span
												class="grid aspect-square place-items-center rounded-lg text-[10px] font-bold text-[var(--ui-text-dimmed)]"
											>
												+{pack.emojis.length - 48}
											</span>
										{/if}
									</div>
								{/if}
							</div>
						{/each}

						{#if discovering && !results.length}
							<div
								class="grid place-items-center gap-2 py-10 text-[12px] text-[var(--ui-text-dimmed)]"
							>
								<Icon name="i-lucide-loader-circle" class="size-6 animate-spin text-primary-500" />
								Searching your relays for kind-30030 packs…
							</div>
						{:else if !results.length}
							<div
								class="grid place-items-center gap-1 py-10 text-center text-[12px] text-[var(--ui-text-dimmed)]"
							>
								<Icon name="i-lucide-package-open" class="size-6" />
								{query.trim()
									? 'No packs match that search'
									: 'No emoji packs found on your relays yet — try Refresh'}
							</div>
						{/if}

						{#if !query.trim() && discovered.length}
							{#if !exhausted}
								<button
									type="button"
									onclick={() => void loadMore()}
									disabled={discovering}
									class="mx-auto flex h-8 items-center gap-1.5 rounded-full border border-[var(--ui-border-muted)] px-4 text-[11.5px] font-semibold text-[var(--ui-text-muted)] transition hover:border-primary-500 hover:text-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
								>
									<Icon
										name={discovering ? 'i-lucide-loader-circle' : 'i-lucide-chevrons-down'}
										class="size-3.5 {discovering ? 'animate-spin' : ''}"
									/>
									{discovering ? 'Loading older packs…' : `Load more (${discovered.length} found)`}
								</button>
							{:else}
								<p
									class="flex items-center justify-center gap-1 py-1 text-[10.5px] font-semibold text-[var(--ui-text-dimmed)]"
								>
									<Icon name="i-lucide-check" class="size-3" />
									That's every pack your relays serve — {discovered.length} found
								</p>
							{/if}
						{/if}
					</div>
					<p
						class="mt-2 flex items-center justify-center gap-1 text-[10.5px] text-[var(--ui-text-dimmed)]"
					>
						<Icon name="i-lucide-info" class="size-3" />
						Install caches the pack to this device — picks then work offline. Kind 30030.
					</p>
				{/if}
			{/if}

			<!-- ── GIFS: multi-pick = mass production ─────────────────────────── -->
			{#if tab === 'gifs'}
				<GifPicker
					variant="inline"
					multiple
					max={Math.max(1, layerSlots)}
					onbrowse={onBrowse}
					onpick={(gif) =>
						collectMode ? addToBasket(gifEntry(gif, basket.length + 1)) : onPickGif?.(gif)}
					onpickmany={(gifs) => {
						if (collectMode) {
							for (let i = 0; i < gifs.length; i++)
								addToBasket(gifEntry(gifs[i]!, basket.length + 1 + i));
							toasts.success(`Collected ${gifs.length} stickers into My pack`);
						} else {
							onAddGifs?.(gifs);
						}
					}}
				/>
			{/if}

			<!-- ── ICONS ──────────────────────────────────────────────────────── -->
			{#if tab === 'icons'}
				<MemeSvgIconPicker
					onPick={(icon) => (collectMode ? addToBasket(iconEntry(icon)) : onPickSvg?.(icon))}
				/>
			{/if}

			<!-- ── MY PACK: build → publish (kind 30030) / export JSON ────────── -->
			{#if tab === 'build'}
				<div class="flex flex-col gap-3">
					<div class="flex items-center gap-2">
						<label class="sr-only" for="hub-pack-name">Pack name</label>
						<input
							id="hub-pack-name"
							type="text"
							bind:value={packName}
							placeholder="Name your pack…"
							maxlength="80"
							class="h-9 min-w-0 flex-1 rounded-full border border-[var(--ui-border-muted)] bg-transparent px-3.5 text-[13px] font-semibold outline-none placeholder:font-normal placeholder:text-[var(--ui-text-dimmed)] focus:border-warm-500"
						/>
						<button
							type="button"
							onclick={() => importInput?.click()}
							title="Import a pack JSON exported from here"
							class="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]"
						>
							<Icon name="i-lucide-file-up" class="size-4" />
						</button>
						<input
							bind:this={importInput}
							type="file"
							accept="application/json,.json"
							class="hidden"
							onchange={(e) => {
								importPackJson(e.currentTarget.files?.[0] ?? null);
								e.currentTarget.value = '';
							}}
						/>
					</div>

					{#if cleanBasket.length}
						<div class="flex items-center justify-between px-0.5">
							<p
								class="text-[10.5px] font-bold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
							>
								{cleanBasket.length}/{MAX_PACK_EMOJIS} emojis
							</p>
							<button
								type="button"
								onclick={() => (basket = [])}
								class="text-[10.5px] font-bold text-[var(--ui-text-dimmed)] transition hover:text-[var(--tone-error-text)]"
							>
								Clear all
							</button>
						</div>
						<!-- Builder grid: thumb + editable shortcode + remove. -->
						<div class="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
							{#each basket as entry, i (i)}
								<div
									class="flex items-center gap-2 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] p-1.5"
								>
									<span
										class="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-black/30"
									>
										<img
											src={entry.url}
											alt={entry.name}
											loading="lazy"
											class="max-h-9 max-w-9 object-contain"
										/>
									</span>
									<span class="min-w-0 flex-1">
										<label class="sr-only" for="hub-pack-code-{i}">Shortcode for {entry.name}</label
										>
										<input
											id="hub-pack-code-{i}"
											type="text"
											value={entry.name}
											maxlength="64"
											oninput={(e) => renameBasketEntry(i, e.currentTarget.value)}
											onblur={normalizeBasketNames}
											class="w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 font-mono text-[11.5px] outline-none focus:border-warm-500/60 focus:bg-[var(--ui-bg)]"
										/>
										<span class="block truncate px-1 text-[9px] text-[var(--ui-text-dimmed)]">
											:{normalizeShortcode(entry.name) || '?'}:
										</span>
									</span>
									<button
										type="button"
										onclick={() => removeFromBasket(i)}
										aria-label={`Remove :${entry.name}: from the pack`}
										class="grid size-6 shrink-0 place-items-center rounded-full text-[var(--ui-text-dimmed)] transition hover:bg-[var(--ui-bg)] hover:text-[var(--tone-error-text)]"
									>
										<Icon name="i-lucide-x" class="size-3.5" />
									</button>
								</div>
							{/each}
						</div>
					{:else}
						<div
							class="grid place-items-center gap-2 rounded-2xl border-2 border-dashed border-[var(--ui-border-accented)] px-4 py-8 text-center"
						>
							<Icon name="i-lucide-package-plus" class="size-7 text-[var(--ui-text-dimmed)]" />
							<p class="text-[12px] font-bold text-[var(--ui-text-muted)]">Your pack is empty</p>
							<p class="max-w-72 text-[11px] leading-snug text-[var(--ui-text-dimmed)]">
								Turn on <strong>Build my own pack</strong> in Packs, GIFs or Icons, then tap emojis and
								stickers to collect them here. Publish once — everyone can install it.
							</p>
							<button
								type="button"
								onclick={() => {
									collectMode = true;
									tab = 'packs';
								}}
								class="mt-1 flex items-center gap-1 rounded-full bg-warm-500/12 px-3.5 py-1.5 text-[11.5px] font-bold text-warm-600 transition hover:bg-warm-500/20"
							>
								<Icon name="i-lucide-plus" class="size-3.5" />
								Start collecting
							</button>
						</div>
					{/if}

					<!-- Export row: publish to relays or download the JSON. -->
					<div class="flex items-center gap-2 border-t border-[var(--ui-border-muted)] pt-3">
						<button
							type="button"
							onclick={() => void publishPack()}
							disabled={!canExport || publishing}
							title="Sign + publish a kind-30030 pack to your write relays"
							class="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-primary-500 text-[12.5px] font-bold text-white transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
						>
							<Icon
								name={publishing ? 'i-lucide-loader-circle' : 'i-lucide-send'}
								class="size-4 {publishing ? 'animate-spin' : ''}"
							/>
							{publishing ? 'Publishing…' : 'Publish to Nostr'}
						</button>
						<button
							type="button"
							onclick={downloadPack}
							disabled={!canExport}
							title="Download the pack as portable JSON"
							class="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-warm-500/12 text-[12.5px] font-bold text-warm-600 transition hover:bg-warm-500/20 disabled:cursor-not-allowed disabled:opacity-50"
						>
							<Icon name="i-lucide-file-down" class="size-4" />
							Export JSON
						</button>
					</div>
					<p
						class="flex items-center justify-center gap-1 text-center text-[10.5px] text-[var(--ui-text-dimmed)]"
					>
						<Icon name="i-lucide-info" class="size-3" />
						{identity.current
							? 'Publishing signs a kind-30030 event — packs are public to your write relays.'
							: 'Sign in to publish; Export JSON works offline.'}
					</p>
				</div>
			{/if}
		</div>

		<!-- Basket tray: follow the user across tabs, one tap to build. -->
		{#if basket.length && tab !== 'build'}
			<button
				type="button"
				onclick={() => (tab = 'build')}
				class="flex shrink-0 items-center justify-center gap-2 rounded-full bg-warm-500/12 px-4 py-2 text-[12px] font-bold text-warm-600 transition hover:bg-warm-500/20"
			>
				<Icon name="i-lucide-package-open" class="size-4" />
				{basket.length} collected — build my pack
				<Icon name="i-lucide-arrow-right" class="size-3.5" />
			</button>
		{/if}
	</div>
</Dialog>
