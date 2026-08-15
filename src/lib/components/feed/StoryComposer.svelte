<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import PowCard from '$lib/components/ui/PowCard.svelte';
	import { stories } from '$lib/nostr/stories.svelte';
	import type { PowProgress } from '$lib/nostr/feed.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { media, providerLabel } from '$lib/stores/media.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { powPrefs } from '$lib/stores/pow-prefs.svelte';
	import { untrack } from 'svelte';

	let { open = $bindable(false), onposted = () => {} }: { open?: boolean; onposted?: () => void } =
		$props();

	let text = $state('');
	let imageUrl = $state<string | undefined>(undefined);
	let bgIndex = $state(0);
	let uploading = $state(false);
	let posting = $state(false);
	let imageInput = $state<HTMLInputElement | null>(null);
	let cameraInput = $state<HTMLInputElement | null>(null);

	// NIP-13 Proof-of-Work — same worker + prefs as the note composer, so a
	// user's chosen difficulty follows them across every posting surface.
	let showPow = $state(untrack(() => powPrefs.state.showPanelByDefault));
	let pow = $state(untrack(() => powPrefs.state.lastDifficulty));
	let mining = $state(false);
	let powProgress = $state<PowProgress | null>(null);
	let mineController: AbortController | undefined;
	let powPanelEl = $state<HTMLDivElement | null>(null);

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
	const canPost = $derived((text.trim() || imageUrl) && !posting);
	const overLimit = $derived(text.length >= MAX_STORY_CHARS);

	function reset() {
		text = '';
		imageUrl = undefined;
		bgIndex = 0;
		uploading = false;
		posting = false;
	}

	function close() {
		open = false;
		reset();
	}

	async function onImageChosen(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		const provider =
			media.state.defaultProvider !== 'none'
				? media.state.defaultProvider
				: media.configured[0]?.id;
		uploading = true;
		try {
			const result = await media.upload(file, provider, {
				pubkey: me?.pk,
				purpose: 'story'
			});
			imageUrl = result.url;
			toasts.success(`Uploaded via ${providerLabel(provider ?? 'server')}`);
		} catch (err) {
			toasts.error((err as Error).message);
		} finally {
			uploading = false;
		}
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
				imageUrl,
				imageUrl ? undefined : backgrounds[bgIndex],
				{
					pow: showPow ? pow : 0,
					onPowProgress: (progress) => (powProgress = progress),
					signal: controller.signal
				}
			);
			// Persist the difficulty actually used so the next composer starts there.
			powPrefs.remember(showPow ? pow : 0);
			powPrefs.rememberPanelVisibility(showPow);
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
		// Escape first stops an in-flight mining run (composer stays open).
		if (e.key === 'Escape') {
			if (mining) {
				e.preventDefault();
				cancelMining();
				return;
			}
			close();
		}
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
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
						style={`background:${imageUrl ? '#000' : backgrounds[bgIndex]}`}
					>
						{#if imageUrl}
							<img src={imageUrl} alt="story preview" class="size-full object-cover" />
							{#if text.trim()}
								<div
									class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3"
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
							placeholder={imageUrl ? 'Add a caption…' : "What's on your mind?"}
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
					{#if !imageUrl}
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
							icon={uploading ? 'i-lucide-loader-circle' : 'i-lucide-image'}
							onclick={() => imageInput?.click()}
							disabled={uploading || posting}
							size="sm"
						>
							{uploading ? 'Uploading…' : imageUrl ? 'Replace' : 'Image'}
						</Button>
						<button
							type="button"
							onclick={() => cameraInput?.click()}
							disabled={uploading || posting}
							aria-label="Take a photo for your story"
							title="Take a photo"
							class="grid size-8 shrink-0 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)] disabled:pointer-events-none disabled:opacity-40"
						>
							<Icon name="i-lucide-camera" class="size-[17px]" />
						</button>
						{#if imageUrl}
							<Button
								color="error"
								variant="ghost"
								icon="i-lucide-trash-2"
								onclick={() => (imageUrl = undefined)}
								size="sm"
								disabled={posting}>Remove</Button
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
					{#if !imageUrl && !mining}
						<p class="-mt-2.5 text-[11px] text-[var(--ui-text-dimmed)]">
							No image? Stories double as a 24h status note.
						</p>
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
{/if}
