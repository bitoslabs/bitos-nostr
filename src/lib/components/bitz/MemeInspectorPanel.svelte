<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import MemeImageLayersCard from './MemeImageLayersCard.svelte';
	import MemeCaptionOverlayList from './MemeCaptionOverlayList.svelte';
	import MemeArtboardCard from './MemeArtboardCard.svelte';
	import MemeTrimPanel from './MemeTrimPanel.svelte';
	import MemeSoundPanel from './MemeSoundPanel.svelte';
	import { cueTrackDurationSec } from '$lib/meme/cue-track';
	import type { MemeImageOverlay } from '$lib/meme/image-overlay';
	import type { MemeTextOverlay } from '$lib/meme/schema';
	import type { MemeSfxCue, MemeSfxId } from '$lib/meme/schema';
	import type { MemeSuggestion } from '$lib/ai/suggest';
	import type { SmartResolution } from '$lib/ai/smart-templates';
	import type { MediaProviderId } from '$lib/media/uploaders';
	import type { PowProgress } from '$lib/nostr/feed.svelte';
	import type { RemixLicense } from '$lib/meme/remix';
	import type { SplitRow } from '$lib/meme/splits';
	import type { LibrarySound } from '$lib/stores/meme-sounds.svelte';
	import type { MemeArtboardId, MemeDestination, MemeStudioPhase } from './meme-studio-config';

	let {
		imageLayers,
		selectedLayerId = $bindable(null),
		layerTimingId = $bindable(null),
		layerBitmaps,
		layerRenderSrcs,
		layerBusy = false,
		onAddLayerImage,
		onMoveLayer,
		onReplaceLayer,
		busy,
		videoMemeSupported,
		overlays,
		selectedId = $bindable(null),
		timingId = $bindable(null),
		fxId = $bindable(null),
		mediaKind,
		timelineActive,
		patchOverlay,
		moveOverlay,
		moveOverlayRow,
		removeOverlay,
		onAddClassic,
		caption = $bindable(''),
		softCaptionLimit,
		hardCaptionLimit,
		artboardId,
		artboardWidth,
		artboardHeight,
		customArtboardWidth,
		customArtboardHeight,
		staging,
		blankBg,
		mediaZoom,
		mediaPanX,
		mediaPanY,
		onArtboard,
		onCustomArtboard,
		onBackground,
		onFraming,
		videoDuration,
		trimStart = $bindable(0),
		trimEnd = $bindable<number | null>(null),
		trimDurationSec,
		exportDurationSec,
		playbackRate = $bindable(1),
		stageSeconds,
		canPreview,
		onSetLength,
		onPreviewCut,
		gifDuration,
		cues,
		pinnedLength = $bindable<number | null>(null),
		menuId,
		animated,
		includeSourceAudio = $bindable(true),
		analyzing,
		suggestions,
		onOpenSoundStudio,
		onOpenShareSound,
		onPreviewSynth,
		onAddSynth,
		onAddCustom,
		onRemoveLibrarySound,
		onImportAudio,
		onSyncCaptions,
		onBuildSuggestions,
		onApplySuggestion,
		smartMatches = [],
		onApplySmartMatch,
		onSeek,
		onRemoveCue,
		destinations = $bindable<MemeDestination[]>(['bitz']),
		publishDetailsOpen = $bindable(false),
		sensitive = $bindable(false),
		showPow = $bindable(false),
		license = $bindable<RemixLicense>('CC-BY-4.0'),
		aiAssisted = $bindable(false),
		splitsOpen = $bindable(false),
		splitRows = $bindable<SplitRow[]>([]),
		selectedProvider = $bindable<MediaProviderId | 'none'>('none'),
		pow = $bindable(0),
		phase,
		powProgress,
		writeRelayCount,
		kindNip,
		onCancelMining,
		onPatchLayer,
		onRemoveLayer,
		onDuplicateLayer,
		onOpenCropLayer,
		onArrangeLayer,
		onPublish,
		exportFormat,
		videoExportSupported,
		onFormat
	}: {
		imageLayers: MemeImageOverlay[];
		selectedLayerId: string | null;
		layerTimingId: string | null;
		layerBitmaps: { has(key: string): boolean };
		layerRenderSrcs: Map<string, string>;
		layerBusy?: boolean;
		onAddLayerImage: () => void;
		onMoveLayer: (id: string, direction: -1 | 1) => void;
		onReplaceLayer: (id: string) => void;
		busy: boolean;
		videoMemeSupported: boolean;
		overlays: MemeTextOverlay[];
		selectedId: string | null;
		timingId: string | null;
		fxId: string | null;
		mediaKind: 'image' | 'video' | null;
		timelineActive: boolean;
		patchOverlay: (id: string, patch: Partial<MemeTextOverlay>) => void;
		moveOverlay: (id: string, deltaY: number) => void;
		moveOverlayRow: (id: string, direction: -1 | 1) => void;
		removeOverlay: (id: string) => void;
		onAddClassic: () => void;
		caption: string;
		softCaptionLimit: number;
		hardCaptionLimit: number;
		artboardId: MemeArtboardId;
		artboardWidth: number;
		artboardHeight: number;
		customArtboardWidth: number;
		customArtboardHeight: number;
		staging: boolean;
		blankBg: string | null;
		mediaZoom: number;
		mediaPanX: number;
		mediaPanY: number;
		onArtboard: (id: MemeArtboardId) => void;
		onCustomArtboard: (width: number, height: number) => void;
		onBackground: (color: string) => void;
		onFraming: (patch: { zoom?: number; panX?: number; panY?: number }) => void;
		videoDuration: number | null;
		trimStart: number;
		trimEnd: number | null;
		trimDurationSec: number;
		exportDurationSec: number;
		playbackRate: number;
		stageSeconds: number;
		canPreview: boolean;
		onSetLength: (seconds: number | null) => void;
		onPreviewCut: () => void;
		gifDuration: number | null;
		cues: MemeSfxCue[];
		pinnedLength: number | null;
		menuId: string;
		animated: boolean;
		includeSourceAudio: boolean;
		analyzing: boolean;
		suggestions: MemeSuggestion[];
		onOpenSoundStudio: () => void;
		onOpenShareSound: () => void;
		onPreviewSynth: (id: MemeSfxId) => void;
		onAddSynth: (id: MemeSfxId) => void;
		onAddCustom: (sound: LibrarySound) => void;
		onRemoveLibrarySound: (id: string) => void;
		onImportAudio: () => void;
		onSyncCaptions: () => void;
		onBuildSuggestions: () => void;
		onApplySuggestion: (suggestion: MemeSuggestion) => void;
		smartMatches?: SmartResolution[];
		onApplySmartMatch: (match: SmartResolution) => void;
		onSeek: (seconds: number) => void;
		onRemoveCue: (id: string) => void;
		destinations: MemeDestination[];
		publishDetailsOpen: boolean;
		sensitive: boolean;
		showPow: boolean;
		license: RemixLicense;
		aiAssisted: boolean;
		splitsOpen: boolean;
		splitRows: SplitRow[];
		selectedProvider: MediaProviderId | 'none';
		pow: number;
		phase: MemeStudioPhase;
		powProgress: PowProgress | null;
		writeRelayCount: number;
		kindNip: string | undefined;
		onCancelMining: () => void;
		onPatchLayer: (id: string, patch: Partial<MemeImageOverlay>) => void;
		onRemoveLayer: (id: string) => void;
		onDuplicateLayer: (id: string) => void;
		onOpenCropLayer: (id: string) => void;
		onArrangeLayer: (id: string, to: 'front' | 'back' | 'up' | 'down') => void;
		onPublish: () => void;
		exportFormat: import('./meme-studio-config').MemeExportFormat;
		videoExportSupported: boolean;
		onFormat: (format: import('./meme-studio-config').MemeExportFormat) => void;
	} = $props();
</script>

<div class="flex min-w-0 flex-col gap-3">
	<!-- Image layers — one widget: list + inline selected-layer editor
	     (merge 2026-08-25: the old toolbar-popover list fought this panel
	     for the same selection). -->
	<MemeImageLayersCard
		layers={imageLayers}
		bind:selectedLayerId
		bind:timingId={layerTimingId}
		bitmaps={layerBitmaps}
		renderSrcs={layerRenderSrcs}
		{mediaKind}
		{timelineActive}
		busy={busy || layerBusy}
		loading={layerBusy}
		onAdd={onAddLayerImage}
		onMove={onMoveLayer}
		onPatch={onPatchLayer}
		onRemove={onRemoveLayer}
		onReplace={onReplaceLayer}
		onDuplicate={onDuplicateLayer}
		onOpenCrop={onOpenCropLayer}
		onArrange={onArrangeLayer}
	/>
	{#if !videoMemeSupported}
		<p
			class="flex items-center gap-1.5 rounded-lg bg-warm-500/10 px-2.5 py-2 text-[11.5px] font-semibold text-warm-500"
		>
			<Icon name="i-lucide-triangle-alert" class="size-3.5 shrink-0" />
			This browser can't export video memes — try Chrome/Edge, or start from a picture.
		</p>
	{/if}
	<MemeCaptionOverlayList
		{overlays}
		bind:selectedId
		bind:timingId
		bind:fxId
		{mediaKind}
		{timelineActive}
		{busy}
		{patchOverlay}
		{moveOverlay}
		{moveOverlayRow}
		{removeOverlay}
		{onAddClassic}
	/>
	{#if mediaKind}
		<MemeArtboardCard
			{artboardId}
			width={artboardWidth}
			height={artboardHeight}
			customWidth={customArtboardWidth}
			customHeight={customArtboardHeight}
			{busy}
			{staging}
			{blankBg}
			zoom={mediaZoom}
			panX={mediaPanX}
			panY={mediaPanY}
			{onArtboard}
			onCustomSize={onCustomArtboard}
			{onBackground}
			{onFraming}
		/>
	{/if}
	{#if mediaKind === 'video' && videoDuration}
		<MemeTrimPanel
			durationSec={videoDuration}
			{trimStart}
			{trimEnd}
			{trimDurationSec}
			{exportDurationSec}
			rate={playbackRate}
			playheadSec={stageSeconds}
			{busy}
			{canPreview}
			onTrim={(patch) => {
				if (patch.start !== undefined) trimStart = patch.start;
				if (patch.end !== undefined) trimEnd = patch.end;
			}}
			onRate={(rate) => (playbackRate = rate)}
			{onSetLength}
			onReset={() => {
				trimStart = 0;
				trimEnd = null;
				playbackRate = 1;
			}}
			{onPreviewCut}
		/>
	{:else if gifDuration !== null}
		<MemeTrimPanel
			variant="gif"
			durationSec={gifDuration}
			lengthSec={pinnedLength}
			{busy}
			onSetLength={(sec) => (pinnedLength = sec)}
			onReset={() => (pinnedLength = null)}
		/>
	{:else if mediaKind === 'image' && cues.length}
		<MemeTrimPanel
			variant="cues"
			durationSec={cueTrackDurationSec(cues)}
			lengthSec={pinnedLength}
			{busy}
			onSetLength={(sec) => (pinnedLength = sec)}
			onReset={() => (pinnedLength = null)}
		/>
	{/if}
	{#if mediaKind}
		<MemeSoundPanel
			{mediaKind}
			{menuId}
			{animated}
			{cues}
			overlayCount={overlays.length}
			{stageSeconds}
			{busy}
			{timelineActive}
			bind:includeSourceAudio
			{analyzing}
			{suggestions}
			{smartMatches}
			onOpenStudio={onOpenSoundStudio}
			{onOpenShareSound}
			{onPreviewSynth}
			{onAddSynth}
			{onAddCustom}
			{onRemoveLibrarySound}
			{onImportAudio}
			{onSyncCaptions}
			{onBuildSuggestions}
			{onApplySuggestion}
			{onApplySmartMatch}
			{onSeek}
			{onRemoveCue}
		/>
	{/if}
</div>
