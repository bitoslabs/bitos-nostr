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
	}
</script>

<script lang="ts">
	import { SvelteMap } from 'svelte/reactivity';
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import MenuItem from '$lib/components/ui/MenuItem.svelte';
	import MenuDivider from '$lib/components/ui/MenuDivider.svelte';
	import PowCard from '$lib/components/ui/PowCard.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { relays } from '$lib/nostr/relays.svelte';
	import { feed, type PowProgress } from '$lib/nostr/feed.svelte';
	import { stories } from '$lib/nostr/stories.svelte';
	import { media, MEDIA_PROVIDERS, providerLabel } from '$lib/stores/media.svelte';
	import type { MediaProviderId, UploadedMedia } from '$lib/media/uploaders';
	import { humanBytes } from '$lib/media/uploaders';
	import { powPrefs } from '$lib/stores/pow-prefs.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { memeTemplates } from '$lib/stores/meme-templates.svelte';
	import { aiAssistedTag } from '$lib/meme/ai-provenance';
	import { analyzeClip, windowRms } from '$lib/ai/extract';
	import { suggestTimelines, type MemeSuggestion } from '$lib/ai/suggest';
	import {
		createMemeDraftWriter,
		draftMediaFile,
		draftOverlays,
		mediaToDraftDataUrl,
		readMemeDraft
	} from '$lib/stores/meme-drafts';
	import { formatDuration } from '$lib/utils/format';
	import {
		MAX_OVERLAY_CHARS,
		MAX_OVERLAYS,
		MEME_COLORS,
		MEME_FONTS,
		overlayVisibleAt,
		makeOverlay,
		makeClassicPair,
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
		type AnimatedLayerPainter
	} from '$lib/meme/render';
	import {
		imageOverlayVisibleAt,
		makeImageOverlay,
		MAX_IMAGE_OVERLAYS,
		MAX_IMAGE_OVERLAY_BYTES,
		type MemeImageOverlay
	} from '$lib/meme/image-overlay';
	import {
		canDecodeGif,
		decodeGif,
		gifLayerPainter,
		paintGifFrameAt,
		type DecodedGif
	} from '$lib/meme/gif';
	import {
		CUSTOM_SOUND_KEY,
		MEME_SFX_IDS,
		type MemeSfxCue,
		type MemeSfxId,
		normalizeSfxCue
	} from '$lib/meme/schema';
	import { createSfxAudioTrack, SFX_RECIPES, monoNormalize } from '$lib/meme/sfx';
	import { cueTrackDurationSec, MAX_VIDEO_MEME_SECONDS } from '$lib/meme/cue-track';
	import { buildCueMixBuffer } from '$lib/meme/cue-mix';
	import MemeSoundDialog from '$lib/components/bitz/MemeSoundDialog.svelte';
	import MemeLayerEditor from '$lib/components/bitz/MemeLayerEditor.svelte';
	import MemeLookPicker from '$lib/components/bitz/MemeLookPicker.svelte';
	import MemeStickerPicker from '$lib/components/bitz/MemeStickerPicker.svelte';
	import MemeSourceLibrary from '$lib/components/bitz/MemeSourceLibrary.svelte';
	import { mediaLibrary } from '$lib/stores/media-library.svelte';
	import { encodeAnimatedGif, type GifEncodeFrame } from '$lib/meme/gif-encode';
	import CueWaveform from '$lib/components/bitz/CueWaveform.svelte';
	import VideoFrameStrip from '$lib/components/bitz/VideoFrameStrip.svelte';
	import {
		MAX_SOUND_SECONDS,
		soundLibrary,
		type LibrarySound
	} from '$lib/stores/meme-sounds.svelte';
	import { memeSlots, MAX_SLOT_BYTES } from '$lib/stores/meme-slots.svelte';
	import {
		applyRemixPayload,
		remixTagsFor,
		rightsTagsFor,
		type RemixLicense,
		type RemixSource
	} from '$lib/meme/remix';
	import {
		SPLIT_ROLES,
		TOTAL_BASIS_POINTS,
		splitsTagsFor,
		validateSplits,
		type SplitRole,
		type SplitRow
	} from '$lib/meme/splits';
	import { makeSticker } from '$lib/meme/stickers';
	import { fxTransformAt, MEME_FX_OPTIONS } from '$lib/meme/fx';
	import MemeTimeline from '$lib/components/bitz/MemeTimeline.svelte';
	import { syncOverlaysToCues } from '$lib/meme/caption-sync';
	import GifPicker, { type GifChoice } from '$lib/components/feed/GifPicker.svelte';
	import { popovers } from '$lib/stores/popovers.svelte';
	import { canvasFiltersSupported, memeLookCss, memeLookOf, type MemeLookId } from '$lib/meme/look';
	import {
		parseSharedSound,
		rankSharedSounds,
		sharedSoundEventParts,
		verifySharedSoundSha256,
		type SharedSound
	} from '$lib/meme/shared-sounds';
	import { clientTag } from '$lib/nostr/client-tag';
	import { queryOnce, publish } from '$lib/nostr/pool';
	import { signMined } from '$lib/auth/signer';

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
		/** Page variant (/studio/create?tab=meme): a full-bleed editing surface
		 * instead of a floating dialog — no backdrop, no own close chrome, the
		 * route owns navigation (tabs, ESC → back to the studio home). */
		full = false
	}: {
		open?: boolean;
		onposted?: (eventId: string) => void;
		remixHandoff?: RemixHandoff | null;
		templateHandoff?: { id: string; overlays: MemeTextOverlay[] } | null;
		slotHandoff?: string | null;
		full?: boolean;
	} = $props();

	type Phase = 'idle' | 'rendering' | 'uploading' | 'mining' | 'publishing';
	type Destination = 'bitz' | 'story' | 'note';

	interface Template {
		id: string;
		label: string;
		hint: string;
		icon: string;
		overlays: () => MemeTextOverlay[];
	}

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
	// --- AI-002 suggestion ladder (Mild/Funny/Chaos) -------------------------
	let suggestMenuId = `meme-suggest-${Math.random().toString(36).slice(2, 8)}`;
	let suggestBusy = $state(false);
	let suggestionGroups = $state<MemeSuggestion[]>([]);
	/** Last local analysis — feeds the cue-sheet waveform (AI-001 anchors). */
	let lastAnalysis = $state<Awaited<ReturnType<typeof analyzeClip>> | null>(null);
	let analysisWindows = $state<Float32Array>(new Float32Array(0));
	/** Grab the stage media's audio as mono PCM for analysis (no cloud, no
	 *  detectors — the DSP always runs local per AI-003's boundary). */
	async function stageMonoPcm(): Promise<{ pcm: Float32Array; sampleRate: number } | null> {
		if (!file) return null;
		const AudioCtx = window.AudioContext;
		if (!AudioCtx || !(file.type.startsWith('video/') || file.type.startsWith('audio/'))) {
			if (file.type.startsWith('audio/')) return null;
			return null;
		}
		try {
			const ctx = new AudioCtx();
			const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
			return monoNormalize(decoded);
		} catch {
			return null;
		}
	}
	/** Image/GIF memes ship the cue sheet as their audio — render that exact
	 *  mix (the same one the export attaches) and decode it to mono PCM so
	 *  analysis reflects what viewers will actually hear (AI-002 rec #3). */
	async function cueTrackMonoPcm(): Promise<{ pcm: Float32Array; sampleRate: number } | null> {
		if (!sfxCues.length) return null;
		const OfflineCtx = window.OfflineAudioContext;
		const AudioCtx = window.AudioContext;
		if (!OfflineCtx || !AudioCtx) return null;
		try {
			// Reuse the export mix builder — identical recipe/custom-sound handling.
			const durationSec = cueTrackDurationSec(sfxCues);
			const mix = await buildCueMixBuffer(sfxCues, durationSec, {
				offlineCtor: OfflineCtx,
				decodeSound: async (id) => {
					const sound = soundLibrary.list.find((s) => s.id === id);
					return sound ? decodeSoundBlob(sound) : null;
				}
			});
			if (!mix) return null;
			return monoNormalize(mix);
		} catch {
			return null;
		}
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
			const analysis = await analyzeClip(span, mono.sampleRate);
			lastAnalysis = analysis;
			analysisWindows = windowRms(span, mono.sampleRate);
			suggestionGroups = suggestTimelines(analysis);
			toasts.info('3 timelines ready — pick a vibe, everything stays editable', 4000);
		} finally {
			suggestBusy = false;
		}
	}
	/** Apply one suggestion: overlays + cues replace the current timeline and
	 *  the AI-004 provenance flag flips on automatically (it WAS AI-assisted). */
	function applySuggestion(group: MemeSuggestion) {
		if (!group.overlays.length && !group.sfxCues.length) {
			toasts.info('That vibe found nothing to add for this clip');
			return;
		}
		overlays = group.overlays.map((o) => ({ ...o }));
		sfxCues = group.sfxCues.map((c) => ({ ...c }));
		selectedId = overlays[0]?.id ?? null;
		timingId = null;
		aiAssisted = true; // AI-004: the creator applied AI suggestions
		popovers.close();
		toasts.success(
			`“${group.intensity}” applied — ${group.overlays.length} captions · ${group.sfxCues.length} cues`
		);
	}
	/** Synth recipe durations for the dialog's catalog rows. */
	const sfxDurations: Record<MemeSfxId, number> = Object.fromEntries(
		MEME_SFX_IDS.map((id) => [id, SFX_RECIPES[id].duration])
	) as Record<MemeSfxId, number>;
	/** Timeline sound blocks: label + play length per cue (synth recipes have
	 *  fixed lengths; custom sounds carry theirs in the library). */
	function cueMeta(cue: MemeSfxCue): { label: string; durationSec: number } | null {
		if (cue.sfx === CUSTOM_SOUND_KEY) {
			const sound = soundLibrary.list.find((s) => s.id === cue.soundId);
			return sound ? { label: sound.label, durationSec: sound.durationSec } : null;
		}
		return { label: sfxLabels[cue.sfx], durationSec: sfxDurations[cue.sfx] ?? 0.5 };
	}
	const sfxLabels: Record<MemeSfxId, string> = {
		boom: 'Boom',
		bruh: 'Bruh',
		laugh: 'Laugh',
		whoosh: 'Whoosh',
		pop: 'Pop',
		boing: 'Boing',
		drumroll: 'Drumroll',
		ding: 'Ding',
		'sad-trombone': 'Sad trombone'
	};

	// ---- custom sound library (device / mic one-shots) -----------------------
	let recording = $state(false);
	let micDenied = $state(false);
	let micRecorder: MediaRecorder | null = null;
	let micStream: MediaStream | null = null;
	let micStart = 0;
	let soundFileInput = $state<HTMLInputElement | null>(null);
	const micSupported = $derived(
		typeof navigator !== 'undefined' &&
			!!navigator.mediaDevices?.getUserMedia &&
			typeof MediaRecorder !== 'undefined'
	);

	function cueLabel(cue: MemeSfxCue): string {
		if (cue.sfx !== CUSTOM_SOUND_KEY) return sfxLabels[cue.sfx];
		const sound = soundLibrary.list.find((s) => s.id === cue.soundId);
		return sound ? `${sound.label} · custom` : 'Custom';
	}

	function cueIcon(cue: MemeSfxCue): string {
		return cue.sfx === CUSTOM_SOUND_KEY ? 'i-lucide-mic' : 'i-lucide-music-2';
	}

	/** Decode a library sound to normalized mono PCM (preview + export mix). */
	async function decodeSoundBlob(
		sound: LibrarySound
	): Promise<{ pcm: Float32Array; sampleRate: number } | null> {
		const blob = await soundLibrary.getBlob(sound.id);
		if (!blob) return null;
		const AudioCtx = window.AudioContext;
		if (!AudioCtx) return null;
		const ctx = new AudioCtx();
		try {
			const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
			return monoNormalize(decoded);
		} catch {
			return null;
		} finally {
			void ctx.close().catch(() => undefined);
		}
	}

	/** Audition a library sound immediately. */
	async function previewSound(sound: LibrarySound) {
		const decoded = await decodeSoundBlob(sound);
		if (!decoded) {
			toasts.error("That sound can't be played in this browser");
			return;
		}
		const AudioCtx = window.AudioContext;
		if (!AudioCtx) return;
		const ctx = new AudioCtx();
		// copyToChannel needs a Float32Array backed by a plain ArrayBuffer.
		const pcm = new Float32Array(decoded.pcm.length);
		pcm.set(decoded.pcm);
		const buffer = ctx.createBuffer(1, pcm.length, decoded.sampleRate);
		buffer.copyToChannel(pcm, 0);
		const source = ctx.createBufferSource();
		source.buffer = buffer;
		source.connect(ctx.destination);
		source.start();
		source.onended = () => void ctx.close().catch(() => undefined);
	}

	/** Measure a candidate audio blob by decoding it. */
	async function soundDurationSec(blob: Blob): Promise<number> {
		const AudioCtx = window.AudioContext;
		if (!AudioCtx) return 0;
		const ctx = new AudioCtx();
		try {
			const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
			return decoded.duration;
		} catch {
			return 0;
		} finally {
			void ctx.close().catch(() => undefined);
		}
	}

	async function importSoundBlob(
		blob: Blob,
		durationSec: number,
		source: 'device' | 'mic',
		label?: string
	) {
		if (!(durationSec > 0)) {
			toasts.error('Could not read that audio — try WAV/MP3/M4A/OGG/WebM');
			return;
		}
		if (durationSec > MAX_SOUND_SECONDS) {
			toasts.error(`Sounds top out at ${MAX_SOUND_SECONDS}s — trim it first`);
			return;
		}
		try {
			const saved = await soundLibrary.add({
				label,
				source,
				blob,
				durationSec,
				mime: blob.type
			});
			toasts.success(`Added “${saved.label}” to your sounds`);
		} catch (e) {
			toasts.error((e as Error).message);
		}
	}

	function onSoundFileInput(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		void importSoundFile(input.files?.[0] ?? null);
		input.value = '';
	}

	// ---- shared sounds (NIP-78 §17.1 + §17.2 ingestion rules) ------------------
	let sharedMenuId = `meme-shared-${Math.random().toString(36).slice(2, 8)}`;
	let sharedSounds = $state<SharedSound[]>([]);
	let sharedLoading = $state(false);
	let sharedImportingId = $state('');
	let sharingSoundId = $state('');
	let sharedFetchedAt = 0;
	/** GIF URL sourcing: paste a direct image/gif link next to the picker. */
	let gifUrl = $state('');
	let gifUrlBusy = $state(false);

	async function sha256Hex(bytes: Uint8Array): Promise<string> {
		const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
		return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
	}

	/** Publish a library sound as a kind-30078 shared-sound event (§17.1). */
	async function shareSound(sound: LibrarySound) {
		if (!me) {
			toasts.error('Sign in to share sounds');
			return;
		}
		if (sharingSoundId) return;
		sharingSoundId = sound.id;
		try {
			const blob = await soundLibrary.getBlob(sound.id);
			if (!blob) throw new Error('The sound file is missing from this device');
			// media.upload takes a named File (uploaders infer names from it)
			const soundFile = new File([blob], `sound-${sound.id}.webm`, {
				type: blob.type || 'audio/webm'
			});
			const uploaded = await media.upload(soundFile, undefined, {
				pubkey: me.pk,
				purpose: 'note'
			});
			const sha = await sha256Hex(new Uint8Array(await blob.arrayBuffer()));
			const parts = sharedSoundEventParts({
				soundId: sound.id,
				label: sound.label,
				durationSec: sound.durationSec,
				mime: blob.type || sound.mime,
				url: uploaded.url,
				sha256: sha,
				license: 'CC0-1.0',
				clientTag: clientTag()
			});
			const event = await signMined({
				kind: 30078,
				content: parts.content,
				created_at: Math.floor(Date.now() / 1000),
				tags: parts.tags
			});
			await publish(event);
			toasts.success(`Shared “${sound.label}” — other bitz creators can remix it`);
		} catch (e) {
			toasts.error(e instanceof Error ? e.message : 'Could not share that sound');
		} finally {
			sharingSoundId = '';
		}
	}

	/** Query relays for shared-sound events (throttled to one fetch/minute). */
	async function loadSharedSounds() {
		if (sharedLoading) return;
		if (Date.now() - sharedFetchedAt < 60_000 && sharedSounds.length) return;
		sharedLoading = true;
		try {
			const events = await queryOnce([{ kinds: [30078], limit: 200 }]);
			const mine = me?.pk ?? '';
			sharedSounds = rankSharedSounds(
				events.map((e) => parseSharedSound(e)).filter((s): s is SharedSound => s !== null),
				mine
			);
			sharedFetchedAt = Date.now();
			if (!sharedSounds.length) toasts.info('No shared sounds on your relays yet — be the first');
		} catch {
			toasts.error('Could not reach relays for shared sounds');
		} finally {
			sharedLoading = false;
		}
	}

	/** §17.2 ingestion: fetch → verify hash → import into the local library. */
	async function importSharedSound(sound: SharedSound) {
		if (sharedImportingId) return;
		if (!sound.sha256) {
			toasts.error('That sound has no content hash — refusing to import it');
			return;
		}
		sharedImportingId = sound.eventId;
		try {
			const res = await fetch(sound.url);
			if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
			const bytes = new Uint8Array(await res.arrayBuffer());
			if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('Over 8 MB — too big to import');
			const ok = await verifySharedSoundSha256(bytes, sound.sha256, sha256Hex);
			if (!ok) throw new Error('Hash mismatch — the file changed since it was shared');
			const blob = new Blob([bytes as unknown as ArrayBuffer], { type: sound.mime });
			await importSoundBlob(blob, sound.durationSec, 'device', sound.label);
		} catch (e) {
			toasts.error(e instanceof Error ? e.message : 'Could not import that sound');
		} finally {
			sharedImportingId = '';
		}
	}

	/** GIF sourcing: pull a direct image/gif URL into the stage (remix-handoff pattern). */
	async function importGifFromUrl() {
		const url = gifUrl.trim();
		if (!url || gifUrlBusy) return;
		gifUrlBusy = true;
		try {
			const res = await fetch(url);
			if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
			const type = res.headers.get('content-type') ?? '';
			if (!type.startsWith('image/')) throw new Error('That link is not an image');
			const blob = await res.blob();
			if (blob.size > 50 * 1024 * 1024) throw new Error('Over 50 MB — too big');
			const mime = type.split(';')[0]!;
			const name = `gif-${Date.now()}.${mime === 'image/gif' ? 'gif' : (mime.split('/')[1] ?? 'img')}`;
			await acceptFile(new File([blob], name, { type: mime }), {
				keepRemix: true,
				keepLayout: keepLayoutOnSwap
			});
			showSwapUrlForm = false;
		} catch (e) {
			toasts.error(e instanceof Error ? e.message : 'Could not load that image URL');
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
	/** Batch queue items: either a remote GIF URL or a local File (videos and
	 *  pictures multi-picked for mass production — each publish loads the next). */
	interface QueueItem {
		id: number;
		url: string;
		label: string;
		caption?: string;
		file?: File;
	}
	let queue = $state<QueueItem[]>([]);
	let queueIndex = $state(0);
	let queueSeq = 0;
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
			queue = [...queue, ...rest.map((f) => ({ id: ++queueSeq, url: '', label: f.name, file: f }))];
			if (rest.length) toasts.info(`${rest.length} more queued — each post loads the next`);
			if (first) void acceptFile(first, { keepRemix: true });
			return;
		}
		queue = [...queue, ...picked.map((f) => ({ id: ++queueSeq, url: '', label: f.name, file: f }))];
		toasts.info(`${picked.length} queued — each post loads the next`);
	}

	/** Fetch a GIF URL into the stage File (shared by single pick, multi-pick and queue advance). */
	async function loadGifFromUrl(url: string, label = 'GIF', keepLayout = false): Promise<boolean> {
		if (gifStageBusy) return false;
		gifStageBusy = true;
		try {
			const res = await fetch(url);
			if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
			const blob = await res.blob();
			if (blob.size > MAX_MEDIA_BYTES) throw new Error('That GIF is over the 200 MB cap');
			await acceptFile(new File([blob], `gif-${Date.now()}.gif`, { type: 'image/gif' }), {
				keepRemix: true,
				keepLayout
			});
			mediaLibrary.remember(url, label, blob.type || 'image/gif');
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
			const res = await fetchMediaResponse(url);
			if (!res) throw new Error('Could not fetch that source (CORS-blocked host)');
			const type = (res.headers.get('content-type') ?? '').split(';')[0]!;
			if (!type.startsWith('image/') && !type.startsWith('video/')) {
				throw new Error('That link is not a picture or video');
			}
			const blob = await res.blob();
			if (blob.size > MAX_MEDIA_BYTES) throw new Error('Over the 200 MB cap');
			const ext = (type.split('/')[1] ?? 'bin').replace('quicktime', 'mov');
			const name = `${(label || 'source').replace(/[^\w.-]+/g, '-')}-${Date.now()}.${ext}`;
			await acceptFile(new File([blob], name, { type: type || 'application/octet-stream' }), {
				keepRemix: true,
				keepLayout: keepLayoutOnSwap
			});
			mediaLibrary.remember(url, label, type);
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
		queue = [
			...queue,
			...rest.map((g) => ({ id: ++queueSeq, url: g.url, label: g.title ?? 'GIF' }))
		];
		queueIndex = queue.length - rest.length;
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
		const next = queue[queueIndex];
		if (!next) return false;
		queueIndex += 1;
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

	async function importSoundFile(next: File | null) {
		if (!next) return;
		if (next.size > 8 * 1024 * 1024) {
			toasts.error('That sound file is over 8 MB — trim it first');
			return;
		}
		const durationSec = await soundDurationSec(next);
		await importSoundBlob(
			next,
			durationSec,
			'device',
			next.name.replace(/\.[^.]+$/, '').slice(0, 40)
		);
	}

	async function toggleMicRecording() {
		if (recording) {
			stopMicRecording();
			return;
		}
		if (!micSupported) {
			toasts.error('Mic recording needs a Chromium browser');
			return;
		}
		try {
			micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch {
			micDenied = true;
			toasts.error('Microphone access was blocked');
			return;
		}
		const pick = (): string => {
			for (const type of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
				if (MediaRecorder.isTypeSupported(type)) return type;
			}
			return '';
		};
		const mimeType = pick();
		micRecorder = mimeType
			? new MediaRecorder(micStream, { mimeType })
			: new MediaRecorder(micStream);
		const chunks: Blob[] = [];
		micRecorder.ondataavailable = (e) => {
			if (e.data.size) chunks.push(e.data);
		};
		micRecorder.onstop = () => {
			const blob = new Blob(chunks, { type: micRecorder?.mimeType || 'audio/webm' });
			micStream?.getTracks().forEach((t) => t.stop());
			micStream = null;
			const elapsed = (performance.now() - micStart) / 1000;
			if (!blob.size) {
				toasts.warning('Nothing was recorded — try again');
				return;
			}
			void importSoundBlob(blob, elapsed, 'mic', 'Mic ' + new Date().toLocaleTimeString());
		};
		micStart = performance.now();
		recording = true;
		micRecorder.start(250);
	}

	function stopMicRecording() {
		if (micRecorder && micRecorder.state !== 'inactive') micRecorder.stop();
		recording = false;
	}

	function addCustomCue(sound: LibrarySound) {
		if (sfxCues.length >= 16) {
			toasts.error('Sound cues cap out at 16');
			return;
		}
		const cue = normalizeSfxCue({
			sfx: CUSTOM_SOUND_KEY,
			soundId: sound.id,
			atMs: Math.round(stageSeconds * 1000),
			gain: 1
		});
		if (cue) sfxCues = [...sfxCues, cue];
	}

	function removeSoundFromLibrary(id: string) {
		void soundLibrary.remove(id).then(() => {
			sfxCues = soundLibrary.pruneOrphanCues(sfxCues);
		});
	}

	// ---- overlays ------------------------------------------------------------
	let overlays = $state<MemeTextOverlay[]>([]);
	let selectedId = $state<string | null>(null);
	let providerMenuId = `meme-provider-${Math.random().toString(36).slice(2, 8)}`;
	/** Playhead for timed video overlays on the WYSIWYG stage. */
	let stageSeconds = $state(0);

	// ---- stage zoom (canvas size) --------------------------------------------
	/** View zoom for the WYSIWYG stage — 1 = fit (old behavior). Bigger steps
	 *  grow the canvas for detail work; overlay coords are normalized to the
	 *  stage box so zoom never disturbs them. Persisted per device. */
	const STAGE_ZOOM_KEY = 'bitos:meme-stage-zoom';
	const STAGE_ZOOM_STEPS = [0.6, 0.8, 1, 1.25, 1.5];
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
	const ARTBOARD_KEY = 'bitos:meme-artboard';
	type ArtboardId = 'source' | '9:16' | '16:9' | '1:1' | '4:5';
	const ARTBOARDS: { id: ArtboardId; label: string; hint: string; w: number; h: number }[] = [
		{ id: 'source', label: 'Source', hint: "Keep the media's own frame", w: 0, h: 0 },
		{ id: '9:16', label: '9:16', hint: 'Mobile full-screen · stories / reels', w: 1080, h: 1920 },
		{ id: '16:9', label: '16:9', hint: 'Landscape · YouTube', w: 1920, h: 1080 },
		{ id: '1:1', label: '1:1', hint: 'Square feed post', w: 1080, h: 1080 },
		{ id: '4:5', label: '4:5', hint: 'Portrait feed post', w: 1080, h: 1350 }
	];
	let artboardId = $state<ArtboardId>('source');

	function setArtboard(next: ArtboardId) {
		artboardId = next;
		try {
			localStorage.setItem(ARTBOARD_KEY, next);
		} catch {
			/* private mode — the choice just won't persist */
		}
	}

	/** The media's natural frame (whatever is loaded), for `source`. */
	const sourceFrame = $derived.by(() => {
		if (mediaKind === 'video' && meta?.width && meta?.height) {
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
		const ab = ARTBOARDS.find((a) => a.id === artboardId);
		if (ab && ab.w > 0) return { width: ab.w, height: ab.h };
		if (sourceFrame) return targetSize(sourceFrame);
		return { width: 1080, height: 1920 };
	});

	/** Stage aspect-ratio CSS — the preview mirrors the export canvas exactly. */
	const stageAspect = $derived.by(() => {
		if (artboardId === 'source' && sourceFrame) {
			return `${sourceFrame.width} / ${sourceFrame.height}`;
		}
		const ab = ARTBOARDS.find((a) => a.id === artboardId) ?? ARTBOARDS[0]!;
		return ab.w > 0 ? `${ab.w} / ${ab.h}` : '9 / 16';
	});

	/** Same ratio as a number (w/h) — feeds the full-page stage width calc. */
	const stageRatio = $derived.by(() => {
		if (artboardId === 'source' && sourceFrame && sourceFrame.height > 0) {
			return sourceFrame.width / sourceFrame.height;
		}
		const ab = ARTBOARDS.find((a) => a.id === artboardId) ?? ARTBOARDS[0]!;
		return ab.w > 0 ? ab.w / ab.h : 9 / 16;
	});

	// ---- preview transport + timeline ---------------------------------------
	/** Preview play state for the stage clock (video element clocks itself). */
	let previewPlaying = $state(false);
	// ---- preview sound: source audio + live cue firing -----------------------
	/** Sound toggle for the preview: unmutes the stage video AND fires every
	 *  cue the playhead crosses — the timeline sounds like the export. */
	let previewSoundOn = $state(false);
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
		if (stageVideo) stageVideo.muted = !previewSoundOn;
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

	/** Total timeline length the playhead scrubs over, per media kind:
	 *  video → trimmed export window; gif → gif duration; static → cue track. */
	const timelineDurationSec = $derived(
		mediaKind === 'video'
			? (meta?.duration ?? 0)
			: mediaKind === 'image'
				? (gif?.duration ?? (sfxCues.length ? cueTrackDurationSec(sfxCues) : 0))
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
			if (video.paused) void video.play();
			else video.pause();
			previewPlaying = video.paused; // reflect the element's state
			return;
		}
		previewPlaying = !previewPlaying;
	}

	/** Scrub the stage clock: video seeks the element; gif/static set the
	 *  playhead the paint loop / overlay visibility derives from. */
	function scrubPreview(sec: number) {
		const clamped = Math.max(0, Math.min(sec, timelineDurationSec || 0));
		if (mediaKind === 'video' && stageVideo) {
			stageVideo.currentTime = clamped;
			stageSeconds = clamped;
		} else {
			previewSeconds = clamped;
			stageSeconds = clamped;
		}
	}

	/** Scrubbed playhead for gif/static previews (the paint loop chases it). */
	let previewSeconds = $state(0);

	// ---- animated image layers ----------------------------------------------
	/** Decoded animated GIFs per layer src — layers painted via gifLayerPainter
	 *  stay animated in previews AND exports (a bare drawImage freezes frame 1;
	 *  this is the fix for "GIF lost its animation when published"). */
	const layerGifs = new SvelteMap<string, DecodedGif>();

	/** Decode (best-effort) a layer src as animated; resolves false when the
	 *  src is static or the browser can't decode frame-by-frame. Bytes we
	 *  already hold decode synchronously-started and CORS-free — only pure-URL
	 *  layers (draft restore) fall back to a network fetch. */
	/** Last GIF decode failure reason — surfaces in the export warning so the
	 *  failure is diagnosable instead of a silent frame-1 freeze. */
	let lastGifDecodeError = '';

	async function cacheLayerGif(src: string): Promise<boolean> {
		if (layerGifs.has(src)) return true;
		if (!canDecodeGif()) return false;
		try {
			const blob = layerBlobs.get(src) ?? (await fetchLayerBlob(src));
			if (!blob) {
				lastGifDecodeError = 'no bytes';
				return false;
			}
			const decoded = await decodeGif(await blob.arrayBuffer());
			layerGifs.set(src, decoded);
			return true;
		} catch (e) {
			lastGifDecodeError = e instanceof Error ? e.message : String(e);
			return false; // static layer — the bitmap path already covers it
		}
	}

	/** Does this src look like an animated GIF layer? (content type when we
	 *  hold the bytes; else the URL extension). */
	function looksAnimatedGif(src: string): boolean {
		const type = layerBlobs.get(src)?.type;
		if (type) return type === 'image/gif';
		return /\.gif(\?|$)/i.test(src);
	}

	/** Export-time painters: one scratch canvas per animated layer src, CACHED
	 *  for the run — paintImageOverlays asks every recorded frame and a fresh
	 *  painter per frame would churn (and leak) a canvas 30×/second. */
	const layerPainters = new SvelteMap<
		string,
		{ key: string; handle: ReturnType<typeof gifLayerPainter> }
	>();

	function animatedLayerResolver(
		src: string,
		box: { w: number; h: number }
	): AnimatedLayerPainter | null {
		const decoded = layerGifs.get(src);
		if (!decoded) return null;
		const sizeKey = `${Math.round(box.w)}x${Math.round(box.h)}`;
		const cached = layerPainters.get(src);
		let handle = cached && cached.key === sizeKey ? cached.handle : undefined;
		if (!handle) {
			cached?.handle.close();
			handle = gifLayerPainter(decoded, box);
			layerPainters.set(src, { key: sizeKey, handle });
		}
		const painter = handle;
		return (ctx, x, y, timeSec) => painter.paint(ctx, x, y, timeSec);
	}

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

	/** Set the export window's LENGTH (user request: “set time 5s, 10s, 30s…”):
	 *  keeps the current start mark, caps at the source's remaining time and
	 *  the 90s video-meme limit — and says so when a preset doesn't fit. */
	function setTrimLength(sec: number): void {
		const dur = meta?.duration ?? 0;
		if (!Number.isFinite(sec) || sec <= 0 || !dur) return;
		const avail = Math.max(0, dur - trimStartSec);
		const capped = Math.min(sec, avail, MAX_VIDEO_MEME_SECONDS);
		trimEndSec = trimStartSec + capped;
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
	let destination = $state<Destination>('bitz');
	let fileInput = $state<HTMLInputElement | null>(null);
	let confirmDiscard = $state(false);
	let dragOver = $state(false);
	// ---- format-first start (user request: “select type meme”) --------------------
	/** Which meme format the creator picked — filters the media chooser so the
	 *  file dialog opens pre-scoped (image / GIF / video). `all` = unfiltered. */
	let pickFormat = $state<'all' | 'image' | 'gif' | 'video'>('all');
	const PICK_FORMATS: {
		id: 'image' | 'gif' | 'video';
		label: string;
		hint: string;
		icon: string;
		accept: string;
	}[] = [
		{
			id: 'image',
			label: 'Image meme',
			hint: 'JPG · PNG · WebP',
			icon: 'i-lucide-image',
			accept: 'image/png,image/jpeg,image/webp,image/*'
		},
		{
			id: 'gif',
			label: 'GIF meme',
			hint: 'animated, keeps motion',
			icon: 'i-lucide-film',
			accept: 'image/gif'
		},
		{
			id: 'video',
			label: 'Video meme',
			hint: 'MP4 · WebM · MOV',
			icon: 'i-lucide-video',
			accept: 'video/mp4,video/webm,video/quicktime,video/*'
		}
	];
	/** Pick media pre-scoped to a format: filters the chooser, then opens it. */
	async function pickMediaAs(format: 'image' | 'gif' | 'video') {
		pickFormat = format;
		await tick(); // let the accept attribute update before the dialog opens
		fileInput?.click();
	}
	/** Tracks which overlay's timing row is expanded. */
	let timingId = $state<string | null>(null);
	/** Open motion-fx popover for this caption (video memes). */
	let fxId = $state<string | null>(null);
	/** Saved-template popover id + inline save-name input. */
	let templateMenuId = `meme-templates-${Math.random().toString(36).slice(2, 8)}`;
	let showTemplateSave = $state(false);
	let templateName = $state('');
	/** Draft-slot popover: named WIP snapshots (save now, resume later). */
	let slotsMenuId = `meme-slots-${Math.random().toString(36).slice(2, 8)}`;
	let showSlotSave = $state(false);
	let slotName = $state('');
	let slotBusyId = $state('');
	let destMenuId = `meme-dest-${Math.random().toString(36).slice(2, 8)}`;

	// ---- sticker picker (#3) --------------------------------------------------
	// (UI lives in MemeStickerPicker.svelte — this is the state it drives.)
	let stickerMenuId = `meme-stickers-${Math.random().toString(36).slice(2, 8)}`;
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
	let layerSeq = 0;
	/** Cached decoded bitmaps per src — the export reads these, no refetch. */
	const layerBitmaps = new SvelteMap<string, HTMLImageElement>();
	/** Same-origin render source per layer src (object URL over bytes we
	 *  already hold). Rendering and exporting from blobs sidesteps CDN/provider
	 *  CORS entirely — no tainted-canvas SecurityError, no layer silently
	 *  missing from the export when a host withholds CORS headers. */
	const layerRenderSrcs = new SvelteMap<string, string>();
	/** Bytes per src, held SYNCHRONOUSLY at add time — the GIF decoder reads
	 *  them without a network round-trip (and without any race). */
	const layerBlobs = new SvelteMap<string, Blob>();
	let layerInput = $state<HTMLInputElement | null>(null);
	let layerBusy = $state(false);
	let imageMenuId = `meme-image-${Math.random().toString(36).slice(2, 8)}`;
	let showLayerUrlForm = $state(false);
	let layerUrl = $state('');
	let layerUrlBusy = $state(false);

	/** fetch() with a wsrv.nl retry for CORS-hostile CDNs — resolves null
	 *  when both the direct request and the proxy fail. CDNs that withhold
	 *  CORS (betterttv and friends — the "blocked by CORS policy" adds) are
	 *  unreadable to the browser any other way; wsrv.nl is an open-source
	 *  image proxy that sends ACAO:*. */
	async function fetchMediaResponse(url: string): Promise<Response | null> {
		const targets = /^https:\/\/wsrv\.nl\//i.test(url)
			? [url]
			: [url, `https://wsrv.nl/?url=${encodeURIComponent(url)}`];
		for (const target of targets) {
			try {
				const res = await fetch(target, { mode: 'cors' });
				if (res.ok) return res;
			} catch {
				/* try the proxy */
			}
		}
		return null;
	}

	/** CORS-minded byte fetch for URL-sourced layers (cap-checked, null on any
	 *  failure — callers fall back to the plain URL path). */
	async function fetchLayerBlob(url: string): Promise<Blob | null> {
		const res = await fetchMediaResponse(url);
		if (!res) return null;
		const blob = await res.blob();
		if (!blob.size || blob.size > MAX_IMAGE_OVERLAY_BYTES) return null;
		return blob;
	}

	/** Keep the bytes we already have as the render source for a remote src.
	 *  The Blob lands SYNCHRONOUSLY — cacheLayerGif must never race a promise
	 *  (the old async arrayBuffer() handoff made fresh layers fall back to a
	 *  network fetch that non-CORS providers fail, freezing the GIF at
	 *  frame 1 in exports). */
	function rememberLayerBytes(src: string, blob: Blob) {
		if (!layerBlobs.has(src)) layerBlobs.set(src, blob);
		if (!layerRenderSrcs.has(src)) layerRenderSrcs.set(src, URL.createObjectURL(blob));
	}

	/** Drop every per-src asset (blob URL, bytes, decoder, painter) — call when
	 *  no remaining layer references the src. */
	function releaseLayerAssets(src: string) {
		const obj = layerRenderSrcs.get(src);
		if (obj) {
			URL.revokeObjectURL(obj);
			layerRenderSrcs.delete(src);
		}
		layerBlobs.delete(src);
		layerGifs.get(src)?.close();
		layerGifs.delete(src);
		layerPainters.get(src)?.handle.close();
		layerPainters.delete(src);
	}

	/** Decode (and cache) the bitmap for a src; resolves even on failure.
	 *  Prefers the same-origin blob render source — only pure-URL layers
	 *  (draft restore, failed fetch) touch the network, and those need CORS. */
	function cacheLayerBitmap(src: string): Promise<boolean> {
		if (layerBitmaps.has(src)) return Promise.resolve(true);
		return new Promise((resolve) => {
			const img = new Image();
			const local = layerRenderSrcs.get(src);
			if (!local) img.crossOrigin = 'anonymous';
			img.onload = () => {
				layerBitmaps.set(src, img);
				imageLayers = [...imageLayers];
				resolve(true);
			};
			img.onerror = () => resolve(false);
			img.src = local ?? src;
		});
	}

	/** Add a layer from bytes and/or a remote URL. Rendering always prefers
	 *  the bytes (same-origin blob → export-safe); the media provider re-homes
	 *  them best-effort so drafts and the wire keep plain https srcs. */
	async function addImageLayer(
		source: { url?: string; bytes?: Blob; name?: string },
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
		// links) KEEP their source URL: the bytes we already hold render and
		// export locally, and the published media has the pixels burned in —
		// re-uploading CDN content to the provider would just duplicate it.
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
		if (!/^https:\/\//i.test(src)) {
			toasts.error('Image layers need an https URL');
			return;
		}
		const layer = makeImageOverlay(src, aspect, { index: layerSeq++ });
		if (!layer) {
			toasts.error('Could not use that image URL');
			return;
		}
		// Timeline insert: window [playhead, playhead+2s] on timed sources;
		// static memes have no clock, so the layer stays always-visible.
		if (opts.atMs !== undefined && timelineActive) {
			layer.startMs = Math.max(0, Math.round(opts.atMs));
			layer.endMs = layer.startMs + 2000;
		}
		imageLayers = [...imageLayers, layer];
		selectedLayerId = layer.id;
		if (bytes) rememberLayerBytes(layer.src, bytes);
		mediaLibrary.remember(layer.src, source.name ?? '', bytes?.type);
		const ok = await cacheLayerBitmap(layer.src);
		if (!ok) toasts.warning('Layer added — but the image failed to load (will retry on export)');
		// Animated GIF layers keep their motion in previews AND exports;
		// static layers just fall through to the bitmap path. Browsers without
		// WebCodecs ImageDecoder (Safari/Firefox) can't — say so up front.
		void cacheLayerGif(layer.src).then((animated) => {
			if (!animated && looksAnimatedGif(layer.src) && !canDecodeGif()) {
				toasts.info(
					'This GIF plays in the preview but exports as a still on this browser — Chrome or Edge keeps layers moving',
					5000
				);
			}
		});
	}

	/** Read natural aspect without keeping the decoder around. */
	async function probeAspect(bytes: Blob): Promise<number | null> {
		try {
			const url = URL.createObjectURL(bytes);
			try {
				return await new Promise<number | null>((resolve) => {
					const img = new Image();
					img.onload = () => resolve(img.naturalWidth / img.naturalHeight || null);
					img.onerror = () => resolve(null);
					img.src = url;
				});
			} finally {
				URL.revokeObjectURL(url);
			}
		} catch {
			return null;
		}
	}

	function removeLayer(id: string) {
		const gone = imageLayers.find((l) => l.id === id);
		imageLayers = imageLayers.filter((l) => l.id !== id);
		if (selectedLayerId === id) selectedLayerId = null;
		// Release the per-src assets when no remaining layer references it.
		if (gone && !imageLayers.some((l) => l.src === gone.src)) {
			releaseLayerAssets(gone.src);
		}
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
			if (picked.length) toasts.error('Layers take PNG, GIF or JPEG images');
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
	const splitTotal = $derived(splitRows.reduce((sum, r) => sum + r.basisPoints, 0));

	function addSplitRow() {
		splitRows = [...splitRows, { role: 'video_creator', basisPoints: 0 }];
	}

	function removeSplitRow(role: SplitRole, beneficiary?: string) {
		splitRows = splitRows.filter(
			(r) => !(r.role === role && (r.beneficiary ?? '') === (beneficiary ?? ''))
		);
	}

	/** Advisory license menu (S-013) — labels kept human, codes on the wire. */
	const LICENSE_OPTIONS: Array<{ code: RemixLicense; label: string }> = [
		{ code: 'CC0-1.0', label: 'CC0 · anyone can reuse' },
		{ code: 'CC-BY-4.0', label: 'CC BY · reuse with credit' },
		{ code: 'CC-BY-NC-4.0', label: 'CC BY-NC · non-commercial' },
		{ code: 'bitz/source-permission', label: 'Ask me first' },
		{ code: 'bitz/all-reserved', label: 'No remixes' }
	];
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
	const dirty = $derived(!!file || overlays.some((o) => o.text.trim()) || !!caption.trim());
	const canPost = $derived(
		!!file &&
			!busy &&
			(animated || overlays.some((o) => o.text.trim())) &&
			caption.length <= HARD_CAP &&
			splitCheck.ok
	);
	const overSoft = $derived(caption.length > SOFT_CAP);
	const portrait = $derived(meta ? meta.height >= meta.width : true);
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

	const DESTINATIONS: { id: Destination; label: string; icon: string; hint: string }[] = [
		{
			id: 'bitz',
			label: 'Bitz feed',
			icon: 'i-lucide-clapperboard',
			hint: 'Permanent media post (kind 20/21/22)'
		},
		{
			id: 'story',
			label: 'Story · 24h',
			icon: 'i-lucide-circle-dot-dashed',
			hint: 'Disappearing story (kind 30315)'
		},
		{
			id: 'note',
			label: 'Note',
			icon: 'i-lucide-message-square-text',
			hint: 'Text note with the meme attached (kind 1)'
		}
	];

	const TEMPLATES: Template[] = [
		{
			id: 'classic',
			label: 'Classic',
			hint: 'Top / bottom Impact caps',
			icon: 'i-lucide-letter-text',
			overlays: () => makeClassicPair()
		},
		{
			id: 'caption',
			label: 'Caption bar',
			hint: 'Single subtitle-bar line',
			icon: 'i-lucide-captions',
			overlays: () => [
				makeOverlay({
					text: 'when the code finally runs',
					y: 0.88,
					size: 0.06,
					bar: true,
					font: 'sans'
				})
			]
		},
		{
			id: 'drake',
			label: 'Drake',
			hint: 'No / Yes panels',
			icon: 'i-lucide-columns-2',
			overlays: () => [
				makeOverlay({ text: 'web2 platforms', x: 0.25, y: 0.24, size: 0.05 }),
				makeOverlay({ text: 'nostr', x: 0.75, y: 0.74, size: 0.05 })
			]
		},
		{
			id: 'punchline',
			label: 'Punchline',
			hint: 'Timed setup → punchline (video)',
			icon: 'i-lucide-zap',
			overlays: () => [
				{ ...makeOverlay({ text: 'setup…', y: 0.2, size: 0.06 }), endMs: 1500 },
				{ ...makeOverlay({ text: 'PUNCHLINE', y: 0.8, size: 0.1 }), startMs: 1500 }
			]
		}
	].filter((t) => t.id); // guard against typos in template defs

	/** Blank-canvas starter colors (fewer than MEME_COLORS — swatches, not text). */
	const BLANK_CANVAS_COLORS = ['#ffffff', '#000000', '#fde047', '#f97316', '#22d3ee', '#a3e635'];

	// ---- drag logic (pointer events, works with touch) -----------------------
	let dragState: { id: string; dx: number; dy: number } | null = null;

	function onOverlayPointerDown(event: PointerEvent, overlay: MemeTextOverlay) {
		if (busy) return;
		const box = stageBox?.getBoundingClientRect();
		if (!box) return;
		selectedId = overlay.id;
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
		revokePreview();
		file = null;
		mediaKind = null;
		meta = null;
		resetGif();
		sfxCues = [];
		overlays = [];
		for (const layer of imageLayers) releaseLayerAssets(layer.src);
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
		remixSource = null;
		remixLabel = '';
		sourceCredit = '';
		trimStartSec = 0;
		trimEndSec = null;
		playbackRate = 1;
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
				paintGifFrameAt(ctx, decoded, looped, canvas);
				raf = requestAnimationFrame(paint);
			};
			raf = requestAnimationFrame(paint);
			return () => cancelAnimationFrame(raf);
		}
		// Paused / scrubbing: paint the current playhead once per change.
		ctx.fillStyle = '#000';
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		paintGifFrameAt(ctx, decoded, previewSeconds, canvas);
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
		confirmDiscard = false;
		revokePreview();
		file = next;
		mediaKind = kind;
		// Poster frames belong to the previous clip — drop them on any media change.
		clearPoster();
		scrubSec = 0;
		// Fresh media breaks the remix lineage (the remix handoff opts back in
		// via keepRemix — e.g. when the source media failed to fetch and the
		// creator picks their own clip for the remixed layout).
		if (!opts.keepRemix) {
			remixSource = null;
			remixLabel = '';
		}
		meta = null;
		// Swaps may keep the caption layout + layers + cues (normalized coords
		// make them media-agnostic); a fresh pick starts clean, as before.
		if (!opts.keepLayout) {
			overlays = [];
			imageLayers = [];
			selectedLayerId = null;
			sfxCues = [];
			selectedId = null;
			timingId = null;
		}
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
		acceptFile(input.files?.[0] ?? null);
		input.value = '';
		pickFormat = 'all'; // one scoped pick — later choosers see everything again
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		acceptFile(e.dataTransfer?.files?.[0] ?? null);
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
		selectedId = null;
		timingId = null;
		fxId = null;
		imageLayers = [];
		selectedLayerId = null;
		layerGifs.forEach((g) => g.close());
		layerGifs.clear();
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
			const res = await fetch(handoff.mediaUrl);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const blob = await res.blob();
			const name = handoff.mediaUrl.split('/').pop() || 'remix-source';
			const asFile = new File([blob], name, {
				type: blob.type || (handoff.mediaType === 'image' ? 'image/jpeg' : 'video/mp4')
			});
			// keepRemix: loading the source media IS the remix path — lineage stays.
			await acceptFile(asFile, { keepRemix: true });
		} catch {
			toasts.error('Could not load the source media — pick your own clip below');
		}
		const applied = applyRemixPayload({
			overlays: handoff.overlays,
			sfxCues: handoff.sfxCues,
			...(handoff.imageLayers?.length ? { imageLayers: handoff.imageLayers } : {})
		});
		overlays = applied.overlays;
		sfxCues = applied.sfxCues;
		// Remix layers arrive as remote URLs already — cache bitmaps for the stage.
		imageLayers = applied.imageLayers;
		for (const layer of applied.imageLayers) {
			void cacheLayerBitmap(layer.src);
			void cacheLayerGif(layer.src);
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
	function isCustomCaptionColor(color: string): boolean {
		return !(MEME_COLORS as readonly string[]).includes(color);
	}

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

	function applyTemplate(template: Template) {
		if (busy) return;
		addTemplateOverlays(template.overlays(), template.label);
	}

	/** Re-apply a user-saved layout — fresh ids so each overlay is editable. */
	function applySavedTemplate(id: string) {
		if (busy) return;
		const saved = memeTemplates.list.find((t) => t.id === id);
		if (!saved) return;
		addTemplateOverlays(memeTemplates.apply(saved), `“${saved.label}”`);
	}

	/** Snapshot the whole studio state into a named slot (media ≤ cap). */
	async function saveCurrentSlot(): Promise<void> {
		if (!dirty) {
			toasts.error('Nothing to save yet — pick media or add captions first');
			return;
		}
		let media: { dataUrl: string; name: string; mimeType: string } | null = null;
		if (file && file.size <= MAX_SLOT_BYTES) {
			// Small media ride along (same data-URL pattern as the autosave draft).
			media = await mediaToDraftDataUrl(file);
		}
		const saved = memeSlots.save({
			label: slotName,
			media,
			mediaKindValue: mediaKind,
			overlays,
			sfxCues,
			imageLayers,
			caption,
			sensitive,
			destination,
			lookId,
			trimStartSec,
			trimEndSec,
			playbackRate
		});
		showSlotSave = false;
		slotName = '';
		toasts.success(`Saved “${saved.label}” to slots`);
	}

	/** Restore a slot onto the stage — a full WIP handoff, not a layout swap. */
	async function openSlot(id: string): Promise<void> {
		if (busy) return;
		const slot = memeSlots.list.find((s) => s.id === id);
		if (!slot) return;
		slotBusyId = id;
		try {
			const mediaFile = await memeSlots.slotMediaFile(slot);
			if (mediaFile) {
				await acceptFile(mediaFile, { keepRemix: false, keepLayout: false });
			}
			overlays = slot.overlays.map((o) => ({ ...o }));
			sfxCues = slot.sfxCues.map((c) => ({ ...c }));
			imageLayers = slot.imageLayers.map((l) => ({ ...l }));
			caption = slot.caption;
			sensitive = slot.sensitive;
			destination = slot.destination;
			lookId = memeLookOf(slot.lookId);
			selectedId = overlays[0]?.id ?? null;
			timingId = null;
			if (slot.mediaKindValue === 'video') {
				trimStartSec = slot.trimStartSec;
				trimEndSec = slot.trimEndSec;
				playbackRate = slot.playbackRate;
			}
			toasts.info(`“${slot.label}” restored`);
		} finally {
			slotBusyId = '';
		}
	}

	function removeSlot(id: string) {
		memeSlots.remove(id);
	}

	function saveCurrentTemplate() {
		if (busy) return;
		if (!overlays.some((o) => o.text.trim())) {
			toasts.error('Add at least one caption before saving a template');
			return;
		}
		try {
			const saved = memeTemplates.save(templateName, overlays);
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
		const cue = normalizeSfxCue({ sfx, atMs: Math.round(stageSeconds * 1000), gain: 1 });
		if (cue) sfxCues = [...sfxCues, cue];
	}

	/** Timeline tick drag: move a cue to a new time (wire ms model). */
	function retimeSfxCue(id: string, atMs: number) {
		sfxCues = sfxCues.map((c) => (c.id === id ? { ...c, atMs: Math.max(0, Math.round(atMs)) } : c));
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

	/** Build the full cue schedule (synth + custom sounds) and render it to
	 * an AudioBuffer ready to attach to a MediaRecorder stream. Returns null
	 * when there is nothing audible to mix (silent export). */
	async function renderCueMix(
		durationSec: number,
		cues: MemeSfxCue[] = sfxCues
	): Promise<AudioBuffer | null> {
		const OfflineCtx = window.OfflineAudioContext;
		if (!OfflineCtx) return null;
		const { buildCueMixBuffer: _lazyMix } = await import('$lib/meme/cue-mix');
		return _lazyMix(cues, durationSec, {
			offlineCtor: OfflineCtx,
			decodeSound: async (id) => {
				const sound = soundLibrary.list.find((s) => s.id === id);
				if (!sound) return null;
				return decodeSoundBlob(sound);
			}
		});
	}

	/** createSfxAudioTrack that never breaks the export on failure. */
	function safeCueTrack(buffer: AudioBuffer): MediaStreamTrack | null {
		try {
			return createSfxAudioTrack(buffer, window.AudioContext);
		} catch {
			return null;
		}
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
	let exportFormat = $state<'auto' | 'image' | 'gif' | 'video'>('auto');

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
		if (lookCss !== 'none') ctx.filter = lookCss;
		if (mediaKind === 'video' && stageVideo) {
			ctx.drawImage(stageVideo, 0, 0, a.width, a.height);
		} else if (gif) {
			paintGifFrameAt(ctx, gif, stageSeconds, a);
		} else if (stageImg) {
			const s = Math.max(
				a.width / (stageImg.naturalWidth || a.width),
				a.height / (stageImg.naturalHeight || a.height)
			);
			const dw = (stageImg.naturalWidth || a.width) * s;
			const dh = (stageImg.naturalHeight || a.height) * s;
			ctx.drawImage(stageImg, (a.width - dw) / 2, (a.height - dh) / 2, dw, dh);
		} else {
			throw new Error('The preview is still loading');
		}
		ctx.filter = 'none';
		paintImageOverlays(
			ctx,
			imageLayers,
			(src) => layerBitmaps.get(src) ?? null,
			a,
			undefined,
			animatedLayerResolver
		);
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
		const durationSec = gif ? gif.duration : sfxCues.length ? cueTrackDurationSec(sfxCues) : 0;
		const fps = 12;
		// GIFs stay light: ≤640px long edge, ≤360 frames (30s at 12fps).
		const scale = Math.min(1, 640 / Math.max(renderTarget.width, renderTarget.height));
		const a = document.createElement('canvas');
		a.width = Math.max(2, Math.round(renderTarget.width * scale) & ~1);
		a.height = Math.max(2, Math.round(renderTarget.height * scale) & ~1);
		const ctx = a.getContext('2d');
		if (!ctx) throw new Error('Canvas is not available in this browser');
		let frameCount = Math.max(1, Math.round(durationSec * fps));
		if (frameCount > 360) {
			frameCount = 360;
			toasts.info('GIF capped at 30 seconds — trim or drop cues for a shorter loop');
		}
		const frames: GifEncodeFrame[] = [];
		for (let i = 0; i < frameCount; i++) {
			const t = i / fps;
			track(
				'rendering',
				`Painting GIF frame ${i + 1}/${frameCount}…`,
				Math.round((i / frameCount) * 80)
			);
			ctx.fillStyle = '#000';
			ctx.fillRect(0, 0, a.width, a.height);
			if (lookCss !== 'none') ctx.filter = lookCss;
			if (gif) {
				paintGifFrameAt(ctx, gif, t, a);
			} else if (stageImg) {
				const s = Math.max(
					a.width / (stageImg.naturalWidth || a.width),
					a.height / (stageImg.naturalHeight || a.height)
				);
				const dw = (stageImg.naturalWidth || a.width) * s;
				const dh = (stageImg.naturalHeight || a.height) * s;
				ctx.drawImage(stageImg, (a.width - dw) / 2, (a.height - dh) / 2, dw, dh);
			}
			ctx.filter = 'none';
			paintImageOverlays(
				ctx,
				imageLayers,
				(src) => layerBitmaps.get(src) ?? null,
				a,
				t * 1000,
				animatedLayerResolver
			);
			paintAll(ctx, overlays, a, t * 1000);
			frames.push({ source: await createImageBitmap(a), delayMs: 1000 / fps });
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
				if (looksAnimatedGif(src) && !(await cacheLayerGif(src))) frozen.push(i + 1);
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
							? ` — the GIF failed to decode (${lastGifDecodeError || 'unknown'})`
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
				bitmaps: layerBitmaps,
				target: renderTarget
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
		// trim window and compressed by playbackRate (cues after trimEnd drop).
		const shiftCues = (atMs: number) => (atMs - trimStartSec * 1000) / (playbackRate || 1);
		const exportCues = sfxCues
			.map((c) => ({ ...c, atMs: shiftCues(c.atMs) }))
			.filter((c) => c.atMs >= 0 && c.atMs <= trimDuration * 1000);
		const cueBuffer = await renderCueMix(trimDuration / (playbackRate || 1), exportCues);
		const extraTracks: MediaStreamTrack[] = [];
		if (cueBuffer) {
			const track = safeCueTrack(cueBuffer);
			if (track) extraTracks.push(track);
		}
		const { blob, mimeType } = await renderVideoMeme(stageVideo, overlays, {
			signal: mineController?.signal,
			extraTracks,
			lookCss,
			imageLayers,
			bitmaps: layerBitmaps,
			animPainters: animatedLayerResolver,
			target: renderTarget,
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
		// Reuse the recorder stack: a canvas we paint frames onto, captureStream,
		// MediaRecorder with the first supported container/codec.
		const a = document.createElement('canvas');
		// Artboard (cover-fit) or the GIF's own frame — even dims, 1080 cap on
		// the source path like every meme export.
		const srcSize = { width: decoded.width, height: decoded.height };
		const size = artboardId === 'source' ? targetSize(srcSize) : renderTarget;
		a.width = Math.max(2, size.width - (size.width % 2));
		a.height = Math.max(2, size.height - (size.height % 2));
		const ctx = a.getContext('2d');
		if (!ctx) throw new Error('Canvas is not available in this browser');
		track('rendering', 'Recording meme…', 0);
		const stream = a.captureStream(30);
		// Synthesized + custom cue mix (if any cues exist) becomes the audio track.
		{
			const buffer = await renderCueMix(decoded.duration);
			if (buffer) {
				const cueTrack = safeCueTrack(buffer);
				if (cueTrack) stream.addTrack(cueTrack);
			}
		}
		const chunks: Blob[] = [];
		const pick = (): string => {
			for (const type of [
				'video/webm;codecs=vp9,opus',
				'video/webm;codecs=vp8,opus',
				'video/webm',
				'video/mp4'
			]) {
				if (MediaRecorder.isTypeSupported(type)) return type;
			}
			return '';
		};
		const mimeType = pick();
		if (!mimeType) throw new Error('This browser cannot record animated memes');
		const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
		recorder.ondataavailable = (e) => {
			if (e.data.size) chunks.push(e.data);
		};
		const done = new Promise<void>((resolve, reject) => {
			recorder.onstop = () => resolve();
			recorder.onerror = () => reject(new Error('Recording the meme failed'));
		});
		recorder.start(250);
		let cancelled = false;
		const onAbort = () => {
			cancelled = true;
		};
		mineController?.signal.addEventListener('abort', onAbort);
		try {
			// Real-time single pass: paint each frame for its own duration. GIF
			// timestamps are wall-clock aligned so SFX cues stay in sync.
			let cursor = 0; // ms into the timeline
			const startedAt = performance.now();
			const paint = () => {
				const elapsedMs = performance.now() - startedAt;
				ctx.fillStyle = '#000';
				ctx.fillRect(0, 0, a.width, a.height);
				if (lookCss !== 'none') ctx.filter = lookCss;
				paintGifFrameAt(ctx, decoded, elapsedMs / 1000, a);
				ctx.filter = 'none';
				paintImageOverlays(
					ctx,
					imageLayers,
					(src) => layerBitmaps.get(src) ?? null,
					a,
					elapsedMs,
					animatedLayerResolver
				);
				paintAll(ctx, overlays, a, elapsedMs);
				if (elapsedMs / 1000 >= decoded.duration) cursor = 1;
				if (optionsProgress(elapsedMs, (decoded.duration || 1) * 1000)) return;
				if (cancelled) return;
				requestAnimationFrame(paint);
			};
			requestAnimationFrame(paint);
			await new Promise<void>((resolve) => {
				const check = setInterval(() => {
					if (cancelled || cursor === 1) {
						clearInterval(check);
						resolve();
					}
				}, 100);
			});
		} finally {
			mineController?.signal.removeEventListener('abort', onAbort);
		}
		recorder.stop();
		await done;
		stream.getTracks().forEach((t) => t.stop());
		if (cancelled) throw new Error('Meme export cancelled');
		const blob = new Blob(chunks, { type: mimeType.split(';')[0] });
		if (!blob.size) throw new Error('The meme export produced an empty video');
		return new File([blob], `meme-${Date.now()}.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`, {
			type: mimeType.split(';')[0]
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
		const ctx = a.getContext('2d');
		if (!ctx) throw new Error('Canvas is not available in this browser');
		// Duration: last cue end + tail, clamped to the video-meme cap (shared
		// with the suggestion path via cue-track).
		const durationSec = cueTrackDurationSec(sfxCues);
		track('rendering', 'Recording sound meme…', 0);
		const stream = a.captureStream(30);
		const cueBuffer = await renderCueMix(durationSec, sfxCues);
		if (cueBuffer) {
			const cueTrack = safeCueTrack(cueBuffer);
			if (cueTrack) stream.addTrack(cueTrack);
		}
		const chunks: Blob[] = [];
		const pick = (): string => {
			for (const type of [
				'video/webm;codecs=vp9,opus',
				'video/webm;codecs=vp8,opus',
				'video/webm',
				'video/mp4'
			]) {
				if (MediaRecorder.isTypeSupported(type)) return type;
			}
			return '';
		};
		const mimeType = pick();
		if (!mimeType) throw new Error('This browser cannot record sound memes');
		const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
		recorder.ondataavailable = (e) => {
			if (e.data.size) chunks.push(e.data);
		};
		const done = new Promise<void>((resolve, reject) => {
			recorder.onstop = () => resolve();
			recorder.onerror = () => reject(new Error('Recording the meme failed'));
		});
		recorder.start(250);
		let cancelled = false;
		const onAbort = () => {
			cancelled = true;
		};
		mineController?.signal.addEventListener('abort', onAbort);
		try {
			// Real-time pass: paint the static frame (look + image layers + timed
			// captions), then re-paint as the timeline advances so start/end
			// windows and cue-synced captions behave exactly like GIF export.
			const cursor = { done: false };
			const startedAt = performance.now();
			const img: HTMLImageElement = stageImg;
			const paint = () => {
				const elapsedMs = performance.now() - startedAt;
				ctx.fillStyle = '#000';
				ctx.fillRect(0, 0, a.width, a.height);
				if (lookCss !== 'none') ctx.filter = lookCss;
				// Cover-fit (not stretch) — a mismatched artboard crops like the
				// stage preview instead of distorting the picture.
				const scale = Math.max(
					a.width / (img.naturalWidth || a.width),
					a.height / (img.naturalHeight || a.height)
				);
				const dw = (img.naturalWidth || a.width) * scale;
				const dh = (img.naturalHeight || a.height) * scale;
				ctx.drawImage(img, (a.width - dw) / 2, (a.height - dh) / 2, dw, dh);
				ctx.filter = 'none';
				paintImageOverlays(
					ctx,
					imageLayers,
					(src) => layerBitmaps.get(src) ?? null,
					a,
					elapsedMs,
					animatedLayerResolver
				);
				paintAll(ctx, overlays, a, elapsedMs);
				if (optionsProgress(elapsedMs, durationSec * 1000)) cursor.done = true;
				if (cancelled || cursor.done) return;
				requestAnimationFrame(paint);
			};
			requestAnimationFrame(paint);
			await new Promise<void>((resolve) => {
				const check = setInterval(() => {
					if (cancelled || cursor.done) {
						clearInterval(check);
						resolve();
					}
				}, 100);
			});
		} finally {
			mineController?.signal.removeEventListener('abort', onAbort);
		}
		recorder.stop();
		await done;
		stream.getTracks().forEach((t) => t.stop());
		if (cancelled) throw new Error('Meme export cancelled');
		const blob = new Blob(chunks, { type: mimeType.split(';')[0] });
		if (!blob.size) throw new Error('The meme export produced an empty video');
		return new File([blob], `meme-${Date.now()}.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`, {
			type: mimeType.split(';')[0]
		});
	}

	function optionsProgress(elapsedMs: number, totalMs: number): boolean {
		const percent = Math.min(100, Math.round((elapsedMs / totalMs) * 100));
		progress = percent;
		return percent >= 100;
	}

	async function uploadRendered(rendered: File): Promise<UploadedMediaLike> {
		track('uploading', 'Uploading meme…', 0);
		return media.upload(rendered, selectedProvider === 'none' ? undefined : selectedProvider, {
			pubkey: me?.pk,
			purpose: destination === 'story' ? 'story' : 'note',
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
		return feed.postBitz(
			{
				url: uploaded.url,
				kind: uploaded.kind as 'image' | 'video',
				mimeType: uploaded.mimeType,
				bytes: uploaded.bytes
			},
			{
				caption,
				sensitive,
				portrait,
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
					...(remixSource ? remixTagsFor(remixSource, { overlays, sfxCues, imageLayers }) : []),
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
		return feed.post(caption, {
			sensitive,
			attachments: [
				{
					url: uploaded.url,
					kind: uploaded.kind as 'image' | 'video',
					mimeType: uploaded.mimeType,
					bytes: uploaded.bytes
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
			toasts.error('This browser can\u2019t render animated memes — try Chrome/Edge');
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
			const message = (e as Error).message;
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
			const rendered = await exportMeme();
			const uploaded = await uploadRendered(rendered);
			track('publishing', 'Publishing to Nostr…');
			const eventId = await (destination === 'story'
				? publishStory(uploaded)
				: destination === 'note'
					? publishNote(uploaded)
					: publishBitz(uploaded));
			powPrefs.remember(showPow ? pow : 0);
			powPrefs.rememberPanelVisibility(showPow);
			toasts.push(
				destination === 'story'
					? 'Meme story posted · lasts 24h'
					: destination === 'note'
						? 'Meme note posted · kind 1'
						: `Meme published · kind ${kindInfo?.kind}`,
				'success',
				6000,
				destination === 'note'
					? { label: 'View note', run: () => goto(`/note/${eventId}`) }
					: { label: 'View in Bitz', run: () => goto(`/bitz#reel=${eventId}`) }
			);
			onposted(eventId);
			reset();
			draftWriter.clear();
			// Batch mode: keep the studio open and load the next queued GIF.
			if (queue.length > queueIndex) {
				void stageNextQueued();
				toasts.info(`Next meme loaded — ${queue.length - queueIndex - 1} left in queue`);
				return;
			}
			queue = [];
			queueIndex = 0;
			open = false;
		} catch (e) {
			const message = (e as Error).message;
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
		// Full-page mode has no overlay to hide — land on the start panel.
		if (!full) open = false;
	}

	/** What the discard dialog should do after wiping: `close` leaves the
	 *  studio (dialog mode hides, full mode resets to the start panel — the
	 *  page NEVER blanks), `new` is the "Start over" action (always stays). */
	let discardIntent = $state<'close' | 'new'>('close');

	/** Shared wipe: clears everything (media, captions, layers, sounds, remix
	 *  lineage, queue, draft) and lands on the start panel. */
	function startFresh() {
		confirmDiscard = false;
		queue = [];
		queueIndex = 0;
		reset();
		draftWriter.clear();
		// Dialog mode: closing hides the overlay. Full-page mode keeps the
		// studio mounted — the creator sees the format-card start panel
		// instead of a blank route (the old Cancel-blanks-the-page bug).
		if (!full && discardIntent === 'close') open = false;
	}

	/** "Start over" — a functional reset/create-new from inside the editor
	 *  (remix included: wipes the lineage and any handoff leftovers). */
	function requestNew() {
		if (busy) {
			toasts.info('Still working on your meme — one moment…');
			return;
		}
		if (dirty) {
			draftWriter.flush();
			discardIntent = 'new';
			confirmDiscard = true;
			return;
		}
		discardIntent = 'new';
		startFresh();
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
		if (busy) return;
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
			if (event.key === 'Escape') {
				event.preventDefault();
				confirmDiscard = false;
			}
			return;
		}
		if (full) {
			// Page mode: the route owns Escape (back to the studio home); the
			// studio owns the editing shortcuts on top of it.
			handleStudioShortcut(event);
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			requestClose();
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
				selectedId =
					draft.selectedId && overlays.some((o) => o.id === draft.selectedId)
						? draft.selectedId
						: (overlays[0]?.id ?? null);
				caption = draft.caption;
				sensitive = draft.sensitive;
				destination = draft.destination;
				lookId = memeLookOf(draft.lookId);
				if (restored || overlays.length > 0 || caption.trim()) {
					toasts.info('Draft restored — welcome back', 4000);
				}
			});
		}

		return () => {
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
		void destination;
		void selectedId;
		void lookId;
		if (!dirty) return; // nothing worth saving

		// Snapshot synchronously; serialize the media bytes untracked so a slow
		// encode never keeps the effect re-running or blocks the UI thread.
		const snapshot = {
			overlays,
			caption,
			sensitive,
			destination,
			selectedId,
			lookId,
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
					destination: snapshot.destination,
					selectedId: snapshot.selectedId,
					lookId: snapshot.lookId
				});
			})();
		});
	});
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div class={full ? 'h-full' : 'fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4'}>
		{#if !full}
			<button
				type="button"
				aria-label="Close Meme Studio"
				tabindex="-1"
				class="animate-fade absolute inset-0 bg-black/60 backdrop-blur-[3px]"
				onclick={requestClose}
			></button>
		{/if}
		<div
			class="surface-card relative z-10 flex w-full flex-col overflow-hidden {full
				? 'h-full max-w-none rounded-none border-0 shadow-none'
				: 'max-h-[calc(100dvh-1.5rem)] max-w-3xl rounded-2xl shadow-2xl shadow-black/30'}"
			role={full ? undefined : 'dialog'}
			aria-modal={full ? undefined : 'true'}
			aria-label={full ? undefined : 'Meme Studio'}
		>
			{#if !full}
				<header
					class="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-[var(--ui-border)] px-4 sm:h-14"
				>
					<span
						class="grid size-9 shrink-0 place-items-center rounded-xl bg-warm-500/12 text-warm-500"
					>
						<Icon name="i-lucide-laugh" class="size-5" />
					</span>
					<div class="min-w-0 flex-1">
						<h2 class="text-[15px] leading-tight font-bold text-[var(--ui-text-highlighted)]">
							Meme Studio
						</h2>
						<p class="truncate text-[11px] text-[var(--ui-text-dimmed)]">
							{#if kindInfo}
								{kindInfo.label} · kind {kindInfo.kind} · {kindInfo.nip} → {destination === 'story'
									? 'story (24h)'
									: destination === 'note'
										? 'note'
										: 'Bitz feed'}
							{:else}
								Burn captions into a picture or video, publish anywhere
							{/if}
						</p>
					</div>
					<button
						type="button"
						onclick={requestClose}
						aria-label="Close Meme Studio"
						class="grid size-9 shrink-0 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] active:scale-95"
					>
						<Icon name="i-lucide-x" class="size-5" />
					</button>
				</header>
			{/if}

			{#if queue.length - queueIndex > 0}
				<div
					class="flex shrink-0 items-start justify-between gap-2 border-b border-warm-500/25 bg-warm-500/10 px-4 py-2"
				>
					<div class="flex min-w-0 flex-1 flex-col gap-1.5">
						<div class="flex items-center gap-2 text-[12px] font-semibold text-warm-600">
							<Icon name="i-lucide-list-video" class="size-4 shrink-0" />
							<span class="truncate">
								Batch queue: {queue.length - queueIndex} clip{queue.length - queueIndex === 1
									? ''
									: 's'} left — each post loads the next
							</span>
						</div>
						<!-- Per-item captions: type a line per queued GIF; it becomes that post's text. -->
						<div class="flex flex-col gap-1">
							{#each queue.slice(queueIndex) as item, i (item.id)}
								<div class="flex items-center gap-1.5">
									<span
										class="grid size-5 shrink-0 place-items-center rounded-full bg-warm-500/15 font-mono text-[10px] font-bold text-warm-600"
										title={queue[queueIndex + i]?.label ?? ''}
									>
										{queueIndex + i + 1}
									</span>
									<input
										type="text"
										value={item.caption ?? ''}
										maxlength="280"
										placeholder={`Caption for ${item.label}…`}
										aria-label={`Caption for queued clip ${queueIndex + i + 1}`}
										oninput={(e) => {
											const v = (e.target as HTMLInputElement).value;
											item.caption = v === '' ? undefined : v;
										}}
										class="h-7 min-w-0 flex-1 rounded-lg border border-warm-500/20 bg-[var(--ui-bg)] px-2 text-[12px] outline-none focus:border-warm-500/60"
									/>
								</div>
							{/each}
						</div>
					</div>
					<span class="flex shrink-0 items-center gap-1">
						<button
							type="button"
							onclick={() => void stageNextQueued()}
							disabled={gifStageBusy || busy}
							title={`Skip this one and load the next queued clip (${queue[queueIndex]?.label ?? 'none'})`}
							class="rounded-full px-2.5 py-1 text-[11px] font-bold text-warm-600 transition hover:bg-warm-500/20 disabled:opacity-50"
						>
							Skip →
						</button>
						<button
							type="button"
							onclick={() => {
								queue = [];
								queueIndex = 0;
							}}
							title="Drop every queued GIF"
							class="rounded-full px-2.5 py-1 text-[11px] font-semibold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]"
						>
							Clear
						</button>
					</span>
				</div>
			{/if}

			<!-- Full page mode owns its own pane scrolling; the dialog keeps a
			     single centered scroll column. -->
			<div class={full ? 'flex min-h-0 flex-1 flex-col' : 'min-h-0 flex-1 overflow-y-auto'}>
				{#if !file}
					<!-- Empty state -->
					<div class="flex min-h-[420px] flex-col items-center justify-center p-6">
						{#if remixSource}
							<!-- Remix chain handoff: the source media is loading (or failed and
							     fell back to "pick your own clip" — the layout still applies). -->
							<div
								class="mb-4 flex w-full max-w-sm items-center gap-3 rounded-2xl border border-warm-500/30 bg-warm-500/10 px-4 py-3"
							>
								<span
									class="grid size-9 shrink-0 place-items-center rounded-xl bg-warm-500/15 text-warm-500"
								>
									<Icon name="i-lucide-repeat" class="size-5" />
								</span>
								<div class="min-w-0">
									<p class="text-[13.5px] font-bold text-[var(--ui-text-highlighted)]">
										Remixing “{remixLabel}”
									</p>
									<p class="text-[12px] leading-relaxed text-[var(--ui-text-muted)]">
										Loading the source clip + applying its captions & sounds…
									</p>
								</div>
							</div>
						{/if}
						<div
							role="button"
							tabindex="0"
							aria-label="Choose a picture or video for your meme"
							class="group flex w-full max-w-sm cursor-pointer flex-col items-center gap-3 rounded-3xl border-2 border-dashed px-6 py-10 text-center transition {dragOver
								? 'border-warm-500 bg-warm-500/10'
								: 'border-[var(--ui-border-accented)] hover:border-warm-500/60 hover:bg-[var(--ui-bg-muted)]'}"
							onclick={() => fileInput?.click()}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									fileInput?.click();
								}
							}}
							ondragover={(e) => {
								e.preventDefault();
								dragOver = true;
							}}
							ondragleave={() => (dragOver = false)}
							ondrop={onDrop}
						>
							<span
								class="grid size-16 place-items-center rounded-2xl bg-warm-500/12 text-warm-500 transition group-hover:scale-105"
							>
								<Icon name="i-lucide-image-plus" class="size-8" />
							</span>
							<div>
								<p class="text-[15px] font-bold text-[var(--ui-text-highlighted)]">
									Drop a picture or video
								</p>
								<p class="mt-1 text-[13px] leading-relaxed text-[var(--ui-text-muted)]">
									Caption it, drag captions anywhere, export once — up to 200 MB.
								</p>
							</div>
							<span
								class="mt-1 inline-flex items-center gap-1.5 rounded-full bg-warm-500 px-4 py-2 text-[12.5px] font-bold text-white transition group-hover:brightness-110 active:scale-95"
							>
								<Icon name="i-lucide-upload" class="size-4" />
								Choose media
							</span>
							<p class="flex items-center gap-1 text-[11px] text-[var(--ui-text-dimmed)]">
								<Icon name="i-lucide-globe" class="size-3.5" />
								Captions are burned in — renders in every Nostr app
							</p>
							<!-- Format-first start: pick the meme type — the chooser opens
							     pre-scoped to that format (image / GIF / video). -->
							<div class="flex w-full flex-wrap items-stretch justify-center gap-2">
								{#each PICK_FORMATS as format (format.id)}
									<button
										type="button"
										onclick={() => void pickMediaAs(format.id)}
										class="group/fmt flex min-w-[104px] flex-1 flex-col items-center gap-1 rounded-2xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)]/60 px-3 py-2.5 transition hover:border-warm-500/50 hover:bg-warm-500/10 active:scale-95"
										title={`Start a ${format.label} — opens the ${format.id.toUpperCase()} picker`}
									>
										<span
											class="grid size-8 place-items-center rounded-xl bg-warm-500/12 text-warm-500 transition group-hover/fmt:scale-110"
										>
											<Icon name={format.icon} class="size-4.5" />
										</span>
										<span class="text-[11.5px] font-bold text-[var(--ui-text)]">
											{format.label}
										</span>
										<span class="text-[9.5px] leading-tight text-[var(--ui-text-dimmed)]">
											{format.hint}
										</span>
									</button>
								{/each}
							</div>
						</div>
						<div class="mt-3 flex w-full max-w-sm flex-wrap items-center justify-center gap-1.5">
							<Popover
								id={gifPickerMenuId}
								float
								placement="top-start"
								width="auto"
								class="w-72 max-w-[80vw] p-0 sm:w-80"
								label="Pick a GIF from the library"
								triggerClass="flex items-center gap-1 rounded-full bg-warm-500/10 px-3 py-1.5 text-[11.5px] font-bold text-warm-600 transition hover:bg-warm-500/20"
								triggerActiveClass="bg-warm-500/20"
							>
								{#snippet trigger()}
									<Icon name="i-lucide-film" class="size-3.5" />
									GIF library
									{#if gifStageBusy}
										<Icon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
									{/if}
								{/snippet}
								<GifPicker
									multiple
									max={6}
									onpick={pickGifForStage}
									onpickmany={pickGifsForStage}
								/>
							</Popover>
							<Popover
								id={blankMenuId}
								float
								placement="top-start"
								width="auto"
								label="Start from a blank canvas"
								triggerClass="flex items-center gap-1 rounded-full px-3 py-1.5 text-[11.5px] font-semibold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg)] hover:text-[var(--ui-text)]"
							>
								{#snippet trigger()}
									<Icon name="i-lucide-square-plus" class="size-3.5" />
									Blank canvas
								{/snippet}
								<div class="flex items-center gap-1.5 p-1.5">
									{#each BLANK_CANVAS_COLORS as color (color)}
										<button
											type="button"
											aria-label={`Start a blank ${color} canvas`}
											title={color}
											disabled={gifStageBusy}
											onclick={() => startBlank(color)}
											class="size-7 rounded-full border border-black/10 transition hover:scale-110 active:scale-95 dark:border-white/20"
											style="background:{color};"
										></button>
									{/each}
								</div>
							</Popover>
							<button
								type="button"
								class="flex items-center gap-1 rounded-full px-3 py-1.5 text-[11.5px] font-semibold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg)] hover:text-[var(--ui-text)]"
								onclick={() => (showGifUrlForm = !showGifUrlForm)}
							>
								<Icon name="i-lucide-link" class="size-3.5" />
								{showGifUrlForm ? 'Hide URL' : 'Paste URL'}
							</button>
							<!-- Recently-used sources: one-tap reopen for mass production. -->
							<MemeSourceLibrary
								id={startLibMenuId}
								busy={gifStageBusy || busy}
								onOpenBase={(source) => void loadSourceFromUrl(source.url, source.label)}
								onAddLayer={(source) =>
									void addImageLayer({ url: source.url }, undefined, {
										atMs: timelineActive ? Math.round(stageSeconds * 1000) : undefined
									})}
							/>
						</div>
						{#if showGifUrlForm}
							<!-- Image/GIF sourcing: paste a direct URL (user request 2026-08-23). -->
							<form
								class="mt-2 flex w-full max-w-sm items-center gap-1.5"
								onsubmit={(e) => {
									e.preventDefault();
									void importGifFromUrl();
								}}
							>
								<label class="sr-only" for="meme-gif-url">Image or GIF URL</label>
								<input
									id="meme-gif-url"
									type="url"
									bind:value={gifUrl}
									placeholder="Paste an image / GIF URL"
									class="h-9 min-w-0 flex-1 rounded-full border border-[var(--ui-border-muted)] bg-transparent px-3.5 text-[12.5px] outline-none placeholder:text-[var(--ui-text-dimmed)] focus:border-warm-500"
									disabled={gifUrlBusy}
								/>
								<button
									type="submit"
									class="flex h-9 shrink-0 items-center gap-1 rounded-full bg-warm-500/10 px-3 text-[11.5px] font-bold text-warm-600 transition hover:bg-warm-500/20 disabled:opacity-50"
									disabled={gifUrlBusy || !gifUrl.trim()}
								>
									<Icon
										name={gifUrlBusy ? 'i-lucide-loader-circle' : 'i-lucide-link'}
										class="size-3.5 {gifUrlBusy ? 'animate-spin' : ''}"
									/>
									{gifUrlBusy ? 'Loading…' : 'Use URL'}
								</button>
							</form>
						{/if}
					</div>
				{:else}
					<!-- Panes as snippets — one markup source, two layouts: the dialog grid
					     (composer dialog) and the full-page pro studio (tools · stage ·
					     inspector + a pinned timeline bar). -->
					{#snippet stagePane()}
						<!-- WYSIWYG stage: fills the center pane on the full page (scaled
					     by the zoom control — overlay coords are normalized to the stage
					     box, so zoom never disturbs them), fixed 260px in the dialog.
					     The width calc uses the ARTBOARD ratio (was hardcoded 9:16). -->
						<div
							class="mx-auto w-full {full ? '' : 'max-w-[260px] sm:mx-0'}"
							style={full
								? `width:calc(min(430px, (100dvh - 17.5rem) * ${stageRatio}) * ${stageZoom})`
								: ''}
						>
							<div class="mb-1.5 flex items-center justify-between gap-2">
								<p
									class="text-[10px] font-bold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
								>
									Preview — drag captions
								</p>
								<!-- Canvas-size zoom (full layout): fit ↔ 150% for detail work.
									     The % readout doubles as a reset-to-fit button. -->
								{#if full}
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
								{/if}
							</div>
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
									<!-- object-cover mirrors the export's drawCover — what you
									     see (including the crop on a mismatched artboard) is the file. -->
									<video
										src={previewUrl}
										bind:this={stageVideo}
										class="absolute inset-0 size-full object-cover"
										autoplay
										muted
										loop
										playsinline
										aria-label="Meme video preview"
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
											stageSeconds = (e.currentTarget as HTMLVideoElement).currentTime;
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
										class="absolute inset-0 size-full object-cover"
										style="filter:{lookCss};"
										onload={onImageLoad}
									/>
								{/if}

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
												100}%; aspect-ratio:{layer.aspect}; transform:translate(-50%, -50%) rotate({layer.rotate ??
												0}deg) scaleX({layer.flipH ? -1 : 1}) scaleY({layer.flipV
												? -1
												: 1}); opacity:{layer.opacity ?? 1}; filter:{layerLookCss(layer)};"
											aria-label={`Image layer ${li + 1}`}
										>
											{#if layerBitmaps.has(layer.src)}
												<img
													src={layerRenderSrcs.get(layer.src) ?? layer.src}
													alt=""
													crossOrigin="anonymous"
													class="pointer-events-none max-h-full max-w-full select-none {layerBitmaps.get(
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
							<div class="mt-2 flex flex-wrap items-center justify-between gap-2">
								<div class="flex flex-wrap items-center gap-1">
									<button
										type="button"
										onclick={() => fileInput?.click()}
										disabled={busy}
										class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-40"
									>
										<Icon name="i-lucide-repeat-2" class="size-3" />
										Replace
									</button>
									<!-- Mass production: multi-pick more sources (videos/pictures) into
									     the batch queue — each publish loads the next one. -->
									<button
										type="button"
										onclick={() => queueInput?.click()}
										disabled={busy}
										title="Queue more clips — each publish loads the next one"
										class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-[var(--ui-text-muted)] transition hover:bg-warm-500/15 hover:text-warm-600 disabled:opacity-40"
									>
										<Icon name="i-lucide-list-video" class="size-3" />
										Queue clips
									</button>
									<!-- Recent sources: swap the base or drop a layer in one tap. -->
									<MemeSourceLibrary
										id={swapLibMenuId}
										busy={gifStageBusy || busy}
										triggerLabel="Library"
										onOpenBase={(source) => void loadSourceFromUrl(source.url, source.label)}
										onAddLayer={(source) =>
											void addImageLayer({ url: source.url }, undefined, {
												atMs: timelineActive ? Math.round(stageSeconds * 1000) : undefined
											})}
									/>
									<Popover
										id={swapGifMenuId}
										float
										placement="top-start"
										width="auto"
										class="w-72 max-w-[80vw] p-0 sm:w-80"
										label="Swap the base GIF from the library"
										triggerClass="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-40"
										triggerActiveClass="bg-warm-500/15 text-warm-600"
									>
										{#snippet trigger()}
											<Icon name="i-lucide-film" class="size-3" />
											GIFs
											{#if gifStageBusy}
												<Icon name="i-lucide-loader-circle" class="size-3 animate-spin" />
											{/if}
										{/snippet}
										<GifPicker onpick={swapGifFromLib} />
									</Popover>
									<label
										class="inline-flex cursor-pointer items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold transition {keepLayoutOnSwap
											? 'bg-warm-500/15 text-warm-600'
											: 'text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]'}"
										title="Keep captions, image layers and sound cues when the base media changes"
									>
										<input
											type="checkbox"
											bind:checked={keepLayoutOnSwap}
											disabled={busy}
											class="size-3 accent-[var(--color-warm-500)]"
										/>
										Keep captions
									</label>
									<button
										type="button"
										onclick={() => (showSwapUrlForm = !showSwapUrlForm)}
										disabled={busy || gifUrlBusy}
										class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-40"
									>
										<Icon name="i-lucide-link" class="size-3" />
										{showSwapUrlForm ? 'Hide URL' : 'URL'}
									</button>
								</div>
								<button
									type="button"
									onclick={clearMedia}
									disabled={busy}
									class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--tone-error-text)] disabled:opacity-40"
								>
									<Icon name="i-lucide-trash-2" class="size-3" />
									Remove
								</button>
								<!-- Start over: full reset (media + captions + sounds + remix
								     lineage + queue + draft) back to the format-card start panel. -->
								<button
									type="button"
									onclick={requestNew}
									disabled={busy}
									title="Clear everything and start a new meme"
									class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-warm-600 transition hover:bg-warm-500/15 disabled:opacity-40"
								>
									<Icon name="i-lucide-file-plus" class="size-3" />
									New
								</button>
							</div>
							{#if showSwapUrlForm}
								<form
									class="mt-2 flex items-center gap-1.5"
									onsubmit={(e) => {
										e.preventDefault();
										void importGifFromUrl();
									}}
								>
									<input
										type="url"
										inputmode="url"
										bind:value={gifUrl}
										placeholder="https://example.com/meme.gif"
										class="h-8 min-w-0 flex-1 rounded-full border border-[var(--ui-border-muted)] bg-transparent px-3 text-[12px] outline-none placeholder:text-[var(--ui-text-dimmed)] focus:border-warm-500"
										disabled={gifUrlBusy}
									/>
									<button
										type="submit"
										class="flex h-8 shrink-0 items-center gap-1 rounded-full bg-warm-500/10 px-3 text-[11px] font-bold text-warm-600 transition hover:bg-warm-500/20 disabled:opacity-50"
										disabled={gifUrlBusy || !gifUrl.trim()}
									>
										<Icon
											name={gifUrlBusy ? 'i-lucide-loader-circle' : 'i-lucide-check'}
											class="size-3 {gifUrlBusy ? 'animate-spin' : ''}"
										/>
										{gifUrlBusy ? 'Loading…' : 'Swap'}
									</button>
								</form>
							{/if}
						</div>
					{/snippet}

					{#snippet timelinePane()}
						<MemeTimeline
							durationSec={timelineDurationSec}
							seconds={mediaKind === 'video' ? (stageVideo?.currentTime ?? 0) : stageSeconds}
							playing={mediaKind === 'video'
								? stageVideo
									? !stageVideo.paused
									: false
								: previewPlaying}
							onPlayPause={togglePreview}
							onScrub={(s) => scrubPreview(s)}
							soundOn={previewSoundOn}
							onToggleSound={togglePreviewSound}
							{overlays}
							layers={imageLayers}
							cues={sfxCues}
							{busy}
							selectedOverlayId={selectedId}
							{selectedLayerId}
							onSelectOverlay={(id) => {
								selectedId = id;
								selectedLayerId = null;
							}}
							onSelectLayer={(id) => {
								selectedLayerId = id;
								selectedId = null;
							}}
							onPatchOverlay={patchOverlay}
							onPatchLayer={(id, patch) => patchLayer(id, patch)}
							onPatchCue={retimeSfxCue}
							cueMetaFor={cueMeta}
						/>
						<!-- Insert-at-playhead actions (video/timed sources): the timeline is
						     the natural place to drop a timed caption / sound / poster frame. -->
						<div class="mt-1.5 flex flex-wrap items-center gap-1.5">
							<button
								type="button"
								onclick={addCaptionAtPlayhead}
								disabled={busy}
								title="Add a caption with a 2s window starting at the playhead"
								class="flex items-center gap-1 rounded-full bg-primary-500/10 px-2.5 py-1 text-[10.5px] font-bold text-primary-600 transition hover:bg-primary-500/20 disabled:opacity-40"
							>
								<Icon name="i-lucide-captions-plus" class="size-3.5" />
								Caption @ {formatDuration(stageSeconds)}
							</button>
							<button
								type="button"
								onclick={() => popovers.open(sfxMenuId)}
								disabled={busy || !mediaKind}
								title="Add a sound cue at the playhead"
								class="flex items-center gap-1 rounded-full bg-warm-500/10 px-2.5 py-1 text-[10.5px] font-bold text-warm-600 transition hover:bg-warm-500/20 disabled:opacity-40"
							>
								<Icon name="i-lucide-music-plus" class="size-3.5" />
								Sound @ {formatDuration(stageSeconds)}
							</button>
							<!-- Image @ playhead: drop a movable layer with a 2s window right
							     where the playhead sits — sources: upload / URL / GIF library. -->
							<Popover
								id={tlImageMenuId}
								float
								placement="top-start"
								width="auto"
								label="Add an image layer at the playhead"
								triggerClass="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10.5px] font-bold text-emerald-600 transition hover:bg-emerald-500/20 disabled:opacity-40"
								triggerActiveClass="bg-emerald-500/20"
							>
								{#snippet trigger()}
									<Icon name="i-lucide-image-plus" class="size-3.5" />
									Image @ {formatDuration(stageSeconds)}
								{/snippet}
								<div class="w-64 max-w-[80vw] p-1.5">
									<p class="px-1.5 pb-1.5 text-[10.5px] leading-snug text-[var(--ui-text-dimmed)]">
										Lands with a 2s window at {formatDuration(stageSeconds)} — tweak it in the Image layers
										list.
									</p>
									<div class="flex items-center gap-1">
										<button
											type="button"
											onclick={() => {
												pendingLayerAtMs = Math.round(stageSeconds * 1000);
												layerInput?.click();
												popovers.close();
											}}
											disabled={layerBusy}
											class="flex flex-1 items-center gap-1.5 rounded-lg bg-[var(--ui-bg-accented)] px-2.5 py-2 text-[11.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-50"
										>
											<Icon name="i-lucide-upload" class="size-3.5" />
											Upload file
										</button>
										<button
											type="button"
											onclick={(e) => {
												// keep the popover open — the global click-close would eat it
												e.stopPropagation();
												showTlLayerUrlForm = !showTlLayerUrlForm;
											}}
											disabled={layerBusy}
											class="flex flex-1 items-center gap-1.5 rounded-lg bg-[var(--ui-bg-accented)] px-2.5 py-2 text-[11.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-50"
										>
											<Icon name="i-lucide-link" class="size-3.5" />
											URL
										</button>
									</div>
									{#if showTlLayerUrlForm}
										<div class="mt-1.5 flex items-center gap-1">
											<input
												type="url"
												inputmode="url"
												bind:value={layerUrl}
												placeholder="https://…/sticker.png"
												class="h-8 min-w-0 flex-1 rounded-full border border-[var(--ui-border-muted)] bg-transparent px-3 text-[11.5px] outline-none placeholder:text-[var(--ui-text-dimmed)] focus:border-warm-500"
												disabled={layerUrlBusy}
												onkeydown={(e) => {
													// keydown (not form submit) — popover panels unmount on
													// the global click-close before deferred submits fire.
													if (e.key === 'Enter') {
														e.preventDefault();
														void addLayerFromUrl(Math.round(stageSeconds * 1000));
														popovers.close();
													}
												}}
											/>
											<button
												type="button"
												onclick={() => {
													void addLayerFromUrl(Math.round(stageSeconds * 1000));
													popovers.close();
												}}
												disabled={layerUrlBusy || !layerUrl.trim()}
												class="grid size-8 shrink-0 place-items-center rounded-full bg-emerald-500/12 text-emerald-600 transition hover:bg-emerald-500/20 disabled:opacity-50"
												aria-label="Add this URL as a timed layer"
											>
												<Icon
													name={layerUrlBusy ? 'i-lucide-loader-circle' : 'i-lucide-check'}
													class="size-3.5 {layerUrlBusy ? 'animate-spin' : ''}"
												/>
											</button>
										</div>
									{/if}
									<p
										class="mt-1.5 flex items-center gap-1 px-1 text-[10.5px] text-[var(--ui-text-dimmed)]"
									>
										<Icon name="i-lucide-film" class="size-3" />
										or pick a GIF sticker
									</p>
									<GifPicker
										onpick={(g) => void addLayerFromGifLib(g, Math.round(stageSeconds * 1000))}
										onbrowse={() => {
											// Same one-shot as the popover's Upload file: lands with a
											// 2s window at the playhead.
											pendingLayerAtMs = Math.round(stageSeconds * 1000);
											layerInput?.click();
											popovers.close();
										}}
									/>
								</div>
							</Popover>
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
							<!-- Templates -->
							<div class="flex flex-wrap items-center gap-1.5">
								<span
									class="text-[10px] font-bold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
								>
									Template
								</span>
								{#each TEMPLATES as template (template.id)}
									<button
										type="button"
										onclick={() => applyTemplate(template)}
										disabled={busy}
										title={template.hint}
										class="inline-flex items-center gap-1 rounded-full bg-[var(--ui-bg-accented)] px-2.5 py-1 text-[11px] font-bold text-[var(--ui-text)] transition hover:bg-warm-500/15 hover:text-warm-500 active:scale-95 disabled:opacity-40"
									>
										<Icon name={template.icon} class="size-3.5" />
										{template.label}
									</button>
								{/each}
								<button
									type="button"
									onclick={() => addOverlay()}
									disabled={busy || overlays.length >= 12}
									class="inline-flex items-center gap-1 rounded-full bg-warm-500/12 px-2.5 py-1 text-[11px] font-bold text-warm-500 transition hover:bg-warm-500/20 active:scale-95 disabled:opacity-40"
								>
									<Icon name="i-lucide-plus" class="size-3.5" />
									Caption
								</button>
								<!-- Saved templates: user layouts persisted locally -->
								<Popover
									id={templateMenuId}
									float
									placement="bottom-start"
									width="auto"
									class="w-72 max-w-[80vw] p-0"
									label="Saved templates"
									triggerClass="inline-flex items-center gap-1 rounded-full bg-[var(--ui-bg-accented)] px-2.5 py-1 text-[11px] font-bold text-[var(--ui-text)] transition hover:bg-warm-500/15 hover:text-warm-500"
									triggerActiveClass="bg-warm-500/15 text-warm-500"
								>
									{#snippet trigger()}
										<Icon name="i-lucide-bookmark" class="size-3.5" />
										Saved
										{#if memeTemplates.list.length}
											<span
												class="rounded-full bg-warm-500/15 px-1.5 font-mono text-[10px] text-warm-500"
											>
												{memeTemplates.list.length}
											</span>
										{/if}
									{/snippet}
									<div class="max-h-64 overflow-y-auto p-1.5">
										{#if memeTemplates.list.length}
											{#each memeTemplates.list as saved (saved.id)}
												<div
													class="group flex items-center gap-1 rounded-lg px-1.5 py-1 transition hover:bg-[var(--ui-bg-muted)]"
												>
													<button
														type="button"
														onclick={() => applySavedTemplate(saved.id)}
														disabled={busy}
														title="Apply this layout"
														class="flex min-w-0 flex-1 items-center gap-2 text-left"
													>
														<Icon name={saved.icon} class="size-4 shrink-0 text-warm-500" />
														<span class="min-w-0 flex-1">
															<span class="block truncate text-[12.5px] font-bold">
																{saved.label}
															</span>
															<span class="block text-[10.5px] text-[var(--ui-text-dimmed)]">
																{saved.overlays.length} caption{saved.overlays.length === 1
																	? ''
																	: 's'}
															</span>
														</span>
													</button>
													<button
														type="button"
														onclick={() => removeSavedTemplate(saved.id)}
														aria-label={`Delete template ${saved.label}`}
														class="grid size-6 shrink-0 place-items-center rounded-full text-[var(--ui-text-muted)] opacity-0 transition group-hover:opacity-100 hover:text-[var(--tone-error-text)] focus-visible:opacity-100"
													>
														<Icon name="i-lucide-trash-2" class="size-3.5" />
													</button>
												</div>
											{/each}
										{:else}
											<p class="px-2 py-3 text-center text-[12px] text-[var(--ui-text-muted)]">
												No saved templates yet — build a layout and hit
												<span class="font-bold">Save</span>.
											</p>
										{/if}
									</div>
									{#if memeTemplates.list.length}
										<div class="border-t border-[var(--ui-border-muted)] p-1.5">
											<MenuDivider />
										</div>
									{/if}
									<div class="p-1.5 pt-0">
										{#if showTemplateSave}
											<div class="flex items-center gap-1.5">
												<input
													type="text"
													value={templateName}
													maxlength="40"
													placeholder="Template name"
													aria-label="Template name"
													onkeydown={(e) => {
														if (e.key === 'Enter') saveCurrentTemplate();
														if (e.key === 'Escape') showTemplateSave = false;
													}}
													class="h-8 min-w-0 flex-1 rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-2.5 text-[12.5px] font-semibold outline-none focus:border-warm-500/60"
												/>
												<button
													type="button"
													onclick={saveCurrentTemplate}
													disabled={busy || !overlays.length}
													class="grid size-8 shrink-0 place-items-center rounded-lg bg-warm-500 text-white transition hover:brightness-110 active:scale-95 disabled:opacity-40"
													aria-label="Save template"
												>
													<Icon name="i-lucide-check" class="size-4" />
												</button>
											</div>
										{:else}
											<button
												type="button"
												onclick={() => (showTemplateSave = true)}
												disabled={busy || !overlays.length}
												class="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-warm-500/12 text-[12px] font-bold text-warm-500 transition hover:bg-warm-500/20 active:scale-[0.98] disabled:opacity-40"
											>
												<Icon name="i-lucide-bookmark-plus" class="size-4" />
												Save current layout{overlays.length
													? ` (${overlays.length} caption${overlays.length === 1 ? '' : 's'})`
													: ''}
											</button>
										{/if}
									</div>
								</Popover>

								<!-- Draft slots: named WIP snapshots (save now, resume later) -->
								<Popover
									id={slotsMenuId}
									float
									placement="bottom-start"
									width="auto"
									class="w-72 max-w-[80vw] p-0"
									label="Draft slots"
									triggerClass="inline-flex items-center gap-1 rounded-full bg-[var(--ui-bg-accented)] px-2.5 py-1 text-[11px] font-bold text-[var(--ui-text)] transition hover:bg-primary-500/15 hover:text-primary-600"
									triggerActiveClass="bg-primary-500/15 text-primary-600"
								>
									{#snippet trigger()}
										<Icon name="i-lucide-save" class="size-3.5" />
										Slots
										{#if memeSlots.list.length}
											<span
												class="rounded-full bg-primary-500/15 px-1.5 font-mono text-[10px] text-primary-600"
											>
												{memeSlots.list.length}
											</span>
										{/if}
									{/snippet}
									<div class="max-h-64 overflow-y-auto p-1.5">
										{#if memeSlots.list.length}
											{#each memeSlots.list as slot (slot.id)}
												<div
													class="group flex items-center gap-1 rounded-lg px-1.5 py-1 transition hover:bg-[var(--ui-bg-muted)]"
												>
													<button
														type="button"
														onclick={() => void openSlot(slot.id)}
														disabled={busy || !!slotBusyId}
														title="Restore this work-in-progress"
														class="flex min-w-0 flex-1 items-center gap-2 text-left"
													>
														<Icon
															name={slotBusyId === slot.id
																? 'i-lucide-loader-circle'
																: 'i-lucide-history'}
															class="size-4 shrink-0 text-primary-600 {slotBusyId === slot.id
																? 'animate-spin'
																: ''}"
														/>
														<span class="min-w-0 flex-1">
															<span class="block truncate text-[12.5px] font-bold">
																{slot.label}
															</span>
															<span class="block text-[10.5px] text-[var(--ui-text-dimmed)]">
																{new Date(slot.savedAt).toLocaleDateString()} ·
																{slot.overlays.length} caption{slot.overlays.length === 1
																	? ''
																	: 's'}
																{slot.sfxCues.length
																	? ` · ${slot.sfxCues.length} cue${slot.sfxCues.length === 1 ? '' : 's'}`
																	: ''}
																{#if !slot.media}
																	· no media
																{/if}
															</span>
														</span>
													</button>
													<button
														type="button"
														onclick={() => removeSlot(slot.id)}
														aria-label={`Delete slot ${slot.label}`}
														class="grid size-6 shrink-0 place-items-center rounded-full text-[var(--ui-text-muted)] opacity-0 transition group-hover:opacity-100 hover:text-[var(--tone-error-text)] focus-visible:opacity-100"
													>
														<Icon name="i-lucide-trash-2" class="size-3.5" />
													</button>
												</div>
											{/each}
										{:else}
											<p class="px-2 py-3 text-center text-[12px] text-[var(--ui-text-muted)]">
												No slots yet — save a work-in-progress and pick it back up later.
											</p>
										{/if}
									</div>
									{#if memeSlots.list.length}
										<div class="border-t border-[var(--ui-border-muted)] p-1.5">
											<MenuDivider />
										</div>
									{/if}
									<div class="p-1.5 pt-0">
										{#if showSlotSave}
											<div class="flex items-center gap-1.5">
												<input
													type="text"
													value={slotName}
													maxlength="40"
													placeholder="Slot name"
													aria-label="Slot name"
													onkeydown={(e) => {
														if (e.key === 'Enter') void saveCurrentSlot();
														if (e.key === 'Escape') showSlotSave = false;
													}}
													class="h-8 min-w-0 flex-1 rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-2.5 text-[12.5px] font-semibold outline-none focus:border-primary-500/60"
												/>
												<button
													type="button"
													onclick={() => void saveCurrentSlot()}
													disabled={busy || !dirty}
													class="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-500 text-white transition hover:brightness-110 active:scale-95 disabled:opacity-40"
													aria-label="Save slot"
												>
													<Icon name="i-lucide-check" class="size-4" />
												</button>
											</div>
										{:else}
											<button
												type="button"
												onclick={() => (showSlotSave = true)}
												disabled={busy || !dirty}
												class="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-primary-500/12 text-[12px] font-bold text-primary-600 transition hover:bg-primary-500/20 active:scale-[0.98] disabled:opacity-40"
											>
												<Icon name="i-lucide-save" class="size-4" />
												Save work-in-progress
											</button>
										{/if}
									</div>
								</Popover>
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
							/>

							<!-- Image layers: PNG/GIF/JPEG drops as movable layers (rec #1).
							     Sources: local file, https URL, GIF library (as a sticker-sized
							     layer — NOT the base-media swap in the footer). -->
							<Popover
								id={imageMenuId}
								float
								placement="top-start"
								width="auto"
								label="Add an image layer"
								triggerClass="flex items-center gap-1 rounded-full bg-[var(--ui-bg-accented)] px-2.5 py-1 text-[11.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]"
								triggerActiveClass="bg-warm-500/15 text-warm-600"
							>
								{#snippet trigger()}
									<Icon name="i-lucide-image-plus" class="size-3.5" />
									Image
									{#if layerBusy}
										<Icon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
									{/if}
								{/snippet}
								<div class="w-auto max-w-[100vw] p-2">
									<div class="flex items-center gap-1">
										<button
											type="button"
											onclick={() => {
												// Playhead window on timed sources — same contract as
												// the picker's From device / GIF volley.
												pendingLayerAtMs = timelineActive ? Math.round(stageSeconds * 1000) : null;
												layerInput?.click();
											}}
											disabled={layerBusy}
											class="flex flex-1 items-center gap-1.5 rounded-lg bg-[var(--ui-bg-accented)] px-2.5 py-2 text-[11.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-50"
										>
											<Icon name="i-lucide-upload" class="size-3.5" />
											Upload file
										</button>
										<button
											type="button"
											onclick={(e) => {
												// keep the popover open — the global click-close would eat it
												e.stopPropagation();
												showLayerUrlForm = !showLayerUrlForm;
											}}
											disabled={layerBusy}
											class="flex flex-1 items-center gap-1.5 rounded-lg bg-[var(--ui-bg-accented)] px-2.5 py-2 text-[11.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-50"
										>
											<Icon name="i-lucide-link" class="size-3.5" />
											URL
										</button>
									</div>
									<!-- Insert another source from the stage itself: grab the current video
								     frame at the playhead and drop it in as a movable layer. -->
									{#if mediaKind === 'video'}
										<button
											type="button"
											onclick={() => void insertFrameLayer()}
											disabled={layerBusy || busy}
											title="Grab the frame at the playhead and add it as a movable image layer"
											class="mt-1.5 flex w-full items-center gap-1.5 rounded-lg bg-warm-500/10 px-2.5 py-2 text-[11.5px] font-bold text-warm-600 transition hover:bg-warm-500/20 disabled:opacity-50"
										>
											<Icon
												name={layerBusy ? 'i-lucide-loader-circle' : 'i-lucide-image-up'}
												class="size-3.5 {layerBusy ? 'animate-spin' : ''}"
											/>
											Frame from video @ {formatDuration(stageSeconds)}
										</button>
									{/if}
									{#if showLayerUrlForm}
										<!-- keydown-Enter (not a <form> submit) — popover panels unmount
										     on the global click-close before deferred submits fire. -->
										<div class="mt-1.5 flex items-center gap-1">
											<input
												type="url"
												inputmode="url"
												bind:value={layerUrl}
												placeholder="https://…/sticker.png"
												class="h-8 min-w-0 flex-1 rounded-full border border-[var(--ui-border-muted)] bg-transparent px-3 text-[11.5px] outline-none placeholder:text-[var(--ui-text-dimmed)] focus:border-warm-500"
												disabled={layerUrlBusy}
												onkeydown={(e) => {
													if (e.key === 'Enter') {
														e.preventDefault();
														void addLayerFromUrl();
													}
												}}
											/>
											<button
												type="button"
												class="flex h-8 shrink-0 items-center gap-1 rounded-full bg-warm-500/10 px-3 text-[11px] font-bold text-warm-600 transition hover:bg-warm-500/20 disabled:opacity-50"
												disabled={layerUrlBusy || !layerUrl.trim()}
												onclick={() => void addLayerFromUrl()}
											>
												<Icon
													name={layerUrlBusy ? 'i-lucide-loader-circle' : 'i-lucide-check'}
													class="size-3 {layerUrlBusy ? 'animate-spin' : ''}"
												/>
											</button>
										</div>
									{/if}
									<p
										class="mt-1.5 flex items-center gap-1 px-0.5 text-[10.5px] text-[var(--ui-text-dimmed)]"
									>
										<Icon name="i-lucide-sticker" class="size-3" />
										pick GIFs or transparent stickers — tap several, then Add
									</p>
									<!-- Multi-select for mass production: tap several stickers,
									     confirm once — each lands as a layer with a 2s window at
									     the playhead, staggered 250ms apart. -->
									<GifPicker
										multiple
										max={Math.max(1, MAX_IMAGE_OVERLAYS - imageLayers.length)}
										onpick={(g) => void addLayerFromGifLib(g)}
										onbrowse={() => {
											// Device browse joins the volley: playhead window (timed
											// sources), multi-select, 250ms stagger per file.
											pendingLayerAtMs = timelineActive ? Math.round(stageSeconds * 1000) : null;
											layerInput?.click();
										}}
										onpickmany={(gifs) => {
											const base = Math.round(stageSeconds * 1000);
											for (let i = 0; i < gifs.length; i++) {
												void addLayerFromGifLib(
													gifs[i]!,
													timelineActive ? base + i * 250 : undefined
												);
											}
										}}
									/>
									{#if imageLayers.length}
										<div class="mt-1.5 border-t border-[var(--ui-border-muted)] pt-1.5">
											<p
												class="mb-1 px-0.5 text-[10px] font-bold text-[var(--ui-text-dimmed)] uppercase"
											>
												Layers ({imageLayers.length}/{MAX_IMAGE_OVERLAYS})
											</p>
											<div class="flex flex-col gap-1">
												{#each imageLayers as layer, li (layer.id)}
													<div
														class="flex items-center gap-1.5 rounded-lg px-1.5 py-1 transition {selectedLayerId ===
														layer.id
															? 'bg-warm-500/15'
															: 'hover:bg-[var(--ui-bg-muted)]'}"
													>
														<button
															type="button"
															onclick={() => (selectedLayerId = layer.id)}
															class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
														>
															<span
																class="grid size-7 shrink-0 place-items-center overflow-hidden rounded-md bg-black/40"
															>
																{#if layerBitmaps.has(layer.src)}
																	<img
																		src={layerRenderSrcs.get(layer.src) ?? layer.src}
																		alt=""
																		class="max-h-full max-w-full"
																	/>
																{:else}
																	<Icon name="i-lucide-image" class="size-3.5 text-white/60" />
																{/if}
															</span>
															<span
																class="truncate text-[11px] font-semibold text-[var(--ui-text)]"
															>
																Layer {li + 1}
															</span>
														</button>
														<!-- Z-order: later layers paint on top — stack controls.
														     stopPropagation keeps the popover open (global click-close). -->
														<span class="flex shrink-0 items-center">
															<button
																type="button"
																onclick={(e) => {
																	e.stopPropagation();
																	moveLayerRow(layer.id, 1);
																}}
																disabled={busy || li === imageLayers.length - 1}
																aria-label={`Bring layer ${li + 1} forward`}
																title="Bring forward (on top)"
																class="grid size-5 place-items-center rounded-full text-[var(--ui-text-dimmed)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-30"
															>
																<Icon name="i-lucide-chevron-up" class="size-3" />
															</button>
															<button
																type="button"
																onclick={(e) => {
																	e.stopPropagation();
																	moveLayerRow(layer.id, -1);
																}}
																disabled={busy || li === 0}
																aria-label={`Send layer ${li + 1} backward`}
																title="Send backward (behind)"
																class="grid size-5 place-items-center rounded-full text-[var(--ui-text-dimmed)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-30"
															>
																<Icon name="i-lucide-chevron-down" class="size-3" />
															</button>
														</span>
														<!-- Layer timing (timed sources): chip toggles an edit row — same
														     model as caption windows; missing window = always visible. -->
														{#if timelineActive}
															<button
																type="button"
																onclick={(e) => {
																	// keep the popover open — the global click-close would eat it
																	e.stopPropagation();
																	layerTimingId = layerTimingId === layer.id ? null : layer.id;
																}}
																disabled={busy}
																aria-expanded={layerTimingId === layer.id}
																title="Show this layer only during part of the timeline"
																class="shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[9.5px] font-bold transition {layerTimingId ===
																	layer.id ||
																layer.startMs !== undefined ||
																layer.endMs !== undefined
																	? 'bg-emerald-500/15 text-emerald-600'
																	: 'text-[var(--ui-text-dimmed)] hover:text-[var(--ui-text)]'}"
															>
																{layer.startMs !== undefined || layer.endMs !== undefined
																	? `${((layer.startMs ?? 0) / 1000).toFixed(1)}–${layer.endMs !== undefined ? (layer.endMs / 1000).toFixed(1) : '∞'}s`
																	: 'always'}
															</button>
														{/if}
														<button
															type="button"
															onclick={() => removeLayer(layer.id)}
															aria-label={`Remove layer ${li + 1}`}
															class="grid size-6 shrink-0 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--tone-error-text)]"
														>
															<Icon name="i-lucide-x" class="size-3.5" />
														</button>
													</div>
													{#if timelineActive && layerTimingId === layer.id}
														<div
															class="mb-1 flex flex-wrap items-center gap-2 rounded-lg bg-[var(--ui-bg-accented)] px-2.5 py-2"
														>
															<label
																class="flex items-center gap-1.5 text-[10.5px] font-bold text-[var(--ui-text-muted)]"
															>
																Show from
																<input
																	type="number"
																	min="0"
																	step="0.1"
																	value={((layer.startMs ?? 0) / 1000).toFixed(1)}
																	oninput={(e) => {
																		const seconds = Number(
																			(e.currentTarget as HTMLInputElement).value
																		);
																		patchLayer(layer.id, {
																			startMs:
																				Number.isFinite(seconds) && seconds > 0
																					? Math.round(seconds * 1000)
																					: undefined
																		});
																	}}
																	class="w-16 rounded-md border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-1.5 py-0.5 text-center font-mono text-[11px] tabular-nums"
																/>
																s
															</label>
															<label
																class="flex items-center gap-1.5 text-[10.5px] font-bold text-[var(--ui-text-muted)]"
															>
																until
																<input
																	type="number"
																	min="0"
																	step="0.1"
																	value={layer.endMs !== undefined
																		? (layer.endMs / 1000).toFixed(1)
																		: ''}
																	placeholder="end"
																	oninput={(e) => {
																		const raw = (e.currentTarget as HTMLInputElement).value;
																		const seconds = Number(raw);
																		patchLayer(layer.id, {
																			endMs:
																				raw !== '' && Number.isFinite(seconds) && seconds > 0
																					? Math.round(seconds * 1000)
																					: undefined
																		});
																	}}
																	class="w-16 rounded-md border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-1.5 py-0.5 text-center font-mono text-[11px] tabular-nums"
																/>
																s
															</label>
															<button
																type="button"
																onclick={() =>
																	patchLayer(layer.id, { startMs: undefined, endMs: undefined })}
																class="ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold text-[var(--ui-text-muted)] transition hover:text-[var(--ui-text)]"
															>
																Always visible
															</button>
														</div>
													{/if}
												{/each}
											</div>
										</div>
									{/if}
								</div>
							</Popover>

							<!-- Look picker: one-tap color presets. Preview = CSS filter,
							     export = ctx.filter (same syntax) — WYSIWYG by construction. -->
							{#if looksAvailable}
								<MemeLookPicker id={lookMenuId} {lookId} onPick={(id) => (lookId = id)} />
							{/if}
						</div>
					{/snippet}

					{#snippet inspectorPane()}
						<!-- Inspector: export support, overlay list, composition, sound, publish -->
						<div class="flex min-w-0 flex-col gap-3">
							<!-- Selected image layer: precise resize + effects. -->
							{#if selectedLayer}
								{#key selectedLayer.id}
									<MemeLayerEditor
										layer={selectedLayer}
										index={imageLayers.findIndex((l) => l.id === selectedLayer.id) + 1}
										renderSrc={layerRenderSrcs.get(selectedLayer.src) ?? null}
										{busy}
										onPatch={(id, patch) => patchLayer(id, patch)}
										onRemove={(id) => removeLayer(id)}
									/>
								{/key}
							{/if}
							{#if !videoMemeSupported}
								<p
									class="flex items-center gap-1.5 rounded-lg bg-warm-500/10 px-2.5 py-2 text-[11.5px] font-semibold text-warm-500"
								>
									<Icon name="i-lucide-triangle-alert" class="size-3.5 shrink-0" />
									This browser can't export video memes — try Chrome/Edge, or start from a picture.
								</p>
							{/if}

							<!-- Overlay list -->
							{#if overlays.length}
								<div class="flex flex-col gap-2">
									{#each overlays as overlay, i (overlay.id)}
										<div
											class="rounded-xl border px-3 py-2.5 transition {selectedId === overlay.id
												? 'border-warm-500/50 bg-warm-500/[0.06]'
												: 'border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)]'}"
										>
											<div class="flex items-center gap-2">
												<span
													class="grid size-6 shrink-0 place-items-center rounded-full bg-warm-500/12 font-mono text-[10px] font-bold text-warm-500"
												>
													{i + 1}
												</span>
												<!-- The input always shows the RAW typed text ('Hi' stays 'Hi') —
												     only the STAGE applies the ALL-CAPS styling, so editing is
												     never visually mangled. -->
												<input
													value={overlay.text}
													maxlength={MAX_OVERLAY_CHARS}
													placeholder="Caption text…"
													aria-label={`Caption ${i + 1} text`}
													disabled={busy}
													oninput={(e) =>
														patchOverlay(overlay.id, {
															text: (e.currentTarget as HTMLInputElement).value
														})}
													onfocus={() => (selectedId = overlay.id)}
													class="min-w-0 flex-1 bg-transparent text-[13.5px] font-semibold text-[var(--ui-text)] outline-none placeholder:font-normal placeholder:text-[var(--ui-text-dimmed)]"
												/>
												<!-- Case quick-toggle, always visible: free-write (Aa) vs
												     classic ALL CAPS (AA) — one click, no selection needed. -->
												<button
													type="button"
													onclick={() => patchOverlay(overlay.id, { caps: !overlay.caps })}
													disabled={busy}
													aria-pressed={overlay.caps}
													title={overlay.caps
														? 'ALL CAPS on — click to keep your own casing'
														: 'Keeping your casing — click for ALL CAPS'}
													class="grid size-6 shrink-0 place-items-center rounded-full text-[10.5px] font-extrabold transition {overlay.caps
														? 'bg-warm-500/15 text-warm-500'
														: 'text-[var(--ui-text-dimmed)] hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]'} disabled:opacity-40"
												>
													{overlay.caps ? 'AA' : 'Aa'}
												</button>
												{#if mediaKind === 'video'}
													<button
														type="button"
														onclick={() => moveOverlay(overlay.id, -0.05)}
														disabled={busy}
														aria-label="Move caption up"
														class="grid size-6 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] disabled:opacity-40"
													>
														<Icon name="i-lucide-chevron-up" class="size-3.5" />
													</button>
													<button
														type="button"
														onclick={() => moveOverlay(overlay.id, 0.05)}
														disabled={busy}
														aria-label="Move caption down"
														class="grid size-6 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] disabled:opacity-40"
													>
														<Icon name="i-lucide-chevron-down" class="size-3.5" />
													</button>
												{/if}
												<!-- Z-order (2+ captions): later slots paint on top. -->
												{#if overlays.length > 1}
													<button
														type="button"
														onclick={() => moveOverlayRow(overlay.id, 1)}
														disabled={busy || i === overlays.length - 1}
														aria-label={`Stack caption ${i + 1} on top`}
														title="Bring forward (paints on top)"
														class="grid size-6 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] disabled:opacity-30"
													>
														<Icon name="i-lucide-bring-to-front" class="size-3.5" />
													</button>
													<button
														type="button"
														onclick={() => moveOverlayRow(overlay.id, -1)}
														disabled={busy || i === 0}
														aria-label={`Send caption ${i + 1} backward`}
														title="Send backward (paints behind)"
														class="grid size-6 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] disabled:opacity-30"
													>
														<Icon name="i-lucide-send-to-back" class="size-3.5" />
													</button>
												{/if}
												<button
													type="button"
													onclick={() => removeOverlay(overlay.id)}
													disabled={busy}
													aria-label={`Remove caption ${i + 1}`}
													class="grid size-6 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--tone-error-text)]/10 hover:text-[var(--tone-error-text)] disabled:opacity-40"
												>
													<Icon name="i-lucide-x" class="size-3.5" />
												</button>
											</div>
											{#if selectedId === overlay.id}
												<div class="mt-2 flex flex-wrap items-center gap-1.5">
													<!-- Font -->
													{#each MEME_FONTS as font (font)}
														<button
															type="button"
															onclick={() => patchOverlay(overlay.id, { font })}
															disabled={busy}
															class="rounded-full px-2 py-0.5 text-[10.5px] font-bold transition {overlay.font ===
															font
																? 'bg-warm-500 text-white'
																: 'bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
														>
															{font}
														</button>
													{/each}
													<span class="mx-1 h-4 w-px bg-[var(--ui-border-muted)]"></span>
													<!-- Colors -->
													{#each MEME_COLORS as color (color)}
														<button
															type="button"
															onclick={() => patchOverlay(overlay.id, { color })}
															disabled={busy}
															aria-label={`Text color ${color}`}
															class="grid size-5 place-items-center rounded-full border border-black/20 transition hover:scale-110 {overlay.color ===
															color
																? 'ring-2 ring-warm-500 ring-offset-1 ring-offset-[var(--ui-bg-muted)]'
																: ''}"
															style={`background:${color}`}
														></button>
													{/each}
													<!-- Custom color: any hex via the native picker; shows the
													     current color when it's outside the preset palette. -->
													<label
														class="relative grid size-5 cursor-pointer place-items-center overflow-hidden rounded-full border border-dashed transition hover:scale-110 {isCustomCaptionColor(
															overlay.color
														)
															? 'border-warm-500 ring-2 ring-warm-500 ring-offset-1 ring-offset-[var(--ui-bg-muted)]'
															: 'border-[var(--ui-border-accented)]'}"
														title="Custom text color"
														style={isCustomCaptionColor(overlay.color)
															? `background:${overlay.color};`
															: ''}
													>
														{#if !isCustomCaptionColor(overlay.color)}
															<Icon
																name="i-lucide-pipette"
																class="size-3 text-[var(--ui-text-muted)]"
															/>
														{/if}
														<input
															type="color"
															value={/^#[0-9a-f]{6}$/i.test(overlay.color)
																? overlay.color
																: '#ffffff'}
															disabled={busy}
															aria-label="Custom text color"
															class="absolute inset-0 size-full cursor-pointer opacity-0"
															oninput={(e) => {
																const color = (e.currentTarget as HTMLInputElement).value;
																if (/^#[0-9a-f]{6}$/i.test(color))
																	patchOverlay(overlay.id, { color });
															}}
														/>
													</label>
													<span class="mx-1 h-4 w-px bg-[var(--ui-border-muted)]"></span>
													<button
														type="button"
														onclick={() => patchOverlay(overlay.id, { caps: !overlay.caps })}
														disabled={busy}
														aria-pressed={overlay.caps}
														class="rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase transition {overlay.caps
															? 'bg-warm-500/15 text-warm-500'
															: 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
													>
														Aa
													</button>
													<button
														type="button"
														onclick={() => patchOverlay(overlay.id, { stroke: !overlay.stroke })}
														disabled={busy}
														aria-pressed={overlay.stroke}
														title="Classic outline around the letters"
														class="rounded-full px-2 py-0.5 text-[10.5px] font-bold transition {overlay.stroke
															? 'bg-warm-500/15 text-warm-500'
															: 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
													>
														Ⓞ
													</button>
													<button
														type="button"
														onclick={() => patchOverlay(overlay.id, { bar: !overlay.bar })}
														disabled={busy}
														aria-pressed={overlay.bar}
														title="Contrast bar behind the text"
														class="rounded-full px-2 py-0.5 text-[10.5px] font-bold transition {overlay.bar
															? 'bg-warm-500/15 text-warm-500'
															: 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
													>
														▬
													</button>
													<!-- Size slider -->
													<input
														type="range"
														min="3"
														max="22"
														step="1"
														value={Math.round(overlay.size * 100)}
														oninput={(e) =>
															patchOverlay(overlay.id, {
																size: Number((e.currentTarget as HTMLInputElement).value) / 100
															})}
														disabled={busy}
														aria-label={`Caption ${i + 1} size`}
														class="h-1.5 min-w-16 flex-1 accent-[var(--color-warm-500)]"
													/>
													{#if timelineActive}
														<button
															type="button"
															onclick={() => (fxId = fxId === overlay.id ? null : overlay.id)}
															disabled={busy}
															aria-expanded={fxId === overlay.id}
															title="Motion effect — pop, fade, shake or spin, baked into the export"
															class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold transition {fxId ===
																overlay.id ||
															(overlay.fx && overlay.fx !== 'none')
																? 'bg-primary-500/15 text-primary-600'
																: 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
														>
															<Icon name="i-lucide-wand-sparkles" class="size-3" />
															{overlay.fx && overlay.fx !== 'none' ? overlay.fx : 'fx'}
														</button>
													{/if}
													{#if timelineActive && fxId === overlay.id}
														<div
															class="mt-2 flex flex-wrap items-center gap-1 rounded-lg bg-[var(--ui-bg-accented)] px-2 py-1.5"
														>
															{#each MEME_FX_OPTIONS as opt (opt.id)}
																<button
																	type="button"
																	onclick={() => {
																		patchOverlay(overlay.id, { fx: opt.id });
																		fxId = null;
																	}}
																	title={opt.hint}
																	class="rounded-full px-2 py-0.5 text-[10.5px] font-bold transition {(overlay.fx ??
																		'none') === opt.id
																		? 'bg-primary-500 text-white'
																		: 'bg-[var(--ui-bg)] text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
																>
																	{opt.label}
																</button>
															{/each}
														</div>
													{/if}
													{#if mediaKind === 'video'}
														<button
															type="button"
															onclick={() =>
																(timingId = timingId === overlay.id ? null : overlay.id)}
															disabled={busy}
															aria-expanded={timingId === overlay.id}
															title="Show this caption only during part of the video"
															class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold transition {timingId ===
																overlay.id ||
															overlay.startMs !== undefined ||
															overlay.endMs !== undefined
																? 'bg-warm-500/15 text-warm-500'
																: 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
														>
															<Icon name="i-lucide-timer" class="size-3" />
															{overlay.startMs !== undefined || overlay.endMs !== undefined
																? `${((overlay.startMs ?? 0) / 1000).toFixed(1)}–${overlay.endMs !== undefined ? (overlay.endMs / 1000).toFixed(1) : '∞'}s`
																: 'always'}
														</button>
													{/if}
													{#if mediaKind === 'video' && timingId === overlay.id}
														<div
															class="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-[var(--ui-bg-accented)] px-2.5 py-2"
														>
															<label
																class="flex items-center gap-1.5 text-[10.5px] font-bold text-[var(--ui-text-muted)]"
															>
																Show from
																<input
																	type="number"
																	min="0"
																	step="0.1"
																	value={((overlay.startMs ?? 0) / 1000).toFixed(1)}
																	oninput={(e) => {
																		const seconds = Number(
																			(e.currentTarget as HTMLInputElement).value
																		);
																		patchOverlay(overlay.id, {
																			startMs:
																				Number.isFinite(seconds) && seconds > 0
																					? Math.round(seconds * 1000)
																					: undefined
																		});
																	}}
																	class="w-16 rounded-md border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-1.5 py-0.5 text-center font-mono text-[11px] tabular-nums"
																/>
																s
															</label>
															<label
																class="flex items-center gap-1.5 text-[10.5px] font-bold text-[var(--ui-text-muted)]"
															>
																until
																<input
																	type="number"
																	min="0"
																	step="0.1"
																	value={overlay.endMs !== undefined
																		? (overlay.endMs / 1000).toFixed(1)
																		: ''}
																	placeholder="end"
																	oninput={(e) => {
																		const raw = (e.currentTarget as HTMLInputElement).value;
																		const seconds = Number(raw);
																		patchOverlay(overlay.id, {
																			endMs:
																				raw !== '' && Number.isFinite(seconds) && seconds > 0
																					? Math.round(seconds * 1000)
																					: undefined
																		});
																	}}
																	class="w-16 rounded-md border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-1.5 py-0.5 text-center font-mono text-[11px] tabular-nums"
																/>
																s
															</label>
															<button
																type="button"
																onclick={() =>
																	patchOverlay(overlay.id, {
																		startMs: undefined,
																		endMs: undefined
																	})}
																class="ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold text-[var(--ui-text-muted)] transition hover:text-[var(--ui-text)]"
															>
																Always visible
															</button>
														</div>
													{/if}
												</div>
											{/if}
										</div>
									{/each}
								</div>
							{:else}
								<button
									type="button"
									onclick={() => applyTemplate(TEMPLATES[0])}
									disabled={busy}
									class="flex items-center gap-2 rounded-xl border-2 border-dashed border-[var(--ui-border-accented)] px-3.5 py-3 text-left transition hover:border-warm-500/60 hover:bg-[var(--ui-bg-muted)] disabled:opacity-40"
								>
									<Icon name="i-lucide-letter-text" class="size-5 shrink-0 text-warm-500" />
									<span>
										<span class="block text-[13px] font-bold text-[var(--ui-text)]"
											>Add captions</span
										>
										<span class="block text-[11px] text-[var(--ui-text-muted)]">
											Start with the classic top/bottom template or add your own
										</span>
									</span>
								</button>
							{/if}

							<!-- Caption -->
							<div
								class="rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3.5 py-3 transition focus-within:border-warm-500 focus-within:bg-[var(--ui-bg)] focus-within:ring-2 focus-within:ring-warm-500/20"
							>
								<textarea
									bind:value={caption}
									rows="2"
									maxlength={HARD_CAP}
									placeholder="Write a caption… #hashtags and @mentions work"
									aria-label="Meme caption"
									readonly={busy}
									class="w-full resize-none bg-transparent text-[15px] leading-relaxed text-[var(--ui-text)] outline-none placeholder:text-[var(--ui-text-dimmed)]"
								></textarea>
								{#if caption.length > SOFT_CAP - 50}
									<p
										class="text-right text-[10.5px] font-bold tabular-nums {caption.length >
										HARD_CAP
											? 'text-[var(--tone-error-text)]'
											: overSoft
												? 'text-warm-500'
												: 'text-[var(--ui-text-dimmed)]'}"
									>
										{caption.length} / {overSoft ? HARD_CAP : SOFT_CAP}
									</p>
								{/if}
							</div>

							<!-- Artboard: the output canvas. `source` keeps the media's own
							     frame; presets cover-fit (crop to fill) — the stage preview
							     mirrors the choice live, overlays land identically on any. -->
							{#if mediaKind}
								<div
									class="rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-border-muted)] px-3.5 py-3"
								>
									<div class="flex items-center justify-between gap-2">
										<p
											class="flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
										>
											<Icon name="i-lucide-frame" class="size-3.5" />
											Artboard
										</p>
										<p class="font-mono text-[11px] font-bold text-warm-600 tabular-nums">
											{renderTarget.width}×{renderTarget.height}
										</p>
									</div>
									<div class="mt-2 flex flex-wrap items-center gap-1.5">
										{#each ARTBOARDS as ab (ab.id)}
											<button
												type="button"
												disabled={busy}
												onclick={() => setArtboard(ab.id)}
												aria-pressed={artboardId === ab.id}
												title={ab.hint}
												class="h-7 rounded-full px-2.5 font-mono text-[11px] font-bold tabular-nums transition {artboardId ===
												ab.id
													? 'bg-warm-500 text-white'
													: 'bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]'} disabled:opacity-40"
											>
												{ab.label}
											</button>
										{/each}
									</div>
									{#if artboardId !== 'source'}
										<p class="mt-1.5 text-[10.5px] leading-snug text-[var(--ui-text-dimmed)]">
											Media cover-fits the {artboardId} canvas — the preview's crop is the export's crop.
										</p>
									{/if}
									<!-- Background: swap the base media to a solid-color canvas at
									     the artboard's size. Swatches + a native custom color picker;
									     captions/layers/sounds survive the swap (keepLayout). -->
									<div class="mt-2 flex flex-wrap items-center gap-1.5">
										<span class="text-[10.5px] font-bold text-[var(--ui-text-muted)]">Bg</span>
										{#each BLANK_CANVAS_COLORS as color (color)}
											<button
												type="button"
												disabled={busy || gifStageBusy}
												aria-label={`Set the background to ${color}`}
												title={color}
												onclick={() => void applyBackgroundColor(color)}
												class="size-6 rounded-full border transition hover:scale-110 active:scale-95 {blankBg ===
												color
													? 'ring-2 ring-warm-500 ring-offset-1'
													: ''} border-black/10 disabled:opacity-40 dark:border-white/20"
												style="background:{color};"
											></button>
										{/each}
										<label
											class="relative grid size-6 cursor-pointer place-items-center overflow-hidden rounded-full border border-dashed border-[var(--ui-border-accented)] transition hover:scale-110"
											title="Custom background color"
										>
											<Icon name="i-lucide-pipette" class="size-3 text-[var(--ui-text-muted)]" />
											<input
												type="color"
												class="absolute inset-0 size-full cursor-pointer opacity-0"
												aria-label="Custom background color"
												disabled={busy || gifStageBusy}
												oninput={(e) => {
													const color = (e.currentTarget as HTMLInputElement).value;
													if (/^#[0-9a-f]{6}$/i.test(color)) void applyBackgroundColor(color);
												}}
											/>
										</label>
									</div>
									<p class="mt-1.5 text-[10px] leading-snug text-[var(--ui-text-dimmed)]">
										A color replaces the media with a blank canvas — captions, layers and sounds
										stay.
									</p>
								</div>
							{/if}

							<!-- Frame strip (dialog mode — the full layout shows it in the
								     pinned transport bar instead, next to the timeline). -->
							{#if stripFrames && !full}
								<VideoFrameStrip
									durationSec={meta?.duration ?? 0}
									thumbUrls={frameThumbs}
									playheadSec={scrubSec}
									{trimStartSec}
									{trimEndSec}
									posterSec={posterAtSec}
									posterUrl={posterDataUrl}
									{busy}
									onScrub={scrubTo}
									onPickPoster={(sec) => void pickPosterAt(sec)}
								/>
							{/if}

							<!-- Trim + speed (video sources): export window + rate. Playhead buttons scrub the preview to set marks precisely. -->
							{#if mediaKind === 'video' && meta?.duration}
								<div
									class="rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-border-muted)] px-3.5 py-3"
								>
									<div class="flex items-center justify-between gap-2">
										<p
											class="flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
										>
											<Icon name="i-lucide-scissors" class="size-3.5" />
											Trim &amp; speed
										</p>
										<p class="text-[11px] font-bold text-warm-600 tabular-nums">
											{formatDuration(trimDuration)} @ {playbackRate}× → {formatDuration(
												exportDurationSec
											)}
										</p>
									</div>
									<div class="mt-2 flex flex-wrap items-center gap-1.5">
										<input
											type="number"
											min="0"
											max={meta.duration}
											step="0.1"
											value={trimStartSec.toFixed(1)}
											oninput={(e) => {
												const v = Number((e.currentTarget as HTMLInputElement).value);
												trimStartSec = Number.isFinite(v)
													? Math.min(Math.max(0, v), meta?.duration ?? 0)
													: 0;
											}}
											disabled={busy}
											aria-label="Trim start seconds"
											class="h-8 w-20 rounded-lg border border-[var(--ui-border-muted)] bg-transparent px-2 text-[11.5px] tabular-nums outline-none focus:border-warm-500"
										/>
										<input
											type="number"
											min="0"
											max={meta.duration}
											step="0.1"
											value={(trimEndSec ?? meta.duration).toFixed(1)}
											oninput={(e) => {
												const v = Number((e.currentTarget as HTMLInputElement).value);
												trimEndSec =
													Number.isFinite(v) && v > 0 ? Math.min(v, meta?.duration ?? v) : null;
											}}
											disabled={busy}
											aria-label="Trim end seconds"
											class="h-8 w-20 rounded-lg border border-[var(--ui-border-muted)] bg-transparent px-2 text-[11.5px] tabular-nums outline-none focus:border-warm-500"
										/>
										<button
											type="button"
											disabled={busy}
											onclick={() => {
												trimStartSec = Math.max(
													0,
													Math.min(
														stageSeconds,
														(trimEndSec ?? meta?.duration ?? stageSeconds) - 0.1
													)
												);
											}}
											title="Set the start mark at the playhead"
											class="h-8 rounded-lg bg-[var(--ui-bg-accented)] px-2.5 text-[11px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-40"
										>
											Start = playhead
										</button>
										<button
											type="button"
											disabled={busy}
											onclick={() => {
												trimEndSec = Math.max(stageSeconds, trimStartSec + 0.1);
											}}
											title="Set the end mark at the playhead"
											class="h-8 rounded-lg bg-[var(--ui-bg-accented)] px-2.5 text-[11px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-40"
										>
											End = playhead
										</button>
										<select
											bind:value={playbackRate}
											disabled={busy}
											aria-label="Playback speed"
											class="h-8 rounded-lg border border-[var(--ui-border-muted)] bg-transparent px-2 text-[11.5px] font-bold outline-none focus:border-warm-500"
										>
											{#each [0.5, 0.75, 1, 1.25, 1.5, 2] as rate (rate)}
												<option value={rate}>{rate}×</option>
											{/each}
										</select>
										<button
											type="button"
											disabled={busy}
											onclick={() => {
												trimStartSec = 0;
												trimEndSec = null;
												playbackRate = 1;
											}}
											class="h-8 rounded-lg px-2.5 text-[11px] font-semibold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-40"
										>
											Reset
										</button>
										{#if stageVideo}
											<button
												type="button"
												disabled={busy}
												onclick={() => {
													stageVideo!.currentTime = trimStartSec;
													stageVideo!.playbackRate = playbackRate;
													void stageVideo!.play();
												}}
												title="Preview the trimmed window at speed"
												class="h-8 rounded-lg bg-warm-500/10 px-2.5 text-[11px] font-bold text-warm-600 transition hover:bg-warm-500/20 disabled:opacity-40"
											>
												<Icon name="i-lucide-play" class="mr-1 inline size-3" />
												Preview cut
											</button>
										{/if}
									</div>
									<!-- Length presets (user request: “set time 5s / 10s / 30s…”): set
									     the window's length from the current start mark; caps at the
									     source's remaining time and the 90s video-meme limit. -->
									<div class="mt-2 flex flex-wrap items-center gap-1.5">
										<span class="text-[10.5px] font-bold text-[var(--ui-text-dimmed)]">
											Length
										</span>
										{#each [5, 10, 15, 30, 60] as n (n)}
											<button
												type="button"
												disabled={busy}
												onclick={() => setTrimLength(n)}
												aria-pressed={Math.abs(trimDuration - n) < 0.05}
												title={`Make the export window ${n}s long from the start mark`}
												class="h-7 rounded-full px-2.5 text-[11px] font-bold tabular-nums transition {Math.abs(
													trimDuration - n
												) < 0.05
													? 'bg-warm-500 text-white'
													: 'bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]'} disabled:opacity-40"
											>
												{n}s
											</button>
										{/each}
										<label
											class="flex items-center gap-1 text-[10.5px] font-bold text-[var(--ui-text-dimmed)]"
										>
											custom
											<input
												type="number"
												min="0.5"
												step="0.5"
												value={trimDuration.toFixed(1)}
												disabled={busy}
												aria-label="Custom window length in seconds"
												onkeydown={(e) => {
													if (e.key === 'Enter') {
														e.preventDefault();
														(e.currentTarget as HTMLInputElement).blur();
													}
												}}
												onchange={(e) =>
													setTrimLength(Number((e.currentTarget as HTMLInputElement).value))}
												class="h-7 w-16 rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-1.5 text-center font-mono text-[11px] tabular-nums outline-none focus:border-warm-500"
											/>
											s
										</label>
										<span
											class="ml-auto text-[10px] font-semibold text-[var(--ui-text-dimmed)] tabular-nums"
										>
											source {formatDuration(meta.duration)}
										</span>
									</div>
									{#if exportDurationSec > MAX_VIDEO_MEME_SECONDS}
										<p
											class="mt-2 flex items-center gap-1 text-[11px] font-bold text-[var(--tone-error-text)]"
										>
											<Icon name="i-lucide-triangle-alert" class="size-3.5" />
											Cut is {formatDuration(exportDurationSec)} — over the {MAX_VIDEO_MEME_SECONDS}s
											cap
										</p>
									{/if}
								</div>
							{/if}

							<!-- Sound effects (animated sources, or static once a cue exists) -->
							{#if mediaKind}
								<div
									class="rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3.5 py-3"
								>
									<!-- Compact sound toolbar: label + status chips on one line, actions as
								     chips — the long explanations move into tooltips so the card stays tight. -->
									<div class="flex flex-wrap items-center gap-1.5">
										<p
											class="mr-auto flex min-w-0 items-center gap-1.5 text-[11px] font-bold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
										>
											<Icon name="i-lucide-audio-lines" class="size-3.5 shrink-0" />
											Sound
											{#if sfxCues.length}
												<span
													class="rounded-full bg-warm-500/15 px-1.5 font-mono text-[10px] font-bold text-warm-600 normal-case"
													>{sfxCues.length}</span
												>
											{/if}
											<!-- A static meme flips to a video export once it has cues — tiny badge,
											     full sentence in the tooltip. -->
											{#if mediaKind === 'image' && !animated && sfxCues.length === 0}
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
											onclick={() => (soundDialogOpen = true)}
											title="Browse, preview and fine-tune every sound cue"
											class="flex items-center gap-1 rounded-full bg-primary-500/10 px-2.5 py-1 text-[11px] font-bold text-primary-600 transition hover:bg-primary-500/20 disabled:opacity-40"
										>
											<Icon name="i-lucide-audio-lines" class="size-3.5" />
											Sound studio
										</button>
										<Popover
											id={sfxMenuId}
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
															previewSfx(sfxId);
															addSfxCue(sfxId);
														}}
													>
														{sfxLabels[sfxId]}
													</MenuItem>
												{/each}
												{#if soundLibrary.list.length}
													<MenuDivider />
													{#each soundLibrary.list as sound (sound.id)}
														<MenuItem
															onclick={() => {
																void previewSound(sound);
																addCustomCue(sound);
															}}
														>
															<span class="flex min-w-0 items-center gap-2">
																<Icon
																	name={sound.source === 'mic'
																		? 'i-lucide-mic'
																		: 'i-lucide-file-audio'}
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
																<!-- Library management rides along (share as kind-30078 /
																     delete) — no separate My-sounds surface needed. -->
																<span class="flex items-center">
																	<button
																		type="button"
																		class="rounded-md p-1 text-[var(--ui-text-dimmed)] transition hover:bg-[var(--ui-bg-muted)] hover:text-primary-600"
																		aria-label={`Share ${sound.label} with other creators`}
																		title="Publish as a kind-30078 shared sound"
																		disabled={sharingSoundId === sound.id || !!sharingSoundId}
																		onclick={(e) => {
																			e.stopPropagation();
																			void shareSound(sound);
																		}}
																	>
																		<Icon
																			name={sharingSoundId === sound.id
																				? 'i-lucide-loader-circle'
																				: 'i-lucide-share-2'}
																			class="size-3.5 {sharingSoundId === sound.id
																				? 'animate-spin'
																				: ''}"
																		/>
																	</button>
																	<button
																		type="button"
																		class="rounded-md p-1 text-[var(--ui-text-dimmed)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--tone-error-text)]"
																		aria-label={`Delete ${sound.label} from this device`}
																		title="Delete from this device"
																		onclick={(e) => {
																			e.stopPropagation();
																			removeSoundFromLibrary(sound.id);
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
												<MenuItem
													icon="i-lucide-upload"
													onclick={() => {
														soundFileInput?.click();
													}}
												>
													Import audio from device…
												</MenuItem>
												<MenuItem
													icon="i-lucide-mic"
													onclick={() => {
														void toggleMicRecording();
													}}
												>
													<span class="flex items-center gap-1">
														{recording ? 'Stop recording · save' : 'Record with mic…'}
														{#if micDenied && !recording}
															<Icon
																name="i-lucide-alert-circle"
																class="size-3 text-[var(--tone-error-text)]"
															/>
														{/if}
													</span>
												</MenuItem>
											</div>
										</Popover>
										<!-- Shared sounds (plan 17.1/17.2): pick CC-licensed sounds
										     other creators published as kind-30078 events; hash-verified import. -->
										<Popover
											id={sharedMenuId}
											float
											placement="top-start"
											width="auto"
											label="Shared sounds"
											triggerClass="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold text-primary-600 transition hover:bg-primary-500/10"
											triggerActiveClass="bg-primary-500/15"
										>
											{#snippet trigger()}
												<Icon name="i-lucide-globe-2" class="size-3.5" />
												Shared
											{/snippet}
											<button
												type="button"
												class="flex w-full items-center justify-center gap-1 rounded-lg px-3 py-1.5 text-[11.5px] font-semibold text-primary-600 transition hover:bg-primary-500/10"
												disabled={sharedLoading}
												onclick={() => void loadSharedSounds()}
											>
												<Icon
													name="i-lucide-refresh-cw"
													class="size-3.5 {sharedLoading ? 'animate-spin' : ''}"
												/>
												{sharedLoading ? 'Searching relays…' : 'Refresh'}
											</button>
											{#if sharedSounds.length}
												<MenuDivider />
												{#each sharedSounds as sound (sound.eventId)}
													<MenuItem
														onclick={() => {
															void importSharedSound(sound);
														}}
													>
														<span class="flex min-w-0 items-center gap-2">
															<Icon
																name="i-lucide-download"
																class="size-3.5 shrink-0 text-[var(--ui-text-dimmed)]"
															/>
															<span class="min-w-0">
																<span class="block truncate">{sound.label}</span>
																<span class="block text-[10.5px] text-[var(--ui-text-dimmed)]">
																	{sound.durationSec.toFixed(1)}s · {sound.license}
																	{#if sound.creatorPubkey === me?.pk}· yours{/if}
																</span>
															</span>
														</span>
														{#snippet trailing()}
															{#if sharedImportingId === sound.eventId}
																<Icon
																	name="i-lucide-loader-circle"
																	class="size-3.5 animate-spin text-primary-600"
																/>
															{:else if sound.sha256}
																<span
																	class="text-[10px] font-bold tracking-wide text-[var(--ui-text-dimmed)] uppercase"
																>
																	+ add
																</span>
															{:else}
																<Icon
																	name="i-lucide-shield-off"
																	class="size-3.5 text-[var(--ui-text-dimmed)]"
																	title="No content hash — cannot verify"
																/>
															{/if}
														{/snippet}
													</MenuItem>
												{/each}
											{/if}
										</Popover>
										<!-- #2 sound-timed captions: snap every caption window onto the cue sheet in order. -->
										{#if sfxCues.length && overlays.length}
											<button
												type="button"
												onclick={syncCaptionsToCues}
												disabled={busy}
												title="Each caption appears with its own sound cue"
												class="flex items-center gap-1 rounded-full bg-[var(--ui-bg-accented)] px-2.5 py-1 text-[11px] font-bold text-[var(--ui-text-muted)] transition hover:bg-warm-500/15 hover:text-warm-600 disabled:opacity-40"
											>
												<Icon name="i-lucide-captions" class="size-3.5" />
												Sync captions
											</button>
										{/if}
										<Popover
											id={suggestMenuId}
											float
											placement="top-start"
											width="auto"
											class="w-72 max-w-[80vw] p-0"
											label="Suggested timings"
											triggerClass="flex items-center gap-1 rounded-full bg-primary-500/10 px-2.5 py-1 text-[11px] font-bold text-primary-600 transition hover:bg-primary-500/20 disabled:opacity-40"
											triggerActiveClass="bg-primary-500/20 text-primary-600"
										>
											{#snippet trigger()}
												<Icon
													name={suggestBusy ? 'i-lucide-loader-circle' : 'i-lucide-sparkles'}
													class="size-3.5 {suggestBusy ? 'animate-spin' : ''}"
												/>
												Suggest
											{/snippet}
											<div class="p-1.5">
												<p
													class="px-2 pb-1.5 text-[11px] leading-snug text-[var(--ui-text-dimmed)]"
												>
													Local audio analysis → 3 editable timelines. Nothing leaves your device.
												</p>
												{#if !suggestionGroups.length}
													<button
														type="button"
														onclick={() => void buildSuggestions()}
														disabled={suggestBusy || busy}
														class="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-primary-500/12 text-[12px] font-bold text-primary-600 transition hover:bg-primary-500/20 active:scale-[0.98] disabled:opacity-40"
													>
														<Icon name="i-lucide-wand-sparkles" class="size-4" />
														{suggestBusy ? 'Analyzing…' : 'Generate 3 vibes'}
													</button>
												{:else}
													{#each suggestionGroups as group (group.intensity)}
														<button
															type="button"
															onclick={() => applySuggestion(group)}
															disabled={busy}
															class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-[var(--ui-bg-muted)]"
														>
															<span
																class="grid size-7 shrink-0 place-items-center rounded-full {group.intensity ===
																'chaos'
																	? 'bg-[var(--tone-error)]/15 text-[var(--tone-error-text)]'
																	: group.intensity === 'funny'
																		? 'bg-warm-500/15 text-warm-600'
																		: 'bg-primary-500/10 text-primary-600'}"
															>
																<Icon
																	name={group.intensity === 'chaos'
																		? 'i-lucide-bomb'
																		: group.intensity === 'funny'
																			? 'i-lucide-laugh'
																			: 'i-lucide-smile'}
																	class="size-4"
																/>
															</span>
															<span class="min-w-0 flex-1">
																<span class="block text-[12.5px] font-bold capitalize">
																	{group.intensity}
																</span>
																<span class="block text-[10.5px] text-[var(--ui-text-dimmed)]">
																	{group.overlays.length} captions · {group.sfxCues.length} cues
																	{group.zooms.length ? ` · ${group.zooms.length} zooms` : ''}
																</span>
															</span>
															<Icon
																name="i-lucide-arrow-right"
																class="size-4 shrink-0 text-[var(--ui-text-muted)]"
															/>
														</button>
													{/each}
													<MenuDivider />
													<button
														type="button"
														onclick={() => void buildSuggestions()}
														disabled={suggestBusy || busy}
														class="flex h-7 w-full items-center justify-center gap-1 rounded-lg text-[11px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-40"
													>
														<Icon name="i-lucide-refresh-cw" class="size-3.5" />
														Re-analyze
													</button>
												{/if}
											</div>
										</Popover>
									</div>
									{#if sfxCues.length}
										<ul class="mt-2 flex flex-col gap-1">
											{#each sfxCues as cue (cue.id)}
												<li
													class="flex items-center justify-between gap-2 rounded-lg bg-[var(--ui-bg)] px-2.5 py-1.5 text-[12px]"
												>
													<span class="flex items-center gap-1.5 font-semibold">
														<Icon name={cueIcon(cue)} class="size-3.5 text-warm-500" />
														{cueLabel(cue)}
														<!-- Time chip doubles as a seek: jump the playhead to the cue. -->
														<button
															type="button"
															disabled={busy || !timelineActive}
															title="Jump the playhead to this cue"
															onclick={() => scrubPreview(cue.atMs / 1000)}
															class="rounded-full bg-[var(--ui-bg-muted)] px-1.5 py-px font-mono text-[10.5px] font-bold text-[var(--ui-text-muted)] tabular-nums transition hover:bg-warm-500/15 hover:text-warm-600 disabled:opacity-40"
														>
															@ {formatDuration(cue.atMs / 1000)}
														</button>
													</span>
													<span class="flex items-center gap-1">
														<button
															type="button"
															class="rounded-md p-1 text-[var(--ui-text-dimmed)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]"
															aria-label={`Preview ${cueLabel(cue)}`}
															onclick={() => {
																if (cue.sfx === CUSTOM_SOUND_KEY) {
																	const sound = soundLibrary.list.find((s) => s.id === cue.soundId);
																	if (sound) void previewSound(sound);
																} else {
																	previewSfx(cue.sfx);
																}
															}}
														>
															<Icon name="i-lucide-play" class="size-3.5" />
														</button>
														<button
															type="button"
															class="rounded-md p-1 text-[var(--ui-text-dimmed)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--tone-error-text)]"
															aria-label={`Remove ${cueLabel(cue)}`}
															onclick={() => removeSfxCue(cue.id)}
														>
															<Icon name="i-lucide-x" class="size-3.5" />
														</button>
													</span>
												</li>
											{/each}
										</ul>
									{:else}
										<p
											class="mt-1.5 text-[11px] text-[var(--ui-text-dimmed)]"
											title="Cue a sound at the playhead — it gets mixed into the export. All synthesized, no licensing headaches."
										>
											No cues yet — tap “Cue @” or press 1–9.
										</p>
									{/if}
								</div>
							{/if}

							<!-- Options row -->
							<div class="flex flex-wrap items-center gap-1.5">
								<Popover
									id={destMenuId}
									float
									placement="top-start"
									width="auto"
									label="Post destination"
									triggerClass="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold transition {destination ===
									'bitz'
										? 'text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]'
										: 'bg-primary-500/10 text-primary-600'}"
									triggerActiveClass="bg-primary-500/10 text-primary-600"
								>
									{#snippet trigger()}
										<Icon
											name={destination === 'story'
												? 'i-lucide-circle-dot-dashed'
												: destination === 'note'
													? 'i-lucide-message-square-text'
													: 'i-lucide-clapperboard'}
											class="size-4"
										/>
										{destination === 'story'
											? 'To story · 24h'
											: destination === 'note'
												? 'To note'
												: 'To Bitz feed'}
									{/snippet}
									{#each DESTINATIONS as dest (dest.id)}
										<MenuItem
											icon={dest.icon}
											tone={destination === dest.id ? 'accent' : 'default'}
											onclick={() => (destination = dest.id)}
										>
											<div class="min-w-0">
												<div>{dest.label}</div>
												<div class="text-[11px] font-medium text-[var(--ui-text-dimmed)]">
													{dest.hint}
												</div>
											</div>
											{#snippet trailing()}
												{#if destination === dest.id}
													<Icon name="i-lucide-check" class="size-4 shrink-0" />
												{/if}
											{/snippet}
										</MenuItem>
									{/each}
								</Popover>
								<button
									type="button"
									onclick={() => (sensitive = !sensitive)}
									aria-pressed={sensitive}
									title="Mark as sensitive content"
									class="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold transition disabled:opacity-40 {sensitive
										? 'bg-warm-500/15 text-warm-500'
										: 'text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]'}"
								>
									<Icon name="i-lucide-eye-off" class="size-4" />
									Sensitive
								</button>
								<button
									type="button"
									onclick={() => (showPow = !showPow)}
									disabled={busy}
									aria-pressed={showPow}
									title="Mine a rare meme — NIP-13 proof of work"
									class="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold transition disabled:pointer-events-none disabled:opacity-40 {showPow
										? 'bg-primary-500/10 text-primary-600'
										: 'text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]'}"
								>
									<Icon name="i-lucide-gem" class="size-4" />
									Rare meme
								</button>
								<!-- Remix rights picker (S-013): advisory license stamped on
								     publish — readers see it, the network never enforces it. -->
								<label
									class="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]"
									title="Remix rights — advisory license for this bitz"
								>
									<Icon name="i-lucide-scale" class="size-4" />
									<select
										bind:value={license}
										disabled={busy}
										class="cursor-pointer appearance-none bg-transparent text-[12px] font-bold outline-none"
										aria-label="Remix rights license"
									>
										{#each LICENSE_OPTIONS as opt (opt.code)}
											<option value={opt.code}>{opt.label}</option>
										{/each}
									</select>
								</label>
								<!-- AI-004 provenance: opt-in `ai` tag on publish. Manual toggle —
								     stamp it when AI suggestions helped build this meme. -->
								<button
									type="button"
									onclick={() => (aiAssisted = !aiAssisted)}
									disabled={busy}
									aria-pressed={aiAssisted}
									title="AI-assisted — adds an `ai` provenance tag so clients can badge it"
									class="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold transition disabled:pointer-events-none disabled:opacity-40 {aiAssisted
										? 'bg-primary-500/10 text-primary-600'
										: 'text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]'}"
								>
									<Icon name="i-lucide-sparkles" class="size-4" />
									{aiAssisted ? 'AI-assisted ✓' : 'AI-assisted'}
								</button>
								<!-- Value-split editor (CRE-008, section 7.2): opt-in manifest
								     declaring how future monetization would flow. Publish is gated on an
								     exact 10,000-bps total - V1 stores/displays only, no payment execution. -->
								<button
									type="button"
									onclick={() => (splitsOpen = !splitsOpen)}
									disabled={busy}
									aria-pressed={splitsOpen}
									title="Value splits - who gets paid when this bitz earns"
									class="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold transition disabled:pointer-events-none disabled:opacity-40 {splitsOpen
										? 'bg-primary-500/10 text-primary-600'
										: 'text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]'}"
								>
									<Icon name="i-lucide-git-fork" class="size-4" />
									Splits {splitRows.length ? `(${splitRows.length})` : ''}
								</button>
								{#if splitsOpen}
									<div
										class="flex w-full flex-col gap-2 rounded-xl bg-[var(--ui-bg-muted)]/60 p-3 text-left"
									>
										{#each splitRows as row, i (i)}
											<div class="flex items-center gap-2">
												<select
													bind:value={row.role}
													disabled={busy}
													aria-label="Split role"
													class="min-w-0 flex-1 cursor-pointer appearance-none rounded-lg bg-[var(--ui-bg)] px-2 py-1 text-[12px] font-semibold outline-none"
												>
													{#each SPLIT_ROLES as role (role)}
														<option value={role}>{role.replace(/_/g, ' ')}</option>
													{/each}
												</select>
												<input
													type="number"
													bind:value={row.basisPoints}
													min="0"
													max="10000"
													step="50"
													disabled={busy}
													aria-label="Share in basis points"
													class="w-24 rounded-lg bg-[var(--ui-bg)] px-2 py-1 text-right text-[12px] font-semibold outline-none"
												/>
												<span class="text-[11px] font-bold text-[var(--ui-text-muted)]">bps</span>
												<button
													type="button"
													onclick={() => removeSplitRow(row.role, row.beneficiary)}
													disabled={busy}
													aria-label="Remove split row"
													class="rounded-lg p-1 text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg)] hover:text-[var(--ui-text)]"
												>
													<Icon name="i-lucide-x" class="size-4" />
												</button>
											</div>
										{/each}
										<button
											type="button"
											onclick={addSplitRow}
											disabled={busy}
											class="self-start rounded-full px-3 py-1 text-[12px] font-bold text-primary-600 transition hover:bg-primary-500/10"
										>
											+ Add row
										</button>
										<p
											class="text-[11px] font-bold {splitRows.length === 0 || splitCheck.ok
												? 'text-[var(--ui-text-muted)]'
												: 'text-primary-600'}"
										>
											{splitTotal.toLocaleString()} / {TOTAL_BASIS_POINTS.toLocaleString()} bps
											{#if splitRows.length > 0 && !splitCheck.ok}
												- {splitCheck.error}
											{/if}
										</p>
									</div>
								{/if}
								<Popover
									id={providerMenuId}
									float
									placement="top-start"
									width="lg"
									label="Upload provider"
									triggerClass="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]"
									triggerActiveClass="bg-primary-500/10 text-primary-600"
								>
									{#snippet trigger()}
										<Icon name="i-lucide-cloud-upload" class="size-4 text-primary-500" />
										<span class="max-w-[110px] truncate"
											>{providerLabel(
												selectedProvider === 'none' ? 'server' : selectedProvider
											)}</span
										>
									{/snippet}
									<MenuItem
										icon="i-lucide-hard-drive-upload"
										onclick={() => (selectedProvider = 'none')}
										tone={selectedProvider === 'none' ? 'accent' : 'default'}
									>
										BitOS uploads
										{#snippet trailing()}
											{#if selectedProvider === 'none'}
												<Icon name="i-lucide-check" class="size-4 shrink-0" />
											{/if}
										{/snippet}
									</MenuItem>
									<MenuDivider />
									{#each MEDIA_PROVIDERS as provider (provider.id)}
										<MenuItem
											icon={provider.icon}
											disabled={!media.isConfigured(provider.id)}
											tone={selectedProvider === provider.id ? 'accent' : 'default'}
											onclick={() => (selectedProvider = provider.id)}
										>
											<div class="min-w-0">
												<div>{provider.label}</div>
												<div class="text-[11px] font-medium text-[var(--ui-text-dimmed)]">
													{media.isConfigured(provider.id)
														? provider.description
														: 'Configure this provider in Settings first'}
												</div>
											</div>
											{#snippet trailing()}
												{#if selectedProvider === provider.id}
													<Icon name="i-lucide-check" class="size-4 shrink-0" />
												{/if}
											{/snippet}
										</MenuItem>
									{/each}
								</Popover>
							</div>

							{#if showPow && destination !== 'story'}
								<PowCard
									bind:pow
									mining={phase === 'mining'}
									progress={powProgress}
									oncancel={() => mineController?.abort()}
								/>
							{/if}

							<p class="flex items-center gap-1.5 text-[11px] text-[var(--ui-text-dimmed)]">
								<Icon name="i-lucide-globe" class="size-3.5 shrink-0 text-primary-500" />
								{#if destination === 'story'}
									Publishes a 24h story (kind 30315) — video memes loop in the story viewer.
								{:else if destination === 'note'}
									Publishes a kind-1 note with the meme attached as standard media — renders in
									every Nostr client.
								{:else}
									Publishes to {writeRelayCount}
									{writeRelayCount === 1 ? 'relay' : 'relays'} — a standard
									{kindInfo?.nip ?? 'Nostr'} event with captions burned in.
								{/if}
							</p>
						</div>
					{/snippet}

					{#if full}
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
						<div
							class="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden"
						>
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
						<!-- Pinned transport bar: timeline + the keyboard layer. Collapsible —
						     hide it to hand the whole viewport to the stage (chevron, top-right). -->
						<div
							class="relative shrink-0 border-t border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)]/40 px-3 py-2 sm:px-4"
						>
							<button
								type="button"
								onclick={() => (timelineCollapsed = !timelineCollapsed)}
								aria-expanded={!timelineCollapsed}
								aria-label={timelineCollapsed ? 'Show timeline' : 'Hide timeline'}
								title={timelineCollapsed ? 'Show the timeline' : 'Hide the timeline — more stage'}
								class="absolute top-1.5 right-2 z-10 grid size-6 place-items-center rounded-full text-[var(--ui-text-dimmed)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]"
							>
								<Icon
									name={timelineCollapsed ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'}
									class="size-4"
								/>
							</button>
							{#if timelineCollapsed}
								<p
									class="py-1 text-center text-[10.5px] font-semibold text-[var(--ui-text-dimmed)]"
								>
									Timeline hidden — Space still plays · {timelineActive
										? 'chevron to reopen'
										: 'add a sound cue to unlock it'}
								</p>
							{:else}
								{#if stripFrames && full}
									<!-- Video frame strip rides the transport bar in the full layout: scrub,
								     pick the poster, see the trim window — right under the timeline. -->
									<VideoFrameStrip
										durationSec={meta?.duration ?? 0}
										thumbUrls={frameThumbs}
										playheadSec={scrubSec}
										{trimStartSec}
										{trimEndSec}
										posterSec={posterAtSec}
										posterUrl={posterDataUrl}
										{busy}
										onScrub={scrubTo}
										onPickPoster={(sec) => void pickPosterAt(sec)}
									/>
								{/if}
								{#if timelineActive}
									{@render timelinePane()}
								{:else}
									<p
										class="py-1.5 text-center text-[10.5px] font-semibold text-[var(--ui-text-dimmed)]"
									>
										Static meme — add a sound cue to unlock the timeline
									</p>
								{/if}
								<p
									class="mt-1.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[9.5px] font-semibold text-[var(--ui-text-dimmed)]"
								>
									<span class="flex items-center gap-1"
										><kbd
											class="rounded border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-1 py-px font-mono text-[9px] font-bold text-[var(--ui-text-muted)]"
											>Space</kbd
										> play / pause</span
									>
									<span class="flex items-center gap-1"
										><kbd
											class="rounded border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-1 py-px font-mono text-[9px] font-bold text-[var(--ui-text-muted)]"
											>←</kbd
										><kbd
											class="rounded border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-1 py-px font-mono text-[9px] font-bold text-[var(--ui-text-muted)]"
											>→</kbd
										> nudge playhead</span
									>
									<span class="flex items-center gap-1"
										><kbd
											class="rounded border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-1 py-px font-mono text-[9px] font-bold text-[var(--ui-text-muted)]"
											>1</kbd
										>–<kbd
											class="rounded border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-1 py-px font-mono text-[9px] font-bold text-[var(--ui-text-muted)]"
											>9</kbd
										> cue a sound</span
									>
									<span class="flex items-center gap-1"
										><kbd
											class="rounded border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-1 py-px font-mono text-[9px] font-bold text-[var(--ui-text-muted)]"
											>Ctrl ↵</kbd
										> publish</span
									>
									<span class="flex items-center gap-1"
										><kbd
											class="rounded border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-1 py-px font-mono text-[9px] font-bold text-[var(--ui-text-muted)]"
											>M</kbd
										> preview sound</span
									>
								</p>
							{/if}
						</div>
					{:else}
						<!-- Dialog layout: 260px stage column + stacked controls -->
						<div
							class="grid gap-4 p-4 sm:grid-cols-[minmax(0,260px)_minmax(0,1fr)] sm:gap-5 sm:p-5"
						>
							{#if remixSource}
								<!-- Lineage chip: this project derives from a remixed bitz; the
							     published event will carry remix + meme tags crediting it. -->
								<div
									class="mb-4 flex items-center gap-2 rounded-full bg-warm-500/10 px-3 py-1.5 text-[12px] font-semibold text-warm-600 sm:col-span-2"
								>
									<Icon name="i-lucide-repeat" class="size-3.5 shrink-0" />
									<span class="truncate"
										>Remix of “{remixLabel}” · captions &amp; sounds credited via remix tags</span
									>
								</div>
							{/if}
							{@render stagePane()}
							<div class="flex min-w-0 flex-col gap-4">
								{#if timelineActive}
									{@render timelinePane()}
								{/if}
								{@render toolsPane()}
								{@render inspectorPane()}
							</div>
						</div>
					{/if}
				{/if}
			</div>

			<!-- Footer -->
			{#if file}
				<footer
					class="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--ui-border-muted)] px-4 py-3"
				>
					<div class="flex min-w-0 items-center gap-2 text-[11px] text-[var(--ui-text-dimmed)]">
						<Icon name="i-lucide-info" class="size-3.5 shrink-0" />
						<span class="truncate">
							{overlays.length} caption{overlays.length === 1 ? '' : 's'} ·
							{kindInfo?.label ?? 'Meme'}
							{#if mediaKind}{renderTarget.width}×{renderTarget.height}{:else if meta}{meta.width}×{meta.height}{/if}
						</span>
					</div>
					<!-- Output format: Auto infers from the source; the explicit
					     options re-render the SAME composition as image / true GIF /
					     video. Publish rides the same choice. -->
					<div
						class="hidden items-center gap-0.5 rounded-full bg-[var(--ui-bg-muted)] p-0.5 sm:flex"
						role="group"
						aria-label="Output format"
					>
						{#each [{ id: 'auto', label: 'Auto', hint: 'Infer from the source media' }, { id: 'image', label: 'Image', hint: 'JPEG still of the current frame' }, { id: 'gif', label: 'GIF', hint: 'True looping .gif (image or GIF base)' }, { id: 'video', label: 'Video', hint: 'Recorded video with sound' }] as fmt (fmt.id)}
							{@const disabled =
								fmt.id === 'gif' && mediaKind === 'video'
									? 'GIF export needs an image or GIF base'
									: fmt.id === 'video' && !canRenderVideoMeme()
										? 'This browser cannot record video'
										: ''}
							<button
								type="button"
								disabled={busy || !!disabled}
								onclick={() => (exportFormat = fmt.id as typeof exportFormat)}
								aria-pressed={exportFormat === fmt.id}
								title={disabled || fmt.hint}
								class="rounded-full px-2.5 py-1 text-[11px] font-bold transition {exportFormat ===
								fmt.id
									? 'bg-[var(--ui-bg)] text-[var(--ui-text)] shadow-sm'
									: disabled
										? 'cursor-not-allowed text-[var(--ui-text-dimmed)] opacity-50'
										: 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
							>
								{fmt.label}
							</button>
						{/each}
					</div>
					<div class="flex items-center gap-2">
						<button
							type="button"
							onclick={requestClose}
							disabled={busy}
							class="h-9 rounded-full px-4 text-[13px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-40"
						>
							Cancel
						</button>
						<!-- Export to file: same render pipeline as publish, saved locally —
						     nothing hits a relay. -->
						<button
							type="button"
							onclick={() => void exportFile()}
							disabled={!file || busy}
							title="Render and download the meme as a file — same output as publishing"
							class="inline-flex h-9 items-center gap-2 rounded-full border border-[var(--ui-border-muted)] px-4 text-[13px] font-bold text-[var(--ui-text)] transition hover:border-warm-500/50 hover:bg-warm-500/10 hover:text-warm-600 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
						>
							<Icon name="i-lucide-download" class="size-4" />
							<span class="hidden sm:inline">Export</span>
						</button>
						<button
							type="button"
							onclick={() => void submit()}
							disabled={!canPost || busy}
							class="inline-flex h-9 items-center gap-2 rounded-full bg-warm-500 px-5 text-[13px] font-bold text-white transition hover:brightness-110 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
						>
							{#if busy}
								<Icon name="i-lucide-loader-circle" class="size-4 animate-spin" />
								{progressLabel || 'Working…'}
							{:else}
								<Icon name="i-lucide-send" class="size-4" />
								{destination === 'story'
									? 'Post story'
									: destination === 'note'
										? 'Post note'
										: 'Publish meme'}
							{/if}
						</button>
					</div>
				</footer>
			{/if}
		</div>

		<!-- Discard confirmation -->
		{#if confirmDiscard}
			<div class="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4">
				<div class="surface-card w-full max-w-xs rounded-2xl p-5 text-center">
					<Icon
						name={discardIntent === 'new' ? 'i-lucide-file-plus' : 'i-lucide-trash-2'}
						class="mx-auto size-8 {discardIntent === 'new'
							? 'text-warm-500'
							: 'text-[var(--tone-error-text)]'}"
					/>
					<h3 class="mt-2 text-[15px] font-bold">
						{discardIntent === 'new' ? 'Start a new meme?' : 'Discard this meme?'}
					</h3>
					<p class="mt-1 text-[12.5px] text-[var(--ui-text-muted)]">
						{discardIntent === 'new'
							? 'The canvas resets — media, captions, sounds and remix lineage are cleared.'
							: 'Captions and the chosen media will be lost.'}
					</p>
					<div class="mt-4 flex gap-2">
						<button
							type="button"
							onclick={() => (confirmDiscard = false)}
							class="h-9 flex-1 rounded-full border border-[var(--ui-border-muted)] text-[13px] font-bold transition hover:bg-[var(--ui-bg-muted)]"
						>
							Keep editing
						</button>
						<button
							type="button"
							onclick={discard}
							class="h-9 flex-1 rounded-full {discardIntent === 'new'
								? 'bg-warm-500'
								: 'bg-[var(--tone-error-text)]'} text-[13px] font-bold text-white transition hover:brightness-110"
						>
							{discardIntent === 'new' ? 'Start over' : 'Discard'}
						</button>
					</div>
					<!-- Middle path: park the WIP in a slot instead of losing it. -->
					<button
						type="button"
						onclick={async () => {
							await saveCurrentSlot();
							startFresh();
						}}
						class="mt-2 h-9 w-full rounded-full bg-primary-500/10 text-[12.5px] font-bold text-primary-600 transition hover:bg-primary-500/20"
					>
						<Icon name="i-lucide-save" class="mr-1 inline size-3.5" />
						Save to slots instead{discardIntent === 'new' ? ', then start over' : ''}
					</button>
				</div>
			</div>
		{/if}
	</div>
{/if}

<input
	bind:this={fileInput}
	type="file"
	accept={pickFormat === 'all'
		? 'image/*,video/mp4,video/webm,video/quicktime,image/gif'
		: (PICK_FORMATS.find((f) => f.id === pickFormat)?.accept ?? 'image/*,video/*')}
	class="hidden"
	onchange={onFileInput}
/>
<input
	bind:this={layerInput}
	type="file"
	accept="image/png,image/gif,image/jpeg,image/webp"
	multiple
	class="hidden"
	onchange={onLayerFileInput}
/>
<input
	bind:this={queueInput}
	type="file"
	accept="image/*,video/mp4,video/webm,video/quicktime,image/gif"
	multiple
	class="hidden"
	onchange={onQueueInput}
/>
<input
	bind:this={soundFileInput}
	type="file"
	accept="audio/*"
	class="hidden"
	onchange={onSoundFileInput}
/>

<MemeSoundDialog
	bind:open={soundDialogOpen}
	bind:cues={sfxCues}
	labels={sfxLabels}
	durations={sfxDurations}
	libraryLabel={(soundId) => soundLibrary.list.find((s) => s.id === soundId)?.label}
	libraryDuration={(soundId) => soundLibrary.list.find((s) => s.id === soundId)?.durationSec}
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
	onAddSynth={(sfx) => addSfxCue(sfx)}
	onAddLibrary={(soundId) => addCustomCueById(soundId)}
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
