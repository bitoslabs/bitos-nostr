<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { popovers } from '$lib/stores/popovers.svelte';
	import { createMediaQuery } from '$lib/utils/media-query.svelte';
	import {
		studioHandoff,
		type CreateTab,
		type StudioSoundSeed
	} from '$lib/stores/studio-handoff.svelte';
	import MemeStudio, { type RemixHandoff } from '$lib/components/bitz/MemeStudio.svelte';
	import BitzComposer from '$lib/components/bitz/BitzComposer.svelte';
	import StudioMobileEditor from '$lib/components/studio/mobile/StudioMobileEditor.svelte';

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
				zoomWindows: pending.remix.zoomWindows as RemixHandoff['zoomWindows'] | undefined,
				fxWindows: pending.remix.fxWindows as RemixHandoff['fxWindows'] | undefined,
				speedWindows: pending.remix.speedWindows as RemixHandoff['speedWindows'] | undefined,
				relays: pending.remix.relays
			} satisfies RemixHandoff)
		: null;
	let pendingTemplate = $state(pending?.template ?? null);
	let pendingSlotId = $state(pending?.resumeSlotId ?? null);
	let pendingSound: StudioSoundSeed | null = $state(pending?.soundSeed ?? null);

	// Mobile-native shell (docs/studio-mobile-ux.md): auto-selected on narrow
	// viewports, forced with `?shell=app` (desktop preview / QA) and overridden
	// back to the desktop 3-pane with `?shell=full`.
	const narrowViewport = createMediaQuery('(max-width: 1023px)');
	const shellParam = $derived(page.url.searchParams.get('shell'));
	const appShell = $derived(
		shellParam === 'app' ? true : shellParam === 'full' ? false : narrowViewport.current
	);

	/** Editor URL for a surface — keeps the `shell` override across tab switches. */
	function studioUrl(next: CreateTab): string {
		const shell = shellParam === 'app' || shellParam === 'full' ? `&shell=${shellParam}` : '';
		return `/studio/create?tab=${next}${shell}`;
	}

	function syncTab(next: CreateTab) {
		popovers.close();
		// Close the current studio cleanly before switching surfaces.
		if (tab === 'meme') memeOpen = false;
		if (tab === 'bitz') bitzOpen = false;
		tab = next;
		if (next === 'meme') memeOpen = true;
		if (next === 'bitz') bitzOpen = true;
		void goto(studioUrl(next), { keepFocus: true, noScroll: true });
	}

	/** Published + batch queue empty → back to the studio home. */
	function afterPost() {
		pendingTemplate = null;
		pendingSlotId = null;
		pendingSound = null;
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
			// Native feel: with a bottom sheet open (`?panel=` / `?edit=`), back/ESC
			// closes the sheet instead of leaving the editor.
			if (page.url.searchParams.get('panel') || page.url.searchParams.get('edit')) {
				history.back();
				return;
			}
			exitStudio();
		}
	}}
/>

<div class="flex h-full min-h-0 flex-col">
	<!-- Studio chrome: brand-lite header + surface tabs. The mobile meme shell
	     owns its whole chrome (native top bar + mode switcher), so this hides. -->
	{#if !(tab === 'meme' && appShell)}
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
	{/if}

	<!-- The active studio fills the rest of the route -->
	<div class="min-h-0 flex-1">
		{#if tab === 'meme' && appShell}
			<!-- Mobile-native shell (docs/studio-mobile-ux.md) -->
			<StudioMobileEditor
				onexit={exitStudio}
				onposted={afterPost}
				remixHandoff={remixPayload}
				templateHandoff={pendingTemplate}
				slotHandoff={pendingSlotId}
			/>
		{:else if tab === 'meme'}
			<MemeStudio
				bind:open={memeOpen}
				remixHandoff={remixPayload}
				onposted={afterPost}
				templateHandoff={pendingTemplate}
				slotHandoff={pendingSlotId}
				soundHandoff={pendingSound}
			/>
		{:else}
			<BitzComposer bind:open={bitzOpen} onposted={afterPost} full />
		{/if}
	</div>
</div>
