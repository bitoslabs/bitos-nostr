<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import MenuDivider from '$lib/components/ui/MenuDivider.svelte';
	import MenuItem from '$lib/components/ui/MenuItem.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import MemeSharedSoundsPicker from './MemeSharedSoundsPicker.svelte';
	import MemeSoundCueList from './MemeSoundCueList.svelte';
	import MemeSoundSuggestions from './MemeSoundSuggestions.svelte';
	import type { MemeSuggestion } from '$lib/ai/suggest';
	import { identity } from '$lib/nostr/identity.svelte';
	import {
		CUSTOM_SOUND_KEY,
		MEME_SFX_IDS,
		type MemeSfxCue,
		type MemeSfxId
	} from '$lib/meme/schema';
	import { SFX_LABELS } from '$lib/meme/sound-catalog';
	import { soundIO } from '$lib/stores/meme-sound-io.svelte';
	import { sharedSoundsStore } from '$lib/stores/meme-shared-sounds.svelte';
	import { soundLibrary, type LibrarySound } from '$lib/stores/meme-sounds.svelte';
	import { formatDuration } from '$lib/utils/format';

	let {
		mediaKind,
		menuId,
		animated,
		cues,
		overlayCount,
		stageSeconds,
		busy,
		timelineActive,
		includeSourceAudio = $bindable(),
		analyzing,
		suggestions,
		onOpenStudio,
		onPreviewSynth,
		onAddSynth,
		onAddCustom,
		onRemoveLibrarySound,
		onImportAudio,
		onSyncCaptions,
		onBuildSuggestions,
		onApplySuggestion,
		onSeek,
		onRemoveCue
	}: {
		mediaKind: 'image' | 'video';
		menuId: string;
		animated: boolean;
		cues: MemeSfxCue[];
		overlayCount: number;
		stageSeconds: number;
		busy: boolean;
		timelineActive: boolean;
		includeSourceAudio: boolean;
		analyzing: boolean;
		suggestions: MemeSuggestion[];
		onOpenStudio: () => void;
		onPreviewSynth: (sfx: MemeSfxId) => void;
		onAddSynth: (sfx: MemeSfxId) => void;
		onAddCustom: (sound: LibrarySound) => void;
		onRemoveLibrarySound: (id: string) => void;
		onImportAudio: () => void;
		onSyncCaptions: () => void;
		onBuildSuggestions: () => void;
		onApplySuggestion: (suggestion: MemeSuggestion) => void;
		onSeek: (seconds: number) => void;
		onRemoveCue: (id: string) => void;
	} = $props();

	function cueLabel(cue: MemeSfxCue): string {
		if (cue.sfx !== CUSTOM_SOUND_KEY) return SFX_LABELS[cue.sfx];
		return soundLibrary.list.find((sound) => sound.id === cue.soundId)?.label ?? 'Custom';
	}

	function cueIcon(cue: MemeSfxCue): string {
		return cue.sfx === CUSTOM_SOUND_KEY ? 'i-lucide-mic' : 'i-lucide-music-2';
	}

	function previewCue(cue: MemeSfxCue): void {
		if (cue.sfx !== CUSTOM_SOUND_KEY) {
			onPreviewSynth(cue.sfx);
			return;
		}
		const sound = soundLibrary.list.find((item) => item.id === cue.soundId);
		if (sound) void soundIO.preview(sound);
	}
</script>

<div class="rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3.5 py-3">
	<div class="flex flex-wrap items-center gap-1.5">
		<p
			class="mr-auto flex min-w-0 items-center gap-1.5 text-[11px] font-bold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
		>
			<Icon name="i-lucide-audio-lines" class="size-3.5 shrink-0" />
			Sound
			{#if cues.length}
				<span
					class="rounded-full bg-warm-500/15 px-1.5 font-mono text-[10px] font-bold text-warm-600 normal-case"
				>
					{cues.length}
				</span>
			{/if}
			{#if mediaKind === 'image' && !animated && cues.length === 0}
				<span
					class="flex items-center gap-1 rounded-full bg-[var(--ui-bg-accented)] px-1.5 py-0.5 text-[9.5px] font-bold text-[var(--ui-text-muted)] normal-case"
					title="Adding a sound cue makes this ship as a video with audio"
				>
					<Icon name="i-lucide-clapperboard" class="size-3" />
					+ sound = video
				</span>
			{/if}
		</p>
		<button
			type="button"
			disabled={busy}
			onclick={onOpenStudio}
			title="Browse, preview and fine-tune every sound cue"
			class="flex items-center gap-1 rounded-full bg-primary-500/10 px-2.5 py-1 text-[11px] font-bold text-primary-600 transition hover:bg-primary-500/20 disabled:opacity-40"
		>
			<Icon name="i-lucide-audio-lines" class="size-3.5" />
			Sound studio
		</button>
		{#if mediaKind === 'video'}
			<button
				type="button"
				disabled={busy}
				onclick={() => (includeSourceAudio = !includeSourceAudio)}
				aria-pressed={includeSourceAudio}
				title={includeSourceAudio
					? 'The clip’s own audio is included in the export'
					: 'The clip’s own audio is dropped — only sound cues export'}
				class="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition disabled:opacity-40 {includeSourceAudio
					? 'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20'
					: 'bg-[var(--ui-bg-accented)] text-[var(--ui-text-dimmed)] hover:bg-[var(--ui-bg-muted)]'}"
			>
				<Icon
					name={includeSourceAudio ? 'i-lucide-volume-2' : 'i-lucide-volume-x'}
					class="size-3.5"
				/>
				Video audio {includeSourceAudio ? 'on' : 'off'}
			</button>
		{/if}
		<Popover
			id={menuId}
			float
			placement="top-start"
			width="auto"
			label="Add sound effect"
			triggerClass="flex items-center gap-1 rounded-full bg-warm-500/10 px-2.5 py-1 text-[11px] font-bold text-warm-600 transition hover:bg-warm-500/20"
			triggerActiveClass="bg-warm-500/20"
		>
			{#snippet trigger()}
				<Icon name="i-lucide-music-plus" class="size-3.5" />
				Add sound @ {formatDuration(stageSeconds)}
			{/snippet}
			<div class="max-h-80 scrollbar-thin overflow-y-auto">
				{#each MEME_SFX_IDS as sfxId (sfxId)}
					<MenuItem
						onclick={() => {
							onPreviewSynth(sfxId);
							onAddSynth(sfxId);
						}}
					>
						{SFX_LABELS[sfxId]}
					</MenuItem>
				{/each}
				{#if soundLibrary.list.length}
					<MenuDivider />
					{#each soundLibrary.list as sound (sound.id)}
						<MenuItem
							onclick={() => {
								void soundIO.preview(sound);
								onAddCustom(sound);
							}}
						>
							<span class="flex min-w-0 items-center gap-2">
								<Icon
									name={sound.source === 'mic' ? 'i-lucide-mic' : 'i-lucide-file-audio'}
									class="size-3.5 shrink-0 text-[var(--ui-text-dimmed)]"
								/>
								<span class="min-w-0">
									<span class="block truncate">{sound.label}</span>
									<span class="block text-[10.5px] text-[var(--ui-text-dimmed)]">
										{sound.durationSec.toFixed(1)}s · custom · cues at {formatDuration(
											stageSeconds
										)}
									</span>
								</span>
							</span>
							{#snippet trailing()}
								<span class="flex items-center">
									<button
										type="button"
										class="rounded-md p-1 text-[var(--ui-text-dimmed)] transition hover:bg-[var(--ui-bg-muted)] hover:text-primary-600"
										aria-label={`Share ${sound.label} with other creators`}
										title="Publish as a kind-30078 shared sound"
										disabled={sharedSoundsStore.sharingId === sound.id ||
											!!sharedSoundsStore.sharingId}
										onclick={(event) => {
											event.stopPropagation();
											void sharedSoundsStore.share(sound.id);
										}}
									>
										<Icon
											name={sharedSoundsStore.sharingId === sound.id
												? 'i-lucide-loader-circle'
												: 'i-lucide-share-2'}
											class="size-3.5 {sharedSoundsStore.sharingId === sound.id
												? 'animate-spin'
												: ''}"
										/>
									</button>
									<button
										type="button"
										class="rounded-md p-1 text-[var(--ui-text-dimmed)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--tone-error-text)]"
										aria-label={`Delete ${sound.label} from this device`}
										title="Delete from this device"
										onclick={(event) => {
											event.stopPropagation();
											onRemoveLibrarySound(sound.id);
										}}
									>
										<Icon name="i-lucide-trash-2" class="size-3.5" />
									</button>
								</span>
							{/snippet}
						</MenuItem>
					{/each}
				{/if}
				<MenuDivider />
				<MenuItem icon="i-lucide-upload" onclick={onImportAudio}>
					Import audio from device…
				</MenuItem>
				<MenuItem icon="i-lucide-mic" onclick={() => void soundIO.toggleMic()}>
					<span class="flex items-center gap-1">
						{soundIO.recording ? 'Stop recording · save' : 'Record with mic…'}
						{#if soundIO.micDenied && !soundIO.recording}
							<Icon name="i-lucide-alert-circle" class="size-3 text-[var(--tone-error-text)]" />
						{/if}
					</span>
				</MenuItem>
			</div>
		</Popover>
		<MemeSharedSoundsPicker
			sounds={sharedSoundsStore.list}
			loading={sharedSoundsStore.loading}
			importingId={sharedSoundsStore.importingId}
			currentPubkey={identity.current?.pk}
			onRefresh={() => void sharedSoundsStore.load()}
			onImport={(sound) => void sharedSoundsStore.import(sound)}
		/>
		{#if cues.length && overlayCount}
			<button
				type="button"
				onclick={onSyncCaptions}
				disabled={busy}
				title="Each caption appears with its own sound cue"
				class="flex items-center gap-1 rounded-full bg-[var(--ui-bg-accented)] px-2.5 py-1 text-[11px] font-bold text-[var(--ui-text-muted)] transition hover:bg-warm-500/15 hover:text-warm-600 disabled:opacity-40"
			>
				<Icon name="i-lucide-captions" class="size-3.5" />
				Sync captions
			</button>
		{/if}
		<MemeSoundSuggestions
			{busy}
			{analyzing}
			groups={suggestions}
			onBuild={onBuildSuggestions}
			onApply={onApplySuggestion}
		/>
	</div>
	<MemeSoundCueList
		{cues}
		{busy}
		{timelineActive}
		labelFor={cueLabel}
		iconFor={cueIcon}
		{onSeek}
		onPreview={previewCue}
		onRemove={onRemoveCue}
	/>
</div>
