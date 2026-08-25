<script module lang="ts">
	import type { MemeImageOverlay as RemixLayerRef } from '$lib/meme/image-overlay';

	/** A pending remix handed over from the Bitz feed — consumed on open. */
	export interface RemixHandoff {
		eventId: string;
		pubkey: string;
		label?: string;
		mediaUrl: string;
		mediaType: 'video' | 'image';
		overlays: MemeTextOverlay[];
		sfxCues: MemeSfxCue[];
		relays?: string[];
		/** Source image layers (remix wire `g`) — optional, older events lack it. */
		imageLayers?: RemixLayerRef[];
		/** Source zoom windows (remix wire `z`) — optional, newer payload. */
		zoomWindows?: ZoomWindow[];
		/** Source frame-FX windows (remix wire `f`) — optional, newer payload. */
		fxWindows?: FrameFxWindow[];
		/** Source speed-ramp windows (remix wire `s`) — optional, newer payload. */
		speedWindows?: SpeedWindow[];
	}
</script>

<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { relays } from '$lib/nostr/relays.svelte';
	import { queryOnce } from '$lib/nostr/pool';
	import { feed, type PowProgress } from '$lib/nostr/feed.svelte';
	import { stories } from '$lib/nostr/stories.svelte';
	import { media } from '$lib/stores/media.svelte';
	import type { MediaProviderId, UploadedMedia } from '$lib/media/uploaders';
	import { humanBytes } from '$lib/media/uploaders';
	import { powPrefs } from '$lib/stores/pow-prefs.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { soundIO } from '$lib/stores/meme-sound-io.svelte';
	import { sharedSoundsStore } from '$lib/stores/meme-shared-sounds.svelte';
	import { fetchSourceFile, MAX_SOURCE_BYTES } from '$lib/meme/source-fetch';
	import { memeTemplates } from '$lib/stores/meme-templates.svelte';
	import { aiAssistedTag } from '$lib/meme/ai-provenance';
	import {
		sourceMonoPcm,
		cueTrackMonoPcm as cueTrackMonoPcmModule,
		libraryDecodeSound,
		buildSuggestionAudio,
		type MonoPcm,
		type MemeClipAnalysis
	} from '$lib/meme/suggestion-audio';
	import type { MemeSuggestion, ZoomWindow } from '$lib/ai/suggest';
	import type { SmartResolution } from '$lib/ai/smart-templates';
	import {
		createMemeDraftWriter,
		draftDrawingGroups,
		draftImageLayers,
		draftMediaFile,
		draftOverlays,
		draftSfxCues,
		mediaToDraftDataUrl,
		readMemeDraft
	} from '$lib/stores/meme-drafts';
	import { formatDuration } from '$lib/utils/format';
	import {
		MAX_OVERLAYS,
		overlayVisibleAt,
		makeOverlay,
		type MemeFont,
		type MemeTextOverlay
	} from '$lib/meme/schema';
	import {
		canRenderVideoMeme,
		grabVideoFrame,
		paintAll,
		paintImageOverlays,
		renderImageMeme,
		renderVideoMeme,
		targetSize,
		coverRect
	} from '$lib/meme/render';
	import {
		imageOverlayVisibleAt,
		layerSrcOk,
		makeImageOverlay,
		MAX_IMAGE_OVERLAYS,
		MAX_IMAGE_OVERLAY_BYTES,
		type MemeImageOverlay
	} from '$lib/meme/image-overlay';
	import { buddyFigure, isBuddySrc } from '$lib/meme/bitz-buddy';
	import { layerMotionCss, layerMotionOf } from '$lib/meme/layer-motion';
	import { canDecodeGif, decodeGif, paintGifFrameAt, type DecodedGif } from '$lib/meme/gif';
	import { planGifExport } from '$lib/meme/gif-export';
	import {
		CUSTOM_SOUND_KEY,
		MEME_SFX_IDS,
		type MemeSfxCue,
		type MemeSfxId,
		normalizeSfxCue,
		normalizeSfxCues
	} from '$lib/meme/schema';
	import { SFX_RECIPES } from '$lib/meme/sfx';
	import { SFX_LABELS as sfxLabels, SFX_DURATIONS as sfxDurations } from '$lib/meme/sound-catalog';
	import { cueTrackDurationSec, MAX_VIDEO_MEME_SECONDS } from '$lib/meme/cue-track';
	import {
		clipsDuration,
		makeVideoClip,
		moveClip,
		removeClip,
		sourceTimeAt,
		splitClipAt,
		type VideoClip
	} from '$lib/meme/video-clips';
	import MemeSoundDialog from '$lib/components/bitz/MemeSoundDialog.svelte';
	import MemeLookPicker from '$lib/components/bitz/MemeLookPicker.svelte';
	import MemeFxPicker from '$lib/components/bitz/MemeFxPicker.svelte';
	import MemeBuddyPicker from '$lib/components/bitz/MemeBuddyPicker.svelte';
	import MemeStickerPicker from '$lib/components/bitz/MemeStickerPicker.svelte';
	import { mediaLibrary } from '$lib/stores/media-library.svelte';
	import { encodeAnimatedGif, type GifEncodeFrame } from '$lib/meme/gif-encode';
	import { exportErrorMessage, exportImetaDuration } from '$lib/meme/export-support';
	import {
		composeZoomWithFraming,
		normalizeZoomWindows,
		shiftZoomsForExport,
		zoomFrameCss,
		zoomTransformAt
	} from '$lib/meme/zoom-track';
	import {
		fxPreviewStyle,
		FRAME_FX_IDS,
		FRAME_FX_LABELS,
		MAX_FX_WINDOWS,
		normalizeFxWindows,
		paintFxFrame,
		shiftFxForExport,
		type FrameFxId,
		type FrameFxWindow
	} from '$lib/meme/fx-track';
	import {
		mediaMsToExportMs,
		MAX_SPEED_WINDOWS,
		normalizeSpeedWindows,
		rateAt,
		shiftCuesForExportWithSpeeds,
		type SpeedWindow
	} from '$lib/meme/speed-track';
	import MemeSpeedPicker from '$lib/components/bitz/MemeSpeedPicker.svelte';
	import { cueAudioTrack, paintMemeBase, recordMeme } from '$lib/meme/export-pipeline';
	import CueWaveform from '$lib/components/bitz/CueWaveform.svelte';
	import { soundLibrary, type LibrarySound } from '$lib/stores/meme-sounds.svelte';
	import { memeSlots, MAX_SLOT_BYTES } from '$lib/stores/meme-slots.svelte';
	import {
		LayerAssetCache,
		fetchLayerBlob,
		probeAspect
	} from '$lib/stores/meme-layer-assets.svelte';
	import { looksLikeSvg, rasterizeSvgBlob } from '$lib/meme/svg-layer';
	import { MemeBatchQueue } from '$lib/stores/meme-batch-queue.svelte';
	import {
		applyRemixPayload,
		remixTagsFor,
		rightsTagsFor,
		type RemixLicense,
		type RemixSource
	} from '$lib/meme/remix';
	import { splitsTagsFor, validateSplits, type SplitRow } from '$lib/meme/splits';
	import { remixChainOf } from '$lib/meme/remix';
	import { makeSticker } from '$lib/meme/stickers';
	import { fxTransformAt } from '$lib/meme/fx';
	import {
		MAX_DRAWING_GROUPS,
		normalizeDrawingGroups,
		paintDrawingGroups,
		type DrawingGroup,
		type DrawingSmoothing,
		type DrawingStroke,
		type DrawingTool
	} from '$lib/meme/drawing';
	import MemeTimeline from '$lib/components/bitz/MemeTimeline.svelte';
	import { type GifChoice } from '$lib/components/feed/GifPicker.svelte';
	import { syncOverlaysToCues } from '$lib/meme/caption-sync';
	import { popovers } from '$lib/stores/popovers.svelte';
	import { canvasFiltersSupported, memeLookCss, memeLookOf, type MemeLookId } from '$lib/meme/look';
	import { bitzHashLink } from '$lib/utils/bitz-links';
	import type { MemeMediaFormat } from '$lib/components/bitz/MemeStudioDropZone.svelte';
	import MemeBatchQueueBar from '$lib/components/bitz/MemeBatchQueueBar.svelte';
	import MemeStudioEmptyState from '$lib/components/bitz/MemeStudioEmptyState.svelte';
	import MemeStudioFooter from '$lib/components/bitz/MemeStudioFooter.svelte';
	import MemeDiscardDialog from '$lib/components/bitz/MemeDiscardDialog.svelte';
	import MemeTimelineDock from '$lib/components/bitz/MemeTimelineDock.svelte';
	import MemeStudioInputs from '$lib/components/bitz/MemeStudioInputs.svelte';
	import MemeTemplateSlotTools from '$lib/components/bitz/MemeTemplateSlotTools.svelte';
	import MemeInspectorPanel from '$lib/components/bitz/MemeInspectorPanel.svelte';
	import MemeExpertClipPanel from '$lib/components/bitz/MemeExpertClipPanel.svelte';
	import MemeStageMediaControls from '$lib/components/bitz/MemeStageMediaControls.svelte';
	import MemeDrawingSurface from '$lib/components/bitz/MemeDrawingSurface.svelte';
	import MemeTimelineQuickActions from '$lib/components/bitz/MemeTimelineQuickActions.svelte';
	import MemeTimelineImagePicker from '$lib/components/bitz/MemeTimelineImagePicker.svelte';
	import MemeImageLayerTools from '$lib/components/bitz/MemeImageLayerTools.svelte';
	import {
		ARTBOARD_KEY,
		ARTBOARDS,
		STAGE_ZOOM_KEY,
		STAGE_ZOOM_STEPS,
		TEMPLATES,
		type MemeArtboardId as ArtboardId,
		type MemeDestination as Destination,
		type MemeExportFormat,
		type MemeStudioPhase as Phase,
		type MemeStudioTemplate as Template,
		type MemeImageLayout
	} from '$lib/components/bitz/meme-studio-config';

	const DRAWING_RECENT_COLORS_KEY = 'bitos.meme-drawing-recent-colors.v1';
	const DRAWING_RECOMMENDED_COLORS = [
		'#ffffff',
		'#111827',
		'#ef4444',
		'#f97316',
		'#facc15',
		'#22c55e',
		'#06b6d4',
		'#3b82f6',
		'#8b5cf6',
		'#ec4899'
	] as const;
	const DRAWING_COLOR = /^#[0-9a-f]{6}$/i;

	/**
	 * Meme Studio — create video/image memes and publish them as standard
	 * Nostr media events. Overlays are burned into the pixels at export (image
	 * canvas / MediaRecorder), so the published kind-20/22 (Bitz feed) or
	 * kind-30315 story renders in *every* Nostr client with zero custom kinds.
	 *
	 * Stage is a true WYSIWYG 9:16 mirror of the Bitz player; overlays are
	 * draggable with pointer events and the schema is the versioned, portable
	 * `com.bitos.bitz.meme` project (persisted as a draft).
	 */
	let {
		open = $bindable(false),
		onposted = () => {},
		/** Handoff slot for the remix chain (bitz page → studio): the pending
		 * remix is consumed the next time the studio opens; media is fetched in
		 * the background and the source layout/cues are applied on arrival. */
		remixHandoff,
		/** Start-with-template handoff (studio home): overlay layout to apply
		 * once on open (fresh ids — the saved template stays re-usable). */
		templateHandoff,
		/** Resume-slot handoff (studio home): WIP slot id to restore on open. */
		slotHandoff,
		/** Sound handoff (Sounds page "Use sound"): stage the picked sound as
		 * the first cue the next time the studio opens. */
		soundHandoff
	}: {
		open?: boolean;
		onposted?: (eventId: string) => void;
		remixHandoff?: RemixHandoff | null;
		templateHandoff?: { id: string; overlays: MemeTextOverlay[] } | null;
		slotHandoff?: string | null;
		soundHandoff?: { kind: 'synth' | 'custom'; id: string; label?: string } | null;
	} = $props();

	// ---- media state ---------------------------------------------------------
	let file = $state<File | null>(null);
	let previewUrl = $state('');
	let mediaKind = $state<'image' | 'video' | null>(null);
	let meta = $state<{ width: number; height: number; duration?: number } | null>(null);
	let stageVideo = $state<HTMLVideoElement | null>(null);
	let stageImg = $state<HTMLImageElement | null>(null);
	let stageBox = $state<HTMLElement | null>(null);
	let gifStageCanvas = $state<HTMLCanvasElement | null>(null);

	// ---- GIF + SFX state (animated source / sound-effect cues) -----------------
	let gif = $state<DecodedGif | null>(null);
	/** Animated sources (GIF) behave like video for timing/SFX. */
	const animated = $derived(!!gif);
	let sfxCues = $state<MemeSfxCue[]>([]);
	let sfxMenuId = `meme-sfx-${Math.random().toString(36).slice(2, 8)}`;
	/** Sound studio dialog (picker + cue-sheet editor). */
	let soundDialogOpen = $state(false);
	let recordingPreflightOpen = $state(false);
	let recordingCapabilities = $state<{
		pointer: boolean;
		microphone: boolean;
		canvasCapture: boolean;
		mediaRecorder: boolean;
	} | null>(null);
	let performanceRecording = $state(false);
	let performanceCountdown = $state<number | null>(null);
	let performanceElapsedMs = $state(0);
	let performanceStartedAt = 0;
	let performanceFrame = 0;
	let performanceCountdownTimer: ReturnType<typeof setTimeout> | undefined;
	let performanceInitialDrawingIds = $state<string[]>([]);
	let performanceInitialCueIds = $state<string[]>([]);
	type PerformanceTake = {
		id: string;
		durationMs: number;
		drawingGroupIds: string[];
		cueIds: string[];
	};
	let performanceTakes = $state<PerformanceTake[]>([]);
	let performanceReviewId = $state<string | null>(null);
	const performanceReview = $derived(
		performanceTakes.find((take) => take.id === performanceReviewId) ?? null
	);
	function performanceClockMs(): number {
		return performanceRecording
			? performanceElapsedMs
			: Math.max(0, Math.round(stageSeconds * 1000));
	}
	function stopPerformanceRecording() {
		if (performanceCountdownTimer !== undefined) {
			clearTimeout(performanceCountdownTimer);
			performanceCountdownTimer = undefined;
		}
		if (performanceFrame) cancelAnimationFrame(performanceFrame);
		performanceFrame = 0;
		performanceCountdown = null;
		if (!performanceRecording) return;
		performanceRecording = false;
		const take: PerformanceTake = {
			id: drawingId(),
			durationMs: performanceElapsedMs,
			drawingGroupIds: drawingGroups
				.filter((group) => !performanceInitialDrawingIds.includes(group.id))
				.map((group) => group.id),
			cueIds: sfxCues
				.filter((cue) => !performanceInitialCueIds.includes(cue.id))
				.map((cue) => cue.id)
		};
		performanceTakes = [...performanceTakes, take];
		performanceReviewId = take.id;
		toasts.success(`Performance take saved (${formatDuration(performanceElapsedMs / 1000)})`);
	}
	function discardPerformanceTake(id: string) {
		const take = performanceTakes.find((item) => item.id === id);
		if (!take) return;
		if (take.drawingGroupIds.length) snapshotDrawings();
		drawingGroups = drawingGroups.filter((group) => !take.drawingGroupIds.includes(group.id));
		sfxCues = sfxCues.filter((cue) => !take.cueIds.includes(cue.id));
		if (selectedDrawingGroupId && take.drawingGroupIds.includes(selectedDrawingGroupId)) {
			selectedDrawingGroupId = drawingGroups[0]?.id ?? null;
		}
		if (selectedCueId && take.cueIds.includes(selectedCueId)) selectedCueId = null;
		performanceTakes = performanceTakes.filter((item) => item.id !== id);
		if (performanceReviewId === id) performanceReviewId = null;
	}
	function retryPerformanceTake(id: string) {
		discardPerformanceTake(id);
		beginPerformanceCountdown();
	}
	function startPerformanceRecording() {
		performanceStartedAt = performance.now();
		performanceElapsedMs = 0;
		performanceInitialDrawingIds = drawingGroups.map((group) => group.id);
		performanceInitialCueIds = sfxCues.map((cue) => cue.id);
		stageSeconds = 0;
		previewSeconds = 0;
		if (stageVideo) {
			stageVideo.pause();
			stageVideo.currentTime = 0;
		}
		previewPlaying = false;
		performanceRecording = true;
		drawActive = true;
		const tick = () => {
			performanceElapsedMs = Math.max(0, Math.round(performance.now() - performanceStartedAt));
			stageSeconds = performanceElapsedMs / 1000;
			performanceFrame = requestAnimationFrame(tick);
		};
		performanceFrame = requestAnimationFrame(tick);
	}
	function beginPerformanceCountdown() {
		if (!recordingCapabilities?.pointer) {
			toasts.error('Pointer drawing is required to record a performance');
			return;
		}
		recordingPreflightOpen = false;
		performanceCountdown = 3;
		const next = () => {
			if (performanceCountdown === null) return;
			if (performanceCountdown <= 1) {
				performanceCountdownTimer = undefined;
				performanceCountdown = null;
				startPerformanceRecording();
				return;
			}
			performanceCountdown -= 1;
			performanceCountdownTimer = setTimeout(next, 1000);
		};
		performanceCountdownTimer = setTimeout(next, 1000);
	}
	function openRecordingPreflight() {
		// Capability inspection is permission-free. Microphone permission is only
		// requested later by the explicit Record action in Sound Studio.
		recordingCapabilities = {
			pointer: typeof PointerEvent !== 'undefined',
			microphone: !!navigator.mediaDevices?.getUserMedia,
			canvasCapture:
				typeof HTMLCanvasElement !== 'undefined' &&
				typeof HTMLCanvasElement.prototype.captureStream === 'function',
			mediaRecorder: typeof MediaRecorder !== 'undefined'
		};
		recordingPreflightOpen = true;
	}
	// --- AI-002 suggestion ladder (Mild/Funny/Chaos) -------------------------
	let suggestBusy = $state(false);
	let suggestionGroups = $state<MemeSuggestion[]>([]);
	/** AI Smart Templates (tp-2 p.558): trigger-rule resolutions ranked by
	 *  match — the “Production Bug 94%” cards of Auto Meme V2. */
	let smartMatches = $state<SmartResolution[]>([]);
	// ---- punchline zoom track (Auto Meme follow-through) ----------------------
	/** Face-anchored zoom windows in media time — the runnable counterpart of
	 *  the suggestion cards' "N zooms" line. Persisted + burned into exports
	 *  exactly like cues, so what the card promises is what the viewer sees. */
	let zoomWindows = $state<ZoomWindow[]>([]);
	/** Frame-FX windows (flash/glitch/shake/…) in media time — Meme Pack V1
	 *  Layer 2. Same covenant as zooms: normalized, capped, burned into every
	 *  export path + mirrored in the stage preview (CSS). */
	let fxWindows = $state<FrameFxWindow[]>([]);
	// Speed ramps: remix round-trip today (wire `s`); editing UI is V2 per the
	// speed-track plan (browser recorders stay real-time across 0.5–2× ramps).
	let speedWindows = $state<SpeedWindow[]>([]);
	/** Last local analysis — feeds the cue-sheet waveform (AI-001 anchors). */
	let lastAnalysis = $state<MemeClipAnalysis | null>(null);
	let analysisWindows = $state<Float32Array>(new Float32Array(0));
	/** Grab the stage media's audio as mono PCM for analysis (no cloud, no
	 *  detectors — the DSP always runs local per AI-003's boundary). */
	async function stageMonoPcm(): Promise<MonoPcm | null> {
		return file ? sourceMonoPcm(file) : null;
	}

	async function cueTrackMonoPcm(): Promise<MonoPcm | null> {
		return cueTrackMonoPcmModule(sfxCues, libraryDecodeSound);
	}

	/** Generate the three editable timelines — video memes analyze their own
	 *  (trimmed) audio; image/GIF memes analyze the cue track they will ship. */
	async function buildSuggestions(): Promise<void> {
		if (suggestBusy) return;
		if (mediaKind !== 'video' && !sfxCues.length) {
			toasts.info(
				'Add at least one sound cue first — suggestions follow the audio your meme ships'
			);
			return;
		}
		suggestBusy = true;
		try {
			let mono: { pcm: Float32Array; sampleRate: number } | null;
			let span: Float32Array;
			if (mediaKind === 'video') {
				mono = await stageMonoPcm();
				if (!mono) {
					toasts.error('Could not read audio from this clip — suggestions need sound');
					return;
				}
				// Trim the analysis window to the export timeline so suggested cue
				// times land inside what actually gets exported.
				const startSample = Math.floor((trimStartSec || 0) * mono.sampleRate);
				const endSample = Math.min(
					mono.pcm.length,
					Math.floor((trimEndSec ?? meta?.duration ?? 0) * mono.sampleRate)
				);
				span = endSample > startSample ? mono.pcm.subarray(startSample, endSample) : mono.pcm;
			} else {
				// Image / GIF: the rendered cue mix IS the timeline the viewer hears.
				mono = await cueTrackMonoPcm();
				if (!mono) {
					toasts.error('Could not render the cue track — suggestions need sound');
					return;
				}
				span = mono.pcm;
			}
			const built = await buildSuggestionAudio(span, mono.sampleRate);
			lastAnalysis = built.analysis;
			analysisWindows = built.windows;
			suggestionGroups = built.groups;
			smartMatches = built.smart;
			toasts.info('3 timelines ready — pick a vibe, everything stays editable', 4000);
		} finally {
			suggestBusy = false;
		}
	}
	/** Apply one suggestion: overlays + cues replace the current timeline and
	 *  the AI-004 provenance flag flips on automatically (it WAS AI-assisted). */
	function applySuggestion(group: MemeSuggestion) {
		if (!group.overlays.length && !group.sfxCues.length && !group.zooms.length) {
			toasts.info('That vibe found nothing to add for this clip');
			return;
		}
		overlays = group.overlays.map((o) => ({ ...o }));
		sfxCues = group.sfxCues.map((c) => ({ ...c }));
		zoomWindows = normalizeZoomWindows(group.zooms);
		// Fresh timeline start for fx/speed too (suggestions don't emit them yet).
		fxWindows = [];
		speedWindows = [];
		selectedId = overlays[0]?.id ?? null;
		timingId = null;
		aiAssisted = true; // AI-004: the creator applied AI suggestions
		popovers.close();
		toasts.success(
			`“${group.intensity}” applied — ${group.overlays.length} captions · ${group.sfxCues.length} cues${
				zoomWindows.length ? ` · ${zoomWindows.length} zooms` : ''
			}`
		);
	}

	/** Apply one AI Smart Template resolution: every timed track lands like
	 *  a studio template (merged under caps), AI-provenance flips on. */
	function applySmartMatch(match: SmartResolution) {
		if (busy) return;
		const total =
			match.overlays.length +
			match.sfxCues.length +
			match.zoomWindows.length +
			match.fxWindows.length +
			match.speedWindows.length +
			match.imageLayers.length;
		if (!total) {
			toasts.info('That template found no trigger support in this clip');
			return;
		}
		if (match.overlays.length) overlays = [...overlays, ...match.overlays.map((o) => ({ ...o }))];
		if (match.sfxCues.length) {
			const room = Math.max(0, 16 - sfxCues.length);
			const take = match.sfxCues.slice(0, room);
			if (take.length) sfxCues = [...sfxCues, ...take];
		}
		if (match.zoomWindows.length)
			zoomWindows = normalizeZoomWindows([...zoomWindows, ...match.zoomWindows]);
		if (match.fxWindows.length) fxWindows = normalizeFxWindows([...fxWindows, ...match.fxWindows]);
		if (match.speedWindows.length)
			speedWindows = normalizeSpeedWindows([...speedWindows, ...match.speedWindows]);
		if (match.imageLayers.length) {
			const room = Math.max(0, MAX_IMAGE_OVERLAYS - imageLayers.length);
			const take = match.imageLayers.slice(0, room);
			if (take.length) {
				imageLayers = [...imageLayers, ...take];
				for (const l of take) void cacheLayerBitmap(l.src);
			}
		}
		selectedId = match.overlays[0]?.id ?? selectedId;
		aiAssisted = true; // AI-004: applied a smart-template resolution
		popovers.close();
		toasts.success(
			`Smart template applied — ${match.overlays.length} captions · ${match.zoomWindows.length} zooms · ${match.imageLayers.length} stickers`
		);
	}
	/** Timeline sound blocks: label + play length per cue (synth recipes have
	 *  fixed lengths; custom sounds carry theirs in the library). */
	function cueMeta(cue: MemeSfxCue): { label: string; durationSec: number } | null {
		if (cue.sfx === CUSTOM_SOUND_KEY) {
			const sound = soundLibrary.list.find((s) => s.id === cue.soundId);
			return sound ? { label: sound.label, durationSec: sound.durationSec } : null;
		}
		return { label: sfxLabels[cue.sfx], durationSec: sfxDurations[cue.sfx] ?? 0.5 };
	}

	// ---- custom sound library (device / mic one-shots) -----------------------
	// Browser audio plumbing lives in the soundIO store (SRP: the studio keeps
	// cue state + UX, the store owns AudioContext / MediaRecorder lifecycles).
	// NOTE: read reactive fields via `soundIO.x` — destructuring would snapshot.
	let soundFileInput = $state<HTMLInputElement | null>(null);

	/** Audition a library sound immediately (store owns the AudioContext). */
	async function previewSound(sound: LibrarySound) {
		await soundIO.preview(sound);
	}

	/** Measure a candidate audio blob by decoding it. */

	// ---- shared sounds (NIP-78 §17.1 + §17.2 ingestion rules) ------------------
	// Relay + upload + ingestion logic lives in sharedSoundsStore; the studio
	// keeps menu ids and template bindings only (reactive reads via the store).
	const sharedSounds = $derived(sharedSoundsStore.list);
	/** GIF URL sourcing: paste a direct image/gif link next to the picker. */
	let gifUrl = $state('');
	let gifUrlBusy = $state(false);
	async function importGifFromUrl() {
		const url = gifUrl.trim();
		if (!url || gifUrlBusy) return;
		gifUrlBusy = true;
		try {
			const res = await fetchSourceFile(url, {
				noProxy: true,
				label: 'gif',
				maxBytes: { image: 50 * 1024 * 1024, video: MAX_MEDIA_BYTES }
			});
			if (!res.ok || !res.file) throw new Error(res.error);
			await acceptFile(res.file, {
				keepRemix: true,
				keepLayout: keepLayoutOnSwap
			});
			showSwapUrlForm = false;
		} catch (e) {
			toasts.error(e instanceof Error ? e.message : 'Could not load that media URL');
		} finally {
			gifUrlBusy = false;
		}
	}

	/** GIF library pick inside the editor: swap the base media, keep the queue + look. */
	async function swapGifFromLib(gif: GifChoice) {
		popovers.close();
		await loadGifFromUrl(gif.url, gif.title ?? 'GIF', keepLayoutOnSwap);
	}

	// ---- more ways to start (user request 2026-08-23): GIF library · blank canvas
	// ---- batch queue (mass production): multi-picked GIFs wait in line; each
	// posted meme advances to the next source. Caption once per GIF, publish N times.
	let gifPickerMenuId = `meme-giflib-${Math.random().toString(36).slice(2, 8)}`;
	let swapGifMenuId = `meme-swapgif-${Math.random().toString(36).slice(2, 8)}`;
	let startLibMenuId = `meme-lib-start-${Math.random().toString(36).slice(2, 8)}`;
	let swapLibMenuId = `meme-lib-swap-${Math.random().toString(36).slice(2, 8)}`;
	let showSwapUrlForm = $state(false);
	/** Keep captions/layers/cues when swapping base media (user toggle, #1). */
	let keepLayoutOnSwap = $state(false);
	let blankMenuId = `meme-blank-${Math.random().toString(36).slice(2, 8)}`;
	let showGifUrlForm = $state(false);
	let gifStageBusy = $state(false);
	/** Batch queue (mass production) — the store owns list mechanics (ids,
	 *  captions, the staging pointer); staging side-effects live here. */
	const batch = new MemeBatchQueue();
	let queueInput = $state<HTMLInputElement | null>(null);

	/** Multi-pick local videos/pictures into the batch queue (first one stages
	 *  immediately when the stage is empty). */
	function onQueueInput(e: Event): void {
		const input = e.currentTarget as HTMLInputElement;
		const picked = [...(input.files ?? [])].filter(
			(f) => f.type.startsWith('video/') || f.type.startsWith('image/')
		);
		input.value = '';
		if (!picked.length) return;
		if (!file) {
			const [first, ...rest] = picked;
			batch.appendFiles(rest);
			if (rest.length) toasts.info(`${rest.length} more queued — each post loads the next`);
			if (first) void acceptFile(first, { keepRemix: true });
			return;
		}
		batch.appendFiles(picked);
		toasts.info(`${picked.length} queued — each post loads the next`);
	}

	/** Fetch a GIF URL into the stage File (shared by single pick, multi-pick and queue advance). */
	async function loadGifFromUrl(url: string, label = 'GIF', keepLayout = false): Promise<boolean> {
		if (gifStageBusy) return false;
		gifStageBusy = true;
		try {
			const res = await fetchSourceFile(url, { label, maxBytes: MAX_SOURCE_BYTES });
			if (!res.ok || !res.file) throw new Error(res.error ?? `Could not load that ${label}`);
			await acceptFile(res.file, { keepRemix: true, keepLayout });
			mediaLibrary.remember(res.url ?? url, label, res.file.type || 'image/gif');
			return true;
		} catch (e) {
			toasts.error(e instanceof Error ? e.message : `Could not load that ${label}`);
			return false;
		} finally {
			gifStageBusy = false;
		}
	}

	/** Library open: any recent source (image OR video) as the base media.
	 *  CORS-hostile hosts route through the image proxy fallback. */
	async function loadSourceFromUrl(url: string, label = ''): Promise<void> {
		if (gifStageBusy) return;
		gifStageBusy = true;
		popovers.close();
		try {
			const res = await fetchSourceFile(url, { label, maxBytes: MAX_SOURCE_BYTES });
			if (!res.ok || !res.file) throw new Error(res.error ?? 'Could not open that source');
			await acceptFile(res.file, {
				keepRemix: true,
				keepLayout: keepLayoutOnSwap
			});
			mediaLibrary.remember(res.url ?? url, label, res.file.type);
		} catch (e) {
			toasts.error(e instanceof Error ? e.message : 'Could not open that source');
		} finally {
			gifStageBusy = false;
		}
	}

	/** Giphy single pick → stage. */
	async function pickGifForStage(gif: GifChoice) {
		popovers.close();
		if (gifStageBusy) return;
		await loadGifFromUrl(gif.url, gif.title ?? 'GIF');
	}

	/** Giphy multi-pick: keep any in-progress meme, queue everything after the first free slot. */
	async function pickGifsForStage(gifs: GifChoice[]) {
		popovers.close();
		const [first, ...rest] = gifs;
		if (!first) return;
		batch.appendUrls(rest.map((g) => ({ url: g.url, label: g.title ?? 'GIF' })));
		if (file) {
			if (rest.length)
				toasts.info(
					`${rest.length} GIF${rest.length === 1 ? '' : 's'} queued — each post loads the next`
				);
			return;
		}
		await pickGifForStage(first);
	}

	/** Stage the next queued GIF after a publish (returns false when the queue is empty). */
	async function stageNextQueued(): Promise<boolean> {
		const next = batch.take();
		if (!next) return false;
		// This item's caption (if any) becomes the post text — per-item, so each meme
		// in the batch can carry its own words instead of inheriting the previous one's.
		if (typeof next.caption === 'string') caption = next.caption;
		// Local files (queued videos/pictures) stage directly; URL items fetch.
		if (next.file) {
			await acceptFile(next.file, { keepRemix: true, keepLayout: keepLayoutOnSwap });
			return !!file; // false when the pick was rejected (type/size)
		}
		return loadGifFromUrl(next.url, next.label);
	}

	/** Blank 9:16 canvas — caption-first memes that start from nothing. */
	function startBlank(color: string) {
		popovers.close();
		void applyBackgroundColor(color);
	}

	/** Active background color when the base IS a blank canvas (swatch
	 *  highlight in the Artboard card; unknown after a draft restore). */
	let blankBg = $state<string | null>(null);

	/** Solid-color background: swap the base media to a blank canvas (at the
	 *  artboard's size) in the chosen color — captions, image layers and sound
	 *  cues survive via keepLayout. Powers the start-panel swatches AND the
	 *  Artboard card's background row. */
	async function applyBackgroundColor(color: string) {
		if (busy || gifStageBusy) return;
		gifStageBusy = true;
		try {
			const size =
				artboardId === 'source'
					? { width: 1080, height: 1920 }
					: { width: renderTarget.width, height: renderTarget.height };
			const canvas = document.createElement('canvas');
			canvas.width = size.width;
			canvas.height = size.height;
			const ctx = canvas.getContext('2d');
			if (!ctx) throw new Error('no canvas');
			ctx.fillStyle = color;
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
			if (!blob) throw new Error('no blob');
			await acceptFile(new File([blob], `blank-${Date.now()}.png`, { type: 'image/png' }), {
				keepRemix: true,
				keepLayout: true
			});
			blankBg = color;
		} catch {
			toasts.error('Could not set that background color');
		} finally {
			gifStageBusy = false;
		}
	}

	// ---- "Look" color presets (user request 2026-08-23) -----------------------
	let lookMenuId = `meme-look-${Math.random().toString(36).slice(2, 8)}`;
	let lookId = $state<MemeLookId>('none');
	const lookCss = $derived(memeLookCss(lookId));
	const looksAvailable = $derived(canvasFiltersSupported());

	// ---- frame-FX track (Meme Pack V1 Layer 2) ----------------------------------
	let fxMenuId = `meme-fx-${Math.random().toString(36).slice(2, 8)}`;
	let speedMenuId = `meme-speed-${Math.random().toString(36).slice(2, 8)}`;
	/** Add a speed window at the playhead (default 800ms — a readable beat of
	 *  slow-mo or speed-up; the creator tunes ranges later per-row). */
	function addSpeedWindow(rate: number, atMs: number) {
		if (speedWindows.length >= MAX_SPEED_WINDOWS) {
			toasts.error(`Speed ramps cap out at ${MAX_SPEED_WINDOWS} windows`);
			return;
		}
		// Default 800ms span, but never past the clip's end — a ramp that
		// overruns the export window would normalize away.
		const endMs = Math.min(atMs + 800, Math.round(timelineDurationSec * 1000));
		speedWindows = normalizeSpeedWindows([...speedWindows, { startMs: atMs, endMs, rate }]);
	}
	function removeSpeedWindow(index: number) {
		speedWindows = speedWindows.filter((_, i) => i !== index);
	}
	function patchSpeedRate(index: number, rate: number) {
		const rows = [...speedWindows];
		const row = rows[index];
		if (row) rows[index] = { ...row, rate };
		speedWindows = normalizeSpeedWindows(rows);
	}
	/** Add an fx window starting at the playhead (default 600ms — a punchy
	 *  hit; the creator tunes ranges later per-row). */
	function addFxWindow(fx: FrameFxId, atMs: number) {
		if (fxWindows.length >= MAX_FX_WINDOWS) {
			toasts.error(`FX cap out at ${MAX_FX_WINDOWS} windows`);
			return;
		}
		fxWindows = normalizeFxWindows([
			...fxWindows,
			{ fx, startMs: atMs, endMs: atMs + 600, intensity: 0.7 }
		]);
	}
	function removeFxWindow(index: number) {
		fxWindows = fxWindows.filter((_, i) => i !== index);
	}
	function patchFxIntensity(index: number, intensity: number) {
		const rows = [...fxWindows];
		const row = rows[index];
		if (row) rows[index] = { ...row, intensity };
		fxWindows = rows;
	}

	function addCustomCue(sound: LibrarySound) {
		if (sfxCues.length >= 16) {
			toasts.error('Sound cues cap out at 16');
			return;
		}
		const cue = normalizeSfxCue({
			sfx: CUSTOM_SOUND_KEY,
			soundId: sound.id,
			atMs: performanceClockMs(),
			gain: 1
		});
		if (cue) {
			sfxCues = [...sfxCues, cue];
			selectedCueId = cue.id;
			selectedId = null;
			selectedLayerId = null;
			selectedDrawingGroupId = null;
			selectedBaseTrack = false;
		}
	}

	function removeSoundFromLibrary(id: string) {
		void soundLibrary.remove(id).then(() => {
			sfxCues = soundLibrary.pruneOrphanCues(sfxCues);
		});
	}

	// ---- overlays ------------------------------------------------------------
	let overlays = $state<MemeTextOverlay[]>([]);
	let selectedId = $state<string | null>(null);
	let selectedCueId = $state<string | null>(null);
	// ---- Draw & Record MVP (DRW-1) -------------------------------------------
	let drawingGroups = $state<DrawingGroup[]>([]);
	let drawActive = $state(false);
	let drawingTool = $state<DrawingTool>('pen');
	let drawingColor = $state('#ffffff');
	let drawingRecentColors = $state<string[]>([]);
	let drawingWidth = $state(0.012);
	let drawingOpacity = $state(1);
	let drawingPressureEnabled = $state(true);
	let drawWithFinger = $state(true);
	let drawingSmoothing = $state<DrawingSmoothing>('off');
	let drawingUndo = $state<DrawingGroup[][]>([]);
	let drawingRedo = $state<DrawingGroup[][]>([]);
	let selectedDrawingGroupId = $state<string | null>(null);
	const selectedDrawingGroup = $derived(
		drawingGroups.find((group) => group.id === selectedDrawingGroupId) ?? drawingGroups[0] ?? null
	);
	const selectedDrawingStroke = $derived(selectedDrawingGroup?.strokes[0] ?? null);
	function drawingId(): string {
		return typeof crypto !== 'undefined' && 'randomUUID' in crypto
			? crypto.randomUUID()
			: `drawing-${Date.now().toString(36)}`;
	}
	function snapshotDrawings() {
		// `$state` arrays are Svelte proxies, which `structuredClone` deliberately
		// rejects. Normalizing also gives undo/redo the same safe caps as drafts.
		drawingUndo = [...drawingUndo.slice(-24), normalizeDrawingGroups(drawingGroups)];
		drawingRedo = [];
	}
	function copyDrawings(): DrawingGroup[] {
		return normalizeDrawingGroups(drawingGroups);
	}
	function rememberDrawingColor(color: string) {
		const normalized = color.toLowerCase();
		if (!DRAWING_COLOR.test(normalized)) return;
		drawingRecentColors = [
			normalized,
			...drawingRecentColors.filter((item) => item !== normalized)
		].slice(0, 8);
		try {
			localStorage.setItem(DRAWING_RECENT_COLORS_KEY, JSON.stringify(drawingRecentColors));
		} catch {
			/* private mode — colors remain available for this session */
		}
	}
	function selectDrawingColor(color: string) {
		drawingColor = color;
		rememberDrawingColor(color);
	}
	function setSelectedDrawingColor(color: string) {
		const stroke = selectedDrawingStroke;
		if (!stroke) return;
		rememberDrawingColor(color);
		patchSelectedDrawingStyle({ color, width: stroke.width, opacity: stroke.opacity });
	}
	function addDrawingStroke(stroke: DrawingStroke) {
		if (drawingGroups.length >= MAX_DRAWING_GROUPS) {
			toasts.warning(`You can add up to ${MAX_DRAWING_GROUPS} drawing layers`);
			return;
		}
		snapshotDrawings();
		const atMs = performanceClockMs();
		const group: DrawingGroup = {
			id: drawingId(),
			label: `Drawing ${drawingGroups.length + 1}`,
			playback: 'replay',
			startMs: atMs,
			visibleFromMs: 0,
			strokes: [stroke]
		};
		drawingGroups = [...drawingGroups, group];
		selectedDrawingGroupId = group.id;
		selectedCueId = null;
		selectedId = null;
		selectedLayerId = null;
		selectedBaseTrack = false;
	}
	function undoDrawing() {
		const previous = drawingUndo[drawingUndo.length - 1];
		if (!previous) return;
		drawingRedo = [...drawingRedo, copyDrawings()];
		drawingGroups = previous;
		drawingUndo = drawingUndo.slice(0, -1);
	}
	function redoDrawing() {
		const next = drawingRedo[drawingRedo.length - 1];
		if (!next) return;
		drawingUndo = [...drawingUndo, copyDrawings()];
		drawingGroups = next;
		drawingRedo = drawingRedo.slice(0, -1);
	}
	function clearDrawings() {
		if (!drawingGroups.length) return;
		snapshotDrawings();
		drawingGroups = [];
		selectedDrawingGroupId = null;
	}
	function setDrawingPlayback(playback: DrawingGroup['playback']) {
		const group = selectedDrawingGroup;
		if (!group || group.playback === playback) return;
		snapshotDrawings();
		drawingGroups = drawingGroups.map((item) =>
			item.id === group.id ? { ...item, playback } : item
		);
	}
	function patchSelectedDrawingStyle(patch: Pick<DrawingStroke, 'color' | 'width' | 'opacity'>) {
		const group = selectedDrawingGroup;
		if (!group) return;
		snapshotDrawings();
		drawingGroups = drawingGroups.map((item) =>
			item.id === group.id
				? { ...item, strokes: item.strokes.map((stroke) => ({ ...stroke, ...patch })) }
				: item
		);
	}
	function patchDrawingGroup(id: string, patch: Partial<DrawingGroup>) {
		drawingGroups = drawingGroups.map((group) =>
			group.id === id ? { ...group, ...patch } : group
		);
	}
	/** Inspector edits are discrete operations, unlike a timeline drag. Keep them
	 * reversible without creating one undo step for every pointer-move event. */
	function commitDrawingGroupPatch(id: string, patch: Partial<DrawingGroup>) {
		const group = drawingGroups.find((item) => item.id === id);
		if (
			!group ||
			!Object.entries(patch).some(([key, value]) => group[key as keyof DrawingGroup] !== value)
		)
			return;
		snapshotDrawings();
		patchDrawingGroup(id, patch);
	}
	function beginDrawingTimelineEdit(id: string) {
		if (drawingGroups.some((group) => group.id === id)) snapshotDrawings();
	}
	function setDrawingVisibleFrom(seconds: number) {
		const group = selectedDrawingGroup;
		if (!group || !Number.isFinite(seconds)) return;
		const ms = Math.round(Math.max(0, Math.min(seconds, timelineDurationSec || seconds)) * 1000);
		commitDrawingGroupPatch(group.id, {
			startMs: ms,
			visibleFromMs: ms,
			...(group.visibleUntilMs !== undefined && group.visibleUntilMs < ms
				? { visibleUntilMs: ms }
				: {})
		});
	}
	function setDrawingVisibleUntil(seconds: number | null) {
		const group = selectedDrawingGroup;
		if (!group) return;
		if (seconds === null || !Number.isFinite(seconds)) {
			commitDrawingGroupPatch(group.id, { visibleUntilMs: undefined });
			return;
		}
		const ms = Math.round(
			Math.max(group.visibleFromMs, Math.min(seconds, timelineDurationSec || seconds)) * 1000
		);
		commitDrawingGroupPatch(group.id, { visibleUntilMs: ms });
	}
	function placeDrawingAtPlayhead() {
		setDrawingVisibleFrom(stageSeconds);
	}
	function removeDrawingGroup(id: string) {
		snapshotDrawings();
		const remaining = drawingGroups.filter((group) => group.id !== id);
		drawingGroups = remaining;
		selectedDrawingGroupId = remaining[0]?.id ?? null;
	}
	function moveDrawingGroup(id: string, direction: -1 | 1) {
		const index = drawingGroups.findIndex((group) => group.id === id);
		const nextIndex = index + direction;
		if (index < 0 || nextIndex < 0 || nextIndex >= drawingGroups.length) return;
		snapshotDrawings();
		const next = [...drawingGroups];
		[next[index]!, next[nextIndex]!] = [next[nextIndex]!, next[index]!];
		drawingGroups = next;
	}
	function splitDrawingAtPlayhead() {
		const group = selectedDrawingGroup;
		const atMs = Math.round(stageSeconds * 1000);
		if (!group) return;
		const endMs =
			group.visibleUntilMs ?? Math.round((meta?.duration ?? timelineDurationSec) * 1000);
		if (atMs <= group.visibleFromMs || atMs >= endMs) {
			toasts.info('Move the playhead inside the drawing clip to split it');
			return;
		}
		snapshotDrawings();
		const first: DrawingGroup = {
			...group,
			id: drawingId(),
			label: `${group.label} A`,
			// End one millisecond before the second window so translucent marker
			// strokes never double-paint at the split boundary.
			visibleUntilMs: atMs - 1
		};
		const second: DrawingGroup = {
			...group,
			id: drawingId(),
			label: `${group.label} B`,
			visibleFromMs: atMs,
			...(group.visibleUntilMs === undefined ? { visibleUntilMs: undefined } : {})
		};
		const index = drawingGroups.findIndex((item) => item.id === group.id);
		drawingGroups = [
			...drawingGroups.slice(0, index),
			first,
			second,
			...drawingGroups.slice(index + 1)
		];
		selectedDrawingGroupId = second.id;
	}
	/** Playhead for timed video overlays on the WYSIWYG stage. */
	let stageSeconds = $state(0);

	// ---- stage zoom (canvas size) --------------------------------------------
	/** View zoom for the WYSIWYG stage — 1 = fit (old behavior). Bigger steps
	 *  grow the canvas for detail work; overlay coords are normalized to the
	 *  stage box so zoom never disturbs them. Persisted per device. */
	let stageZoom = $state(1);

	function setStageZoom(next: number) {
		stageZoom = next;
		try {
			localStorage.setItem(STAGE_ZOOM_KEY, String(next));
		} catch {
			/* private mode — zoom just won't persist */
		}
	}

	function zoomStage(dir: 1 | -1) {
		const idx = STAGE_ZOOM_STEPS.findIndex((z) => Math.abs(z - stageZoom) < 0.001);
		const nextIdx = Math.min(STAGE_ZOOM_STEPS.length - 1, Math.max(0, (idx < 0 ? 2 : idx) + dir));
		setStageZoom(STAGE_ZOOM_STEPS[nextIdx]!);
	}

	// ---- artboard (output canvas size) ----------------------------------------
	/** The export canvas the stage previews: `source` keeps the loaded media's
	 *  own frame (the old behavior — now mirrored by the stage aspect so the
	 *  preview finally matches the export for EVERY media shape); the presets
	 *  cover-fit the media (a 16:9 clip on 9:16 crops to fill — mobile-first).
	 *  Overlay coordinates are normalized, so they land identically on any
	 *  artboard. Persisted per device. */
	let artboardId = $state<ArtboardId>('source');
	let customArtboard = $state({ width: 1080, height: 1920 });

	function setArtboard(next: ArtboardId) {
		artboardId = next;
		try {
			localStorage.setItem(ARTBOARD_KEY, next);
		} catch {
			/* private mode — the choice just won't persist */
		}
	}

	function setCustomArtboard(width: number, height: number) {
		customArtboard = { width, height };
		setArtboard('custom');
	}

	/** The media's natural frame (whatever is loaded), for `source`. `meta`
	 *  carries image dims too (onImageLoad) so framing reacts to loads. */
	const sourceFrame = $derived.by(() => {
		if (mediaKind && meta?.width && meta?.height) {
			return { width: meta.width, height: meta.height };
		}
		if (gif?.width && gif?.height) return { width: gif.width, height: gif.height };
		if (stageImg?.naturalWidth && stageImg?.naturalHeight) {
			return { width: stageImg.naturalWidth, height: stageImg.naturalHeight };
		}
		return null;
	});

	/** Export canvas dims — artboard preset or the source's own (capped). */
	const renderTarget = $derived.by(() => {
		if (artboardId === 'custom') return customArtboard;
		const ab = ARTBOARDS.find((a) => a.id === artboardId);
		if (ab && ab.w > 0) return { width: ab.w, height: ab.h };
		if (sourceFrame) return targetSize(sourceFrame);
		return { width: 1080, height: 1920 };
	});

	/** Stage aspect-ratio CSS — the preview mirrors the export canvas exactly. */
	const stageAspect = $derived.by(() => {
		if (artboardId === 'custom') return `${customArtboard.width} / ${customArtboard.height}`;
		if (artboardId === 'source' && sourceFrame) {
			return `${sourceFrame.width} / ${sourceFrame.height}`;
		}
		const ab = ARTBOARDS.find((a) => a.id === artboardId) ?? ARTBOARDS[0]!;
		return ab.w > 0 ? `${ab.w} / ${ab.h}` : '9 / 16';
	});

	// ---- crop & zoom (base-media framing) --------------------------------------
	/** Zoom ≥1 multiplies the cover fit; pan −1…1 travels the overflow per
	 *  axis. Layers/captions stay fixed to the artboard — only the media
	 *  moves. Mirrors render.ts coverRect exactly (the preview computes the
	 *  SAME rect in CSS, so the crop you see is the crop you export). */
	let mediaZoom = $state(1);
	let mediaPanX = $state(0);
	let mediaPanY = $state(0);
	const mediaTransform = $derived({ scale: mediaZoom, x: mediaPanX, y: mediaPanY });
	/** Live zoom-window transform at the current playhead (undefined = no
	 *  active window). Composed with the manual framing so a creator's crop
	 *  survives — the stage shows the exact rect every export path paints. */
	const activeZoomTransform = $derived(
		zoomTransformAt(zoomWindows, Math.round(stageSeconds * 1000))
	);
	const previewMediaTransform = $derived(
		composeZoomWithFraming(mediaTransform, activeZoomTransform)
	);
	/** Live frame-FX mirror at the playhead — CSS approximation of the exact
	 *  canvas painters (the GIF canvas stage runs the REAL painters in its
	 *  paint loop, so that path is exact by construction). */
	const previewFx = $derived(fxPreviewStyle(fxWindows, Math.round(stageSeconds * 1000)));

	/** Combined media-box filter: look preset + any active frame fx. */
	const previewMediaFilterCss = $derived(
		[lookCss !== 'none' ? lookCss : '', previewFx.mediaFilter ?? ''].filter(Boolean).join(' ') ||
			'none'
	);
	/** Zoom/fx composite transform for the media box (both are percentage
	 *  based; fx shake scales pair with the zoom framing). */
	const previewMediaBoxCss = $derived(previewFx.mediaTransform ?? '');

	/** Reset the manual framing (crop/zoom) — fresh eyes. */
	function resetFraming() {
		mediaZoom = 1;
		mediaPanX = 0;
		mediaPanY = 0;
	}

	/** The media's exact preview box (percent of the stage) — the same math
	 *  coverRect applies at export, expressed as CSS. */
	const mediaFrame = $derived.by(() => {
		const frame = sourceFrame;
		if (!frame) return null;
		// Percentages are relative to the stage, but the cover calculation itself
		// must use the real artboard ratio. Using a fixed square here made a
		// landscape remix look horizontally cropped in its source/16:9 preview,
		// even though the exporter correctly rendered the whole artboard.
		const rect = coverRect(
			frame.width,
			frame.height,
			renderTarget.width,
			renderTarget.height,
			previewMediaTransform
		);
		return {
			// A CSS percentage is relative to its own axis. Normalizing all four
			// values against 1000 (the old square reference) stretches/crops one
			// axis whenever the artboard is not square — exactly the black right
			// strip in the Remix preview.
			left: ((rect.x / renderTarget.width) * 100).toFixed(3),
			top: ((rect.y / renderTarget.height) * 100).toFixed(3),
			width: ((rect.w / renderTarget.width) * 100).toFixed(3),
			height: ((rect.h / renderTarget.height) * 100).toFixed(3)
		};
	});

	/** Same ratio as a number (w/h) — feeds the full-page stage width calc. */
	const stageRatio = $derived.by(() => {
		if (artboardId === 'custom' && customArtboard.height > 0) {
			return customArtboard.width / customArtboard.height;
		}
		if (artboardId === 'source' && sourceFrame && sourceFrame.height > 0) {
			return sourceFrame.width / sourceFrame.height;
		}
		const ab = ARTBOARDS.find((a) => a.id === artboardId) ?? ARTBOARDS[0]!;
		return ab.w > 0 ? ab.w / ab.h : 9 / 16;
	});

	// ---- preview transport + timeline ---------------------------------------
	/** Preview play state for the stage clock (video element clocks itself). */
	let previewPlaying = $state(false);
	/** Expert mode upgrades the base video from one trim window to an ordered
	 * sequence of non-destructive source clips. */
	let expertTimeline = $state(false);
	let videoClips = $state<VideoClip[]>([]);
	let selectedClipId = $state<string | null>(null);
	/** The base strip is selectable even before Expert mode, so its trim
	 * handles have the same clear selected state as captions and layers. */
	let selectedBaseTrack = $state(false);
	// ---- preview sound: source audio + live cue firing -----------------------
	/** Sound toggle for the preview: unmutes the stage video AND fires every
	 *  cue the playhead crosses — the timeline sounds like the export. */
	let previewSoundOn = $state(false);
	/** Carry the clip's own audio into video exports (video bases). Off = the
	 *  export keeps only the sound cues' mix. */
	let includeSourceAudio = $state(true);
	/** Source-video fader for the Expert audio mix. Cue gains live on each cue. */
	let sourceAudioGain = $state(1);
	/** Last playhead the cue scheduler saw (ms) — crossing windows only fire
	 *  on small forward deltas, so scrubs/seeks/media swaps never blip. */
	let lastCueFireMs = 0;
	/** Collapsed pinned transport bar (full layout) — hand the viewport to the stage. */
	let timelineCollapsed = $state(false);

	function togglePreviewSound() {
		previewSoundOn = !previewSoundOn;
		if (stageVideo) stageVideo.muted = !previewSoundOn;
	}

	/** Keep the stage video's mute state glued to the toggle (covers mounts,
	 *  media swaps and the muted-by-default autoplay attribute). */
	$effect(() => {
		if (stageVideo) {
			stageVideo.muted = !previewSoundOn;
			stageVideo.volume = sourceAudioGain;
		}
	});

	/** Live cue firing: while previewing with sound on, each cue the playhead
	 *  crosses plays immediately — synth recipes render on the fly, custom
	 *  sounds come from the decoded library. A cue parked at 0 fires once when
	 *  playback starts (the export mix includes t=0 too). */
	$effect(() => {
		void previewPlaying; // re-check on transport changes
		const cur = stageSeconds * 1000;
		if (!previewSoundOn) {
			lastCueFireMs = cur; // stay current so toggling on never back-fires
			return;
		}
		const prev = lastCueFireMs;
		lastCueFireMs = cur;
		const videoPlaying = mediaKind === 'video' && !!stageVideo && !stageVideo.paused;
		if (!(previewPlaying || videoPlaying)) return;
		const delta = cur - prev;
		if (delta <= 0 || delta > 600) return; // scrub/seek/loop-wrap guard
		for (const cue of sfxCues) {
			const crossed = cue.atMs > prev && cue.atMs <= cur;
			const startsNow = cue.atMs === 0 && prev === 0 && cur > 0;
			if (!crossed && !startsNow) continue;
			if (cue.sfx === CUSTOM_SOUND_KEY) {
				const sound = soundLibrary.list.find((s) => s.id === cue.soundId);
				if (sound) void previewSound(sound);
			} else {
				previewSfx(cue.sfx);
			}
		}
	});

	// ---- pinned export length (user request: “set 3s, 5s, 10s…”) --------------
	/** Chosen export length for GIF and sound-cue meme bases (null = auto:
	 *  the GIF's own duration / the cue track). Shorter trims; longer loops a
	 *  GIF to fill (the base painter modulo-repeats) or pads a cue meme with
	 *  silence.  This must be declared before the derived timeline values that
	 *  read it: otherwise TypeScript rejects the editor bundle before Remix can
	 *  open it. */
	let pinnedLengthSec = $state<number | null>(null);

	/** Total timeline length the playhead scrubs over, per media kind. A pinned
	 * Length is the project clock for GIF and image+sound projects as well as
	 * export — selecting 10s must produce a 10s ruler, not the raw cue length. */
	const timelineDurationSec = $derived(
		mediaKind === 'video'
			? expertTimeline && videoClips.length
				? clipsDuration(videoClips)
				: (meta?.duration ?? 0)
			: mediaKind === 'image'
				? gif
					? (pinnedLengthSec ?? gif.duration)
					: (pinnedLengthSec ?? (sfxCues.length ? cueTrackDurationSec(sfxCues) : 0))
				: 0
	);
	/** True when the timeline has a real clock (video trim duration, GIF, or
	 *  sound-on-static) — static memes without cues have nothing to scrub. */
	const timelineActive = $derived(
		mediaKind === 'video' ? (meta?.duration ?? 0) > 0 : timelineDurationSec > 0
	);

	function togglePreview() {
		if (mediaKind === 'video') {
			const video = stageVideo;
			if (!video) return;
			if (video.paused) {
				// Native `loop` only knows the whole source. Start playback at the
				// active trim window so transport and the 5s/10s ruler agree.
				const end = trimEndSec ?? meta?.duration ?? 0;
				if (!expertTimeline && (video.currentTime < trimStartSec || video.currentTime >= end)) {
					video.currentTime = trimStartSec;
				}
				void video.play();
			} else video.pause();
			// `onplay` / `onpause` on the element below update previewPlaying once
			// the browser has actually changed state.
			return;
		}
		previewPlaying = !previewPlaying;
	}

	/** Scrub the stage clock: video seeks the element; gif/static set the
	 *  playhead the paint loop / overlay visibility derives from. */
	function scrubPreview(sec: number) {
		const clamped = Math.max(0, Math.min(sec, timelineDurationSec || 0));
		if (mediaKind === 'video' && stageVideo) {
			// Hold the frame under the pointer. Leaving the looping video running
			// made its native clock immediately fight a mouse drag of the playhead.
			stageVideo.pause();
			const mapped = expertTimeline ? sourceTimeAt(videoClips, clamped) : null;
			if (mapped) selectedClipId = videoClips[mapped.clipIndex]?.id ?? null;
			stageVideo.currentTime = mapped?.sourceSec ?? clamped;
			stageSeconds = clamped;
		} else {
			previewSeconds = clamped;
			stageSeconds = clamped;
		}
	}

	/** Scrubbed playhead for gif/static previews (the paint loop chases it). */
	let previewSeconds = $state(0);

	/** FX transform → CSS (live preview mirrors the canvas renderer). */
	function overlayFxStyle(overlay: MemeTextOverlay): string {
		// Dead clock (static image, no cues): entrances render SETTLED — a pop
		// sticker at t=0 is scale-0, which made stickers invisible on image
		// memes ("the system thinks it's a video"). The export path agrees
		// (paintAll with no atMs = untransformed).
		if (!timelineActive) return '';
		const fx = fxTransformAt(overlay, stageSeconds * 1000);
		if (fx.scale === 1 && fx.rotate === 0 && fx.dx === 0 && fx.dy === 0 && fx.alpha === 1)
			return '';
		const parts: string[] = [];
		const w = stageBox?.clientWidth ?? 0;
		const h = stageBox?.clientHeight ?? 0;
		if (fx.dx || fx.dy)
			parts.push(`translate(${(fx.dx * w).toFixed(2)}px, ${(fx.dy * h).toFixed(2)}px)`);
		if (fx.rotate) parts.push(`rotate(${((fx.rotate * 180) / Math.PI).toFixed(1)}deg)`);
		if (fx.scale !== 1) parts.push(`scale(${fx.scale.toFixed(3)})`);
		const transform = parts.length ? `transform:${parts.join(' ')};` : '';
		const opacity = fx.alpha < 1 ? `opacity:${fx.alpha.toFixed(3)};` : '';
		return transform + opacity;
	}

	// ---- trim + speed (video sources; export-time window, preview plays it) --
	let trimStartSec = $state(0);
	let trimEndSec = $state<number | null>(null); // null = through the end
	let playbackRate = $state(1);
	/** Trim window in export seconds (media time − trimStart). */
	const trimDuration = $derived(
		mediaKind === 'video' && meta?.duration
			? Math.max(0, (trimEndSec ?? meta.duration) - trimStartSec)
			: 0
	);
	/** Preview + export duration after speed — the number creators care about. */
	const exportDurationSec = $derived(trimDuration / (playbackRate || 1));
	/** Export length with speed ramps integrated: the trim span mapped through
	 *  the window curve, then the base rate — drives the cue-mix length so
	 *  audio and pixels share one timeline (see speed-track.ts). */
	const mediaSpanExportSec = $derived(
		mediaMsToExportMs(speedWindows, trimDuration * 1000) / 1000 / (playbackRate || 1)
	);

	// Speed ramps in preview: while the stage video plays, drive its rate
	// through the window curve every frame (mirrors renderVideoMeme, so the
	// WYSIWYG stage shows the exact export timing). Paused scrubs keep the
	// frame — the rate only affects playback, never position.
	$effect(() => {
		const video = stageVideo;
		const windows = speedWindows;
		if (!video || mediaKind !== 'video' || !windows.length) return;
		let raf = 0;
		const apply = () => {
			const next = rateAt(windows, video.currentTime * 1000) * (playbackRate || 1);
			const clamped = Math.min(2, Math.max(0.5, next));
			if (Math.abs(video.playbackRate - clamped) > 0.001) video.playbackRate = clamped;
			raf = requestAnimationFrame(apply);
		};
		raf = requestAnimationFrame(apply);
		return () => {
			cancelAnimationFrame(raf);
			// Restore the creator's base rate on teardown (windows cleared /
			// media swapped) so a paused scrub doesn't inherit a ramp rate.
			if (stageVideo) stageVideo.playbackRate = playbackRate || 1;
		};
	});

	/** The base media as the timeline's first row: the video's trim window
	 *  (draggable) or the GIF loop with its pinned-length badge. Static images
	 *  have no clock row — their cue track already renders. */
	const baseTrack = $derived(
		mediaKind === 'video' && meta?.duration
			? {
					label: 'Video',
					startSec: trimStartSec,
					endSec: trimEndSec ?? meta.duration,
					draggable: true
				}
			: gif
				? {
						label: 'GIF',
						startSec: 0,
						endSec: pinnedLengthSec ?? gif.duration,
						badge:
							(pinnedLengthSec ?? gif.duration) > gif.duration + 0.05
								? `loops ×${Math.ceil((pinnedLengthSec ?? gif.duration) / gif.duration)}`
								: undefined
					}
				: null
	);

	/** The normal video editor works on the selected export window, not the
	 * whole source. Keep source timestamps in project state, but project them
	 * into a zero-based timeline so choosing “5s” immediately becomes a 5s
	 * ruler/playhead. Expert mode owns its own concatenated timeline. */
	const usesTrimmedTimeline = $derived(mediaKind === 'video' && !expertTimeline);
	const editorTimelineDurationSec = $derived(
		usesTrimmedTimeline ? trimDuration : timelineDurationSec
	);
	const editorTimelineSeconds = $derived(
		usesTrimmedTimeline
			? Math.max(0, Math.min(trimDuration, stageSeconds - trimStartSec))
			: stageSeconds
	);
	/** A Length change may make the current source-time playhead invalid. Keep
	 * the video element and the zero-based timeline ruler on the same window. */
	function clampPlayheadToTrimWindow(): void {
		if (mediaKind !== 'video') return;
		const end = trimEndSec ?? meta?.duration ?? 0;
		if (!end) return;
		const next = Math.max(
			trimStartSec,
			Math.min(stageSeconds, Math.max(trimStartSec, end - 0.001))
		);
		if (Math.abs(next - stageSeconds) < 0.0005) return;
		stageSeconds = next;
		previewSeconds = next;
		if (stageVideo) stageVideo.currentTime = next;
	}
	const timelineBaseTrack = $derived(
		usesTrimmedTimeline && baseTrack
			? { ...baseTrack, startSec: 0, endSec: trimDuration }
			: baseTrack
	);

	function projectTimedItem<T extends { startMs?: number; endMs?: number }>(item: T): T | null {
		if (!usesTrimmedTimeline) return item;
		const sourceDurationMs = (meta?.duration ?? 0) * 1000;
		const offsetMs = trimStartSec * 1000;
		const windowMs = trimDuration * 1000;
		const start = Math.max(0, (item.startMs ?? 0) - offsetMs);
		const end = Math.min(windowMs, (item.endMs ?? sourceDurationMs) - offsetMs);
		return end > start ? { ...item, startMs: Math.round(start), endMs: Math.round(end) } : null;
	}
	const timelineOverlays = $derived.by(() =>
		overlays.map(projectTimedItem).filter((item): item is MemeTextOverlay => item !== null)
	);
	const timelineLayers = $derived.by(() =>
		imageLayers.map(projectTimedItem).filter((item): item is MemeImageOverlay => item !== null)
	);
	const timelineDrawings = $derived.by(() => {
		if (!usesTrimmedTimeline) return drawingGroups;
		const offsetMs = trimStartSec * 1000;
		const windowMs = trimDuration * 1000;
		return drawingGroups.flatMap((group) => {
			const endMs = group.visibleUntilMs ?? (meta?.duration ?? 0) * 1000;
			const visibleFromMs = Math.max(0, group.visibleFromMs - offsetMs);
			const visibleUntilMs = Math.min(windowMs, endMs - offsetMs);
			if (visibleUntilMs <= visibleFromMs) return [];
			return [
				{
					...group,
					startMs: Math.max(0, group.startMs - offsetMs),
					visibleFromMs: Math.round(visibleFromMs),
					visibleUntilMs: Math.round(visibleUntilMs)
				}
			];
		});
	});
	const timelineCues = $derived.by(() =>
		usesTrimmedTimeline
			? sfxCues
					.filter(
						(cue) =>
							cue.atMs >= trimStartSec * 1000 &&
							cue.atMs <= (trimEndSec ?? meta?.duration ?? 0) * 1000
					)
					.map((cue) => ({ ...cue, atMs: Math.round(cue.atMs - trimStartSec * 1000) }))
			: sfxCues.filter((cue) => cue.atMs <= timelineDurationSec * 1000)
	);
	function patchFromTimeline(patch: { startMs?: number; endMs?: number }) {
		if (!usesTrimmedTimeline) return patch;
		const offsetMs = Math.round(trimStartSec * 1000);
		return {
			...(patch.startMs !== undefined ? { startMs: patch.startMs + offsetMs } : {}),
			...(patch.endMs !== undefined ? { endMs: patch.endMs + offsetMs } : {})
		};
	}
	function scrubTimeline(sec: number) {
		scrubPreview(usesTrimmedTimeline ? sec + trimStartSec : sec);
	}
	function patchTimelineBase(patch: { startMs?: number; endMs?: number }) {
		patchBaseWindow(patchFromTimeline(patch));
	}

	/** Timeline drag on the base video row = the trim window (same grammar as
	 *  the Trim & speed card: move slides, edges resize, 0.1s floor). */
	function patchBaseWindow(patch: { startMs?: number; endMs?: number }): void {
		const dur = meta?.duration ?? 0;
		if (mediaKind !== 'video' || !dur) return;
		const start = patch.startMs !== undefined ? patch.startMs / 1000 : trimStartSec;
		let end = patch.endMs !== undefined ? patch.endMs / 1000 : (trimEndSec ?? dur);
		// end == dur renders as "through the end" (null) so later duration
		// metadata changes don't leave a stale hard mark.
		if (Math.abs(end - dur) < 0.05) end = dur;
		if (end - start < 0.1) return; // dragging into itself — ignore
		trimStartSec = Math.max(0, Math.min(start, dur - 0.1));
		trimEndSec = end >= dur - 0.001 ? null : Math.min(end, dur);
	}

	/** Keep one side of the base video at the red playhead. Video export uses a
	 * contiguous trim window, so this is a true non-destructive cut: the source
	 * file stays untouched and the other side can be restored by dragging trim. */
	function cutVideoAtPlayhead(keep: 'before' | 'after'): void {
		const duration = meta?.duration ?? 0;
		const at = Math.max(0, Math.min(stageSeconds, duration));
		const start = trimStartSec;
		const end = trimEndSec ?? duration;
		if (mediaKind !== 'video' || !duration || at <= start + 0.1 || at >= end - 0.1) {
			toasts.info('Move the playhead inside the video window before cutting');
			return;
		}
		if (keep === 'before') trimEndSec = at;
		else trimStartSec = at;
		toasts.success(`Kept the ${keep === 'before' ? 'start' : 'end'} of the video`);
	}

	function enableExpertTimeline(): void {
		const duration = meta?.duration ?? 0;
		if (mediaKind !== 'video' || !duration) return;
		if (!videoClips.length) {
			const clip = makeVideoClip(trimStartSec, trimEndSec ?? duration);
			if (clip) {
				videoClips = [clip];
				selectedClipId = clip.id;
			}
		}
		expertTimeline = true;
	}

	function splitVideoClipAtPlayhead(): void {
		const wasExpert = expertTimeline;
		if (!wasExpert) enableExpertTimeline();
		// Before Expert mode the playhead is source time; after it, it is the
		// concatenated clip timeline. Convert exactly once for the first split.
		const timelineSec = wasExpert ? stageSeconds : stageSeconds - trimStartSec;
		const next = splitClipAt(videoClips, timelineSec);
		if (next === videoClips) {
			toasts.info('Move the playhead inside a video clip to split it');
			return;
		}
		videoClips = next;
		const mapped = sourceTimeAt(videoClips, timelineSec);
		selectedClipId = mapped ? (videoClips[mapped.clipIndex]?.id ?? null) : null;
		stageSeconds = Math.max(0, timelineSec);
		toasts.success('Video clip split at playhead');
	}

	function removeSelectedVideoClip(): void {
		if (!selectedClipId || videoClips.length <= 1) {
			toasts.info('Keep at least one video clip in the sequence');
			return;
		}
		videoClips = removeClip(videoClips, selectedClipId);
		selectedClipId = videoClips[0]?.id ?? null;
		scrubPreview(Math.min(stageSeconds, clipsDuration(videoClips)));
	}

	/** Split the selected caption or image layer into two independent windows at
	 * the playhead. The clone keeps the same visual settings and can then be
	 * moved, resized, or edited separately. */
	function splitSelectedAtPlayhead(): void {
		if (!timelineActive) return;
		const atMs = Math.round(stageSeconds * 1000);
		const endMs = Math.round(timelineDurationSec * 1000);
		if (selectedId) {
			const original = overlays.find((item) => item.id === selectedId);
			const start = original?.startMs ?? 0;
			const end = original?.endMs ?? endMs;
			if (!original || atMs <= start + 100 || atMs >= end - 100) {
				toasts.info('Put the playhead inside the selected caption to split it');
				return;
			}
			const { id: _id, ...copy } = original;
			void _id; // destructure-drop the old id — makeOverlay mints a fresh one
			const right = makeOverlay({ ...copy, startMs: atMs, endMs: end });
			overlays = overlays.flatMap((item) =>
				item.id === original.id ? [{ ...item, endMs: atMs }, right] : [item]
			);
			selectedId = right.id;
			toasts.success('Caption split at playhead');
			return;
		}
		if (selectedLayerId) {
			const original = imageLayers.find((item) => item.id === selectedLayerId);
			const start = original?.startMs ?? 0;
			const end = original?.endMs ?? endMs;
			if (!original || atMs <= start + 100 || atMs >= end - 100) {
				toasts.info('Put the playhead inside the selected image layer to split it');
				return;
			}
			const fresh = makeImageOverlay(original.src, original.aspect, { index: layerSeq++ });
			if (!fresh) return;
			const right = { ...original, id: fresh.id, startMs: atMs, endMs: end };
			imageLayers = imageLayers.flatMap((item) =>
				item.id === original.id ? [{ ...item, endMs: atMs }, right] : [item]
			);
			selectedLayerId = right.id;
			toasts.success('Image layer split at playhead');
			return;
		}
		toasts.info('Select a caption or image layer, then split it at the playhead');
	}

	/** Set the export window's LENGTH (user request: “set time 5s, 10s, 30s…”):
	 *  keeps the current start mark, caps at the source's remaining time and
	 *  the 90s video-meme limit — and says so when a preset doesn't fit. */
	function setTrimLength(sec: number | null): void {
		// null arrives from the GIF variant's "Full" chip — the video window has
		// no such control, so treat it as a no-op guard rather than a reset.
		if (sec === null) return;
		const dur = meta?.duration ?? 0;
		if (!Number.isFinite(sec) || sec <= 0 || !dur) return;
		const avail = Math.max(0, dur - trimStartSec);
		const capped = Math.min(sec, avail, MAX_VIDEO_MEME_SECONDS);
		trimEndSec = trimStartSec + capped;
		clampPlayheadToTrimWindow();
		toasts.info(`Timeline length set to ${formatDuration(capped)}`);
		if (sec > avail) {
			toasts.info(`Only ${formatDuration(avail)} left after the start mark — window capped`);
		} else if (sec > MAX_VIDEO_MEME_SECONDS) {
			toasts.info(`Video memes cap at ${MAX_VIDEO_MEME_SECONDS}s`);
		}
	}

	// ---- video frame strip (poster frame + scrubbing) ------------------------
	/** Poster frame data URL — picked on the strip, rides the publish imeta. */
	let posterDataUrl = $state<string | null>(null);
	let posterUploadedUrl = $state<string | null>(null);
	let posterBlob = $state<Blob | null>(null);
	/** Scrub position for the frame strip's playhead (media seconds). */
	let scrubSec = $state(0);
	/** Poster frame source seconds — pinned when the creator picks one. */
	let posterAtSec = $state<number | null>(null);
	/** Frame-strip thumbnails (data URLs) — rebuilt when a video loads. */
	let frameThumbs = $state<string[]>([]);
	const stripFrames = $derived(mediaKind === 'video' && !!meta?.duration);

	// ---- compose ---------------------------------------------------------------
	let caption = $state('');
	let sensitive = $state(false);
	// Remix rights (S-013, §17.3): advisory license stamped on every bitz
	// publish. Default CC-BY — derivatives allowed with credit.
	let license = $state<RemixLicense>('CC-BY-4.0');
	// AI-004: when the creator used AI suggestions (timelines, layouts…), an
	// `['ai', 'bitz-suggested']` tag rides the publish so downstream clients
	// can badge provenance. Manual toggle — we never guess.
	let aiAssisted = $state(false);
	let destinations = $state<Destination[]>(['bitz']);
	let publishDetailsOpen = $state(false);
	let fileInput = $state<HTMLInputElement | null>(null);
	let otherSourceInput = $state<HTMLInputElement | null>(null);
	let confirmDiscard = $state(false);
	// ---- format-first start (user request: “select type meme”) --------------------
	/** Which meme format the creator picked — filters the media chooser so the
	 *  file dialog opens pre-scoped (image / GIF / video). `all` = unfiltered. */
	let pickFormat = $state<'all' | MemeMediaFormat>('all');
	/** Pick media pre-scoped to a format: filters the chooser, then opens it. */
	async function pickMediaAs(format: MemeMediaFormat) {
		pickFormat = format;
		await tick(); // let the accept attribute update before the dialog opens
		fileInput?.click();
	}
	/** Tracks which overlay's timing row is expanded. */
	let timingId = $state<string | null>(null);
	/** Open motion-fx popover for this caption (video memes). */
	let fxId = $state<string | null>(null);
	/** Saved-template popover id + inline save-name input. */
	let showTemplateSave = $state(false);
	let templateName = $state('');
	/** A saved template becomes the starting layout for the next chosen media. */
	let preserveLayoutOnNextMedia = $state(false);
	/** Draft-slot popover: named WIP snapshots (save now, resume later). */
	let slotName = $state('');
	let slotBusyId = $state('');

	// ---- sticker picker (#3) --------------------------------------------------
	// (UI lives in MemeStickerPicker.svelte — this is the state it drives.)
	let stickerMenuId = `meme-stickers-${Math.random().toString(36).slice(2, 8)}`;
	let buddyMenuId = `meme-buddy-${Math.random().toString(36).slice(2, 8)}`;
	/** Sticker count this session — feeds the anchor rotation so consecutive
	 *  stickers land on different spots instead of stacking. */
	let stickerSeq = 0;

	function addSticker(emoji: string) {
		if (overlays.length >= 12) {
			toasts.info('Twelve overlays is the meme limit');
			return;
		}
		let sticker = makeSticker(emoji, { index: stickerSeq++ });
		// Entrance fx (pop) starts at the playhead so the sticker visibly lands
		// on timeline sources; loop fx (spin) stays always-visible.
		if (sticker.fx === 'pop' && timelineActive) {
			sticker = { ...sticker, startMs: Math.round(stageSeconds * 1000) };
		}
		overlays = [...overlays, sticker];
		selectedId = sticker.id;
		timingId = null;
	}

	// ---- image overlays (user request 2026-08-23, rec #1): PNG/GIF/JPEG layers
	// dropped onto the stage as movable + resizable accedns. Sources: local file,
	// direct URL, or the GIF library. `src` is always a remote http(s) URL —
	// bytes go to the media provider first, never into localStorage or the
	// `meme` wire tag.
	let imageLayers = $state<MemeImageOverlay[]>([]);

	// Layer motion clock (layer-motion.ts): one rAF loop while ANY layer has
	// a motion preset, feeding the live phase to the stage. Video bases use
	// the media clock (stageSeconds) so preview matches export timing; static
	// bases get a wall-clock loop so buddy stickers still bounce on image
	// memes. No motions → no loop (zero idle cost).
	let motionTickMs = $state(0);
	$effect(() => {
		if (!imageLayers.some((l) => layerMotionOf(l.motionId) !== 'none')) return;
		if (timelineActive && mediaKind === 'video') {
			// Derived from the media clock — same timeline the export paints.
			const video = stageVideo;
			let raf = 0;
			const tick = () => {
				motionTickMs = Math.round((video?.currentTime ?? 0) * 1000);
				raf = requestAnimationFrame(tick);
			};
			raf = requestAnimationFrame(tick);
			return () => cancelAnimationFrame(raf);
		}
		// Static/GIF base: wall-clock loop from mount — the export paints these
		// with the same wall-clock convention (see render.ts image-meme path).
		let raf = 0;
		const t0 = performance.now();
		const tick = () => {
			motionTickMs = Math.round(performance.now() - t0);
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	});
	let layerSeq = 0;
	/** Every per-src layer resource — decoded bitmaps, render URLs, bytes,
	 *  GIF decoders and export painters (stores/meme-layer-assets.svelte).
	 *  The component owns the layer ROWS; the store owns the bytes they use. */
	const layerAssets = new LayerAssetCache();

	/** Bitmap decode -> cache; reallocates imageLayers so the layer rows and
	 *  the stage repaint once the bitmap lands (store owns bytes, the
	 *  component owns the rerender). */
	function cacheLayerBitmap(src: string): Promise<boolean> {
		return layerAssets.cacheBitmap(src, () => (imageLayers = [...imageLayers]));
	}
	let layerInput = $state<HTMLInputElement | null>(null);
	let layerBusy = $state(false);
	let imageMenuId = `meme-image-${Math.random().toString(36).slice(2, 8)}`;
	let showLayerUrlForm = $state(false);
	let layerUrl = $state('');
	let layerUrlBusy = $state(false);

	/** CORS-minded byte fetch for URL-sourced layers (cap-checked, null on any

	/** Keep the bytes we already have as the render source for a remote src.

	/** Buddy stickers have no file name — label them from the catalog. */
	function buddyFigureLabel(src: string): string {
		return isBuddySrc(src)
			? `Bitz Buddy ${buddyFigure(src.slice('/bitz-buddy/'.length, -4))?.label ?? 'sticker'}`
			: '';
	}

	/** Add a layer from bytes and/or a remote URL. Rendering always prefers
	 *  the bytes (same-origin blob → export-safe); the media provider re-homes
	 *  them best-effort so drafts and the wire keep plain https srcs. */
	async function addImageLayer(
		source: { url?: string; bytes?: Blob; name?: string; motionId?: string },
		aspectHint?: number,
		opts: { atMs?: number } = {}
	) {
		if (imageLayers.length >= MAX_IMAGE_OVERLAYS) {
			toasts.info(`Image layers max out at ${MAX_IMAGE_OVERLAYS}`);
			return;
		}
		let bytes: Blob | undefined = source.bytes;
		let url = source.url?.trim() ?? '';
		let aspect = aspectHint ?? 1;
		// SVG layers rasterize to PNG ONCE here: SVGs without intrinsic
		// width/height decode as 0×0 (broken preview) and paint NOTHING on the
		// export canvas. Every path after this point is plain-PNG. A failed
		// raster (foreignObject, broken markup) errors out honestly.
		if (bytes && (await looksLikeSvg(bytes))) {
			const png = await rasterizeSvgBlob(bytes);
			if (!png) {
				toasts.error('That SVG could not be converted — try a PNG export from your design tool');
				return;
			}
			bytes = png;
			url = ''; // old URL is stale — the rasterized PNG below gets a fresh home
		}
		// URL-only: pull the bytes once so the canvas never sees a
		// cross-origin image (the "not same origin" export failure).
		if (!bytes && url) bytes = (await fetchLayerBlob(url)) ?? undefined;
		if (bytes) {
			if (bytes.size > MAX_IMAGE_OVERLAY_BYTES) {
				toasts.error('That image is over the 8 MB layer cap');
				return;
			}
			const probe = await probeAspect(bytes);
			aspect = probe ?? aspect;
		}
		// Device files have no canonical URL — they need a remote home to
		// persist in drafts/wire. URL-sourced layers (GIF picker, pasted
		// links, bundled buddy stickers) KEEP their source URL: the bytes we
		// already hold render and export locally, and the published media has
		// the pixels burned in — re-uploading CDN content to the provider
		// would just duplicate it.
		let src = url;
		if (bytes && !src) {
			try {
				const file = new File([bytes], source.name ?? 'layer', {
					type: bytes.type || 'image/png'
				});
				const uploaded = await media.upload(file, undefined, {
					pubkey: me?.pk,
					purpose: 'note'
				});
				src = uploaded.url;
			} catch {
				toasts.error('Layer upload failed — check your connection and try again');
				return;
			}
		}
		if (!layerSrcOk(src)) {
			toasts.error('Image layers need an https URL');
			return;
		}
		const layer = makeImageOverlay(src, aspect, { index: layerSeq++ });
		if (!layer) {
			toasts.error('Could not use that image URL');
			return;
		}
		// Drop-in ambient motion (buddy picker feel; templates may set it too).
		if (source.motionId) layer.motionId = layerMotionOf(source.motionId) || undefined;
		// Timeline insert: window [playhead, playhead+2s] on timed sources;
		// static memes have no clock, so the layer stays always-visible.
		if (opts.atMs !== undefined && timelineActive) {
			layer.startMs = Math.max(0, Math.round(opts.atMs));
			layer.endMs = layer.startMs + 2000;
		}
		imageLayers = [...imageLayers, layer];
		selectedLayerId = layer.id;
		selectedId = null;
		selectedCueId = null;
		selectedBaseTrack = false;
		if (bytes) layerAssets.rememberBytes(layer.src, bytes);
		mediaLibrary.remember(layer.src, source.name ?? buddyFigureLabel(src), bytes?.type);
		const ok = await cacheLayerBitmap(layer.src);
		if (!ok) toasts.warning('Layer added — but the image failed to load (will retry on export)');
		// Animated GIF layers keep their motion in previews AND exports;
		// static layers just fall through to the bitmap path. Browsers without
		// WebCodecs ImageDecoder (Safari/Firefox) can't — say so up front.
		void layerAssets.cacheGif(layer.src).then((animated) => {
			if (!animated && layerAssets.looksAnimatedGif(layer.src) && !canDecodeGif()) {
				toasts.info(
					'This GIF plays in the preview but exports as a still on this browser — Chrome or Edge keeps layers moving',
					5000
				);
			}
		});
	}

	/** Read natural aspect without keeping the decoder around. */

	function removeLayer(id: string) {
		const gone = imageLayers.find((l) => l.id === id);
		imageLayers = imageLayers.filter((l) => l.id !== id);
		if (selectedLayerId === id) selectedLayerId = null;
		// Release the per-src assets when no remaining layer references it.
		if (gone && !imageLayers.some((l) => l.src === gone.src)) {
			layerAssets.release(gone.src);
		}
	}

	/** Duplicate a selected image layer as an independently editable copy.
	 * Offset it very slightly so it is immediately discoverable on the stage. */
	function duplicateLayer(id: string) {
		if (imageLayers.length >= MAX_IMAGE_OVERLAYS) {
			toasts.info(`Image layers max out at ${MAX_IMAGE_OVERLAYS}`);
			return;
		}
		const original = imageLayers.find((layer) => layer.id === id);
		if (!original) return;
		const fresh = makeImageOverlay(original.src, original.aspect, { index: layerSeq++ });
		if (!fresh) return;
		const copy: MemeImageOverlay = {
			...original,
			id: fresh.id,
			x: clamp01(original.x + 0.035),
			y: clamp01(original.y + 0.035)
		};
		const index = imageLayers.findIndex((layer) => layer.id === id);
		imageLayers = [...imageLayers.slice(0, index + 1), copy, ...imageLayers.slice(index + 1)];
		selectedLayerId = copy.id;
		selectedId = null;
		toasts.success('Image layer duplicated');
	}

	function patchLayer(id: string, patch: Partial<MemeImageOverlay>) {
		imageLayers = imageLayers.map((l) => (l.id === id ? { ...l, ...patch } : l));
	}

	/** Per-layer color look → CSS filter (mirror of render.ts's paint path). */
	function layerLookCss(layer: MemeImageOverlay): string {
		return layer.lookId && layer.lookId !== 'none' ? memeLookCss(layer.lookId) : 'none';
	}

	/** The layer the inspector edits (null = nothing selected). */
	const selectedLayer = $derived(imageLayers.find((l) => l.id === selectedLayerId) ?? null);

	/** Reorder = z-order: later array slots paint on top (paintImageOverlays). */
	function moveLayerRow(id: string, dir: -1 | 1) {
		const idx = imageLayers.findIndex((l) => l.id === id);
		const next = idx + dir;
		if (idx < 0 || next < 0 || next >= imageLayers.length) return;
		const list = [...imageLayers];
		const [row] = list.splice(idx, 1);
		list.splice(next, 0, row!);
		imageLayers = list;
	}

	/** One-shot playhead stamp for the NEXT layer added via the file picker
	 *  (the picker flow can't take arguments — set → click → consumed here). */
	let pendingLayerAtMs: number | null = null;

	/** Layer picker input → upload → layers. Multi-select lands one layer per
	 *  file; playhead inserts stagger 250ms apart (mirrors the GIF volley). */
	function onLayerFileInput(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const picked = [...(input.files ?? [])];
		input.value = '';
		const atMs = pendingLayerAtMs;
		pendingLayerAtMs = null; // one-shot, always cleared
		const files = picked.filter((f) => f.type.startsWith('image/'));
		if (!files.length) {
			if (picked.length) toasts.error('Layers take PNG, GIF, JPEG, WebP or SVG images');
			return;
		}
		const room = MAX_IMAGE_OVERLAYS - imageLayers.length;
		if (room <= 0) {
			toasts.info(`Image layers max out at ${MAX_IMAGE_OVERLAYS}`);
			return;
		}
		if (files.length > room) {
			toasts.info(`Adding ${room} of ${files.length} — the layer cap is ${MAX_IMAGE_OVERLAYS}`);
		}
		layerBusy = true;
		Promise.all(
			files.slice(0, room).map((file, i) =>
				addImageLayer({ bytes: file, name: file.name }, undefined, {
					atMs: atMs !== null ? atMs + i * 250 : undefined
				}).catch((err) => toasts.error(err instanceof Error ? err.message : 'Layer upload failed'))
			)
		).finally(() => (layerBusy = false));
	}

	/** Replace a layer's image in place: keeps position, size, timing, look,
	 *  motion, opacity and flips — only src/aspect swap (user ask
	 *  2026-08-25: "layer image … change replaces image"). SVG inputs
	 *  rasterize through the same addImageLayer path. */
	async function replaceLayerImage(
		id: string,
		source: { url?: string; bytes?: Blob; name?: string }
	) {
		const original = imageLayers.find((l) => l.id === id);
		if (!original) return;
		let bytes: Blob | undefined = source.bytes;
		if (bytes && (await looksLikeSvg(bytes))) {
			const png = await rasterizeSvgBlob(bytes);
			if (!png) {
				toasts.error('That SVG could not be converted — try a PNG export from your design tool');
				return;
			}
			bytes = png;
		}
		let url = source.url?.trim() ?? '';
		if (!bytes && url) bytes = (await fetchLayerBlob(url)) ?? undefined;
		let aspect = original.aspect;
		if (bytes) {
			if (bytes.size > MAX_IMAGE_OVERLAY_BYTES) {
				toasts.error('That image is over the 8 MB layer cap');
				return;
			}
			aspect = (await probeAspect(bytes)) ?? aspect;
		}
		let src = url;
		if (bytes && !src) {
			try {
				const file = new File([bytes], source.name ?? 'layer', {
					type: bytes.type || 'image/png'
				});
				const uploaded = await media.upload(file, undefined, {
					pubkey: me?.pk,
					purpose: 'note'
				});
				src = uploaded.url;
			} catch {
				toasts.error('Layer upload failed — check your connection and try again');
				return;
			}
		}
		if (!layerSrcOk(src)) {
			toasts.error('Image layers need an https URL');
			return;
		}
		// Swap the row; per-src assets follow (release the old src when this
		// was its last reference, remember bytes + decode the new bitmap).
		imageLayers = imageLayers.map((l) => (l.id === id ? { ...l, src, aspect } : l));
		if (!imageLayers.some((l) => l.src === original.src && l.id !== id)) {
			layerAssets.release(original.src);
		}
		if (bytes) layerAssets.rememberBytes(src, bytes);
		mediaLibrary.remember(src, source.name ?? '', bytes?.type);
		const ok = await cacheLayerBitmap(src);
		if (!ok) toasts.warning('Image replaced — but it failed to load (will retry on export)');
		else toasts.success('Layer image replaced');
	}

	/** One-shot layer id for the NEXT replace-image picker run (the file
	 *  picker flow can't take arguments — set → click → consumed here). */
	let replaceLayerForId: string | null = null;
	let replaceLayerInput = $state<HTMLInputElement | null>(null);

	function onReplaceLayerInput(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const picked = [...(input.files ?? [])];
		input.value = '';
		const id = replaceLayerForId;
		replaceLayerForId = null; // one-shot, always cleared
		const file = picked.find((f) => f.type.startsWith('image/'));
		if (!file) {
			if (picked.length) toasts.error('Layers take PNG, GIF, JPEG, WebP or SVG images');
			return;
		}
		if (!id) return;
		void replaceLayerImage(id, { bytes: file, name: file.name }).catch((err) =>
			toasts.error(err instanceof Error ? err.message : 'Could not replace that image')
		);
	}

	/** Direct-URL layer form. */
	async function addLayerFromUrl(atMs?: number) {
		const url = layerUrl.trim();
		if (!url || layerUrlBusy) return;
		layerUrlBusy = true;
		try {
			await addImageLayer({ url }, undefined, { atMs });
			layerUrl = '';
			showLayerUrlForm = false;
		} catch (e) {
			toasts.error(e instanceof Error ? e.message : 'Could not add that layer');
		} finally {
			layerUrlBusy = false;
		}
	}

	/** GIF-library pick → sticker-size layer (NOT the base media swap). */
	async function addLayerFromGifLib(gif: GifChoice, atMs?: number) {
		popovers.close();
		layerBusy = true;
		try {
			const aspect = gif.width && gif.height ? gif.width / gif.height : undefined;
			await addImageLayer({ url: gif.url }, aspect, { atMs });
		} finally {
			layerBusy = false;
		}
	}

	/** Insert another source straight from the current video: grab the frame at
	 *  the playhead, upload it, drop it on the stage as a movable image layer
	 *  (user request: “insert other source image-vdo”). */
	async function insertFrameLayer(): Promise<void> {
		if (!stageVideo) {
			toasts.error('Load a video first — then scrub to the frame you want');
			return;
		}
		layerBusy = true;
		try {
			const blob = await grabVideoFrame(stageVideo, Math.max(0, stageSeconds), {});
			const frame = new File([blob], `frame-${Date.now()}.jpg`, { type: 'image/jpeg' });
			await addImageLayer({ bytes: frame, name: frame.name });
		} catch (e) {
			toasts.error(e instanceof Error ? e.message : 'Could not grab that frame');
		} finally {
			layerBusy = false;
		}
	}

	let selectedLayerId = $state<string | null>(null);
	/** Expanded layer-timing row (mirrors the captions' timingId). */
	let layerTimingId = $state<string | null>(null);
	/** Timeline Image-@ insert popover + its inline URL form. */
	let tlImageMenuId = `meme-tl-image-${Math.random().toString(36).slice(2, 8)}`;
	let showTlLayerUrlForm = $state(false);
	let layerDrag: { id: string; dx: number; dy: number; mode: 'move' | 'resize' } | null = null;

	function onLayerPointerDown(
		event: PointerEvent,
		layer: MemeImageOverlay,
		mode: 'move' | 'resize' = 'move'
	) {
		if (busy) return;
		const box = stageBox?.getBoundingClientRect();
		if (!box) return;
		selectedLayerId = layer.id;
		selectedId = null;
		selectedCueId = null;
		selectedBaseTrack = false;
		timingId = null;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		layerDrag = {
			id: layer.id,
			mode,
			dx: (event.clientX - box.left) / box.width - layer.x,
			dy: (event.clientY - box.top) / box.height - layer.y
		};
	}

	// ---- remix chain (plan §17 creator economy, rec #1) -----------------------
	/** What the current project derives from — attached to the published event
	 *  as `remix`/`meme` tags so the next creator in the chain can remix in
	 *  one tap. Cleared when the media is replaced or the studio resets. */
	let remixSource = $state<RemixSource | null>(null);
	/** Attribution credit for the source meme, stamped when remixing (§17.3). */
	let sourceCredit = $state('');

	// ---- value splits (CRE-008, section 7.2) ----------------------------------------
	/** Draft manifest - empty means "no splits declared" (opt-in); rows only
	 *  reach the wire once the 10,000-bps total is exact. */
	let splitRows = $state<SplitRow[]>([]);
	/** Drawer visibility for the splits editor below the license picker. */
	let splitsOpen = $state(false);
	const splitCheck = $derived(
		splitRows.length ? validateSplits(splitRows) : ({ ok: true } as const)
	);
	/** Advisory license menu (S-013) — labels kept human, codes on the wire. */
	let remixLabel = $state('');

	// ---- publish state --------------------------------------------------------
	let phase = $state<Phase>('idle');
	let progress = $state(0);
	let progressLabel = $state('');
	let selectedProvider = $state<MediaProviderId | 'none'>(media.state.defaultProvider);
	let powProgress = $state<PowProgress | null>(null);
	let showPow = $state(false);
	let pow = $state(powPrefs.state.lastDifficulty);
	let mineController: AbortController | undefined;

	const MAX_MEDIA_BYTES = 200 * 1024 * 1024;
	// MAX_VIDEO_MEME_SECONDS lives in $lib/meme/cue-track (shared with the
	// suggestion path so the analysis window and export window always agree).
	const SOFT_CAP = 300;
	const HARD_CAP = 1000;

	const me = $derived(identity.current);
	const busy = $derived(phase !== 'idle');
	const dirty = $derived(
		!!file ||
			overlays.some((o) => o.text.trim()) ||
			!!caption.trim() ||
			drawingGroups.length > 0 ||
			imageLayers.length > 0 ||
			sfxCues.length > 0
	);
	const canPost = $derived(!!file && !busy && caption.length <= HARD_CAP && splitCheck.ok);
	/** Orientation of the EXPORTED file (artboard or source frame), not the
	 *  source media — a portrait clip cropped to a 16:9 artboard publishes as
	 *  kind 21 (landscape), matching what clients actually play. */
	const portrait = $derived(renderTarget.height >= renderTarget.width);
	const writeRelayCount = $derived(relays.list.filter((r) => r.write).length);
	const videoMemeSupported = $derived(
		(mediaKind !== 'video' && !(mediaKind === 'image' && sfxCues.length > 0)) ||
			canRenderVideoMeme()
	);
	const kindInfo = $derived.by(() => {
		if (mediaKind === 'image') {
			// Sound-on-static ships as a video file, so publish under NIP-71.
			if (sfxCues.length > 0) {
				return portrait
					? { label: 'Sound meme', kind: 22, nip: 'NIP-71' }
					: { label: 'Sound meme', kind: 21, nip: 'NIP-71' };
			}
			return { label: 'Photo meme', kind: 20, nip: 'NIP-68' };
		}
		if (mediaKind === 'video') {
			return portrait
				? { label: 'Video meme', kind: 22, nip: 'NIP-71' }
				: { label: 'Video meme', kind: 21, nip: 'NIP-71' };
		}
		return null;
	});

	// ---- drag logic (pointer events, works with touch) -----------------------
	let dragState: { id: string; dx: number; dy: number } | null = null;

	function onOverlayPointerDown(event: PointerEvent, overlay: MemeTextOverlay) {
		if (busy) return;
		const box = stageBox?.getBoundingClientRect();
		if (!box) return;
		selectedId = overlay.id;
		selectedLayerId = null;
		selectedCueId = null;
		selectedBaseTrack = false;
		timingId = null;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		dragState = {
			id: overlay.id,
			dx: (event.clientX - box.left) / box.width - overlay.x,
			dy: (event.clientY - box.top) / box.height - overlay.y
		};
	}

	function onStagePointerMove(event: PointerEvent) {
		if (layerDrag) {
			const box = stageBox?.getBoundingClientRect();
			const layer = box ? imageLayers.find((l) => l.id === layerDrag!.id) : undefined;
			if (box && layer) {
				if (layerDrag.mode === 'resize') {
					const y = clamp01((event.clientY - box.top) / box.height);
					// Pointer-to-center distance, doubled = new height (the bottom
					// edge follows the pointer; at rest this reproduces `size`).
					const next = (y - layer.y) * 2;
					patchLayer(layer.id, { size: Math.min(0.9, Math.max(0.05, next)) });
				} else {
					patchLayer(layer.id, {
						x: clamp01((event.clientX - box.left) / box.width - layerDrag.dx),
						y: clamp01((event.clientY - box.top) / box.height - layerDrag.dy)
					});
				}
			}
			return;
		}
		if (!dragState) return;
		const box = stageBox?.getBoundingClientRect();
		if (!box) return;
		const x = clamp01((event.clientX - box.left) / box.width - dragState.dx);
		const y = clamp01((event.clientY - box.top) / box.height - dragState.dy);
		overlays = overlays.map((o) => (o.id === dragState!.id ? { ...o, x, y } : o));
	}

	function endDrag() {
		dragState = null;
		layerDrag = null;
	}

	/** Copy the renderer's own font stack so DOM preview ≙ canvas export. */
	function fontStack(font: MemeFont): string {
		const stacks: Record<MemeFont, string> = {
			impact: '"Impact", "Haettenschweiler", "Arial Black", sans-serif',
			sans: 'system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
			serif: 'Georgia, "Times New Roman", serif',
			mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'
		};
		return stacks[font];
	}

	/** Stage-relative font size in px for a live overlay. */
	function overlayPx(overlay: MemeTextOverlay): number {
		const height = stageBox?.clientHeight || 480;
		return Math.max(10, overlay.size * height);
	}

	// Re-paint live overlays onto the WYSIWYG stage. The video's own `ontimeupdate`
	// updates `stageSeconds`, and $derived overlay lists pick up timing windows —
	// no manual rAF loop needed.

	// ---- media handling ------------------------------------------------------
	function revokePreview() {
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		previewUrl = '';
	}
	function reset() {
		stopPerformanceRecording();
		revokePreview();
		file = null;
		mediaKind = null;
		meta = null;
		resetGif();
		sfxCues = [];
		overlays = [];
		zoomWindows = [];
		fxWindows = [];
		speedWindows = [];
		drawingGroups = [];
		drawingUndo = [];
		drawingRedo = [];
		performanceTakes = [];
		performanceReviewId = null;
		selectedDrawingGroupId = null;
		for (const layer of imageLayers) layerAssets.release(layer.src);
		imageLayers = [];
		selectedLayerId = null;
		layerDrag = null;
		selectedId = null;
		timingId = null;
		caption = '';
		sensitive = false;
		confirmDiscard = false;
		showTemplateSave = false;
		templateName = '';
		preserveLayoutOnNextMedia = false;
		remixSource = null;
		remixLabel = '';
		sourceCredit = '';
		trimStartSec = 0;
		trimEndSec = null;
		playbackRate = 1;
		expertTimeline = false;
		videoClips = [];
		selectedClipId = null;
		pinnedLengthSec = null;
		resetFraming();
		clearPoster();
		scrubSec = 0;
		phase = 'idle';
		progress = 0;
		progressLabel = '';
		powProgress = null;
		mineController = undefined;
	}

	function resetGif() {
		gif?.close();
		gif = null;
	}

	// Static + sound-cue stage: no media element drives the clock, so a plain
	// ticker advances stageSeconds through cue-track duration while playing.
	// (Same contract as the GIF effect below: pause → scrub repaints, play →
	// real-time loop so the timeline playhead, cue ticks and overlay fx ride it.)
	$effect(() => {
		const playing = previewPlaying && mediaKind !== 'video' && !gif && timelineDurationSec > 0;
		if (!playing) return;
		const startedAt = performance.now() - previewSeconds * 1000;
		let raf = 0;
		const tick = () => {
			const elapsed = (performance.now() - startedAt) / 1000;
			const looped = elapsed % timelineDurationSec;
			previewSeconds = looped;
			stageSeconds = looped;
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	});

	// GIF stage preview: repaint on the animation-frame clock while a decoded
	// GIF is loaded. stageSeconds doubles as the SFX cue playhead. Transport:
	// paused → paint the scrubbed frame; playing → advance the clock in real
	// time (the timeline playhead and overlay fx ride the same value).
	$effect(() => {
		const canvas = gifStageCanvas;
		const decoded = gif;
		const playing = previewPlaying;
		if (!decoded || !canvas) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		canvas.width = decoded.width;
		canvas.height = decoded.height;
		let raf = 0;
		if (playing) {
			// Real-time clock, looped to the GIF duration.
			const startedAt = performance.now() - previewSeconds * 1000;
			const paint = () => {
				const elapsed = (performance.now() - startedAt) / 1000;
				const looped = elapsed % decoded.duration;
				previewSeconds = looped;
				stageSeconds = looped;
				ctx.fillStyle = '#000';
				ctx.fillRect(0, 0, canvas.width, canvas.height);
				paintGifFrameAt(
					ctx,
					decoded,
					looped,
					canvas,
					composeZoomWithFraming(
						mediaTransform,
						zoomTransformAt(zoomWindows, Math.round(looped * 1000))
					)
				);
				if (fxWindows.length) paintFxFrame(ctx, fxWindows, Math.round(looped * 1000), canvas);
				raf = requestAnimationFrame(paint);
			};
			raf = requestAnimationFrame(paint);
			return () => cancelAnimationFrame(raf);
		}
		// Paused / scrubbing: paint the current playhead once per change.
		ctx.fillStyle = '#000';
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		paintGifFrameAt(
			ctx,
			decoded,
			previewSeconds,
			canvas,
			composeZoomWithFraming(
				mediaTransform,
				zoomTransformAt(zoomWindows, Math.round(previewSeconds * 1000))
			)
		);
		if (fxWindows.length) paintFxFrame(ctx, fxWindows, Math.round(previewSeconds * 1000), canvas);
	});

	async function acceptFile(
		next: File | null,
		opts: { keepRemix?: boolean; keepLayout?: boolean } = {}
	) {
		if (!next) return;
		const isGif = next.type === 'image/gif';
		const kind = next.type.startsWith('video/')
			? ('video' as const)
			: next.type.startsWith('image/')
				? ('image' as const)
				: null;
		if (!kind) {
			toasts.error('Memes start from a picture, GIF or video');
			return;
		}
		if (next.size > MAX_MEDIA_BYTES) {
			toasts.error(`That file is ${humanBytes(next.size)} — the cap is 200 MB`);
			return;
		}
		if (busy) return;
		const keepLayout = opts.keepLayout || preserveLayoutOnNextMedia;
		confirmDiscard = false;
		revokePreview();
		file = next;
		mediaKind = kind;
		// Poster frames belong to the previous clip — drop them on any media change.
		clearPoster();
		scrubSec = 0;
		// A length preset belongs to the previous GIF's duration.
		pinnedLengthSec = null;
		// Fresh media breaks the remix lineage (the remix handoff opts back in
		// via keepRemix — e.g. when the source media failed to fetch and the
		// creator picks their own clip for the remixed layout).
		if (!opts.keepRemix) {
			remixSource = null;
			remixLabel = '';
		}
		meta = null;
		previewPlaying = false;
		expertTimeline = false;
		videoClips = [];
		selectedClipId = null;
		// Swaps may keep the caption layout + layers + cues (normalized coords
		// make them media-agnostic); a fresh pick starts clean, as before.
		if (!keepLayout) {
			overlays = [];
			imageLayers = [];
			selectedLayerId = null;
			sfxCues = [];
			zoomWindows = [];
			fxWindows = [];
			speedWindows = [];
			selectedId = null;
			timingId = null;
		}
		// A new draft created from a saved template keeps its layout for exactly
		// one source selection, then fresh picks return to their normal behavior.
		preserveLayoutOnNextMedia = false;
		previewUrl = URL.createObjectURL(next);
		// Animated GIFs decode into a timed frame reel (overlay timing + SFX cues
		// ride the stage clock). Static images and videos skip this entirely.
		if (isGif && canDecodeGif()) {
			try {
				const decoded = await decodeGif(await next.arrayBuffer());
				resetGif();
				gif = decoded;
				meta = { width: decoded.width, height: decoded.height, duration: decoded.duration };
			} catch (e) {
				resetGif();
				toasts.warning(`${(e as Error).message} — publishing it as a static image`);
			}
		} else {
			resetGif();
			if (isGif) toasts.info('Animated editing needs Chrome/Edge — publishing as static image');
		}
	}

	function onFileInput(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		void acceptFile(input.files?.[0] ?? null);
		input.value = '';
		pickFormat = 'all'; // one scoped pick — later choosers see everything again
	}

	/** Pick another base image, GIF, or video from the timeline. Unlike a fresh
	 * start, captions, layers, and cues stay in place so creators can audition
	 * another source without rebuilding the edit. */
	function pickOtherTimelineSource(): void {
		if (busy) return;
		otherSourceInput?.click();
	}

	function onOtherSourceInput(e: Event): void {
		const input = e.currentTarget as HTMLInputElement;
		void acceptFile(input.files?.[0] ?? null, { keepRemix: true, keepLayout: true });
		input.value = '';
	}

	function onVideoMetadata(e: Event) {
		const video = e.currentTarget as HTMLVideoElement;
		if (video.videoWidth) {
			meta = {
				width: video.videoWidth,
				height: video.videoHeight,
				duration: Number.isFinite(video.duration) ? video.duration : undefined
			};
			// Frame strip bed: thumbnails generate once per clip (detached copy,
			// never yanks the stage around).
			if (meta.duration && !frameThumbs.length) buildFrameThumbs(video, meta.duration);
		}
	}

	function onImageLoad(e: Event) {
		const img = e.currentTarget as HTMLImageElement;
		if (img.naturalWidth) meta = { width: img.naturalWidth, height: img.naturalHeight };
	}

	function clearMedia() {
		if (busy) return;
		revokePreview();
		file = null;
		mediaKind = null;
		meta = null;
		resetGif();
		sfxCues = [];
		overlays = [];
		zoomWindows = [];
		fxWindows = [];
		speedWindows = [];
		drawingGroups = [];
		drawingUndo = [];
		drawingRedo = [];
		selectedDrawingGroupId = null;
		selectedId = null;
		timingId = null;
		fxId = null;
		imageLayers = [];
		selectedLayerId = null;
		layerAssets.releaseAll();
		previewPlaying = false;
		previewSeconds = 0;
		stageSeconds = 0;
		remixSource = null;
		remixLabel = '';
		sourceCredit = '';
	}

	/** Stash a remix payload handed over from the bitz page: loads the source
	 *  (fresh overlay/cue ids) into the studio. Runs while the studio is open —
	 *  the composer is already usable on the fallback “pick your own clip” path. */
	async function consumeRemixHandoff(handoff: RemixHandoff) {
		try {
			// Use the same source-loader as the rest of the studio. Besides keeping
			// the media/type/200 MB checks consistent, this retries CORS-hostile
			// image sources through the approved image proxy. The old bespoke fetch
			// attempted videos direct-only and showed a generic failure even when a
			// valid source could otherwise be loaded.
			const source = await fetchSourceFile(handoff.mediaUrl, {
				label: 'remix-source',
				accept: handoff.mediaType,
				maxBytes: MAX_SOURCE_BYTES
			});
			if (!source.ok || !source.file)
				throw new Error(source.error ?? 'Could not load source media');
			// keepRemix: loading the source media IS the remix path — lineage stays.
			await acceptFile(source.file, { keepRemix: true });
		} catch (error) {
			const detail = error instanceof Error ? error.message : 'Could not load source media';
			toasts.warning(`${detail} — choose your own clip below to continue this remix`);
		}
		const applied = applyRemixPayload({
			overlays: handoff.overlays,
			sfxCues: handoff.sfxCues,
			...(handoff.imageLayers?.length ? { imageLayers: handoff.imageLayers } : {}),
			...(handoff.zoomWindows?.length ? { zoomWindows: handoff.zoomWindows } : {}),
			...(handoff.fxWindows?.length ? { fxWindows: handoff.fxWindows } : {}),
			...(handoff.speedWindows?.length ? { speedWindows: handoff.speedWindows } : {})
		});
		overlays = applied.overlays;
		sfxCues = applied.sfxCues;
		zoomWindows = applied.zoomWindows;
		fxWindows = applied.fxWindows;
		// Speed ramps: state round-trips through remix today (wire `s`); the
		// studio UI to edit/preview them ships in V2 per the speed-track plan.
		speedWindows = applied.speedWindows;
		// Remix layers arrive as remote URLs already — cache bitmaps for the stage.
		imageLayers = applied.imageLayers;
		for (const layer of applied.imageLayers) {
			void cacheLayerBitmap(layer.src);
			void layerAssets.cacheGif(layer.src);
		}
		selectedId = overlays[0]?.id ?? null;
		remixSource = { eventId: handoff.eventId, pubkey: handoff.pubkey, relays: handoff.relays };
		remixLabel = handoff.label || 'a bitz';
		// S-013: automatic attribution — credit the source author on publish.
		sourceCredit = `remix of ${remixLabel}`.slice(0, 140);
		toasts.info(`Remixing ${remixLabel} — make it yours, then publish`, 5000);
	}

	// Consume a pending remix the moment the studio opens (the bitz page sets
	// the handoff then flips `open`). A failing fetch must not wedge the side
	// effect — the error path still applies the layout so the creator isn't blocked.
	$effect(() => {
		if (!open || !remixHandoff) return;
		const handoff = remixHandoff;
		void consumeRemixHandoff(handoff);
	});

	/** Consumed-template bookkeeping (one-shot latch so the effect re-runs safely). */
	let templateAppliedId = '';
	/** Start-with-template (studio home → studio): apply the saved layout once
	 * on first open — fresh ids keep each use independently editable. */
	$effect(() => {
		if (!open || !templateHandoff) return;
		if (templateAppliedId === templateHandoff.id) return;
		templateAppliedId = templateHandoff.id;
		// Fresh ids so re-using the template never aliases the saved copy.
		overlays = templateHandoff.overlays.map((o, i) => ({ ...o, id: `${templateHandoff.id}-${i}` }));
		selectedId = overlays[0]?.id ?? null;
		timingId = null;
		toasts.info('Layout applied — swap captions for this meme');
	});

	/** Consumed-slot bookkeeping (one-shot latch). */
	let slotOpenedId = '';
	/** Resume-slot handoff (studio home → studio): restore the full WIP once. */
	$effect(() => {
		if (!open || !slotHandoff) return;
		if (slotOpenedId === slotHandoff) return;
		slotOpenedId = slotHandoff;
		void openSlot(slotHandoff);
	});

	/** Consumed-sound bookkeeping (one-shot latch, mirrors the slot path). */
	let soundSeedAppliedId = '';
	/** Sound handoff (Sounds page "Use sound"): stage the picked sound as the
	 *  first cue once the studio opens. A remix/template/slot that lands in
	 *  the same navigation wins — the seed only fires on a CLEAN cue sheet. */
	$effect(() => {
		if (!open || !soundHandoff) return;
		if (soundSeedAppliedId === soundHandoff.id) return;
		soundSeedAppliedId = soundHandoff.id;
		if (sfxCues.length) return;
		if (soundHandoff.kind === 'synth') {
			addSfxCue(soundHandoff.id as MemeSfxId);
			toasts.info(
				`${soundHandoff.label ?? sfxLabels[soundHandoff.id as MemeSfxId]} staged at the playhead`,
				3500
			);
		}
		// Custom library sounds resolve inside the sound picker — the seed
		// only carries synth ids for now (the Sounds page lists synth cards).
	});

	// ---- overlay editing -------------------------------------------------------
	function addOverlay(y = 0.5) {
		if (overlays.length >= 12) {
			toasts.info('Twelve captions is the meme limit');
			return;
		}
		// Free-write: manually added captions keep YOUR casing (the classic
		// all-caps look is a template thing — the Aa toggle flips either way).
		const overlay = makeOverlay({ y, caps: false });
		overlays = [...overlays, overlay];
		selectedId = overlay.id;
		timingId = null;
	}

	/** Timeline insert (user request): a caption born AT the playhead with a 2s
	 *  window — timed sources get punch-in captions without opening the timing
	 *  popover; static sources fall back to an always-visible caption. */
	function addCaptionAtPlayhead(): void {
		if (busy) return;
		if (overlays.length >= 12) {
			toasts.info('Twelve captions is the meme limit');
			return;
		}
		const atMs = Math.round(stageSeconds * 1000);
		const overlay = makeOverlay({
			y: 0.5,
			caps: false,
			...(timelineActive ? { startMs: atMs, endMs: atMs + 2000 } : {})
		});
		overlays = [...overlays, overlay];
		selectedId = overlay.id;
		timingId = overlay.id; // open the timing row so the window is immediately tweakable
	}

	function removeOverlay(id: string) {
		overlays = overlays.filter((o) => o.id !== id);
		if (selectedId === id) selectedId = null;
		if (timingId === id) timingId = null;
	}

	function patchOverlay(id: string, patch: Partial<MemeTextOverlay>) {
		overlays = overlays.map((o) => (o.id === id ? { ...o, ...patch } : o));
	}

	/** Is this caption color from outside the preset palette (custom picker)? */
	/** Reorder = z-order: later array slots paint on top (render.ts paintAll). */
	function moveOverlayRow(id: string, dir: -1 | 1) {
		const idx = overlays.findIndex((o) => o.id === id);
		const next = idx + dir;
		if (idx < 0 || next < 0 || next >= overlays.length) return;
		const list = [...overlays];
		const [row] = list.splice(idx, 1);
		list.splice(next, 0, row!);
		overlays = list;
	}

	function moveOverlay(id: string, dy: number) {
		const overlay = overlays.find((o) => o.id === id);
		if (!overlay) return;
		patchOverlay(id, { y: clamp01(overlay.y + dy) });
	}

	/** Templates APPEND onto existing captions (bug fix: applying one used to
	 *  wipe every manually-added caption/sticker). An empty stage takes the
	 *  layout whole; a busy one gets the rows added below the existing work,
	 *  near-duplicates nudged down so they don't stack. */
	function addTemplateOverlays(rows: MemeTextOverlay[], label: string) {
		if (busy || !rows.length) return;
		const appending = overlays.length > 0;
		const room = MAX_OVERLAYS - overlays.length;
		if (room <= 0) {
			toasts.info('Twelve captions is the meme limit — remove one first');
			return;
		}
		const take = rows
			.slice(0, room)
			.map((row) =>
				overlays.some((o) => o.text.trim().toLowerCase() === row.text.trim().toLowerCase())
					? { ...row, y: clamp01(row.y + 0.08) }
					: row
			);
		if (rows.length > room) {
			toasts.info(`Added ${room} of ${rows.length} — the caption cap is ${MAX_OVERLAYS}`);
		}
		overlays = [...overlays, ...take];
		selectedId = take[take.length - 1]?.id ?? null;
		timingId = null;
		toasts.info(appending ? `${label} appended to your captions` : `${label} template applied`);
	}

	/** Image Meme layouts (p.784): pure caption scaffolds — same merge path
	 *  as video templates, minus the timed tracks. */
	function applyImageLayout(layout: MemeImageLayout) {
		if (busy) return;
		addTemplateOverlays(layout.overlays(), layout.label);
	}

	function applyTemplate(template: Template) {
		if (busy) return;
		addTemplateOverlays(template.overlays(), template.label);
		// Timed templates (spec Layer 3): the cue sheet, zoom punches and
		// frame-fx windows ride along. Video bases get the full show; on an
		// image base the cues still work (sound-on-static) and the timed
		// overlays animate once a cue makes the timeline live.
		const cues = template.sfxCues?.() ?? [];
		if (cues.length) {
			const room = 16 - sfxCues.length;
			if (room > 0) sfxCues = [...sfxCues, ...normalizeSfxCues(cues.slice(0, room))];
		}
		const zooms = template.zoomWindows?.() ?? [];
		if (zooms.length) zoomWindows = normalizeZoomWindows([...zoomWindows, ...zooms]);
		const fx = template.fxWindows?.() ?? [];
		if (fx.length) fxWindows = normalizeFxWindows([...fxWindows, ...fx]);
		const speeds = template.speedWindows?.() ?? [];
		if (speeds.length) speedWindows = normalizeSpeedWindows([...speedWindows, ...speeds]);
		// Buddy sticker layers (₿ pack): merged like every other track —
		// capped, fresh ids via makeImageOverlay, never clobbering user work.
		const figures = template.imageLayers?.() ?? [];
		if (figures.length) {
			const room = Math.max(0, MAX_IMAGE_OVERLAYS - imageLayers.length);
			const take = figures.slice(0, room);
			if (take.length) {
				imageLayers = [...imageLayers, ...take];
				for (const l of take) void cacheLayerBitmap(l.src);
			}
		}
	}

	/** Re-apply a user-saved layout — fresh ids so each overlay is editable.
	 *  v2 rows also restore their timed tracks (cues/zoom/fx/speed/stickers).
	 */
	function applySavedTemplate(id: string) {
		if (busy) return;
		const saved = memeTemplates.list.find((t) => t.id === id);
		if (!saved) return;
		addTemplateOverlays(memeTemplates.apply(saved), `“${saved.label}”`);
		const extras = memeTemplates.applyExtras(saved);
		if (extras.sfxCues?.length) {
			const room = 16 - sfxCues.length;
			if (room > 0) sfxCues = [...sfxCues, ...extras.sfxCues.slice(0, room)];
		}
		if (extras.zoomWindows?.length)
			zoomWindows = normalizeZoomWindows([...zoomWindows, ...extras.zoomWindows]);
		if (extras.fxWindows?.length)
			fxWindows = normalizeFxWindows([...fxWindows, ...extras.fxWindows]);
		if (extras.speedWindows?.length)
			speedWindows = normalizeSpeedWindows([...speedWindows, ...extras.speedWindows]);
		if (extras.imageLayers?.length) {
			const room = Math.max(0, MAX_IMAGE_OVERLAYS - imageLayers.length);
			const take = extras.imageLayers.slice(0, room);
			if (take.length) {
				imageLayers = [...imageLayers, ...take];
				for (const l of take) void cacheLayerBitmap(l.src);
			}
		}
	}

	/** Snapshot the whole studio state into a named slot (media ≤ cap). */
	async function saveCurrentSlot(): Promise<void> {
		if (!dirty) {
			toasts.error('Nothing to save yet — pick media or add captions first');
			return;
		}
		let media: { dataUrl?: string; blobId?: string; name: string; mimeType: string } | null = null;
		if (file) {
			try {
				media = await memeSlots.saveMediaFile(file);
			} catch {
				// Fallback keeps small projects usable in browsers that block IndexedDB.
				if (file.size <= MAX_SLOT_BYTES) media = await mediaToDraftDataUrl(file);
				else
					toasts.warning(
						'Project saved without its source file — this browser blocked project media storage'
					);
			}
		}
		const saved = memeSlots.save({
			label: slotName,
			media,
			mediaKindValue: mediaKind,
			overlays,
			sfxCues,
			imageLayers,
			drawingGroups,
			caption,
			sensitive,
			destination: destinations[0] ?? 'bitz',
			destinations,
			lookId,
			trimStartSec,
			trimEndSec,
			playbackRate
		});
		slotName = '';
		toasts.success(`Save point “${saved.label}” created`);
	}

	/** Restore a slot onto the stage — a full WIP handoff, not a layout swap. */
	async function openSlot(id: string): Promise<void> {
		if (busy) return;
		const slot = memeSlots.list.find((s) => s.id === id);
		if (!slot) return;
		slotBusyId = id;
		try {
			const mediaFile = await memeSlots.slotMediaFile(slot);
			// A slot is a complete WIP snapshot, not an overlay to merge onto the
			// current editor. Clear first so a caption-only/large-media slot cannot
			// accidentally inherit the previous meme's source or layers.
			reset();
			if (mediaFile) {
				await acceptFile(mediaFile, { keepRemix: false, keepLayout: false });
			} else if (slot.media) {
				toasts.warning('The saved media could not be restored — choose the source again');
			} else {
				toasts.info('This slot has no embedded media — choose the source to continue');
			}
			overlays = slot.overlays.map((o) => ({ ...o }));
			sfxCues = slot.sfxCues.map((c) => ({ ...c }));
			imageLayers = slot.imageLayers.map((l) => ({ ...l }));
			drawingGroups = normalizeDrawingGroups(slot.drawingGroups);
			for (const layer of imageLayers) {
				void cacheLayerBitmap(layer.src);
				void layerAssets.cacheGif(layer.src);
			}
			caption = slot.caption;
			sensitive = slot.sensitive;
			destinations = slot.destinations?.length ? [...slot.destinations] : [slot.destination];
			lookId = memeLookOf(slot.lookId);
			selectedId = overlays[0]?.id ?? null;
			selectedDrawingGroupId = drawingGroups[0]?.id ?? null;
			timingId = null;
			if (slot.mediaKindValue === 'video') {
				trimStartSec = slot.trimStartSec;
				trimEndSec = slot.trimEndSec;
				playbackRate = slot.playbackRate;
			}
			toasts.info(`Save point “${slot.label}” restored`);
			popovers.close();
		} finally {
			slotBusyId = '';
		}
	}

	function removeSlot(id: string) {
		memeSlots.remove(id);
	}

	function duplicateSlot(id: string) {
		const copy = memeSlots.duplicate(id);
		if (!copy) return;
		toasts.success(`Save point duplicated as “${copy.label}”`);
	}

	function renameSlot(id: string, label: string) {
		const renamed = memeSlots.rename(id, label);
		if (!renamed) {
			toasts.error('A save point name is required');
			return;
		}
		toasts.success(`Renamed to “${renamed.label}”`);
	}

	function saveCurrentTemplate() {
		if (busy) return;
		if (!overlays.some((o) => o.text.trim())) {
			toasts.error('Add at least one caption before saving a template');
			return;
		}
		try {
			// v2: capture the timed tracks with the layout — cues, zoom
			// punches, frame-fx, speed ramps and sticker layers all ride.
			const saved = memeTemplates.save(templateName, overlays, 'i-lucide-bookmark', {
				sfxCues,
				zoomWindows,
				fxWindows,
				speedWindows,
				imageLayers
			});
			toasts.push(`Template “${saved.label}” saved`, 'success', 4000);
			showTemplateSave = false;
			templateName = '';
		} catch (e) {
			toasts.error((e as Error).message);
		}
	}

	function removeSavedTemplate(id: string) {
		memeTemplates.remove(id);
		toasts.info('Template deleted');
	}

	// ---- SFX cues -------------------------------------------------------------
	/** Drop a cue at the current playhead (or 0 for static sources). */
	function addSfxCue(sfx: MemeSfxId) {
		if (sfxCues.length >= 16) {
			toasts.error('Sound cues cap out at 16');
			return;
		}
		const cue = normalizeSfxCue({ sfx, atMs: performanceClockMs(), gain: 1 });
		if (cue) {
			sfxCues = [...sfxCues, cue];
			selectedCueId = cue.id;
			selectedId = null;
			selectedLayerId = null;
			selectedDrawingGroupId = null;
			selectedBaseTrack = false;
		}
	}
	/** One-tap sound-pad action for drawing/performance mode: audition and
	 * commit the same movable cue at the current project clock. */
	function addLiveSfxCue(sfx: MemeSfxId) {
		previewSfx(sfx);
		addSfxCue(sfx);
	}

	/** Timeline tick drag: move a cue to a new time (wire ms model). */
	function retimeSfxCue(id: string, atMs: number) {
		sfxCues = sfxCues.map((c) => (c.id === id ? { ...c, atMs: Math.max(0, Math.round(atMs)) } : c));
	}

	function moveSfxCueLane(id: string, lane: number) {
		sfxCues = sfxCues.map((c) =>
			c.id === id ? { ...c, lane: Math.max(0, Math.min(3, lane)) } : c
		);
	}

	/** Dialog adapter: stage a custom cue by library sound id. */
	function addCustomCueById(soundId: string) {
		const sound = soundLibrary.list.find((s) => s.id === soundId);
		if (!sound) {
			toasts.error('That sound is missing from this device');
			return;
		}
		addCustomCue(sound);
	}

	/** Dialog adapter: preview a custom sound by library id. */
	function previewSoundById(soundId: string) {
		const sound = soundLibrary.list.find((s) => s.id === soundId);
		if (sound) void previewSound(sound);
		else {
			// Shared-only sound (not imported yet): import-then-play would be the
			// full UX; for now the dialog lists imported ones in My sounds.
			toasts.info('Import this sound from Shared first, then preview it');
		}
	}

	/** Snap every caption window onto the cue sheet in order — one caption per
	 *  beat (#2 sound-timed captions). Captions beyond the cue count keep their
	 *  windows; static sources stay static. */
	function syncCaptionsToCues() {
		if (busy) return;
		if (!sfxCues.length) {
			toasts.info('Add a sound cue first — captions snap to cue points');
			return;
		}
		if (!overlays.length) {
			toasts.info('Add captions first — each one snaps to the next cue');
			return;
		}
		overlays = syncOverlaysToCues(overlays, sfxCues);
		toasts.success(
			`Captions snapped to ${Math.min(overlays.length, sfxCues.length)} cue${sfxCues.length === 1 ? '' : 's'}`
		);
	}

	function removeSfxCue(id: string) {
		sfxCues = sfxCues.filter((c) => c.id !== id);
		if (selectedCueId === id) selectedCueId = null;
	}

	/** Audition one recipe immediately so placement isn't guesswork. */
	function previewSfx(sfx: MemeSfxId) {
		void (async () => {
			const { renderSfxTrack, scheduleSfx } = await import('$lib/meme/sfx');
			const schedule = scheduleSfx(
				[{ id: 'preview', sfx, atMs: 0, gain: 1 }],
				SFX_RECIPES[sfx].duration + 0.25
			);
			const OfflineCtx = window.OfflineAudioContext;
			if (!OfflineCtx) return;
			const buffer = await renderSfxTrack(schedule, SFX_RECIPES[sfx].duration + 0.25, OfflineCtx);
			const AudioCtx = window.AudioContext;
			if (!AudioCtx) return;
			const ctx = new AudioCtx();
			const source = ctx.createBufferSource();
			source.buffer = buffer;
			source.connect(ctx.destination);
			source.start();
			source.onended = () => void ctx.close().catch(() => undefined);
		})();
	}

	// ---- export + publish ----------------------------------------------------
	function track(phaseName: Phase, label: string, percent?: number) {
		phase = phaseName;
		progressLabel = label;
		if (percent !== undefined) progress = percent;
	}

	/** Seek-then-grab the composed frame at `timeSec` and stage it as poster. */
	async function pickPosterAt(timeSec: number): Promise<void> {
		if (!stageVideo) {
			toasts.error('The preview is still loading');
			return;
		}
		try {
			const blob = await grabVideoFrame(stageVideo, Math.max(0, timeSec), {
				lookCss,
				overlays
			});
			posterBlob = blob;
			posterDataUrl = await new Promise<string>((resolve) => {
				const fr = new FileReader();
				fr.onload = () => resolve(String(fr.result));
				fr.readAsDataURL(blob);
			});
			posterUploadedUrl = null; // re-upload lazily at publish
			posterAtSec = Math.max(0, timeSec);
			toasts.success('Poster frame staged');
		} catch (e) {
			toasts.error(e instanceof Error ? e.message : 'Could not grab that frame');
		}
	}

	function clearPoster() {
		posterBlob = null;
		posterDataUrl = null;
		posterUploadedUrl = null;
		posterAtSec = null;
		frameThumbs = [];
	}

	/** Scrub the stage preview to the strip playhead (pause so it holds). */
	function scrubTo(sec: number) {
		scrubSec = sec;
		if (stageVideo) {
			stageVideo.pause();
			stageVideo.currentTime = sec;
		}
	}

	/** Generate the strip's ~8 thumbnails once metadata + preview exist. */
	function buildFrameThumbs(video: HTMLVideoElement, durationSec: number): void {
		const canvas = document.createElement('canvas');
		canvas.width = 120;
		canvas.height = Math.max(
			40,
			Math.round((120 * video.videoHeight) / Math.max(1, video.videoWidth))
		);
		const ctx = canvas.getContext('2d');
		const cols = Math.min(8, Math.max(4, Math.round(durationSec)));
		const grab = document.createElement('video');
		grab.src = video.currentSrc || video.src;
		grab.muted = true;
		grab.playsInline = true;
		grab.preload = 'auto';
		const urls: string[] = [];
		void (async () => {
			await new Promise<void>((resolve) => {
				grab.onloadedmetadata = () => resolve();
				setTimeout(resolve, 4000);
			});
			for (let i = 0; i < cols; i++) {
				const t = Math.min(durationSec - 0.05, (durationSec * (i + 0.5)) / cols);
				if (!Number.isFinite(t) || t < 0) continue;
				await new Promise<void>((resolve) => {
					grab.onseeked = () => resolve();
					setTimeout(resolve, 3000);
					grab.currentTime = Math.max(0, t);
				});
				if (!ctx) continue;
				ctx.drawImage(grab, 0, 0, canvas.width, canvas.height);
				urls.push(canvas.toDataURL('image/jpeg', 0.5));
			}
			grab.removeAttribute('src');
			if (urls.length) frameThumbs = urls;
		})();
	}

	// ---- output format (export + publish share exportMeme) -------------------
	/** `auto` keeps the inferred format (GIF base → recorded video, static +
	 *  cue → sound video, plain static → JPEG, video → video). The explicit
	 *  options let creators ship the SAME composition as a still, a true
	 *  looping .gif, or a video regardless of the source type. */
	let exportFormat = $state<MemeExportFormat>('auto');
	/** Human-readable *actual* output. Auto follows the same rules as exportMeme. */
	const outputFormatLabel = $derived.by(() => {
		if (exportFormat === 'image') return 'Image';
		if (exportFormat === 'gif') return 'GIF';
		if (exportFormat === 'video') return 'Video';
		if (gif) return 'GIF';
		if (mediaKind === 'image') return sfxCues.length ? 'Video' : 'Image';
		return 'Video';
	});

	/** JPEG still of the current frame — works from ANY source (video draws
	 *  the element's current frame; GIF paints the playhead frame). */
	async function exportStillImageMeme(): Promise<File> {
		track('rendering', 'Rendering still…', 30);
		await tick();
		const a = document.createElement('canvas');
		a.width = renderTarget.width;
		a.height = renderTarget.height;
		const ctx = a.getContext('2d');
		if (!ctx) throw new Error('Canvas is not available in this browser');
		ctx.fillStyle = '#000';
		ctx.fillRect(0, 0, a.width, a.height);
		if (!(mediaKind === 'video' && stageVideo) && !gif && !stageImg) {
			throw new Error('The preview is still loading');
		}
		paintMemeBase(ctx, a, {
			mediaKind,
			gif,
			stageImg,
			stageVideo,
			lookCss,
			mediaTransform: composeZoomWithFraming(
				mediaTransform,
				zoomTransformAt(zoomWindows, Math.round(stageSeconds * 1000))
			),
			fxWindows: fxWindows.length ? fxWindows : undefined,
			stageSeconds
		});
		paintImageOverlays(
			ctx,
			imageLayers,
			(src) => layerAssets.bitmaps.get(src) ?? null,
			a,
			undefined,
			layerAssets.painterFor
		);
		paintDrawingGroups(ctx, drawingGroups, a);
		paintAll(ctx, overlays, a);
		const blob = await new Promise<Blob | null>((res) => a.toBlob(res, 'image/jpeg', 0.92));
		if (!blob) throw new Error('Could not encode the still');
		return new File([blob], `meme-${Date.now()}.jpg`, { type: 'image/jpeg' });
	}

	/** True looping GIF — offline (not recorder-bound): repaint the whole
	 *  composition at fixed steps and encode. Image/GIF bases only; video
	 *  sources keep the recorder path (video→GIF would need seek-stepping). */
	async function exportAnimatedGifMeme(): Promise<File> {
		if (mediaKind === 'video') {
			throw new Error('GIF export starts from an image or GIF base — pick Image or Video');
		}
		if (!stageImg && !gif) throw new Error('The preview is still loading');
		// The loop runs as long as the LONGEST moving part — base GIF, sound
		// cues, or an animated LAYER (the old base/cue-only derivation froze a
		// GIF layer placed over a static base into a single-frame export).
		// Steps ride the source's real frame boundaries, so the encoded loop
		// plays the original frames at their original holds; a shorter Length
		// pick still trims (longer picks can't extend — the NETSCAPE loop tag
		// handles repetition).
		const layerFrameSets = imageLayers
			.map((layer) => layerAssets.gifs.get(layer.src)?.frames)
			.filter((f): f is NonNullable<typeof f> => !!f && f.length > 0);
		// Replay drawings are timeline content too. Without a GIF base, animated
		// layer, or sound cue, they used to produce only the t=0 still frame.
		const replayEndMs = drawingGroups.reduce((latest, group) => {
			if (group.playback !== 'replay') return latest;
			const strokeEnd = group.strokes.reduce(
				(end, stroke) => Math.max(end, stroke.points[stroke.points.length - 1]?.atMs ?? 0),
				0
			);
			return Math.max(latest, group.startMs + strokeEnd);
		}, 0);
		const plan = planGifExport(
			gif?.frames,
			layerFrameSets,
			Math.max(sfxCues.length ? cueTrackDurationSec(sfxCues) : 0, replayEndMs / 1000),
			pinnedLengthSec
		);
		// GIFs stay light: ≤640px long edge, ≤360 frames.
		const scale = Math.min(1, 640 / Math.max(renderTarget.width, renderTarget.height));
		const a = document.createElement('canvas');
		a.width = Math.max(2, Math.round(renderTarget.width * scale) & ~1);
		a.height = Math.max(2, Math.round(renderTarget.height * scale) & ~1);
		const ctx = a.getContext('2d');
		if (!ctx) throw new Error('Canvas is not available in this browser');
		const frameCount = plan.steps.length;
		if (plan.capped) {
			toasts.info('GIF capped at 360 frames — trim or drop cues for a shorter loop');
		}
		const frames: GifEncodeFrame[] = [];
		// GIF plans sample frame *starts*. Settle the last canvas through the
		// final replay point so a line ending during the last frame hold is kept.
		for (let i = 0; i < frameCount; i++) {
			const step = plan.steps[i]!;
			const t = step.atSec;
			const drawingAtMs = i === frameCount - 1 ? Math.max(t * 1000, replayEndMs) : t * 1000;
			track(
				'rendering',
				`Painting GIF frame ${i + 1}/${frameCount}…`,
				Math.round((i / frameCount) * 80)
			);
			ctx.fillStyle = '#000';
			ctx.fillRect(0, 0, a.width, a.height);
			paintMemeBase(ctx, a, {
				mediaKind,
				gif,
				stageImg,
				stageVideo,
				lookCss,
				mediaTransform,
				// Mod so the base LOOPS when a layer/cue extends past one pass
				// (mirrors the recorder path) instead of freezing on its last
				// frame for the rest of the window.
				stageSeconds: gif && gif.duration > 0 ? t % gif.duration : t,
				fxWindows: fxWindows.length ? fxWindows : undefined
			});
			paintImageOverlays(
				ctx,
				imageLayers,
				(src) => layerAssets.bitmaps.get(src) ?? null,
				a,
				t * 1000,
				layerAssets.painterFor
			);
			paintDrawingGroups(ctx, drawingGroups, a, drawingAtMs);
			paintAll(ctx, overlays, a, t * 1000);
			frames.push({ source: await createImageBitmap(a), delayMs: step.delayMs });
		}
		track('rendering', 'Encoding GIF…', 85);
		const blob = await encodeAnimatedGif(frames, { width: a.width, height: a.height });
		for (const f of frames) {
			const src = f.source as ImageBitmap;
			if (typeof src.close === 'function') src.close();
		}
		return new File([blob], `meme-${Date.now()}.gif`, { type: 'image/gif' });
	}

	async function exportMeme(): Promise<File> {
		if (!file || !mediaKind) throw new Error('Pick a picture, GIF or video first');
		// Layer readiness: a layer without a bitmap silently vanishes from the
		// render — retry once, then say which layers will be skipped or frozen.
		if (imageLayers.length) {
			const missing: number[] = [];
			const frozen: number[] = [];
			for (let i = 0; i < imageLayers.length; i++) {
				const src = imageLayers[i]!.src;
				if (!(await cacheLayerBitmap(src))) missing.push(i + 1);
				// GIF decode retry right before recording — held bytes make this
				// local and certain; failure means the layer freezes at frame 1.
				if (layerAssets.looksAnimatedGif(src) && !(await layerAssets.cacheGif(src)))
					frozen.push(i + 1);
			}
			if (missing.length) {
				toasts.warning(
					`Layer${missing.length > 1 ? 's' : ''} ${missing.join(', ')} failed to load — skipped in this export`,
					4000
				);
			}
			if (frozen.length) {
				toasts.warning(
					`Animated layer${frozen.length > 1 ? 's' : ''} ${frozen.join(', ')} will export as a still frame${
						canDecodeGif()
							? ` — the GIF failed to decode (${layerAssets.lastGifDecodeError || 'unknown'})`
							: ' — animated layers need Chrome or Edge'
					}`,
					6000
				);
			}
		}
		// Explicit output format (user choice beats inference):
		//   image → JPEG still of the current frame, from ANY source
		//   gif   → true looping .gif (image/GIF bases; video→gif is recorder-
		//           bound, so the chip is disabled for video sources)
		//   video → the recorder stack (static sources need a cue = a clock)
		if (exportFormat === 'image') return exportStillImageMeme();
		if (exportFormat === 'gif') return exportAnimatedGifMeme();
		if (exportFormat === 'video') {
			if (!canRenderVideoMeme()) {
				throw new Error('This browser cannot export video memes — try Chrome/Edge');
			}
			if (gif) return exportGifMeme();
			if (mediaKind === 'image') {
				if (!sfxCues.length) {
					throw new Error('A video export needs a timeline — add a sound cue, or pick Image / GIF');
				}
				return exportStaticVideoMeme();
			}
			// video source → the normal video branch below
		}
		// Auto (the old inference):
		if (gif) return exportGifMeme();
		if (mediaKind === 'image') {
			// Sound-on-static rides the recorder stack as a short video so the
			// SFX track can ship; a silent static meme stays a JPEG.
			if (sfxCues.length > 0) return exportStaticVideoMeme();
			if (!stageImg) throw new Error('The preview is still loading');
			track('rendering', 'Rendering meme…');
			await tick();
			const blob = await renderImageMeme(stageImg, overlays, {
				lookCss,
				imageLayers,
				bitmaps: layerAssets.bitmaps,
				target: renderTarget,
				mediaTransform,
				fxWindows: fxWindows.length ? fxWindows : undefined
			});
			return new File([blob], `meme-${Date.now()}.jpg`, { type: 'image/jpeg' });
		}
		if (!stageVideo) throw new Error('The preview is still loading');
		if (!canRenderVideoMeme()) {
			throw new Error('This browser cannot export video memes — try Chrome/Edge or use a picture');
		}
		// Trim guard: the export window (not the raw source) must fit the cap.
		if (trimDuration > MAX_VIDEO_MEME_SECONDS) {
			throw new Error(
				`Video memes top out at ${MAX_VIDEO_MEME_SECONDS}s — trim the window first (${formatDuration(trimDuration)})`
			);
		}
		track('rendering', 'Recording meme video…', 0);
		await tick();
		// Cue mix (synth + custom) rides alongside any source audio; attached
		// inside renderVideoMeme via the extra-track hook below.
		// Cue mix is built on the EXPORT timeline: media time re-mapped by the
		// trim window, integrated through any speed ramps, then compressed by
		// the base playbackRate (cues after trimEnd drop).
		const exportCues = shiftCuesForExportWithSpeeds(
			sfxCues,
			speedWindows,
			trimStartSec,
			playbackRate,
			mediaSpanExportSec
		);
		// Export audio length follows the same curve — ramped spans shrink/grow
		// the timeline the cues live on.
		const cueTrack = await cueAudioTrack(mediaSpanExportSec, exportCues, libraryDecodeSound);
		const extraTracks: MediaStreamTrack[] = [];
		if (cueTrack) extraTracks.push(cueTrack);
		const { blob, mimeType } = await renderVideoMeme(stageVideo, overlays, {
			signal: mineController?.signal,
			extraTracks,
			sourceAudio: includeSourceAudio,
			sourceAudioGain,
			lookCss,
			imageLayers,
			drawingGroups,
			bitmaps: layerAssets.bitmaps,
			animPainters: layerAssets.painterFor,
			target: renderTarget,
			mediaTransform,
			// Punch-in zoom rides the media clock (source.currentTime), so the
			// same media-time windows the preview runs export 1:1 — no trim/rate
			// remap needed on this path (the recorder replays source time).
			mediaTransformAt: zoomWindows.length
				? (mediaTimeMs) =>
						composeZoomWithFraming(mediaTransform, zoomTransformAt(zoomWindows, mediaTimeMs))
				: undefined,
			// Frame-FX windows ride the media clock exactly like zooms — no remap
			// needed on this path (the recorder replays source time).
			fxWindows: fxWindows.length ? fxWindows : undefined,
			// Speed ramps ride the media clock too: renderVideoMeme drives the
			// video's playbackRate through the curve while recording.
			speedWindows: speedWindows.length ? speedWindows : undefined,
			trimStartSec: mediaKind === 'video' ? trimStartSec : undefined,
			trimEndSec: mediaKind === 'video' ? (trimEndSec ?? undefined) : undefined,
			playbackRate: mediaKind === 'video' ? playbackRate : undefined,
			onProgress: (p) => {
				progress = p.percent;
			}
		});
		return new File([blob], `meme-${Date.now()}.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`, {
			type: mimeType
		});
	}

	/** GIF export: paint decoded frames onto a canvas at creation speed, mix
	 * the synthesized SFX track into the MediaRecorder stream, and return the
	 * recorded video. Same recorder contract as renderVideoMeme. */
	async function exportGifMeme(): Promise<File> {
		const decoded = gif;
		if (!decoded) throw new Error('The GIF preview is still decoding');
		if (!canRenderVideoMeme()) {
			throw new Error('This browser cannot export animated memes — try Chrome/Edge');
		}
		const a = document.createElement('canvas');
		// Artboard (cover-fit) or the GIF's own frame — even dims, 1080 cap on
		// the source path like every meme export.
		const srcSize = { width: decoded.width, height: decoded.height };
		const size = artboardId === 'source' ? targetSize(srcSize) : renderTarget;
		a.width = Math.max(2, size.width - (size.width % 2));
		a.height = Math.max(2, size.height - (size.height % 2));
		// Export length: the GIF's own duration, or the creator's Length pick
		// (shorter trims the loop, longer repeats the GIF). Cue audio is built
		// on the same clock so sounds fire inside the exported window.
		const exportLengthSec = Math.min(
			Math.max(pinnedLengthSec ?? decoded.duration, 0.2),
			MAX_VIDEO_MEME_SECONDS
		);
		track('rendering', 'Recording meme…', 0);
		// Synthesized + custom cue mix (if any cues exist) becomes the audio track.
		const cueTrack = await cueAudioTrack(exportLengthSec, sfxCues, libraryDecodeSound);
		// Real-time single pass: paint each frame for its own duration. GIF
		// timestamps are wall-clock aligned so SFX cues stay in sync; the
		// base painter loops (mod duration) so a longer Length pick
		// repeats the GIF instead of freezing on its last frame.
		return recordMeme({
			canvas: a,
			totalMs: exportLengthSec * 1000,
			signal: mineController?.signal,
			extraTracks: cueTrack ? [cueTrack] : [],
			unsupportedMessage: 'This browser cannot record animated memes',
			paint: (ctx, elapsedMs) => {
				ctx.fillStyle = '#000';
				ctx.fillRect(0, 0, a.width, a.height);
				paintMemeBase(ctx, a, {
					mediaKind,
					gif: decoded,
					stageImg,
					stageVideo,
					lookCss,
					mediaTransform: composeZoomWithFraming(
						mediaTransform,
						zoomTransformAt(zoomWindows, elapsedMs)
					),
					stageSeconds: (elapsedMs / 1000) % Math.max(decoded.duration, 0.01),
					fxWindows: fxWindows.length ? fxWindows : undefined,
					// FX ride the EXPORT clock (elapsedMs) like the cue sheet — a
					// longer Length pick repeats the hit each loop pass.
					fxAtMs: elapsedMs
				});
				paintImageOverlays(
					ctx,
					imageLayers,
					(src) => layerAssets.bitmaps.get(src) ?? null,
					a,
					elapsedMs,
					layerAssets.painterFor
				);
				paintDrawingGroups(ctx, drawingGroups, a, elapsedMs);
				paintAll(ctx, overlays, a, elapsedMs);
			},
			onProgress: (percent) => {
				progress = percent;
			}
		});
	}

	/** Static + SFX: real-time record a painted frame for as long as the cue
	 * sheet runs (+ padding), so the audio track carries the sound. */
	async function exportStaticVideoMeme(): Promise<File> {
		if (!stageImg) throw new Error('The preview is still loading');
		if (!canRenderVideoMeme()) {
			throw new Error('This browser cannot export sound memes — try Chrome/Edge');
		}
		const a = document.createElement('canvas');
		// Artboard (cover-fit) or the image's own frame, even dims, 1080 cap.
		const size = renderTarget;
		a.width = Math.max(2, size.width - (size.width % 2));
		a.height = Math.max(2, size.height - (size.height % 2));
		// Duration: last cue end + tail, clamped to the video-meme cap (shared
		// with the suggestion path via cue-track). A pinned Length overrides —
		// shorter drops late cues, longer holds the last frame in silence.
		const durationSec = Math.min(
			Math.max(pinnedLengthSec ?? cueTrackDurationSec(sfxCues), 0.5),
			MAX_VIDEO_MEME_SECONDS
		);
		track('rendering', 'Recording sound meme…', 0);
		const cueTrack = await cueAudioTrack(durationSec, sfxCues, libraryDecodeSound);
		// Real-time pass: paint the static frame (look + image layers + timed
		// captions), then re-paint as the timeline advances so start/end
		// windows and cue-synced captions behave exactly like GIF export.
		return recordMeme({
			canvas: a,
			totalMs: durationSec * 1000,
			signal: mineController?.signal,
			extraTracks: cueTrack ? [cueTrack] : [],
			unsupportedMessage: 'This browser cannot record sound memes',
			paint: (ctx, elapsedMs) => {
				ctx.fillStyle = '#000';
				ctx.fillRect(0, 0, a.width, a.height);
				// Cover-fit (not stretch) — a mismatched artboard crops like the
				// stage preview instead of distorting the picture; the framing
				// (crop/zoom) rides the same rect.
				paintMemeBase(ctx, a, {
					mediaKind,
					gif,
					stageImg,
					stageVideo,
					lookCss,
					mediaTransform: composeZoomWithFraming(
						mediaTransform,
						zoomTransformAt(zoomWindows, elapsedMs)
					),
					fxWindows: fxWindows.length ? fxWindows : undefined,
					fxAtMs: elapsedMs
				});
				paintImageOverlays(
					ctx,
					imageLayers,
					(src) => layerAssets.bitmaps.get(src) ?? null,
					a,
					elapsedMs,
					layerAssets.painterFor
				);
				paintDrawingGroups(ctx, drawingGroups, a, elapsedMs);
				paintAll(ctx, overlays, a, elapsedMs);
			},
			onProgress: (percent) => {
				progress = percent;
			}
		});
	}

	async function uploadRendered(rendered: File): Promise<UploadedMediaLike> {
		track('uploading', 'Uploading meme…', 0);
		return media.upload(rendered, selectedProvider === 'none' ? undefined : selectedProvider, {
			pubkey: me?.pk,
			purpose: destinations.length === 1 && destinations[0] === 'story' ? 'story' : 'note',
			signal: mineController?.signal,
			onProgress: (p) => track('uploading', 'Uploading meme…', p.percent),
			onRetry: ({ attempt, delayMs }) => {
				toasts.info(`Upload hiccup — retrying in ${(delayMs / 1000).toFixed(1)}s`);
				track('uploading', `Retrying upload (attempt ${attempt})…`, 0);
			}
		});
	}

	type UploadedMediaLike = UploadedMedia;

	/** Upload the staged poster frame (once) — rides publish imeta as `thumb`. */
	async function posterThumbUrl(): Promise<string | undefined> {
		if (!posterBlob) return undefined;
		if (posterUploadedUrl) return posterUploadedUrl;
		track('uploading', 'Uploading poster…');
		const posterFile = new File([posterBlob], `poster-${Date.now()}.jpg`, {
			type: 'image/jpeg'
		});
		const uploaded = await media.upload(
			posterFile,
			selectedProvider === 'none' ? undefined : selectedProvider,
			{
				pubkey: me?.pk,
				purpose: 'note',
				signal: mineController?.signal
			}
		);
		posterUploadedUrl = uploaded.url;
		return uploaded.url;
	}

	async function publishBitz(uploaded: UploadedMediaLike): Promise<string> {
		const thumb = await posterThumbUrl();
		// §6.4 imeta enrichment: the exported FILE's duration (only when it's a
		// actually a video) + the average bitrate from the uploaded bytes.
		const durationSec = exportImetaDuration({
			uploadedKind: uploaded.kind,
			mediaKind,
			gifDuration: gif?.duration,
			exportFormat,
			pinnedLengthSec,
			cueRuntimeSec: sfxCues.length ? cueTrackDurationSec(sfxCues) : undefined,
			// Ramp-integrated length (mediaMsToExportMs) when ramps exist, else
			// the flat trim/rate math — imeta must match the exported file.
			exportDurationSec: speedWindows.length ? mediaSpanExportSec : exportDurationSec,
			capSec: MAX_VIDEO_MEME_SECONDS
		});
		const bitrate =
			durationSec && durationSec > 0.2 && uploaded.bytes > 0
				? (uploaded.bytes * 8) / durationSec
				: undefined;
		return feed.postBitz(
			{
				url: uploaded.url,
				kind: uploaded.kind as 'image' | 'video',
				mimeType: uploaded.mimeType,
				bytes: uploaded.bytes,
				sha256: uploaded.sha256
			},
			{
				caption,
				sensitive,
				portrait,
				duration: durationSec,
				bitrate,
				dim: mediaKind
					? `${renderTarget.width}x${renderTarget.height}`
					: meta
						? `${meta.width}x${meta.height}`
						: undefined,
				thumb,
				// Remix lineage rides the tags (remix + meme + attribution p) —
				// only when this project actually derives from a source meme.
				// Rights tags (S-013) always ride: license + optional credit.
				extraTags: [
					...(remixSource
						? remixTagsFor(remixSource, {
								overlays,
								sfxCues,
								imageLayers,
								zoomWindows,
								fxWindows,
								speedWindows
							})
						: []),
					...rightsTagsFor(license, remixSource ? sourceCredit : ''),
					// AI-004 provenance — only when the creator says so.
					...(aiAssisted ? [aiAssistedTag()] : []),
					// Value-split manifest (CRE-008): rides only when the creator
					// built one and it validates to exactly 10,000 bps.
					...(splitRows.length && splitCheck.ok ? splitsTagsFor(splitRows) : [])
				],
				pow: showPow ? pow : 0,
				onPowProgress: (p) => (powProgress = p),
				signal: mineController?.signal
			}
		);
	}

	async function publishStory(uploaded: UploadedMediaLike): Promise<string> {
		// Sound-on-static exports as a video file — publish it with video imeta
		// (not as an image array) so clients stream it correctly.
		const asVideo = mediaKind === 'video' || (mediaKind === 'image' && sfxCues.length > 0);
		const thumb = await posterThumbUrl();
		return stories.publish(caption, asVideo ? undefined : [uploaded.url], undefined, {
			alt: caption.slice(0, 200) || undefined,
			sensitive,
			video: asVideo
				? {
						url: uploaded.url,
						mime: uploaded.mimeType,
						bytes: uploaded.bytes,
						thumb
					}
				: undefined
		});
	}

	/**
	 * A meme as a plain kind-1 note: the burned meme rides along as a standard
	 * attachment (imeta + url line) so every Nostr client renders it inline.
	 */
	async function publishNote(uploaded: UploadedMediaLike): Promise<string> {
		// Public notes use the same NIP-92 `thumb` metadata as Bitz/Stories, so
		// clients can show the creator-selected video poster before decoding it.
		const thumb = await posterThumbUrl();
		return feed.post(caption, {
			sensitive,
			attachments: [
				{
					url: uploaded.url,
					kind: uploaded.kind as 'image' | 'video',
					mimeType: uploaded.mimeType,
					bytes: uploaded.bytes,
					sha256: uploaded.sha256,
					thumb
				}
			],
			pow: showPow ? pow : 0,
			onPowProgress: (p) => (powProgress = p),
			signal: mineController?.signal
		});
	}

	/** Export-to-file (user request): run the SAME render pipeline as a publish
	 *  (captions, layers, looks, sounds, trim, speed all burned in) but save the
	 *  result locally instead of posting — share it anywhere, keep it, or upload
	 *  to another platform. Nothing hits a relay. */
	async function exportFile(): Promise<void> {
		if (!file || busy) return;
		// An image meme with no cues exports as-is; everything else needs the
		// recorder stack, so gate on the same support flag as publishing.
		const needsRecorder = mediaKind === 'video' || !!gif || sfxCues.length > 0;
		if (needsRecorder && !canRenderVideoMeme()) {
			toasts.error('This browser can’t render animated memes — try Chrome/Edge');
			return;
		}
		if (mediaKind === 'video' && stageVideo) stageVideo.pause();
		const controller = new AbortController();
		mineController = controller;
		try {
			const rendered = await exportMeme();
			const url = URL.createObjectURL(rendered);
			const anchor = document.createElement('a');
			anchor.href = url;
			anchor.download = rendered.name;
			document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
			// Give the download a beat to start before revoking the blob URL.
			setTimeout(() => URL.revokeObjectURL(url), 30_000);
			toasts.success(`Exported ${rendered.name} · ${humanBytes(rendered.size)}`);
		} catch (e) {
			const message = exportErrorMessage(e);
			if (/cancelled/i.test(message)) toasts.info('Export cancelled');
			else toasts.error(message);
		} finally {
			mineController = undefined;
			phase = 'idle';
			progressLabel = '';
			progress = 0;
		}
	}

	async function submit() {
		if (!canPost) return;
		const controller = new AbortController();
		mineController = controller;
		powProgress = null;
		try {
			if (mediaKind === 'video') stageVideo?.pause();
			// Lineage pre-flight (S-014): refuse to extend a cyclic/self-referential
			// chain — a malformed source would poison every remix downstream of it.
			// Unknown ancestors degrade to chain-ends and stay publishable.
			if (remixSource) {
				const result = await remixChainOf(
					[
						['remix', remixSource.eventId, ...(remixSource.relays ?? [])],
						['p', remixSource.pubkey]
					],
					async (eventId) => {
						try {
							const [event] = await queryOnce([{ ids: [eventId], limit: 1 }]);
							return event ? event.tags : null;
						} catch {
							return null; // pruned history = natural chain end
						}
					}
				);
				if (!result.ok && result.reason === 'cycle') {
					throw new Error('This remix chain loops — clear the remix source before publishing');
				}
			}
			const rendered = await exportMeme();
			const uploaded = await uploadRendered(rendered);
			track('publishing', 'Publishing to Nostr…');
			const eventIds = await Promise.all(
				destinations.map((destination) =>
					destination === 'story'
						? publishStory(uploaded)
						: destination === 'note'
							? publishNote(uploaded)
							: publishBitz(uploaded)
				)
			);
			const eventId = eventIds[0]!;
			powPrefs.remember(showPow ? pow : 0);
			powPrefs.rememberPanelVisibility(showPow);
			toasts.push(
				destinations.length > 1
					? `Meme published to ${destinations.length} public places`
					: destinations[0] === 'story'
						? 'Meme story posted · lasts 24h'
						: destinations[0] === 'note'
							? 'Meme note posted · kind 1'
							: `Meme published · kind ${kindInfo?.kind}`,
				'success',
				6000,
				destinations.length === 1 && destinations[0] === 'note'
					? { label: 'View note', run: () => goto(`/note/${eventId}`) }
					: { label: 'View in Bitz', run: () => goto(`/bitz${bitzHashLink(eventId)}`) }
			);
			onposted(eventId);
			reset();
			draftWriter.clear();
			// Batch mode: keep the studio open and load the next queued GIF.
			if (batch.remaining > 0) {
				void stageNextQueued();
				toasts.info(`Next meme loaded — ${batch.remaining} left in queue`);
				return;
			}
			batch.clear();
			open = false;
		} catch (e) {
			const message = exportErrorMessage(e);
			if (/cancelled/i.test(message)) toasts.info('Meme export cancelled — nothing posted');
			else toasts.error(message);
		} finally {
			mineController = undefined;
			powProgress = null;
			phase = 'idle';
			progressLabel = '';
			progress = 0;
		}
	}

	function requestClose() {
		if (busy) {
			toasts.info('Still working on your meme — one moment…');
			return;
		}
		if (dirty) {
			draftWriter.flush();
			discardIntent = 'close';
			confirmDiscard = true;
			return;
		}
		reset();
	}

	/** What the discard dialog should do after wiping: `close` lands on the
	 *  start panel (the page NEVER blanks), `new` is the "Start over" action
	 *  (also stays). Both keep the page mounted — the route owns leaving. */
	let discardIntent = $state<'close' | 'new'>('close');
	let pendingNewTemplateId = $state<string | null>(null);

	/** Shared wipe: clears everything (media, captions, layers, sounds, remix
	 *  lineage, queue, draft) and lands on the start panel. */
	function startFresh() {
		const templateId = pendingNewTemplateId;
		pendingNewTemplateId = null;
		confirmDiscard = false;
		batch.clear();
		reset();
		draftWriter.clear();
		if (!templateId) return;
		const saved = memeTemplates.list.find((template) => template.id === templateId);
		if (!saved) {
			toasts.error('That saved template is no longer available');
			return;
		}
		overlays = memeTemplates.apply(saved);
		selectedId = overlays[0]?.id ?? null;
		preserveLayoutOnNextMedia = true;
		toasts.success(`New draft created from “${saved.label}” — choose media to continue`);
	}

	/** "Start over" — a functional reset/create-new from inside the editor
	 *  (remix included: wipes the lineage and any handoff leftovers). */
	function requestNew() {
		if (busy) {
			toasts.info('Still working on your meme — one moment…');
			return;
		}
		pendingNewTemplateId = null;
		if (dirty) {
			draftWriter.flush();
			discardIntent = 'new';
			confirmDiscard = true;
			return;
		}
		discardIntent = 'new';
		startFresh();
	}

	/** Start a fresh, editable composition from a saved caption layout. The
	 * current source and edits are intentionally cleared, just like Start over. */
	function newDraftFromSavedTemplate(id: string) {
		if (busy) return;
		if (!memeTemplates.list.some((template) => template.id === id)) return;
		pendingNewTemplateId = id;
		discardIntent = 'new';
		if (dirty) {
			draftWriter.flush();
			confirmDiscard = true;
			return;
		}
		startFresh();
	}

	function keepEditing() {
		pendingNewTemplateId = null;
		confirmDiscard = false;
	}

	function discard() {
		startFresh();
	}

	/** True while an editable surface owns keystrokes — the shortcut layer
	 *  must never fight typing (inputs, textareas, selects, contenteditable). */
	function isTypingTarget(target: EventTarget | null): boolean {
		return (
			target instanceof Element &&
			!!target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')
		);
	}

	/** Nudge the playhead by `deltaSec` (keyboard arrows — no clock, no nudge). */
	function nudgePlayhead(deltaSec: number): void {
		if (!timelineActive) return;
		const base = mediaKind === 'video' ? (stageVideo?.currentTime ?? stageSeconds) : stageSeconds;
		scrubPreview(base + deltaSec);
	}

	/** Studio keyboard layer (both modes): Space = play/pause, ←/→ = nudge the
	 *  playhead (Shift = 10×), 1–9 = audition + cue the nth synth sound at the
	 *  playhead, ⌘/Ctrl+Enter = publish. Keys stay inert while typing, while a
	 *  dialog/menu owns the screen, or mid-export. */
	function handleStudioShortcut(event: KeyboardEvent): void {
		if (!open || soundDialogOpen || popovers.active) return;
		if (isTypingTarget(event.target)) return;
		if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
			event.preventDefault();
			void submit();
			return;
		}
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
			event.preventDefault();
			if (event.shiftKey) redoDrawing();
			else undoDrawing();
			return;
		}
		if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
			event.preventDefault();
			redoDrawing();
			return;
		}
		if (busy) return;
		if ((event.key === 'Delete' || event.key === 'Backspace') && selectedDrawingGroup) {
			event.preventDefault();
			removeDrawingGroup(selectedDrawingGroup.id);
			return;
		}
		if (event.key.toLowerCase() === 'x' && selectedDrawingGroup && timelineActive) {
			event.preventDefault();
			splitDrawingAtPlayhead();
			return;
		}
		if (event.key === ' ') {
			// Space also activates a focused control — leave that to the browser.
			if (event.target instanceof Element && event.target.closest('button, a, [role="button"]'))
				return;
			event.preventDefault();
			togglePreview();
			return;
		}
		if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			event.preventDefault();
			const unit = event.shiftKey ? 1 : 0.1;
			nudgePlayhead(event.key === 'ArrowLeft' ? -unit : unit);
			return;
		}
		if (event.key === 'm' || event.key === 'M') {
			event.preventDefault();
			togglePreviewSound();
			return;
		}
		if (!mediaKind) return;
		const digit = Number(event.key);
		const sfx = digit >= 1 && digit <= 9 ? MEME_SFX_IDS[digit - 1] : undefined;
		if (sfx) {
			event.preventDefault();
			previewSfx(sfx);
			addSfxCue(sfx);
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!open) return;
		if (confirmDiscard) {
			// Escape dismisses the discard modal; the route owns Escape-elsewhere
			// (back to the studio home).
			if (event.key === 'Escape') {
				event.preventDefault();
				confirmDiscard = false;
			}
			return;
		}
		handleStudioShortcut(event);
	}

	function clamp01(value: number): number {
		return Math.min(1, Math.max(0, value));
	}

	onMount(() => {
		// Stage zoom preference (per device) — tolerant parse, snapped to a step.
		try {
			const saved = Number(localStorage.getItem(STAGE_ZOOM_KEY));
			if (STAGE_ZOOM_STEPS.some((z) => Math.abs(z - saved) < 0.001)) stageZoom = saved;
		} catch {
			/* ignore */
		}
		// Artboard preference (per device).
		try {
			const saved = localStorage.getItem(ARTBOARD_KEY) as ArtboardId | null;
			if (saved && ARTBOARDS.some((a) => a.id === saved)) artboardId = saved;
		} catch {
			/* ignore */
		}
		// Drawing colors are a lightweight per-device preference. Keep only valid
		// swatches so an old or manually edited value cannot affect the canvas.
		try {
			const saved = JSON.parse(localStorage.getItem(DRAWING_RECENT_COLORS_KEY) ?? '[]');
			if (Array.isArray(saved)) {
				drawingRecentColors = saved
					.filter(
						(color): color is string => typeof color === 'string' && DRAWING_COLOR.test(color)
					)
					.map((color) => color.toLowerCase())
					.filter((color, index, colors) => colors.indexOf(color) === index)
					.slice(0, 8);
			}
		} catch {
			/* ignore malformed or unavailable storage */
		}
		// Draft recovery (plan F-010): restore work-in-progress after a crash,
		// refresh or accidental close. Runs once per component lifetime.
		const draft = readMemeDraft();
		if (draft && !file) {
			let restored = false;
			void draftMediaFile(draft).then((media) => {
				if (media) {
					file = media.file;
					previewUrl = media.previewUrl;
					mediaKind = media.file.type.startsWith('video/')
						? ('video' as const)
						: ('image' as const);
					restored = true;
				}
				overlays = draftOverlays(draft);
				sfxCues = draftSfxCues(draft);
				imageLayers = draftImageLayers(draft);
				drawingGroups = draftDrawingGroups(draft);
				selectedDrawingGroupId = drawingGroups[0]?.id ?? null;
				for (const layer of imageLayers) {
					void cacheLayerBitmap(layer.src);
					void layerAssets.cacheGif(layer.src);
				}
				trimStartSec = Math.max(0, draft.trimStartSec ?? 0);
				trimEndSec = draft.trimEndSec ?? null;
				playbackRate = Math.min(2, Math.max(0.5, draft.playbackRate ?? 1));
				selectedId =
					draft.selectedId && overlays.some((o) => o.id === draft.selectedId)
						? draft.selectedId
						: (overlays[0]?.id ?? null);
				caption = draft.caption;
				sensitive = draft.sensitive;
				destinations = draft.destinations?.length ? [...draft.destinations] : [draft.destination];
				lookId = memeLookOf(draft.lookId);
				if (draft.mediaTransform) {
					mediaZoom = Math.min(4, Math.max(1, draft.mediaTransform.scale || 1));
					mediaPanX = Math.min(1, Math.max(-1, draft.mediaTransform.x || 0));
					mediaPanY = Math.min(1, Math.max(-1, draft.mediaTransform.y || 0));
				}
				if (
					restored ||
					overlays.length > 0 ||
					imageLayers.length > 0 ||
					drawingGroups.length > 0 ||
					sfxCues.length > 0 ||
					caption.trim()
				) {
					toasts.info('Draft restored — welcome back', 4000);
				}
			});
		}

		return () => {
			stopPerformanceRecording();
			revokePreview();
			mineController?.abort();
		};
	});

	// Autosave: every mutation of user-visible work rewrites the debounced draft.
	const draftWriter = createMemeDraftWriter();
	$effect(() => {
		// Track every editable field…
		void overlays;
		void caption;
		void sensitive;
		void destinations;
		void selectedId;
		void sfxCues;
		void imageLayers;
		void drawingGroups;
		void trimStartSec;
		void trimEndSec;
		void playbackRate;
		void lookId;
		void mediaZoom;
		void mediaPanX;
		void mediaPanY;
		if (!dirty) return; // nothing worth saving

		// Snapshot synchronously; serialize the media bytes untracked so a slow
		// encode never keeps the effect re-running or blocks the UI thread.
		const snapshot = {
			overlays,
			sfxCues,
			imageLayers,
			drawingGroups,
			trimStartSec,
			trimEndSec,
			playbackRate,
			caption,
			sensitive,
			destinations,
			selectedId,
			lookId,
			framing: { scale: mediaZoom, x: mediaPanX, y: mediaPanY },
			pendingFile: file
		};
		queueMicrotask(() => {
			void (async () => {
				const media = snapshot.pendingFile ? await mediaToDraftDataUrl(snapshot.pendingFile) : null;
				// Media may have changed while encoding — the debounced writer only
				// keeps the latest write, so a second pass would be redundant.
				draftWriter.write({
					media,
					overlays: snapshot.overlays,
					caption: snapshot.caption,
					sensitive: snapshot.sensitive,
					destination: snapshot.destinations[0] ?? 'bitz',
					destinations: snapshot.destinations,
					selectedId: snapshot.selectedId,
					lookId: snapshot.lookId,
					sfxCues: snapshot.sfxCues,
					imageLayers: snapshot.imageLayers,
					drawingGroups: snapshot.drawingGroups,
					trimStartSec: snapshot.trimStartSec,
					trimEndSec: snapshot.trimEndSec,
					playbackRate: snapshot.playbackRate,
					...(snapshot.framing.scale !== 1 || snapshot.framing.x !== 0 || snapshot.framing.y !== 0
						? { mediaTransform: snapshot.framing }
						: {})
				});
			})();
		});
	});
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div class="h-full">
		<div
			class="surface-card relative z-10 flex h-full w-full max-w-none flex-col overflow-hidden rounded-none border-0 shadow-none"
		>
			<MemeBatchQueueBar
				items={batch.remainingItems}
				startIndex={batch.index}
				peekLabel={batch.peekLabel}
				{busy}
				staging={gifStageBusy}
				onCaption={(id, value) => batch.setCaption(id, value)}
				onSkip={() => void stageNextQueued()}
				onClear={() => batch.clear()}
			/>
			<div class="flex min-h-0 flex-1 flex-col">
				{#if !file}
					<MemeStudioEmptyState
						remixing={!!remixSource}
						{remixLabel}
						staging={gifStageBusy}
						{busy}
						gifPickerId={gifPickerMenuId}
						blankPickerId={blankMenuId}
						sourceLibraryId={startLibMenuId}
						bind:showUrl={showGifUrlForm}
						bind:url={gifUrl}
						urlBusy={gifUrlBusy}
						onChooseMedia={() => fileInput?.click()}
						onChooseFormat={pickMediaAs}
						onDropFile={acceptFile}
						onPickGif={pickGifForStage}
						onPickGifs={pickGifsForStage}
						onBlank={startBlank}
						onSubmitUrl={importGifFromUrl}
						onOpenSource={(source) => void loadSourceFromUrl(source.url, source.label)}
						onAddSourceLayer={(source) =>
							void addImageLayer({ url: source.url }, undefined, {
								atMs: timelineActive ? Math.round(stageSeconds * 1000) : undefined
							})}
						onOpenSoundStudio={() => (soundDialogOpen = true)}
					/>
				{:else}
					<!-- Panes as snippets — one markup source, two layouts: the dialog grid
					     (composer dialog) and the full-page pro studio (tools · stage ·
					     inspector + a pinned timeline bar). -->
					{#snippet stagePane()}
						<!-- WYSIWYG stage: fills the center pane on the full page (scaled
					     by the zoom control — overlay coords are normalized to the stage
					     box, so zoom never disturbs them), fixed 260px in the dialog.
					     The width calc uses the ARTBOARD ratio (was hardcoded 9:16). -->
						<div class="mx-auto flex h-full min-h-0 w-full max-w-[720px] flex-col">
							<div class="flex shrink-0 items-center justify-between gap-2 pb-1.5">
								<p
									class="text-[10px] font-bold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
								>
									Preview — drag captions
								</p>
								<!-- Canvas-size zoom (full layout): fit ↔ 150% for detail work.
									     The % readout doubles as a reset-to-fit button. -->
								<div class="flex items-center gap-0.5" role="group" aria-label="Stage zoom">
									<button
										type="button"
										onclick={() => zoomStage(-1)}
										disabled={stageZoom <= STAGE_ZOOM_STEPS[0] + 0.001}
										aria-label="Zoom out stage"
										title="Zoom out the preview canvas"
										class="grid size-6 place-items-center rounded-full text-[var(--ui-text-dimmed)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-30"
									>
										<Icon name="i-lucide-zoom-out" class="size-3.5" />
									</button>
									<button
										type="button"
										onclick={() => setStageZoom(1)}
										disabled={Math.abs(stageZoom - 1) < 0.001}
										title="Reset zoom to fit"
										class="min-w-11 rounded-full px-1 font-mono text-[10px] font-bold text-[var(--ui-text-dimmed)] tabular-nums transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-60"
									>
										{Math.round(stageZoom * 100)}%
									</button>
									<button
										type="button"
										onclick={() => zoomStage(1)}
										disabled={stageZoom >= STAGE_ZOOM_STEPS[STAGE_ZOOM_STEPS.length - 1] - 0.001}
										aria-label="Zoom in stage"
										title="Zoom in the preview canvas — pan by scrolling the stage"
										class="grid size-6 place-items-center rounded-full text-[var(--ui-text-dimmed)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-30"
									>
										<Icon name="i-lucide-zoom-in" class="size-3.5" />
									</button>
								</div>
							</div>
							<!-- Keep the canvas at its readable artboard size while the
							     preview header and source toolbar use the full center pane. -->
							<div class="flex min-h-0 flex-1 items-center justify-center overflow-auto py-2">
								<div
									class="mx-auto shrink-0"
									style={`width:calc(min(430px, (100dvh - 17.5rem) * ${stageRatio}) * ${stageZoom})`}
								>
									<div
										bind:this={stageBox}
										role="application"
										aria-label="Meme preview — drag captions to position them"
										class="relative max-h-full touch-none overflow-hidden rounded-2xl border border-[var(--ui-border-muted)] bg-black select-none"
										style="aspect-ratio:{stageAspect};"
										onpointermove={onStagePointerMove}
										onpointerup={endDrag}
										onpointercancel={endDrag}
									>
										{#if mediaKind === 'video'}
											<!-- The media box is the EXACT coverRect the export draws
									     (artboard cover-fit + crop/zoom framing) — WYSIWYG. -->
											<video
												src={previewUrl}
												bind:this={stageVideo}
												crossOrigin="anonymous"
												class="absolute object-cover"
												style={mediaFrame
													? `left:${mediaFrame.left}%; top:${mediaFrame.top}%; width:${mediaFrame.width}%; height:${mediaFrame.height}%; filter:${previewMediaFilterCss}; transform:${previewMediaBoxCss};`
													: `filter:${previewMediaFilterCss}; transform:${previewMediaBoxCss};`}
												autoplay
												muted
												loop
												playsinline
												aria-label="Meme video preview"
												onplay={() => (previewPlaying = true)}
												onpause={() => (previewPlaying = false)}
												onloadedmetadata={onVideoMetadata}
												ondurationchange={(e) => {
													// Browser-recorded webm clips report duration=Infinity at
													// loadedmetadata and resolve it later — adopt it when it lands.
													const v = e.currentTarget as HTMLVideoElement;
													if (
														v.videoWidth &&
														Number.isFinite(v.duration) &&
														v.duration !== meta?.duration
													) {
														meta = {
															width: v.videoWidth,
															height: v.videoHeight,
															duration: v.duration
														};
													}
												}}
												ontimeupdate={(e) => {
													const video = e.currentTarget as HTMLVideoElement;
													const end = trimEndSec ?? meta?.duration ?? 0;
													if (!expertTimeline && end > trimStartSec && video.currentTime >= end) {
														// Loop the selected edit window rather than the whole source.
														video.currentTime = trimStartSec;
														stageSeconds = trimStartSec;
														return;
													}
													stageSeconds = video.currentTime;
												}}
											>
												<track kind="captions" />
											</video>
										{:else if gif}
											<!-- Animated GIF: canvas preview on the stage clock so overlay
								     timing windows + SFX cues render exactly like the export. -->
											<canvas
												bind:this={gifStageCanvas}
												class="absolute inset-0 size-full"
												style="filter:{lookCss};"
												aria-label="Animated GIF preview"
											></canvas>
										{:else}
											<img
												src={previewUrl}
												alt="Meme preview"
												bind:this={stageImg}
												crossOrigin="anonymous"
												class="absolute object-cover"
												style={mediaFrame
													? `left:${mediaFrame.left}%; top:${mediaFrame.top}%; width:${mediaFrame.width}%; height:${mediaFrame.height}%; filter:${previewMediaFilterCss}; transform:${previewMediaBoxCss};`
													: `filter:${previewMediaFilterCss}; transform:${previewMediaBoxCss};`}
												onload={onImageLoad}
											/>
										{/if}
										<!-- Frame-FX overlay mirror (flash/color/strobe/vignette/spotlight
			     paint as a translucent layer over the media box — the same values
			     paintFxFrame burns into exports). -->
										{#if previewFx.overlayBackground}
											<div
												class="pointer-events-none absolute inset-0 z-10"
												style="background:{previewFx.overlayBackground}; opacity:{previewFx.overlayOpacity ??
													0};"
												aria-hidden="true"
											></div>
										{/if}
										<MemeDrawingSurface
											active={drawActive && !busy}
											groups={drawingGroups}
											tool={drawingTool}
											color={drawingColor}
											width={drawingWidth}
											opacity={drawingOpacity}
											atMs={timelineActive ? Math.round(stageSeconds * 1000) : undefined}
											pressureEnabled={drawingPressureEnabled}
											{drawWithFinger}
											smoothing={drawingSmoothing}
											onAddStroke={addDrawingStroke}
										/>

										<!-- Live draggable overlay previews (video overlays honor
							     their timing windows via the stage clock above). -->
										{#each overlays as overlay, i (overlay.id)}
											{@const visible =
												(mediaKind !== 'video' && !gif) ||
												(overlay.startMs === undefined && overlay.endMs === undefined) ||
												overlayVisibleAt(overlay, stageSeconds * 1000)}
											{#if visible}
												<button
													type="button"
													onpointerdown={(e) => onOverlayPointerDown(e, overlay)}
													class="absolute max-w-[94%] -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-md px-1 text-center leading-[1.12] font-bold whitespace-pre-wrap {selectedId ===
													overlay.id
														? 'bg-warm-500/15 ring-1 ring-warm-500/60'
														: 'hover:bg-white/5'}"
													style="left:{overlay.x * 100}%; top:{overlay.y *
														100}%; color:{overlay.color}; font-family:{fontStack(
														overlay.font
													)}; font-size:{overlayPx(overlay)}px; {overlay.stroke
														? 'text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 6px rgba(0,0,0,0.8);'
														: ''}{overlay.bar
														? 'background: rgba(0,0,0,0.55); border-radius: 0.25em; padding: 0.1em 0.35em;'
														: ''}{overlayFxStyle(overlay)}"
													aria-label={`Caption ${i + 1}: ${overlay.text}`}
												>
													{overlay.caps ? overlay.text.toUpperCase() : overlay.text}
												</button>
											{/if}
										{/each}

										<!-- Live image layers: movable + resizable via the shared
							     stage pointer plumbing. Bitmap shows once decoded;
							     unresolved srcs sit as a dashed placeholder. -->
										{#each imageLayers as layer, li (layer.id)}
											{@const layerOn =
												(mediaKind !== 'video' && !gif) ||
												(layer.startMs === undefined && layer.endMs === undefined) ||
												imageOverlayVisibleAt(layer, stageSeconds * 1000)}
											{#if layerOn}
												<!-- Effects mirror paintImageOverlays exactly: center-anchored
										     rotate + mirror flips, opacity, per-layer look (CSS filter
										     both places = WYSIWYG). -->
												<div
													role="button"
													tabindex="-1"
													onpointerdown={(e) => onLayerPointerDown(e, layer)}
													class="absolute flex cursor-grab items-center justify-center {selectedLayerId ===
													layer.id
														? 'ring-2 ring-warm-500/80'
														: 'hover:ring-1 hover:ring-white/40'}"
													style="left:{layer.x * 100}%; top:{layer.y * 100}%; height:{layer.size *
														100}%; aspect-ratio:{layer.aspect}; transform:translate(-50%, -50%) {layerMotionCss(
														layer.motionId ?? 'none',
														timelineActive && mediaKind === 'video'
															? Math.round(stageSeconds * 1000)
															: motionTickMs,
														layer.startMs
													) ?? ''} rotate({layer.rotate ?? 0}deg) scaleX({layer.flipH
														? -1
														: 1}) scaleY({layer.flipV ? -1 : 1}); opacity:{layer.opacity ??
														1}; filter:{layerLookCss(layer)};"
													aria-label={`Image layer ${li + 1}`}
												>
													{#if layerAssets.bitmaps.has(layer.src)}
														<img
															src={layerAssets.renderSrcs.get(layer.src) ?? layer.src}
															alt=""
															crossOrigin="anonymous"
															class="pointer-events-none max-h-full max-w-full select-none {layerAssets.bitmaps.get(
																layer.src
															)?.complete
																? ''
																: 'opacity-60'}"
															draggable="false"
														/>
													{:else}
														<span
															class="grid size-full place-items-center rounded-lg border border-dashed border-white/40 bg-black/30 text-[10px] font-bold text-white/80"
														>
															{layerBusy ? 'loading…' : 'IMG'}
														</span>
													{/if}
													{#if selectedLayerId === layer.id}
														<!-- Resize handle: bottom-right corner, pointer-down starts
											     size mode (patched via the stage move handler).
											     stopPropagation keeps the layer's own move-grab from
											     overwriting the resize drag mode. -->
														<span
															role="button"
															tabindex="-1"
															onpointerdown={(e) => {
																e.stopPropagation();
																onLayerPointerDown(e, layer, 'resize');
															}}
															class="absolute -right-1.5 -bottom-1.5 grid size-5 cursor-nwse-resize place-items-center rounded-full border border-warm-500 bg-black/80 text-warm-500"
															aria-label={`Resize image layer ${li + 1}`}
														>
															<Icon name="i-lucide-maximize-2" class="size-3" />
														</span>
													{/if}
												</div>
											{/if}
										{/each}

										{#if busy}
											<div
												class="absolute inset-0 z-20 grid place-items-center bg-black/55 backdrop-blur-[2px]"
											>
												<div class="w-44 text-center">
													<Icon
														name="i-lucide-loader-circle"
														class="mx-auto size-8 animate-spin text-warm-500"
													/>
													<p class="mt-2 text-[12px] font-bold text-white">{progressLabel}</p>
													{#if phase === 'rendering' || phase === 'uploading'}
														<div class="mt-2 h-1.5 overflow-hidden rounded-full bg-white/20">
															<div
																class="h-full rounded-full bg-warm-500 transition-[width] duration-200"
																style={`width:${progress}%`}
															></div>
														</div>
													{/if}
												</div>
											</div>
										{/if}
									</div>
								</div>
							</div>
							<MemeStageMediaControls
								{busy}
								staging={gifStageBusy}
								sourceLibraryId={swapLibMenuId}
								gifPickerId={swapGifMenuId}
								bind:keepLayout={keepLayoutOnSwap}
								bind:showUrlForm={showSwapUrlForm}
								bind:url={gifUrl}
								urlBusy={gifUrlBusy}
								onChooseFile={() => fileInput?.click()}
								onQueue={() => queueInput?.click()}
								onOpenSource={(source) => void loadSourceFromUrl(source.url, source.label)}
								onAddLayer={(source) =>
									void addImageLayer({ url: source.url }, undefined, {
										atMs: timelineActive ? Math.round(stageSeconds * 1000) : undefined
									})}
								onPickGif={swapGifFromLib}
								onSubmitUrl={() => void importGifFromUrl()}
								onRemove={clearMedia}
								onNew={requestNew}
							/>
						</div>
						{#if expertTimeline && mediaKind === 'video'}
							<MemeExpertClipPanel
								clips={videoClips}
								bind:selectedId={selectedClipId}
								onSelect={(clip, index) => {
									const before = videoClips
										.slice(0, index)
										.reduce((total, item) => total + (item.endSec - item.startSec), 0);
									scrubPreview(before);
								}}
								onMove={(direction) => {
									if (selectedClipId) videoClips = moveClip(videoClips, selectedClipId, direction);
								}}
							/>
						{/if}
					{/snippet}

					{#snippet timelinePane()}
						<MemeTimeline
							durationSec={editorTimelineDurationSec}
							seconds={editorTimelineSeconds}
							playing={previewPlaying}
							onPlayPause={togglePreview}
							onScrub={scrubTimeline}
							soundOn={previewSoundOn}
							onToggleSound={togglePreviewSound}
							overlays={timelineOverlays}
							layers={timelineLayers}
							drawings={timelineDrawings}
							cues={timelineCues}
							baseTrack={timelineBaseTrack}
							onPatchBase={patchTimelineBase}
							selectedBase={selectedBaseTrack}
							onSelectBase={() => {
								selectedBaseTrack = true;
								if (expertTimeline) {
									const mapped = sourceTimeAt(videoClips, stageSeconds);
									selectedClipId = mapped ? (videoClips[mapped.clipIndex]?.id ?? null) : null;
								}
								selectedId = null;
								selectedLayerId = null;
								selectedCueId = null;
								selectedDrawingGroupId = null;
							}}
							{busy}
							selectedOverlayId={selectedId}
							{selectedLayerId}
							selectedDrawingId={selectedDrawingGroupId}
							{selectedCueId}
							onSelectOverlay={(id) => {
								selectedId = id;
								selectedLayerId = null;
								selectedCueId = null;
								selectedDrawingGroupId = null;
								selectedBaseTrack = false;
							}}
							onSelectLayer={(id) => {
								selectedLayerId = id;
								selectedId = null;
								selectedCueId = null;
								selectedDrawingGroupId = null;
								selectedBaseTrack = false;
							}}
							onSelectDrawing={(id) => {
								selectedDrawingGroupId = id;
								selectedId = null;
								selectedLayerId = null;
								selectedCueId = null;
								selectedBaseTrack = false;
							}}
							onSelectCue={(id) => {
								selectedCueId = id;
								selectedId = null;
								selectedLayerId = null;
								selectedBaseTrack = false;
							}}
							onPatchOverlay={(id, patch) => patchOverlay(id, patchFromTimeline(patch))}
							onPatchLayer={(id, patch) => patchLayer(id, patchFromTimeline(patch))}
							onPatchDrawing={(id, patch) => {
								const offset = usesTrimmedTimeline ? Math.round(trimStartSec * 1000) : 0;
								patchDrawingGroup(id, {
									...(patch.startMs !== undefined ? { startMs: patch.startMs + offset } : {}),
									...(patch.visibleFromMs !== undefined
										? { visibleFromMs: patch.visibleFromMs + offset }
										: {}),
									...(patch.visibleUntilMs !== undefined
										? { visibleUntilMs: patch.visibleUntilMs + offset }
										: {})
								});
							}}
							onStartDrawingEdit={beginDrawingTimelineEdit}
							onRemoveLayer={removeLayer}
							onReorderLayer={moveLayerRow}
							onPatchCue={(id, atMs) =>
								retimeSfxCue(
									id,
									atMs + (usesTrimmedTimeline ? Math.round(trimStartSec * 1000) : 0)
								)}
							onPatchCueLane={moveSfxCueLane}
							cueMetaFor={cueMeta}
						/>
						<!-- Insert-at-playhead actions for the timeline. -->
						<div class="mt-1.5 flex flex-wrap items-center gap-1.5">
							<MemeTimelineQuickActions
								{busy}
								{mediaKind}
								{timelineActive}
								{stageSeconds}
								selectedOverlayId={selectedId}
								{selectedLayerId}
								bind:includeSourceAudio
								bind:sourceAudioGain
								{expertTimeline}
								hasSelectedClip={!!selectedClipId}
								canDeleteClip={videoClips.length > 1}
								onOtherSource={pickOtherTimelineSource}
								onEnableExpert={enableExpertTimeline}
								onSplitVideo={splitVideoClipAtPlayhead}
								onDeleteClip={removeSelectedVideoClip}
								onCutVideo={cutVideoAtPlayhead}
								onSplitSelected={splitSelectedAtPlayhead}
								onAddCaption={addCaptionAtPlayhead}
								onAddSound={() => popovers.open(sfxMenuId)}
								onAutoMeme={() => {
									// One-tap Auto Meme: analyze (if no cards yet), then open the
									// Sound Studio where the ladder renders — no hunting for it.
									if (!suggestionGroups.length) void buildSuggestions();
									soundDialogOpen = true;
								}}
								autoMemeReady={suggestionGroups.length > 0}
								analyzing={suggestBusy}
							/>
							<MemeTimelineImagePicker
								id={tlImageMenuId}
								seconds={stageSeconds}
								busy={layerBusy}
								bind:url={layerUrl}
								bind:showUrl={showTlLayerUrlForm}
								urlBusy={layerUrlBusy}
								onBrowse={() => {
									pendingLayerAtMs = Math.round(stageSeconds * 1000);
									layerInput?.click();
									popovers.close();
								}}
								onSubmitUrl={() => {
									void addLayerFromUrl(Math.round(stageSeconds * 1000));
									popovers.close();
								}}
								onPickGif={(gif) => void addLayerFromGifLib(gif, Math.round(stageSeconds * 1000))}
							/>
							{#if mediaKind === 'video'}
								<button
									type="button"
									onclick={() => void pickPosterAt(stageSeconds)}
									disabled={busy || !stageVideo}
									title="Use the frame at the playhead as the poster/thumbnail"
									class="flex items-center gap-1 rounded-full bg-[var(--ui-bg-accented)] px-2.5 py-1 text-[10.5px] font-bold text-[var(--ui-text-muted)] transition hover:text-[var(--ui-text)] disabled:opacity-40"
								>
									<Icon name="i-lucide-image-up" class="size-3.5" />
									Poster @ {formatDuration(stageSeconds)}
								</button>
							{/if}
						</div>
					{/snippet}

					{#snippet toolsPane()}
						<!-- Tool rail: layouts, stickers, image layers, looks -->
						<div class="flex min-w-0 flex-col gap-3">
							<MemeTemplateSlotTools
								{overlays}
								mediaKind={mediaKind ?? undefined}
								{busy}
								{dirty}
								{slotBusyId}
								bind:templateName
								bind:showTemplateSave
								bind:slotName
								{applyTemplate}
								{applyImageLayout}
								{addOverlay}
								{applySavedTemplate}
								{newDraftFromSavedTemplate}
								{removeSavedTemplate}
								{saveCurrentTemplate}
								{openSlot}
								{duplicateSlot}
								{renameSlot}
								{removeSlot}
								{saveCurrentSlot}
								currentPubkey={me?.pk ?? ''}
							/>
							<div
								class="rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3 py-2.5"
							>
								<div class="flex items-center justify-between gap-2">
									<span
										class="flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
										><Icon name="i-lucide-pencil-line" class="size-3.5" /> Draw</span
									>
									<button
										type="button"
										disabled={busy}
										onclick={() => (drawActive = !drawActive)}
										aria-pressed={drawActive}
										class="rounded-full px-2.5 py-1 text-[10.5px] font-bold transition {drawActive
											? 'bg-warm-500 text-white'
											: 'bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'} disabled:opacity-40"
										>{drawActive ? 'Drawing on' : 'Draw'}</button
									>
								</div>
								<button
									type="button"
									disabled={busy}
									onclick={openRecordingPreflight}
									class="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-2 py-1.5 text-[10.5px] font-bold text-[var(--ui-text-muted)] transition hover:border-warm-500/40 hover:text-warm-600 disabled:opacity-40"
								>
									<Icon name="i-lucide-circle-dot" class="size-3.5 text-red-500" /> Record performance
								</button>
								{#if recordingPreflightOpen && recordingCapabilities}
									<div
										class="mt-2 rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] p-2"
									>
										<div class="flex items-center justify-between gap-2">
											<span class="text-[10px] font-bold text-[var(--ui-text)]"
												>Performance check</span
											>
											<button
												type="button"
												onclick={() => (recordingPreflightOpen = false)}
												aria-label="Close performance check"
												class="text-[var(--ui-text-dimmed)] hover:text-[var(--ui-text)]"
												><Icon name="i-lucide-x" class="size-3" /></button
											>
										</div>
										<div class="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-1 text-[9.5px]">
											{#each [['Pointer drawing', recordingCapabilities?.pointer], ['Microphone', recordingCapabilities?.microphone], ['Canvas capture', recordingCapabilities?.canvasCapture], ['Video recorder', recordingCapabilities?.mediaRecorder]] as capability}
												<span class={capability[1] ? 'text-emerald-600' : 'text-red-500'}
													>● {capability[0]}</span
												>
											{/each}
										</div>
										<button
											type="button"
											disabled={!recordingCapabilities?.pointer}
											onclick={beginPerformanceCountdown}
											class="mt-2 w-full rounded-full bg-warm-500 px-2 py-1 text-[10px] font-bold text-white disabled:opacity-40"
											>Start drawing take</button
										>
										<button
											type="button"
											disabled={!recordingCapabilities?.microphone}
											onclick={() => {
												recordingPreflightOpen = false;
												soundDialogOpen = true;
											}}
											class="mt-2 w-full rounded-full bg-warm-500 px-2 py-1 text-[10px] font-bold text-white disabled:opacity-40"
											>Continue to microphone</button
										>
									</div>
								{/if}
								{#if performanceCountdown !== null || performanceRecording}
									<div
										class="mt-2 rounded-lg border border-red-500/35 bg-red-500/10 px-2 py-1.5 text-[10px] font-bold text-red-500"
										role="status"
									>
										{#if performanceCountdown !== null}
											Starting performance in {performanceCountdown}…
											<button
												type="button"
												onclick={stopPerformanceRecording}
												class="ml-2 rounded border border-red-500/35 px-1.5 py-0.5 text-[9px]"
												>Cancel</button
											>
										{:else}
											<span class="inline-flex items-center gap-1"
												><span class="size-1.5 animate-pulse rounded-full bg-red-500"
												></span>Recording {formatDuration(performanceElapsedMs / 1000)}</span
											>
											<button
												type="button"
												onclick={stopPerformanceRecording}
												class="ml-2 rounded bg-red-500 px-1.5 py-0.5 text-[9px] text-white"
												>Stop</button
											>
										{/if}
									</div>
								{/if}
								{#if performanceReview}
									<div
										class="mt-2 rounded-lg border border-warm-500/30 bg-warm-500/10 p-2 text-[10px]"
									>
										<div class="font-bold text-[var(--ui-text)]">Review latest take</div>
										<p class="mt-0.5 text-[var(--ui-text-muted)]">
											{formatDuration(performanceReview.durationMs / 1000)} · {performanceReview
												.drawingGroupIds.length} drawing{performanceReview.drawingGroupIds
												.length === 1
												? ''
												: 's'} · {performanceReview.cueIds.length} cue{performanceReview.cueIds
												.length === 1
												? ''
												: 's'}
										</p>
										<div class="mt-1.5 flex gap-1">
											<button
												type="button"
												onclick={() => (performanceReviewId = null)}
												class="rounded-full bg-warm-500 px-2 py-1 text-[9px] font-bold text-white"
												>Keep</button
											>
											<button
												type="button"
												onclick={() => retryPerformanceTake(performanceReview!.id)}
												class="rounded-full px-2 py-1 text-[9px] font-bold text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)]"
												>Retry</button
											>
											<button
												type="button"
												onclick={() => discardPerformanceTake(performanceReview!.id)}
												class="rounded-full px-2 py-1 text-[9px] font-bold text-red-500 hover:bg-red-500/10"
												>Discard</button
											>
										</div>
									</div>
								{/if}
								{#if drawActive}
									<div class="mt-2 flex flex-wrap items-center gap-1">
										{#each ['pen', 'marker', 'eraser', 'line', 'arrow', 'rectangle', 'ellipse'] as tool}
											<button
												type="button"
												onclick={() => (drawingTool = tool as DrawingTool)}
												aria-pressed={drawingTool === tool}
												class="rounded-full px-2 py-1 text-[10px] font-bold {drawingTool === tool
													? 'bg-warm-500/15 text-warm-600'
													: 'text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)]'}"
												>{tool}</button
											>
										{/each}
										<input
											type="color"
											bind:value={drawingColor}
											onchange={(event) =>
												rememberDrawingColor((event.currentTarget as HTMLInputElement).value)}
											aria-label="Drawing color"
											class="ml-1 size-6 cursor-pointer rounded border-0 bg-transparent p-0"
										/>
									</div>
									<div class="mt-1.5 flex flex-wrap items-center gap-1">
										<span class="mr-1 text-[10px] font-bold text-[var(--ui-text-muted)]"
											>Colors</span
										>
										{#each DRAWING_RECOMMENDED_COLORS as paletteColor (paletteColor)}
											<button
												type="button"
												onclick={() => selectDrawingColor(paletteColor)}
												aria-label={`Use ${paletteColor} drawing color`}
												aria-pressed={drawingColor.toLowerCase() === paletteColor}
												class="size-4 rounded-full border border-black/25 ring-offset-1 ring-offset-[var(--ui-bg)] {drawingColor.toLowerCase() ===
												paletteColor
													? 'ring-2 ring-warm-500'
													: 'hover:scale-110'}"
												style={`background-color: ${paletteColor}`}
											></button>
										{/each}
									</div>
									{#if drawingRecentColors.length}
										<div class="mt-1 flex flex-wrap items-center gap-1">
											<span class="mr-1 text-[10px] font-bold text-[var(--ui-text-muted)]"
												>Recent</span
											>
											{#each drawingRecentColors as recentColor (recentColor)}
												<button
													type="button"
													onclick={() => selectDrawingColor(recentColor)}
													aria-label={`Use recent ${recentColor} drawing color`}
													aria-pressed={drawingColor.toLowerCase() === recentColor}
													class="size-4 rounded-full border border-black/25 ring-offset-1 ring-offset-[var(--ui-bg)] {drawingColor.toLowerCase() ===
													recentColor
														? 'ring-2 ring-warm-500'
														: 'hover:scale-110'}"
													style={`background-color: ${recentColor}`}
												></button>
											{/each}
										</div>
									{/if}
									<label
										class="mt-2 flex items-center gap-2 text-[10.5px] font-bold text-[var(--ui-text-muted)]"
										>Size <input
											type="range"
											min="0.3"
											max="6"
											step="0.1"
											value={drawingWidth * 100}
											oninput={(e) =>
												(drawingWidth = Number((e.currentTarget as HTMLInputElement).value) / 100)}
											class="h-1 flex-1 accent-warm-500"
										/></label
									>
									<label
										class="mt-1.5 flex items-center gap-2 text-[10.5px] font-bold text-[var(--ui-text-muted)]"
										>Opacity <input
											type="range"
											min="10"
											max="100"
											step="5"
											value={drawingOpacity * 100}
											oninput={(event) =>
												(drawingOpacity =
													Number((event.currentTarget as HTMLInputElement).value) / 100)}
											class="h-1 flex-1 accent-warm-500"
										/></label
									>
									<div class="mt-1.5 flex flex-wrap items-center gap-1">
										<button
											type="button"
											onclick={() => (drawingPressureEnabled = !drawingPressureEnabled)}
											aria-pressed={drawingPressureEnabled}
											class="rounded-full px-2 py-1 text-[10px] font-bold {drawingPressureEnabled
												? 'bg-warm-500/15 text-warm-600'
												: 'text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)]'}"
											>Pressure</button
										>
										<button
											type="button"
											onclick={() => (drawWithFinger = !drawWithFinger)}
											aria-pressed={drawWithFinger}
											class="rounded-full px-2 py-1 text-[10px] font-bold {drawWithFinger
												? 'bg-warm-500/15 text-warm-600'
												: 'text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)]'}"
											>Finger</button
										>
									</div>
									<div class="mt-1.5 flex flex-wrap items-center gap-1">
										<span class="mr-1 text-[10px] font-bold text-[var(--ui-text-muted)]"
											>Smooth</span
										>
										{#each ['off', 'smooth', 'strong'] as smoothing}
											<button
												type="button"
												onclick={() => (drawingSmoothing = smoothing as DrawingSmoothing)}
												aria-pressed={drawingSmoothing === smoothing}
												class="rounded-full px-2 py-1 text-[10px] font-bold {drawingSmoothing ===
												smoothing
													? 'bg-warm-500/15 text-warm-600'
													: 'text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)]'}"
												>{smoothing}</button
											>
										{/each}
									</div>
									<div class="mt-2 border-t border-[var(--ui-border-muted)] pt-2">
										<div class="mb-1 flex items-center justify-between">
											<span class="text-[10px] font-bold text-[var(--ui-text-muted)]"
												>Live sound pad</span
											>
											<span class="font-mono text-[9px] text-[var(--ui-text-dimmed)]"
												>@ {formatDuration(performanceClockMs() / 1000)}</span
											>
										</div>
										<div class="grid grid-cols-3 gap-1">
											{#each ['pop', 'boom', 'ding', 'whoosh', 'laugh', 'bruh'] as sfx}
												<button
													type="button"
													disabled={busy || sfxCues.length >= 16}
													onclick={() => addLiveSfxCue(sfx as MemeSfxId)}
													class="rounded-md bg-[var(--ui-bg)] px-1.5 py-1.5 text-[10px] font-bold text-[var(--ui-text-muted)] transition hover:bg-warm-500/10 hover:text-warm-600 disabled:opacity-30"
													>{sfxLabels[sfx as MemeSfxId]}</button
												>
											{/each}
										</div>
									</div>
									{#if drawingGroups.length}
										<div class="mt-2 space-y-1">
											{#each drawingGroups as group, index (group.id)}
												<div
													class="flex items-center gap-1 rounded-lg px-1.5 py-1 {selectedDrawingGroup?.id ===
													group.id
														? 'bg-warm-500/10'
														: 'bg-[var(--ui-bg)]/50'}"
												>
													<button
														type="button"
														onclick={() => {
															selectedDrawingGroupId = group.id;
															selectedCueId = null;
															selectedId = null;
															selectedLayerId = null;
															selectedBaseTrack = false;
														}}
														class="min-w-0 flex-1 truncate text-left text-[10px] font-bold text-[var(--ui-text)]"
														>{group.label}</button
													>
													<button
														type="button"
														onclick={() =>
															commitDrawingGroupPatch(group.id, { hidden: !group.hidden })}
														aria-label={group.hidden
															? `Show ${group.label}`
															: `Hide ${group.label}`}
														class="rounded p-0.5 text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)]"
														><Icon
															name={group.hidden ? 'i-lucide-eye-off' : 'i-lucide-eye'}
															class="size-3"
														/></button
													>
													<button
														type="button"
														onclick={() =>
															commitDrawingGroupPatch(group.id, { locked: !group.locked })}
														aria-label={group.locked
															? `Unlock ${group.label}`
															: `Lock ${group.label}`}
														class="rounded p-0.5 text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)]"
														><Icon
															name={group.locked ? 'i-lucide-lock' : 'i-lucide-lock-open'}
															class="size-3"
														/></button
													>
													<button
														type="button"
														disabled={index === drawingGroups.length - 1}
														onclick={() => moveDrawingGroup(group.id, 1)}
														aria-label={`Bring ${group.label} forward`}
														class="rounded p-0.5 text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)] disabled:opacity-30"
														><Icon name="i-lucide-arrow-up" class="size-3" /></button
													>
													<button
														type="button"
														disabled={index === 0}
														onclick={() => moveDrawingGroup(group.id, -1)}
														aria-label={`Send ${group.label} backward`}
														class="rounded p-0.5 text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)] disabled:opacity-30"
														><Icon name="i-lucide-arrow-down" class="size-3" /></button
													>
													<button
														type="button"
														onclick={() => removeDrawingGroup(group.id)}
														aria-label={`Delete ${group.label}`}
														class="rounded p-0.5 text-red-500 hover:bg-red-500/10"
														><Icon name="i-lucide-trash-2" class="size-3" /></button
													>
												</div>
											{/each}
										</div>
										<label
											class="mt-2 flex items-center gap-2 text-[10px] font-bold text-[var(--ui-text-muted)]"
											>Name <input
												value={selectedDrawingGroup?.label ?? ''}
												disabled={!selectedDrawingGroup}
												onchange={(event) => {
													const group = selectedDrawingGroup;
													if (group)
														commitDrawingGroupPatch(group.id, {
															label: (event.currentTarget as HTMLInputElement).value.slice(0, 40)
														});
												}}
												class="min-w-0 flex-1 rounded bg-[var(--ui-bg)] px-1.5 py-1 text-[10px] text-[var(--ui-text)] outline-none"
											/></label
										>
										{#if selectedDrawingStroke}
											<div class="mt-2 border-t border-[var(--ui-border-muted)] pt-2">
												<div class="flex items-center justify-between gap-2">
													<span class="text-[10px] font-bold text-[var(--ui-text-muted)]"
														>Selected style</span
													>
													<input
														type="color"
														value={selectedDrawingStroke.color}
														onchange={(event) =>
															setSelectedDrawingColor(
																(event.currentTarget as HTMLInputElement).value
															)}
														aria-label="Selected drawing color"
														class="size-5 cursor-pointer rounded border-0 bg-transparent p-0"
													/>
												</div>
												<label
													class="mt-1 flex items-center gap-2 text-[10px] font-bold text-[var(--ui-text-muted)]"
													>Width <input
														type="range"
														min="0.3"
														max="6"
														step="0.1"
														value={selectedDrawingStroke.width * 100}
														onchange={(event) =>
															patchSelectedDrawingStyle({
																color: selectedDrawingStroke.color,
																width:
																	Number((event.currentTarget as HTMLInputElement).value) / 100,
																opacity: selectedDrawingStroke.opacity
															})}
														class="h-1 flex-1 accent-warm-500"
													/></label
												>
												<label
													class="mt-1 flex items-center gap-2 text-[10px] font-bold text-[var(--ui-text-muted)]"
													>Opacity <input
														type="range"
														min="10"
														max="100"
														step="5"
														value={selectedDrawingStroke.opacity * 100}
														onchange={(event) =>
															patchSelectedDrawingStyle({
																color: selectedDrawingStroke.color,
																width: selectedDrawingStroke.width,
																opacity:
																	Number((event.currentTarget as HTMLInputElement).value) / 100
															})}
														class="h-1 flex-1 accent-warm-500"
													/></label
												>
											</div>
										{/if}
										<div class="mt-2 flex flex-wrap items-center gap-1">
											<span class="mr-1 text-[10px] font-bold text-[var(--ui-text-muted)]"
												>Playback</span
											>
											{#each ['static', 'replay', 'hold'] as playback}
												<button
													type="button"
													onclick={() => setDrawingPlayback(playback as DrawingGroup['playback'])}
													aria-pressed={selectedDrawingGroup?.playback === playback}
													class="rounded-full px-2 py-1 text-[10px] font-bold {selectedDrawingGroup?.playback ===
													playback
														? 'bg-warm-500/15 text-warm-600'
														: 'text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)]'}"
													>{playback}</button
												>
											{/each}
										</div>
										<div class="mt-2 grid grid-cols-[1fr_1fr_auto] items-end gap-1.5">
											<label class="min-w-0 text-[10px] font-bold text-[var(--ui-text-muted)]"
												>Appear
												<input
													type="number"
													min="0"
													max={timelineDurationSec || undefined}
													step="0.1"
													value={((selectedDrawingGroup?.visibleFromMs ?? 0) / 1000).toFixed(1)}
													onchange={(event) =>
														setDrawingVisibleFrom(
															Number((event.currentTarget as HTMLInputElement).value)
														)}
													class="mt-0.5 w-full rounded bg-[var(--ui-bg)] px-1.5 py-1 text-[10px] text-[var(--ui-text)] outline-none"
												/>
											</label>
											<label class="min-w-0 text-[10px] font-bold text-[var(--ui-text-muted)]"
												>End
												<input
													type="number"
													min={selectedDrawingGroup ? selectedDrawingGroup.visibleFromMs / 1000 : 0}
													max={timelineDurationSec || undefined}
													step="0.1"
													placeholder="Always"
													value={selectedDrawingGroup?.visibleUntilMs === undefined
														? ''
														: (selectedDrawingGroup.visibleUntilMs / 1000).toFixed(1)}
													onchange={(event) => {
														const value = (event.currentTarget as HTMLInputElement).value;
														setDrawingVisibleUntil(value === '' ? null : Number(value));
													}}
													class="mt-0.5 w-full rounded bg-[var(--ui-bg)] px-1.5 py-1 text-[10px] text-[var(--ui-text)] outline-none"
												/>
											</label>
											<button
												type="button"
												onclick={placeDrawingAtPlayhead}
												title="Set drawing start to the current playhead"
												class="rounded-full px-2 py-1 text-[10px] font-bold text-warm-600 hover:bg-warm-500/10"
												>Use playhead</button
											>
										</div>
										<button
											type="button"
											disabled={!selectedDrawingGroup || !timelineActive}
											onclick={splitDrawingAtPlayhead}
											class="mt-1.5 rounded-full px-2 py-1 text-[10px] font-bold text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)] disabled:opacity-30"
											>Split at playhead</button
										>
									{/if}
									<div class="mt-2 flex items-center gap-1">
										<button
											type="button"
											disabled={!drawingUndo.length}
											onclick={undoDrawing}
											class="rounded-full px-2 py-1 text-[10px] font-bold text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)] disabled:opacity-30"
											>Undo</button
										><button
											type="button"
											disabled={!drawingRedo.length}
											onclick={redoDrawing}
											class="rounded-full px-2 py-1 text-[10px] font-bold text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-accented)] disabled:opacity-30"
											>Redo</button
										><button
											type="button"
											disabled={!drawingGroups.length}
											onclick={clearDrawings}
											class="rounded-full px-2 py-1 text-[10px] font-bold text-red-500 hover:bg-red-500/10 disabled:opacity-30"
											>Clear</button
										>
									</div>
								{/if}
							</div>
							<!-- Sticker picker (#3): stickers are stroke-free emoji overlays —
							     they ride the same schema/wire format as captions. Nostr picks
							     (kind-30030 custom emojis) are PICTURES → image layers. -->
							<MemeStickerPicker
								id={stickerMenuId}
								onAdd={addSticker}
								onPickCustom={(emoji) => {
									void addImageLayer({ url: emoji.url }, undefined, {
										atMs: timelineActive ? Math.round(stageSeconds * 1000) : undefined
									});
								}}
								onPickSvg={(icon) => {
									void addImageLayer({ url: icon.url, name: icon.name }, undefined, {
										atMs: timelineActive ? Math.round(stageSeconds * 1000) : undefined
									});
								}}
							/>

							<!-- Buddy picker (tp-bitcoin §16): the Bitz Buddy mascot pack as
							     bundled sticker layers — rides the image-layer pipeline. -->
							<MemeBuddyPicker
								id={buddyMenuId}
								{busy}
								layerCount={imageLayers.length}
								onAdd={(figure, _atMs) => {
									// Buddy figures drop in with their feel-good default motion
									// (breathe/pop/bounce…) — clearable in the inspector.
									void addImageLayer(
										{
											url: figure.src,
											motionId: figure.motion === 'none' ? undefined : figure.motion
										},
										1,
										{ atMs: timelineActive ? Math.round(stageSeconds * 1000) : undefined }
									);
								}}
							/>

							<!-- Add image layers (PNG/GIF/WebP/SVG): local file, https URL or
							     GIF library (sticker-sized layer — NOT the base-media swap).
							     Managing layers (select/z-order/timing/replace/remove/edit)
							     lives in the right-panel Image-layers card — one surface. -->
							<MemeImageLayerTools
								id={imageMenuId}
								layers={imageLayers}
								bind:showUrlForm={showLayerUrlForm}
								bind:url={layerUrl}
								{mediaKind}
								{timelineActive}
								{stageSeconds}
								loading={layerBusy}
								urlBusy={layerUrlBusy}
								onBrowse={() => {
									pendingLayerAtMs = timelineActive ? Math.round(stageSeconds * 1000) : null;
									layerInput?.click();
								}}
								onInsertFrame={() => void insertFrameLayer()}
								onAddUrl={() => void addLayerFromUrl()}
								onAddGif={(gif, atMs) => void addLayerFromGifLib(gif, atMs)}
							/>

							<!-- Frame-FX picker (Meme Pack V1 Layer 2): timed windows of
							     glitch/flash/shake/… burned into every export + remix wire. -->
							<MemeFxPicker
								id={fxMenuId}
								windows={fxWindows}
								stageSeconds={timelineActive ? stageSeconds : 0}
								{timelineActive}
								durationSec={timelineDurationSec}
								{busy}
								onAdd={addFxWindow}
								onRemove={removeFxWindow}
								onIntensity={patchFxIntensity}
							/>

							<!-- Speed-ramp picker (Meme Pack V1 Layer 2): timed
							     slow-mo/speed-up windows riding the preview clock. -->
							<MemeSpeedPicker
								id={speedMenuId}
								windows={speedWindows}
								stageSeconds={timelineActive ? stageSeconds : 0}
								{timelineActive}
								durationSec={timelineDurationSec}
								{busy}
								onAdd={addSpeedWindow}
								onRate={patchSpeedRate}
								onRemove={removeSpeedWindow}
							/>
						</div>
					{/snippet}

					{#snippet inspectorPane()}
						<MemeInspectorPanel
							{imageLayers}
							bind:selectedLayerId
							bind:layerTimingId
							layerBitmaps={layerAssets.bitmaps}
							layerRenderSrcs={layerAssets.renderSrcs}
							{layerBusy}
							onAddLayerImage={() => layerInput?.click()}
							onMoveLayer={moveLayerRow}
							onReplaceLayer={(id) => {
								replaceLayerForId = id;
								replaceLayerInput?.click();
							}}
							{busy}
							videoExportSupported={videoMemeSupported}
							{overlays}
							bind:selectedId
							bind:timingId
							bind:fxId
							{mediaKind}
							{timelineActive}
							{patchOverlay}
							{moveOverlay}
							{moveOverlayRow}
							{removeOverlay}
							onAddClassic={() => applyTemplate(TEMPLATES[0])}
							bind:caption
							softCaptionLimit={SOFT_CAP}
							hardCaptionLimit={HARD_CAP}
							{artboardId}
							artboardWidth={renderTarget.width}
							artboardHeight={renderTarget.height}
							customArtboardWidth={customArtboard.width}
							customArtboardHeight={customArtboard.height}
							staging={gifStageBusy}
							{blankBg}
							{mediaZoom}
							{mediaPanX}
							{mediaPanY}
							onArtboard={setArtboard}
							onCustomArtboard={setCustomArtboard}
							onBackground={(color) => void applyBackgroundColor(color)}
							onFraming={(patch) => {
								if (patch.zoom !== undefined) mediaZoom = patch.zoom;
								if (patch.panX !== undefined) mediaPanX = patch.panX;
								if (patch.panY !== undefined) mediaPanY = patch.panY;
							}}
							videoDuration={meta?.duration ?? null}
							bind:trimStart={trimStartSec}
							bind:trimEnd={trimEndSec}
							trimDurationSec={trimDuration}
							{exportDurationSec}
							bind:playbackRate
							{stageSeconds}
							canPreview={!!stageVideo}
							onSetLength={setTrimLength}
							onPreviewCut={() => {
								if (!stageVideo) return;
								stageVideo.currentTime = trimStartSec;
								stageVideo.playbackRate = playbackRate;
								void stageVideo.play();
							}}
							gifDuration={gif?.duration ?? null}
							cues={sfxCues}
							bind:pinnedLength={pinnedLengthSec}
							menuId={sfxMenuId}
							{animated}
							bind:includeSourceAudio
							analyzing={suggestBusy}
							suggestions={suggestionGroups}
							{smartMatches}
							onApplySmartMatch={applySmartMatch}
							onOpenSoundStudio={() => (soundDialogOpen = true)}
							onPreviewSynth={previewSfx}
							onAddSynth={addSfxCue}
							onAddCustom={addCustomCue}
							onRemoveLibrarySound={removeSoundFromLibrary}
							onImportAudio={() => soundFileInput?.click()}
							onSyncCaptions={syncCaptionsToCues}
							onBuildSuggestions={() => void buildSuggestions()}
							onApplySuggestion={applySuggestion}
							onSeek={scrubPreview}
							onRemoveCue={removeSfxCue}
							bind:destinations
							bind:publishDetailsOpen
							bind:sensitive
							bind:showPow
							bind:license
							bind:aiAssisted
							bind:splitsOpen
							bind:splitRows
							bind:selectedProvider
							bind:pow
							{phase}
							{powProgress}
							{writeRelayCount}
							kindNip={kindInfo?.nip}
							onCancelMining={() => mineController?.abort()}
							onPatchLayer={patchLayer}
							onRemoveLayer={removeLayer}
							onDuplicateLayer={duplicateLayer}
							onPublish={() => void submit()}
							{exportFormat}
							{videoMemeSupported}
							onFormat={(format) => (exportFormat = format)}
						/>
					{/snippet}

					<!-- Full-page pro layout (mass production): tool rail · big stage ·
						     inspector — panes scroll on their own; the timeline bar stays pinned.
						     Mobile stacks the panes in one scroll column. -->
					{#if remixSource}
						<div
							class="flex shrink-0 items-center gap-2 border-b border-warm-500/25 bg-warm-500/10 px-4 py-2 text-[12px] font-semibold text-warm-600"
						>
							<Icon name="i-lucide-repeat" class="size-3.5 shrink-0" />
							<span class="truncate"
								>Remix of “{remixLabel}” · captions &amp; sounds credited via remix tags</span
							>
						</div>
					{/if}
					<div class="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
						<!-- Tool rail (left): add things to the meme -->
						<aside
							class="order-2 shrink-0 scrollbar-thin px-3 pt-3 pb-1 sm:px-4 lg:order-1 lg:w-[248px] lg:overflow-y-auto lg:border-r lg:border-[var(--ui-border-muted)] lg:py-4 lg:pr-3.5 lg:pl-4"
							aria-label="Meme tools"
						>
							<p
								class="mb-3 hidden text-[10px] font-bold tracking-wider text-[var(--ui-text-dimmed)] uppercase lg:block"
							>
								Tools
							</p>
							{@render toolsPane()}
						</aside>
						<!-- Stage (center): the WYSIWYG mirror, as tall as the viewport allows.
							     A zoomed-in stage overflows the pane — scroll to pan. -->
						<section
							class="order-1 flex min-h-0 flex-1 scrollbar-thin flex-col items-center justify-center gap-2 overflow-y-auto p-3 sm:p-4 lg:order-2"
						>
							{@render stagePane()}
						</section>
						<!-- Inspector (right): selection, composition, sound, publish -->
						<aside
							class="order-3 shrink-0 scrollbar-thin px-3 pt-3 pb-1 sm:px-4 lg:w-[330px] lg:overflow-y-auto lg:border-l lg:border-[var(--ui-border-muted)] lg:py-4 lg:pr-4 lg:pl-3.5 xl:w-[368px]"
							aria-label="Meme inspector"
						>
							{@render inspectorPane()}
						</aside>
					</div>
					<MemeTimelineDock
						bind:collapsed={timelineCollapsed}
						active={timelineActive}
						showFrames={stripFrames}
						durationSec={meta?.duration ?? 0}
						thumbUrls={frameThumbs}
						playheadSec={scrubSec}
						{trimStartSec}
						{trimEndSec}
						posterSec={posterAtSec}
						posterUrl={posterDataUrl}
						{busy}
						onScrub={scrubTo}
						onPickPoster={(seconds) => void pickPosterAt(seconds)}
						timeline={timelinePane}
					/>
				{/if}
			</div>

			<!-- Footer -->
			{#if file}
				<MemeStudioFooter
					captionCount={overlays.length}
					kindLabel={kindInfo?.label ?? 'Meme'}
					{mediaKind}
					width={renderTarget.width}
					height={renderTarget.height}
					mediaLoaded={!!file}
					{busy}
					{canPost}
					{progressLabel}
					{destinations}
					{exportFormat}
					{outputFormatLabel}
					videoExportSupported={canRenderVideoMeme()}
					onFormat={(format) => (exportFormat = format)}
					onCancel={requestClose}
					onExport={() => void exportFile()}
					onPublish={() => (publishDetailsOpen = true)}
				/>
			{/if}
		</div>

		<!-- Discard confirmation -->
		{#if confirmDiscard}
			<MemeDiscardDialog
				intent={discardIntent}
				onKeep={keepEditing}
				onDiscard={discard}
				onSave={() => {
					void saveCurrentSlot().then(startFresh);
				}}
			/>
		{/if}
	</div>
{/if}

<MemeStudioInputs
	bind:fileInput
	bind:otherSourceInput
	bind:layerInput
	bind:queueInput
	bind:soundInput={soundFileInput}
	bind:replaceInput={replaceLayerInput}
	{pickFormat}
	onFile={onFileInput}
	onOtherSource={onOtherSourceInput}
	onLayer={onLayerFileInput}
	onReplace={onReplaceLayerInput}
	onQueue={onQueueInput}
	onSound={(sound) => void soundIO.importFile(sound)}
/>
<MemeSoundDialog
	bind:open={soundDialogOpen}
	bind:cues={sfxCues}
	labels={sfxLabels}
	durations={sfxDurations}
	libraryLabel={(soundId) => soundLibrary.list.find((s) => s.id === soundId)?.label}
	libraryDuration={(soundId) => soundLibrary.list.find((s) => s.id === soundId)?.durationSec}
	librarySounds={soundLibrary.list.map((sound) => ({
		id: sound.id,
		label: sound.label,
		durationSec: sound.durationSec
	}))}
	sharedSounds={sharedSounds.map((s) => ({
		id: s.eventId,
		label: s.label,
		durationSec: s.durationSec,
		soundId: soundLibrary.list.find((l) => l.label === s.label)?.id
	}))}
	{stageSeconds}
	durationSec={mediaKind === 'video' ? (meta?.duration ?? 0) : (gif?.duration ?? 0)}
	{busy}
	onPreviewSynth={(sfx) => previewSfx(sfx)}
	onPreviewLibrary={(soundId) => previewSoundById(soundId)}
	onStopPreview={() => soundIO.stopPreview()}
	onAddSynth={(sfx) => addSfxCue(sfx)}
	onAddLibrary={(soundId) => addCustomCueById(soundId)}
	onRemoveLibrary={removeSoundFromLibrary}
	onImportAudio={() => soundFileInput?.click()}
	onToggleMic={(name) => void soundIO.toggleMic(name)}
	onPauseResumeMic={() => soundIO.pauseResumeMic()}
	recording={soundIO.recording}
	recordingPaused={soundIO.recordingPaused}
	micDenied={soundIO.micDenied}
	recordingElapsedSec={soundIO.recordingElapsedSec}
>
	{#snippet waveform()}
		{#if lastAnalysis && analysisWindows.length}
			<CueWaveform
				durationSec={mediaKind === 'video' ? (meta?.duration ?? 0) : (gif?.duration ?? 0)}
				windows={analysisWindows}
				silence={lastAnalysis.silence}
				peaks={lastAnalysis.peaks}
				speech={lastAnalysis.speechSegments}
			/>
		{/if}
	{/snippet}
</MemeSoundDialog>
