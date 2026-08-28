<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import Icon from '$lib/components/ui/Icon.svelte';
	import StudioSheet from './StudioSheet.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { media, MEDIA_PROVIDERS } from '$lib/stores/media.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { feed } from '$lib/nostr/feed.svelte';
	import { bitzHashLink } from '$lib/utils/bitz-links';
	import { stories } from '$lib/nostr/stories.svelte';
	import { memeSlots, type MemeSlotMedia } from '$lib/stores/meme-slots.svelte';
	import {
		createMemeDraftWriter,
		draftDrawingGroups,
		draftImageLayers,
		draftMediaFile,
		draftOverlays,
		draftSfxCues,
		MAX_DRAFT_BYTES,
		mediaToDraftDataUrl,
		readMemeDraft
	} from '$lib/stores/meme-drafts';
	import { MemeBatchQueue } from '$lib/stores/meme-batch-queue.svelte';
	import { powPrefs } from '$lib/stores/pow-prefs.svelte';
	import { aiAssistedTag } from '$lib/meme/ai-provenance';
	import {
		SPLIT_ROLES,
		TOTAL_BASIS_POINTS,
		splitsTagsFor,
		validateSplits,
		type SplitRow
	} from '$lib/meme/splits';
	import type { MediaProviderId } from '$lib/media/uploaders';
	import MemePostCaption from '$lib/components/bitz/MemePostCaption.svelte';
	import { rewriteMentions } from '$lib/utils/nip27';
	import type { TrackedMention } from '$lib/utils/mentions';
	import MemeDrawingSurface from '$lib/components/bitz/MemeDrawingSurface.svelte';
	import { BUDDY_FIGURES, type BuddyFigure } from '$lib/meme/bitz-buddy';
	import { BITZVERSE_PROPS } from '$lib/meme/bitzverse';
	import {
		imageOverlayVisibleAt,
		makeImageOverlay,
		type MemeImageOverlay
	} from '$lib/meme/image-overlay';
	import { LayerAssetCache } from '$lib/stores/meme-layer-assets.svelte';
	import { decodeGif, paintGifFrameAt, type DecodedGif } from '$lib/meme/gif';
	import GifPicker, { type GifChoice } from '$lib/components/feed/GifPicker.svelte';
	import { encodeAnimatedGif, type GifEncodeFrame } from '$lib/meme/gif-encode';
	import {
		MAX_DRAWING_GROUPS,
		makeDrawingStroke,
		normalizeDrawingGroups,
		paintDrawingGroups,
		type DrawingGroup,
		type DrawingTool
	} from '$lib/meme/drawing';
	import type { StudioSoundSeed } from '$lib/stores/studio-handoff.svelte';
	import {
		CUSTOM_SOUND_KEY,
		MAX_SFX_CUES,
		MEME_COLORS,
		makeOverlay,
		normalizeSfxCue,
		type MemeFont,
		type MemeSfxCue,
		type MemeSfxId,
		type MemeTextOverlay
	} from '$lib/meme/schema';
	import { SFX_BUCKETS, SFX_LABELS } from '$lib/meme/sound-catalog';
	import { soundLibrary, type LibrarySound } from '$lib/stores/meme-sounds.svelte';
	import { memeTemplates, type SavedMemeTemplate } from '$lib/stores/meme-templates.svelte';
	import { sharedTemplatesStore } from '$lib/stores/meme-shared-templates.svelte';
	import { templateMarketplace } from '$lib/stores/template-marketplace.svelte';
	import { TEMPLATE_CATEGORIES } from '$lib/meme/template-marketplace';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { shortKey } from '$lib/utils/format';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import NoteZapDialog from '$lib/components/feed/NoteZapDialog.svelte';
	import { soundIO } from '$lib/stores/meme-sound-io.svelte';
	import { libraryDecodeSound } from '$lib/meme/suggestion-audio';
	import { MEME_LOOKS, memeLookCss, memeLookOf, type MemeLookId } from '$lib/meme/look';
	import { STICKER_PACKS, isStickerOverlay, makeSticker } from '$lib/meme/stickers';
	import {
		canRenderVideoMeme,
		cueAudioTrack,
		paintMemeBase,
		recordMeme
	} from '$lib/meme/export-pipeline';
	import { exportErrorMessage } from '$lib/meme/export-support';
	import {
		DEFAULT_FX_INTENSITY,
		FRAME_FX_IDS,
		FRAME_FX_LABELS,
		MAX_FX_WINDOWS,
		normalizeFxWindows,
		type FrameFxId,
		type FrameFxWindow
	} from '$lib/meme/fx-track';
	import {
		composeZoomWithFraming,
		MAX_ZOOM_WINDOWS,
		normalizeZoomWindows,
		zoomTransformAt,
		type ZoomWindow
	} from '$lib/meme/zoom-track';
	import {
		MAX_SPEED_WINDOWS,
		mediaMsToExportMs,
		normalizeSpeedWindows,
		rateAt,
		shiftCuesForExportWithSpeeds,
		type SpeedWindow
	} from '$lib/meme/speed-track';
	import {
		paintImageOverlays,
		paintOverlay,
		targetSize,
		type MediaTransform
	} from '$lib/meme/render';
	import {
		remixTagsFor,
		rightsTagsFor,
		type RemixLicense,
		type RemixSource
	} from '$lib/meme/remix';
	import { fetchSourceFile } from '$lib/meme/source-fetch';
	import {
		ARTBOARDS,
		ARTBOARD_KEY,
		BLANK_CANVAS_COLORS,
		DESTINATIONS,
		LICENSE_OPTIONS,
		STAGE_ZOOM_KEY,
		TEMPLATES,
		type MemeArtboardId,
		type MemeDestination,
		type MemeStudioTemplate
	} from '$lib/components/bitz/meme-studio-config';
	import type { RemixHandoff } from '$lib/components/bitz/MemeStudio.svelte';

	/**
	 * StudioMobileEditor — the native-app-style mobile shell for the Meme
	 * Studio (docs/studio-mobile-ux.md, design: docs/ui/editor-mode.html).
	 *
	 * Phase 1: full-bleed canvas + mode switcher (Image/GIF/Video), glass quick
	 * tools, bottom sheets driven by the URL (`?panel=` / `?edit=` → hardware
	 * back closes the sheet), draggable overlays on the shared MemeTextOverlay
	 * schema, undo/redo, local media pick, handoff seeding (remix / template /
	 * WIP slot) and auto-save-to-slot on exit.
	 *
	 * Phase 2: format mode in the URL (`&fmt=`), per-overlay style sheet (text /
	 * color / font / size / outline / bar / caps), trim window + playback speed
	 * for video, and meme looks (`MEME_LOOKS` CSS filters) — all persisted in
	 * the WIP slot via the same fields the desktop studio uses.
	 *
	 * Phase 3: the publish flow (`?panel=publish`, docs/ui/edit3.html Screen 6)
	 * — caption + tag pills, destinations (bitz/story/note), remix license,
	 * sensitive toggle, and the real export→upload→broadcast pipeline with a
	 * full-screen progress overlay. Rendering reuses the studio's shared
	 * primitives (`paintMemeBase` / `paintOverlay` / `recordMeme`), publishing
	 * reuses `media.upload` + `feed.postBitz` / `stories.publish` / `feed.post`.
	 *
	 * Resume loop (completed): WIP slots restore their MEDIA too —
	 * `memeSlots.slotMediaFile()` resolves the IndexedDB blob every surface
	 * saves, staged through the same ownership path as a fresh pick so
	 * re-exit keeps the bytes and overwrites the same slot (`id` rides the
	 * resume; publishing clears it). Caption/sensitive/destinations and the
	 * effect tracks restore with it, and a Drafts sheet (`?panel=drafts`,
	 * docs/ui/edit2.html draft grid) resumes in place with thumbnails
	 * (`MemeSlotMedia.previewDataUrl`).
	 *
	 * Canvas (Phase 5 slice): `?panel=canvas` picks the shared `ARTBOARDS`
	 * presets + zoom/framing; the board drives the preview stage AND the
	 * burned export (renderTarget cover-fit, mirroring the desktop studio).
	 *
	 * Draw layer (Phase 5 slice): `?panel=draw` + the Draw quick tool stage the
	 * shared `MemeDrawingSurface` over the artboard (pen/marker/eraser and
	 * shapes, colors, size, stroke undo/redo/clear). Groups use the shared
	 * DrawingGroup schema (static playback on mobile), burn under the captions
	 * via `paintDrawingGroups`, persist in the WIP slot and restore on resume.
	 *
	 * Gestures (Phase 6 slice): pinch-on-overlay scales its `size` (one undo
	 * step per gesture; no invented rotation — schema parity), two-finger
	 * pinch on the stage zooms the framing 1–4× (persisted once, on release),
	 * and light `navigator.vibrate` haptics ride the key moments (create,
	 * delete, undo/redo, pinches, restore, publish success).
	 *
	 * Batch queue (Phase 5 slice, mass production): multi-picked files line
	 * up (thumbnail strip above the toolbar); publish or Skip loads the next
	 * source while the caption layout stays — caption once, publish N times,
	 * the exact loop the /studio home advertises. Same `MemeBatchQueue`
	 * mechanics as the desktop studio.
	 *
	 * Share-target (Phase 6 slice): an OS-shared file (`sharedFile` prop from
	 * the route — SW inbox → `?shared=1`) stages like a fresh pick whenever
	 * it lands after mount, as long as the canvas is still empty.
	 *
	 * Timeline (Phase 5/6 slice): cut-at-playhead (Keep ◀/▶ — the contiguous,
	 * non-destructive window the export burns), window reset, shaded trim
	 * window on the strip, and swipe-left on the stage advancing the batch
	 * queue (1× only, never over overlays/draw/pinch).
	 *
	 * Functional completion pass: background colors (blank-canvas swap in the
	 * Canvas sheet), sticker IMAGE layers (Bitz Buddy + Bitzverse catalogs —
	 * draggable, pinch-scalable, burned via `paintImageOverlays`), animated
	 * GIF bases (decoded + canvas-clock preview, silent → true .gif export,
	 * cued → recorder video), and the full publish form — the shared
	 * `MemePostCaption` (@mentions → NIP-27 entities, limits), upload
	 * provider picker, NIP-31 alt, AI-004 provenance and rare-bitz PoW
	 * (NIP-13 mining inside postBitz with live progress).
	 *
	 * It is a SHELL over the same model as the desktop MemeStudio — no
	 * duplicated stores or schema. Multi-clip timeline, batch queue and the
	 * bitz-video restyle land in the remaining Phase 5 scope (see the doc).
	 */

	type EditorMode = 'image' | 'gif' | 'video';
	type PanelId =
		| 'meme'
		| 'text'
		| 'sticker'
		| 'trim'
		| 'look'
		| 'publish'
		| 'audio'
		| 'canvas'
		| 'drafts'
		| 'draw'
		| 'gif'
		| 'fx'
		| 'templates';

	let {
		onexit,
		onposted,
		remixHandoff = null,
		templateHandoff = null,
		slotHandoff = null,
		soundHandoff = null,
		sharedFile = null
	}: {
		onexit: () => void;
		/** After a successful publish — the route sends the creator home. */
		onposted?: () => void;
		remixHandoff?: RemixHandoff | null;
		templateHandoff?: { id: string; overlays: MemeTextOverlay[] } | null;
		slotHandoff?: string | null;
		soundHandoff?: StudioSoundSeed | null;
		/** OS share-sheet pickup (PWA share_target): staged on arrival. */
		sharedFile?: File | null;
	} = $props();

	/* ------------------------------------------------------------------ *
	 * Editor state
	 * ------------------------------------------------------------------ */

	let overlays = $state<MemeTextOverlay[]>([]);
	let selectedId = $state<string | null>(null);
	let undoDepth = $state(0);
	let redoDepth = $state(0);

	/** Meme look (CSS filter) applied to the source media, not the captions. */
	let lookId = $state<MemeLookId>('none');
	/** Video window (seconds) + speed — the same fields MemeSlot persists. */
	let trimStart = $state(0);
	let trimEnd = $state<number | null>(null);
	let playbackRate = $state(1);
	/** Sound-effect cues staged against media time (same schema as desktop). */
	let sfxCues = $state<MemeSfxCue[]>([]);
	/** Artboard + framing (zoom/pan) — the same model as the desktop stage;
	 *  pan is normalized -1..1 within the zoom overflow, zoom 1–4. */
	let artboardId = $state<MemeArtboardId>('source');
	let zoom = $state(1);
	let pan = $state({ x: 0, y: 0 });

	/** Effect tracks riding the remix wire — same media-time convention as
	 *  the desktop studio (z/f/s keys). Seeded from the remix handoff, burned
	 *  into every export, re-published so lineage tracks survive mobile
	 *  remixes (previously mobile silently DROPPED them from the chain). */
	let zoomWindows = $state<ZoomWindow[]>([]);
	let fxWindows = $state<FrameFxWindow[]>([]);
	let speedWindows = $state<SpeedWindow[]>([]);

	/** Sticker image layers (Bitz Buddy figures + Bitzverse props): the shared
	 *  MemeImageOverlay schema, draggable + pinch-scalable on the stage and
	 *  burned by `paintImageOverlays`. Mobile adds them without ambient motion
	 *  (static preview = static export; desktop motion editing stays desktop). */
	let imageLayers = $state<MemeImageOverlay[]>([]);
	let selectedLayerId = $state<string | null>(null);
	/** Shared layer asset cache: cross-origin byte fetches (exports never
	 *  taint), animated-GIF decode + cached export painters — the exact
	 *  machinery the desktop studio runs. */
	const layerAssets = new LayerAssetCache();
	const layerBitmapFor = (src: string) => layerAssets.bitmaps.get(src) ?? null;

	async function cacheLayerBitmap(src: string): Promise<boolean> {
		return layerAssets.cacheBitmap(src, () => (imageLayers = [...imageLayers]));
	}

	/** Warm an animated layer: bitmap (preview/stills) + decode (exports). */
	async function cacheLayerAssets(src: string): Promise<void> {
		await cacheLayerBitmap(src);
		if (layerAssets.looksAnimatedMedia(src)) await layerAssets.cacheGif(src);
	}

	/** GIF library pick as a STICKER layer (Giphy stickers are transparent
	 *  cut-outs): the <img> preview animates natively, exports run the shared
	 *  gifLayerPainter through the asset cache — desktop parity. */
	function addGifLayer(gif: GifChoice) {
		if (imageLayers.length >= 24) {
			toasts.warning('Sticker layers cap out at 24');
			return;
		}
		const aspect = gif.width && gif.height ? gif.width / gif.height : 1;
		const layer = makeImageOverlay(gif.url, aspect, { index: imageLayers.length });
		if (!layer) return;
		imageLayers = [...imageLayers, layer];
		selectedLayerId = layer.id;
		selectedId = null;
		void cacheLayerAssets(gif.url);
		haptic();
	}

	function addBuddyLayer(figure: BuddyFigure) {
		if (imageLayers.length >= 24) {
			toasts.warning('Sticker layers cap out at 24');
			return;
		}
		const layer = makeImageOverlay(figure.src, 1, { index: imageLayers.length });
		if (!layer) return;
		imageLayers = [...imageLayers, layer];
		selectedLayerId = layer.id;
		selectedId = null;
		void cacheLayerBitmap(figure.src);
		haptic();
	}

	function removeLayer(id: string) {
		imageLayers = imageLayers.filter((l) => l.id !== id);
		if (selectedLayerId === id) selectedLayerId = null;
		haptic();
	}

	function patchLayer(id: string, patch: Partial<MemeImageOverlay>) {
		imageLayers = imageLayers.map((l) => (l.id === id ? { ...l, ...patch } : l));
	}

	/** Draw layer (`?panel=draw` + the Draw quick tool): the shared
	 *  DrawingGroup schema painted by `paintDrawingGroups` — same model as
	 *  the desktop studio, staged live by `MemeDrawingSurface`. Mobile groups
	 *  stay `static` playback (always visible); replay timing lands with the
	 *  multi-clip timeline. */
	let drawingGroups = $state<DrawingGroup[]>([]);
	let drawActive = $state(false);
	let drawingTool = $state<DrawingTool>('pen');
	let drawingColor = $state('#ffffff');
	/** Stroke width as a fraction of canvas height (desktop default). */
	let drawingWidth = $state(0.012);
	let drawingUndo: DrawingGroup[][] = [];
	let drawingRedo: DrawingGroup[][] = [];
	let drawingUndoDepth = $state(0);
	let drawingRedoDepth = $state(0);

	/** The WIP slot this canvas resumed (null = a fresh draft). Re-exit
	 *  overwrites the same slot instead of duplicating it; publishing
	 *  removes it (a finished meme is no longer work in progress). */
	let resumedSlotId = $state<string | null>(null);
	let resumedLabel = $state('');
	let resumedMedia = $state<MemeSlotMedia | null>(null);

	let stageEl = $state<HTMLDivElement | null>(null);
	/** Natural media size (for the `source` artboard's aspect + export size). */
	let mediaNatural = $state({ w: 0, h: 0 });

	const mediaTransform = $derived<MediaTransform>({ scale: zoom, x: pan.x, y: pan.y });
	/** Stage aspect ratio (w/h). Presets use their frame; `source` follows the
	 *  media itself (9:16 fallback until metadata loads). */
	const stageAspect = $derived.by(() => {
		const board = ARTBOARDS.find((a) => a.id === artboardId);
		if (board && board.w > 0 && board.h > 0) return board.w / board.h;
		if (mediaNatural.w > 0 && mediaNatural.h > 0) return mediaNatural.w / mediaNatural.h;
		return 9 / 16;
	});
	/** Export canvas dims — the artboard preset, or the source's own frame
	 *  capped (mirrors the desktop studio's `renderTarget` exactly, so the
	 *  preview stage and the burned export are the same shape). */
	const renderTarget = $derived.by(() => {
		const board = ARTBOARDS.find((a) => a.id === artboardId);
		if (board && board.w > 0) return { width: board.w, height: board.h };
		if (mediaNatural.w > 0 && mediaNatural.h > 0)
			return targetSize({ width: mediaNatural.w, height: mediaNatural.h });
		return { width: 1080, height: 1920 };
	});
	/** Even, non-zero canvas dims for the recorder (h.264 rejects odd edges). */
	function evenSize(size: { width: number; height: number }) {
		return {
			width: Math.max(2, size.width - (size.width % 2)),
			height: Math.max(2, size.height - (size.height % 2))
		};
	}

	/** Light haptic tick for native-feel feedback (no-op on unsupported
	 *  platforms — e.g. iOS Safari; Android + installed PWAs buzz). Accepts a
	 *  single duration or a buzz-pause pattern. */
	function haptic(pattern: number | number[] = 8) {
		try {
			navigator.vibrate?.(pattern);
		} catch {
			/* vibration blocked — purely optional feedback */
		}
	}

	/** Restore framing prefs (shared keys with the desktop studio). */
	$effect(() => {
		if (!browser) return;
		const savedZoom = Number(localStorage.getItem(STAGE_ZOOM_KEY));
		if (Number.isFinite(savedZoom) && savedZoom >= 1 && savedZoom <= 4) zoom = savedZoom;
		const savedBoard = localStorage.getItem(ARTBOARD_KEY) as MemeArtboardId | null;
		if (savedBoard && ARTBOARDS.some((a) => a.id === savedBoard)) artboardId = savedBoard;
	});

	function persistFraming() {
		if (!browser) return;
		try {
			localStorage.setItem(STAGE_ZOOM_KEY, String(zoom));
			localStorage.setItem(ARTBOARD_KEY, artboardId);
		} catch {
			/* prefs are best-effort */
		}
	}

	function setArtboard(id: MemeArtboardId) {
		artboardId = id;
		pan = { x: 0, y: 0 };
		persistFraming();
		haptic();
	}

	/** Active solid-color background (highlights the swatch when the base IS
	 *  the blank canvas; unknown after a resume). */
	let blankBg = $state<string | null>(null);

	/** Solid-color background: swap the base media to a blank canvas at the
	 *  artboard's size in the chosen color — captions, drawings, layers and
	 *  sound cues survive (the desktop studio's applyBackgroundColor). */
	async function applyBackgroundColor(color: string) {
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
			stageMediaFile(new File([blob], `blank-${Date.now()}.png`, { type: 'image/png' }));
			// A blank canvas IS the layout — keep everything editable on top.
			lookId = 'none';
			zoomWindows = [];
			fxWindows = [];
			speedWindows = [];
			trimStart = 0;
			trimEnd = null;
			selectedId = null;
			blankBg = color;
			haptic();
		} catch {
			toasts.error('Could not set that background color');
		}
	}

	function setZoom(next: number) {
		zoom = Math.min(4, Math.max(1, next));
		if (zoom === 1) pan = { x: 0, y: 0 };
		persistFraming();
	}

	/** Pan drag on the stage (zoomed-in framing). */
	let panDrag: { startX: number; startY: number; x: number; y: number } | null = null;

	/* Two-finger pinch on the stage background zooms the canvas framing
	 * (1–4×, the same `zoom` the Canvas sheet's slider drives — midpoint
	 * anchoring stays with the existing pan drag). */
	// Plain Map on purpose: raw pointer bookkeeping, never rendered.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const stagePointers = new Map<number, { x: number; y: number }>();
	let stagePinch: { baseDist: number; baseZoom: number } | null = null;
	/** Single-pointer swipe tracker (1× only) — see onStagePointerUp. */
	let swipe: { startX: number; startY: number; pointerId: number } | null = null;

	function stagePointerDist(): number {
		const pts = [...stagePointers.values()];
		return Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
	}

	function onStagePointerDown(event: PointerEvent) {
		if ((event.target as HTMLElement).closest('[data-overlay]')) return; // overlay owns it
		stagePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
		if (stagePointers.size === 2) {
			panDrag = null; // the gesture owns the stage now
			swipe = null;
			stagePinch = { baseDist: stagePointerDist(), baseZoom: zoom };
			haptic();
			return;
		}
		if (zoom <= 1) {
			// No pan at 1× — but a left swipe may still advance the batch queue
			// (Phase 6 swipe-between-clips), so track the gesture.
			swipe = { startX: event.clientX, startY: event.clientY, pointerId: event.pointerId };
			return;
		}
		panDrag = { startX: event.clientX, startY: event.clientY, x: pan.x, y: pan.y };
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function onStagePointerMove(event: PointerEvent) {
		if (stagePointers.has(event.pointerId))
			stagePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
		if (stagePinch) {
			if (stagePointers.size < 2) return;
			const scale = stagePointerDist() / Math.max(1, stagePinch.baseDist);
			zoom = Math.min(4, Math.max(1, stagePinch.baseZoom * scale));
			if (zoom === 1) pan = { x: 0, y: 0 };
			return;
		}
		if (!panDrag || !stageEl) return;
		const rect = stageEl.getBoundingClientRect();
		// Visual pan travel is pan * (zoom-1)/2 * size, so Δpan = Δpx * 2 / ((zoom-1) * size).
		const step = 2 / Math.max(0.001, zoom - 1);
		const nx = panDrag.x + ((event.clientX - panDrag.startX) / rect.width) * step;
		const ny = panDrag.y + ((event.clientY - panDrag.startY) / rect.height) * step;
		pan = { x: Math.min(1, Math.max(-1, nx)), y: Math.min(1, Math.max(-1, ny)) };
	}

	function onStagePointerUp(event: PointerEvent) {
		stagePointers.delete(event.pointerId);
		if (stagePinch) {
			if (stagePointers.size < 2) {
				stagePinch = null;
				persistFraming(); // one storage write after the gesture, not per frame
			}
			return;
		}
		// Swipe-between-clips: a decisive LEFT swipe on the stage background
		// (1×, not an overlay/draw/pinch) advances the batch queue — the
		// native-feel shortcut for the Skip button.
		const s = swipe;
		swipe = null;
		if (s && s.pointerId === event.pointerId && batch.remaining > 0) {
			const dx = event.clientX - s.startX;
			const dy = event.clientY - s.startY;
			if (dx < -60 && Math.abs(dx) > 2 * Math.abs(dy)) {
				void stageNextQueued().then((staged) => {
					if (!staged) return;
					haptic();
					toasts.info(
						batch.remaining > 0
							? `Next clip — ${batch.remaining} left in queue`
							: 'Last clip in the queue'
					);
				});
				return;
			}
		}
		panDrag = null;
	}

	/** Media in the canvas. `ownedUrl` marks blob: URLs this shell created. */
	let mediaUrl = $state<string | null>(null);
	let mediaKind = $state<'image' | 'video' | null>(null);
	let pickedFile: File | null = null;
	let ownedUrl: string | null = null;

	/** Undo/redo history (plain snapshots; depths carry reactivity). */
	const undoStack: MemeTextOverlay[][] = [];
	const redoStack: MemeTextOverlay[][] = [];

	let videoEl = $state<HTMLVideoElement | null>(null);
	let playing = $state(false);
	let currentTime = $state(0);
	let duration = $state(0);

	let canvasEl = $state<HTMLDivElement | null>(null);
	let fileInputEl = $state<HTMLInputElement | null>(null);

	/* Sheet inputs */
	let memeTop = $state('');
	let memeBottom = $state('');
	let memeFont = $state<MemeFont>('impact');
	let freeText = $state('');

	/* ------------------------------------------------------------------ *
	 * URL-driven state: `&fmt=` (mode), `?panel=` (sheets), `?edit=` (overlay
	 * style sheet) — all deep-linkable, reload-safe, and closed by the
	 * hardware back button. `fmt` uses replaceState (no history spam).
	 * ------------------------------------------------------------------ */

	const panelParam = $derived(page.url.searchParams.get('panel'));
	const panel = $derived<PanelId | null>(
		panelParam === 'meme' ||
			panelParam === 'text' ||
			panelParam === 'sticker' ||
			panelParam === 'trim' ||
			panelParam === 'look' ||
			panelParam === 'publish' ||
			panelParam === 'audio' ||
			panelParam === 'canvas' ||
			panelParam === 'drafts' ||
			panelParam === 'draw' ||
			panelParam === 'gif' ||
			panelParam === 'fx' ||
			panelParam === 'templates'
			? panelParam
			: null
	);
	const fmtParam = $derived(page.url.searchParams.get('fmt'));
	const mode = $derived<EditorMode>(
		fmtParam === 'image' || fmtParam === 'gif' || fmtParam === 'video'
			? fmtParam
			: mediaKind === 'video'
				? 'video'
				: 'image'
	);
	const editingId = $derived(page.url.searchParams.get('edit'));
	const editing = $derived(overlays.find((o) => o.id === editingId) ?? null);

	/** True between a pushed sheet and its pop — back() then closes the sheet. */
	let sheetPushed = false;

	/** Editor URL with one param changed; keeps `tab`/`shell`/`fmt` intact.
	 *  Param values are whitelist-only (no encoding needed), so the query is
	 *  assembled as a plain string — URLSearchParams is a mutable builtin. */
	function editorUrl(changes: {
		panel?: PanelId | null;
		edit?: string | null;
		layer?: string | null;
		fmt?: EditorMode;
	}) {
		const current = page.url.searchParams;
		const shell = current.get('shell');
		const fmt = changes.fmt ?? mode;
		const parts = [`tab=meme`, `fmt=${fmt}`];
		if (shell === 'app' || shell === 'full') parts.push(`shell=${shell}`);
		const panelNext = changes.panel !== undefined ? changes.panel : panel;
		if (panelNext) parts.push(`panel=${panelNext}`);
		// Layer + overlay style sheets are mutually exclusive deep-links.
		const editNext = changes.edit !== undefined ? changes.edit : null;
		if (editNext) parts.push(`edit=${editNext}`);
		const layerNext = changes.layer !== undefined ? changes.layer : null;
		if (layerNext) parts.push(`layer=${layerNext}`);
		return `/studio/create?${parts.join('&')}`;
	}

	/** Layer style sheet (`?layer=<id>` — second tap on a selected sticker). */
	const layerEditingId = $derived(page.url.searchParams.get('layer'));
	const layerEditing = $derived(imageLayers.find((l) => l.id === layerEditingId) ?? null);

	function openLayerEdit(id: string) {
		sheetPushed = true;
		void goto(editorUrl({ panel: null, edit: null, layer: id }), {
			keepFocus: true,
			noScroll: true
		});
	}

	function openPanel(next: PanelId) {
		sheetPushed = true;
		void goto(editorUrl({ panel: next, edit: null }), { keepFocus: true, noScroll: true });
	}

	function setMode(next: EditorMode) {
		if (next === mode) return;
		sheetPushed = false; // any open sheet is replaced away, not popped
		void goto(editorUrl({ fmt: next, panel: null, edit: null }), {
			keepFocus: true,
			noScroll: true,
			replaceState: true
		});
	}

	function openEdit(id: string) {
		snapshot(); // one undo step for the whole edit session
		sheetPushed = true;
		void goto(editorUrl({ panel: null, edit: id }), { keepFocus: true, noScroll: true });
	}

	/** Close whatever sheet is open (panel or edit) — back first, else replace. */
	function closeSheet() {
		if (publishBusy || pubPhase === 'done') return;
		if (sheetPushed) {
			sheetPushed = false;
			history.back();
		} else {
			void goto(editorUrl({ panel: null, edit: null, layer: null }), {
				keepFocus: true,
				noScroll: true,
				replaceState: true
			});
		}
	}

	$effect(() => {
		if (!panel && !editingId && !layerEditingId) sheetPushed = false;
	});

	/* ------------------------------------------------------------------ *
	 * Remix handoff (bitz page → mobile studio)
	 * ------------------------------------------------------------------ */

	/** True while the remix source streams in (progress scrim on the canvas). */
	let remixLoading = $state(false);
	/** Progress percent 0–100 (0 = still connecting / unknown length). */
	let remixLoadPercent = $state(0);
	/** What is downloading (handoff label) — shown in the scrim copy. */
	let remixLoadLabel = $state('');

	/** True while a WIP draft's media restores from project storage — the
	 *  canvas shows the same scrim as a remix load so the restore never
	 *  flashes a half-seeded stage. */
	let draftLoading = $state(false);
	let draftLabel = $state('');

	/** One shared loading scrim for both async seeds (remix fetch / draft
	 *  restore): kind varies the copy + progress treatment. */
	const loadingScrim = $derived(
		remixLoading
			? {
					kind: 'remix' as const,
					icon: 'i-lucide-wand-sparkles',
					label: remixLoadLabel || 'the remix source'
				}
			: draftLoading
				? { kind: 'draft' as const, icon: 'i-lucide-history', label: draftLabel }
				: null
	);

	/** Stage media bytes as the shell's current source (shared by the remix
	 *  seeder and the file picker so both own one blob-URL lifecycle). */
	function setMediaFile(file: File) {
		if (ownedUrl) URL.revokeObjectURL(ownedUrl);
		ownedUrl = URL.createObjectURL(file);
		pickedFile = file;
		mediaUrl = ownedUrl;
		mediaKind = file.type.startsWith('video/') ? 'video' : 'image';
		void decodeStagedGif(file);
	}

	/** Decoded animated GIF base (null for everything else). GIFs preview on
	 *  a canvas clock and export through the shared GIF encoder — a picked
	 *  .gif is NEVER frozen into its first frame. */
	let gif = $state<DecodedGif | null>(null);
	let gifCanvasEl = $state<HTMLCanvasElement | null>(null);
	/** GIF transport (the canvas clock): pause + scrub feed the timeline. */
	let gifPlaying = $state(true);
	/** Track-rows editor toggle under the timeline strip. */
	let tracksOpen = $state(false);

	async function decodeStagedGif(file: File) {
		gif?.close();
		gif = null;
		if (file.type !== 'image/gif') {
			// A plain still has no timeline clock — clear the GIF's leftovers.
			duration = 0;
			currentTime = 0;
			return;
		}
		try {
			const decoded = await decodeGif(await file.arrayBuffer());
			if (pickedFile === file && decoded.frames.length > 1) {
				gif = decoded;
				mediaNatural = { w: decoded.width, h: decoded.height };
				// The timeline's clock: cues, markers and scrubbing all share it.
				duration = decoded.duration;
				currentTime = 0;
				gifPlaying = true;
			} else {
				decoded.close();
			}
		} catch {
			toasts.warning('That GIF could not be decoded — it will publish as a still');
		}
	}

	/** Load the remix source through the shared fetcher (proxy retry + type +
	 *  size gates) instead of pointing <img>/<video> at the remote URL: cross-
	 *  origin elements used to render a blank canvas and taint exports. The
	 *  lineage + credit ride the publish tags exactly like the desktop studio. */
	async function seedRemixHandoff(handoff: RemixHandoff): Promise<void> {
		remixLoading = true;
		remixLoadPercent = 0;
		const label = handoff.label || 'a bitz';
		remixLoadLabel = label;
		const source = await fetchSourceFile(handoff.mediaUrl, {
			label: 'remix-source',
			accept: handoff.mediaType,
			onProgress: (percent) => (remixLoadPercent = percent)
		});
		remixLoading = false;
		if (!source.ok || !source.file) {
			toasts.warning(
				`${source.error ?? 'Could not load the source'} — pick your own clip to continue this remix`
			);
			return;
		}
		setMediaFile(source.file);
		// Fresh media ⇒ fresh trim; the LOOK + effect tracks ride the remix
		// wire (`l`/`z`/`f`/`s`) — a desktop meme's zoom/fx/speed survives a
		// mobile remix instead of silently vanishing from the lineage.
		lookId = memeLookOf(handoff.lookId);
		zoomWindows = normalizeZoomWindows(handoff.zoomWindows ?? []);
		fxWindows = normalizeFxWindows(handoff.fxWindows ?? []);
		speedWindows = normalizeSpeedWindows(handoff.speedWindows ?? []);
		trimStart = 0;
		trimEnd = null;
		if (handoff.overlays?.length)
			overlays = handoff.overlays
				.filter((o): o is MemeTextOverlay => !!o && typeof (o as MemeTextOverlay).text === 'string')
				.map((o) => ({ ...o, id: `${o.id}` }));
		remixSource = { eventId: handoff.eventId, pubkey: handoff.pubkey, relays: handoff.relays };
		sourceCredit = `remix of ${label}`.slice(0, 140);
	}

	/** Current remix lineage — publishes as remix + meme + attribution tags. */
	let remixSource = $state<RemixSource | null>(null);
	/** Attribution credit stamped on the publish (S-013 automatic credit). */
	let sourceCredit = $state('');

	/** Restore a WIP slot onto the canvas — a FULL resume, not a layout swap.
	 *  Media resolves through `memeSlots.slotMediaFile()` (IndexedDB blob or
	 *  data URL) and stages via the same ownership path as a fresh pick, so
	 *  `pickedFile` is set and re-saving keeps the bytes. The old restore was
	 *  dataUrl-only — every slot saved by `saveMediaFile` (blob-only) resumed
	 *  captions with NO media, and re-exit then dropped the media entirely. */
	async function seedSlotHandoff(slotId: string): Promise<void> {
		const slot = memeSlots.list.find((s) => s.id === slotId);
		if (!slot) return;
		draftLoading = true;
		draftLabel = slot.label;
		try {
			const mediaFile = await memeSlots.slotMediaFile(slot);
			if (mediaFile) {
				setMediaFile(mediaFile);
			} else if (slot.media) {
				toasts.warning('The saved media could not be restored — pick the source again');
			}
		} catch {
			toasts.warning('The saved media could not be restored — pick the source again');
		} finally {
			draftLoading = false;
		}
		overlays = slot.overlays.map((o) => ({ ...o }));
		sfxCues = slot.sfxCues.map((c) => ({ ...c }));
		imageLayers = slot.imageLayers.map((l) => ({ ...l }));
		for (const layer of imageLayers) void cacheLayerAssets(layer.src);
		lookId = memeLookOf(slot.lookId);
		zoomWindows = normalizeZoomWindows(slot.zoomWindows ?? []);
		fxWindows = normalizeFxWindows(slot.fxWindows ?? []);
		speedWindows = normalizeSpeedWindows(slot.speedWindows ?? []);
		if (slot.mediaKindValue === 'video') {
			trimStart = slot.trimStartSec;
			trimEnd = slot.trimEndSec;
			playbackRate = slot.playbackRate;
		} else {
			trimStart = 0;
			trimEnd = null;
			playbackRate = 1;
		}
		caption = slot.caption;
		sensitive = slot.sensitive;
		destinations = slot.destinations?.length ? [...slot.destinations] : [slot.destination];
		drawingGroups = normalizeDrawingGroups(slot.drawingGroups);
		drawingUndo = [];
		drawingRedo = [];
		drawingUndoDepth = 0;
		drawingRedoDepth = 0;
		resumedSlotId = slot.id;
		resumedLabel = slot.label;
		resumedMedia = slot.media;
		selectedId = null;
		toasts.info(`“${slot.label}” restored`);
		haptic(15);
	}

	/* ------------------------------------------------------------------ *
	 * Handoff seeding (one-shot, mirrors MemeStudio's latch pattern)
	 * ------------------------------------------------------------------ */

	let handoffApplied = false;
	$effect(() => {
		if (handoffApplied) return;
		handoffApplied = true;

		if (remixHandoff) {
			void seedRemixHandoff(remixHandoff);
			return;
		}
		if (slotHandoff) {
			void seedSlotHandoff(slotHandoff);
			return;
		}
		if (templateHandoff) {
			overlays = templateHandoff.overlays.map((o, i) => ({
				...o,
				id: `${templateHandoff.id}-${i}`
			}));
			return;
		}
		// No explicit handoff: crash/refresh recovery owns the canvas (F-010).
		void restoreAutoDraft();
	});

	/** Sound handoff (Sounds page “Use sound”): stage the picked synth sound
	 *  as the first cue — only on a clean cue sheet (mirrors the desktop). */
	let soundSeedApplied = false;
	$effect(() => {
		if (soundSeedApplied || !soundHandoff) return;
		soundSeedApplied = true;
		if (soundHandoff.kind !== 'synth' || sfxCues.length) return;
		addSfxCue(soundHandoff.id as MemeSfxId);
		toasts.info(
			`${soundHandoff.label ?? SFX_LABELS[soundHandoff.id as MemeSfxId]} staged at the playhead`,
			3500
		);
	});

	/** OS share-sheet pickup (PWA share_target → ?shared=1): the file lands
	 *  from the service worker's inbox shortly after mount (its stash write
	 *  races the cold-start navigation), so this latches whenever it arrives —
	 *  as long as the canvas is still empty (an explicit in-editor pick wins
	 *  over a stale share). */
	let sharedStaged = false;
	$effect(() => {
		if (sharedStaged || !sharedFile) return;
		sharedStaged = true;
		if (mediaUrl) return;
		stageMediaFile(sharedFile, { fresh: true });
		toasts.info('Shared media staged — caption it and publish', 3500);
		haptic(15);
	});

	/* ------------------------------------------------------------------ *
	 * Crash/refresh auto-recovery (plan F-010, shared with the desktop
	 * studio via MEME_DRAFT_KEY): a debounced auto-draft of the whole
	 * creative state; a refresh or crash restores it on next open. Explicit
	 * handoffs (remix/slot/template/share) own the canvas — never recovery.
	 * ------------------------------------------------------------------ */

	const draftWriter = createMemeDraftWriter();
	/** Serialized source media (small files only; videos usually exceed the
	 *  3.5 MB localStorage budget — those restore overlays-only, like desktop). */
	let draftMedia = $state<{ dataUrl: string; name: string; mimeType: string } | null>(null);

	$effect(() => {
		const file = pickedFile;
		draftMedia = null;
		if (!file || file.size > MAX_DRAFT_BYTES) return;
		void mediaToDraftDataUrl(file).then((m) => {
			if (m && pickedFile === file) draftMedia = m;
		});
	});

	$effect(() => {
		// Track the whole creative state (reads arm the effect).
		void overlays;
		void sfxCues;
		void imageLayers;
		void drawingGroups;
		void caption;
		void sensitive;
		void destinations;
		void lookId;
		void zoom;
		void pan;
		void trimStart;
		void trimEnd;
		void playbackRate;
		void draftMedia;
		// Never clobber a good draft with an empty canvas — the writer only
		// fires once there is something worth recovering.
		if (
			!draftMedia &&
			!overlays.length &&
			!sfxCues.length &&
			!imageLayers.length &&
			!drawingGroups.length &&
			!caption.trim()
		)
			return;
		draftWriter.write({
			media: draftMedia,
			overlays,
			caption,
			sensitive,
			destination: destinations[0] ?? 'bitz',
			destinations,
			selectedId,
			lookId,
			mediaTransform: { scale: zoom, x: pan.x, y: pan.y },
			sfxCues,
			imageLayers,
			drawingGroups,
			trimStartSec: trimStart,
			trimEndSec: trimEnd,
			playbackRate
		});
	});

	/** Flush pending writes on unmount (a crash skips this — localStorage
	 *  already holds the last debounce). */
	$effect(() => {
		return () => draftWriter.flush();
	});

	/** Restore the auto-draft once on mount — only when no explicit handoff
	 *  owns the canvas (the desktop studio's rule). */
	async function restoreAutoDraft(): Promise<void> {
		const draft = readMemeDraft();
		if (!draft) return;
		const overlays2 = draftOverlays(draft);
		const cues = draftSfxCues(draft);
		const layers = draftImageLayers(draft);
		const drawings = draftDrawingGroups(draft);
		const media = (await draftMediaFile(draft))?.file ?? null;
		if (media) {
			setMediaFile(media);
			blankBg = null;
			if (media.type === 'image/gif') void decodeStagedGif(media);
		}
		overlays = overlays2;
		sfxCues = cues;
		imageLayers = layers;
		for (const layer of imageLayers) void cacheLayerAssets(layer.src);
		drawingGroups = drawings;
		trimStart = Math.max(0, draft.trimStartSec ?? 0);
		trimEnd = draft.trimEndSec ?? null;
		playbackRate = Math.min(2, Math.max(0.5, draft.playbackRate ?? 1));
		caption = draft.caption;
		sensitive = draft.sensitive;
		destinations = draft.destinations?.length ? [...draft.destinations] : [draft.destination];
		lookId = memeLookOf(draft.lookId);
		if (draft.mediaTransform) {
			zoom = Math.min(4, Math.max(1, draft.mediaTransform.scale || 1));
			pan = {
				x: Math.min(1, Math.max(-1, draft.mediaTransform.x || 0)),
				y: Math.min(1, Math.max(-1, draft.mediaTransform.y || 0))
			};
			persistFraming();
		}
		selectedId =
			draft.selectedId && overlays.some((o) => o.id === draft.selectedId)
				? draft.selectedId
				: (overlays[0]?.id ?? null);
		if (
			media ||
			overlays.length ||
			imageLayers.length ||
			drawingGroups.length ||
			sfxCues.length ||
			caption.trim()
		) {
			toasts.info(
				media ? 'Recovered your last draft' : 'Recovered your captions — pick the source again',
				4000
			);
			haptic(15);
		}
	}

	/** Stage a sound cue at the current playhead (media time). */
	function addSfxCue(sfx: MemeSfxId) {
		if (sfxCues.length >= MAX_SFX_CUES) {
			toasts.error(`Sound cues cap out at ${MAX_SFX_CUES}`);
			return;
		}
		const atMs = mediaKind === 'video' ? Math.round(currentTime * 1000) : 0;
		const cue = normalizeSfxCue({ sfx, atMs, gain: 1 });
		if (cue) sfxCues = [...sfxCues, cue];
	}

	function removeSfxCue(id: string) {
		sfxCues = sfxCues.filter((c) => c.id !== id);
	}

	/* Frame-FX windows (shared fx-track model, burned into every export):
	 * tap an effect to start a 600ms window at the playhead — the same
	 * addFxWindow the desktop FX picker runs. */
	function playheadMs(): number {
		return mediaKind === 'video' ? Math.round(currentTime * 1000) : 0;
	}

	function addFxWindow(fx: FrameFxId) {
		if (fxWindows.length >= MAX_FX_WINDOWS) {
			toasts.error(`FX cap out at ${MAX_FX_WINDOWS} windows`);
			return;
		}
		const atMs = playheadMs();
		fxWindows = normalizeFxWindows([
			...fxWindows,
			{ fx, startMs: atMs, endMs: atMs + 600, intensity: DEFAULT_FX_INTENSITY }
		]);
		haptic();
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

	/* Zoom punches + speed ramps (the remix wire's z/s tracks): windows burn
	 * into every video/gif export and now have an editor — add at the
	 * playhead, tune, delete. Mirrors the desktop pickers' defaults. */
	function addZoomWindow() {
		if (zoomWindows.length >= MAX_ZOOM_WINDOWS) {
			toasts.error(`Zoom punches cap out at ${MAX_ZOOM_WINDOWS}`);
			return;
		}
		const atMs = playheadMs();
		zoomWindows = normalizeZoomWindows([
			...zoomWindows,
			{ startMs: atMs, endMs: atMs + 1500, factor: 2, cx: 0.5, cy: 0.5 }
		]);
		haptic();
	}

	function removeZoomWindow(index: number) {
		zoomWindows = zoomWindows.filter((_, i) => i !== index);
	}

	function patchZoomFactor(index: number, factor: number) {
		const rows = [...zoomWindows];
		const row = rows[index];
		if (row) rows[index] = { ...row, factor };
		zoomWindows = rows;
	}

	function addSpeedWindow() {
		if (speedWindows.length >= MAX_SPEED_WINDOWS) {
			toasts.error(`Speed ramps cap out at ${MAX_SPEED_WINDOWS}`);
			return;
		}
		const atMs = playheadMs();
		speedWindows = normalizeSpeedWindows([
			...speedWindows,
			{ startMs: atMs, endMs: atMs + 1000, rate: 2 }
		]);
		haptic();
	}

	function removeSpeedWindow(index: number) {
		speedWindows = speedWindows.filter((_, i) => i !== index);
	}

	function patchSpeedRate(index: number, rate: number) {
		const rows = [...speedWindows];
		const row = rows[index];
		if (row) rows[index] = { ...row, rate };
		speedWindows = rows;
	}

	/** Audition a synth sound (same render path as the desktop studio). */
	function previewSfx(sfx: MemeSfxId) {
		void (async () => {
			const { renderSfxTrack, scheduleSfx, SFX_RECIPES } = await import('$lib/meme/sfx');
			const dur = SFX_RECIPES[sfx].duration + 0.25;
			const OfflineCtx = window.OfflineAudioContext;
			if (!OfflineCtx) return;
			const schedule = scheduleSfx([{ id: 'preview', sfx, atMs: 0, gain: 1 }], dur);
			const buffer = await renderSfxTrack(schedule, dur, OfflineCtx);
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

	/* ------------------------------------------------------------------ *
	 * Undo + overlay mutations
	 * ------------------------------------------------------------------ */

	function snapshot() {
		undoStack.push(overlays.map((o) => ({ ...o })));
		if (undoStack.length > 50) undoStack.shift();
		redoStack.length = 0; // a new edit forks history
		undoDepth = undoStack.length;
		redoDepth = 0;
	}

	function undo() {
		const prev = undoStack.pop();
		if (!prev) return;
		redoStack.push(overlays.map((o) => ({ ...o })));
		overlays = prev;
		selectedId = null;
		undoDepth = undoStack.length;
		redoDepth = redoStack.length;
		haptic();
	}

	function redo() {
		const next = redoStack.pop();
		if (!next) return;
		undoStack.push(overlays.map((o) => ({ ...o })));
		overlays = next;
		selectedId = null;
		undoDepth = undoStack.length;
		redoDepth = redoStack.length;
		haptic();
	}

	/** Patch one overlay (style sheet / drag commit path). */
	function patchOverlay(id: string, patch: Partial<MemeTextOverlay>) {
		overlays = overlays.map((o) => (o.id === id ? { ...o, ...patch } : o));
	}

	function addMemePair() {
		const top = memeTop.trim();
		const bottom = memeBottom.trim();
		if (!top && !bottom) return;
		snapshot();
		const added: MemeTextOverlay[] = [];
		if (top)
			added.push(
				makeOverlay({ text: top, y: 0.14, size: 0.1, font: memeFont, caps: true, stroke: true })
			);
		if (bottom)
			added.push(
				makeOverlay({ text: bottom, y: 0.86, size: 0.1, font: memeFont, caps: true, stroke: true })
			);
		overlays = [...overlays, ...added];
		selectedId = added[added.length - 1]?.id ?? null;
		memeTop = '';
		memeBottom = '';
		closeSheet();
		haptic();
	}

	function addFreeText() {
		const text = freeText.trim();
		if (!text) return;
		snapshot();
		const added = makeOverlay({
			text,
			y: 0.5,
			size: 0.08,
			font: 'sans',
			caps: false,
			stroke: true
		});
		overlays = [...overlays, added];
		selectedId = added.id;
		freeText = '';
		closeSheet();
		haptic();
	}

	function addSticker(emoji: string) {
		snapshot();
		const added = makeSticker(emoji, { index: overlays.length });
		overlays = [...overlays, added];
		selectedId = added.id;
		closeSheet();
		haptic();
	}

	function removeOverlay(id: string) {
		snapshot();
		overlays = overlays.filter((o) => o.id !== id);
		if (selectedId === id) selectedId = null;
		haptic();
	}

	/* ------------------------------------------------------------------ *
	 * Draggable overlays (pointer events, normalized 0–1 coords — same
	 * model as MemeTextOverlay so Phase 2 can feed the export pipeline)
	 * ------------------------------------------------------------------ */

	let drag: {
		id: string;
		startX: number;
		startY: number;
		originX: number;
		originY: number;
		moved: boolean;
	} | null = null;

	/* Two-finger pinch ON an overlay scales its `size` (schema parity: the
	 * overlay model has no rotation, so the gesture never invents one). */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- pointer bookkeeping
	const overlayPointers = new Map<number, { x: number; y: number }>();
	let overlayPinch: { id: string; baseDist: number; baseSize: number } | null = null;

	const clamp01 = (v: number) => Math.min(0.98, Math.max(0.02, v));
	const clampSize = (v: number) => Math.min(0.3, Math.max(0.02, v));

	function overlayPointerDist(): number {
		const pts = [...overlayPointers.values()];
		return Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
	}

	function onOverlayPointerDown(event: PointerEvent, overlay: MemeTextOverlay) {
		if ((event.target as HTMLElement).closest('button')) return;
		selectedId = overlay.id;
		overlayPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
		if (overlayPointers.size === 2) {
			// Pinch begins: one undo step banks the whole gesture.
			snapshot();
			drag = null;
			overlayPinch = { id: overlay.id, baseDist: overlayPointerDist(), baseSize: overlay.size };
			haptic();
			return;
		}
		if (overlayPointers.size > 2) return;
		drag = {
			id: overlay.id,
			startX: event.clientX,
			startY: event.clientY,
			originX: overlay.x,
			originY: overlay.y,
			moved: false
		};
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function onOverlayPointerMove(event: PointerEvent) {
		if (overlayPointers.has(event.pointerId))
			overlayPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
		if (overlayPinch) {
			if (overlayPointers.size < 2) return;
			const scale = overlayPointerDist() / Math.max(1, overlayPinch.baseDist);
			patchOverlay(overlayPinch.id, { size: clampSize(overlayPinch.baseSize * scale) });
			return;
		}
		if (!drag) return;
		const dx = event.clientX - drag.startX;
		const dy = event.clientY - drag.startY;
		if (Math.abs(dx) > 5 || Math.abs(dy) > 5) drag.moved = true;
		if (!drag.moved) return;
		const rect = canvasEl?.getBoundingClientRect();
		if (!rect) return;
		const nx = clamp01(drag.originX + dx / rect.width);
		const ny = clamp01(drag.originY + dy / rect.height);
		const id = drag.id;
		overlays = overlays.map((o) => (o.id === id ? { ...o, x: nx, y: ny } : o));
	}

	function onOverlayPointerUp(event: PointerEvent) {
		overlayPointers.delete(event.pointerId);
		if (overlayPinch) {
			// No accidental tap-to-edit after a pinch gesture.
			if (overlayPointers.size < 2) overlayPinch = null;
			return;
		}
		const d = drag;
		drag = null;
		// A second tap on the already-selected overlay opens its style sheet.
		if (d && !d.moved && selectedId === d.id) openEdit(d.id);
	}

	/* Sticker-layer pointer handling: the same grammar as text overlays —
	 * one finger drags, two fingers pinch-scale (size is stage-height ·
	 * 0.05–0.9), tap selects. */
	let layerDrag: {
		id: string;
		startX: number;
		startY: number;
		originX: number;
		originY: number;
		moved: boolean;
	} | null = null;
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- pointer bookkeeping
	const layerPointers = new Map<number, { x: number; y: number }>();
	let layerPinch: { id: string; baseDist: number; baseSize: number } | null = null;

	function layerPointerDist(): number {
		const pts = [...layerPointers.values()];
		return Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
	}

	function onLayerPointerDown(event: PointerEvent, layer: MemeImageOverlay) {
		selectedLayerId = layer.id;
		selectedId = null;
		layerPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
		if (layerPointers.size === 2) {
			layerDrag = null;
			layerPinch = { id: layer.id, baseDist: layerPointerDist(), baseSize: layer.size };
			haptic();
			return;
		}
		if (layerPointers.size > 2) return;
		layerDrag = {
			id: layer.id,
			startX: event.clientX,
			startY: event.clientY,
			originX: layer.x,
			originY: layer.y,
			moved: false
		};
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function onLayerPointerMove(event: PointerEvent) {
		if (layerPointers.has(event.pointerId))
			layerPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
		if (layerPinch) {
			if (layerPointers.size < 2) return;
			const scale = layerPointerDist() / Math.max(1, layerPinch.baseDist);
			patchLayer(layerPinch.id, {
				size: Math.min(0.9, Math.max(0.05, layerPinch.baseSize * scale))
			});
			return;
		}
		if (!layerDrag) return;
		const dx = event.clientX - layerDrag.startX;
		const dy = event.clientY - layerDrag.startY;
		if (Math.abs(dx) > 5 || Math.abs(dy) > 5) layerDrag.moved = true;
		const rect = canvasEl?.getBoundingClientRect();
		if (!rect) return;
		const nx = clamp01(layerDrag.originX + dx / rect.width);
		const ny = clamp01(layerDrag.originY + dy / rect.height);
		patchLayer(layerDrag.id, { x: nx, y: ny });
	}

	function onLayerPointerUp(event: PointerEvent) {
		layerPointers.delete(event.pointerId);
		if (layerPinch) {
			if (layerPointers.size < 2) layerPinch = null;
			return;
		}
		const d = layerDrag;
		layerDrag = null;
		// A second tap on the already-selected sticker opens its style sheet
		// (the same grammar as text overlays).
		if (d && !d.moved && selectedLayerId === d.id) openLayerEdit(d.id);
	}

	/* ------------------------------------------------------------------ *
	 * Media pick + video playback
	 * ------------------------------------------------------------------ */

	function pickMedia() {
		fileInputEl?.click();
	}

	function onFilePicked(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const picked = [...(input.files ?? [])].filter(
			(f) => f.type.startsWith('video/') || f.type.startsWith('image/')
		);
		input.value = '';
		if (!picked.length) return;
		// Multi-pick = mass production: the first file stages when the canvas
		// is empty, the rest line up in the batch queue (each post loads the
		// next — the loop /studio advertises).
		if (!mediaUrl) {
			const [first, ...rest] = picked;
			queueFiles(rest);
			if (rest.length) toasts.info(`${rest.length} more queued — each post loads the next`);
			if (first) stageMediaFile(first, { fresh: true });
			return;
		}
		queueFiles(picked);
		toasts.info(`${picked.length} queued — each post loads the next`);
	}

	/** Stage media fresh: media-bound settings reset (mode derives from the
	 *  kind), while the caption layout + cues + drawings stay — normalized
	 *  coordinates make them media-agnostic, which is the batch loop's point. */
	function stageMediaFile(file: File, opts: { fresh?: boolean } = {}) {
		setMediaFile(file);
		// These belong to the previous clip — cleared on ANY swap (desktop's
		// acceptFile does the same: poster/trim/length die with the old media).
		trimStart = 0;
		trimEnd = null;
		playbackRate = 1;
		selectedId = null;
		blankBg = null;
		if (opts.fresh) {
			// A device pick starts a new meme: matching toolbar (video → Video,
			// .gif → GIF) + a clean look/tracks/lineage. Swaps (queue advance,
			// GIF library, background color) KEEP the creative state — desktop's
			// keepRemix/keepLayout semantics, the caption-once loop's point.
			if (file.type.startsWith('video/')) setMode('video');
			else if (file.type === 'image/gif') setMode('gif');
			else setMode('image');
			lookId = 'none';
			zoomWindows = [];
			fxWindows = [];
			speedWindows = [];
			remixSource = null;
			sourceCredit = '';
		}
	}

	/* Batch queue (mass production): the store owns the list mechanics; this
	 * shell owns staging side-effects and queue-strip thumbnails (blob URLs
	 * created on queue, revoked on stage/clear/unmount). */
	const batch = new MemeBatchQueue();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- blob URL cache
	const queueThumbUrls = new Map<number, string>();

	function queueFiles(files: File[]) {
		if (!files.length) return;
		batch.appendFiles(files);
		for (const item of batch.remainingItems) {
			if (item.file && !queueThumbUrls.has(item.id)) {
				try {
					queueThumbUrls.set(item.id, URL.createObjectURL(item.file));
				} catch {
					/* thumbnail is optional chrome */
				}
			}
		}
	}

	function revokeQueueThumb(id: number) {
		const url = queueThumbUrls.get(id);
		if (url) {
			URL.revokeObjectURL(url);
			queueThumbUrls.delete(id);
		}
	}

	function clearQueue() {
		for (const id of [...queueThumbUrls.keys()]) revokeQueueThumb(id);
		batch.clear();
	}

	/** Stage the next queued source (publish advance + Skip): per-item
	 *  captions land when set; local files stage directly. Returns false when
	 *  the queue ran dry. */
	/** Fetch a remote source (GIF library pick) into the stage File through
	 *  the shared fetcher (proxy retry + type/size gates) — the mobile twin
	 *  of the desktop's loadGifFromUrl. Progress rides the shared scrim. */
	async function stageGifFromUrl(url: string, label = 'GIF'): Promise<boolean> {
		if (remixLoading || draftLoading) return false;
		remixLoading = true;
		remixLoadPercent = 0;
		remixLoadLabel = label;
		try {
			const res = await fetchSourceFile(url, {
				label,
				accept: 'image',
				onProgress: (percent) => (remixLoadPercent = percent)
			});
			if (!res.ok || !res.file) throw new Error(res.error ?? `Could not load that ${label}`);
			stageMediaFile(res.file);
			setMode('gif'); // library picks land the GIF toolbar (creative state kept)
			return !!mediaUrl;
		} catch (e) {
			toasts.error(e instanceof Error ? e.message : `Could not load that ${label}`);
			return false;
		} finally {
			remixLoading = false;
			remixLoadPercent = 0;
		}
	}

	/** GIF sheet pick mode: stage as the base media, or drop as sticker
	 *  LAYERS (Giphy stickers are transparent cut-outs that animate in the
	 *  preview and burn through the shared gifLayerPainter on export). */
	let gifPickAsLayer = $state(false);

	/** GIF library single pick: close the sheet, fetch, stage. */
	async function pickGifForStage(gif: GifChoice) {
		closeSheet();
		await stageGifFromUrl(gif.url, gif.title ?? 'GIF');
	}

	/** GIF library multi-pick: first pick stages when the canvas is empty,
	 *  the rest queue as URL items (desktop parity). */
	async function pickGifsForStage(gifs: GifChoice[]) {
		closeSheet();
		const [first, ...rest] = gifs;
		if (!first) return;
		batch.appendUrls(rest.map((g) => ({ url: g.url, label: g.title ?? 'GIF' })));
		if (rest.length) toasts.info(`${rest.length} queued — each post loads the next`);
		if (mediaUrl) return;
		await stageGifFromUrl(first.url, first.title ?? 'GIF');
	}

	/** Stage the next queued source (publish advance + Skip): per-item
	 *  captions land when set; local files stage directly, URL items fetch.
	 *  Returns false when the queue ran dry (a failed fetch tries the next
	 *  item — the queue never stalls). */
	async function stageNextQueued(): Promise<boolean> {
		for (;;) {
			const next = batch.take();
			if (!next) return false;
			revokeQueueThumb(next.id);
			if (next.file) {
				if (typeof next.caption === 'string') caption = next.caption;
				stageMediaFile(next.file);
				return !!mediaUrl;
			}
			if (next.url) {
				if (typeof next.caption === 'string') caption = next.caption;
				if (await stageGifFromUrl(next.url, next.label)) return true;
				continue;
			}
		}
	}

	/** Queue thumbnails must never outlive the shell. */
	$effect(() => {
		return () => {
			for (const url of queueThumbUrls.values()) URL.revokeObjectURL(url);
			queueThumbUrls.clear();
		};
	});

	/** Revoke our blob URL (and release the GIF decoder) on unmount. */
	$effect(() => {
		return () => {
			if (ownedUrl) URL.revokeObjectURL(ownedUrl);
			gif?.close();
		};
	});

	function togglePlay() {
		if (gif) {
			gifPlaying = !gifPlaying;
			return;
		}
		const video = videoEl;
		if (!video) return;
		if (video.paused) void video.play().catch(() => undefined);
		else video.pause();
	}

	/** The timeline shows for video (non-image modes) AND animated GIF bases. */
	// Mode-independent: staging a video while the URL pins fmt=image used to
	// hide the timeline + transport entirely (the fmt param sticks after any
	// sheet action) — the timeline shows for ANY media with a clock now;
	// the mode tabs purely switch the bottom toolbar.
	const timelineActive = $derived(mediaKind === 'video' || !!gif);

	/** Timeline scrubbing: drag anywhere on the strip to seek (the playhead
	 *  position drives cuts, FX windows and cue staging — desktop parity).
	 *  `touch-none` keeps the gesture from scrolling the page. */
	let scrubbing = false;

	function scrubTo(clientX: number, rect: DOMRect) {
		if (duration <= 0) return;
		const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
		if (gif) {
			currentTime = frac * duration; // the preview loop holds at the playhead
			return;
		}
		if (!videoEl) return;
		videoEl.currentTime = frac * duration;
		currentTime = videoEl.currentTime;
	}

	function onTimelinePointerDown(event: PointerEvent) {
		if (duration <= 0) return;
		const track = event.currentTarget as HTMLElement;
		scrubbing = true;
		track.setPointerCapture(event.pointerId);
		scrubTo(event.clientX, track.getBoundingClientRect());
	}

	function onTimelinePointerMove(event: PointerEvent) {
		if (!scrubbing) return;
		scrubTo(event.clientX, (event.currentTarget as HTMLElement).getBoundingClientRect());
	}

	function onTimelinePointerUp() {
		scrubbing = false;
	}

	/** Keyboard scrub (±0.5s, shift = ±5s) — the slider role's a11y path. */
	function onTimelineKeydown(event: KeyboardEvent) {
		if (!videoEl || duration <= 0) return;
		const step = event.shiftKey ? 5 : 0.5;
		let next: number | null = null;
		if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = currentTime - step;
		else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = currentTime + step;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = duration;
		if (next === null) return;
		event.preventDefault();
		videoEl.currentTime = Math.min(duration, Math.max(0, next));
		currentTime = videoEl.currentTime;
	}

	/** Keep one side of the video at the playhead — a true non-destructive
	 *  cut (the export burns the contiguous window, so this is exactly what
	 *  publishes; mirrors the desktop `cutVideoAtPlayhead`). */
	function cutAtPlayhead(keep: 'before' | 'after') {
		const dur = duration || 0;
		if (mediaKind !== 'video' || !dur) {
			toasts.info('Add a video to cut it');
			return;
		}
		const at = Math.max(0, Math.min(currentTime, dur));
		const start = trimStart;
		const end = trimEnd ?? dur;
		if (at <= start + 0.1 || at >= end - 0.1) {
			toasts.info('Move the playhead inside the window before cutting');
			return;
		}
		if (keep === 'before') trimEnd = at;
		else trimStart = at;
		toasts.success(`Kept the ${keep === 'before' ? 'start' : 'end'} of the video`);
		haptic();
	}

	/** Speed follows the state (Trim & speed sheet + ramps) onto the element:
	 *  ramps multiply the base rate at the playhead (timeupdate re-arms this
	 *  ~4×/s during playback, so boundaries cross live). */
	$effect(() => {
		if (videoEl)
			videoEl.playbackRate = Math.min(
				4,
				Math.max(0.25, playbackRate * rateAt(speedWindows, Math.round(currentTime * 1000)))
			);
	});

	/** Stage framing including the active zoom punch (WYSIWYG with exports,
	 *  which compose the same transform at the media clock). */
	const previewTransform = $derived(
		composeZoomWithFraming(mediaTransform, zoomTransformAt(zoomWindows, playheadMs()))
	);
	/** CSS twin of `previewTransform` (same math as `panPercent`): translate
	 *  percentages apply pre-scale, so t = pan · (s−1) / (2s) · 100. */
	const previewCss = $derived.by(() => {
		const f =
			previewTransform.scale > 1
				? ((previewTransform.scale - 1) / (2 * previewTransform.scale)) * 100
				: 0;
		return { x: previewTransform.x * f, y: previewTransform.y * f };
	});

	/** Animated GIF preview: a canvas clock paints the decoded frames (look
	 *  + zoom/pan framing applied) — exactly the base the export burns. */
	$effect(() => {
		const decoded = gif;
		const el = gifCanvasEl;
		if (!decoded || !el || decoded.frames.length < 2) return;
		const ctx = el.getContext('2d');
		if (!ctx) return;
		void mediaTransform;
		void lookId; // re-arm on framing/look changes
		let raf = 0;
		let clock = 0;
		let last = performance.now();
		const span = Math.max(decoded.duration, 0.01);
		const draw = () => {
			const now = performance.now();
			// Scrubbing holds the clock at the timeline playhead; paused freezes.
			if (scrubbing) clock = Math.min(span, Math.max(0, currentTime));
			else if (gifPlaying) clock = (clock + (now - last) / 1000) % span;
			last = now;
			const box = el.getBoundingClientRect();
			const dpr = Math.min(window.devicePixelRatio || 1, 2);
			const w = Math.max(1, Math.round(box.width * dpr));
			const h = Math.max(1, Math.round(box.height * dpr));
			if (el.width !== w || el.height !== h) {
				el.width = w;
				el.height = h;
			}
			ctx.clearRect(0, 0, w, h);
			const look = memeLookCss(lookId);
			if (look !== 'none') ctx.filter = look;
			// Zoom punches compose onto the framing at the playhead (WYSIWYG).
			paintGifFrameAt(
				ctx,
				decoded,
				clock,
				el,
				composeZoomWithFraming(
					mediaTransform,
					zoomTransformAt(zoomWindows, Math.round(clock * 1000))
				)
			);
			ctx.filter = 'none';
			// Feed the shared timeline clock (markers, cue staging, playhead).
			if (!scrubbing) currentTime = clock;
			raf = requestAnimationFrame(draw);
		};
		raf = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(raf);
	});

	function fmtTime(seconds: number): string {
		if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
	}

	const playheadPct = $derived(duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0);

	/* ------------------------------------------------------------------ *
	 * Draw layer mutations (a ladder of the desktop studio's group model)
	 * ------------------------------------------------------------------ */

	function snapshotDrawings() {
		drawingUndo = [...drawingUndo.slice(-24), normalizeDrawingGroups(drawingGroups)];
		drawingRedo = [];
		drawingUndoDepth = drawingUndo.length;
		drawingRedoDepth = 0;
	}

	/** Append a stroke: into the last group while the style matches, else a
	 *  fresh group (≤ MAX_DRAWING_GROUPS, like the desktop layer ladder). */
	function addDrawingStroke(stroke: ReturnType<typeof makeDrawingStroke>) {
		const last = drawingGroups[drawingGroups.length - 1];
		const styleMatches =
			last &&
			last.playback === 'static' &&
			last.strokes[0] &&
			last.strokes[0].tool === stroke.tool &&
			last.strokes[0].color === stroke.color &&
			Math.abs(last.strokes[0].width - stroke.width) < 1e-6 &&
			Math.abs(last.strokes[0].opacity - stroke.opacity) < 1e-6 &&
			last.strokes.length < 100;
		if (!styleMatches && drawingGroups.length >= MAX_DRAWING_GROUPS) {
			toasts.warning(`You can add up to ${MAX_DRAWING_GROUPS} drawing layers`);
			return;
		}
		snapshotDrawings();
		drawingGroups = styleMatches
			? drawingGroups.map((group, i) =>
					i === drawingGroups.length - 1 ? { ...group, strokes: [...group.strokes, stroke] } : group
				)
			: [
					...drawingGroups,
					{
						id: `drawing-${Date.now().toString(36)}`,
						label: `Drawing ${drawingGroups.length + 1}`,
						playback: 'static',
						startMs: 0,
						visibleFromMs: 0,
						strokes: [stroke]
					}
				];
	}

	function undoDrawing() {
		const previous = drawingUndo[drawingUndo.length - 1];
		if (!previous) return;
		drawingRedo = [...drawingRedo, normalizeDrawingGroups(drawingGroups)];
		drawingGroups = previous;
		drawingUndo = drawingUndo.slice(0, -1);
		drawingUndoDepth = drawingUndo.length;
		drawingRedoDepth = drawingRedo.length;
	}

	function redoDrawing() {
		const next = drawingRedo[drawingRedo.length - 1];
		if (!next) return;
		drawingUndo = [...drawingUndo, normalizeDrawingGroups(drawingGroups)];
		drawingGroups = next;
		drawingRedo = drawingRedo.slice(0, -1);
		drawingUndoDepth = drawingUndo.length;
		drawingRedoDepth = drawingRedo.length;
	}

	function clearDrawings() {
		if (!drawingGroups.length) return;
		snapshotDrawings();
		drawingGroups = [];
	}

	/* ------------------------------------------------------------------ *
	 * Exit → auto-save a WIP slot (no dead ends; resumable from /studio)
	 * ------------------------------------------------------------------ */

	/** Tiny JPEG snapshot of the staged media for draft thumbnails (studio
	 *  home hero + the Drafts sheet). Drawn from the live element, so it
	 *  reflects the current look/trim frame — best effort, never fatal. */
	function stagePreviewDataUrl(): string | null {
		const el: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | null =
			mediaKind === 'video' ? videoEl : (gifCanvasEl ?? imgEl);
		if (!el) return null;
		const w = el instanceof HTMLVideoElement ? el.videoWidth : el.width;
		const h = el instanceof HTMLVideoElement ? el.videoHeight : el.height;
		if (!w || !h) return null;
		try {
			const tw = 144;
			const canvas = document.createElement('canvas');
			canvas.width = tw;
			canvas.height = Math.max(1, Math.round((h / w) * tw));
			const ctx = canvas.getContext('2d');
			if (!ctx) return null;
			ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
			return canvas.toDataURL('image/jpeg', 0.72);
		} catch {
			return null;
		}
	}

	async function saveWip() {
		const label =
			resumedLabel ||
			overlays
				.find((o) => o.text.trim() && !isStickerOverlay(o))
				?.text.trim()
				.slice(0, 40) ||
			(sfxCues.length ? `Sound meme · ${SFX_LABELS[sfxCues[0]!.sfx as MemeSfxId]}` : '') ||
			'Mobile draft';
		let media: MemeSlotMedia | null;
		if (pickedFile) {
			try {
				media = await memeSlots.saveMediaFile(pickedFile);
			} catch {
				// Fallback keeps small projects usable when IndexedDB is blocked
				// (same ladder as the desktop studio's save point).
				media = await mediaToDraftDataUrl(pickedFile);
			}
			if (media) {
				const preview = stagePreviewDataUrl();
				if (preview) media.previewDataUrl = preview;
			}
		} else {
			// Resumed slot whose media restored fine: keep its reference so the
			// overwrite below never strips the bytes (pickedFile covers replaced
			// media; this branch covers the untouched resume).
			media = resumedMedia;
		}
		const hasWork = overlays.length > 0 || media !== null;
		if (!hasWork) return;
		memeSlots.save({
			// Resume loop: overwrite the slot we restored instead of piling up
			// near-duplicate WIPs on every exit.
			...(resumedSlotId ? { id: resumedSlotId } : {}),
			label,
			media,
			mediaKindValue: media ? mediaKind : null,
			overlays,
			sfxCues,
			imageLayers,
			drawingGroups,
			caption,
			sensitive,
			destination: destinations[0] ?? 'bitz',
			destinations,
			lookId,
			trimStartSec: trimStart,
			trimEndSec: trimEnd,
			playbackRate,
			zoomWindows,
			fxWindows,
			speedWindows
		});
		toasts.info(`“${label}” saved to Work in progress`);
	}

	function exit() {
		void saveWip().then(() => {
			draftWriter.flush(); // keep the auto-draft for post-exit recovery
			onexit();
		});
	}

	/* ------------------------------------------------------------------ *
	 * Templates (`?panel=templates`): save the current layout (with its timed
	 * extras — cues, tracks, sticker layers) and apply saved layouts or the
	 * built-in starters. Same store + factories the desktop studio uses.
	 * ------------------------------------------------------------------ */

	let templateName = $state('');

	/** Community catalog: load (throttled in-store) + author profiles when the
	 *  Layouts sheet opens — the shared marketplace over shared-template
	 *  events (kind 30078), same flow as the desktop market dialog. */
	$effect(() => {
		if (panel !== 'templates') return;
		void sharedTemplatesStore.load();
		profiles.ensure([...new Set(sharedTemplatesStore.list.map((t) => t.creatorPubkey))]);
	});

	function useSharedTemplate(eventId: string) {
		const row = templateMarketplace.rows.find((r) => r.template.eventId === eventId);
		if (!row) return;
		// importUnlocked returns void — call the store import directly so the
		// saved template comes back and lands on the canvas immediately.
		void sharedTemplatesStore.import(row.template).then((saved) => {
			if (saved) applySavedTemplate(saved);
		});
	}

	async function shareSavedTemplate(id: string) {
		await sharedTemplatesStore.share(id);
	}

	function saveCurrentTemplate() {
		try {
			const saved = memeTemplates.save(templateName, overlays, 'i-lucide-bookmark', {
				sfxCues,
				zoomWindows,
				fxWindows,
				speedWindows,
				imageLayers
			});
			templateName = '';
			toasts.success(`Layout “${saved.label}” saved`);
			haptic();
		} catch (e) {
			toasts.error(e instanceof Error ? e.message : 'Could not save that layout');
		}
	}

	/** Apply a saved layout: fresh overlay ids + fresh timed extras (v2).
	 *  Extras the template carries REPLACE the matching tracks — applying a
	 *  layout is a whole-canvas statement, like the desktop studio. */
	function applySavedTemplate(tpl: SavedMemeTemplate) {
		overlays = memeTemplates.apply(tpl);
		const extras = memeTemplates.applyExtras(tpl);
		if (extras.sfxCues) sfxCues = extras.sfxCues;
		if (extras.zoomWindows) zoomWindows = extras.zoomWindows;
		if (extras.fxWindows) fxWindows = extras.fxWindows;
		if (extras.speedWindows) speedWindows = extras.speedWindows;
		if (extras.imageLayers) {
			imageLayers = extras.imageLayers;
			for (const layer of imageLayers) void cacheLayerAssets(layer.src);
		}
		selectedId = overlays[0]?.id ?? null;
		selectedLayerId = imageLayers[0]?.id ?? null;
		toasts.info(`“${tpl.label}” applied`);
		haptic();
	}

	/** Apply a built-in starter (fresh factory outputs every time). */
	function applyStarterTemplate(tpl: MemeStudioTemplate) {
		overlays = tpl.overlays();
		sfxCues = tpl.sfxCues ? tpl.sfxCues() : sfxCues;
		zoomWindows = tpl.zoomWindows ? tpl.zoomWindows() : zoomWindows;
		fxWindows = tpl.fxWindows ? tpl.fxWindows() : fxWindows;
		speedWindows = tpl.speedWindows ? tpl.speedWindows() : speedWindows;
		selectedId = overlays[0]?.id ?? null;
		toasts.info(`“${tpl.label}” starter applied`);
		haptic();
	}

	/* ------------------------------------------------------------------ *
	 * Drafts sheet (`?panel=drafts` — resume in place, docs/ui/edit2.html
	 * draft grid): bank the current canvas first, then swap slots.
	 * ------------------------------------------------------------------ */

	function agoLabel(savedAt: number): string {
		const sec = Math.max(1, Math.round((Date.now() - savedAt) / 1000));
		if (sec < 60) return `${sec}s ago`;
		const min = Math.round(sec / 60);
		if (min < 60) return `${min}m ago`;
		const hr = Math.round(min / 60);
		if (hr < 24) return `${hr}h ago`;
		return `${Math.round(hr / 24)}d ago`;
	}

	async function resumeDraft(id: string) {
		if (publishBusy || draftLoading) return;
		closeSheet();
		// No dead ends: bank whatever is on the canvas before swapping. For a
		// re-tap of the same draft this is a harmless round trip (save → seed).
		await saveWip();
		await seedSlotHandoff(id);
	}

	async function startFreshDraft() {
		if (publishBusy || draftLoading) return;
		await saveWip(); // bank current work, if any
		clearQueue();
		draftWriter.clear();
		if (ownedUrl) URL.revokeObjectURL(ownedUrl);
		ownedUrl = null;
		pickedFile = null;
		mediaUrl = null;
		mediaKind = null;
		overlays = [];
		selectedId = null;
		lookId = 'none';
		trimStart = 0;
		trimEnd = null;
		playbackRate = 1;
		sfxCues = [];
		zoomWindows = [];
		fxWindows = [];
		speedWindows = [];
		caption = '';
		sensitive = false;
		destinations = ['bitz'];
		remixSource = null;
		sourceCredit = '';
		resumedSlotId = null;
		resumedLabel = '';
		resumedMedia = null;
		imageLayers = [];
		selectedLayerId = null;
		drawingGroups = [];
		drawingUndo = [];
		drawingRedo = [];
		drawingUndoDepth = 0;
		drawingRedoDepth = 0;
		drawActive = false;
		undoStack.length = 0;
		redoStack.length = 0;
		undoDepth = 0;
		redoDepth = 0;
		toasts.info('Fresh canvas — pick media to start');
	}

	function discardDraft(id: string) {
		const slot = memeSlots.list.find((s) => s.id === id);
		memeSlots.remove(id);
		if (resumedSlotId === id) {
			resumedSlotId = null;
			resumedLabel = '';
			resumedMedia = null;
		}
		if (slot) toasts.info(`“${slot.label}” deleted`);
	}

	/** Publish sheet secondary (docs/ui/edit3.html “Save Draft”): bank the
	 *  WIP and return to the studio home. */
	async function saveDraftAndExit() {
		if (publishBusy) return;
		closeSheet();
		await saveWip();
		onexit();
	}

	/* ------------------------------------------------------------------ *
	 * Publish (Phase 3 — docs/ui/edit3.html Screen 6)
	 * ------------------------------------------------------------------ */

	let caption = $state('');
	/** Tracked @mentions from the shared caption composer — rewritten to
	 *  nostr:npub entities at publish (NIP-27, same as every other surface). */
	let captionMentions = $state<TrackedMention[]>([]);
	let tagDraft = $state('');
	let destinations = $state<MemeDestination[]>(['bitz']);
	let license = $state<RemixLicense>('CC0-1.0');
	let sensitive = $state(false);
	/** Publish extras (desktop parity): upload provider, rare-bitz PoW and
	 *  AI-provenance — all ride the same options the desktop studio passes. */
	let selectedProvider = $state<MediaProviderId | 'none'>('none');
	let showPow = $state(false);
	let pow = $state(powPrefs.state.lastDifficulty);
	let aiAssisted = $state(false);
	/** Value-split manifest (CRE-008): rows must sum to exactly 10,000 bps to
	 *  ride the bitz publish — same validation + tags as the desktop studio. */
	let splitRows = $state<SplitRow[]>([]);
	let splitsOpen = $state(false);
	const splitCheck = $derived(
		splitRows.length ? validateSplits(splitRows) : ({ ok: true } as const)
	);
	const splitTotal = $derived(splitRows.reduce((sum, row) => sum + row.basisPoints, 0));
	let pubPhase = $state<'idle' | 'rendering' | 'uploading' | 'publishing' | 'done' | 'error'>(
		'idle'
	);
	/** The published event (success overlay's "View …" link — desktop parity:
	 *  bitz posts link to /bitz#bitz=<id>, notes to /note/<id>). */
	let publishedEventId = $state<string | null>(null);
	let publishedKind = $state<'bitz' | 'note' | null>(null);
	let pubLabel = $state('');
	let pubPercent = $state(0);
	let pubError = $state('');
	const publishBusy = $derived(
		pubPhase === 'rendering' || pubPhase === 'uploading' || pubPhase === 'publishing'
	);

	let imgEl = $state<HTMLImageElement | null>(null);

	/** Hashtags parsed live from the caption (they ride the event as t-tags). */
	const captionTags = $derived(
		[...caption.matchAll(/#([\p{L}\p{N}_-]+)/gu)].map((m) => m[1] ?? '').filter(Boolean)
	);

	function addTag() {
		const tag = tagDraft
			.trim()
			.replace(/^#+/, '')
			.replace(/[^\p{L}\p{N}_-]/gu, '');
		tagDraft = '';
		if (!tag) return;
		if (!captionTags.includes(tag)) caption = `${caption.trim()} #${tag}`.trim();
	}

	function removeTag(tag: string) {
		caption = caption.replace(new RegExp(`\\s?#${tag}\b`, 'gu'), '').trim();
	}

	function toggleDestination(id: MemeDestination) {
		destinations = destinations.includes(id)
			? destinations.length > 1
				? destinations.filter((d) => d !== id)
				: destinations
			: [...destinations, id];
	}

	function paintOverlaysAt(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, atMs: number) {
		for (const o of overlays) paintOverlay(ctx, o, canvas, { atMs });
	}

	/** Cue decoder for export mixes: custom sounds decode from the shared
	 *  library store; synth cues need no PCM (recipes render in the mixer). */
	const cueDecodeSound = (soundId: string) =>
		soundId ? libraryDecodeSound(soundId) : Promise.resolve(null);

	/** Cue display name — synth labels from the catalog, custom from the
	 *  library (orphaned cues fall back gracefully). */
	function cueLabel(cue: MemeSfxCue): string {
		if (cue.sfx !== CUSTOM_SOUND_KEY) return SFX_LABELS[cue.sfx as MemeSfxId] ?? cue.sfx;
		return soundLibrary.list.find((s) => s.id === cue.soundId)?.label ?? 'Saved sound';
	}

	/** Preview a saved library sound through the shared sound IO. */
	function previewSound(sound: LibrarySound) {
		void soundIO.preview(sound);
	}

	/** Stage a saved library sound as a cue at the playhead (desktop parity). */
	function addCustomCue(sound: LibrarySound) {
		if (sfxCues.length >= MAX_SFX_CUES) {
			toasts.error(`Sound cues cap out at ${MAX_SFX_CUES}`);
			return;
		}
		const cue = normalizeSfxCue({
			sfx: CUSTOM_SOUND_KEY,
			soundId: sound.id,
			atMs: playheadMs(),
			gain: 1
		});
		if (cue) {
			sfxCues = [...sfxCues, cue];
			haptic();
		}
	}

	interface RenderedMeme {
		file: File;
		dim: string;
		durationSec?: number;
	}

	/** Still render (image media): shared `paintMemeBase` + `paintOverlay` —
	 *  the exact same primitives the desktop studio burns into its exports. */
	async function renderStill(): Promise<RenderedMeme> {
		if (gif) {
			// Animated GIF base: silent → a true looping .gif; with sound cues
			// → the recorder path (video with mixed audio), like sound-on-static.
			if (sfxCues.length) return renderGifVideo();
			return renderAnimatedGif();
		}
		const img = imgEl;
		if (!img || !img.naturalWidth) throw new Error('Add a photo first');
		// Artboard (cover-fit crop) or the source's own frame — the same math
		// as the desktop studio, so what the stage previews is what exports.
		const size =
			artboardId === 'source'
				? targetSize({ width: img.naturalWidth, height: img.naturalHeight })
				: evenSize(renderTarget);
		const canvas = document.createElement('canvas');
		canvas.width = size.width;
		canvas.height = size.height;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('Canvas is unavailable in this browser');
		paintMemeBase(ctx, canvas, {
			mediaKind: 'image',
			gif: null,
			stageImg: img,
			stageVideo: null,
			lookCss: memeLookCss(lookId),
			// The framing the preview shows (zoom gesture + pan) is the framing
			// the export burns — never an identity stub (WYSIWYG).
			mediaTransform,
			// Plain still: fx evaluate where the windows say (a static image
			// has no timeline — media time 0).
			fxWindows: fxWindows.length ? fxWindows : undefined
		});
		// Draw layer: static groups paint fully on stills (desktop order —
		// drawings sit above the media, beneath the captions).
		paintDrawingGroups(ctx, drawingGroups, canvas);
		paintOverlaysAt(ctx, canvas, 0);
		// Plain still: encode straight to PNG.
		if (!sfxCues.length) {
			const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
			if (!blob) throw new Error('Rendering the meme failed');
			return {
				file: new File([blob], `meme-${Date.now()}.png`, { type: 'image/png' }),
				dim: `${size.width}x${size.height}`
			};
		}
		// Sound-on-static (desktop behavior): an image with cue sounds exports
		// as a video — the painted frame plus the mixed cue track.
		const runtimeSec = Math.max(1, (sfxCues[sfxCues.length - 1]!.atMs + 800) / 1000);
		const cueTrack = await cueAudioTrack(runtimeSec, sfxCues, cueDecodeSound);
		const file = await recordMeme({
			canvas,
			totalMs: runtimeSec * 1000,
			extraTracks: cueTrack ? [cueTrack] : [],
			paint: (c, elapsedMs) => {
				c.clearRect(0, 0, canvas.width, canvas.height);
				paintMemeBase(c, canvas, {
					mediaKind: 'image',
					gif: null,
					stageImg: img,
					stageVideo: null,
					lookCss: memeLookCss(lookId),
					mediaTransform,
					// Static base: fx run on the sound-meme's export clock —
					// windows fire at their times as the timeline advances.
					fxWindows: fxWindows.length ? fxWindows : undefined,
					fxAtMs: elapsedMs
				});
				paintImageOverlays(
					c,
					imageLayers,
					layerBitmapFor,
					canvas,
					elapsedMs,
					layerAssets.painterFor
				);
				paintDrawingGroups(c, drawingGroups, canvas);
				paintOverlaysAt(c, canvas, elapsedMs);
			}
		});
		return { file, dim: `${size.width}x${size.height}`, durationSec: runtimeSec };
	}

	/** Animated GIF export (silent): paint each decoded frame with the look,
	 *  framing, sticker layers, drawings and captions at that frame's time,
	 *  then encode through the shared GIF encoder. Fresh canvas per frame —
	 *  the encoder reads sources asynchronously. */
	async function renderAnimatedGif(): Promise<RenderedMeme> {
		const decoded = gif;
		if (!decoded) throw new Error('Add a GIF first');
		const size = evenSize(
			artboardId === 'source'
				? targetSize({ width: decoded.width, height: decoded.height })
				: renderTarget
		);
		const look = memeLookCss(lookId);
		const frames: GifEncodeFrame[] = [];
		for (const frame of decoded.frames) {
			const canvas = document.createElement('canvas');
			canvas.width = size.width;
			canvas.height = size.height;
			const ctx = canvas.getContext('2d');
			if (!ctx) throw new Error('Canvas is unavailable in this browser');
			if (look !== 'none') ctx.filter = look;
			paintGifFrameAt(ctx, decoded, frame.timestamp, canvas, mediaTransform);
			ctx.filter = 'none';
			paintImageOverlays(
				ctx,
				imageLayers,
				layerBitmapFor,
				canvas,
				frame.timestamp * 1000,
				layerAssets.painterFor
			);
			paintDrawingGroups(ctx, drawingGroups, canvas);
			paintOverlaysAt(ctx, canvas, frame.timestamp * 1000);
			frames.push({ source: canvas, delayMs: Math.max(20, Math.round(frame.duration * 1000)) });
		}
		const blob = await encodeAnimatedGif(frames, size);
		return {
			file: new File([blob], `meme-${Date.now()}.gif`, { type: 'image/gif' }),
			dim: `${size.width}x${size.height}`,
			durationSec: decoded.duration
		};
	}

	/** GIF + sound cues: realtime recorder pass on the GIF's looped clock
	 *  (the same treatment the desktop gives gif-with-sound exports). */
	async function renderGifVideo(): Promise<RenderedMeme> {
		const decoded = gif;
		if (!decoded) throw new Error('Add a GIF first');
		if (!canRenderVideoMeme())
			throw new Error("This browser can't render animated memes — try Chrome or Edge");
		const runtimeSec = Math.max(
			decoded.duration,
			sfxCues.length ? (sfxCues[sfxCues.length - 1]!.atMs + 800) / 1000 : 0
		);
		const size = evenSize(
			artboardId === 'source'
				? targetSize({ width: decoded.width, height: decoded.height })
				: renderTarget
		);
		const canvas = document.createElement('canvas');
		canvas.width = size.width;
		canvas.height = size.height;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('Canvas is unavailable in this browser');
		const cueTrack = await cueAudioTrack(runtimeSec, sfxCues, cueDecodeSound);
		const look = memeLookCss(lookId);
		const file = await recordMeme({
			canvas,
			totalMs: runtimeSec * 1000,
			extraTracks: cueTrack ? [cueTrack] : [],
			onProgress: (p) => (pubPercent = p),
			paint: (c, elapsedMs) => {
				c.clearRect(0, 0, canvas.width, canvas.height);
				const loopMs = decoded.duration > 0 ? elapsedMs % Math.round(decoded.duration * 1000) : 0;
				if (look !== 'none') c.filter = look;
				paintGifFrameAt(c, decoded, loopMs / 1000, canvas, mediaTransform);
				c.filter = 'none';
				paintImageOverlays(c, imageLayers, layerBitmapFor, canvas, loopMs, layerAssets.painterFor);
				paintDrawingGroups(c, drawingGroups, canvas, loopMs);
				paintOverlaysAt(c, canvas, loopMs);
			}
		});
		return { file, dim: `${size.width}x${size.height}`, durationSec: runtimeSec };
	}

	/** Video render: realtime canvas capture of the trim window at the picked
	 *  speed via the shared `recordMeme` recorder session. */
	async function renderVideo(): Promise<RenderedMeme> {
		if (gif) return renderGifVideo();
		const video = videoEl;
		if (!video) throw new Error('Add a video first');
		const winStart = trimStart;
		const winEnd = (trimEnd ?? video.duration) || 0;
		// Export length under any speed curve: map the trim end through the
		// ramps, then compress by the base rate (mirrors the desktop studio's
		// mediaSpanExportSec math).
		const runtimeSec = Math.max(
			0.5,
			(mediaMsToExportMs(speedWindows, winEnd * 1000) / 1000 - winStart) / (playbackRate || 1)
		);
		const size = evenSize(
			artboardId === 'source'
				? targetSize({
						width: video.videoWidth || 1080,
						height: video.videoHeight || 1920
					})
				: renderTarget
		);
		const canvas = document.createElement('canvas');
		canvas.width = size.width;
		canvas.height = size.height;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('Canvas is unavailable in this browser');
		video.pause();
		video.currentTime = winStart;
		// Ramps multiply the base rate; re-drive every frame as currentTime
		// crosses window boundaries (the desktop recorder does the same).
		const driveRate = () => {
			video.playbackRate = Math.min(
				4,
				Math.max(0.25, playbackRate * rateAt(speedWindows, video.currentTime * 1000))
			);
		};
		driveRate();
		await video.play().catch(() => undefined);
		try {
			// Cue sheet → export timeline (trim window + speed), then a mixed
			// audio track for the recorder (synth-only cues need no decoder).
			const exportCues = shiftCuesForExportWithSpeeds(
				sfxCues,
				speedWindows,
				winStart,
				playbackRate,
				runtimeSec
			);
			const cueTrack = exportCues.length
				? await cueAudioTrack(runtimeSec, exportCues, cueDecodeSound)
				: null;
			const file = await recordMeme({
				canvas,
				totalMs: runtimeSec * 1000,
				extraTracks: cueTrack ? [cueTrack] : [],
				paint: (c) => {
					// Rate curve re-driven per frame; the element's currentTime IS
					// the media clock under the curve.
					driveRate();
					paintMemeBase(c, canvas, {
						mediaKind: 'video',
						gif: null,
						stageImg: null,
						stageVideo: video,
						lookCss: memeLookCss(lookId),
						mediaTransform: composeZoomWithFraming(
							mediaTransform,
							zoomTransformAt(zoomWindows, Math.round(video.currentTime * 1000))
						),
						stageSeconds: video.currentTime,
						fxWindows: fxWindows.length ? fxWindows : undefined,
						fxAtMs: Math.round(video.currentTime * 1000)
					});
					// Overlays stay media-timed via the element clock (the old
					// linear proxy drifted under ramps).
					paintImageOverlays(
						c,
						imageLayers,
						layerBitmapFor,
						canvas,
						Math.round(video.currentTime * 1000),
						layerAssets.painterFor
					);
					paintDrawingGroups(c, drawingGroups, canvas, Math.round(video.currentTime * 1000));
					paintOverlaysAt(c, canvas, Math.round(video.currentTime * 1000));
				},
				onProgress: (p) => (pubPercent = p)
			});
			return { file, dim: `${size.width}x${size.height}`, durationSec: runtimeSec };
		} finally {
			video.pause();
		}
	}

	async function publishNow() {
		if (publishBusy) return;
		if (!mediaUrl || !mediaKind) {
			toasts.error('Add a photo or video first');
			return;
		}
		if (
			(mediaKind === 'video' || (mediaKind === 'image' && sfxCues.length > 0)) &&
			!canRenderVideoMeme()
		) {
			toasts.error("This browser can't render animated memes — try Chrome or Edge");
			return;
		}
		pubError = '';
		pubPercent = 0;
		publishedEventId = null;
		publishedKind = null;
		try {
			pubPhase = 'rendering';
			pubLabel = 'Rendering meme…';
			const rendered = mediaKind === 'video' ? await renderVideo() : await renderStill();

			pubPhase = 'uploading';
			pubLabel = 'Uploading to your media server…';
			pubPercent = 0;
			const uploaded = await media.upload(
				rendered.file,
				selectedProvider === 'none' ? undefined : selectedProvider,
				{
					pubkey: identity.current?.pk,
					purpose: destinations.length === 1 && destinations[0] === 'story' ? 'story' : 'note',
					onProgress: (p) => (pubPercent = p.percent)
				}
			);

			pubPhase = 'publishing';
			pubLabel = 'Broadcasting to relays…';
			pubPercent = 100;
			// @name → nostr:npub… so mentions notify (NIP-27) on every destination
			// (the same rewrite every other caption composer applies at submit).
			caption = rewriteMentions(caption, captionMentions);
			const finalCaption = caption.trim();
			const attachment = {
				url: uploaded.url,
				kind: uploaded.kind as 'image' | 'video',
				mimeType: uploaded.mimeType,
				bytes: uploaded.bytes,
				sha256: uploaded.sha256
			};
			for (const destination of destinations) {
				if (destination === 'bitz') {
					publishedEventId = await feed.postBitz(attachment, {
						caption: finalCaption,
						sensitive,
						dim: rendered.dim,
						duration: rendered.durationSec,
						// Remix lineage rides the event (chain + meme payload +
						// attribution) exactly like the desktop studio publishes.
						extraTags: [
							...(remixSource
								? remixTagsFor(remixSource, {
										overlays,
										// Mobile cue sheet rides the remix wire like the desktop
										// studio — the next creator in the chain remixes sounds too.
										sfxCues,
										// And the color look (wire `l`) — parity with desktop.
										...(lookId !== 'none' ? { lookId } : {}),
										// Effect tracks (wire `z`/`f`/`s`) — lineage parity:
										// a remix made here never drops the source's tracks.
										...(zoomWindows.length ? { zoomWindows } : {}),
										...(fxWindows.length ? { fxWindows } : {}),
										...(speedWindows.length ? { speedWindows } : {})
									})
								: []),
							// AI-004 provenance — only when the creator says so.
							...(aiAssisted ? [aiAssistedTag()] : []),
							// Value-split manifest (CRE-008): rides only when it validates.
							...(splitRows.length && splitCheck.ok ? splitsTagsFor(splitRows) : []),
							...rightsTagsFor(license, remixSource ? sourceCredit : '')
						],
						// NIP-31 alt — same default as the desktop studio.
						alt: finalCaption.slice(0, 200) || undefined,
						// Rare bitz: NIP-13 mining runs inside postBitz before the
						// sign+broadcast (desktop parity — same worker + progress).
						pow: showPow ? pow : 0,
						onPowProgress: (p) => {
							pubLabel = `Mining rare bitz · ${Math.round(
								p.hashrate
							).toLocaleString()} h/s · best ${p.best} bits`;
						},
						onPhase: (phase) => {
							if (phase === 'publishing') {
								pubLabel = 'Broadcasting to relays…';
							}
						}
					});
					publishedKind = 'bitz';
				} else if (destination === 'story') {
					const video =
						mediaKind === 'video'
							? {
									url: uploaded.url,
									mime: uploaded.mimeType,
									bytes: uploaded.bytes
								}
							: undefined;
					await stories.publish(
						finalCaption,
						mediaKind === 'image' ? [uploaded.url] : undefined,
						undefined,
						{
							alt: finalCaption.slice(0, 200) || undefined,
							sensitive,
							video
						}
					);
				} else {
					const noteId = await feed.post(finalCaption, {
						sensitive,
						attachments: [attachment]
					});
					if (!publishedEventId) {
						// Bitz link wins when both destinations posted; note is the fallback.
						publishedEventId = noteId;
						publishedKind = 'note';
					}
				}
			}
			pubPhase = 'done';
			draftWriter.clear(); // the work shipped — nothing to recover
			toasts.success('Published — your meme is live on Nostr');
			powPrefs.remember(showPow ? pow : 0);
			haptic([20, 60, 20]);
		} catch (e) {
			pubPhase = 'error';
			pubError = exportErrorMessage(e);
		}
	}

	function finishPublish() {
		// A published meme is no longer work in progress — clear the resumed
		// slot so /studio stops offering it as resumable (fresh unpublished
		// work never became a slot, so nothing to clean there).
		if (resumedSlotId) memeSlots.remove(resumedSlotId);
		resumedSlotId = null;
		resumedLabel = '';
		resumedMedia = null;
		pubPhase = 'idle';
		pubError = '';
		// Batch mode (mass production): keep the editor open and load the next
		// queued source — caption once, publish N times (desktop parity).
		if (batch.remaining > 0) {
			void stageNextQueued().then((staged) => {
				if (staged) {
					haptic(15);
					toasts.info(
						batch.remaining > 0
							? `Next meme loaded — ${batch.remaining} left in queue`
							: 'Next meme loaded — queue empty'
					);
				} else {
					(onposted ?? onexit)();
				}
			});
			return;
		}
		(onposted ?? onexit)();
	}

	/* ------------------------------------------------------------------ *
	 * Chrome config (mirrors docs/ui/editor-mode.html)
	 * ------------------------------------------------------------------ */

	const modes: { key: EditorMode; label: string }[] = [
		{ key: 'image', label: 'Image' },
		{ key: 'gif', label: 'GIF' },
		{ key: 'video', label: 'Video' }
	];

	const quickTools: {
		id: PanelId;
		icon: string;
		label: string;
		accent?: boolean;
	}[] = [
		{ id: 'meme', icon: 'i-lucide-laugh', label: 'Meme', accent: true },
		{ id: 'text', icon: 'i-lucide-type', label: 'Text' },
		{ id: 'sticker', icon: 'i-lucide-smile-plus', label: 'Sticker' },
		{ id: 'draw', icon: 'i-lucide-pencil', label: 'Draw' },
		{ id: 'audio', icon: 'i-lucide-music', label: 'Audio' },
		{ id: 'fx', icon: 'i-lucide-sparkles', label: 'Effects' },
		{ id: 'templates', icon: 'i-lucide-layout-template', label: 'Layouts' },
		{ id: 'drafts', icon: 'i-lucide-folder-open', label: 'Drafts' }
	];

	/** Draw quick tool: one tap in — activates the surface and opens the tool
	 *  sheet so the creator immediately sees pen/color/size choices. */
	function openDrawTools() {
		drawActive = true;
		openPanel('draw');
	}

	const DRAW_TOOLS: { id: DrawingTool; icon: string; label: string }[] = [
		{ id: 'pen', icon: 'i-lucide-pen-line', label: 'Pen' },
		{ id: 'marker', icon: 'i-lucide-brush', label: 'Marker' },
		{ id: 'eraser', icon: 'i-lucide-eraser', label: 'Eraser' },
		{ id: 'line', icon: 'i-lucide-slash', label: 'Line' },
		{ id: 'arrow', icon: 'i-lucide-move-up-right', label: 'Arrow' },
		{ id: 'rectangle', icon: 'i-lucide-square', label: 'Box' },
		{ id: 'ellipse', icon: 'i-lucide-circle', label: 'Circle' }
	];

	/* Mode toolbar: every label opens EXACTLY what it says (audit 2026-08-27 —
	 * Ratio/Crop/Adjust/Background used to be five aliases for the same Canvas
	 * sheet; "Overlay" opened stickers; AI Gen was a dead toast). The Canvas
	 * sheet itself owns Format (ratio) + Background + Zoom (the crop framing). */
	const modeTools: Record<EditorMode, { icon: string; label: string; action: () => void }[]> = {
		video: [
			{ icon: 'i-lucide-frame', label: 'Canvas', action: () => openPanel('canvas') },
			{ icon: 'i-lucide-scissors', label: 'Trim', action: () => openPanel('trim') },
			{ icon: 'i-lucide-droplet', label: 'Looks', action: () => openPanel('look') },
			{ icon: 'i-lucide-type', label: 'Text', action: () => openPanel('text') },
			{ icon: 'i-lucide-sticker', label: 'Sticker', action: () => openPanel('sticker') }
		],
		image: [
			{ icon: 'i-lucide-frame', label: 'Canvas', action: () => openPanel('canvas') },
			{ icon: 'i-lucide-droplet', label: 'Looks', action: () => openPanel('look') },
			{ icon: 'i-lucide-type', label: 'Text', action: () => openPanel('text') },
			{ icon: 'i-lucide-sticker', label: 'Sticker', action: () => openPanel('sticker') },
			{ icon: 'i-lucide-pencil', label: 'Draw', action: openDrawTools }
		],
		gif: [
			{ icon: 'i-lucide-gauge', label: 'Speed', action: () => openPanel('trim') },
			{ icon: 'i-lucide-library', label: 'Library', action: () => openPanel('gif') },
			{ icon: 'i-lucide-droplet', label: 'Looks', action: () => openPanel('look') },
			{ icon: 'i-lucide-type', label: 'Text', action: () => openPanel('text') },
			{ icon: 'i-lucide-sticker', label: 'Sticker', action: () => openPanel('sticker') }
		]
	} as Record<EditorMode, { icon: string; label: string; action: () => void }[]>;

	const FONT_LABELS: Record<MemeFont, string> = {
		impact: 'Impact',
		sans: 'Sans',
		serif: 'Serif',
		mono: 'Mono'
	};

	const FONT_STACKS: Record<MemeFont, string> = {
		impact: "'Impact','Haettenschweiler','Arial Narrow Bold',sans-serif",
		sans: 'var(--font-sans)',
		serif: "Georgia,'Times New Roman',serif",
		mono: 'var(--font-mono)'
	};

	function overlayStyle(o: MemeTextOverlay): string {
		const shadow = o.stroke
			? `text-shadow: 0.05em 0.05em 0 #000, -0.05em -0.05em 0 #000, 0.05em -0.05em 0 #000, -0.05em 0.05em 0 #000, 0.04em 0.08em 0.12em rgba(0,0,0,0.55);`
			: '';
		return `left:${o.x * 100}%; top:${o.y * 100}%; font-size:${o.size * 100}cqh; font-family:${FONT_STACKS[o.font]}; color:${o.color}; ${o.caps ? 'text-transform:uppercase;' : ''} ${o.bar ? `background:rgba(0,0,0,0.55); border-radius:0.25em; padding:0.08em 0.3em;` : ''} ${shadow}`;
	}
</script>

<svelte:head>
	<title>Meme Studio · BitOS</title>
</svelte:head>

<input
	bind:this={fileInputEl}
	type="file"
	accept="image/*,video/*"
	multiple
	class="hidden"
	onchange={onFilePicked}
/>

<div
	class="relative flex h-full min-h-0 flex-col overflow-hidden bg-black text-white select-none"
	style="padding-top: env(safe-area-inset-top, 0px)"
>
	<!-- ================= 1. Canvas ================= -->
	<div
		bind:this={canvasEl}
		role="presentation"
		class="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-gradient-to-b from-[#141414] to-black"
		style="container-type: size"
		onpointerdown={(event) => {
			// Tap on empty canvas (not an overlay) deselects.
			if (!(event.target as HTMLElement).closest('[data-overlay]')) selectedId = null;
		}}
	>
		{#if loadingScrim}
			<!-- Async seeds (remix fetch / WIP draft restore): progress scrim over
		     the canvas so the stage never flashes half-seeded. -->
			<div
				class="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/80 backdrop-blur-sm"
				role="status"
				aria-live="polite"
			>
				<Icon name={loadingScrim.icon} class="size-8 animate-pulse text-warm-400" />
				<p class="px-8 text-center text-[13px] font-semibold text-white">
					{loadingScrim.kind === 'draft' ? 'Restoring' : 'Loading'} “{loadingScrim.label}”…
				</p>
				<div class="h-1.5 w-40 overflow-hidden rounded-full bg-white/15" aria-hidden="true">
					{#if loadingScrim.kind === 'remix' && remixLoadPercent > 0}
						<div
							class="h-full rounded-full bg-warm-400 transition-[width] duration-200"
							style="width:{remixLoadPercent}%"
						></div>
					{:else}
						<div class="h-full w-1/3 animate-pulse rounded-full bg-warm-400"></div>
					{/if}
				</div>
				{#if loadingScrim.kind === 'remix'}
					<p class="text-[11px] font-medium text-white/60">
						{remixLoadPercent > 0 ? `${remixLoadPercent}%` : 'Connecting…'}
					</p>
				{/if}
			</div>
		{/if}
		<!-- Framed stage: artboard aspect + zoom/pan framing (container for
		     overlay font units too). Empty canvas sits behind everything. -->
		<div
			bind:this={stageEl}
			role="presentation"
			class="relative touch-none overflow-hidden rounded-xl border border-white/10 bg-black"
			style="aspect-ratio: {stageAspect}; width: min(100cqw, calc(100cqh * {stageAspect})); container-type: size"
			onpointerdown={onStagePointerDown}
			onpointermove={onStagePointerMove}
			onpointerup={onStagePointerUp}
			onpointercancel={onStagePointerUp}
		>
			<!-- Media layer -->
			{#if mediaUrl && mediaKind === 'video'}
				<video
					bind:this={videoEl}
					src={mediaUrl}
					class="absolute inset-0 size-full object-cover"
					style="filter: {memeLookCss(
						lookId
					)}; transform: scale({previewTransform.scale}) translate({previewCss.x}%, {previewCss.y}%)"
					playsinline
					muted
					loop
					autoplay
					onloadedmetadata={(e) => {
						mediaNatural = {
							w: e.currentTarget.videoWidth,
							h: e.currentTarget.videoHeight
						};
					}}
					ontimeupdate={(e) => {
						const v = e.currentTarget;
						currentTime = v.currentTime;
						// Manual loop inside the trim window (Phase 2).
						if (trimEnd !== null && v.currentTime >= trimEnd) v.currentTime = trimStart;
						else if (v.currentTime < trimStart - 0.05) v.currentTime = trimStart;
					}}
					ondurationchange={(e) => (duration = e.currentTarget.duration || 0)}
					onplay={() => (playing = true)}
					onpause={() => (playing = false)}
				></video>
			{:else if mediaUrl && gif}
				<!-- Animated GIF: canvas clock (look + framing applied) — the
				     decoded frames play instead of freezing on the first. -->
				<canvas
					bind:this={gifCanvasEl}
					class="absolute inset-0 size-full object-cover"
					aria-label="Animated GIF preview"
				></canvas>
			{:else if mediaUrl}
				<img
					bind:this={imgEl}
					src={mediaUrl}
					alt="Meme source"
					draggable="false"
					style="filter: {memeLookCss(
						lookId
					)}; transform: scale({previewTransform.scale}) translate({previewCss.x}%, {previewCss.y}%)"
					class="absolute inset-0 size-full object-cover"
					onload={(e) => {
						const img = e.currentTarget as HTMLImageElement;
						mediaNatural = {
							w: img.naturalWidth,
							h: img.naturalHeight
						};
					}}
				/>
			{/if}

			<!-- Empty state: tap to import from the camera roll -->
			{#if !mediaUrl}
				<button
					type="button"
					onclick={pickMedia}
					class="absolute inset-4 flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-white/20 text-white/60 transition active:scale-[0.99]"
				>
					<span class="grid size-14 place-items-center rounded-2xl bg-white/8 backdrop-blur-md">
						<Icon name="i-lucide-image-plus" class="size-6" />
					</span>
					<span class="text-[14px] font-bold">Tap to add a photo or video</span>
					<span class="text-[11.5px] text-white/45">
						Camera roll import · no upload until you publish
					</span>
				</button>
			{/if}

			<!-- Sticker layers (Bitz Buddy / Bitzverse): draggable + pinch-scalable.
			     Sized in cqh — the same stage-height fraction the export burns. -->
			{#each imageLayers as layer (layer.id)}
				{#if mediaKind !== 'video' || imageOverlayVisibleAt(layer, Math.round(currentTime * 1000))}
					<img
						src={layer.src}
						alt=""
						draggable="false"
						data-overlay
						class="absolute z-[5] -translate-x-1/2 -translate-y-1/2 touch-none select-none {selectedLayerId ===
						layer.id
							? 'rounded-md ring-2 ring-warm-500/80'
							: ''}"
						style="left:{layer.x * 100}%; top:{layer.y * 100}%; height:{layer.size *
							100}cqh; aspect-ratio: {layer.aspect || 1}; opacity: {layer.opacity ?? 1}; transform:
						translate(-50%, -50%) rotate({layer.rotate ?? 0}deg) scaleX({layer.flipH ? -1 : 1})
						scaleY({layer.flipV ? -1 : 1});"
						onpointerdown={(e) => onLayerPointerDown(e, layer)}
						onpointermove={onLayerPointerMove}
						onpointerup={onLayerPointerUp}
						onpointercancel={onLayerPointerUp}
					/>
					{#if selectedLayerId === layer.id}
						<button
							type="button"
							onclick={() => removeLayer(layer.id)}
							aria-label="Delete sticker"
							class="absolute z-20 grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-warm-500 text-white shadow-lg active:scale-90"
							style="left:calc({layer.x * 100}% + {((layer.size * (layer.aspect || 1)) / 2) *
								100}cqh); top:calc({layer.y * 100}% - {(layer.size / 2) * 100}cqh);"
						>
							<Icon name="i-lucide-x" class="size-3.5" />
						</button>
					{/if}
				{/if}
			{/each}

			<!-- Overlay layer (draggable captions / text / stickers) -->
			{#each overlays as o (o.id)}
				<div
					data-overlay
					class="absolute z-10 max-w-[94%] -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none text-center leading-[1.1] font-bold whitespace-pre-wrap {isStickerOverlay(
						o
					)
						? ''
						: 'px-1'} {selectedId === o.id ? 'rounded-md ring-2 ring-warm-500/80' : ''}"
					style={overlayStyle(o)}
					onpointerdown={(e) => onOverlayPointerDown(e, o)}
					onpointermove={onOverlayPointerMove}
					onpointerup={onOverlayPointerUp}
					onpointercancel={onOverlayPointerUp}
					role="button"
					tabindex="-1"
					aria-label="Overlay: {o.text}"
				>
					{#if selectedId === o.id}
						<button
							type="button"
							onclick={() => removeOverlay(o.id)}
							aria-label="Delete overlay"
							class="absolute -top-2.5 -right-2.5 z-20 grid size-6 place-items-center rounded-full bg-warm-500 text-white shadow-lg active:scale-90"
						>
							<Icon name="i-lucide-x" class="size-3.5" />
						</button>
					{/if}
					{o.caps ? o.text.toUpperCase() : o.text}
				</div>
			{/each}

			<!-- Draw layer: the shared surface stages strokes live on the artboard
			     (pointer-events-none unless draw mode is on, so it never blocks
			     overlay drags). Drawings burn under the captions on export. -->
			<MemeDrawingSurface
				active={drawActive && !loadingScrim}
				groups={drawingGroups}
				tool={drawingTool}
				color={drawingColor}
				width={drawingWidth}
				atMs={mediaKind === 'video' ? Math.round(currentTime * 1000) : undefined}
				onAddStroke={addDrawingStroke}
			/>
		</div>

		<!-- Top controls: exit · mode switcher · undo -->
		<div class="absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-2 px-3 pt-3">
			<button
				type="button"
				onclick={exit}
				aria-label="Close editor"
				class="grid size-10 shrink-0 place-items-center rounded-full border border-white/15 bg-white/10 backdrop-blur-md transition active:scale-95"
			>
				<Icon name="i-lucide-x" class="size-5" />
			</button>

			<div
				class="flex gap-0.5 rounded-full bg-black/45 p-1 backdrop-blur-md"
				role="tablist"
				aria-label="Editor mode"
			>
				{#each modes as m (m.key)}
					<button
						type="button"
						role="tab"
						aria-selected={mode === m.key}
						onclick={() => setMode(m.key)}
						class="rounded-full px-3 py-1.5 text-[12px] font-semibold transition {mode === m.key
							? 'bg-warm-500 text-white shadow-lg shadow-warm-500/30'
							: 'text-white/55'}"
					>
						{m.label}
					</button>
				{/each}
			</div>

			<div class="flex shrink-0 gap-2">
				<button
					type="button"
					onclick={undo}
					aria-label="Undo"
					disabled={undoDepth === 0}
					class="grid size-10 place-items-center rounded-full border border-white/15 bg-white/10 backdrop-blur-md transition active:scale-95 disabled:opacity-40"
				>
					<Icon name="i-lucide-undo-2" class="size-5" />
				</button>
				<button
					type="button"
					onclick={redo}
					aria-label="Redo"
					disabled={redoDepth === 0}
					class="grid size-10 place-items-center rounded-full border border-white/15 bg-white/10 backdrop-blur-md transition active:scale-95 disabled:opacity-40"
				>
					<Icon name="i-lucide-redo-2" class="size-5" />
				</button>
				<button
					type="button"
					onclick={() => openPanel('publish')}
					aria-label="Publish to Nostr"
					title="Publish"
					class="grid size-10 shrink-0 place-items-center rounded-full bg-warm-500 text-white shadow-lg shadow-warm-500/30 transition active:scale-95"
				>
					<Icon name="i-lucide-send" class="size-4.5" />
				</button>
			</div>
		</div>

		<!-- Right quick tools -->
		<div class="absolute top-1/2 right-2 z-30 flex -translate-y-1/2 flex-col gap-3">
			{#each quickTools as tool (tool.id)}
				<button
					type="button"
					onclick={() => (tool.id === 'draw' ? openDrawTools() : openPanel(tool.id))}
					class="relative flex size-12 flex-col items-center justify-center rounded-full border {tool.accent ||
					(tool.id === 'draw' && drawActive)
						? 'border-warm-500/70 bg-white/10 text-warm-500'
						: 'border-white/15 bg-white/10 text-white'} backdrop-blur-md transition active:scale-90"
					aria-pressed={tool.id === 'draw' ? drawActive : undefined}
				>
					<Icon name={tool.icon} class="size-5" />
					<span class="mt-0.5 text-[8px] font-bold">{tool.label}</span>
					{#if tool.id === 'drafts' && memeSlots.list.length}
						<span
							class="absolute -top-1 -right-1 grid size-4.5 place-items-center rounded-full bg-warm-500 text-[9px] font-bold text-white"
							aria-hidden="true"
						>
							{memeSlots.list.length}
						</span>
					{/if}
				</button>
			{/each}
		</div>

		<!-- Play / pause (GIF + Video modes with video media) -->
		{#if mode !== 'image' && mediaKind === 'video'}
			<button
				type="button"
				onclick={togglePlay}
				aria-label={playing ? 'Pause' : 'Play'}
				class="absolute z-20 grid size-14 place-items-center rounded-full border border-white/15 bg-white/10 text-2xl backdrop-blur-md transition active:scale-95 {playing
					? 'opacity-0 transition-opacity hover:opacity-100'
					: ''}"
			>
				<Icon
					name={playing ? 'i-lucide-pause' : 'i-lucide-play'}
					class="size-6 {playing ? '' : 'ml-0.5'}"
				/>
			</button>
		{/if}
	</div>

	<!-- ================= 2. Timeline (GIF + Video) ================= -->
	{#if timelineActive}
		<section
			class="flex shrink-0 flex-col gap-2 border-t border-white/10 bg-[#0d0d0d] px-3 py-2.5 {tracksOpen
				? ''
				: 'h-28 justify-between'}"
			aria-label="Timeline"
		>
			<div
				class="flex items-center justify-between px-1 font-mono text-[10px] text-white/45 tabular-nums"
			>
				<span>00:00</span>
				<span class="text-warm-500">{fmtTime(currentTime)} / {fmtTime(duration)}</span>
				<span class="flex items-center gap-1.5">
					{#if overlays.length || imageLayers.length || sfxCues.length}
						<button
							type="button"
							onclick={() => (tracksOpen = !tracksOpen)}
							aria-pressed={tracksOpen}
							aria-label={tracksOpen ? 'Hide tracks' : 'Show tracks'}
							title="Track editor"
							class="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-sans text-[9px] font-bold text-white/55 transition hover:text-white active:scale-90"
						>
							<Icon name="i-lucide-list" class="size-3" />
							Tracks
							<Icon
								name={tracksOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-up'}
								class="size-3"
							/>
						</button>
					{/if}
					<span>{fmtTime(duration)}</span>
				</span>
			</div>
			<div
				class="relative h-14 touch-none overflow-hidden rounded-lg bg-white/8"
				role="slider"
				tabindex="0"
				aria-label="Playhead position"
				aria-valuemin="0"
				aria-valuemax={Math.round(duration)}
				aria-valuenow={Math.round(currentTime)}
				onkeydown={onTimelineKeydown}
				onpointerdown={onTimelinePointerDown}
				onpointermove={onTimelinePointerMove}
				onpointerup={onTimelinePointerUp}
				onpointercancel={onTimelinePointerUp}
			>
				<!-- Source strip (whole clip) + the trim window shaded over it:
				     cuts at the playhead (Keep ◀/▶) resize this window live, and
				     the export burns exactly what stays lit. -->
				<div
					class="h-full bg-gradient-to-r from-warm-500/35 via-warm-500/20 to-warm-500/35"
					style={mediaUrl
						? `background-image:url('${mediaUrl}');background-size:auto 100%;background-repeat:repeat-x`
						: ''}
				></div>
				<div
					class="pointer-events-none absolute inset-y-0 left-0 bg-black/60 backdrop-grayscale"
					style="width:{duration > 0 ? Math.min(100, (trimStart / duration) * 100) : 0}%"
					aria-hidden="true"
				></div>
				<div
					class="pointer-events-none absolute inset-y-0 right-0 bg-black/60 backdrop-grayscale"
					style="width:{duration > 0
						? 100 - Math.max(0, Math.min(100, ((trimEnd ?? duration) / duration) * 100))
						: 100}%"
					aria-hidden="true"
				></div>
				<!-- Effect-track markers (pointer-events-none — scrub owns the strip):
				     FX windows (primary), zoom punches (cyan), speed ramps (amber). -->
				{#each fxWindows as win (win.startMs + '-' + win.endMs + '-' + win.fx)}
					{@const l = duration > 0 ? (win.startMs / 1000 / duration) * 100 : 0}
					{@const w = duration > 0 ? ((win.endMs - win.startMs) / 1000 / duration) * 100 : 0}
					<span
						class="pointer-events-none absolute top-0.5 h-1.5 rounded-full bg-primary-500/80"
						style="left:{l}%; width:{Math.max(1.5, w)}%"
						title="FX · {win.fx}"
					></span>
				{/each}
				{#each zoomWindows as win (win.startMs + '-' + win.endMs)}
					{@const l = duration > 0 ? (win.startMs / 1000 / duration) * 100 : 0}
					{@const w = duration > 0 ? ((win.endMs - win.startMs) / 1000 / duration) * 100 : 0}
					<span
						class="pointer-events-none absolute top-3 h-1 rounded-full bg-cyan-400/70"
						style="left:{l}%; width:{Math.max(1.5, w)}%"
						title="Zoom punch"
					></span>
				{/each}
				{#each speedWindows as win (win.startMs + '-' + win.endMs)}
					{@const l = duration > 0 ? (win.startMs / 1000 / duration) * 100 : 0}
					{@const w = duration > 0 ? ((win.endMs - win.startMs) / 1000 / duration) * 100 : 0}
					<span
						class="pointer-events-none absolute top-4.5 h-1 rounded-full bg-amber-400/70"
						style="left:{l}%; width:{Math.max(1.5, w)}%"
						title="Speed ramp"
					></span>
				{/each}
				<div
					class="pointer-events-none absolute inset-y-0 w-0.5 bg-warm-500"
					style="left:{playheadPct}%"
				>
					<div class="-mt-1.5 -ml-1.25 size-3 rounded-full bg-warm-500 shadow"></div>
				</div>
				{#each sfxCues as cue (cue.id)}
					{@const pct = duration > 0 ? Math.min(100, (cue.atMs / 1000 / duration) * 100) : 0}
					<span
						class="pointer-events-none absolute bottom-0.5 size-2.5 -translate-x-1/2 rounded-full bg-primary-400 ring-1 ring-black/60"
						style="left:{pct}%"
						title="Sound cue"
					></span>
				{/each}
			</div>
			<!-- Track rows (the desktop timeline's mobile slice): captions, sticker
			     layers and sound cues on the strip's time scale — tap a segment to
			     select it and open its style sheet. -->
			{#if tracksOpen}
				<div class="flex flex-col gap-1">
					{#if overlays.length}
						<div class="flex items-center gap-1.5">
							<span
								class="w-12 shrink-0 text-[8.5px] font-bold tracking-wide text-white/40 uppercase"
								>Text</span
							>
							<div class="relative h-6 min-w-0 flex-1 overflow-hidden rounded bg-white/5">
								{#each overlays as o (o.id)}
									{@const startMs = o.startMs ?? 0}
									{@const endMs = o.endMs ?? duration * 1000}
									{@const left = duration > 0 ? (startMs / 1000 / duration) * 100 : 0}
									{@const width = duration > 0 ? ((endMs - startMs) / 1000 / duration) * 100 : 100}
									<button
										type="button"
										onclick={() => {
											selectedId = o.id;
											openEdit(o.id);
										}}
										title={o.text}
										class="absolute inset-y-0.5 overflow-hidden rounded px-1 text-left text-[8.5px] font-bold whitespace-nowrap transition active:scale-95 {selectedId ===
										o.id
											? 'bg-warm-500/60 text-white'
											: 'bg-warm-500/25 text-white/75'}"
										style="left:{left}%; width:{Math.max(4, width)}%"
									>
										{o.text}
									</button>
								{/each}
							</div>
						</div>
					{/if}
					{#if imageLayers.length}
						<div class="flex items-center gap-1.5">
							<span
								class="w-12 shrink-0 text-[8.5px] font-bold tracking-wide text-white/40 uppercase"
								>Stickers</span
							>
							<div class="relative h-6 min-w-0 flex-1 overflow-hidden rounded bg-white/5">
								{#each imageLayers as layer (layer.id)}
									{@const startMs = layer.startMs ?? 0}
									{@const endMs = layer.endMs ?? duration * 1000}
									{@const left = duration > 0 ? (startMs / 1000 / duration) * 100 : 0}
									{@const width = duration > 0 ? ((endMs - startMs) / 1000 / duration) * 100 : 100}
									<button
										type="button"
										onclick={() => {
											selectedLayerId = layer.id;
											openLayerEdit(layer.id);
										}}
										title="Sticker layer"
										class="absolute inset-y-0.5 overflow-hidden rounded px-1 text-left text-[8.5px] font-bold whitespace-nowrap transition active:scale-95 {selectedLayerId ===
										layer.id
											? 'bg-primary-500/60 text-white'
											: 'bg-primary-500/25 text-white/75'}"
										style="left:{left}%; width:{Math.max(4, width)}%"
									>
										sticker
									</button>
								{/each}
							</div>
						</div>
					{/if}
					{#if sfxCues.length}
						<div class="flex items-center gap-1.5">
							<span
								class="w-12 shrink-0 text-[8.5px] font-bold tracking-wide text-white/40 uppercase"
								>Sounds</span
							>
							<div class="relative h-6 min-w-0 flex-1 overflow-hidden rounded bg-white/5">
								{#each sfxCues as cue (cue.id)}
									{@const left = duration > 0 ? (cue.atMs / 1000 / duration) * 100 : 0}
									<button
										type="button"
										onclick={() => {
											if (cue.sfx === CUSTOM_SOUND_KEY && cue.soundId) {
												const sound = soundLibrary.list.find((s) => s.id === cue.soundId);
												if (sound) previewSound(sound);
												return;
											}
											previewSfx(cue.sfx as MemeSfxId);
										}}
										title={cueLabel(cue)}
										class="absolute top-1 bottom-1 w-2.5 -translate-x-1/2 rounded-full bg-primary-400/80 transition active:scale-90"
										style="left:{left}%"
									></button>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			{/if}
			{#if mediaKind === 'video'}
				<!-- Cut & window actions (video): contiguous non-destructive cuts at
			     the playhead (exactly what the export burns), the window reset,
			     and the Trim & speed sheet. -->
				<div class="flex items-center justify-around text-white/60">
					<button
						type="button"
						class="flex flex-col items-center gap-0.5 text-[9px] font-semibold transition active:scale-90"
						onclick={() => cutAtPlayhead('before')}
						title="Cut here — keep the start of the video"
					>
						<Icon name="i-lucide-scissors" class="text-[14px]" />Keep ◀
					</button>
					<button
						type="button"
						class="flex flex-col items-center gap-0.5 text-[9px] font-semibold transition active:scale-90"
						onclick={() => cutAtPlayhead('after')}
						title="Cut here — keep the end of the video"
					>
						<Icon name="i-lucide-scissors" class="text-[14px]" />Keep ▶
					</button>
					<button
						type="button"
						class="flex flex-col items-center gap-0.5 text-[9px] font-semibold transition active:scale-90"
						onclick={() => {
							trimStart = 0;
							trimEnd = null;
							playbackRate = 1;
							toasts.info('Window reset to the full clip');
							haptic();
						}}
						title="Reset the trim window to the full clip"
					>
						<Icon name="i-lucide-rotate-ccw" class="text-[14px]" />Reset
					</button>
					<button
						type="button"
						class="flex flex-col items-center gap-0.5 text-[9px] font-semibold transition active:scale-90"
						onclick={() => openPanel('trim')}
						title="Trim & speed sheet"
					>
						<Icon name="i-lucide-timer" class="text-[14px]" />Speed
					</button>
					<button
						type="button"
						class="flex flex-col items-center gap-0.5 text-[9px] font-semibold transition active:scale-90"
						onclick={() => openPanel('audio')}
						title="Sound cues"
					>
						<Icon name="i-lucide-music" class="text-[14px]" />Sounds
					</button>
				</div>
			{/if}
		</section>
	{/if}

	<!-- ================= 2b. Batch queue strip (mass production) =================
	     Multi-picked sources wait in line; publish or Skip loads the next
	     (caption layout stays — normalized coords are media-agnostic). -->
	{#if batch.remaining > 0}
		<section
			class="flex h-14 shrink-0 items-center gap-2 border-t border-warm-500/25 bg-warm-500/10 px-3"
			aria-label="Batch queue"
		>
			<span class="flex shrink-0 items-center gap-1.5 text-[11px] font-bold text-warm-400">
				<Icon name="i-lucide-list-video" class="size-4" />
				{batch.remaining} queued
			</span>
			<div class="flex min-w-0 flex-1 scrollbar-thin gap-1.5 overflow-x-auto">
				{#each batch.remainingItems as item, index (item.id)}
					{@const thumb = queueThumbUrls.get(item.id)}
					<span
						class="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-black/35 pr-2 pl-1"
						title={item.label}
					>
						<span
							class="grid size-7 shrink-0 place-items-center overflow-hidden rounded-md bg-white/10"
							aria-hidden="true"
						>
							{#if thumb}
								<img src={thumb} alt="" class="size-full object-cover" />
							{:else if item.file && item.file.type.startsWith('video/')}
								<Icon name="i-lucide-film" class="size-3.5 text-white/50" />
							{:else}
								<Icon name="i-lucide-image" class="size-3.5 text-white/50" />
							{/if}
						</span>
						<span class="max-w-24 truncate text-[10.5px] font-semibold text-white/80">
							{index === 0 ? 'Next · ' : ''}{item.label}
						</span>
					</span>
				{/each}
			</div>
			<button
				type="button"
				onclick={() => void stageNextQueued().then((staged) => staged && haptic())}
				aria-label="Skip to the next queued clip"
				title="Skip to “{batch.peekLabel}”"
				class="grid size-8 shrink-0 place-items-center rounded-full bg-white/10 text-warm-400 transition active:scale-90"
			>
				<Icon name="i-lucide-skip-forward" class="size-4" />
			</button>
			<button
				type="button"
				onclick={clearQueue}
				aria-label="Clear the batch queue"
				class="grid size-8 shrink-0 place-items-center rounded-full bg-white/10 text-white/60 transition hover:text-[var(--tone-error-text,#ef4444)] active:scale-90"
			>
				<Icon name="i-lucide-x" class="size-4" />
			</button>
		</section>
	{/if}

	<!-- ================= 3. Mode toolbar ================= -->
	<div
		class="flex h-[4.5rem] shrink-0 items-center justify-around border-t border-white/10 bg-black px-2"
		style="padding-bottom: env(safe-area-inset-bottom, 0px)"
	>
		{#each modeTools[mode] as tool (tool.label)}
			<button
				type="button"
				onclick={tool.action}
				class="flex flex-col items-center gap-1 text-[10px] font-semibold text-white/60 transition active:scale-95"
			>
				<Icon name={tool.icon} class="text-[20px]" />
				{tool.label}
			</button>
		{/each}
	</div>

	<!-- ================= 4. Bottom sheets (URL-driven) ================= -->
	<StudioSheet
		open={panel === 'meme'}
		title="Meme generator"
		icon="i-lucide-laugh"
		onclose={closeSheet}
	>
		<div class="flex flex-col gap-3">
			<input
				bind:value={memeTop}
				type="text"
				placeholder="TOP TEXT"
				class="w-full rounded-lg bg-black/40 p-3 text-center text-xl font-bold tracking-wider uppercase ring-warm-500/60 outline-none focus:ring-2"
				style="font-family:{FONT_STACKS[memeFont]}"
			/>
			<input
				bind:value={memeBottom}
				type="text"
				placeholder="BOTTOM TEXT"
				class="w-full rounded-lg bg-black/40 p-3 text-center text-xl font-bold tracking-wider uppercase ring-warm-500/60 outline-none focus:ring-2"
				style="font-family:{FONT_STACKS[memeFont]}"
			/>
			<div class="flex gap-2">
				{#each Object.entries(FONT_STACKS) as [font, stack] (font)}
					<button
						type="button"
						onclick={() => (memeFont = font as MemeFont)}
						class="flex-1 rounded-lg bg-white/10 py-2 text-sm transition {memeFont === font
							? 'ring-2 ring-warm-500'
							: ''}"
						style="font-family:{stack}"
					>
						{FONT_LABELS[font as MemeFont]}
					</button>
				{/each}
			</div>
			<button
				type="button"
				onclick={addMemePair}
				disabled={!memeTop.trim() && !memeBottom.trim()}
				class="w-full rounded-full bg-warm-500 py-3 text-[14px] font-bold text-white transition active:scale-[0.98] disabled:opacity-40"
			>
				Add to canvas
			</button>
		</div>
	</StudioSheet>

	<StudioSheet open={panel === 'text'} title="Add text" icon="i-lucide-type" onclose={closeSheet}>
		<div class="flex flex-col gap-3">
			<textarea
				bind:value={freeText}
				placeholder="Type something…"
				class="h-20 w-full resize-none rounded-lg bg-black/40 p-3 text-[15px] ring-warm-500/60 outline-none focus:ring-2"
			></textarea>
			<button
				type="button"
				onclick={addFreeText}
				disabled={!freeText.trim()}
				class="w-full rounded-full bg-warm-500 py-3 text-[14px] font-bold text-white transition active:scale-[0.98] disabled:opacity-40"
			>
				Add text
			</button>
		</div>
	</StudioSheet>

	<StudioSheet
		open={panel === 'sticker'}
		title="Stickers"
		icon="i-lucide-smile-plus"
		onclose={closeSheet}
	>
		<div class="flex flex-col gap-4">
			{#each STICKER_PACKS as pack (pack.id)}
				<div>
					<p class="mb-1.5 text-[11px] font-bold tracking-wide text-white/50 uppercase">
						{pack.label}
					</p>
					<div class="grid grid-cols-4 gap-2">
						{#each pack.stickers as emoji (emoji)}
							<button
								type="button"
								onclick={() => addSticker(emoji)}
								class="rounded-lg bg-white/5 py-2.5 text-3xl transition active:scale-90"
							>
								{emoji}
							</button>
						{/each}
					</div>
				</div>
			{/each}

			<!-- Bitz Buddy figures + Bitzverse props (shared catalogs): drop as
			     draggable sticker layers on the shared MemeImageOverlay schema. -->
			<div>
				<p class="mb-1.5 text-[11px] font-bold tracking-wide text-white/50 uppercase">
					Bitz buddies
				</p>
				<div class="grid grid-cols-4 gap-2">
					{#each BUDDY_FIGURES as figure (figure.id)}
						<button
							type="button"
							onclick={() => addBuddyLayer(figure)}
							title="Add {figure.label}"
							class="flex flex-col items-center gap-1 rounded-lg bg-white/5 px-1 py-2 transition active:scale-90"
						>
							<img src={figure.src} alt="" class="size-8" draggable="false" />
							<span class="text-[9px] leading-tight font-bold text-white/70">
								{figure.emoji}
								{figure.label}
							</span>
						</button>
					{/each}
				</div>
			</div>

			<div>
				<p class="mb-1.5 text-[11px] font-bold tracking-wide text-white/50 uppercase">Bitzverse</p>
				<div class="grid grid-cols-4 gap-2">
					{#each BITZVERSE_PROPS as prop (prop.id)}
						<button
							type="button"
							onclick={() => addBuddyLayer(prop)}
							title="Add {prop.label}"
							class="flex flex-col items-center gap-1 rounded-lg bg-white/5 px-1 py-2 transition active:scale-90"
						>
							<img src={prop.src} alt="" class="size-8" draggable="false" />
							<span class="text-[9px] leading-tight font-bold text-white/70">
								{prop.emoji}
								{prop.label}
							</span>
						</button>
					{/each}
				</div>
			</div>
		</div>
	</StudioSheet>

	<!-- Edit overlay style sheet (`?edit=<id>` — tap a selected overlay). -->
	<StudioSheet open={!!editing} title="Edit overlay" icon="i-lucide-pen-line" onclose={closeSheet}>
		{#if editing}
			<div class="flex flex-col gap-4">
				<textarea
					value={editing.text}
					oninput={(e) => patchOverlay(editing.id, { text: e.currentTarget.value })}
					placeholder="Caption text…"
					class="h-20 w-full resize-none rounded-lg bg-black/40 p-3 text-[15px] ring-warm-500/60 outline-none focus:ring-2"
					style="font-family:{FONT_STACKS[editing.font]}; color:{editing.color}"></textarea>

				<!-- Color swatches (same palette as the desktop studio). -->
				<div class="flex flex-wrap items-center gap-2">
					{#each MEME_COLORS as color (color)}
						<button
							type="button"
							aria-label="Color {color}"
							onclick={() => patchOverlay(editing.id, { color })}
							class="size-8 rounded-full border-2 transition active:scale-90 {editing.color ===
							color
								? 'border-warm-500 ring-2 ring-warm-500/60'
								: 'border-white/25'}"
							style="background:{color}"
						></button>
					{/each}
				</div>

				<!-- Font chips. -->
				<div class="flex gap-2">
					{#each Object.entries(FONT_STACKS) as [font, stack] (font)}
						<button
							type="button"
							onclick={() => patchOverlay(editing.id, { font: font as MemeFont })}
							class="flex-1 rounded-lg bg-white/10 py-2 text-sm transition {editing.font === font
								? 'ring-2 ring-warm-500'
								: ''}"
							style="font-family:{stack}"
						>
							{FONT_LABELS[font as MemeFont]}
						</button>
					{/each}
				</div>

				<!-- Size. -->
				<label class="flex flex-col gap-1.5">
					<span class="text-[11px] font-bold tracking-wide text-white/50 uppercase">
						Size · {Math.round(editing.size * 100)}%
					</span>
					<input
						type="range"
						min="4"
						max="22"
						step="1"
						value={Math.round(editing.size * 100)}
						oninput={(e) => patchOverlay(editing.id, { size: Number(e.currentTarget.value) / 100 })}
						class="accent-warm-500"
					/>
				</label>

				<!-- Style toggles. -->
				<div class="flex gap-2">
					<button
						type="button"
						onclick={() => patchOverlay(editing.id, { stroke: !editing.stroke })}
						class="flex-1 rounded-full py-2 text-[12px] font-bold transition {editing.stroke
							? 'bg-warm-500 text-white'
							: 'bg-white/10 text-white/70'}"
					>
						Outline
					</button>
					<button
						type="button"
						onclick={() => patchOverlay(editing.id, { bar: !editing.bar })}
						class="flex-1 rounded-full py-2 text-[12px] font-bold transition {editing.bar
							? 'bg-warm-500 text-white'
							: 'bg-white/10 text-white/70'}"
					>
						Bar
					</button>
					<button
						type="button"
						onclick={() => patchOverlay(editing.id, { caps: !editing.caps })}
						class="flex-1 rounded-full py-2 text-[12px] font-bold uppercase transition {editing.caps
							? 'bg-warm-500 text-white'
							: 'bg-white/10 text-white/70'}"
					>
						caps
					</button>
				</div>

				<div class="mt-1 flex gap-2">
					<button
						type="button"
						onclick={() => {
							removeOverlay(editing.id);
							closeSheet();
						}}
						class="flex-1 rounded-full bg-[var(--tone-error-bg,rgba(239,68,68,0.16))] py-3 text-[13px] font-bold text-[var(--tone-error-text,#ef4444)] transition active:scale-[0.98]"
					>
						Delete
					</button>
					<button
						type="button"
						onclick={closeSheet}
						class="flex-1 rounded-full bg-warm-500 py-3 text-[13px] font-bold text-white transition active:scale-[0.98]"
					>
						Done
					</button>
				</div>
			</div>
		{/if}
	</StudioSheet>

	<!-- Sticker layer style sheet (`?layer=<id>` — second tap on a selected
	     sticker): rotate/flip/opacity + timing windows on video — every field
	     the export burns (`paintImageOverlays`), desktop inspector parity. -->
	<StudioSheet
		open={!!layerEditing}
		title="Edit sticker"
		icon="i-lucide-sticker"
		onclose={closeSheet}
	>
		{#if layerEditing}
			{@const id = layerEditing.id}
			<div class="flex flex-col gap-4">
				<div>
					<p class="mb-1.5 text-[11px] font-bold tracking-wide text-white/50 uppercase">Rotate</p>
					<div class="flex gap-2">
						<button
							type="button"
							onclick={() =>
								patchLayer(id, { rotate: ((layerEditing.rotate ?? 0) - 90 + 360) % 360 })}
							class="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-white/10 py-2.5 text-[12px] font-bold text-white/80 transition active:scale-[0.98]"
						>
							<Icon name="i-lucide-rotate-ccw" class="size-4" />−90°
						</button>
						<button
							type="button"
							onclick={() => patchLayer(id, { rotate: ((layerEditing.rotate ?? 0) + 90) % 360 })}
							class="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-white/10 py-2.5 text-[12px] font-bold text-white/80 transition active:scale-[0.98]"
						>
							<Icon name="i-lucide-rotate-cw" class="size-4" />+90°
						</button>
						{#if layerEditing.rotate}
							<button
								type="button"
								onclick={() => patchLayer(id, { rotate: 0 })}
								class="flex-1 rounded-full bg-white/10 py-2.5 text-[12px] font-bold text-white/80 transition active:scale-[0.98]"
							>
								Reset
							</button>
						{/if}
					</div>
				</div>

				<div class="flex gap-2">
					<button
						type="button"
						onclick={() => patchLayer(id, { flipH: !layerEditing.flipH })}
						aria-pressed={layerEditing.flipH ?? false}
						class="flex flex-1 items-center justify-center gap-1.5 rounded-full py-2.5 text-[12px] font-bold transition {layerEditing.flipH
							? 'bg-warm-500 text-white'
							: 'bg-white/10 text-white/70'}"
					>
						<Icon name="i-lucide-flip-horizontal" class="size-4" />Flip H
					</button>
					<button
						type="button"
						onclick={() => patchLayer(id, { flipV: !layerEditing.flipV })}
						aria-pressed={layerEditing.flipV ?? false}
						class="flex flex-1 items-center justify-center gap-1.5 rounded-full py-2.5 text-[12px] font-bold transition {layerEditing.flipV
							? 'bg-warm-500 text-white'
							: 'bg-white/10 text-white/70'}"
					>
						<Icon name="i-lucide-flip-vertical" class="size-4" />Flip V
					</button>
				</div>

				<label class="flex flex-col gap-1.5">
					<span class="text-[11px] font-bold tracking-wide text-white/50 uppercase">
						Size · {Math.round(layerEditing.size * 100)}% of frame
					</span>
					<input
						type="range"
						min="0.05"
						max="0.9"
						step="0.01"
						value={layerEditing.size}
						oninput={(e) => patchLayer(id, { size: Number(e.currentTarget.value) })}
						class="accent-warm-500"
					/>
					<span class="text-[10px] text-white/40">Or pinch the sticker on the canvas.</span>
				</label>

				<label class="flex flex-col gap-1.5">
					<span class="text-[11px] font-bold tracking-wide text-white/50 uppercase">
						Opacity · {Math.round((layerEditing.opacity ?? 1) * 100)}%
					</span>
					<input
						type="range"
						min="0.05"
						max="1"
						step="0.05"
						value={layerEditing.opacity ?? 1}
						oninput={(e) => patchLayer(id, { opacity: Number(e.currentTarget.value) })}
						class="accent-warm-500"
					/>
				</label>

				{#if mediaKind === 'video' && duration > 0}
					<div class="rounded-xl bg-black/40 p-2.5">
						<p class="mb-1.5 text-[11px] font-bold tracking-wide text-white/50 uppercase">
							Visible window (video)
						</p>
						<label class="flex flex-col gap-1.5">
							<span class="text-[10.5px] font-bold text-white/45 uppercase">
								From · {((layerEditing.startMs ?? 0) / 1000).toFixed(1)}s
							</span>
							<input
								type="range"
								min="0"
								max={duration}
								step="0.1"
								value={(layerEditing.startMs ?? 0) / 1000}
								oninput={(e) => {
									const v = Number(e.currentTarget.value);
									patchLayer(id, {
										startMs: v > 0 ? Math.round(v * 1000) : undefined,
										endMs: layerEditing.endMs
									});
								}}
								class="accent-warm-500"
							/>
						</label>
						<label class="mt-1.5 flex flex-col gap-1.5">
							<span class="text-[10.5px] font-bold text-white/45 uppercase">
								Until · {((layerEditing.endMs ?? duration * 1000) / 1000).toFixed(1)}s
							</span>
							<input
								type="range"
								min="0"
								max={duration}
								step="0.1"
								value={(layerEditing.endMs ?? duration * 1000) / 1000}
								oninput={(e) => {
									const v = Number(e.currentTarget.value);
									patchLayer(id, {
										startMs: layerEditing.startMs,
										endMs: v < duration ? Math.round(v * 1000) : undefined
									});
								}}
								class="accent-warm-500"
							/>
						</label>
						{#if layerEditing.startMs !== undefined || layerEditing.endMs !== undefined}
							<button
								type="button"
								onclick={() => patchLayer(id, { startMs: undefined, endMs: undefined })}
								class="mt-1.5 w-full rounded-full bg-white/10 py-2 text-[12px] font-bold text-white/80"
							>
								Always visible
							</button>
						{/if}
					</div>
				{/if}

				<div class="mt-1 flex gap-2">
					<button
						type="button"
						onclick={() => {
							removeLayer(id);
							closeSheet();
						}}
						class="flex-1 rounded-full bg-[var(--tone-error-bg,rgba(239,68,68,0.16))] py-3 text-[13px] font-bold text-[var(--tone-error-text,#ef4444)] transition active:scale-[0.98]"
					>
						Delete
					</button>
					<button
						type="button"
						onclick={closeSheet}
						class="flex-1 rounded-full bg-warm-500 py-3 text-[13px] font-bold text-white transition active:scale-[0.98]"
					>
						Done
					</button>
				</div>
			</div>
		{/if}
	</StudioSheet>

	<!-- Trim & speed sheet (video; persisted as MemeSlot trim fields). -->
	<StudioSheet
		open={panel === 'trim'}
		title="Trim & speed"
		icon="i-lucide-scissors"
		onclose={closeSheet}
	>
		{#if duration > 0}
			<div class="flex flex-col gap-4">
				<p class="text-center font-mono text-[13px] text-warm-500 tabular-nums">
					{fmtTime(trimStart)} — {fmtTime(trimEnd ?? duration)} ·
					{((trimEnd ?? duration) - trimStart).toFixed(1)}s
				</p>
				<label class="flex flex-col gap-1.5">
					<span class="text-[11px] font-bold tracking-wide text-white/50 uppercase">Start</span>
					<input
						type="range"
						min="0"
						max={Math.max(0, (trimEnd ?? duration) - 0.5)}
						step="0.1"
						value={trimStart}
						oninput={(e) => {
							const v = Number(e.currentTarget.value);
							trimStart = Math.min(v, (trimEnd ?? duration) - 0.5);
							if (videoEl) videoEl.currentTime = trimStart;
						}}
						class="accent-warm-500"
					/>
				</label>
				<label class="flex flex-col gap-1.5">
					<span class="text-[11px] font-bold tracking-wide text-white/50 uppercase">End</span>
					<input
						type="range"
						min={Math.min(duration, trimStart + 0.5)}
						max={duration}
						step="0.1"
						value={trimEnd ?? duration}
						oninput={(e) => (trimEnd = Math.max(Number(e.currentTarget.value), trimStart + 0.5))}
						class="accent-warm-500"
					/>
				</label>
				<div>
					<p class="mb-1.5 text-[11px] font-bold tracking-wide text-white/50 uppercase">Speed</p>
					<div class="flex gap-2">
						{#each [0.5, 0.75, 1, 1.25, 1.5, 2] as rate (rate)}
							<button
								type="button"
								onclick={() => (playbackRate = rate)}
								class="flex-1 rounded-lg py-2 text-[12px] font-bold transition {playbackRate ===
								rate
									? 'bg-warm-500 text-white'
									: 'bg-white/10 text-white/70'}"
							>
								{rate}×
							</button>
						{/each}
					</div>
				</div>
				<button
					type="button"
					onclick={() => {
						trimStart = 0;
						trimEnd = null;
						playbackRate = 1;
					}}
					class="w-full rounded-full bg-white/10 py-2.5 text-[13px] font-bold text-white/80 transition active:scale-[0.98]"
				>
					Reset window
				</button>
			</div>
		{:else}
			<p class="py-6 text-center text-[13px] text-white/50">Add a video to trim it.</p>
		{/if}
	</StudioSheet>

	<!-- Looks sheet (CSS filter presets shared with the desktop studio). -->
	<StudioSheet open={panel === 'look'} title="Looks" icon="i-lucide-droplet" onclose={closeSheet}>
		<div class="grid grid-cols-4 gap-2.5">
			{#each MEME_LOOKS as look (look.id)}
				<button
					type="button"
					onclick={() => (lookId = look.id as MemeLookId)}
					class="rounded-xl p-1 text-center transition active:scale-95 {lookId === look.id
						? 'ring-2 ring-warm-500'
						: ''}"
				>
					<span
						class="block h-16 rounded-lg"
						style="background:linear-gradient(135deg,#f472b6,#fbbf24,#22d3ee);filter:{memeLookCss(
							look.id
						)}"
					></span>
					<span class="mt-1 block text-[10.5px] font-bold text-white/80">{look.label}</span>
				</button>
			{/each}
		</div>
		<p class="mt-3 text-[10.5px] leading-relaxed text-white/40">
			Looks preview live and burn into the export exactly as shown — the same presets as the desktop
			studio.
		</p>
	</StudioSheet>

	<!-- Soundboard sheet (Phase 4 — the Audio quick tool). -->
	<StudioSheet open={panel === 'audio'} title="Sounds" icon="i-lucide-music" onclose={closeSheet}>
		<div class="flex flex-col gap-4">
			<!-- Staged cues -->
			{#if sfxCues.length}
				<div>
					<p class="mb-1.5 text-[11px] font-bold tracking-wide text-white/50 uppercase">
						Cue sheet · {sfxCues.length}/{MAX_SFX_CUES}
					</p>
					<div class="flex flex-col gap-1.5">
						{#each sfxCues as cue (cue.id)}
							<div class="flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-1.5">
								<button
									type="button"
									onclick={() => {
										if (cue.sfx === CUSTOM_SOUND_KEY && cue.soundId) {
											const sound = soundLibrary.list.find((s) => s.id === cue.soundId);
											if (sound) previewSound(sound);
											return;
										}
										previewSfx(cue.sfx as MemeSfxId);
									}}
									aria-label="Preview {cueLabel(cue)}"
									class="grid size-7 shrink-0 place-items-center rounded-full bg-primary-500/15 text-primary-500"
								>
									<Icon name="i-lucide-play" class="size-3.5" />
								</button>
								<span class="min-w-0 flex-1 truncate text-[12px] font-bold">
									{cueLabel(cue)}
								</span>
								<span class="shrink-0 font-mono text-[10.5px] text-white/45 tabular-nums">
									{fmtTime(cue.atMs / 1000)}
								</span>
								<button
									type="button"
									onclick={() => removeSfxCue(cue.id)}
									aria-label="Remove cue"
									class="grid size-7 shrink-0 place-items-center rounded-full text-white/45 transition hover:text-[var(--tone-error-text,#ef4444)]"
								>
									<Icon name="i-lucide-x" class="size-3.5" />
								</button>
							</div>
						{/each}
					</div>
					<p class="mt-1 text-[10.5px] text-white/40">
						{#if mediaKind === 'video'}
							Sounds fire at their cue point and burn into the published video.
						{:else}
							An image with sounds publishes as a short video.
						{/if}
					</p>
				</div>
			{/if}

			<!-- Saved library sounds (shared store — the /more/sounds page writes
			     here): tap = audition + stage a custom cue, mixed into exports
			     through the same library decoder the desktop uses. -->
			{#if soundLibrary.list.length}
				<div>
					<p class="mb-1.5 text-[11px] font-bold tracking-wide text-white/50 uppercase">
						Your sounds · {soundLibrary.list.length}
					</p>
					<div class="flex flex-col gap-1.5">
						{#each soundLibrary.list as sound (sound.id)}
							<button
								type="button"
								onclick={() => {
									previewSound(sound);
									addCustomCue(sound);
								}}
								class="flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-1.5 text-left transition active:scale-[0.98]"
							>
								<span
									class="grid size-7 shrink-0 place-items-center rounded-full bg-warm-500/15 text-warm-400"
									aria-hidden="true"
								>
									<Icon name="i-lucide-audio-lines" class="size-3.5" />
								</span>
								<span class="min-w-0 flex-1 truncate text-[12px] font-bold">{sound.label}</span>
								<span class="shrink-0 font-mono text-[10.5px] text-white/45 tabular-nums">
									{sound.durationSec.toFixed(1)}s
								</span>
							</button>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Sound pads by vibe -->
			{#each SFX_BUCKETS as bucket (bucket.id)}
				<div>
					<p class="mb-1.5 text-[11px] font-bold tracking-wide text-white/50 uppercase">
						{bucket.label}
					</p>
					<div class="grid grid-cols-4 gap-2">
						{#each bucket.ids as sfx (sfx)}
							<button
								type="button"
								onclick={() => {
									previewSfx(sfx as MemeSfxId);
									addSfxCue(sfx as MemeSfxId);
								}}
								class="rounded-lg bg-white/5 px-1 py-2.5 text-[10.5px] leading-tight font-bold text-white/80 transition active:scale-90"
							>
								{SFX_LABELS[sfx as MemeSfxId]}
							</button>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	</StudioSheet>

	<!-- GIF library sheet (`?panel=gif`): the shared Giphy picker (inline
	     variant) — trending + search + stickers. Single pick stages through
	     the fetcher; multi-pick queues the rest for mass production. -->
	<StudioSheet
		open={panel === 'gif'}
		title="GIF library"
		icon="i-lucide-library"
		onclose={closeSheet}
	>
		<div class="mb-2 flex rounded-full bg-black/40 p-1">
			<button
				type="button"
				onclick={() => (gifPickAsLayer = false)}
				aria-pressed={!gifPickAsLayer}
				class="flex-1 rounded-full py-1.5 text-[12px] font-bold transition {!gifPickAsLayer
					? 'bg-warm-500 text-white'
					: 'text-white/55'}"
			>
				As base
			</button>
			<button
				type="button"
				onclick={() => (gifPickAsLayer = true)}
				aria-pressed={gifPickAsLayer}
				class="flex-1 rounded-full py-1.5 text-[12px] font-bold transition {gifPickAsLayer
					? 'bg-warm-500 text-white'
					: 'text-white/55'}"
			>
				As sticker
			</button>
		</div>
		<div class="h-[48vh]">
			<GifPicker
				variant="inline"
				multiple
				onpick={(gif) => (gifPickAsLayer ? addGifLayer(gif) : void pickGifForStage(gif))}
				onpickmany={(gifs) => {
					if (gifPickAsLayer) {
						for (const gif of gifs) addGifLayer(gif);
						return;
					}
					void pickGifsForStage(gifs);
				}}
			/>
		</div>
	</StudioSheet>

	<!-- FX sheet (`?panel=fx`): timed frame-FX windows (the desktop FX picker
	     model). Tap an effect to start a 600ms window at the playhead; the
	     track lists windows with per-window strength + delete. Burns into
	     every export exactly like the desktop studio. -->
	<StudioSheet open={panel === 'fx'} title="Effects" icon="i-lucide-sparkles" onclose={closeSheet}>
		<div class="flex flex-col gap-4">
			<div>
				<p class="mb-1.5 text-[11px] font-bold tracking-wide text-white/50 uppercase">
					Tap to add at the playhead ({(playheadMs() / 1000).toFixed(1)}s)
				</p>
				<div class="grid grid-cols-3 gap-2">
					{#each FRAME_FX_IDS as fx (fx)}
						<button
							type="button"
							onclick={() => addFxWindow(fx)}
							class="rounded-lg bg-white/5 px-1 py-2.5 text-[10.5px] leading-tight font-bold text-white/80 transition active:scale-90"
						>
							{FRAME_FX_LABELS[fx]}
						</button>
					{/each}
				</div>
			</div>

			{#if fxWindows.length}
				<div>
					<p class="mb-1.5 text-[11px] font-bold tracking-wide text-white/50 uppercase">
						FX track · {fxWindows.length}/{MAX_FX_WINDOWS}
					</p>
					<div class="flex flex-col gap-2">
						{#each fxWindows as win, index (index)}
							<div class="rounded-lg bg-white/5 px-2.5 py-2">
								<div class="flex items-center gap-2">
									<span class="min-w-0 flex-1 truncate text-[12px] font-bold">
										{FRAME_FX_LABELS[win.fx]}
									</span>
									<span class="shrink-0 font-mono text-[10.5px] text-white/45 tabular-nums">
										{(win.startMs / 1000).toFixed(1)}–{(win.endMs / 1000).toFixed(1)}s
									</span>
									<button
										type="button"
										onclick={() => removeFxWindow(index)}
										aria-label="Remove {FRAME_FX_LABELS[win.fx]} window"
										class="grid size-7 shrink-0 place-items-center rounded-full text-white/45 transition hover:text-[var(--tone-error-text,#ef4444)]"
									>
										<Icon name="i-lucide-x" class="size-3.5" />
									</button>
								</div>
								<label class="mt-1 flex items-center gap-2">
									<span class="text-[10px] font-bold text-white/45 uppercase">Strength</span>
									<input
										type="range"
										min="0.05"
										max="1"
										step="0.05"
										value={win.intensity}
										oninput={(e) => patchFxIntensity(index, Number(e.currentTarget.value))}
										class="min-w-0 flex-1 accent-warm-500"
									/>
								</label>
							</div>
						{/each}
					</div>
				</div>
			{:else}
				<p class="text-[10.5px] leading-relaxed text-white/40">
					No windows yet — effects fire for ~0.6s from where you drop them and burn into the export.
					On video, scrub the playhead first; on stills they land at the frame you export.
				</p>
			{/if}

			<!-- Zoom punches (remix wire z): punch-in windows at the playhead —
			     they compose onto the stage framing live and burn into exports. -->
			<div>
				<div class="mb-1.5 flex items-center justify-between">
					<p class="text-[11px] font-bold tracking-wide text-white/50 uppercase">
						Zoom punches · {zoomWindows.length}/{MAX_ZOOM_WINDOWS}
					</p>
					<button
						type="button"
						onclick={addZoomWindow}
						class="rounded-full bg-warm-500/20 px-2.5 py-1 text-[10.5px] font-bold text-warm-400 transition active:scale-95"
					>
						+ At playhead
					</button>
				</div>
				{#if zoomWindows.length}
					<div class="flex flex-col gap-2">
						{#each zoomWindows as win, index (index)}
							<div class="rounded-lg bg-white/5 px-2.5 py-2">
								<div class="flex items-center gap-2">
									<span class="min-w-0 flex-1 truncate text-[12px] font-bold">
										Zoom {win.factor}×
									</span>
									<span class="shrink-0 font-mono text-[10.5px] text-white/45 tabular-nums">
										{(win.startMs / 1000).toFixed(1)}–{(win.endMs / 1000).toFixed(1)}s
									</span>
									<button
										type="button"
										onclick={() => removeZoomWindow(index)}
										aria-label="Remove zoom punch"
										class="grid size-7 shrink-0 place-items-center rounded-full text-white/45 transition hover:text-[var(--tone-error-text,#ef4444)]"
									>
										<Icon name="i-lucide-x" class="size-3.5" />
									</button>
								</div>
								<label class="mt-1 flex items-center gap-2">
									<span class="text-[10px] font-bold text-white/45 uppercase">Factor</span>
									<input
										type="range"
										min="1.25"
										max="4"
										step="0.25"
										value={win.factor}
										oninput={(e) => patchZoomFactor(index, Number(e.currentTarget.value))}
										class="min-w-0 flex-1 accent-warm-500"
									/>
								</label>
							</div>
						{/each}
					</div>
				{:else}
					<p class="text-[10.5px] leading-relaxed text-white/40">
						Scrub to the hit moment, then add a punch — the stage zooms live (preview = export).
					</p>
				{/if}
			</div>

			<!-- Speed ramps (remix wire s): rate windows at the playhead — video
			     only; playback + export speed follow the curve. -->
			{#if mediaKind === 'video'}
				<div>
					<div class="mb-1.5 flex items-center justify-between">
						<p class="text-[11px] font-bold tracking-wide text-white/50 uppercase">
							Speed ramps · {speedWindows.length}/{MAX_SPEED_WINDOWS}
						</p>
						<button
							type="button"
							onclick={addSpeedWindow}
							class="rounded-full bg-warm-500/20 px-2.5 py-1 text-[10.5px] font-bold text-warm-400 transition active:scale-95"
						>
							+ At playhead
						</button>
					</div>
					{#if speedWindows.length}
						<div class="flex flex-col gap-2">
							{#each speedWindows as win, index (index)}
								<div class="rounded-lg bg-white/5 px-2.5 py-2">
									<div class="flex items-center gap-2">
										<span class="min-w-0 flex-1 truncate text-[12px] font-bold">
											{win.rate}× ramp
										</span>
										<span class="shrink-0 font-mono text-[10.5px] text-white/45 tabular-nums">
											{(win.startMs / 1000).toFixed(1)}–{(win.endMs / 1000).toFixed(1)}s
										</span>
										<button
											type="button"
											onclick={() => removeSpeedWindow(index)}
											aria-label="Remove speed ramp"
											class="grid size-7 shrink-0 place-items-center rounded-full text-white/45 transition hover:text-[var(--tone-error-text,#ef4444)]"
										>
											<Icon name="i-lucide-x" class="size-3.5" />
										</button>
									</div>
									<label class="mt-1 flex items-center gap-2">
										<span class="text-[10px] font-bold text-white/45 uppercase">Rate</span>
										<input
											type="range"
											min="0.25"
											max="4"
											step="0.25"
											value={win.rate}
											oninput={(e) => patchSpeedRate(index, Number(e.currentTarget.value))}
											class="min-w-0 flex-1 accent-warm-500"
										/>
									</label>
								</div>
							{/each}
						</div>
					{:else}
						<p class="text-[10.5px] leading-relaxed text-white/40">
							Ramps multiply the clip's speed over their span — slow-mo 0.25× to 4×, in preview and
							export alike.
						</p>
					{/if}
				</div>
			{/if}
		</div>
	</StudioSheet>

	<!-- Templates sheet (`?panel=templates`): save the current layout (with
	     timed extras) and apply saved layouts + built-in starters — the same
	     store + factories the desktop studio and /studio home use. -->
	<StudioSheet
		open={panel === 'templates'}
		title="Layouts"
		icon="i-lucide-layout-template"
		onclose={closeSheet}
	>
		<div class="flex flex-col gap-4">
			<!-- Save current layout -->
			<div class="rounded-xl bg-black/40 p-2.5">
				<p class="mb-1.5 text-[11px] font-bold tracking-wide text-white/50 uppercase">
					Save this layout
				</p>
				<div class="flex gap-2">
					<input
						type="text"
						bind:value={templateName}
						maxlength="40"
						placeholder={overlays.length ? 'Layout name (optional)' : 'Add a caption first'}
						disabled={!overlays.length}
						class="h-10 min-w-0 flex-1 rounded-lg bg-black/40 px-3 text-[13px] outline-none placeholder:text-white/30"
					/>
					<button
						type="button"
						onclick={saveCurrentTemplate}
						disabled={!overlays.length}
						class="h-10 shrink-0 rounded-full bg-warm-500 px-4 text-[12.5px] font-bold text-white transition active:scale-95 disabled:opacity-40"
					>
						Save
					</button>
				</div>
				<p class="mt-1.5 text-[10.5px] leading-snug text-white/40">
					Captions, sound cues, effect tracks and sticker layers ride the layout — reuse them on any
					media.
				</p>
			</div>

			<!-- Saved layouts -->
			{#if memeTemplates.list.length}
				<div>
					<p class="mb-1.5 text-[11px] font-bold tracking-wide text-white/50 uppercase">
						Your layouts · {memeTemplates.list.length}
					</p>
					<div class="flex flex-col gap-1.5">
						{#each memeTemplates.list as tpl (tpl.id)}
							<div class="flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-1.5">
								<button
									type="button"
									onclick={() => applySavedTemplate(tpl)}
									class="flex min-w-0 flex-1 items-center gap-2 text-left transition active:scale-[0.98]"
									title="Apply “{tpl.label}”"
								>
									<span
										class="grid size-7 shrink-0 place-items-center rounded-md bg-warm-500/15 text-warm-400"
										aria-hidden="true"
									>
										<Icon name={tpl.icon} class="size-3.5" />
									</span>
									<span class="min-w-0 flex-1 truncate text-[12px] font-bold">{tpl.label}</span>
									<span class="shrink-0 text-[10px] text-white/40">
										{tpl.overlays.length} caption{tpl.overlays.length === 1 ? '' : 's'}
									</span>
								</button>
								<button
									type="button"
									onclick={() => {
										memeTemplates.remove(tpl.id);
										haptic();
									}}
									aria-label="Delete layout {tpl.label}"
									class="grid size-7 shrink-0 place-items-center rounded-full text-white/45 transition hover:text-[var(--tone-error-text,#ef4444)]"
								>
									<Icon name="i-lucide-trash-2" class="size-3.5" />
								</button>
								<button
									type="button"
									onclick={() => void shareSavedTemplate(tpl.id)}
									disabled={!!sharedTemplatesStore.sharingId}
									aria-label="Share layout {tpl.label}"
									title="Share with other bitz creators"
									class="grid size-7 shrink-0 place-items-center rounded-full text-white/45 transition hover:text-primary-400 disabled:opacity-40"
								>
									<Icon name="i-lucide-share-2" class="size-3.5" />
								</button>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Built-in starters -->
			<div>
				<p class="mb-1.5 text-[11px] font-bold tracking-wide text-white/50 uppercase">Starters</p>
				<div class="grid grid-cols-3 gap-2">
					{#each TEMPLATES as tpl (tpl.id)}
						<button
							type="button"
							onclick={() => applyStarterTemplate(tpl)}
							title="{tpl.label} — {tpl.hint}"
							class="flex flex-col items-center gap-1 rounded-lg bg-white/5 px-1 py-2.5 transition active:scale-90"
						>
							<Icon name={tpl.icon} class="size-5 text-warm-400" />
							<span class="text-[9.5px] leading-tight font-bold text-white/75">{tpl.label}</span>
						</button>
					{/each}
				</div>
			</div>

			<!-- Community marketplace (shared layouts over kind 30078): same
			     store + zap-unlock flow as the desktop market dialog. -->
			<div>
				<p class="mb-1.5 text-[11px] font-bold tracking-wide text-white/50 uppercase">Community</p>
				<div class="mb-2 flex flex-wrap gap-1.5">
					{#each TEMPLATE_CATEGORIES as cat (cat.id)}
						<button
							type="button"
							onclick={() => templateMarketplace.setCategory(cat.id)}
							class="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition {templateMarketplace.activeCategory ===
							cat.id
								? 'bg-primary-500/25 text-primary-400'
								: 'bg-white/5 text-white/55'}"
						>
							<Icon name={cat.icon} class="size-3.5" />
							{cat.label}
						</button>
					{/each}
				</div>

				{#if sharedTemplatesStore.loading}
					<div class="flex h-24 items-center justify-center text-white/40">
						<Icon name="i-lucide-loader-circle" class="size-6 animate-spin" />
					</div>
				{:else if !templateMarketplace.rows.length}
					<div class="flex h-24 flex-col items-center justify-center gap-1.5 text-center">
						<Icon name="i-lucide-store" class="size-6 text-white/35" />
						<p class="text-[11.5px] text-white/45">
							Nothing here yet — share a layout and be the first
						</p>
					</div>
				{:else}
					<div class="flex max-h-64 scrollbar-thin flex-col gap-1.5 overflow-y-auto">
						{#each templateMarketplace.rows as row (row.template.eventId)}
							{@const t = row.template}
							<div class="flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-1.5">
								<span
									class="grid size-7 shrink-0 place-items-center rounded-full bg-primary-500/15 text-primary-400"
									aria-hidden="true"
								>
									<Icon name={t.icon} class="size-3.5" />
								</span>
								<span class="min-w-0 flex-1">
									<span class="block truncate text-[12px] font-bold">
										{t.label}
										{#if row.own}<span class="text-[9px] text-white/40">· yours</span>{/if}
									</span>
									<span class="flex items-center gap-1 truncate text-[10px] text-white/45">
										<Avatar pubkey={t.creatorPubkey} size={12} />
										{profiles.displayName(t.creatorPubkey) || shortKey(t.creatorPubkey)}
									</span>
								</span>
								{#if row.unlocked}
									<button
										type="button"
										onclick={() => useSharedTemplate(t.eventId)}
										class="shrink-0 rounded-full bg-warm-500/20 px-2.5 py-1 text-[10.5px] font-bold text-warm-400 transition active:scale-95"
									>
										Use
									</button>
								{:else if row.priceSats > 0}
									<button
										type="button"
										onclick={() => templateMarketplace.startZap(t)}
										disabled={!!templateMarketplace.zapTarget}
										class="flex shrink-0 items-center gap-1 rounded-full bg-primary-500/20 px-2.5 py-1 text-[10.5px] font-bold text-primary-400 transition active:scale-95 disabled:opacity-40"
									>
										<Icon name="i-lucide-zap" class="size-3" />
										{row.priceSats} sats
									</button>
								{:else}
									<button
										type="button"
										onclick={() => useSharedTemplate(t.eventId)}
										class="shrink-0 rounded-full bg-warm-500/20 px-2.5 py-1 text-[10.5px] font-bold text-warm-400 transition active:scale-95"
									>
										Free
									</button>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</StudioSheet>

	<!-- Zap unlock for a priced community layout (shared NoteZapDialog flow):
	     paid → unlock recorded + imported into Your layouts. -->
	{#if templateMarketplace.zapTarget}
		{@const target = templateMarketplace.zapTarget}
		<NoteZapDialog
			open={true}
			recipientPubkey={target.creatorPubkey}
			lightningAddress={profiles.get(target.creatorPubkey)?.lud16 ?? ''}
			eventId={target.eventId}
			eventKind={30078}
			dialogZIndex={120}
			onPaid={() => void templateMarketplace.completeZap()}
			onClose={() => templateMarketplace.clearZap()}
		/>
	{/if}

	<!-- Canvas sheet (`?panel=canvas` — artboards + framing, Phase 5): the
	     same ARTBOARDS presets as the desktop studio; the picked board drives
	     BOTH the preview stage and the burned export (cover-fit crop). -->
	<StudioSheet open={panel === 'canvas'} title="Canvas" icon="i-lucide-frame" onclose={closeSheet}>
		<div class="flex flex-col gap-4">
			<div>
				<p class="mb-2 text-[11px] font-bold tracking-wide text-white/50 uppercase">Format</p>
				<div class="grid grid-cols-3 gap-2">
					{#each ARTBOARDS as board (board.id)}
						{@const aspect = board.w > 0 ? board.w / board.h : stageAspect}
						<button
							type="button"
							onclick={() => setArtboard(board.id)}
							aria-pressed={artboardId === board.id}
							class="flex flex-col items-center gap-1.5 rounded-xl border px-1.5 py-2.5 transition active:scale-95 {artboardId ===
							board.id
								? 'border-warm-500 bg-warm-500/15'
								: 'border-white/12 bg-white/5'}"
						>
							<span class="grid h-11 place-items-center" aria-hidden="true">
								<span
									class="block rounded-[3px] border {artboardId === board.id
										? 'border-warm-400 bg-warm-500/30'
										: 'border-white/35 bg-white/10'}"
									style="height:44px; width:{Math.min(96, Math.max(14, 44 * aspect))}px"
								></span>
							</span>
							<span class="text-[11.5px] font-bold">{board.label}</span>
							<span class="text-center text-[9px] leading-tight text-white/45">{board.hint}</span>
						</button>
					{/each}
				</div>
			</div>

			<div>
				<p class="mb-1.5 text-[11px] font-bold tracking-wide text-white/50 uppercase">Background</p>
				<div class="flex flex-wrap items-center gap-2">
					{#each BLANK_CANVAS_COLORS as color (color)}
						<button
							type="button"
							aria-label="Set the background to {color}"
							title={color}
							onclick={() => void applyBackgroundColor(color)}
							class="size-8 rounded-full border transition active:scale-90 {blankBg === color
								? 'ring-2 ring-warm-500 ring-offset-1 ring-offset-black/40'
								: ''} border-white/25"
							style="background:{color};"
						></button>
					{/each}
					<label
						class="relative grid size-8 cursor-pointer place-items-center overflow-hidden rounded-full border border-dashed transition active:scale-90 {blankBg &&
						!BLANK_CANVAS_COLORS.includes(blankBg)
							? 'border-warm-500 ring-2 ring-warm-500 ring-offset-1 ring-offset-black/40'
							: 'border-white/35'}"
						title="Custom background color"
						style={blankBg && !BLANK_CANVAS_COLORS.includes(blankBg)
							? `background:${blankBg};`
							: ''}
					>
						{#if !(blankBg && !BLANK_CANVAS_COLORS.includes(blankBg))}
							<Icon name="i-lucide-pipette" class="size-3.5 text-white/60" />
						{/if}
						<input
							type="color"
							class="absolute inset-0 size-full cursor-pointer opacity-0"
							aria-label="Custom background color"
							oninput={(e) => {
								const color = e.currentTarget.value;
								if (/^#[0-9a-f]{6}$/i.test(color)) void applyBackgroundColor(color);
							}}
						/>
					</label>
				</div>
				<p class="mt-1.5 text-[10.5px] leading-snug text-white/40">
					A color replaces the media with a blank canvas — captions, drawings and sounds stay.
				</p>
			</div>

			<div>
				<label class="flex flex-col gap-1.5">
					<span class="text-[11px] font-bold tracking-wide text-white/50 uppercase">
						Zoom · {zoom.toFixed(2)}×
					</span>
					<input
						type="range"
						min="1"
						max="4"
						step="0.05"
						value={zoom}
						oninput={(e) => setZoom(Number(e.currentTarget.value))}
						class="accent-warm-500"
					/>
				</label>
				<p class="mt-1 text-[10.5px] leading-relaxed text-white/40">
					Zoomed past 1×, drag the canvas to reframe. Captions stay fixed to the frame.
				</p>
				<button
					type="button"
					onclick={() => {
						setZoom(1);
						pan = { x: 0, y: 0 };
					}}
					class="mt-2 w-full rounded-full bg-white/10 py-2.5 text-[13px] font-bold text-white/80 transition active:scale-[0.98]"
				>
					Reset framing
				</button>
			</div>

			<p class="text-[10.5px] leading-relaxed text-white/40">
				The picked format crops the media to fill (cover-fit) and burns into the export — the same
				presets as the desktop studio.
			</p>
		</div>
	</StudioSheet>

	<!-- Draw sheet (`?panel=draw` — Phase 5): pen/marker/eraser + shapes,
	     colors, size, stroke undo/redo and clear. "Draw on canvas" toggles
	     the surface; Done keeps drawing with the picked tools. -->
	<StudioSheet open={panel === 'draw'} title="Draw" icon="i-lucide-pencil" onclose={closeSheet}>
		<div class="flex flex-col gap-4">
			<button
				type="button"
				onclick={() => (drawActive = !drawActive)}
				aria-pressed={drawActive}
				class="flex items-center justify-between rounded-xl bg-white/5 px-3.5 py-3 text-left transition active:scale-[0.98]"
			>
				<span class="flex items-center gap-2.5">
					<span
						class="grid size-9 place-items-center rounded-lg {drawActive
							? 'bg-warm-500/20 text-warm-500'
							: 'bg-white/10 text-white/60'}"
					>
						<Icon name="i-lucide-pencil-line" class="size-4.5" />
					</span>
					<span>
						<span class="block text-[13px] font-bold">Draw on canvas</span>
						<span class="block text-[11px] text-white/50">
							{drawActive
								? 'Drawing — strokes land under your captions'
								: 'Off — tap to start drawing'}
						</span>
					</span>
				</span>
				<span
					class="inline-flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition {drawActive
						? 'justify-end bg-warm-500'
						: 'justify-start bg-white/20'}"
				>
					<span class="size-5 rounded-full bg-white"></span>
				</span>
			</button>

			<div>
				<p class="mb-1.5 text-[11px] font-bold tracking-wide text-white/50 uppercase">Tool</p>
				<div class="grid grid-cols-4 gap-2">
					{#each DRAW_TOOLS as dt (dt.id)}
						<button
							type="button"
							onclick={() => (drawingTool = dt.id)}
							aria-pressed={drawingTool === dt.id}
							class="flex flex-col items-center gap-1 rounded-lg bg-white/5 py-2.5 transition active:scale-90 {drawingTool ===
							dt.id
								? 'ring-2 ring-warm-500'
								: ''}"
						>
							<Icon name={dt.icon} class="size-5" />
							<span class="text-[9.5px] font-bold">{dt.label}</span>
						</button>
					{/each}
				</div>
			</div>

			<div>
				<p class="mb-1.5 text-[11px] font-bold tracking-wide text-white/50 uppercase">Color</p>
				<div class="flex flex-wrap gap-2">
					{#each MEME_COLORS as color (color)}
						<button
							type="button"
							aria-label="Color {color}"
							onclick={() => (drawingColor = color)}
							class="size-8 rounded-full border-2 transition active:scale-90 {drawingColor === color
								? 'border-warm-500 ring-2 ring-warm-500/60'
								: 'border-white/25'}"
							style="background:{color}"
						></button>
					{/each}
				</div>
			</div>

			<label class="flex flex-col gap-1.5">
				<span class="text-[11px] font-bold tracking-wide text-white/50 uppercase">
					Size · {(drawingWidth * 100).toFixed(1)}
				</span>
				<input
					type="range"
					min="0.004"
					max="0.05"
					step="0.002"
					value={drawingWidth}
					oninput={(e) => (drawingWidth = Number(e.currentTarget.value))}
					class="accent-warm-500"
				/>
			</label>

			<div class="flex gap-2">
				<button
					type="button"
					onclick={undoDrawing}
					disabled={drawingUndoDepth === 0}
					class="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-white/10 py-2.5 text-[12px] font-bold text-white/80 transition active:scale-[0.98] disabled:opacity-40"
				>
					<Icon name="i-lucide-undo-2" class="size-4" /> Undo
				</button>
				<button
					type="button"
					onclick={redoDrawing}
					disabled={drawingRedoDepth === 0}
					class="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-white/10 py-2.5 text-[12px] font-bold text-white/80 transition active:scale-[0.98] disabled:opacity-40"
				>
					<Icon name="i-lucide-redo-2" class="size-4" /> Redo
				</button>
				<button
					type="button"
					onclick={clearDrawings}
					disabled={!drawingGroups.length}
					class="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-[var(--tone-error-bg,rgba(239,68,68,0.16))] py-2.5 text-[12px] font-bold text-[var(--tone-error-text,#ef4444)] transition active:scale-[0.98] disabled:opacity-40"
				>
					<Icon name="i-lucide-trash-2" class="size-4" /> Clear
				</button>
			</div>

			<button
				type="button"
				onclick={closeSheet}
				class="w-full rounded-full bg-warm-500 py-3 text-[14px] font-bold text-white transition active:scale-[0.98]"
			>
				{drawActive ? 'Done — keep drawing' : 'Done'}
			</button>
		</div>
	</StudioSheet>

	<!-- Drafts sheet (`?panel=drafts` — docs/ui/edit2.html draft grid):
	     resume any WIP slot in place, start fresh, or discard. Resuming banks
	     the current canvas first, so switching drafts never loses work. -->
	<StudioSheet
		open={panel === 'drafts'}
		title="Drafts"
		icon="i-lucide-folder-open"
		onclose={closeSheet}
	>
		<div class="flex flex-col gap-3">
			<button
				type="button"
				onclick={() => void startFreshDraft()}
				class="flex items-center gap-3 rounded-xl border border-dashed border-white/25 bg-white/5 px-3.5 py-3 text-left transition active:scale-[0.98]"
			>
				<span
					class="grid size-10 shrink-0 place-items-center rounded-lg bg-warm-500/15 text-warm-500"
				>
					<Icon name="i-lucide-plus" class="size-5" />
				</span>
				<span class="min-w-0">
					<span class="block text-[13px] font-bold">New draft</span>
					<span class="block text-[11px] text-white/50">Clear the canvas and start fresh</span>
				</span>
			</button>

			{#if memeSlots.list.length}
				<div class="grid grid-cols-2 gap-2.5">
					{#each memeSlots.list as slot (slot.id)}
						{@const thumb = slot.media?.previewDataUrl ?? slot.media?.dataUrl ?? null}
						{@const cues = slot.sfxCues.length}
						<div class="relative overflow-hidden rounded-xl border border-white/12 bg-white/5">
							<button
								type="button"
								onclick={() => void resumeDraft(slot.id)}
								title="Resume “{slot.label}”"
								class="block w-full text-left transition active:scale-[0.98]"
							>
								<span class="relative block aspect-[3/4] w-full overflow-hidden bg-black/50">
									{#if thumb}
										<img src={thumb} alt="" class="size-full object-cover" />
									{:else}
										<span class="grid size-full place-items-center text-white/40">
											{#if slot.mediaKindValue === 'video'}
												<Icon name="i-lucide-film" class="size-6" />
											{:else if slot.mediaKindValue === 'image'}
												<Icon name="i-lucide-image" class="size-6" />
											{:else}
												<Icon name="i-lucide-type" class="size-6" />
											{/if}
										</span>
									{/if}
									<span
										class="absolute bottom-1 left-1 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-bold text-white"
									>
										<Icon name="i-lucide-zap" class="size-2.5 text-warm-400" /> Draft
									</span>
									{#if slot.id === resumedSlotId}
										<span
											class="absolute top-1 left-1 rounded-full bg-warm-500 px-1.5 py-0.5 text-[9px] font-bold text-white"
											>Editing</span
										>
									{/if}
								</span>
								<span class="block px-2 pt-1.5 pb-2">
									<span class="block truncate text-[11.5px] font-bold">{slot.label}</span>
									<span class="block truncate text-[10px] text-white/45">
										{slot.overlays.length} caption{slot.overlays.length === 1 ? '' : 's'}{cues
											? ` · ${cues} cue${cues === 1 ? '' : 's'}`
											: ''} · {agoLabel(slot.savedAt)}
									</span>
								</span>
							</button>
							<button
								type="button"
								onclick={() => discardDraft(slot.id)}
								aria-label="Delete draft {slot.label}"
								class="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-black/60 text-white/70 backdrop-blur transition hover:text-[var(--tone-error-text,#ef4444)] active:scale-90"
							>
								<Icon name="i-lucide-trash-2" class="size-3" />
							</button>
						</div>
					{/each}
				</div>
			{:else}
				<p class="py-6 text-center text-[12.5px] text-white/50">
					No drafts yet — exit with work on the canvas and it auto-saves here.
				</p>
			{/if}
		</div>
	</StudioSheet>

	<!-- Publish sheet (docs/ui/edit3.html Screen 6). -->
	<StudioSheet
		open={panel === 'publish'}
		title="New post"
		icon="i-lucide-send"
		onclose={closeSheet}
	>
		<div class="flex flex-col gap-4">
			<!-- Preview + caption -->
			<div class="flex gap-3">
				<div
					class="relative h-32 w-24 shrink-0 overflow-hidden rounded-lg border border-white/15 bg-black/60"
				>
					{#if mediaUrl}
						<img
							src={mediaUrl}
							alt=""
							class="size-full object-cover"
							style="filter:{memeLookCss(lookId)}"
						/>
						{#if mediaKind === 'video'}
							<span class="absolute inset-0 grid place-items-center bg-black/30" aria-hidden="true">
								<Icon name="i-lucide-play" class="size-5 text-white" />
							</span>
						{/if}
					{:else}
						<span class="grid size-full place-items-center text-white/40">
							<Icon name="i-lucide-image-plus" class="size-5" />
						</span>
					{/if}
				</div>
				<!-- Shared caption composer (desktop parity): limits + counter and
				     @mention autocomplete whose popup portals above the sheet. -->
				<div class="h-32 min-w-0 flex-1">
					<MemePostCaption
						bind:value={caption}
						bind:mentions={captionMentions}
						busy={publishBusy}
						onSubmit={publishNow}
					/>
				</div>
			</div>

			<!-- Tag pills (nostr t-tags, parsed from the caption). -->
			<div class="rounded-xl bg-black/40 p-2.5">
				<div class="mb-2 flex flex-wrap gap-1.5">
					{#each captionTags as tag (tag)}
						<button
							type="button"
							onclick={() => removeTag(tag)}
							aria-label="Remove tag {tag}"
							class="flex items-center gap-1 rounded-md border border-warm-500/50 bg-warm-500/20 px-2 py-1 text-[11px] font-semibold text-warm-500"
						>
							#{tag}
							<Icon name="i-lucide-x" class="size-3 opacity-70" />
						</button>
					{/each}
					{#if !captionTags.length}
						<p class="text-[11px] text-white/40">
							No tags yet — they ride the post as Nostr t-tags.
						</p>
					{/if}
				</div>
				<div class="flex items-center gap-2 border-t border-white/10 pt-2">
					<Icon name="i-lucide-hash" class="size-3.5 text-white/40" />
					<input
						type="text"
						bind:value={tagDraft}
						onkeydown={(e) => {
							if (e.key === ' ' || e.key === 'Enter') {
								e.preventDefault();
								addTag();
							}
						}}
						placeholder="Add tag and press space"
						disabled={publishBusy}
						class="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
					/>
				</div>
			</div>

			<!-- Destinations -->
			<div>
				<p class="mb-1.5 text-[11px] font-bold tracking-wide text-white/50 uppercase">Publish to</p>
				<div class="flex gap-2">
					{#each DESTINATIONS as option (option.id)}
						<button
							type="button"
							onclick={() => toggleDestination(option.id)}
							aria-pressed={destinations.includes(option.id)}
							class="flex-1 rounded-xl border px-2 py-2.5 text-center transition {destinations.includes(
								option.id
							)
								? 'border-warm-500 bg-warm-500/15 text-white'
								: 'border-white/15 text-white/60'}"
						>
							<span class="block text-[12px] font-bold">{option.label}</span>
						</button>
					{/each}
				</div>
			</div>

			<!-- Upload provider (desktop parity: BitOS server or a configured
			     provider — Blossom / Cloudinary / S3). -->
			<div>
				<p class="mb-1.5 text-[11px] font-bold tracking-wide text-white/50 uppercase">Upload via</p>
				<div class="flex flex-wrap gap-2">
					<button
						type="button"
						onclick={() => (selectedProvider = 'none')}
						aria-pressed={selectedProvider === 'none'}
						class="rounded-xl border px-3 py-2 text-[11.5px] font-bold transition {selectedProvider ===
						'none'
							? 'border-warm-500 bg-warm-500/15 text-white'
							: 'border-white/15 text-white/60'}"
					>
						BitOS server
					</button>
					{#each MEDIA_PROVIDERS as provider (provider.id)}
						{#if media.isConfigured(provider.id)}
							<button
								type="button"
								onclick={() => (selectedProvider = provider.id)}
								aria-pressed={selectedProvider === provider.id}
								class="flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[11.5px] font-bold transition {selectedProvider ===
								provider.id
									? 'border-warm-500 bg-warm-500/15 text-white'
									: 'border-white/15 text-white/60'}"
							>
								<Icon name={provider.icon} class="size-3.5" />
								{provider.label}
							</button>
						{/if}
					{/each}
				</div>
			</div>

			<!-- Rare bitz PoW (NIP-13): mines inside postBitz before sign+broadcast —
			     only rides the bitz destination, like the desktop studio. -->
			{#if destinations.includes('bitz')}
				<div class="rounded-xl bg-black/40 p-2.5">
					<button
						type="button"
						onclick={() => (showPow = !showPow)}
						aria-pressed={showPow}
						class="flex w-full items-center justify-between gap-2 text-left"
					>
						<span class="flex items-center gap-1.5 text-[11px] font-bold text-white/70">
							<Icon name="i-lucide-pickaxe" class="size-3.5 text-warm-400" />
							Rare bitz — mine proof-of-work
						</span>
						<span
							class="inline-flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition {showPow
								? 'justify-end bg-warm-500'
								: 'justify-start bg-white/20'}"
						>
							<span class="size-4 rounded-full bg-white"></span>
						</span>
					</button>
					{#if showPow}
						<label class="mt-2.5 flex flex-col gap-1.5">
							<span class="text-[11px] font-bold tracking-wide text-white/50 uppercase">
								Difficulty · {pow} bits
							</span>
							<input
								type="range"
								min="8"
								max="32"
								step="1"
								value={pow}
								oninput={(e) => (pow = Number(e.currentTarget.value))}
								class="accent-warm-500"
							/>
							<span class="text-[10.5px] leading-relaxed text-white/40">
								Higher = rarer and slower to mine. Progress shows live while publishing.
							</span>
						</label>
					{/if}
				</div>
			{/if}

			<!-- AI provenance (AI-004) — same advisory tag the desktop stamps. -->
			<button
				type="button"
				onclick={() => (aiAssisted = !aiAssisted)}
				aria-pressed={aiAssisted}
				class="flex w-full items-center justify-between gap-2 rounded-xl bg-black/40 p-2.5 text-left"
			>
				<span class="flex items-center gap-1.5 text-[11px] font-bold text-white/70">
					<Icon name="i-lucide-bot" class="size-3.5" />
					Made with AI assistance
				</span>
				<span
					class="inline-flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition {aiAssisted
						? 'justify-end bg-warm-500'
						: 'justify-start bg-white/20'}"
				>
					<span class="size-4 rounded-full bg-white"></span>
				</span>
			</button>

			<!-- Value-split manifest (CRE-008): rows must total exactly 10,000 bps —
			     the live counter gates the publish button until they do. -->
			<div class="rounded-xl bg-black/40 p-2.5">
				<button
					type="button"
					onclick={() => (splitsOpen = !splitsOpen)}
					aria-pressed={splitsOpen}
					class="flex w-full items-center justify-between gap-2 text-left"
				>
					<span class="flex items-center gap-1.5 text-[11px] font-bold text-white/70">
						<Icon name="i-lucide-git-fork" class="size-3.5 text-warm-400" />
						Value splits
						{#if splitRows.length}
							<span class="font-mono text-[10px] text-white/45">
								{splitTotal.toLocaleString()}/{TOTAL_BASIS_POINTS.toLocaleString()} bps
								{#if splitCheck.ok}✓{:else}(–{(
										TOTAL_BASIS_POINTS - splitTotal
									).toLocaleString()}){/if}
							</span>
						{/if}
					</span>
					<span
						class="inline-flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition {splitsOpen
							? 'justify-end bg-warm-500'
							: 'justify-start bg-white/20'}"
					>
						<span class="size-4 rounded-full bg-white"></span>
					</span>
				</button>
				{#if splitsOpen}
					<div class="mt-2 flex flex-col gap-2">
						{#each splitRows as row, index (index)}
							<div class="rounded-lg bg-white/5 p-2">
								<div class="flex items-center gap-2">
									<select
										value={row.role}
										onchange={(e) => {
											const rows = [...splitRows];
											rows[index] = { ...row, role: e.currentTarget.value as SplitRow['role'] };
											splitRows = rows;
										}}
										class="h-8 min-w-0 flex-1 rounded-lg bg-black/40 px-1.5 text-[11px] font-semibold text-white outline-none"
										aria-label="Split role"
									>
										{#each SPLIT_ROLES as role (role)}
											<option value={role}>{role.replace(/_/g, ' ')}</option>
										{/each}
									</select>
									<input
										type="number"
										min="0"
										max={TOTAL_BASIS_POINTS}
										value={row.basisPoints}
										oninput={(e) => {
											const rows = [...splitRows];
											rows[index] = { ...row, basisPoints: Number(e.currentTarget.value) || 0 };
											splitRows = rows;
										}}
										class="h-8 w-20 shrink-0 rounded-lg bg-black/40 px-1.5 text-center font-mono text-[11px] font-bold text-white outline-none"
										aria-label="Basis points"
									/>
									<button
										type="button"
										onclick={() => (splitRows = splitRows.filter((_, i) => i !== index))}
										aria-label="Remove split row"
										class="grid size-7 shrink-0 place-items-center rounded-full text-white/45 transition hover:text-[var(--tone-error-text,#ef4444)]"
									>
										<Icon name="i-lucide-x" class="size-3.5" />
									</button>
								</div>
								<input
									type="text"
									value={row.beneficiary ?? ''}
									maxlength="128"
									placeholder="npub… beneficiary (optional)"
									oninput={(e) => {
										const rows = [...splitRows];
										rows[index] = {
											...row,
											beneficiary: e.currentTarget.value.trim() || undefined
										};
										splitRows = rows;
									}}
									class="mt-1.5 h-8 w-full rounded-lg bg-black/40 px-2 text-[11px] text-white outline-none placeholder:text-white/30"
									aria-label="Beneficiary"
								/>
							</div>
						{/each}
						<button
							type="button"
							onclick={() =>
								splitRows.length < 8 &&
								splitRows.push({ role: 'curator', basisPoints: 0 }) &&
								(splitRows = [...splitRows])}
							class="w-full rounded-full bg-white/10 py-2 text-[12px] font-bold text-white/75 transition active:scale-[0.98]"
						>
							+ Add split
						</button>
						<p class="text-[10.5px] leading-relaxed text-white/40">
							{#if !splitRows.length}
								Optional on-chain value manifest — splits ride the bitz event tags.
							{:else if splitCheck.ok}
								✓ Totals 10,000 bps — rides the publish.
							{:else}
								Rows must total exactly {TOTAL_BASIS_POINTS.toLocaleString()} bps to ride — add
								{(TOTAL_BASIS_POINTS - splitTotal).toLocaleString()} more (publish is blocked until then).
							{/if}
						</p>
					</div>
				{/if}
			</div>

			<!-- License + sensitive -->
			<div class="flex gap-2">
				<label class="min-w-0 flex-1 rounded-xl bg-black/40 p-2.5">
					<span class="text-[11px] font-bold text-white/70">Remix license</span>
					<select
						bind:value={license}
						disabled={publishBusy}
						class="mt-1 w-full rounded-lg bg-[var(--ui-bg)] px-2 py-1.5 text-[11px] font-semibold text-[var(--ui-text)] outline-none"
					>
						{#each LICENSE_OPTIONS as option (option.code)}
							<option value={option.code}>{option.label}</option>
						{/each}
					</select>
				</label>
				<button
					type="button"
					onclick={() => (sensitive = !sensitive)}
					aria-pressed={sensitive}
					class="flex w-28 shrink-0 flex-col items-start justify-center rounded-xl bg-black/40 p-2.5 text-left"
				>
					<span class="flex items-center gap-1.5 text-[11px] font-bold text-white/70">
						<Icon name="i-lucide-eye-off" class="size-3.5" /> Sensitive
					</span>
					<span
						class="mt-1.5 inline-flex h-5 w-9 items-center rounded-full px-0.5 transition {sensitive
							? 'justify-end bg-warm-500'
							: 'justify-start bg-white/20'}"
					>
						<span class="size-4 rounded-full bg-white"></span>
					</span>
				</button>
			</div>

			<div class="flex gap-2">
				<button
					type="button"
					onclick={() => void saveDraftAndExit()}
					disabled={publishBusy || (!mediaUrl && !overlays.length)}
					class="flex-1 rounded-full bg-white/10 py-3.5 text-[13px] font-bold text-white/75 transition active:scale-[0.98] disabled:opacity-40"
				>
					Save draft
				</button>
				<button
					type="button"
					onclick={publishNow}
					disabled={publishBusy || !mediaUrl}
					class="flex-[2] rounded-full bg-gradient-to-r from-warm-500 to-primary-500 py-3.5 text-[14px] font-bold text-white shadow-lg transition active:scale-[0.98] disabled:opacity-40"
				>
					<span class="flex items-center justify-center gap-2">
						<Icon name="i-lucide-send" class="size-4" />
						Publish to Nostr
					</span>
				</button>
			</div>
		</div>
	</StudioSheet>

	<!-- Publish progress overlay (docs/ui/edit3.html broadcast overlay). -->
	{#if publishBusy || pubPhase === 'done' || pubPhase === 'error'}
		<div
			class="absolute inset-0 z-[60] flex flex-col items-center justify-center gap-6 bg-black/90 p-8 text-center backdrop-blur-md"
			role="alertdialog"
			aria-live="assertive"
		>
			{#if pubPhase === 'done'}
				<div class="flex size-20 items-center justify-center rounded-full bg-green-500 text-4xl">
					<Icon name="i-lucide-check" class="size-9 text-white" />
				</div>
				<div>
					<h3 class="text-xl font-bold">Posted successfully!</h3>
					<p class="mt-1 text-[13px] text-white/50">Your meme is live on Nostr.</p>
				</div>
				<button
					type="button"
					onclick={finishPublish}
					class="rounded-full bg-warm-500 px-8 py-3 text-[14px] font-bold text-white"
				>
					Done
				</button>
				{#if publishedEventId}
					{@const viewId = publishedEventId}
					<!-- Desktop parity: jump straight to the live post. -->
					<button
						type="button"
						onclick={() => {
							if (publishBusy) return;
							pubPhase = 'idle';
							goto(publishedKind === 'note' ? `/note/${viewId}` : `/bitz${bitzHashLink(viewId)}`);
						}}
						class="flex items-center gap-1.5 rounded-full bg-white/10 px-6 py-2.5 text-[13px] font-bold text-white/85 transition hover:text-white active:scale-95"
					>
						<Icon name="i-lucide-circle-play" class="size-4 text-warm-400" />
						{publishedKind === 'note' ? 'View note' : 'View in Bitz'}
					</button>
				{/if}
			{:else if pubPhase === 'error'}
				<div
					class="flex size-16 items-center justify-center rounded-full bg-[var(--tone-error-bg,rgba(239,68,68,0.16))] text-[var(--tone-error-text,#ef4444)]"
				>
					<Icon name="i-lucide-cloud-off" class="size-7" />
				</div>
				<div>
					<h3 class="text-lg font-bold">Couldn't publish</h3>
					<p class="mt-1 max-w-xs text-[12.5px] leading-relaxed text-white/50">{pubError}</p>
				</div>
				<div class="flex gap-2">
					<button
						type="button"
						onclick={() => (pubPhase = 'idle')}
						class="rounded-full bg-white/10 px-5 py-2.5 text-[13px] font-bold text-white/70"
					>
						Back
					</button>
					<button
						type="button"
						onclick={publishNow}
						class="rounded-full bg-warm-500 px-5 py-2.5 text-[13px] font-bold text-white"
					>
						Retry
					</button>
				</div>
			{:else}
				<div class="relative flex size-20 items-center justify-center">
					<Icon
						name="i-lucide-loader-circle"
						class="absolute size-20 animate-spin text-warm-500/40"
					/>
					<Icon name="i-lucide-zap" class="size-7 text-warm-500" />
				</div>
				<div>
					<h3 class="text-lg font-bold">{pubLabel}</h3>
					<p class="mt-1 text-[12px] text-white/40">
						Keep this tab open — signed & broadcast via your relays.
					</p>
				</div>
				<div class="h-2 w-full max-w-[260px] overflow-hidden rounded-full bg-white/15">
					<div
						class="h-full rounded-full bg-gradient-to-r from-warm-500 to-primary-500 transition-all duration-300"
						style="width:{pubPercent}%"
					></div>
				</div>
			{/if}
		</div>
	{/if}
</div>
