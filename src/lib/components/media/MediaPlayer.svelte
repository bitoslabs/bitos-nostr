<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';

	type MediaKind = 'video' | 'audio';
	type PlayerVariant = 'surface' | 'reel';

	let {
		src,
		/** Ordered fallback URLs tried automatically when `src` fails to load
		 * (dead CDN, mirrored media, …). Mirrors the NIP-92 idea that the same
		 * bytes may live at several addresses. */
		fallbackSrcs = [],
		kind = 'video',
		label = kind === 'video' ? 'Video player' : 'Audio player',
		class: className = '',
		mediaClass = '',
		variant = 'surface',
		loop = false,
		playsinline = true,
		preload = 'metadata',
		muted = false,
		showFullscreen = kind === 'video',
		controls = true,
		overlayControls = false,
		autoplay = false,
		/** Hide the reel chrome while playing; it fades back in on any pointer
		 * activity. Only applies to the `reel` variant. */
		autoHide = true,
		onMediaElement,
		onMutedChange,
		onDoubleTap
	}: {
		src: string;
		fallbackSrcs?: string[];
		kind?: MediaKind;
		label?: string;
		class?: string;
		mediaClass?: string;
		variant?: PlayerVariant;
		loop?: boolean;
		playsinline?: boolean;
		preload?: 'none' | 'metadata' | 'auto';
		muted?: boolean;
		showFullscreen?: boolean;
		controls?: boolean;
		overlayControls?: boolean;
		/** Start playback as soon as the element mounts (used by the discover
		 * media viewer, mirroring its old `autoplay` video). */
		autoplay?: boolean;
		autoHide?: boolean;
		onMediaElement?: (element: HTMLMediaElement) => void | (() => void);
		onMutedChange?: (muted: boolean) => void;
		/** Fires with tap coordinates (px, relative to the video) when the
		 * surface is double-tapped/double-clicked. Single taps still toggle
		 * playback — with a tiny grace window so the two never fight. */
		onDoubleTap?: (x: number, y: number) => void;
	} = $props();

	let media = $state<HTMLMediaElement>();
	let player = $state<HTMLDivElement>();
	let isPlaying = $state(false);
	let currentTime = $state(0);
	let duration = $state(0);
	let volume = $state(1);
	let isMuted = $state(false);
	/** Tap-to-cycle speed ladder for the reel speed pill. */
	const RATE_ORDER: readonly number[] = [1, 1.25, 1.5, 2, 0.5];
	const RATE_STORAGE_KEY = 'bitos:video-playback-rate';

	function readStoredRate(): number {
		try {
			const stored = Number(localStorage.getItem(RATE_STORAGE_KEY));
			return RATE_ORDER.includes(stored) ? stored : 1;
		} catch {
			return 1;
		}
	}

	let playbackRate = $state<number>(readStoredRate());
	let isFullscreen = $state(false);
	let hasError = $state(false);
	/** Candidate URLs: primary first, then fallbacks. Index 0 = the given src. */
	let srcIndex = $state(0);
	const candidates = $derived([src, ...fallbackSrcs]);
	const activeSrc = $derived(candidates[Math.min(srcIndex, candidates.length - 1)]);
	let isBuffering = $state(false);
	let bufferedPct = $state(0);
	let controlsVisible = $state(true);
	let flash = $state<'' | 'play' | 'pause'>('');
	let hideTimer: ReturnType<typeof setTimeout> | undefined;
	let flashTimer: ReturnType<typeof setTimeout> | undefined;
	let clickTimer: ReturnType<typeof setTimeout> | undefined;
	let isBoosting = $state(false);
	let boostRestoreRate = 1;
	let pressTimer: ReturnType<typeof setTimeout> | undefined;

	const progress = $derived(duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0);
	const formattedCurrentTime = $derived(formatTime(currentTime));
	const formattedDuration = $derived(formatTime(duration));

	$effect(() => {
		if (!media) return;
		media.muted = muted;
		isMuted = muted;
	});

	$effect(() => {
		if (!media || !onMediaElement) return;
		return onMediaElement(media);
	});

	$effect(() => {
		// Apply the remembered playback speed whenever a media element binds.
		if (media) media.playbackRate = playbackRate;
	});

	$effect(() => {
		if (!media || !autoplay) return;
		void media.play().catch(() => {
			// Autoplay can be blocked until the user interacts with the page.
		});
	});

	$effect(() => {
		// Re-arm the auto-hide timer whenever play state flips so a freshly
		// paused reel always shows its chrome.
		if (variant !== 'reel' || !autoHide) return;
		if (!isPlaying) {
			controlsVisible = true;
			clearTimeout(hideTimer);
			return;
		}
		pokeControls();
	});

	$effect(() => () => clearTimeout(hideTimer));
	$effect(() => () => clearTimeout(pressTimer));

	function formatTime(seconds: number) {
		if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
		const minutes = Math.floor(seconds / 60);
		const remaining = Math.floor(seconds % 60)
			.toString()
			.padStart(2, '0');
		return `${minutes}:${remaining}`;
	}

	function pokeControls() {
		controlsVisible = true;
		clearTimeout(hideTimer);
		if (variant !== 'reel' || !autoHide || !isPlaying) return;
		hideTimer = setTimeout(() => (controlsVisible = false), 2600);
	}

	function showFlash(next: 'play' | 'pause') {
		flash = next;
		clearTimeout(flashTimer);
		flashTimer = setTimeout(() => (flash = ''), 620);
	}

	async function togglePlayback() {
		if (!media) return;
		if (media.paused) {
			try {
				await media.play();
				showFlash('play');
			} catch {
				hasError = true;
			}
		} else {
			media.pause();
			showFlash('pause');
		}
		pokeControls();
	}

	function seek(seconds: number) {
		if (!media || !Number.isFinite(media.duration)) return;
		media.currentTime = Math.max(0, Math.min(media.duration, media.currentTime + seconds));
		pokeControls();
	}

	function setProgress(event: Event) {
		if (!media) return;
		const value = Number((event.currentTarget as HTMLInputElement).value);
		media.currentTime = (value / 100) * duration;
		pokeControls();
	}

	function setVolume(event: Event) {
		if (!media) return;
		const nextVolume = Number((event.currentTarget as HTMLInputElement).value);
		media.volume = nextVolume;
		media.muted = nextVolume === 0;
		pokeControls();
	}

	function toggleMuted() {
		if (!media) return;
		media.muted = !media.muted;
		pokeControls();
	}

	function setRate(event: Event) {
		applyRate(Number((event.currentTarget as HTMLSelectElement).value));
	}

	/** Set + persist the playback speed; `ratechange` syncs the state. */
	function applyRate(rate: number) {
		if (!media || !Number.isFinite(rate) || rate <= 0) return;
		media.playbackRate = rate;
		try {
			localStorage.setItem(RATE_STORAGE_KEY, String(rate));
		} catch {
			/* Speed preference is best-effort only. */
		}
		pokeControls();
	}

	/** Tap the speed pill: cycle 1× → 1.25× → 1.5× → 2× → 0.5× → 1×. */
	function cycleRate() {
		const index = RATE_ORDER.indexOf(playbackRate);
		applyRate(RATE_ORDER[(index + 1) % RATE_ORDER.length]);
	}

	async function toggleFullscreen() {
		if (!media || kind !== 'video') return;
		try {
			if (document.fullscreenElement) {
				await document.exitFullscreen();
				return;
			}
			// Reels retain their whole card. Elsewhere fullscreen the shared player
			// shell, keeping our BitOS control overlay visible with the video.
			const stage = media.closest('.reel-card') ?? player ?? media;
			await stage.requestFullscreen();
		} catch {
			// Fullscreen is optional and can be disabled by an embedded browser.
		}
	}

	function handleSurfaceClick() {
		// When a double-tap consumer is attached, delay the single-tap toggle
		// briefly so a quick second tap cancels it instead of toggling twice.
		if (onDoubleTap) {
			clearTimeout(clickTimer);
			clickTimer = setTimeout(() => void togglePlayback(), 240);
			return;
		}
		void togglePlayback();
	}

	function handleSurfaceDoubleTap(event: MouseEvent) {
		if (!onDoubleTap) return;
		clearTimeout(clickTimer);
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		onDoubleTap(event.clientX - rect.left, event.clientY - rect.top);
	}

	/** Hold (long-press) the reel surface: temporary 2× boost — release to
	 * restore the previous speed. YouTube-style skimming for slow bitz. */
	function handleSurfacePointerDown(event: PointerEvent) {
		if (!onDoubleTap) return; // boost gesture only where double-tap lives (reels)
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		clearTimeout(pressTimer);
		pressTimer = setTimeout(() => {
			if (!media || media.paused) return;
			boostRestoreRate = media.playbackRate;
			media.playbackRate = 2;
			isBoosting = true;
			// Keep the chrome visible so the "2× hold" badge + lit pill are seen.
			controlsVisible = true;
			clearTimeout(hideTimer);
		}, 400);
	}

	function endSurfacePress() {
		clearTimeout(pressTimer);
		if (!isBoosting || !media) return;
		media.playbackRate = boostRestoreRate;
		isBoosting = false;
	}

	function preventContextMenu(event: Event) {
		// The long-press speed boost would otherwise summon the mobile context menu.
		if (onDoubleTap) event.preventDefault();
	}

	/** Advance to the next candidate URL; called on load errors. Returns true
	 * when a fallback was armed, false when the chain is exhausted (→ error UI). */
	function tryNextCandidate() {
		if (srcIndex < candidates.length - 1) {
			srcIndex += 1;
			isBuffering = true;
			return true;
		}
		return false;
	}

	function retryLoad() {
		hasError = false;
		isBuffering = true;
		media?.load();
	}

	function updateState() {
		if (!media) return;
		currentTime = media.currentTime || 0;
		duration = Number.isFinite(media.duration) ? media.duration : 0;
		volume = media.volume;
		isMuted = media.muted;
		playbackRate = media.playbackRate;
		onMutedChange?.(media.muted);
	}

	function updateBuffered() {
		if (!media || !Number.isFinite(media.duration) || media.duration <= 0) return;
		const video = media as HTMLVideoElement;
		if (!video.buffered?.length) return;
		bufferedPct = Math.min(
			100,
			(video.buffered.end(video.buffered.length - 1) / video.duration) * 100
		);
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	bind:this={player}
	class="media-player {variant === 'reel' ? 'media-player-reel' : ''} {overlayControls
		? 'media-player-overlay'
		: ''} {className}"
	onpointermove={pokeControls}
>
	{#if kind === 'video'}
		<!-- svelte-ignore a11y_media_has_caption -->
		<video
			bind:this={media}
			src={activeSrc}
			class={mediaClass}
			{loop}
			{playsinline}
			{preload}
			onplay={() => (isPlaying = true)}
			onpause={() => (isPlaying = false)}
			onended={() => (isPlaying = false)}
			onloadedmetadata={updateState}
			ontimeupdate={updateState}
			onvolumechange={updateState}
			onratechange={updateState}
			onprogress={updateBuffered}
			onwaiting={() => (isBuffering = true)}
			onplaying={() => (isBuffering = false)}
			oncanplay={() => (isBuffering = false)}
			onerror={() => {
				if (tryNextCandidate()) return; // dead URL — quietly try the mirror
				hasError = true;
				isBuffering = false;
			}}
			onclick={handleSurfaceClick}
			ondblclick={handleSurfaceDoubleTap}
			onpointerdown={handleSurfacePointerDown}
			onpointerup={endSurfacePress}
			onpointercancel={endSurfacePress}
			oncontextmenu={preventContextMenu}
			aria-label={label}
			title="Click to play or pause · double-tap to like · hold for 2× speed"
		></video>
	{:else}
		<audio
			bind:this={media}
			src={activeSrc}
			{loop}
			{preload}
			onplay={() => (isPlaying = true)}
			onpause={() => (isPlaying = false)}
			onended={() => (isPlaying = false)}
			onloadedmetadata={updateState}
			ontimeupdate={updateState}
			onvolumechange={updateState}
			onratechange={updateState}
			onerror={() => {
				if (tryNextCandidate()) return;
				hasError = true;
			}}
			aria-label={label}
		></audio>
	{/if}

	{#if variant === 'reel' && controls}
		<!-- Play/pause flash feedback at the center of the surface -->
		{#if flash}
			<div class="media-flash" aria-hidden="true">
				<Icon name={flash === 'play' ? 'i-lucide-play' : 'i-lucide-pause'} class="size-9" />
			</div>
		{/if}
		{#if isBuffering && !hasError}
			<div class="media-buffer" aria-hidden="true">
				<span class="media-buffer-dot"></span>
			</div>
		{/if}
		{#if hasError}
			<div class="media-reel-error" role="alert">
				<Icon name="i-lucide-circle-alert" class="size-5 shrink-0" />
				<span class="min-w-0">Couldn't play this video.</span>
				<div class="ml-auto flex shrink-0 items-center gap-1">
					<button type="button" class="media-reel-error-action" onclick={retryLoad}> Retry </button>
					<a href={activeSrc} target="_blank" rel="noreferrer" class="media-reel-error-action">
						Open ↗
					</a>
				</div>
			</div>
		{/if}
		<!-- Minimal auto-hiding chrome: seekable progress + time + play/pause + mute -->
		<div class="media-reel-bar" class:is-idle={!controlsVisible} aria-label={`${label} controls`}>
			<div class="media-reel-track">
				<span class="media-reel-buffered" style={`width:${bufferedPct}%`}></span>
				<input
					class="media-reel-range"
					type="range"
					min="0"
					max="100"
					step="0.1"
					value={progress}
					oninput={setProgress}
					aria-label="Seek"
					style={`--media-progress: ${progress}%`}
				/>
			</div>
			<div class="media-reel-buttons">
				<button
					type="button"
					class="media-reel-button"
					onclick={togglePlayback}
					aria-label={isPlaying ? 'Pause' : 'Play'}
				>
					<Icon name={isPlaying ? 'i-lucide-pause' : 'i-lucide-play'} class="size-4.5" />
				</button>
				<span
					class="media-reel-time"
					aria-label={`${formattedCurrentTime} of ${formattedDuration}`}
				>
					{formattedCurrentTime} / {formattedDuration}
				</span>
				{#if isBoosting}
					<span class="media-reel-boost" aria-hidden="true">
						<Icon name="i-lucide-fast-forward" class="size-3.5" />
						2× hold
					</span>
				{/if}
				<div class="ml-auto flex items-center gap-1">
					<button
						type="button"
						class="media-reel-button"
						onclick={() => seek(-5)}
						aria-label="Back 5 seconds"
					>
						<Icon name="i-lucide-rotate-ccw" class="size-4" />
					</button>
					<button
						type="button"
						class="media-reel-button"
						onclick={() => seek(5)}
						aria-label="Forward 5 seconds"
					>
						<Icon name="i-lucide-rotate-cw" class="size-4" />
					</button>
					<!-- Speed pill: tap to cycle 1× → 1.25× → 1.5× → 2× → 0.5× (remembered). -->
					<button
						type="button"
						class="media-reel-rate {playbackRate !== 1 || isBoosting ? 'is-active' : ''}"
						onclick={cycleRate}
						aria-label={`Playback speed ${isBoosting ? 2 : playbackRate}× — tap to change`}
						title="Playback speed — hold video for 2×"
					>
						{isBoosting ? '2×' : `${playbackRate}×`}
					</button>
					<!-- Volume: mute toggle; slider unfolds on hover/focus (desktop).
					Mobile keeps just the toggle — hardware keys own volume there. -->
					<div class="media-reel-volume">
						<button
							type="button"
							class="media-reel-button"
							onclick={toggleMuted}
							aria-label={isMuted ? 'Turn sound on' : 'Mute'}
						>
							<Icon
								name={isMuted || volume === 0
									? 'i-lucide-volume-x'
									: volume < 0.5
										? 'i-lucide-volume-1'
										: 'i-lucide-volume-2'}
								class="size-4.5"
							/>
						</button>
						<input
							class="media-reel-volume-range"
							type="range"
							min="0"
							max="1"
							step="0.05"
							value={isMuted ? 0 : volume}
							style={`--media-volume: ${(isMuted ? 0 : volume) * 100}`}
							oninput={setVolume}
							aria-label="Volume"
						/>
					</div>
					<button
						type="button"
						class="media-reel-button"
						onclick={toggleFullscreen}
						aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
						title="Fullscreen (f)"
					>
						<Icon
							name={isFullscreen ? 'i-lucide-minimize' : 'i-lucide-maximize'}
							class="size-4.5"
						/>
					</button>
				</div>
			</div>
		</div>
	{:else if controls}
		<div class="media-controls" aria-label={`${label} controls`}>
			<div class="media-controls-main">
				<button
					type="button"
					class="media-control-button media-control-primary"
					onclick={togglePlayback}
					aria-label={isPlaying ? 'Pause' : 'Play'}
				>
					<Icon name={isPlaying ? 'i-lucide-pause' : 'i-lucide-play'} class="size-4" />
				</button>
				<button
					type="button"
					class="media-control-button media-control-secondary"
					onclick={() => seek(-10)}
					aria-label="Back 10 seconds"
				>
					<Icon name="i-lucide-rotate-ccw" class="size-3.5" />
				</button>
				<button
					type="button"
					class="media-control-button media-control-secondary"
					onclick={() => seek(10)}
					aria-label="Forward 10 seconds"
				>
					<Icon name="i-lucide-rotate-cw" class="size-3.5" />
				</button>
				<span class="media-time" aria-label={`${formattedCurrentTime} of ${formattedDuration}`}
					>{formattedCurrentTime} / {formattedDuration}</span
				>
				<input
					class="media-progress"
					type="range"
					min="0"
					max="100"
					step="0.1"
					value={progress}
					oninput={setProgress}
					aria-label="Seek"
					style={`--media-progress: ${progress}%`}
				/>
				<button
					type="button"
					class="media-control-button media-control-secondary"
					onclick={toggleMuted}
					aria-label={isMuted ? 'Turn sound on' : 'Mute'}
				>
					<Icon
						name={isMuted || volume === 0 ? 'i-lucide-volume-x' : 'i-lucide-volume-2'}
						class="size-4"
					/>
				</button>
				<input
					class="media-volume"
					type="range"
					min="0"
					max="1"
					step="0.05"
					value={isMuted ? 0 : volume}
					oninput={setVolume}
					aria-label="Volume"
				/>
				<select
					class="media-rate"
					value={playbackRate}
					onchange={setRate}
					aria-label="Playback speed"
				>
					{#each [0.5, 0.75, 1, 1.25, 1.5, 2] as rate (rate)}
						<option value={rate}>{rate}×</option>
					{/each}
				</select>
				{#if showFullscreen}
					<button
						type="button"
						class="media-control-button media-control-secondary"
						onclick={toggleFullscreen}
						aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
					>
						<Icon name={isFullscreen ? 'i-lucide-minimize' : 'i-lucide-expand'} class="size-4" />
					</button>
				{/if}
			</div>
			{#if hasError}<p class="media-error">
					Media could not be played. Try opening the source directly.
				</p>{/if}
		</div>
	{/if}
</div>

<svelte:window
	onfullscreenchange={() =>
		(isFullscreen =
			document.fullscreenElement === media ||
			document.fullscreenElement === player ||
			document.fullscreenElement === media?.closest?.('.reel-card'))}
/>

<style>
	.media-player {
		min-width: 0;
	}
	/* Fullscreen the component shell, not only the <video>, so its designed
	 * control layer remains part of the fullscreen experience. */
	.media-player:fullscreen {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		max-width: none;
		background: #000;
	}
	.media-player:fullscreen video {
		max-height: 100vh !important;
	}
	.media-player audio {
		display: block;
		width: 100%;
	}
	.media-controls {
		color: var(--ui-text);
	}
	.media-controls-main {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		min-width: 0;
		padding: 0.65rem;
		border: 1px solid var(--ui-border-muted);
		border-radius: var(--ui-radius-lg);
		background: var(--ui-bg-elevated);
	}
	.media-control-button {
		display: grid;
		flex: none;
		width: 2rem;
		height: 2rem;
		place-items: center;
		border-radius: var(--ui-radius-md);
		transition:
			background-color 0.15s ease,
			transform 0.15s ease;
	}
	.media-control-button:hover {
		background: var(--interactive-hover-bg);
	}
	.media-control-button:active {
		transform: scale(0.94);
	}
	.media-control-primary {
		background: var(--color-primary-500);
		color: white;
	}
	.media-control-primary:hover {
		background: var(--color-primary-600);
	}
	.media-control-secondary {
		color: var(--ui-text-muted);
	}
	.media-time {
		flex: none;
		font-size: 0.7rem;
		font-variant-numeric: tabular-nums;
		color: var(--ui-text-muted);
		white-space: nowrap;
	}
	.media-progress,
	.media-volume {
		accent-color: var(--color-primary-500);
		cursor: pointer;
	}
	.media-progress {
		min-width: 2.5rem;
		flex: 1;
	}
	.media-volume {
		width: 3.5rem;
	}
	.media-rate {
		width: 3.35rem;
		border: 0;
		border-radius: var(--ui-radius-sm);
		background: transparent;
		color: inherit;
		font-size: 0.75rem;
		font-weight: 700;
		outline: none;
	}
	.media-rate option {
		color: var(--ui-text);
		background: var(--ui-bg-elevated);
	}
	.media-error {
		margin: 0.4rem 0.2rem 0;
		font-size: 0.75rem;
		color: var(--ui-text-muted);
	}

	/* ---- Reel variant: full-bleed player with minimal fading chrome ---- */
	.media-player-reel {
		position: absolute;
		inset: 0;
	}
	.media-flash {
		position: absolute;
		top: 50%;
		left: 50%;
		z-index: 12;
		display: grid;
		width: 74px;
		height: 74px;
		place-items: center;
		border-radius: 9999px;
		color: #fff;
		background: rgb(0 0 0 / 0.32);
		backdrop-filter: blur(6px);
		pointer-events: none;
		animation: media-flash-pop 0.62s ease-out forwards;
	}
	@keyframes media-flash-pop {
		0% {
			transform: translate(-50%, -50%) scale(0.55);
			opacity: 0;
		}
		22% {
			transform: translate(-50%, -50%) scale(1.06);
			opacity: 1;
		}
		62% {
			opacity: 1;
		}
		100% {
			transform: translate(-50%, -50%) scale(1.14);
			opacity: 0;
		}
	}
	.media-buffer {
		position: absolute;
		top: 50%;
		left: 50%;
		z-index: 11;
		transform: translate(-50%, -50%);
		pointer-events: none;
	}
	.media-buffer-dot {
		display: block;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 9999px;
		border: 2.5px solid rgb(255 255 255 / 0.28);
		border-top-color: #fff;
		animation: media-spin 0.8s linear infinite;
	}
	@keyframes media-spin {
		to {
			transform: rotate(360deg);
		}
	}
	.media-reel-error {
		position: absolute;
		top: 50%;
		left: 50%;
		z-index: 13;
		display: flex;
		width: min(88%, 22rem);
		translate: -50% -50%;
		align-items: center;
		gap: 0.6rem;
		border-radius: 1rem;
		background: rgb(10 12 16 / 0.82);
		color: rgb(255 255 255 / 0.92);
		font-size: 0.8rem;
		font-weight: 600;
		padding: 0.9rem 1rem;
		backdrop-filter: blur(10px);
	}
	.media-reel-error-action {
		border-radius: 9999px;
		background: rgb(255 255 255 / 0.14);
		color: inherit;
		font-size: 0.72rem;
		font-weight: 700;
		padding: 0.32rem 0.7rem;
		transition: background-color 0.15s ease;
	}
	.media-reel-error-action:hover {
		background: rgb(255 255 255 / 0.26);
	}
	.media-reel-bar {
		position: absolute;
		z-index: 14;
		right: 0;
		bottom: 0;
		left: 0;
		color: #fff;
		padding: 1.6rem 0.9rem 0.7rem;
		background: linear-gradient(to top, rgb(0 0 0 / 0.62), rgb(0 0 0 / 0.22) 55%, transparent);
		transition: opacity 0.28s ease;
	}
	.media-reel-bar.is-idle {
		opacity: 0;
		pointer-events: none;
	}
	.media-reel-track {
		position: relative;
		height: 18px;
		display: flex;
		align-items: center;
		cursor: pointer;
		touch-action: none;
	}
	.media-reel-track::before {
		content: '';
		position: absolute;
		right: 0;
		left: 0;
		height: 3px;
		border-radius: 9999px;
		background: rgb(255 255 255 / 0.28);
		transition: height 0.15s ease;
	}
	.media-reel-track:hover::before,
	.media-reel-track:has(input:active)::before {
		height: 6px;
	}
	.media-reel-buffered {
		position: absolute;
		left: 0;
		height: 3px;
		border-radius: 9999px;
		background: rgb(255 255 255 / 0.4);
		transition: width 0.25s ease;
	}
	.media-reel-range {
		position: relative;
		z-index: 1;
		width: 100%;
		margin: 0;
		height: 3px;
		appearance: none;
		-webkit-appearance: none;
		border-radius: 9999px;
		background: transparent;
		cursor: pointer;
		outline: none;
		/* Filled portion drawn under the transparent track via a gradient. */
		background-image: linear-gradient(
			to right,
			#fff var(--media-progress, 0%),
			transparent var(--media-progress, 0%)
		);
		box-shadow: inset 0 0 0 3px transparent;
	}
	.media-reel-range::-webkit-slider-thumb {
		appearance: none;
		-webkit-appearance: none;
		width: 13px;
		height: 13px;
		border-radius: 9999px;
		background: #fff;
		box-shadow: 0 1px 6px rgb(0 0 0 / 0.45);
		opacity: 0;
		transition: opacity 0.15s ease;
	}
	.media-reel-range:hover::-webkit-slider-thumb,
	.media-reel-range:focus-visible::-webkit-slider-thumb,
	.media-reel-range:active::-webkit-slider-thumb {
		opacity: 1;
	}
	.media-reel-range::-moz-range-thumb {
		width: 13px;
		height: 13px;
		border: 0;
		border-radius: 9999px;
		background: #fff;
		box-shadow: 0 1px 6px rgb(0 0 0 / 0.45);
		opacity: 0;
		transition: opacity 0.15s ease;
	}
	.media-reel-range:hover::-moz-range-thumb,
	.media-reel-range:focus-visible::-moz-range-thumb,
	.media-reel-range:active::-moz-range-thumb {
		opacity: 1;
	}
	.media-reel-buttons {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin-top: 0.15rem;
		min-width: 0;
	}
	.media-reel-button {
		display: grid;
		flex: none;
		width: 2.1rem;
		height: 2.1rem;
		place-items: center;
		border-radius: 9999px;
		color: rgb(255 255 255 / 0.92);
		transition:
			background-color 0.15s ease,
			transform 0.15s ease;
	}
	.media-reel-button:hover {
		background: rgb(255 255 255 / 0.16);
	}
	.media-reel-button:active {
		transform: scale(0.92);
	}
	.media-reel-time {
		flex: none;
		font-size: 0.7rem;
		font-variant-numeric: tabular-nums;
		color: rgb(255 255 255 / 0.85);
		white-space: nowrap;
	}

	/* Speed pill — tap cycles the ladder; lit while off 1× or boosting. */
	.media-reel-rate {
		flex: none;
		min-width: 2.5rem;
		padding: 0 0.5rem;
		height: 1.7rem;
		border-radius: 9999px;
		font-size: 0.72rem;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		color: rgb(255 255 255 / 0.85);
		background: rgb(255 255 255 / 0.12);
		transition:
			background-color 0.15s ease,
			transform 0.15s ease,
			color 0.15s ease;
	}
	.media-reel-rate:hover {
		background: rgb(255 255 255 / 0.22);
	}
	.media-reel-rate:active {
		transform: scale(0.92);
	}
	.media-reel-rate.is-active {
		color: #fff;
		background: var(--color-primary-500);
	}
	.media-reel-rate.is-active:hover {
		background: var(--color-primary-600);
	}

	/* 2× hold-to-boost indicator shown while long-pressing. */
	.media-reel-boost {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		flex: none;
		padding: 0.18rem 0.55rem;
		border-radius: 9999px;
		font-size: 0.68rem;
		font-weight: 800;
		color: #fff;
		background: var(--color-primary-500);
		box-shadow: 0 6px 18px rgb(47 149 246 / 0.45);
		animation: media-boost-pulse 1.1s ease-in-out infinite;
	}
	@keyframes media-boost-pulse {
		0%,
		100% {
			transform: scale(1);
		}
		50% {
			transform: scale(1.06);
		}
	}

	/* Volume group: slider is collapsed to 0 width and unfolds on hover or
	 focus-within. Touch devices keep the plain mute toggle (below). */
	.media-reel-volume {
		display: flex;
		align-items: center;
		gap: 0.15rem;
	}
	.media-reel-volume-range {
		width: 0;
		opacity: 0;
		margin: 0;
		height: 3px;
		appearance: none;
		-webkit-appearance: none;
		border-radius: 9999px;
		background: transparent;
		cursor: pointer;
		outline: none;
		transition:
			width 0.22s ease,
			opacity 0.22s ease;
	}
	.media-reel-volume:hover .media-reel-volume-range,
	.media-reel-volume:focus-within .media-reel-volume-range {
		width: 4.25rem;
		opacity: 1;
		background-image: linear-gradient(
			to right,
			rgb(255 255 255 / 0.9) calc(var(--media-volume, 100) * 1%),
			rgb(255 255 255 / 0.3) calc(var(--media-volume, 100) * 1%)
		);
	}
	.media-reel-volume-range::-webkit-slider-thumb {
		appearance: none;
		-webkit-appearance: none;
		width: 11px;
		height: 11px;
		border-radius: 9999px;
		background: #fff;
		box-shadow: 0 1px 5px rgb(0 0 0 / 0.45);
	}
	.media-reel-volume-range::-moz-range-thumb {
		width: 11px;
		height: 11px;
		border: 0;
		border-radius: 9999px;
		background: #fff;
		box-shadow: 0 1px 5px rgb(0 0 0 / 0.45);
	}
	@media (pointer: coarse) {
		/* Touch: no hover to unfold — keep the compact mute toggle only. */
		.media-reel-volume-range {
			display: none;
		}
	}

	/* ---- Overlay variant (inline feed cards) ---- */
	.media-player-overlay .media-controls {
		position: absolute;
		z-index: 2;
		right: 0.5rem;
		bottom: 0.5rem;
		left: 0.5rem;
	}
	.media-player-overlay .media-controls-main {
		padding: 0.4rem;
		background: color-mix(in oklab, var(--ui-bg-elevated) 88%, transparent);
		backdrop-filter: blur(12px);
		box-shadow: 0 8px 22px color-mix(in oklab, #000 26%, transparent);
	}
	.media-player-overlay .media-time {
		font-size: 0.66rem;
	}
	.media-player-reel .media-error {
		color: rgba(255, 255, 255, 0.8);
	}
	@media (max-width: 640px) {
		.media-volume,
		.media-rate {
			display: none;
		}
		.media-time {
			font-size: 0.68rem;
		}
		.media-controls-main {
			gap: 0.3rem;
			padding: 0.45rem;
		}
	}
</style>
