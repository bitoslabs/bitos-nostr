<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import { queryPrimaryFirst } from '$lib/nostr/pool';
	import { NOSTR_KINDS } from '$lib/nostr/types';
	import { SFX_RECIPES } from '$lib/meme/sfx';
	import type { MemeSfxId } from '$lib/meme/schema';
	import { SFX_LABELS as labels } from '$lib/meme/sound-catalog';
	import { rankTrendingSounds, type TrendingSound } from '$lib/meme/trending';
	import { studioHandoff } from '$lib/stores/studio-handoff.svelte';

	/**
	 * Trending sounds (#4 of the meme-virality recs). Ranks the synth SFX ids
	 * by real usage: it queries recent bitz media events carrying the `meme`
	 * tag (the remix-chain wire payload) and counts cue usage with a 3-day
	 * half-life recency decay. Custom sounds are device-local and never rank.
	 */

	let loading = $state(true);
	let sounds = $state<TrendingSound[]>([]);

	const WINDOW_HOURS = 48;
	const MAX_EVENTS = 500;

	/** Top ranked sfx ids the composer can one-tap cue. */
	let previewing = $state<MemeSfxId | null>(null);

	async function load() {
		loading = true;
		try {
			const since = Math.floor(Date.now() / 1000) - WINDOW_HOURS * 3600;
			const events = await queryPrimaryFirst(
				[
					{
						kinds: [NOSTR_KINDS.PICTURE, NOSTR_KINDS.VIDEO, NOSTR_KINDS.SHORT_VIDEO],
						'#meme': [],
						since
					}
				],
				{}
			);
			sounds = rankTrendingSounds(events.slice(0, MAX_EVENTS));
		} catch {
			sounds = [];
		} finally {
			loading = false;
		}
	}

	/** Audition one sound with the same synth pipeline the studio uses. */
	function preview(sfx: MemeSfxId) {
		previewing = sfx;
		void (async () => {
			const { renderSfxTrack, scheduleSfx } = await import('$lib/meme/sfx');
			const duration = SFX_RECIPES[sfx].duration + 0.25;
			const schedule = scheduleSfx([{ id: 'p', sfx, atMs: 0, gain: 1 }], duration);
			const OfflineCtx = window.OfflineAudioContext;
			const AudioCtx = window.AudioContext;
			if (!OfflineCtx || !AudioCtx) {
				previewing = null;
				return;
			}
			try {
				const buffer = await renderSfxTrack(schedule, duration, OfflineCtx);
				const ctx = new AudioCtx();
				const source = ctx.createBufferSource();
				source.buffer = buffer;
				source.connect(ctx.destination);
				source.start();
				source.onended = () => {
					void ctx.close().catch(() => undefined);
					previewing = previewing === sfx ? null : previewing;
				};
			} catch {
				previewing = null;
			}
		})();
	}

	onMount(load);

	/** "Hear it → use it": stage the sound in the Meme Studio as the first
	 *  cue (studio handoff — no studio bytes on this page's bundle). */
	function useSound(sfx: MemeSfxId) {
		void studioHandoff.useSound({
			kind: 'synth',
			id: sfx,
			label: labels[sfx] ?? sfx
		});
	}
</script>

<PageHeader title="Trending sounds">
	{#snippet actions()}
		<a
			href="/more"
			aria-label="Back to More"
			class="grid size-9 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]"
		>
			<Icon name="i-lucide-arrow-left" class="size-5" />
		</a>
	{/snippet}
</PageHeader>
<div class="mx-auto w-full max-w-xl px-4 pt-4 pb-24">
	<p class="mb-4 flex items-center gap-1.5 text-[13px] leading-relaxed text-[var(--ui-text-muted)]">
		<Icon name="i-lucide-audio-lines" class="size-4 shrink-0 text-warm-500" />
		Most-remixed meme sounds across the Bitz feed — live from relays, ranked by fresh usage.
	</p>

	{#if loading}
		<div class="flex flex-col gap-2">
			{#each [0, 1, 2, 3, 4, 5] as i (i)}
				<div class="h-16 animate-pulse rounded-2xl bg-[var(--ui-bg-muted)]"></div>
			{/each}
		</div>
	{:else if sounds.length}
		<ol class="flex flex-col gap-2">
			{#each sounds as sound, i (sound.sfx)}
				<li
					class="flex items-center gap-3 rounded-2xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-4 py-3"
				>
					<span
						class="grid size-9 shrink-0 place-items-center rounded-xl text-[15px] font-black {i ===
						0
							? 'bg-warm-500 text-white'
							: 'bg-[var(--ui-bg-muted)] text-[var(--ui-text-muted)]'}"
					>
						{i + 1}
					</span>
					<div class="min-w-0 flex-1">
						<p class="text-[14px] font-bold text-[var(--ui-text)]">
							{labels[sound.sfx] ?? sound.sfx}
						</p>
						<p class="text-[12px] text-[var(--ui-text-muted)]">
							{sound.uses}
							{sound.uses === 1 ? 'meme' : 'memes'} · {sound.authors}
							{sound.authors === 1 ? 'creator' : 'creators'}
						</p>
					</div>
					<button
						type="button"
						onclick={() => preview(sound.sfx)}
						aria-label={`Preview ${labels[sound.sfx] ?? sound.sfx}`}
						class="grid size-9 place-items-center rounded-full bg-warm-500/10 text-warm-600 transition hover:bg-warm-500/20 active:scale-95"
					>
						<Icon
							name={previewing === sound.sfx ? 'i-lucide-pause' : 'i-lucide-play'}
							class="size-4"
						/>
					</button>
					<button
						type="button"
						onclick={() => useSound(sound.sfx)}
						aria-label={`Use ${labels[sound.sfx] ?? sound.sfx} in the Meme Studio`}
						class="grid h-9 shrink-0 place-items-center rounded-full bg-warm-500 px-3 text-[12px] font-bold text-white transition hover:brightness-110 active:scale-95"
					>
						Use
					</button>
				</li>
			{/each}
		</ol>
	{:else}
		<div
			class="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-[var(--ui-border-accented)] px-6 py-10 text-center"
		>
			<span class="grid size-14 place-items-center rounded-2xl bg-warm-500/10 text-warm-500">
				<Icon name="i-lucide-audio-lines" class="size-7" />
			</span>
			<div>
				<p class="text-[15px] font-bold text-[var(--ui-text)]">No trending sounds yet</p>
				<p class="mt-1 text-[13px] leading-relaxed text-[var(--ui-text-muted)]">
					Publish a meme with sound cues from the Meme Studio — usage is counted live from the Bitz
					feed.
				</p>
			</div>
			<a
				href="/bitz"
				class="inline-flex items-center gap-1.5 rounded-full bg-warm-500 px-4 py-2 text-[12.5px] font-bold text-white transition hover:brightness-110 active:scale-95"
			>
				<Icon name="i-lucide-laugh" class="size-4" />
				Make a meme
			</a>
		</div>
	{/if}
</div>
