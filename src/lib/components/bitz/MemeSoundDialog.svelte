<script lang="ts">
	import { SvelteMap } from 'svelte/reactivity';
	import type { Snippet } from 'svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { CUSTOM_SOUND_KEY, type MemeSfxCue, type MemeSfxId } from '$lib/meme/schema';
	import {
		entryForCue,
		filterEntries,
		groupEntries,
		retimeCue,
		setCueAt,
		sortCues,
		synthEntries,
		type SoundEntry
	} from '$lib/meme/sound-catalog';

	/**
	 * Sound studio dialog: one place to browse every cue source (synth
	 * soundboard, personal library, shared sounds), preview any entry with a
	 * click, and fine-tune the cue sheet (time, gain, delete). Pure display +
	 * intent — playback and state mutations stay in MemeStudio via props so
	 * the exported meme pipeline is untouched.
	 */
	let {
		open = $bindable(false),
		cues = $bindable([]),
		labels,
		durations,
		libraryLabel,
		libraryDuration,
		sharedSounds = [],
		stageSeconds = 0,
		durationSec = 0,
		busy = false,
		maxCues = 16,
		waveform,
		onPreviewSynth,
		onPreviewLibrary,
		onAddSynth,
		onAddLibrary
	}: {
		open?: boolean;
		cues?: MemeSfxCue[];
		labels: Record<MemeSfxId, string>;
		durations: Record<MemeSfxId, number>;
		libraryLabel: (soundId: string) => string | undefined;
		libraryDuration: (soundId: string) => number | undefined;
		sharedSounds?: { id: string; label: string; durationSec: number; soundId?: string }[];
		stageSeconds?: number;
		durationSec?: number;
		busy?: boolean;
		maxCues?: number;
		/** Optional audio-map rendering (AI-001 anchors) above the cue sheet. */
		waveform?: Snippet;
		onPreviewSynth: (sfx: MemeSfxId) => void;
		onPreviewLibrary: (soundId: string) => void;
		onAddSynth: (sfx: MemeSfxId) => void;
		onAddLibrary: (soundId: string) => void;
	} = $props();

	let query = $state('');
	/** Entry id currently playing (for the equalizer indicator). */
	let playingId = $state('');

	const synth = $derived(synthEntries(labels, durations));
	const library: SoundEntry[] = $derived.by(() => {
		const seen = new SvelteMap<string, SoundEntry>();
		for (const cue of cues) {
			if (cue.sfx !== CUSTOM_SOUND_KEY || !cue.soundId) continue;
			const label = libraryLabel(cue.soundId);
			if (!label) continue;
			seen.set(cue.soundId, {
				id: `library:${cue.soundId}`,
				source: 'library',
				label,
				durationSec: libraryDuration(cue.soundId) ?? 1,
				soundId: cue.soundId
			});
		}
		return [...seen.values()];
	});
	const shared: SoundEntry[] = $derived(
		sharedSounds.map((s) => ({
			id: `shared:${s.id}`,
			source: 'shared' as const,
			label: s.label,
			durationSec: s.durationSec,
			soundId: s.soundId
		}))
	);
	const groups = $derived.by(() => {
		const q = query.trim();
		if (!q) return groupEntries(synth, library, shared);
		// While searching, merge into one flat section — the user is hunting
		// by name, not browsing by shelf.
		const all = filterEntries([...synth, ...library, ...shared], q);
		return all.length ? [{ id: 'synth' as const, label: 'Results', entries: all }] : [];
	});
	const sortedCues = $derived(sortCues(cues));
	const cueFull = $derived(cues.length >= maxCues);

	function fmt(sec: number): string {
		if (!Number.isFinite(sec) || sec < 0) return '0:00';
		const m = Math.floor(sec / 60);
		const s = Math.floor(sec % 60);
		return `${m}:${String(s).padStart(2, '0')}`;
	}

	function preview(entry: SoundEntry) {
		playingId = entry.id;
		window.setTimeout(
			() => {
				if (playingId === entry.id) playingId = '';
			},
			Math.max(400, entry.durationSec * 1000)
		);
		if (entry.source === 'library' || entry.source === 'shared') {
			if (entry.soundId) onPreviewLibrary(entry.soundId);
		} else if (entry.id.startsWith('synth:')) {
			onPreviewSynth(entry.id.slice(6) as MemeSfxId);
		}
	}

	function add(entry: SoundEntry) {
		if (cueFull) return;
		if ((entry.source === 'library' || entry.source === 'shared') && entry.soundId) {
			onAddLibrary(entry.soundId);
		} else if (entry.id.startsWith('synth:')) {
			onAddSynth(entry.id.slice(6) as MemeSfxId);
		}
		preview(entry);
	}

	function cueEntry(cue: MemeSfxCue): SoundEntry | null {
		return entryForCue(cue, labels, durations, libraryLabel, libraryDuration);
	}

	function nudge(cue: MemeSfxCue, deltaMs: number) {
		cues = retimeCue(cues, cue.id, deltaMs);
	}

	function capAt(cue: MemeSfxCue, atMs: number) {
		cues = setCueAt(cues, cue.id, Math.min(atMs, durationSec > 0 ? durationSec * 1000 : atMs));
	}

	function setGain(cue: MemeSfxCue, gain: number) {
		const g = Number.isFinite(gain) ? Math.min(1, Math.max(0, gain)) : cue.gain;
		cues = cues.map((c) => (c.id === cue.id ? { ...c, gain: g } : c));
	}

	function removeCue(cue: MemeSfxCue) {
		cues = cues.filter((c) => c.id !== cue.id);
	}
</script>

<Dialog bind:open title="Sound studio">
	<div class="flex flex-col gap-3">
		<input
			type="search"
			bind:value={query}
			placeholder="Search sounds…"
			aria-label="Search sounds"
			class="h-9 w-full rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-3 text-[12.5px] outline-none placeholder:text-[var(--ui-text-dimmed)] focus:border-warm-500"
		/>

		<!-- Cue sheet first: what's already staged (editable in place). -->
		<div class="flex flex-col gap-3">
			{#if waveform}
				<!-- Energy/silence/peaks under the cue times (AI-001 anchors) -->
				<div>
					<p
						class="mb-1 text-[11px] font-bold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
					>
						Audio map
					</p>
					{@render waveform()}
				</div>
			{/if}
			{#if sortedCues.length}
				<section aria-label="Cue sheet">
					<p
						class="mb-1 flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
					>
						<Icon name="i-lucide-list-music" class="size-3.5" />
						Cue sheet · {sortedCues.length}/{maxCues}
					</p>
					<ul class="flex flex-col gap-1">
						{#each sortedCues as cue (cue.id)}
							{@const entry = cueEntry(cue)}
							<li
								class="flex items-center gap-2 rounded-lg bg-[var(--ui-bg-muted)] px-2.5 py-1.5 text-[12px]"
							>
								<button
									type="button"
									class="grid size-7 shrink-0 place-items-center rounded-full bg-warm-500/10 text-warm-600 transition hover:bg-warm-500/20"
									aria-label={`Play ${entry?.label ?? 'cue'}`}
									onclick={() => (entry ? preview(entry) : undefined)}
								>
									<Icon name="i-lucide-play" class="size-3.5" />
								</button>
								<span class="min-w-0 flex-1">
									<span class="block truncate font-semibold">
										{entry?.label ?? 'Missing sound'}
										{#if !entry}
											<span class="text-[var(--tone-error-text)]">(deleted)</span>
										{/if}
									</span>
									<span class="text-[10.5px] text-[var(--ui-text-dimmed)] tabular-nums">
										@ {fmt(cue.atMs / 1000)} · {Math.round(cue.gain * 100)}% vol
									</span>
								</span>
								<span class="flex shrink-0 items-center gap-0.5">
									<button
										type="button"
										title="Earlier −0.1s"
										aria-label="Move cue earlier"
										disabled={busy}
										onclick={() => nudge(cue, -100)}
										class="rounded-md p-1 text-[var(--ui-text-dimmed)] transition hover:bg-[var(--ui-bg)] hover:text-[var(--ui-text)] disabled:opacity-40"
									>
										<Icon name="i-lucide-chevron-left" class="size-3.5" />
									</button>
									<button
										type="button"
										title="Later +0.1s"
										aria-label="Move cue later"
										disabled={busy}
										onclick={() => nudge(cue, 100)}
										class="rounded-md p-1 text-[var(--ui-text-dimmed)] transition hover:bg-[var(--ui-bg)] hover:text-[var(--ui-text)] disabled:opacity-40"
									>
										<Icon name="i-lucide-chevron-right" class="size-3.5" />
									</button>
									<button
										type="button"
										title={'Cue at playhead ' + fmt(stageSeconds)}
										aria-label="Set cue at playhead"
										disabled={busy}
										onclick={() => capAt(cue, stageSeconds * 1000)}
										class="rounded-md p-1 text-[var(--ui-text-dimmed)] transition hover:bg-[var(--ui-bg)] hover:text-warm-600 disabled:opacity-40"
									>
										<Icon name="i-lucide-crosshair" class="size-3.5" />
									</button>
									<button
										type="button"
										title="Quieter"
										aria-label="Quieter"
										disabled={busy || cue.gain <= 0}
										onclick={() => setGain(cue, cue.gain - 0.25)}
										class="rounded-md p-1 text-[var(--ui-text-dimmed)] transition hover:bg-[var(--ui-bg)] hover:text-[var(--ui-text)] disabled:opacity-40"
									>
										<Icon name="i-lucide-volume-1" class="size-3.5" />
									</button>
									<button
										type="button"
										title="Louder"
										aria-label="Louder"
										disabled={busy || cue.gain >= 1}
										onclick={() => setGain(cue, cue.gain + 0.25)}
										class="rounded-md p-1 text-[var(--ui-text-dimmed)] transition hover:bg-[var(--ui-bg)] hover:text-[var(--ui-text)] disabled:opacity-40"
									>
										<Icon name="i-lucide-volume-2" class="size-3.5" />
									</button>
									<button
										type="button"
										aria-label={`Remove ${entry?.label ?? 'cue'}`}
										disabled={busy}
										onclick={() => removeCue(cue)}
										class="rounded-md p-1 text-[var(--ui-text-dimmed)] transition hover:bg-[var(--ui-bg)] hover:text-[var(--tone-error-text)] disabled:opacity-40"
									>
										<Icon name="i-lucide-trash-2" class="size-3.5" />
									</button>
								</span>
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		</div>
		<!-- Catalog: browse by group or search flat. -->
		<section aria-label="Sound library">
			{#each groups as group (group.id)}
				<div class="mb-2">
					<p
						class="mb-1 flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
					>
						<Icon
							name={group.id === 'library'
								? 'i-lucide-library'
								: group.id === 'shared'
									? 'i-lucide-share-2'
									: 'i-lucide-audio-lines'}
							class="size-3.5"
						/>
						{group.label}
					</p>
					<ul class="grid grid-cols-2 gap-1">
						{#each group.entries as entry (entry.id)}
							<li>
								<div
									class="group flex items-center gap-1.5 rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-2 py-1.5 transition hover:border-warm-500/50"
								>
									<button
										type="button"
										class="grid size-7 shrink-0 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-warm-500/10 hover:text-warm-600"
										aria-label={`Preview ${entry.label}`}
										onclick={() => preview(entry)}
									>
										{#if playingId === entry.id}
											<Icon
												name="i-lucide-audio-lines"
												class="size-3.5 animate-pulse text-warm-500"
											/>
										{:else}
											<Icon name="i-lucide-play" class="size-3.5" />
										{/if}
									</button>
									<button
										type="button"
										class="min-w-0 flex-1 text-left"
										disabled={cueFull}
										title={cueFull ? 'Cue cap reached' : `Add ${entry.label} at playhead`}
										onclick={() => add(entry)}
									>
										<span class="block truncate text-[12px] font-semibold">
											{entry.label}
										</span>
										<span class="block text-[10px] text-[var(--ui-text-dimmed)] tabular-nums">
											{entry.durationSec.toFixed(1)}s · {entry.source === 'synth'
												? 'soundboard'
												: entry.source}
										</span>
									</button>
									<button
										type="button"
										class="grid size-6 shrink-0 place-items-center rounded-full bg-warm-500/10 text-warm-600 opacity-0 transition group-hover:opacity-100 disabled:opacity-30"
										disabled={cueFull}
										aria-label={`Add ${entry.label}`}
										onclick={() => add(entry)}
									>
										<Icon name="i-lucide-plus" class="size-3.5" />
									</button>
								</div>
							</li>
						{/each}
					</ul>
				</div>
			{:else}
				<p class="py-6 text-center text-[12px] text-[var(--ui-text-dimmed)]">
					No sounds match “{query}”.
				</p>
			{/each}
		</section>

		<p class="flex items-center gap-1.5 text-[10.5px] text-[var(--ui-text-dimmed)]">
			<Icon name="i-lucide-info" class="size-3 shrink-0" />
			Cues stage at the playhead ({fmt(stageSeconds)}) — preview anything before you commit.
		</p>
	</div>
</Dialog>
