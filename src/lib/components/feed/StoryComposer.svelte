<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import PowCard from '$lib/components/ui/PowCard.svelte';
	import GifPicker from './GifPicker.svelte';
	import { stories, MAX_STORY_IMAGES } from '$lib/nostr/stories.svelte';
	import type { PowProgress } from '$lib/nostr/feed.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { media, providerLabel } from '$lib/stores/media.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { powPrefs } from '$lib/stores/pow-prefs.svelte';
	import { readDraft, createDraftWriter } from '$lib/stores/drafts';
	import { untrack } from 'svelte';

	let { open = $bindable(false), onposted = () => {} }: { open?: boolean; onposted?: () => void } =
		$props();

	let text = $state('');
	/** Attached images (uploads + picked GIFs) — becomes a carousel in the viewer. */
	let images = $state<string[]>([]);
	/** Which image the compact preview is showing. */
	let previewIndex = $state(0);
	let altText = $state('');
	let sensitive = $state(false);
	let bgIndex = $state(0);
	let uploading = $state(false);
	let posting = $state(false);
	let imageInput = $state<HTMLInputElement | null>(null);
	let cameraInput = $state<HTMLInputElement | null>(null);
	// Inline GIF sheet (Giphy) — remote URL, no upload needed.
	let gifOpen = $state(false);
	// Tracks the title we auto-inserted so re-picking a different GIF replaces it.
	let lastGifTitle = '';

	// NIP-13 Proof-of-Work — same worker + prefs as the note composer, so a
	// user's chosen difficulty follows them across every posting surface.
	let showPow = $state(untrack(() => powPrefs.state.showPanelByDefault));
	let pow = $state(untrack(() => powPrefs.state.lastDifficulty));
	let mining = $state(false);
	let powProgress = $state<PowProgress | null>(null);
	let mineController: AbortController | undefined;
	let powPanelEl = $state<HTMLDivElement | null>(null);

	// Draft persistence — debounced writes while typing. Empty text never
	// overwrites a saved draft (closing keeps it); posting clears it.
	const draftWriter = createDraftWriter('story');
	$effect(() => {
		if (!text.trim()) return;
		draftWriter.write({ text, bgIndex: images.length ? undefined : bgIndex });
	});
	$effect(() => {
		if (!open) return;
		const draft = untrack(() => readDraft('story'));
		if (draft?.text.trim() && !text.trim()) {
			text = draft.text;
			if (typeof draft.bgIndex === 'number' && !images.length) bgIndex = draft.bgIndex;
			toasts.info('Draft restored');
		}
	});

	// IG-style gradient backgrounds for text-only stories / notes.
	const backgrounds = [
		'linear-gradient(135deg, #2f95f6, #55d69a)',
		'linear-gradient(135deg, #ff755f, #ffb86b)',
		'linear-gradient(135deg, #8b5cf6, #ec4899)',
		'linear-gradient(135deg, #0f172a, #334155)',
		'linear-gradient(135deg, #f59e0b, #ef4444)',
		'linear-gradient(135deg, #10b981, #06b6d4)'
	];

	const MAX_STORY_CHARS = 280;

	const me = $derived(identity.current);
	const myProfile = $derived(me ? profiles.get(me.pk) : undefined);
	const myName = $derived(myProfile?.display_name || myProfile?.name || 'You');
	const canPost = $derived((text.trim() || images.length) && !posting);
	const overLimit = $derived(text.length >= MAX_STORY_CHARS);
	const full = $derived(images.length >= MAX_STORY_IMAGES);
	const previewImage = $derived(images[previewIndex]);
	const isGif = $derived(!!previewImage && /\.gif(?:[?#]|$)/i.test(previewImage));

	function reset() {
		text = '';
		images = [];
		previewIndex = 0;
		altText = '';
		sensitive = false;
		bgIndex = 0;
		uploading = false;
		posting = false;
		gifOpen = false;
	}
	function close() {
		open = false;
		reset();
	}

	async function onImageChosen(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const files = [...(input.files ?? [])];
		input.value = '';
		if (!files.length) return;
		const provider =
			media.state.defaultProvider !== 'none'
				? media.state.defaultProvider
				: media.configured[0]?.id;
		uploading = true;
		try {
			for (const file of files) {
				if (images.length >= MAX_STORY_IMAGES) {
					toasts.info(`Up to ${MAX_STORY_IMAGES} images per story`);
					break;
				}
				const result = await media.upload(file, provider, {
					pubkey: me?.pk,
					purpose: 'story'
				});
				images = [...images, result.url];
				previewIndex = images.length - 1;
			}
			gifOpen = false;
			toasts.success(`Uploaded via ${providerLabel(provider ?? 'server')}`);
		} catch (err) {
			toasts.error((err as Error).message);
		} finally {
			uploading = false;
		}
	}

	/** Attach GIFs picked via the multi-select sheet — remote URLs, no upload. */
	function pickGifs(gifs: { url: string; title?: string }[]) {
		const room = MAX_STORY_IMAGES - images.length;
		if (room <= 0) {
			toasts.info(`Up to ${MAX_STORY_IMAGES} images per story`);
			return;
		}
		let chosen = gifs;
		if (chosen.length > room) {
			chosen = chosen.slice(0, room);
			toasts.info(`Added ${room} — up to ${MAX_STORY_IMAGES} images per story`);
		}
		// If the alt text is still the auto-prefilled title of a previous pick,
		// swap it for the new one; anything the user typed is left untouched.
		if (altText.trim() && altText === lastGifTitle) altText = '';
		const seedTitle = chosen.find((gif) => gif.title)?.title;
		if (!altText.trim() && seedTitle) {
			altText = seedTitle.slice(0, 280);
			lastGifTitle = altText;
		} else {
			lastGifTitle = '';
		}
		images = [...images, ...chosen.map((gif) => gif.url)];
		previewIndex = images.length - 1;
		gifOpen = false;
	}

	function removeImage(index: number) {
		images = images.filter((_, i) => i !== index);
		previewIndex = Math.min(previewIndex, Math.max(0, images.length - 1));
	}

	function cancelMining() {
		mineController?.abort();
	}

	async function post() {
		if (!canPost) return;
		posting = true;
		mining = showPow && pow > 0;
		const minedBits = pow;
		const controller = new AbortController();
		mineController = controller;
		powProgress = null;
		try {
			// Let the browser paint the mining state before starting the worker.
			if (mining) await new Promise((resolve) => setTimeout(resolve, 50));
			const eventId = await stories.publish(
				text,
				images,
				images.length ? undefined : backgrounds[bgIndex],
				{
					pow: showPow ? pow : 0,
					onPowProgress: (progress) => (powProgress = progress),
					signal: controller.signal,
					alt: images.length ? altText : undefined,
					sensitive: images.length ? sensitive : false
				}
			);
			// Persist the difficulty actually used so the next composer starts there.
			powPrefs.remember(showPow ? pow : 0);
			powPrefs.rememberPanelVisibility(showPow);
			draftWriter.clear();
			toasts.success(
				mining
					? `Story mined ${minedBits} bits · ID ${eventId.slice(0, 7)}…`
					: 'Story posted · lasts 24h'
			);
			onposted();
			close();
		} catch (e) {
			const message = (e as Error).message;
			if (/cancelled/i.test(message)) toasts.info('Mining cancelled — nothing was posted');
			else toasts.error(message);
		} finally {
			mineController = undefined;
			powProgress = null;
			mining = false;
			posting = false;
		}
	}

	// Small screens: the PoW panel can sit below the fold. When mining starts,
	// bring it into view so the live telemetry stays visible (the Post button
	// is pinned in the dialog footer and always reachable).
	$effect(() => {
		if (mining && powPanelEl) {
			powPanelEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
		}
	});

	const onKey = (e: KeyboardEvent) => {
		if (!open) return;
		// Escape first stops an in-flight mining run, then the GIF sheet (composer stays open).
		if (e.key === 'Escape') {
			if (mining) {
				e.preventDefault();
				cancelMining();
				return;
			}
			if (gifOpen) {
				e.preventDefault();
				gifOpen = false;
				return;
			}
			close();
		}
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !gifOpen) {
			e.preventDefault();
			void post();
		}
	};
</script>

<svelte:window onkeydown={onKey} />

{#if open}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
		<button
			type="button"
			aria-label="Close"
			tabindex="-1"
			class="animate-fade absolute inset-0 bg-black/60 backdrop-blur-[3px]"
			onclick={close}
		></button>
		<div
			class="surface-card relative z-10 flex max-h-[calc(100dvh-1.5rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl shadow-2xl shadow-black/30 sm:max-h-[calc(100dvh-2rem)]"
			role="dialog"
			aria-modal="true"
		>
			<header
				class="flex h-12 shrink-0 items-center justify-between border-b border-[var(--ui-border)] px-4 sm:h-14"
			>
				<h2 class="text-[15px] font-bold tracking-tight sm:text-[16px]">New story / note</h2>
				<button
					type="button"
					onclick={close}
					class="grid size-8 place-items-center rounded-lg text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)]"
					aria-label="Close"
				>
					<Icon name="i-lucide-x" class="size-4" />
				</button>
			</header>

			<!-- Scrollable body: preview + controls scroll; the Post button stays pinned. -->
			<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
				<!-- Preview (compact on short screens) -->
				<div class="flex justify-center bg-[var(--ui-bg-muted)] p-3 sm:p-4">
					<div
						class="relative grid aspect-[9/16] h-[170px] w-auto overflow-hidden rounded-xl shadow-inner ring-1 ring-black/10 sm:h-[290px] sm:max-h-[46vh]"
						style={`background:${images.length ? '#000' : backgrounds[bgIndex]}`}
					>
						{#if images.length}
							<!-- Tap cycles the preview across the attached images. -->
							<button
								type="button"
								class="absolute inset-0 cursor-pointer"
								onclick={() => (previewIndex = (previewIndex + 1) % images.length)}
								aria-label={`Show next image (${previewIndex + 1} of ${images.length})`}
								tabindex="-1"
							>
								<img src={previewImage} alt="story preview" class="size-full object-cover" />
							</button>
							{#if isGif}
								<span
									class="pointer-events-none absolute top-2 left-2 rounded-md bg-black/50 px-1.5 py-0.5 text-[10px] font-bold tracking-widest text-white backdrop-blur-sm"
									>GIF</span
								>
							{/if}
							{#if images.length > 1}
								<div
									class="pointer-events-none absolute top-2 right-2 flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm"
								>
									<Icon name="i-lucide-copy" class="size-3" />
									{previewIndex + 1}/{images.length}
								</div>
								<!-- Carousel dots -->
								<div
									class="absolute inset-x-0 bottom-0 z-10 flex justify-center gap-1 pb-1.5 opacity-90"
								>
									{#each [...images.keys()] as i (i)}
										<button
											type="button"
											onclick={() => (previewIndex = i)}
											aria-label={`Show image ${i + 1}`}
											class="h-1.5 rounded-full transition-all {i === previewIndex
												? 'w-4 bg-white'
												: 'w-1.5 bg-white/50 hover:bg-white/75'}"
										></button>
									{/each}
								</div>
							{/if}
							{#if text.trim()}
								<div
									class="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3"
								>
									<p class="text-[15px] font-semibold break-words whitespace-pre-wrap text-white">
										{text}
									</p>
								</div>
							{/if}
						{:else}
							<div class="flex size-full items-center justify-center p-3 sm:p-5">
								<p
									class="max-h-full overflow-auto text-center text-[17px] leading-snug font-extrabold break-words whitespace-pre-wrap text-white sm:text-[20px]"
								>
									{text || 'Type a note…'}
								</p>
							</div>
						{/if}
					</div>
				</div>

				<div class="flex flex-col gap-3 p-3 sm:gap-4 sm:p-4">
					<!-- Text + live character counter -->
					<div class="relative">
						<textarea
							bind:value={text}
							rows="2"
							maxlength={MAX_STORY_CHARS}
							placeholder={images.length ? 'Add a caption…' : "What's on your mind?"}
							disabled={mining}
							class="w-full resize-none rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3.5 py-3 pb-6 text-[14px] leading-relaxed transition outline-none placeholder:text-[var(--ui-text-dimmed)] focus:border-primary-500 focus:bg-[var(--surface-bg)] focus:ring-2 focus:ring-primary-500/20 disabled:opacity-60"
						></textarea>
						<span
							class="pointer-events-none absolute right-2.5 bottom-1.5 font-mono text-[10px] {overLimit
								? 'text-warm-500'
								: 'text-[var(--ui-text-dimmed)]'}"
						>
							{text.length}/{MAX_STORY_CHARS}
						</span>
					</div>

					<!-- Background swatches (only for text stories) -->
					{#if !images.length}
						<div class="flex justify-center">
							<div
								class="flex [scrollbar-width:none] items-center gap-2 overflow-x-auto rounded-full bg-[var(--ui-bg-muted)] p-1.5 [&::-webkit-scrollbar]:hidden"
							>
								{#each backgrounds as bg, i (bg)}
									<button
										type="button"
										onclick={() => (bgIndex = i)}
										disabled={mining}
										class="size-7 shrink-0 rounded-full border border-white/30 ring-offset-2 ring-offset-[var(--surface-bg)] transition hover:scale-105 disabled:pointer-events-none disabled:opacity-40 {bgIndex ===
										i
											? 'ring-2 ring-primary-500'
											: ''}"
										style={`background:${bg}`}
										aria-label={`Use background ${i + 1}`}
									></button>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Image attachment + camera + Proof of Work -->
					<div class="flex items-center gap-1.5">
						<input
							bind:this={imageInput}
							type="file"
							accept="image/*"
							multiple
							class="hidden"
							onchange={onImageChosen}
						/>
						<input
							bind:this={cameraInput}
							type="file"
							accept="image/*"
							capture="environment"
							class="hidden"
							onchange={onImageChosen}
						/>
						<Button
							color="neutral"
							variant="subtle"
							icon={uploading ? 'i-lucide-loader-circle' : 'i-lucide-image-plus'}
							onclick={() => imageInput?.click()}
							disabled={uploading || posting || full}
							size="sm"
						>
							{uploading ? 'Uploading…' : images.length ? 'Add' : 'Image'}
						</Button>
						<button
							type="button"
							onclick={() => cameraInput?.click()}
							disabled={uploading || posting || full}
							aria-label="Take a photo for your story"
							title="Take a photo"
							class="grid size-8 shrink-0 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)] disabled:pointer-events-none disabled:opacity-40"
						>
							<Icon name="i-lucide-camera" class="size-[17px]" />
						</button>
						<button
							type="button"
							onclick={() => (gifOpen = !gifOpen)}
							disabled={uploading || posting || mining || full}
							aria-label="Add a GIF"
							aria-pressed={gifOpen}
							title="Add a GIF"
							class="grid size-8 shrink-0 place-items-center rounded-full transition disabled:pointer-events-none disabled:opacity-40 {gifOpen
								? 'bg-primary-500/10 text-primary-600'
								: 'text-[var(--ui-text-muted)] hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]'}"
						>
							<Icon name="i-lucide-film" class="size-[17px]" />
						</button>
						{#if images.length}
							<Button
								color="error"
								variant="ghost"
								icon="i-lucide-trash-2"
								onclick={() => ((images = []), (previewIndex = 0), (gifOpen = false))}
								size="sm"
								disabled={posting}>Clear</Button
							>
						{/if}
						<div class="min-w-0 flex-1"></div>
						<button
							type="button"
							onclick={() => (showPow = !showPow)}
							disabled={mining}
							aria-label="Proof of Work"
							aria-pressed={showPow}
							title="Proof of Work"
							class="grid size-8 shrink-0 place-items-center rounded-full transition disabled:pointer-events-none disabled:opacity-40 {showPow
								? 'bg-primary-500/10 text-primary-600'
								: 'text-[var(--ui-text-muted)] hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]'}"
						>
							<Icon
								name={mining ? 'i-lucide-pickaxe' : 'i-lucide-shield-check'}
								class="size-[17px] {mining ? 'animate-pulse' : ''}"
							/>
						</button>
					</div>
					{#if images.length}
						<!-- Attached images: tap to preview, × to remove one. -->
						<div
							class="flex [scrollbar-width:thin] gap-2 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden"
						>
							{#each images as url, i (url)}
								<div
									class="group/thumb relative shrink-0 overflow-hidden rounded-lg ring-2 transition {i ===
									previewIndex
										? 'ring-primary-500'
										: 'ring-transparent hover:ring-[var(--ui-border-accented)]'}"
								>
									<button
										type="button"
										onclick={() => (previewIndex = i)}
										aria-label={`Preview image ${i + 1}`}
										class="block"
									>
										<img
											src={url}
											alt=""
											class="size-16 object-cover sm:size-[72px]"
											loading="lazy"
										/>
										{#if /\.gif(?:[?#]|$)/i.test(url)}
											<span
												class="absolute bottom-1 left-1 rounded bg-black/55 px-1 text-[9px] font-bold tracking-wide text-white"
												>GIF</span
											>
										{/if}
									</button>
									<button
										type="button"
										onclick={() => removeImage(i)}
										disabled={posting}
										aria-label={`Remove image ${i + 1}`}
										class="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-[var(--surface-bg)] text-[var(--ui-text-muted)] shadow ring-1 ring-[var(--ui-border-muted)] transition hover:bg-[var(--tone-error-text)] hover:text-white disabled:opacity-40"
									>
										<Icon name="i-lucide-x" class="size-3" />
									</button>
								</div>
							{/each}
							{#if !full}
								<button
									type="button"
									onclick={() => imageInput?.click()}
									disabled={uploading || posting}
									aria-label="Add another image"
									class="grid size-16 shrink-0 place-items-center rounded-lg border-2 border-dashed border-[var(--ui-border-accented)] text-[var(--ui-text-dimmed)] transition hover:border-primary-500 hover:text-primary-500 disabled:opacity-40 sm:size-[72px]"
								>
									<Icon
										name={uploading ? 'i-lucide-loader-circle' : 'i-lucide-plus'}
										class="size-5 {uploading ? 'animate-spin' : ''}"
									/>
								</button>
							{/if}
						</div>
					{/if}
					{#if !images.length && !mining}
						<p class="-mt-2.5 text-[11px] text-[var(--ui-text-dimmed)]">
							No image? Stories double as a 24h status note.
						</p>
					{/if}

					{#if images.length}
						<!-- Accessibility: alt text (NIP-92) + sensitive-media flag -->
						<input
							bind:value={altText}
							type="text"
							maxlength="280"
							placeholder="Describe the images for screen readers (alt text)…"
							disabled={mining}
							class="w-full rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 py-2 text-[12.5px] transition outline-none placeholder:text-[var(--ui-text-dimmed)] focus:border-primary-500 focus:bg-[var(--surface-bg)] focus:ring-2 focus:ring-primary-500/20 disabled:opacity-60"
						/>
						<button
							type="button"
							onclick={() => (sensitive = !sensitive)}
							disabled={mining}
							aria-pressed={sensitive}
							class="-mt-1 flex w-full items-center gap-2 rounded-xl px-1 py-1.5 text-left transition disabled:opacity-60"
						>
							<span
								class="grid size-5 shrink-0 place-items-center rounded-full border transition {sensitive
									? 'border-warm-500 bg-warm-500/15 text-warm-500'
									: 'border-[var(--ui-border-accented)] text-transparent'}"
							>
								<Icon name="i-lucide-check" class="size-3.5" />
							</span>
							<span
								class="text-[12px] font-semibold {sensitive
									? 'text-warm-500'
									: 'text-[var(--ui-text-muted)]'}"
							>
								Mark as sensitive — blur until tapped
							</span>
						</button>
					{/if}

					{#if showPow}
						<div bind:this={powPanelEl}>
							<PowCard bind:pow {mining} progress={powProgress} oncancel={cancelMining} compact />
						</div>
					{/if}
				</div>
			</div>

			<!-- Pinned footer: the Post button never scrolls out of view. -->
			<div
				class="shrink-0 border-t border-[var(--ui-border)] bg-[var(--surface-bg)] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4 sm:pb-4"
			>
				<Button
					color="primary"
					block
					icon={mining ? 'i-lucide-pickaxe' : posting ? 'i-lucide-loader-circle' : 'i-lucide-send'}
					onclick={post}
					disabled={!canPost}
				>
					{mining ? `Mining ${pow} bits…` : posting ? 'Posting…' : 'Post · 24h'}
				</Button>
				<p class="mt-2 text-center text-[11px] text-[var(--ui-text-dimmed)]">
					Posted as @{myName} · disappears in 24 hours
					<span class="hidden sm:inline">· ⌘/Ctrl+Enter to post</span>
				</p>
			</div>
		</div>
	</div>

	{#if gifOpen && !mining}
		<!-- GIF picker dialog — its own modal layered above the composer, so the
		     grid gets far more room than an inline sheet ever could. -->
		<div class="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4">
			<button
				type="button"
				aria-label="Close GIF picker"
				tabindex="-1"
				class="animate-fade absolute inset-0 bg-black/55 backdrop-blur-[3px]"
				onclick={() => (gifOpen = false)}
			></button>
			<div
				class="surface-card animate-rise relative z-10 flex max-h-[calc(88dvh-1rem)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl pb-[max(0px,env(safe-area-inset-bottom))] shadow-2xl shadow-black/40 sm:max-h-[88dvh] sm:rounded-2xl sm:pb-0"
				role="dialog"
				aria-modal="true"
				aria-label="Choose GIFs"
			>
				<header
					class="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-[var(--ui-border)] px-4"
				>
					<h2 class="flex min-w-0 items-center gap-2 text-[15px] font-bold tracking-tight">
						<Icon name="i-lucide-film" class="size-4 shrink-0 text-primary-500" />
						Choose GIFs
						<span
							class="shrink-0 rounded-full bg-[var(--ui-bg-muted)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ui-text-muted)]"
						>
							{images.length}/{MAX_STORY_IMAGES}
						</span>
					</h2>
					<button
						type="button"
						onclick={() => (gifOpen = false)}
						class="grid size-8 shrink-0 place-items-center rounded-lg text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)]"
						aria-label="Close"
					>
						<Icon name="i-lucide-x" class="size-4" />
					</button>
				</header>
				<div class="min-h-0 flex-1 overflow-y-auto">
					<GifPicker
						variant="inline"
						multiple
						max={Math.max(1, MAX_STORY_IMAGES - images.length)}
						onpickmany={pickGifs}
					/>
				</div>
			</div>
		</div>
	{/if}
{/if}
