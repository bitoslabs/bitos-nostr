<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import Icon from '$lib/components/ui/Icon.svelte';
	import StudioSheet from './StudioSheet.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { media } from '$lib/stores/media.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { feed } from '$lib/nostr/feed.svelte';
	import { stories } from '$lib/nostr/stories.svelte';
	import { memeSlots, type MemeSlotMedia } from '$lib/stores/meme-slots.svelte';
	import type { StudioSoundSeed } from '$lib/stores/studio-handoff.svelte';
	import {
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
	import { MEME_LOOKS, memeLookCss, memeLookOf, type MemeLookId } from '$lib/meme/look';
	import { STICKER_PACKS, isStickerOverlay, makeSticker } from '$lib/meme/stickers';
	import {
		canRenderVideoMeme,
		cueAudioTrack,
		paintMemeBase,
		recordMeme
	} from '$lib/meme/export-pipeline';
	import { exportErrorMessage, shiftCuesForExport } from '$lib/meme/export-support';
	import { normalizeFxWindows, type FrameFxWindow } from '$lib/meme/fx-track';
	import {
		composeZoomWithFraming,
		normalizeZoomWindows,
		zoomTransformAt,
		type ZoomWindow
	} from '$lib/meme/zoom-track';
	import {
		mediaMsToExportMs,
		normalizeSpeedWindows,
		rateAt,
		shiftCuesForExportWithSpeeds,
		type SpeedWindow
	} from '$lib/meme/speed-track';
	import { paintOverlay, targetSize, type MediaTransform } from '$lib/meme/render';
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
		DESTINATIONS,
		LICENSE_OPTIONS,
		STAGE_ZOOM_KEY,
		type MemeArtboardId,
		type MemeDestination
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
	 * It is a SHELL over the same model as the desktop MemeStudio — no
	 * duplicated stores or schema. Audio cues, artboards and batch queue land
	 * in Phase 4 (see the roadmap in the doc).
	 */

	type EditorMode = 'image' | 'gif' | 'video';
	type PanelId = 'meme' | 'text' | 'sticker' | 'trim' | 'look' | 'publish' | 'audio' | 'canvas';

	let {
		onexit,
		onposted,
		remixHandoff = null,
		templateHandoff = null,
		slotHandoff = null,
		soundHandoff = null
	}: {
		onexit: () => void;
		/** After a successful publish — the route sends the creator home. */
		onposted?: () => void;
		remixHandoff?: RemixHandoff | null;
		templateHandoff?: { id: string; overlays: MemeTextOverlay[] } | null;
		slotHandoff?: string | null;
		soundHandoff?: StudioSoundSeed | null;
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
	/** CSS pan: visual dx = pan.x * (z-1)/2 * stage width, and a CSS translate
	 *  percentage applies pre-scale — so percent = pan * (z-1) / (2z) * 100. */
	const panPercent = $derived.by(() => {
		const f = zoom > 1 ? ((zoom - 1) / (2 * zoom)) * 100 : 0;
		return { x: pan.x * f, y: pan.y * f };
	});

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
	}

	function setZoom(next: number) {
		zoom = Math.min(4, Math.max(1, next));
		if (zoom === 1) pan = { x: 0, y: 0 };
		persistFraming();
	}

	/** Pan drag on the stage (zoomed-in framing). */
	let panDrag: { startX: number; startY: number; x: number; y: number } | null = null;

	function onStagePointerDown(event: PointerEvent) {
		if ((event.target as HTMLElement).closest('[data-overlay]')) return; // overlay owns it
		if (zoom <= 1) return;
		panDrag = { startX: event.clientX, startY: event.clientY, x: pan.x, y: pan.y };
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	function onStagePointerMove(event: PointerEvent) {
		if (!panDrag || !stageEl) return;
		const rect = stageEl.getBoundingClientRect();
		// Visual pan travel is pan * (zoom-1)/2 * size, so Δpan = Δpx * 2 / ((zoom-1) * size).
		const step = 2 / Math.max(0.001, zoom - 1);
		const nx = panDrag.x + ((event.clientX - panDrag.startX) / rect.width) * step;
		const ny = panDrag.y + ((event.clientY - panDrag.startY) / rect.height) * step;
		pan = { x: Math.min(1, Math.max(-1, nx)), y: Math.min(1, Math.max(-1, ny)) };
	}

	function onStagePointerUp() {
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
			panelParam === 'canvas'
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
	function editorUrl(changes: { panel?: PanelId | null; edit?: string | null; fmt?: EditorMode }) {
		const current = page.url.searchParams;
		const shell = current.get('shell');
		const fmt = changes.fmt ?? mode;
		const parts = [`tab=meme`, `fmt=${fmt}`];
		if (shell === 'app' || shell === 'full') parts.push(`shell=${shell}`);
		const panelNext = changes.panel !== undefined ? changes.panel : panel;
		if (panelNext) parts.push(`panel=${panelNext}`);
		const editNext = changes.edit !== undefined ? changes.edit : null;
		if (editNext) parts.push(`edit=${editNext}`);
		return `/studio/create?${parts.join('&')}`;
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
			void goto(editorUrl({ panel: null, edit: null }), {
				keepFocus: true,
				noScroll: true,
				replaceState: true
			});
		}
	}

	$effect(() => {
		if (!panel && !editingId) sheetPushed = false;
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

	/** Stage media bytes as the shell's current source (shared by the remix
	 *  seeder and the file picker so both own one blob-URL lifecycle). */
	function setMediaFile(file: File) {
		if (ownedUrl) URL.revokeObjectURL(ownedUrl);
		ownedUrl = URL.createObjectURL(file);
		pickedFile = file;
		mediaUrl = ownedUrl;
		mediaKind = file.type.startsWith('video/') ? 'video' : 'image';
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
			const slot = memeSlots.list.find((s) => s.id === slotHandoff);
			if (slot) {
				overlays = slot.overlays.map((o) => ({ ...o }));
				sfxCues = slot.sfxCues.map((c) => ({ ...c }));
				lookId = memeLookOf(slot.lookId);
				trimStart = slot.trimStartSec;
				trimEnd = slot.trimEndSec;
				playbackRate = slot.playbackRate;
				if (slot.media?.dataUrl) {
					mediaUrl = slot.media.dataUrl;
					mediaKind = slot.mediaKindValue;
				}
			}
			return;
		}
		if (templateHandoff) {
			overlays = templateHandoff.overlays.map((o, i) => ({
				...o,
				id: `${templateHandoff.id}-${i}`
			}));
		}
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
	}

	function redo() {
		const next = redoStack.pop();
		if (!next) return;
		undoStack.push(overlays.map((o) => ({ ...o })));
		overlays = next;
		selectedId = null;
		undoDepth = undoStack.length;
		redoDepth = redoStack.length;
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
	}

	function addSticker(emoji: string) {
		snapshot();
		const added = makeSticker(emoji, { index: overlays.length });
		overlays = [...overlays, added];
		selectedId = added.id;
		closeSheet();
	}

	function removeOverlay(id: string) {
		snapshot();
		overlays = overlays.filter((o) => o.id !== id);
		if (selectedId === id) selectedId = null;
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

	const clamp01 = (v: number) => Math.min(0.98, Math.max(0.02, v));

	function onOverlayPointerDown(event: PointerEvent, overlay: MemeTextOverlay) {
		if ((event.target as HTMLElement).closest('button')) return;
		selectedId = overlay.id;
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

	function onOverlayPointerUp() {
		const d = drag;
		drag = null;
		// A second tap on the already-selected overlay opens its style sheet.
		if (d && !d.moved && selectedId === d.id) openEdit(d.id);
	}

	/* ------------------------------------------------------------------ *
	 * Media pick + video playback
	 * ------------------------------------------------------------------ */

	function pickMedia() {
		fileInputEl?.click();
	}

	function onFilePicked(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		setMediaFile(file);
		// Fresh media ⇒ fresh window/look/tracks (mode derives from the kind).
		lookId = 'none';
		zoomWindows = [];
		fxWindows = [];
		speedWindows = [];
		trimStart = 0;
		trimEnd = null;
		selectedId = null;
	}

	/** Revoke our blob URL when the shell unmounts. */
	$effect(() => {
		return () => {
			if (ownedUrl) URL.revokeObjectURL(ownedUrl);
		};
	});

	function togglePlay() {
		const video = videoEl;
		if (!video) return;
		if (video.paused) void video.play().catch(() => undefined);
		else video.pause();
	}

	/** Speed follows the state (Trim & speed sheet) onto the element. */
	$effect(() => {
		if (videoEl) videoEl.playbackRate = playbackRate;
	});

	function fmtTime(seconds: number): string {
		if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
	}

	const playheadPct = $derived(duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0);

	/* ------------------------------------------------------------------ *
	 * Exit → auto-save a WIP slot (no dead ends; resumable from /studio)
	 * ------------------------------------------------------------------ */

	async function saveWip() {
		const label =
			overlays
				.find((o) => o.text.trim() && !isStickerOverlay(o))
				?.text.trim()
				.slice(0, 40) ||
			(sfxCues.length ? `Sound meme · ${SFX_LABELS[sfxCues[0]!.sfx as MemeSfxId]}` : '') ||
			'Mobile draft';
		let media: MemeSlotMedia | null = null;
		if (pickedFile) {
			try {
				media = await memeSlots.saveMediaFile(pickedFile);
			} catch {
				/* keep overlays even if the media blob can't be persisted */
			}
		}
		const hasWork = overlays.length > 0 || media !== null;
		if (!hasWork) return;
		memeSlots.save({
			label,
			media,
			mediaKindValue: media ? mediaKind : null,
			overlays,
			sfxCues,
			imageLayers: [],
			drawingGroups: [],
			caption: '',
			sensitive: false,
			destination: 'bitz',
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
		void saveWip().then(() => onexit());
	}

	/* ------------------------------------------------------------------ *
	 * Publish (Phase 3 — docs/ui/edit3.html Screen 6)
	 * ------------------------------------------------------------------ */

	let caption = $state('');
	let tagDraft = $state('');
	let destinations = $state<MemeDestination[]>(['bitz']);
	let license = $state<RemixLicense>('CC0-1.0');
	let sensitive = $state(false);
	let pubPhase = $state<'idle' | 'rendering' | 'uploading' | 'publishing' | 'done' | 'error'>(
		'idle'
	);
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

	/** The mobile soundboard stages synth cues only, so the cue mixer's
	 *  custom-sound decoder is a null stub (synth recipes need no PCM). */
	const SYNTH_ONLY_DECODE = async () => null;

	interface RenderedMeme {
		file: File;
		dim: string;
		durationSec?: number;
	}

	/** Still render (image media): shared `paintMemeBase` + `paintOverlay` —
	 *  the exact same primitives the desktop studio burns into its exports. */
	async function renderStill(): Promise<RenderedMeme> {
		const img = imgEl;
		if (!img || !img.naturalWidth) throw new Error('Add a photo first');
		const size = targetSize({ width: img.naturalWidth, height: img.naturalHeight });
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
		const cueTrack = await cueAudioTrack(runtimeSec, sfxCues, SYNTH_ONLY_DECODE);
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
				paintOverlaysAt(c, canvas, elapsedMs);
			}
		});
		return { file, dim: `${size.width}x${size.height}`, durationSec: runtimeSec };
	}

	/** Video render: realtime canvas capture of the trim window at the picked
	 *  speed via the shared `recordMeme` recorder session. */
	async function renderVideo(): Promise<RenderedMeme> {
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
		const size = targetSize({
			width: video.videoWidth || 1080,
			height: video.videoHeight || 1920
		});
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
				? await cueAudioTrack(runtimeSec, exportCues, SYNTH_ONLY_DECODE)
				: null;
			const file = await recordMeme({
				canvas,
				totalMs: runtimeSec * 1000,
				extraTracks: cueTrack ? [cueTrack] : [],
				paint: (c, elapsedMs) => {
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
		try {
			pubPhase = 'rendering';
			pubLabel = 'Rendering meme…';
			const rendered = mediaKind === 'video' ? await renderVideo() : await renderStill();

			pubPhase = 'uploading';
			pubLabel = 'Uploading to your media server…';
			pubPercent = 0;
			const uploaded = await media.upload(rendered.file, undefined, {
				pubkey: identity.current?.pk,
				purpose: destinations.length === 1 && destinations[0] === 'story' ? 'story' : 'note',
				onProgress: (p) => (pubPercent = p.percent)
			});

			pubPhase = 'publishing';
			pubLabel = 'Broadcasting to relays…';
			pubPercent = 100;
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
					await feed.postBitz(attachment, {
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
							...rightsTagsFor(license, remixSource ? sourceCredit : '')
						]
					});
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
					await feed.post(finalCaption, { sensitive, attachments: [attachment] });
				}
			}
			pubPhase = 'done';
			toasts.success('Published — your meme is live on Nostr');
		} catch (e) {
			pubPhase = 'error';
			pubError = exportErrorMessage(e);
		}
	}

	function finishPublish() {
		pubPhase = 'idle';
		pubError = '';
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
		id: PanelId | 'audio' | 'effects';
		icon: string;
		label: string;
		accent?: boolean;
	}[] = [
		{ id: 'meme', icon: 'i-lucide-laugh', label: 'Meme', accent: true },
		{ id: 'text', icon: 'i-lucide-type', label: 'Text' },
		{ id: 'sticker', icon: 'i-lucide-smile-plus', label: 'Sticker' },
		{ id: 'audio', icon: 'i-lucide-music', label: 'Audio' },
		{ id: 'effects', icon: 'i-lucide-sparkles', label: 'Effects' }
	];

	const phase3 = () => toasts.info('Coming in Phase 3 — crop, artboards & AI gen', 2200);

	const modeTools: Record<EditorMode, { icon: string; label: string; action: () => void }[]> = {
		video: [
			{ icon: 'i-lucide-frame', label: 'Canvas', action: phase3 },
			{ icon: 'i-lucide-sliders-horizontal', label: 'Adjust', action: phase3 },
			{ icon: 'i-lucide-droplet', label: 'Filter', action: () => openPanel('look') },
			{ icon: 'i-lucide-image-plus', label: 'Overlay', action: phase3 },
			{ icon: 'i-lucide-wand-sparkles', label: 'AI Gen', action: phase3 }
		],
		image: [
			{ icon: 'i-lucide-expand', label: 'Ratio', action: phase3 },
			{ icon: 'i-lucide-crop', label: 'Crop', action: phase3 },
			{ icon: 'i-lucide-droplet', label: 'Filter', action: () => openPanel('look') },
			{ icon: 'i-lucide-sliders-horizontal', label: 'Adjust', action: phase3 },
			{ icon: 'i-lucide-palette', label: 'Background', action: phase3 }
		],
		gif: [
			{ icon: 'i-lucide-gauge', label: 'Speed', action: () => openPanel('trim') },
			{ icon: 'i-lucide-repeat', label: 'Loop', action: phase3 },
			{ icon: 'i-lucide-crop', label: 'Crop', action: phase3 },
			{ icon: 'i-lucide-droplet', label: 'Filter', action: () => openPanel('look') },
			{ icon: 'i-lucide-type', label: 'Text', action: () => openPanel('text') }
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
		{#if remixLoading}
			<!-- Remix source streaming in: progress scrim over the canvas (the
			     shell used to show a black void while the URL sat unloaded). -->
			<div
				class="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/80 backdrop-blur-sm"
				role="status"
				aria-live="polite"
			>
				<Icon name="i-lucide-wand-sparkles" class="size-8 animate-pulse text-warm-400" />
				<p class="px-8 text-center text-[13px] font-semibold text-white">
					Loading “{remixLoadLabel || 'the remix source'}”…
				</p>
				<div class="h-1.5 w-40 overflow-hidden rounded-full bg-white/15" aria-hidden="true">
					<div
						class="h-full rounded-full bg-warm-400 transition-[width] duration-200"
						style="width:{remixLoadPercent > 0 ? remixLoadPercent : 12}%"
					></div>
				</div>
				<p class="text-[11px] font-medium text-white/60">
					{remixLoadPercent > 0 ? `${remixLoadPercent}%` : 'Connecting…'}
				</p>
			</div>
		{/if}
		<!-- Framed stage: artboard aspect + zoom/pan framing (container for
		     overlay font units too). Empty canvas sits behind everything. -->
		<div
			bind:this={stageEl}
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
					)}; transform: scale({zoom}) translate({panPercent.x}%, {panPercent.y}%)"
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
			{:else if mediaUrl}
				<img
					bind:this={imgEl}
					src={mediaUrl}
					alt="Meme source"
					draggable="false"
					style="filter: {memeLookCss(
						lookId
					)}; transform: scale({zoom}) translate({panPercent.x}%, {panPercent.y}%)"
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
					onclick={() =>
						tool.id === 'effects'
							? toasts.info('Effects land in a future update', 2200)
							: openPanel(tool.id)}
					class="flex size-12 flex-col items-center justify-center rounded-full border {tool.accent
						? 'border-warm-500/70 bg-white/10 text-warm-500'
						: 'border-white/15 bg-white/10 text-white'} backdrop-blur-md transition active:scale-90"
				>
					<Icon name={tool.icon} class="size-5" />
					<span class="mt-0.5 text-[8px] font-bold">{tool.label}</span>
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
	{#if mode !== 'image' && mediaKind === 'video'}
		<section
			class="flex h-28 shrink-0 flex-col justify-between border-t border-white/10 bg-[#0d0d0d] px-3 py-2.5"
			aria-label="Timeline"
		>
			<div class="flex justify-between px-1 font-mono text-[10px] text-white/45 tabular-nums">
				<span>00:00</span>
				<span class="text-warm-500">{fmtTime(currentTime)} / {fmtTime(duration)}</span>
				<span>{fmtTime(duration)}</span>
			</div>
			<div class="relative h-14 overflow-hidden rounded-lg bg-white/8">
				<!-- Phase 1: single-clip track (the whole clip) + live playhead.
				     Phase 2 wires the real trim/split timeline. -->
				<div
					class="h-full bg-gradient-to-r from-warm-500/35 via-warm-500/20 to-warm-500/35"
					style={mediaUrl
						? `background-image:url('${mediaUrl}');background-size:auto 100%;background-repeat:repeat-x`
						: ''}
				></div>
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
			<div class="flex items-center justify-around text-white/60">
				<button
					class="flex flex-col items-center gap-0.5 text-[9px]"
					onclick={() => toasts.info('Split arrives with the multi-clip timeline', 2000)}
				>
					<Icon name="i-lucide-scissors" class="text-[14px]" />Split
				</button>
				<button
					class="flex flex-col items-center gap-0.5 text-[9px]"
					onclick={() => toasts.info('Split arrives with the multi-clip timeline', 2000)}
				>
					<Icon name="i-lucide-trash-2" class="text-[14px]" />Delete
				</button>
				<button
					class="flex flex-col items-center gap-0.5 text-[9px]"
					onclick={() => toasts.info('Volume mixing lands in Phase 3', 2000)}
				>
					<Icon name="i-lucide-volume-2" class="text-[14px]" />Volume
				</button>
				<button
					class="flex flex-col items-center gap-0.5 text-[9px]"
					onclick={() => toasts.info('Layer ordering lands in Phase 3', 2000)}
				>
					<Icon name="i-lucide-layers" class="text-[14px]" />Layer
				</button>
				<button
					class="flex flex-col items-center gap-0.5 text-[9px]"
					onclick={() => openPanel('trim')}
				>
					<Icon name="i-lucide-timer" class="text-[14px]" />Speed
				</button>
			</div>
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
									onclick={() => previewSfx(cue.sfx as MemeSfxId)}
									aria-label="Preview {SFX_LABELS[cue.sfx as MemeSfxId]}"
									class="grid size-7 shrink-0 place-items-center rounded-full bg-primary-500/15 text-primary-500"
								>
									<Icon name="i-lucide-play" class="size-3.5" />
								</button>
								<span class="min-w-0 flex-1 truncate text-[12px] font-bold">
									{SFX_LABELS[cue.sfx as MemeSfxId]}
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
				<textarea
					bind:value={caption}
					placeholder="Write a caption… #bitcoin #meme"
					disabled={publishBusy}
					class="h-32 w-full resize-none rounded-lg bg-black/40 p-3 text-[13px] leading-relaxed ring-warm-500/60 outline-none focus:ring-2"
				></textarea>
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

			<button
				type="button"
				onclick={publishNow}
				disabled={publishBusy || !mediaUrl}
				class="w-full rounded-full bg-gradient-to-r from-warm-500 to-primary-500 py-3.5 text-[14px] font-bold text-white shadow-lg transition active:scale-[0.98] disabled:opacity-40"
			>
				<span class="flex items-center justify-center gap-2">
					<Icon name="i-lucide-send" class="size-4" />
					Publish to Nostr
				</span>
			</button>
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
