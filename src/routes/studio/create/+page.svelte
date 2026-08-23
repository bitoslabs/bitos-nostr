<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { popovers } from '$lib/stores/popovers.svelte';
	import { studioHandoff, type CreateTab } from '$lib/stores/studio-handoff.svelte';
	import MemeStudio, { type RemixHandoff } from '$lib/components/bitz/MemeStudio.svelte';
	import BitzComposer from '$lib/components/bitz/BitzComposer.svelte';

	/**
	 * /studio/create — the full-page studio editor: one surface rendered at a
	 * time as a real page (no dialogs), with the tab bar owning navigation.
	 *
	 * - Tabs are URL-driven (`?tab=meme|bitz`) so any surface can deep-link:
	 *   QR codes, share sheet, the home composer, /bitz remix…
	 * - A pending `studioHandoff` (remix / resume-slot / template) seeds the
	 *   tab once on mount and wins over the URL param.
	 * - ESC/back returns to the studio home (/studio) — never the feed — so
	 *   creators stay in the production loop.
	 * - Studios render in `full` mode: no overlay chrome of their own.
	 */

	const pending = studioHandoff.take();
	const paramTab = page.url.searchParams.get('tab');
	const initial: CreateTab =
		pending?.tab ?? (paramTab === 'bitz' ? 'bitz' : paramTab === 'meme' ? 'meme' : 'meme');

	let tab = $state<CreateTab>(initial);
	// The initial surface must actually open on mount (the tab bar only
	// drives *switches* — a fresh deep-link would otherwise render a blank editor).
	let memeOpen = $state(initial === 'meme');
	let bitzOpen = $state(initial === 'bitz');
	// A remix handoff seeds the meme studio once (one-shot: this intentionally
	// captures the pending value at mount, not reactively).
	let remixPayload: RemixHandoff | null = pending?.remix
		? ({
				eventId: pending.remix.eventId,
				pubkey: pending.remix.pubkey,
				label: pending.remix.label,
				mediaUrl: pending.remix.mediaUrl,
				mediaType: pending.remix.mediaType,
				overlays: pending.remix.overlays as RemixHandoff['overlays'],
				sfxCues: pending.remix.sfxCues as RemixHandoff['sfxCues'],
				imageLayers: pending.remix.imageLayers as RemixHandoff['imageLayers'],
				relays: pending.remix.relays
			} satisfies RemixHandoff)
		: null;
	let pendingTemplate = $state(pending?.template ?? null);
	let pendingSlotId = $state(pending?.resumeSlotId ?? null);

	function syncTab(next: CreateTab) {
		popovers.close();
		// Close the current studio cleanly before switching surfaces.
		if (tab === 'meme') memeOpen = false;
		if (tab === 'bitz') bitzOpen = false;
		tab = next;
		if (next === 'meme') memeOpen = true;
		if (next === 'bitz') bitzOpen = true;
		void goto(`/studio/create?tab=${next}`, { keepFocus: true, noScroll: true });
	}

	/** Published + batch queue empty → back to the studio home. */
	function afterPost() {
		pendingTemplate = null;
		pendingSlotId = null;
		goto('/studio', { noScroll: true });
	}

	function exitStudio() {
		popovers.close();
		goto('/studio');
	}

	const tabs: { key: CreateTab; label: string; icon: string }[] = [
		{ key: 'bitz', label: 'Bitz video', icon: 'i-lucide-circle-play' },
		{ key: 'meme', label: 'Meme studio', icon: 'i-lucide-laugh' }
	];
</script>

<svelte:head>
	<title>Studio · BitOS</title>
</svelte:head>

<svelte:window
	onkeydown={(event) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			exitStudio();
		}
	}}
/>

<div class="flex h-full min-h-0 flex-col">
	<!-- Studio chrome: brand-lite header + surface tabs -->
	<header
		class="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-2 sm:px-3"
	>
		<button
			type="button"
			onclick={exitStudio}
			aria-label="Back to studio home"
			class="grid size-9 shrink-0 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] active:scale-95"
		>
			<Icon name="i-lucide-chevron-left" class="size-5" />
		</button>
		<nav class="flex min-w-0 flex-1 items-center gap-1" aria-label="Studio surfaces">
			{#each tabs as t (t.key)}
				<button
					type="button"
					onclick={() => syncTab(t.key)}
					aria-current={tab === t.key ? 'page' : undefined}
					class="flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-bold transition {tab ===
					t.key
						? t.key === 'meme'
							? 'bg-warm-500/15 text-warm-600'
							: 'bg-primary-500/15 text-primary-600'
						: 'text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]'}"
				>
					<Icon name={t.icon} class="size-4" />
					<span class="hidden sm:inline">{t.label}</span>
				</button>
			{/each}
		</nav>
		<a
			href="/studio"
			aria-label="Studio home"
			class="grid size-9 shrink-0 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]"
		>
			<Icon name="i-lucide-layout-grid" class="size-4.5" />
		</a>
	</header>

	<!-- The active studio fills the rest of the route -->
	<div class="min-h-0 flex-1">
		{#if tab === 'meme'}
			<MemeStudio
				bind:open={memeOpen}
				remixHandoff={remixPayload}
				onposted={afterPost}
				templateHandoff={pendingTemplate}
				slotHandoff={pendingSlotId}
				full
			/>
		{:else}
			<BitzComposer bind:open={bitzOpen} onposted={afterPost} full />
		{/if}
	</div>
</div>
