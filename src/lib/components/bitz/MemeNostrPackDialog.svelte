<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import { parseEmojiPack, rankEmojiPacks, type NostrEmojiPack } from '$lib/meme/emoji-packs';
	import { emojiPacks } from '$lib/stores/emoji-packs.svelte';
	import { queryOnce } from '$lib/nostr/pool';
	import { identity } from '$lib/nostr/identity.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';

	/**
	 * MemeNostrPackDialog — the roomy browse/install surface for kind-30030
	 * custom emoji packs (the sticker popover stays slim; this dialog does the
	 * discovery): search-as-you-type over relay results, each row previews the
	 * pack's first emojis, and a tap expands the full grid before committing.
	 * Install = cache to the device (emojiPacks store); uninstall frees it.
	 */
	let {
		open = $bindable(false),
		/** After installing (or opening an installed pack), jump the caller
		 *  straight to that pack's emoji grid. */
		onOpenPack
	}: {
		open?: boolean;
		onOpenPack?: (pack: NostrEmojiPack) => void;
	} = $props();

	let discovered = $state<NostrEmojiPack[]>([]);
	let discovering = $state(false);
	let fetchedAt = 0;
	let query = $state('');
	/** EventId of the row whose emoji grid is expanded. */
	let expanded = $state<string | null>(null);
	/** Pagination: page size + end-of-results flag (retires Load more). */
	const PAGE_LIMIT = 60;
	let exhausted = $state(false);

	async function discover(force = false) {
		if (discovering) return;
		if (!force && Date.now() - fetchedAt < 60_000 && discovered.length) return;
		discovering = true;
		exhausted = false;
		try {
			const events = await queryOnce([{ kinds: [30030], limit: PAGE_LIMIT }]);
			const mine = identity.current?.pk ?? '';
			discovered = rankEmojiPacks(
				events.map((e) => parseEmojiPack(e)).filter((p): p is NostrEmojiPack => p !== null),
				mine
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

	/** Next page: the relay `until` cursor walks backwards from the oldest
	 *  event seen; results merge (deduped by event id). An empty page marks
	 *  the end so Load more retires gracefully. */
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
			const mine = identity.current?.pk ?? '';
			const fresh = rankEmojiPacks(
				events.map((e) => parseEmojiPack(e)).filter((p): p is NostrEmojiPack => p !== null),
				mine
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

	$effect(() => {
		if (open) void discover();
	});

	function install(pack: NostrEmojiPack) {
		if (!emojiPacks.install(pack)) {
			toasts.info(`Install cap reached (${emojiPacks.list.length}) — remove one first`);
			return;
		}
		toasts.success(`“${pack.title}” installed — cached to this device`);
	}

	function openPack(pack: NostrEmojiPack) {
		open = false;
		onOpenPack?.(pack);
	}
</script>

<Dialog bind:open title="Nostr emoji packs">
	<div class="flex flex-col gap-3">
		<!-- Search: filters relay results + installed packs by title/shortcode -->
		<div
			class="flex items-center gap-2 rounded-full border border-[var(--ui-border-muted)] px-3 py-2"
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
				<Icon name="i-lucide-refresh-cw" class="size-3.5 {discovering ? 'animate-spin' : ''}" />
			</button>
		</div>

		<div class="flex max-h-[55vh] flex-col gap-2 overflow-y-auto pr-1">
			{#each results as pack (pack.eventId)}
				{@const isInstalled = emojiPacks.has(pack.eventId)}
				{@const isOpen = expanded === pack.eventId}
				<div
					class="rounded-xl border {isOpen
						? 'border-primary-500/40 bg-primary-500/[0.04]'
						: 'border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)]'} px-3 py-2.5"
				>
					<!-- Row: cover + title + emoji preview thumbs + actions -->
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
							<!-- Preview thumbs (collapse-safe: hidden on tiny widths) -->
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
								onclick={() => openPack(pack)}
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
					<!-- Expanded: the pack's emoji grid preview -->
					{#if isOpen}
						<div
							class="mt-2.5 grid grid-cols-8 gap-1 border-t border-[var(--ui-border-muted)] pt-2.5 sm:grid-cols-10"
						>
							{#each pack.emojis.slice(0, 40) as emoji (emoji.name)}
								<span
									class="grid aspect-square place-items-center rounded-lg bg-[var(--ui-bg)]"
									title={`:${emoji.name}:`}
								>
									<img
										src={emoji.url}
										alt={emoji.name}
										loading="lazy"
										class="max-h-7 max-w-7 object-contain"
									/>
								</span>
							{/each}
							{#if pack.emojis.length > 40}
								<span
									class="grid aspect-square place-items-center rounded-lg text-[10px] font-bold text-[var(--ui-text-dimmed)]"
								>
									+{pack.emojis.length - 40}
								</span>
							{/if}
						</div>
					{/if}
				</div>
			{/each}

			{#if discovering && !results.length}
				<div class="grid place-items-center gap-2 py-10 text-[12px] text-[var(--ui-text-dimmed)]">
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

			<!-- Pagination: older pages via the relay `until` cursor; retire at
			     the end of history. -->
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

		<p class="flex items-center justify-center gap-1 text-[10.5px] text-[var(--ui-text-dimmed)]">
			<Icon name="i-lucide-info" class="size-3" />
			Install caches the pack to this device — picks then work offline. Kind 30030.
		</p>
	</div>
</Dialog>
