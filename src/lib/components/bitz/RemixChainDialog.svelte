<script lang="ts">
	import { onDestroy } from 'svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import NoteZapDialog from '$lib/components/feed/NoteZapDialog.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { lookupEventTags } from '$lib/nostr/pool';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { remixChainOf, type RemixAncestor } from '$lib/meme/remix';
	import { hasLightning } from '$lib/utils/verification';
	import { shareEntity } from '$lib/utils/bitz-links';

	/**
	 * Remix lineage browser (plan §17 creator economy, audit gap #12).
	 *
	 * Walks the bounded, cycle-safe ancestry off the remix tags and renders it
	 * as a user list matching the app's identity system: hex avatar with the
	 * ⚡ Lightning badge, ✓ NIP-05 check next to the handle, plus per-row zap /
	 * copy-link / open actions. Rows stay flat (no borders/shadows/boxed
	 * backgrounds) and pages in via "Show more" so 32-deep chains stay snappy.
	 *
	 * Query strategy: the sequential DAG walk is only as fast as its loader,
	 * so each ancestor's tags load from the primary read relay first (bounded
	 * wait) and fall back to every secondary relay queried in parallel.
	 */

	/** Rows revealed per "Show more" tap. */
	const PAGE_SIZE = 8;

	let {
		open = $bindable(false),
		reel = null
	}: {
		open?: boolean;
		reel?: { id: string; tags: string[][] } | null;
	} = $props();

	let loading = $state(false);
	let failed = $state(false);
	let chain = $state<RemixAncestor[]>([]);
	let truncated = $state(false);
	let visible = $state(PAGE_SIZE);
	/** Invalidates an in-flight walk when the dialog reopens. */
	let requestId = 0;

	// --- per-ancestor zap ------------------------------------------------
	type ZapTarget = {
		pubkey: string;
		eventId: string;
		lightningAddress: string;
	};

	let zapOpen = $state(false);
	// Keep the nested dialog's inputs as a plain snapshot. `NoteZapDialog` can
	// close asynchronously; passing a value derived from this dialog lets that
	// continuation read an inert derived after this dialog has been destroyed.
	let zapTarget = $state<ZapTarget | null>(null);

	function openZap(ancestor: RemixAncestor, lightningAddress: string) {
		zapTarget = {
			pubkey: ancestor.pubkey,
			eventId: ancestor.eventId,
			lightningAddress
		};
		zapOpen = true;
	}

	function closeZap() {
		zapOpen = false;
		zapTarget = null;
	}

	/**
	 * Load one ancestor's tags via the shared smart lookup: publisher relay
	 * hints first, then the primary read relay, then all remaining relays in
	 * parallel. A miss everywhere is the chain's natural end (pruned history
	 * degrades gracefully instead of erroring).
	 */
	function loadEventTags(eventId: string, hintUrls?: string[]): Promise<string[][] | null> {
		return lookupEventTags(eventId, hintUrls ?? []);
	}

	async function walk(source: { tags: string[][] }, request: number) {
		loading = true;
		failed = false;
		chain = [];
		truncated = false;
		visible = PAGE_SIZE;
		try {
			const result = await remixChainOf(source.tags, loadEventTags);
			if (request !== requestId) return;
			if (result.ok) {
				chain = result.chain;
				truncated = result.truncated;
				// Ancestor authors are rarely cached from normal scrolling —
				// batch-fetch their kind-0 metadata so avatars + badges resolve.
				void profiles.ensure(result.chain.map((ancestor) => ancestor.pubkey));
			} else {
				failed = true;
			}
		} catch {
			if (request === requestId) failed = true;
		} finally {
			if (request === requestId) loading = false;
		}
	}

	// A reopen (or a different reel while open) restarts the walk; state
	// writes inside `walk` are not tracked here so the effect stays cheap.
	$effect(() => {
		if (!open || !reel) return;
		const request = ++requestId;
		void walk(reel, request);
	});

	// The relay walk is intentionally best-effort and cannot be aborted, but its
	// result must not update this component after it has been unmounted.
	onDestroy(() => {
		requestId += 1;
	});

	async function copyAncestorLink(ancestor: RemixAncestor) {
		try {
			await navigator.clipboard.writeText(shareEntity({ eventId: ancestor.eventId }));
			toasts.success('Link copied');
		} catch {
			toasts.error('Could not copy link');
		}
	}
</script>

<Dialog bind:open title="Remix chain">
	{#if loading}
		<div
			class="flex items-center justify-center gap-2 py-10 text-[13px] font-semibold text-[var(--ui-text-muted)]"
		>
			<Icon name="i-lucide-loader-circle" class="size-4 animate-spin" />
			Tracing the chain…
		</div>
	{:else if failed}
		<div class="py-10 text-center text-[13px] leading-relaxed text-[var(--ui-text-muted)]">
			Couldn't read the full chain — the lineage loops or a relay failed.
			<br />Close and reopen to retry.
		</div>
	{:else if chain.length === 0}
		<div class="py-10 text-center text-[13px] text-[var(--ui-text-muted)]">
			No remix ancestry found on your relays.
		</div>
	{:else}
		<!-- Count header: flat, token-based — no boxed background or shadow -->
		<div class="mb-2 flex items-center gap-2 px-2">
			<span
				class="grid size-6 shrink-0 place-items-center rounded-full bg-primary-500/10 text-primary-500"
			>
				<Icon name="i-lucide-git-fork" class="size-3.5" />
			</span>
			<p class="min-w-0 text-[12px] leading-snug text-[var(--ui-text-muted)]">
				{chain.length} remix {chain.length === 1 ? 'source' : 'sources'} traced from this bitz
			</p>
		</div>

		<ol class="flex flex-col gap-0.5">
			{#each chain.slice(0, visible) as ancestor, i (ancestor.eventId)}
				{@const profile = profiles.get(ancestor.pubkey)}
				{@const name = profile?.display_name || profile?.name || 'Unknown creator'}
				{@const lightning = hasLightning(profile)}
				<li
					class="animate-rise relative flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-[var(--ui-bg-accented)] {i ===
					0
						? 'bg-primary-500/5'
						: ''}"
					style="animation-delay: {Math.min(i, 8) * 45}ms"
				>
					<a
						href="/profile/{ancestor.pubkey}"
						class="shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
						aria-label="Open {name}'s profile"
					>
						<Avatar
							pubkey={ancestor.pubkey}
							{name}
							picture={profile?.picture}
							{lightning}
							size={32}
						/>
					</a>
					<div class="min-w-0 flex-1">
						<div class="flex min-w-0 items-center gap-1">
							<a
								href="/profile/{ancestor.pubkey}"
								class="truncate text-[13px] font-bold text-[var(--ui-text-highlighted)] transition hover:text-primary-500"
							>
								{name}
							</a>
							{#if profile?.nip05}
								<Icon
									name="i-lucide-badge-check"
									class="size-3 shrink-0 text-primary-500"
									title="NIP-05 verified: {profile.nip05}"
								/>
							{/if}
						</div>
						<p class="text-[11px] text-[var(--ui-text-dimmed)]">
							{ancestor.depth === 0
								? 'Direct source'
								: `${ancestor.depth} step${ancestor.depth === 1 ? '' : 's'} back`}
						</p>
					</div>
					{#if i === 0}
						<span
							class="shrink-0 rounded-full bg-primary-500/15 px-2 py-0.5 text-[10px] font-bold text-primary-600"
						>
							Source
						</span>
					{/if}
					<div class="flex shrink-0 items-center gap-0.5">
						<button
							type="button"
							onclick={() => openZap(ancestor, profile?.lud16 || profile?.lud06 || '')}
							disabled={!lightning}
							title={lightning ? `Zap ${name}` : 'No Lightning address'}
							aria-label={lightning ? `Zap ${name}` : 'No Lightning address'}
							class="grid size-8 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-warm-500/15 hover:text-warm-500 disabled:pointer-events-none disabled:opacity-35"
						>
							<Icon name="i-lucide-zap" class="size-4" />
						</button>
						<button
							type="button"
							onclick={() => void copyAncestorLink(ancestor)}
							title="Copy link to source"
							aria-label="Copy link to this source bitz"
							class="grid size-8 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text-highlighted)]"
						>
							<Icon name="i-lucide-link" class="size-4" />
						</button>
						<a
							href="/note/{ancestor.eventId}"
							title="Open source bitz"
							aria-label="Open this source bitz"
							class="grid size-8 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text-highlighted)]"
						>
							<Icon name="i-lucide-arrow-up-right" class="size-4" />
						</a>
					</div>
				</li>
			{/each}
		</ol>

		{#if chain.length > visible}
			<div class="mt-3 flex justify-center">
				<button
					type="button"
					onclick={() => (visible = Math.min(chain.length, visible + PAGE_SIZE))}
					class="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--ui-border-muted)] px-4 text-[12px] font-bold text-[var(--ui-text-muted)] transition hover:border-primary-500 hover:text-primary-500"
				>
					<Icon name="i-lucide-chevron-down" class="size-4" />
					Show {Math.min(PAGE_SIZE, chain.length - visible)} more
				</button>
			</div>
		{/if}
		{#if truncated}
			<p class="mt-3 text-center text-[11px] text-[var(--ui-text-dimmed)]">
				Chain longer than 32 — oldest steps hidden.
			</p>
		{/if}
	{/if}
</Dialog>

<!-- This must be a sibling of Remix Chain, not part of Dialog's `children`
     snippet. The visible layer is portalled either way, but a child component
     is still owned by that snippet's effect and can otherwise be destroyed
     while the zap request is awaiting a relay or LNURL response. -->
{#if zapTarget}
	<NoteZapDialog
		bind:open={zapOpen}
		recipientPubkey={zapTarget.pubkey}
		lightningAddress={zapTarget.lightningAddress}
		eventId={zapTarget.eventId}
		dialogZIndex={110}
		onClose={closeZap}
	/>
{/if}
