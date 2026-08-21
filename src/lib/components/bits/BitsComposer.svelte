<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { neventEncode } from 'nostr-tools/nip19';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import MenuItem from '$lib/components/ui/MenuItem.svelte';
	import MenuDivider from '$lib/components/ui/MenuDivider.svelte';
	import PowCard from '$lib/components/ui/PowCard.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { relays } from '$lib/nostr/relays.svelte';
	import { feed, type PowProgress } from '$lib/nostr/feed.svelte';
	import { media, MEDIA_PROVIDERS, providerLabel } from '$lib/stores/media.svelte';
	import type { MediaProviderId } from '$lib/media/uploaders';
	import type { UploadedMedia } from '$lib/media/uploaders';
	import { humanBytes } from '$lib/media/uploaders';
	import { powPrefs } from '$lib/stores/pow-prefs.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { formatDuration } from '$lib/utils/format';

	/**
	 * Bit Studio — create a short-form bit straight from the post form.
	 *
	 * A WYSIWYG 9:16 stage mirrors exactly how the media will play in the Bits
	 * feed, while Nostr-native transparency (event kind, relay targets,
	 * opt-in proof-of-work “rare bit” mining) makes the flow unmistakably
	 * Nostr: the published event is a standard NIP-68 / NIP-71 media note that
	 * renders in every short-video client, not just BitOS.
	 */
	let {
		open = $bindable(false),
		onposted = () => {}
	}: { open?: boolean; onposted?: (eventId: string) => void } = $props();

	// ---- media state -------------------------------------------------------
	type BitKind = 'video' | 'image';
	type BitMeta = { width: number; height: number; duration?: number };
	let file = $state<File | null>(null);
	let previewUrl = $state('');
	let mediaKind = $state<BitKind | null>(null);
	let meta = $state<BitMeta | null>(null);

	// ---- upload state ------------------------------------------------------
	let uploaded = $state<UploadedMedia | null>(null);
	let uploading = $state(false);
	let uploadPercent = $state(0);
	let uploadDeterministic = $state(false);
	let uploadError = $state<string | null>(null);
	/** Guards against a finished upload landing after the file was replaced. */
	let uploadToken = 0;

	// ---- compose state -----------------------------------------------------
	let caption = $state('');
	let sensitive = $state(false);
	let fileInput = $state<HTMLInputElement | null>(null);
	let dragOver = $state(false);
	let confirmDiscard = $state(false);

	// ---- cover frame (video bits) -------------------------------------------
	let stageVideoEl = $state<HTMLVideoElement | null>(null);
	let scrubSeconds = $state(0);
	let cover = $state<string | null>(null);
	let coverUploading = $state(false);

	// ---- reach ----------------------------------------------------------------
	// Opt-in: also publish a kind-1 quote note linking the fresh bit so it
	// reaches clients that do not render the Bits media feed.
	let quoteTimeline = $state(false);

	// Per-bit provider selection, defaulting to the configured default.
	let selectedProvider = $state<MediaProviderId | 'none'>(media.state.defaultProvider);
	let providerInitialized = $state(false);

	// ---- publish state -----------------------------------------------------
	let posting = $state(false);
	let mining = $state(false);
	let postPhase = $state<'idle' | 'mining' | 'publishing'>('idle');
	let powProgress = $state<PowProgress | null>(null);
	let mineController: AbortController | undefined;
	// Bits are quick content: the PoW panel starts collapsed, but remembers
	// the last difficulty the user actually published with.
	let showPow = $state(false);
	let pow = $state(untrack(() => powPrefs.state.lastDifficulty));

	// Hard cap chosen with Blossom/CDN limits in mind; anything bigger is
	// rejected outright instead of dying mid-upload on the provider.
	const MAX_BIT_BYTES = 200 * 1024 * 1024;
	const SIZE_WARN_BYTES = 60 * 1024 * 1024;
	// Reels-style soft/hard caption limits (the Bits player clamps display).
	const SOFT_CAP = 300;
	const HARD_CAP = 1000;

	const me = $derived(identity.current);
	const myProfile = $derived(me ? (profiles.get(me.pk) ?? me.profile) : undefined);
	const displayName = $derived(myProfile?.display_name || myProfile?.name || 'You');

	const portrait = $derived(meta ? meta.height >= meta.width : true);
	const kindInfo = $derived.by(() => {
		if (mediaKind === 'image') return { label: 'Picture', kind: 20, nip: 'NIP-68' };
		if (mediaKind === 'video') {
			return portrait
				? { label: 'Short video', kind: 22, nip: 'NIP-71' }
				: { label: 'Video', kind: 21, nip: 'NIP-71' };
		}
		return null;
	});
	const aspectLabel = $derived(meta ? `${meta.width}×${meta.height}` : '');
	const dirty = $derived(!!file || !!caption.trim());
	const busy = $derived(uploading || posting);
	const overSoft = $derived(caption.length > SOFT_CAP);
	const overHard = $derived(caption.length > HARD_CAP);
	const canPost = $derived(!!uploaded && !posting && !uploadError && !overHard && !!mediaKind);
	const writeRelayCount = $derived(relays.list.filter((r) => r.write).length);
	const configuredProviders = $derived(MEDIA_PROVIDERS.filter((p) => media.isConfigured(p.id)));
	const selectedProviderLabel = $derived(
		providerLabel(selectedProvider === 'none' ? 'server' : selectedProvider)
	);
	const oversizeWarn = $derived(!!file && file.size > SIZE_WARN_BYTES);

	// Curated Nostr hashtag suggestions — shown while the user types a
	// trailing `#token` in the caption; one tap completes the tag.
	const BIT_HASHTAGS = [
		'bitcoin',
		'nostr',
		'lightning',
		'zap',
		'freedom',
		'privacy',
		'photography',
		'travel',
		'music',
		'art',
		'gaming',
		'food',
		'nature',
		'memes',
		'fitness',
		'tech',
		'ai',
		'buildinpublic',
		'introductions',
		'asknostr'
	];
	const tagSuggestions = $derived.by(() => {
		const match = /#([\p{L}\p{N}_]+)$/u.exec(caption);
		if (!match) return [];
		const partial = match[1].toLowerCase();
		const used = new Set(
			(caption.toLowerCase().match(/#([\p{L}\p{N}_]+)/gu) ?? []).map((token) => token.slice(1))
		);
		return BIT_HASHTAGS.filter((tag) => tag.startsWith(partial) && !used.has(tag)).slice(0, 6);
	});

	function applyTagSuggestion(tag: string) {
		caption = caption.replace(/#([\p{L}\p{N}_]+)$/u, `#${tag} `);
	}

	// Keep the selection valid whenever providers/defaults change (mirrors the
	// main composer so the two never disagree about what is configured).
	$effect(() => {
		const current = selectedProvider;
		const valid = (id: MediaProviderId | 'none') => id === 'none' || media.isConfigured(id);
		if (!providerInitialized) {
			providerInitialized = true;
			const def = media.state.defaultProvider;
			if (def !== 'none' && media.isConfigured(def)) selectedProvider = def;
			return;
		}
		if (valid(current)) return;
		const def = media.state.defaultProvider;
		selectedProvider =
			def !== 'none' && media.isConfigured(def) ? def : (configuredProviders[0]?.id ?? 'none');
	});

	$effect(() => {
		if (me) profiles.ensure([me.pk]);
	});

	// Reset when the studio opens fresh.
	let lastOpen = false;
	$effect(() => {
		if (open && !lastOpen) reset();
		lastOpen = open;
	});

	onMount(() => {
		return () => {
			mineController?.abort();
			if (previewUrl) URL.revokeObjectURL(previewUrl);
		};
	});

	function revokePreview() {
		if (previewUrl) URL.revokeObjectURL(previewUrl);
		previewUrl = '';
	}

	function reset() {
		revokePreview();
		file = null;
		mediaKind = null;
		meta = null;
		uploaded = null;
		uploading = false;
		uploadPercent = 0;
		uploadError = null;
		caption = '';
		sensitive = false;
		confirmDiscard = false;
		posting = false;
		mining = false;
		postPhase = 'idle';
		powProgress = null;
		mineController = undefined;
		showPow = false;
		pow = powPrefs.state.lastDifficulty;
		stageVideoEl = null;
		scrubSeconds = 0;
		cover = null;
		coverUploading = false;
		quoteTimeline = false;
	}

	function acceptFiles(files: FileList | File[] | null) {
		const next = files && files.length ? files[0] : null;
		if (!next) return;
		const type = next.type;
		const kind: BitKind | null = type.startsWith('video/')
			? 'video'
			: type.startsWith('image/')
				? 'image'
				: null;
		if (!kind) {
			toasts.error('Bits support videos and pictures');
			return;
		}
		if (next.size > MAX_BIT_BYTES) {
			toasts.error(`That file is ${humanBytes(next.size)} — bits top out at 200 MB`);
			return;
		}
		if (busy) return;
		confirmDiscard = false;
		// Replace any previous selection (upload result is token-guarded).
		uploadToken++;
		revokePreview();
		uploaded = null;
		uploadError = null;
		uploadPercent = 0;
		uploadDeterministic = false;
		meta = null;
		cover = null;
		scrubSeconds = 0;
		file = next;
		mediaKind = kind;
		previewUrl = URL.createObjectURL(next);
		void runUpload(next);
	}

	function onFileInput(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		acceptFiles(input.files);
		input.value = '';
	}

	function clearMedia() {
		if (busy) return;
		uploadToken++;
		revokePreview();
		file = null;
		mediaKind = null;
		meta = null;
		uploaded = null;
		uploadError = null;
		cover = null;
		scrubSeconds = 0;
	}

	async function runUpload(target: File) {
		const token = uploadToken;
		const provider = selectedProvider;
		uploading = true;
		try {
			const result = await media.upload(target, provider === 'none' ? undefined : provider, {
				pubkey: me?.pk,
				purpose: 'note',
				onProgress: (p) => {
					if (token !== uploadToken) return;
					uploadPercent = p.percent;
					uploadDeterministic = p.deterministic;
				}
			});
			if (token !== uploadToken) return; // replaced meanwhile — drop it
			uploaded = result;
		} catch (e) {
			if (token !== uploadToken) return;
			uploadError = (e as Error).message;
		} finally {
			if (token === uploadToken) uploading = false;
		}
	}

	function retryUpload() {
		if (!file || uploading) return;
		uploadError = null;
		uploadPercent = 0;
		void runUpload(file);
	}

	function onVideoMetadata(e: Event) {
		const video = e.currentTarget as HTMLVideoElement;
		if (Number.isFinite(video.videoWidth) && video.videoWidth > 0) {
			meta = {
				width: video.videoWidth,
				height: video.videoHeight,
				duration: Number.isFinite(video.duration) ? video.duration : undefined
			};
		}
	}

	function onImageLoad(e: Event) {
		const img = e.currentTarget as HTMLImageElement;
		if (img.naturalWidth > 0) {
			meta = { width: img.naturalWidth, height: img.naturalHeight };
		}
	}

	// ---- cover frame ---------------------------------------------------------
	/** Scrub-to-frame poster: freeze the stage video at any moment, upload that
	 *  frame, and ship it as the bit's NIP-92 imeta `thumb` so clients without a
	 *  video pipeline can still render a preview card. */
	async function captureCover() {
		const video = stageVideoEl;
		if (!video || !video.videoWidth || coverUploading) return;
		const scale = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight));
		const canvas = document.createElement('canvas');
		canvas.width = Math.round(video.videoWidth * scale);
		canvas.height = Math.round(video.videoHeight * scale);
		canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, 'image/jpeg', 0.85)
		);
		if (!blob) {
			toasts.error('Could not capture that frame');
			return;
		}
		coverUploading = true;
		try {
			const provider = selectedProvider;
			const shot = await media.upload(
				new File([blob], `bit-cover-${Date.now()}.jpg`, { type: 'image/jpeg' }),
				provider === 'none' ? undefined : provider,
				{ pubkey: me?.pk, purpose: 'note' }
			);
			cover = shot.url;
		} catch (e) {
			toasts.error(`Cover upload failed — ${(e as Error).message}`);
		} finally {
			coverUploading = false;
		}
	}

	function scrubCover(event: Event) {
		const seconds = Number((event.currentTarget as HTMLInputElement).value);
		scrubSeconds = seconds;
		if (stageVideoEl) stageVideoEl.currentTime = seconds;
	}

	function onStageTimeUpdate(e: Event) {
		const video = e.currentTarget as HTMLVideoElement;
		scrubSeconds = video.currentTime;
	}

	function cancelMining() {
		mineController?.abort();
	}

	async function submit() {
		if (!canPost || !uploaded || !mediaKind) return;
		posting = true;
		mining = showPow && pow > 0;
		const minedBits = pow;
		const controller = new AbortController();
		mineController = controller;
		powProgress = null;
		try {
			// Let the browser paint the mining state before starting the worker.
			if (mining) await new Promise((resolve) => setTimeout(resolve, 50));
			const eventId = await feed.postBit(uploaded, {
				caption,
				sensitive,
				portrait,
				dim: meta ? `${meta.width}x${meta.height}` : undefined,
				thumb: cover ?? undefined,
				pow: showPow ? pow : 0,
				onPowProgress: (progress) => (powProgress = progress),
				onPhase: (phase) => (postPhase = phase),
				signal: controller.signal
			});
			powPrefs.remember(showPow ? pow : 0);
			powPrefs.rememberPanelVisibility(showPow);
			// Opt-in reach: quote-post the fresh bit as a kind-1 note (NIP-27
			// nevent link). The bit itself is already live on the relays.
			let quoteError: string | null = null;
			if (quoteTimeline && me) {
				try {
					const nevent = neventEncode({ id: eventId, author: me.pk });
					await feed.post(`New bit ⚡ nostr:${nevent}`);
				} catch (e) {
					quoteError = (e as Error).message;
				}
			}
			toasts.push(
				mining
					? `Mined ${minedBits} bits · ${kindInfo?.label ?? 'Bit'} ${eventId.slice(0, 7)}…`
					: `${kindInfo?.label ?? 'Bit'} published to Nostr`,
				'success',
				6000,
				{ label: 'View in Bits', run: () => goto(`/bits#reel=${eventId}`) }
			);
			if (quoteError) toasts.warning(`Bit posted, but the timeline quote failed — ${quoteError}`);
			onposted(eventId);
			reset();
			open = false;
		} catch (e) {
			const message = (e as Error).message;
			if (/cancelled/i.test(message)) toasts.info('Mining cancelled — nothing was posted');
			else toasts.error(message);
		} finally {
			mineController = undefined;
			powProgress = null;
			postPhase = 'idle';
			mining = false;
			posting = false;
		}
	}

	function requestClose() {
		if (mining) {
			cancelMining();
			return;
		}
		if (posting) return; // already publishing — let it land
		if (uploading) {
			toasts.info('Still uploading — one moment…');
			return;
		}
		if (dirty) {
			confirmDiscard = true;
			return;
		}
		open = false;
		reset();
	}

	function discard() {
		confirmDiscard = false;
		reset();
		open = false;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (confirmDiscard) {
			if (event.key === 'Escape') {
				event.preventDefault();
				confirmDiscard = false;
			}
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			requestClose();
			return;
		}
		if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
			event.preventDefault();
			void submit();
		}
	}

	function onDrop(event: DragEvent) {
		event.preventDefault();
		dragOver = false;
		acceptFiles(event.dataTransfer?.files ?? null);
	}

	const providerMenuId = 'bits-composer-provider-menu';
</script>

<svelte:window
	onbeforeunload={(e) => {
		// Guard against losing an in-flight upload / mining run.
		if (posting || mining || uploading) {
			e.preventDefault();
			e.returnValue = '';
		}
	}}
/>

{#if open}
	<div
		class="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-6"
		role="dialog"
		aria-modal="true"
		aria-label="Create a bit"
		tabindex="-1"
		onkeydown={handleKeydown}
		onclick={(event) => {
			if (event.target === event.currentTarget) requestClose();
		}}
	>
		<div
			class="bits-studio-panel flex h-full w-full flex-col overflow-hidden bg-[var(--ui-bg)] text-[var(--ui-text)] shadow-2xl shadow-black/40 sm:h-[min(780px,92vh)] sm:max-w-3xl sm:rounded-2xl sm:border sm:border-[var(--ui-border-muted)]"
			aria-busy={busy}
		>
			<!-- Header -->
			<header
				class="flex h-14 shrink-0 items-center gap-2.5 border-b border-[var(--ui-border-muted)] px-4"
			>
				<span
					class="grid size-9 shrink-0 place-items-center rounded-xl bg-warm-500/12 text-warm-500"
				>
					<Icon name="i-lucide-circle-play" class="size-5" />
				</span>
				<div class="min-w-0 flex-1">
					<h2 class="text-[15px] leading-tight font-bold text-[var(--ui-text-highlighted)]">
						Create a bit
					</h2>
					<p class="truncate text-[11px] text-[var(--ui-text-dimmed)]">
						{kindInfo
							? `${kindInfo.label} · kind ${kindInfo.kind} · ${kindInfo.nip}`
							: 'Short-form video or picture for the Bits feed'}
					</p>
				</div>
				<button
					type="button"
					onclick={requestClose}
					aria-label="Close bit studio"
					class="grid size-9 shrink-0 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] active:scale-95"
				>
					<Icon name="i-lucide-x" class="size-5" />
				</button>
			</header>

			<!-- Body -->
			<div class="min-h-0 flex-1 overflow-y-auto">
				{#if !file}
					<!-- Empty state: drag & drop picker -->
					<div class="flex h-full min-h-[420px] flex-col items-center justify-center p-6">
						<div
							role="button"
							tabindex="0"
							aria-label="Choose a video or picture for your bit"
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
								<Icon name="i-lucide-clapperboard" class="size-8" />
							</span>
							<div>
								<p class="text-[15px] font-bold text-[var(--ui-text-highlighted)]">
									Drop a video or picture
								</p>
								<p class="mt-1 text-[13px] leading-relaxed text-[var(--ui-text-muted)]">
									Portrait videos become short-form bits — up to 200 MB.
								</p>
							</div>
							<span
								class="mt-1 inline-flex items-center gap-1.5 rounded-full bg-warm-500 px-4 py-2 text-[12.5px] font-bold text-white transition group-hover:brightness-110 active:scale-95"
							>
								<Icon name="i-lucide-upload" class="size-4" />
								Choose file
							</span>
							<p class="flex items-center gap-1 text-[11px] text-[var(--ui-text-dimmed)]">
								<Icon name="i-lucide-globe" class="size-3.5" />
								Publishes a standard Nostr media event — playable in every Nostr app
							</p>
						</div>
					</div>
				{:else}
					<div class="grid gap-4 p-4 sm:grid-cols-[minmax(0,260px)_minmax(0,1fr)] sm:gap-5 sm:p-5">
						<!-- 9:16 WYSIWYG stage -->
						<div class="mx-auto w-full max-w-[260px] sm:mx-0">
							<p
								class="mb-1.5 text-[10px] font-bold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
							>
								Preview — plays like this in Bits
							</p>
							<div
								class="relative aspect-[9/16] overflow-hidden rounded-2xl border border-[var(--ui-border-muted)] bg-black"
							>
								{#if mediaKind === 'video'}
									<video
										src={previewUrl}
										class="absolute inset-0 size-full object-contain"
										autoplay
										muted
										loop
										playsinline
										bind:this={stageVideoEl}
										ontimeupdate={onStageTimeUpdate}
										onloadedmetadata={onVideoMetadata}
									></video>
								{:else}
									<img
										src={previewUrl}
										alt="Bit preview"
										class="absolute inset-0 size-full object-contain"
										onload={onImageLoad}
									/>
								{/if}

								<!-- Caption overlay — mirrors the Bits player placement -->
								{#if caption.trim()}
									<div
										class="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-3 pt-10"
									>
										<span class="flex items-center gap-1.5">
											<Avatar
												pubkey={me?.pk ?? ''}
												name={displayName}
												picture={myProfile?.picture}
												size={18}
												shape="hex"
											/>
											<span class="text-[10px] font-bold text-white">{displayName}</span>
										</span>
										<span
											class="mt-1 line-clamp-3 block text-[11px] leading-snug font-semibold text-white"
										>
											{caption.trim()}
										</span>
									</div>
								{/if}
								{#if sensitive}
									<span
										class="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-0.5 text-[9px] font-bold tracking-wide text-warm-500 uppercase backdrop-blur"
									>
										<Icon name="i-lucide-eye-off" class="size-3" />
										sensitive
									</span>
								{/if}
								{#if meta?.duration}
									<span
										class="absolute top-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white tabular-nums backdrop-blur"
									>
										{formatDuration(meta.duration)}
									</span>
								{/if}

								<!-- Upload progress / error overlays -->
								{#if uploading}
									<div
										class="absolute inset-0 grid place-items-center bg-black/50 backdrop-blur-[1px]"
									>
										<div class="relative grid size-14 place-items-center">
											<svg
												class="size-14 -rotate-90"
												viewBox="0 0 36 36"
												fill="none"
												aria-hidden="true"
											>
												<circle
													cx="18"
													cy="18"
													r="15"
													stroke="rgba(255,255,255,0.25)"
													stroke-width="3"
												/>
												<circle
													cx="18"
													cy="18"
													r="15"
													stroke="white"
													stroke-width="3"
													stroke-linecap="round"
													stroke-dasharray={2 * Math.PI * 15}
													stroke-dashoffset={2 * Math.PI * 15 * (1 - uploadPercent / 100)}
													class="transition-[stroke-dashoffset] duration-200 ease-out"
												/>
											</svg>
											{#if uploadDeterministic}
												<span class="absolute text-[11px] font-bold text-white tabular-nums"
													>{uploadPercent}%</span
												>
											{:else}
												<Icon
													name="i-lucide-loader-circle"
													class="absolute size-6 animate-spin text-white"
												/>
											{/if}
										</div>
									</div>
								{:else if uploadError}
									<div class="absolute inset-0 flex flex-col justify-end bg-black/70 p-3">
										<p class="text-[11px] leading-snug font-semibold text-white">
											Upload failed — {uploadError}
										</p>
										<div class="mt-2 flex gap-1.5">
											<button
												type="button"
												onclick={retryUpload}
												class="flex flex-1 items-center justify-center gap-1 rounded-full bg-warm-500 px-2 py-1.5 text-[11px] font-bold text-white transition hover:brightness-110 active:scale-95"
											>
												<Icon name="i-lucide-rotate-ccw" class="size-3.5" />
												Retry upload
											</button>
											<button
												type="button"
												onclick={clearMedia}
												aria-label="Remove media"
												class="grid size-8 place-items-center rounded-full bg-white/15 text-white transition hover:bg-white/30 active:scale-95"
											>
												<Icon name="i-lucide-trash-2" class="size-3.5" />
											</button>
										</div>
									</div>
								{/if}
							</div>

							<!-- Media meta chips -->
							<div class="mt-2 flex flex-wrap items-center gap-1.5">
								{#if kindInfo}
									<span
										class="inline-flex items-center gap-1 rounded-full bg-warm-500/12 px-2 py-0.5 font-mono text-[10px] font-bold text-warm-500"
									>
										<Icon name="i-lucide-shape" class="size-3" />
										kind {kindInfo.kind}
									</span>
								{/if}
								{#if aspectLabel}
									<span
										class="rounded-full bg-[var(--ui-bg-accented)] px-2 py-0.5 font-mono text-[10px] font-bold text-[var(--ui-text-muted)] tabular-nums"
									>
										{aspectLabel}
									</span>
								{/if}
								{#if file}
									<span
										class="rounded-full bg-[var(--ui-bg-accented)] px-2 py-0.5 text-[10px] font-bold text-[var(--ui-text-muted)]"
									>
										{humanBytes(file.size)}
									</span>
								{/if}
								<span class="ml-auto flex items-center gap-1">
									<button
										type="button"
										onclick={() => fileInput?.click()}
										disabled={busy}
										class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] disabled:opacity-40"
									>
										<Icon name="i-lucide-repeat-2" class="size-3" />
										Replace
									</button>
									<button
										type="button"
										onclick={clearMedia}
										disabled={busy}
										aria-label="Remove media"
										class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--tone-error-text)] disabled:opacity-40"
									>
										<Icon name="i-lucide-trash-2" class="size-3" />
										Remove
									</button>
								</span>
							</div>
							{#if oversizeWarn && !uploadError}
								<p class="mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-warm-500">
									<Icon name="i-lucide-triangle-alert" class="size-3.5 shrink-0" />
									Large file — some upload providers may reject it.
								</p>
							{/if}
							{#if mediaKind === 'video' && meta?.duration}
								<!-- Cover frame: scrub the stage, capture a poster frame -->
								<div
									class="mt-2 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] p-2.5"
								>
									<div class="flex items-center justify-between gap-2">
										<p
											class="flex items-center gap-1.5 text-[11px] font-bold text-[var(--ui-text-muted)]"
										>
											<Icon name="i-lucide-image-play" class="size-3.5 text-warm-500" />
											Cover frame
										</p>
										{#if cover}
											<div class="flex items-center gap-1.5">
												<img
													src={cover}
													alt="Captured cover frame"
													class="h-9 w-6 rounded-md border border-[var(--ui-border-muted)] object-cover"
												/>
												<button
													type="button"
													onclick={() => (cover = null)}
													disabled={posting}
													class="rounded-full px-2 py-0.5 text-[10px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg)] hover:text-[var(--tone-error-text)] disabled:opacity-40"
												>
													Remove
												</button>
											</div>
										{:else}
											<button
												type="button"
												onclick={captureCover}
												disabled={coverUploading || posting}
												class="inline-flex items-center gap-1 rounded-full bg-warm-500/12 px-2.5 py-1 text-[10.5px] font-bold text-warm-500 transition hover:bg-warm-500/20 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
											>
												<Icon
													name={coverUploading ? 'i-lucide-loader-circle' : 'i-lucide-camera'}
													class="size-3 {coverUploading ? 'animate-spin' : ''}"
												/>
												{coverUploading ? 'Uploading…' : 'Capture this frame'}
											</button>
										{/if}
									</div>
									<div class="mt-2 flex items-center gap-2">
										<input
											type="range"
											min="0"
											max={meta.duration}
											step="0.05"
											value={scrubSeconds}
											oninput={scrubCover}
											disabled={posting}
											aria-label="Scrub video to choose the cover frame"
											class="h-1.5 min-w-0 flex-1 accent-[var(--color-warm-500)]"
										/>
										<span
											class="shrink-0 font-mono text-[10px] font-bold text-[var(--ui-text-dimmed)] tabular-nums"
										>
											{formatDuration(scrubSeconds)} / {formatDuration(meta.duration)}
										</span>
									</div>
								</div>
							{/if}
						</div>

						<!-- Controls -->
						<div class="flex min-w-0 flex-col gap-3">
							<div
								class="rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3.5 py-3 transition focus-within:border-warm-500 focus-within:bg-[var(--ui-bg)] focus-within:ring-2 focus-within:ring-warm-500/20"
							>
								<textarea
									bind:value={caption}
									rows="3"
									maxlength={HARD_CAP}
									placeholder="Write a caption… #hashtags and @mentions work"
									aria-label="Bit caption"
									readonly={posting}
									class="w-full resize-none bg-transparent text-[15px] leading-relaxed text-[var(--ui-text)] outline-none placeholder:text-[var(--ui-text-dimmed)]"
								></textarea>
								{#if caption.length > SOFT_CAP - 50}
									<p
										class="text-right text-[10.5px] font-bold tabular-nums {overHard
											? 'text-[var(--tone-error-text)]'
											: overSoft
												? 'text-warm-500'
												: 'text-[var(--ui-text-dimmed)]'}"
									>
										{caption.length} / {overSoft ? HARD_CAP : SOFT_CAP}
									</p>
								{/if}
								{#if tagSuggestions.length}
									<!-- Hashtag suggestions — one tap completes the typed tag -->
									<div class="mt-1.5 flex flex-wrap items-center gap-1">
										<span class="text-[var(--ui-text-dimmed)]">
											<Icon name="i-lucide-hash" class="size-3" />
											<span class="sr-only">Suggested hashtags</span>
										</span>
										{#each tagSuggestions as tag (tag)}
											<button
												type="button"
												onclick={() => applyTagSuggestion(tag)}
												class="rounded-full bg-[var(--ui-bg-accented)] px-2 py-0.5 text-[11px] font-bold text-primary-500 transition hover:bg-primary-500/15 active:scale-95"
											>
												#{tag}
											</button>
										{/each}
									</div>
								{/if}
							</div>

							<div class="flex flex-wrap items-center gap-1.5">
								<button
									type="button"
									onclick={() => (sensitive = !sensitive)}
									aria-pressed={sensitive}
									title="Mark as sensitive content"
									class="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold transition {sensitive
										? 'bg-warm-500/15 text-warm-500'
										: 'text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]'}"
								>
									<Icon name="i-lucide-eye-off" class="size-4" />
									Sensitive
								</button>
								<button
									type="button"
									onclick={() => (showPow = !showPow)}
									disabled={mining}
									aria-pressed={showPow}
									title="Mine a rare bit — NIP-13 proof of work"
									class="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold transition disabled:pointer-events-none disabled:opacity-40 {showPow
										? 'bg-primary-500/10 text-primary-600'
										: 'text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]'}"
								>
									<Icon
										name={mining ? 'i-lucide-pickaxe' : 'i-lucide-gem'}
										class="size-4 {mining ? 'animate-pulse' : ''}"
									/>
									Rare bit
								</button>
								<button
									type="button"
									onclick={() => (quoteTimeline = !quoteTimeline)}
									aria-pressed={quoteTimeline}
									title="Also share a kind-1 quote note linking your bit — reaches clients without a Bits feed"
									class="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold transition {quoteTimeline
										? 'bg-primary-500/10 text-primary-600'
										: 'text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]'}"
								>
									<Icon name="i-lucide-repeat" class="size-4" />
									Quote to timeline
								</button>
								<Popover
									id={providerMenuId}
									placement="top-start"
									width="lg"
									label="Upload provider"
									triggerClass="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]"
									triggerActiveClass="bg-primary-500/10 text-primary-600"
								>
									{#snippet trigger()}
										<Icon name="i-lucide-cloud-upload" class="size-4 text-primary-500" />
										<span class="max-w-[110px] truncate">{selectedProviderLabel}</span>
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

							{#if showPow}
								<PowCard bind:pow {mining} progress={powProgress} oncancel={cancelMining} />
							{/if}

							<p class="flex items-center gap-1.5 text-[11px] text-[var(--ui-text-dimmed)]">
								<Icon name="i-lucide-globe" class="size-3.5 shrink-0 text-primary-500" />
								Publishes to {writeRelayCount}
								{writeRelayCount === 1 ? 'relay' : 'relays'} — your bit is a standard
								{kindInfo?.nip ?? 'Nostr'} event any client can play.
							</p>
						</div>
					</div>
				{/if}
			</div>

			<!-- Footer -->
			{#if file}
				<footer
					class="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--ui-border-muted)] px-4 py-3"
				>
					<p
						class="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-[var(--ui-text-muted)]"
					>
						{#if uploading}
							Uploading {uploadPercent}% via {selectedProviderLabel}…
						{:else if uploadError}
							<span class="text-[var(--tone-error-text)]">Upload failed — retry to publish</span>
						{:else if uploaded}
							{kindInfo?.label ?? 'Bit'} ready — {humanBytes(uploaded.bytes)} on {providerLabel(
								uploaded.provider
							)}
						{:else}
							Your media and caption stay on this device until you post.
						{/if}
					</p>
					<button
						type="button"
						onclick={submit}
						disabled={!canPost}
						title="Post bit (Ctrl+Enter)"
						class="flex shrink-0 items-center gap-1.5 rounded-full bg-warm-500 px-5 py-2 text-[13px] font-bold text-white shadow-[0_2px_12px_rgba(255,117,95,0.35)] transition-all hover:brightness-110 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
					>
						<Icon
							name={posting || uploading ? 'i-lucide-loader-circle' : 'i-lucide-circle-play'}
							class="size-4 {posting || uploading ? 'animate-spin' : ''}"
						/>
						{#if posting}
							{postPhase === 'mining'
								? 'Mining…'
								: postPhase === 'publishing'
									? 'Publishing…'
									: 'Posting…'}
						{:else if uploading}
							Uploading {uploadPercent}%
						{:else}
							Post bit
						{/if}
					</button>
				</footer>
			{/if}
		</div>

		<!-- Discard confirmation -->
		{#if confirmDiscard}
			<div
				class="absolute inset-0 z-10 grid place-items-center bg-black/55 p-4 backdrop-blur-[2px]"
				role="alertdialog"
				aria-modal="true"
				aria-label="Discard this bit?"
				tabindex="-1"
				onclick={(event) => {
					if (event.target === event.currentTarget) confirmDiscard = false;
				}}
				onkeydown={(event) => {
					if (event.key === 'Escape') {
						event.preventDefault();
						confirmDiscard = false;
					}
				}}
			>
				<div
					class="surface-card w-full max-w-xs rounded-2xl p-5 text-center shadow-2xl shadow-black/30"
				>
					<span
						class="mx-auto grid size-12 place-items-center rounded-2xl bg-warm-500/12 text-warm-500"
					>
						<Icon name="i-lucide-trash-2" class="size-6" />
					</span>
					<p class="mt-3 text-[15px] font-bold text-[var(--ui-text-highlighted)]">
						Discard this bit?
					</p>
					<p class="mt-1 text-[13px] leading-relaxed text-[var(--ui-text-muted)]">
						Your media and caption will be lost.
					</p>
					<div class="mt-4 flex gap-2">
						<button
							type="button"
							onclick={() => (confirmDiscard = false)}
							class="flex-1 rounded-full border border-[var(--ui-border-accented)] px-4 py-2 text-[13px] font-bold text-[var(--ui-text)] transition hover:bg-[var(--ui-bg-muted)] active:scale-95"
						>
							Keep editing
						</button>
						<button
							type="button"
							onclick={discard}
							class="flex-1 rounded-full bg-[var(--tone-error-text)] px-4 py-2 text-[13px] font-bold text-white transition hover:brightness-110 active:scale-95"
						>
							Discard
						</button>
					</div>
				</div>
			</div>
		{/if}
	</div>
{/if}

<input
	bind:this={fileInput}
	type="file"
	accept="video/*,image/*"
	class="hidden"
	onchange={onFileInput}
/>

<style>
	.bits-studio-panel {
		animation: bits-studio-in 150ms ease-out;
	}

	@keyframes bits-studio-in {
		from {
			opacity: 0;
			transform: translateY(10px) scale(0.985);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.bits-studio-panel {
			animation: none;
		}
	}
</style>
