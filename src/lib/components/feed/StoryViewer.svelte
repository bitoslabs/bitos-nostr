<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import { stories, type StoryAuthor } from '$lib/nostr/stories.svelte';
	import { dms } from '$lib/nostr/dms.svelte';
	import StoryActivity from './StoryActivity.svelte';
	import NoteZapDialog from './NoteZapDialog.svelte';
	import PowBadge from '$lib/components/ui/PowBadge.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { timeAgo } from '$lib/utils/format';
	import { compactSats } from '$lib/utils/profile-stats';
	import { NOSTR_KINDS } from '$lib/nostr/types';
	import { makeParticles, type Particle } from '$lib/utils/burst';
	import { parseContent } from '$lib/utils/note-content';
	import MentionLink from './MentionLink.svelte';

	let {
		author,
		onclose,
		onnext
	}: { author: StoryAuthor; onclose: () => void; onnext?: () => void } = $props();

	let slideIndex = $state(0);
	let paused = $state(false);
	let deleting = $state(false);
	let confirmDeleteOpen = $state(false);
	let replyText = $state('');
	let replying = $state(false);
	let activityOpen = $state(false);
	let replyMode = $state<'reply' | 'dm'>('reply');
	let slideEl = $state<HTMLDivElement | undefined>(undefined);
	let likeBursts = $state<
		{ id: number; x: number; y: number; particles: Particle[]; combo: number }[]
	>([]);
	let heartPop = $state(false);
	/** Sensitive slides stay blurred until the viewer taps to reveal. */
	let revealed = $state(false);
	let combo = $state(0);
	let burstSeq = 0;
	let lastTap = 0;
	let tapTimer: ReturnType<typeof setTimeout> | undefined;
	let lastBurstAt = 0;
	let comboTimer: ReturnType<typeof setTimeout> | undefined;
	let zapOpen = $state(false);
	/** Instant feedback per slide until the live 9735 receipt lands. */
	let optimisticZapSats = $state<Record<string, number>>({});

	const profile = $derived(profiles.get(author.pubkey));
	const displayName = $derived(profile?.display_name || profile?.name || 'Someone');
	const slides = $derived(author.slides);
	const slide = $derived(slides[slideIndex]);
	const durationMs = $derived(slide?.imageUrl ? 5000 : 7000);
	const isMine = $derived(author.pubkey === identity.current?.pk);
	const interaction = $derived(slide ? stories.getInteraction(slide.id) : undefined);
	const liked = $derived(!!interaction?.likedByMe);
	const lightningAddress = $derived(profile?.lud16 || profile?.lud06 || '');
	const zapSatsTotal = $derived(
		slide ? (interaction?.zapSats ?? 0) + (optimisticZapSats[slide.id] ?? 0) : 0
	);
	const isSensitive = $derived(!!slide?.sensitive && !!slide.imageUrl);
	const hidden = $derived(isSensitive && !revealed);

	// Auto-advance: restart the timer whenever the slide / pause state changes.
	$effect(() => {
		if (paused || confirmDeleteOpen || zapOpen || !slide) return;
		const ms = durationMs;
		const t = setTimeout(() => advance(), ms);
		return () => clearTimeout(t);
	});

	// Mark seen as soon as the viewer opens.
	$effect(() => {
		stories.markSeen(author.pubkey);
	});

	$effect(() => {
		if (slideIndex > 0 && slideIndex >= slides.length) slideIndex = slides.length - 1;
		if (!slides.length) onclose();
	});

	// Load + subscribe to likes/views/replies for this author's stories.
	$effect(() => {
		if (!slides.length) return;
		void stories.loadActivity(slides);
		return stories.watchActivity(slides);
	});

	// Record a (one-time) view whenever the visible slide changes.
	$effect(() => {
		if (!slide) return;
		void stories.recordView(slide);
	});

	function advance() {
		if (slideIndex < slides.length - 1) {
			revealed = false;
			slideIndex += 1;
		} else if (onnext) {
			onnext();
		} else {
			onclose();
		}
	}

	function back() {
		if (slideIndex > 0) slideIndex -= 1;
	}

	function onViewportClick(e: MouseEvent) {
		if (!slideEl) return;
		const rect = slideEl.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;
		const now = Date.now();
		// Double-tap anywhere on the story → like + heart burst (Facebook/IG style).
		if (now - lastTap < 300) {
			if (tapTimer) clearTimeout(tapTimer);
			lastTap = 0;
			void likeWithBurst(x, y);
			return;
		}
		lastTap = now;
		// Delay the advance slightly so a second tap can convert it into a like.
		tapTimer = setTimeout(() => {
			if (x < rect.width / 2) back();
			else advance();
		}, 260);
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
		else if (e.key === 'ArrowRight') advance();
		else if (e.key === 'ArrowLeft') back();
		else if (e.key === ' ') {
			e.preventDefault();
			paused = !paused;
		}
	}

	function askDeleteCurrentSlide() {
		if (!slide || deleting || !isMine) return;
		paused = true;
		confirmDeleteOpen = true;
	}

	async function deleteCurrentSlide() {
		if (!slide || deleting || !isMine) return;
		deleting = true;
		try {
			await stories.deleteSlide(slide);
			toasts.success('Story deleted');
			confirmDeleteOpen = false;
			onclose();
		} catch (e) {
			toasts.error((e as Error).message || 'Could not delete story');
		} finally {
			deleting = false;
		}
	}

	async function toggleLike(e?: MouseEvent) {
		if (!slide) return;
		if (!identity.current) {
			toasts.error('Create or import a key first');
			return;
		}
		// Capture the click target synchronously — e.currentTarget is nulled after the first await.
		const targetEl = (e?.currentTarget as HTMLElement | null) ?? null;
		try {
			if (liked) {
				await stories.unlike(slide);
			} else {
				fireButtonBurst(targetEl);
				await stories.like(slide);
				heartPop = true;
				setTimeout(() => (heartPop = false), 500);
			}
		} catch (err) {
			toasts.error((err as Error).message || 'Could not react');
		}
	}

	function fireButtonBurst(targetEl: HTMLElement | null) {
		if (!targetEl || !slideEl) return;
		const a = slideEl.getBoundingClientRect();
		const t = targetEl.getBoundingClientRect();
		triggerLikeBurst(t.left + t.width / 2 - a.left, t.top + t.height / 2 - a.top);
	}

	function triggerLikeBurst(x: number, y: number) {
		const now = Date.now();
		// Combo: rapid bursts ramp up the particle count + show a multiplier.
		combo = now - lastBurstAt < 1100 ? Math.min(combo + 1, 9) : 1;
		lastBurstAt = now;
		if (comboTimer) clearTimeout(comboTimer);
		comboTimer = setTimeout(() => (combo = 0), 1400);

		const count = Math.min(10 + combo * 2, 24);
		const id = ++burstSeq;
		likeBursts = [...likeBursts, { id, x, y, particles: makeParticles(count), combo }];
		setTimeout(() => {
			likeBursts = likeBursts.filter((b) => b.id !== id);
		}, 1150);
	}

	async function likeWithBurst(x: number, y: number) {
		// Always show the burst as feedback; only publish a like when not already liked.
		triggerLikeBurst(x, y);
		if (!slide || liked || !identity.current) return;
		try {
			await stories.like(slide);
		} catch (e) {
			toasts.error((e as Error).message || 'Could not react');
		}
	}

	function zapStory() {
		if (!slide) return;
		if (!lightningAddress) {
			toasts.info('This author has no Lightning address');
			return;
		}
		paused = true;
		zapOpen = true;
	}

	/** Count a just-paid zap immediately; the live receipt replaces it. */
	function handleZapPaid(sats: number) {
		if (!slide) return;
		optimisticZapSats = {
			...optimisticZapSats,
			[slide.id]: (optimisticZapSats[slide.id] ?? 0) + sats
		};
	}

	async function submitReply() {
		if (!slide || !replyText.trim() || replying) return;
		if (!identity.current) {
			toasts.error('Create or import a key first');
			return;
		}
		replying = true;
		try {
			await stories.reply(slide, replyText);
			replyText = '';
			toasts.success('Reply posted');
		} catch (e) {
			toasts.error((e as Error).message || 'Could not post reply');
		} finally {
			replying = false;
		}
	}

	function privateMessageDraft(text: string) {
		const typedMessage = text.trim() ? text : '';
		if (!slide) return '';
		const parts = ['Replying to your story:'];
		if (slide.content.trim()) parts.push(slide.content);
		if (slide.imageUrl) parts.push(slide.imageUrl);
		if (typedMessage) parts.push('', typedMessage);
		return parts.join('\n');
	}

	async function sendPrivateMessage(text: string) {
		paused = true;
		await dms.send(author.pubkey, privateMessageDraft(text));
		replyText = '';
		toasts.success('Private message sent');
	}

	function setReplyMode(mode: 'reply' | 'dm') {
		replyMode = mode;
		paused = true;
	}

	async function submitReplyAction() {
		if (replyMode === 'dm') {
			if (!identity.current) {
				toasts.error('Create or import a key first');
				return;
			}
			if (replying) return;
			replying = true;
			try {
				await sendPrivateMessage(replyText);
			} catch (e) {
				toasts.error((e as Error).message || 'Could not send private message');
			} finally {
				replying = false;
			}
			return;
		}
		await submitReply();
	}
</script>

<svelte:window onkeydown={onKey} />

<div class="fixed inset-0 z-50 flex items-center justify-center bg-black">
	<div
		bind:this={slideEl}
		class="relative aspect-[9/16] h-full max-h-screen w-auto overflow-hidden bg-black sm:h-[92vh] sm:rounded-xl"
	>
		<!-- Progress bars -->
		<div class="absolute inset-x-0 top-0 z-20 flex gap-1 p-2">
			{#each slides as _, i (i)}
				<div class="h-[3px] flex-1 overflow-hidden rounded-full bg-white/30">
					{#if i < slideIndex}
						<div class="h-full w-full bg-white"></div>
					{:else if i === slideIndex}
						<div
							class="h-full bg-white"
							style="animation: story-progress {durationMs}ms linear forwards; animation-play-state: {paused
								? 'paused'
								: 'running'}"
						></div>
					{/if}
				</div>
			{/each}
		</div>

		<!-- Header -->
		<div class="absolute inset-x-0 top-0 z-40 flex items-center gap-2 p-3 pt-6">
			<a
				href={`/profile/${author.pubkey}`}
				onclick={onclose}
				class="flex min-w-0 flex-1 items-center gap-2 rounded-full pr-2 transition hover:bg-white/10"
				aria-label={`View ${displayName}'s profile`}
			>
				<Avatar
					pubkey={author.pubkey}
					name={displayName}
					picture={profile?.picture}
					size={32}
					class="ring-2 ring-black/30"
				/>
				<div class="min-w-0 flex-1">
					<p class="truncate text-[13px] font-bold text-white">{displayName}</p>
					<p class="flex items-center gap-1.5 text-[11px] text-white/70">
						{slide ? timeAgo(slide.createdAt) : ''}
						{#if slide?.pow}
							<PowBadge micro bits={slide.pow} id={slide.id} class="opacity-90" />
						{/if}
					</p>
				</div>
			</a>
			<button
				type="button"
				onclick={() => (paused = !paused)}
				class="grid size-8 place-items-center rounded-full text-white/80 transition hover:bg-white/10"
				aria-label={paused ? 'Play' : 'Pause'}
			>
				<Icon name={paused ? 'i-lucide-play' : 'i-lucide-pause'} class="size-4" />
			</button>
			{#if isMine}
				<button
					type="button"
					onclick={askDeleteCurrentSlide}
					disabled={deleting}
					class="grid size-8 place-items-center rounded-full text-white/80 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
					aria-label="Delete story"
				>
					<Icon
						name={deleting ? 'i-lucide-loader-circle' : 'i-lucide-trash-2'}
						class="size-4 {deleting ? 'animate-spin' : ''}"
					/>
				</button>
			{/if}
			<button
				type="button"
				onclick={onclose}
				class="grid size-8 place-items-center rounded-full text-white/80 transition hover:bg-white/10"
				aria-label="Close"
			>
				<Icon name="i-lucide-x" class="size-5" />
			</button>
		</div>

		<!-- Slide -->
		{#if slide}
			{#if slide.imageUrl}
				<img
					src={slide.imageUrl}
					alt={slide.alt ?? ''}
					class="size-full object-cover transition-all duration-200 {hidden
						? 'scale-110 blur-2xl brightness-50'
						: ''}"
				/>
				{#if hidden}
					<button
						type="button"
						onclick={() => (revealed = true)}
						class="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/30"
						aria-label="Sensitive content — tap to reveal"
					>
						<span
							class="grid size-14 place-items-center rounded-full bg-black/60 ring-1 ring-white/20"
						>
							<Icon name="i-lucide-eye-off" class="size-6 text-white" />
						</span>
						<span class="px-6 text-center text-[13px] font-bold text-white">
							Sensitive content · tap to view
						</span>
					</button>
				{/if}
				{#if slide.content.trim()}
					<div
						class="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-4 pb-6"
					>
						<p
							class="text-[15px] leading-snug font-semibold break-words whitespace-pre-wrap text-white"
						>
							{#each parseContent(slide.content) as token, i (`${i}:${token.type}:${token.value}`)}
								{#if token.type === 'text'}
									{token.value}
								{:else if token.type === 'hashtag'}
									<a
										href={`/?tag=${encodeURIComponent(token.tag)}`}
										onclick={onclose}
										class="font-bold text-white underline decoration-white/50 hover:decoration-white"
										>{token.value}</a
									>
								{:else if token.type === 'nostr'}
									<MentionLink
										value={token.value}
										class="font-bold text-white underline decoration-white/50 hover:decoration-white"
									/>
								{:else}
									<a
										href={token.value}
										target="_blank"
										rel="noreferrer"
										class="font-semibold text-white underline decoration-white/50 hover:decoration-white"
										>{token.host}</a
									>
								{/if}
							{/each}
						</p>
					</div>
				{/if}
			{:else}
				<div
					class="flex size-full items-center justify-center p-6"
					style={slide.bg
						? `background:${slide.bg}`
						: 'background:linear-gradient(135deg, var(--color-primary-600), var(--color-accent-500))'}
				>
					<p
						class="max-h-full overflow-auto text-center text-[24px] leading-snug font-extrabold break-words whitespace-pre-wrap text-white"
					>
						{slide.content || ' '}
					</p>
				</div>
			{/if}

			<!-- Double-tap “like” burst overlay -->
			<div class="pointer-events-none absolute inset-0 z-[45] overflow-hidden">
				{#each likeBursts as b (b.id)}
					<div
						class="absolute grid size-24 place-items-center"
						style="left:calc({b.x}px - 48px); top:calc({b.y}px - 48px)"
					>
						<span
							class="like-burst-ring absolute inset-0 rounded-full bg-white/25 ring-2 ring-white/70"
						></span>
						<Icon
							name="i-solar-heart-bold"
							class="like-burst-heart relative size-24 text-[var(--tone-error-text)] drop-shadow-[0_4px_16px_rgba(0,0,0,0.5)]"
						/>
					</div>
					{#each b.particles as p (p.id)}
						<span
							class="like-particle"
							style="left:{b.x}px; top:{b.y}px; --tx:{p.tx}px; --ty:{p.ty}px; --rot:{p.rot}deg; font-size:{p.size}px; animation-duration:{p.duration}s; animation-delay:{p.delay}s"
							>{p.emoji}</span
						>
					{/each}
					{#if b.combo >= 2}
						<div
							class="absolute -translate-x-1/2 -translate-y-1/2"
							style="left:{b.x}px; top:calc({b.y}px - 74px)"
						>
							<span
								class="like-combo-badge inline-block rounded-full bg-white/95 px-2.5 py-0.5 text-[13px] font-extrabold text-[var(--tone-error-text)] shadow-lg"
								>×{b.combo}</span
							>
						</div>
					{/if}
				{/each}
			</div>

			<!-- Story interactions: reply input + like + activity sheet -->
			<div
				class="absolute inset-x-0 bottom-0 z-40 bg-gradient-to-t from-black/75 via-black/35 to-transparent p-3 pb-4"
			>
				<div class="mb-2 flex items-center justify-between gap-2">
					<div
						class="inline-flex rounded-full bg-white/10 p-1 text-[11px] font-semibold text-white/85 ring-1 ring-white/10"
					>
						<button
							type="button"
							onclick={() => setReplyMode('reply')}
							class="rounded-full px-3 py-1 transition {replyMode === 'reply'
								? 'bg-white text-black'
								: 'hover:bg-white/10'}"
						>
							Reply
						</button>
						<button
							type="button"
							onclick={() => setReplyMode('dm')}
							class="rounded-full px-3 py-1 transition {replyMode === 'dm'
								? 'bg-white text-black'
								: 'hover:bg-white/10'}"
						>
							DM
						</button>
					</div>
					<p class="text-[11px] font-semibold text-white/75">
						{replyMode === 'reply' ? 'Visible in story activity' : 'Only sent privately'}
					</p>
				</div>
				<div class="flex items-center gap-2">
					<input
						bind:value={replyText}
						type="text"
						placeholder={identity.current
							? replyMode === 'reply'
								? `Reply to ${displayName}…`
								: `Message ${displayName} privately…`
							: 'Sign in to reply'}
						disabled={!identity.current || replying}
						onfocus={() => (paused = true)}
						onblur={() => (paused = false)}
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								void submitReplyAction();
							}
							if (e.key === 'Escape') {
								replyText = '';
								(e.currentTarget as HTMLInputElement).blur();
							}
						}}
						class="h-10 flex-1 rounded-full border border-white/15 bg-white/10 px-4 text-[13px] text-white transition outline-none placeholder:text-white/60 focus:border-white/40 focus:bg-white/20 disabled:opacity-60"
					/>
					<button
						type="button"
						onclick={submitReplyAction}
						class="grid size-10 shrink-0 place-items-center rounded-full text-white transition hover:bg-white/15"
						aria-label={replyMode === 'reply'
							? `Reply to ${displayName}`
							: `Message ${displayName} privately`}
					>
						<Icon
							name={replyMode === 'reply' ? 'i-lucide-message-circle-reply' : 'i-lucide-send'}
							class="size-5"
						/>
					</button>
					<button
						type="button"
						onclick={toggleLike}
						class="grid size-10 shrink-0 place-items-center rounded-full text-white transition hover:bg-white/15"
						aria-label={liked ? 'Unlike story' : 'Like story'}
					>
						<Icon
							name={liked ? 'i-solar-heart-bold' : 'i-solar-heart-linear'}
							class="size-5 transition {liked ? 'text-primary-500' : 'text-white'} {heartPop
								? 'like-pop'
								: ''}"
						/>
					</button>
					<button
						type="button"
						onclick={zapStory}
						class="grid size-10 shrink-0 place-items-center rounded-full text-warm-400 transition hover:bg-white/15"
						aria-label="Zap sats to this story"
					>
						<Icon name="i-lucide-zap" class="size-5 fill-current" />
					</button>
					<button
						type="button"
						onclick={() => (activityOpen = true)}
						class="grid size-10 shrink-0 place-items-center rounded-full text-white transition hover:bg-white/15"
						aria-label="View activity"
					>
						<Icon name="i-lucide-chevron-up" class="size-5" />
					</button>
				</div>
				<div
					class="mt-2 flex items-center justify-center gap-4 text-[11px] font-semibold text-white/85"
				>
					<button
						type="button"
						onclick={() => (activityOpen = true)}
						class="inline-flex items-center gap-1 rounded-full px-2 py-1 transition hover:bg-white/15"
					>
						<Icon name="i-lucide-heart" class="size-3.5" />
						{interaction?.likeCount ?? 0}
					</button>
					{#if zapSatsTotal || interaction?.zapCount}
						<button
							type="button"
							onclick={zapStory}
							class="text-warm-300 inline-flex items-center gap-1 rounded-full px-2 py-1 transition hover:bg-white/15"
							aria-label="Zap this story"
						>
							<Icon name="i-lucide-zap" class="size-3.5 fill-current" />
							{zapSatsTotal ? `${compactSats(zapSatsTotal)} sats` : (interaction?.zapCount ?? 0)}
						</button>
					{/if}
					{#if isMine}
						<button
							type="button"
							onclick={() => (activityOpen = true)}
							class="inline-flex items-center gap-1 rounded-full px-2 py-1 transition hover:bg-white/15"
						>
							<Icon name="i-lucide-eye" class="size-3.5" />
							{interaction?.viewCount ?? 0}
						</button>
					{/if}
					<button
						type="button"
						onclick={() => (activityOpen = true)}
						class="inline-flex items-center gap-1 rounded-full px-2 py-1 transition hover:bg-white/15"
					>
						<Icon name="i-lucide-message-circle" class="size-3.5" />
						{interaction?.replyCount ?? 0}
					</button>
				</div>
			</div>

			<!-- Tap zones -->
			<button
				type="button"
				class="absolute inset-y-0 left-0 z-30 w-1/3 focus:outline-none"
				onclick={onViewportClick}
				aria-label="Previous"
				tabindex="-1"
			></button>
			<button
				type="button"
				class="absolute inset-y-0 right-0 z-30 w-2/3 focus:outline-none"
				onclick={onViewportClick}
				aria-label="Next"
				tabindex="-1"
			></button>
		{/if}

		{#if slides.length > 1}
			<div
				class="absolute bottom-2 left-1/2 z-20 -translate-x-1/2 rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-semibold text-white/80"
			>
				{slideIndex + 1} / {slides.length}
			</div>
		{/if}
	</div>
</div>

<Dialog bind:open={confirmDeleteOpen} title="Delete story">
	<div class="space-y-2">
		<p class="text-[14px] font-semibold text-[var(--ui-text)]">
			Delete this story from your profile?
		</p>
		<p class="text-[13px] leading-relaxed text-[var(--ui-text-muted)]">
			BitOS will publish a delete event to your relays and remove this story from your device.
		</p>
	</div>

	{#snippet footer()}
		<button
			type="button"
			onclick={() => (confirmDeleteOpen = false)}
			disabled={deleting}
			class="inline-flex h-9 items-center justify-center rounded-full border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-4 text-[13px] font-bold text-[var(--ui-text)] transition hover:border-primary-500 hover:text-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
		>
			Cancel
		</button>
		<button
			type="button"
			onclick={deleteCurrentSlide}
			disabled={deleting}
			class="inline-flex h-9 items-center gap-2 rounded-full bg-[var(--tone-error-text)] px-4 text-[13px] font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
		>
			<Icon
				name={deleting ? 'i-lucide-loader-circle' : 'i-lucide-trash-2'}
				class="size-4 {deleting ? 'animate-spin' : ''}"
			/>
			{deleting ? 'Deleting' : 'Delete'}
		</button>
	{/snippet}
</Dialog>

<StoryActivity bind:open={activityOpen} {slide} {author} />

{#if slide}
	<NoteZapDialog
		bind:open={zapOpen}
		recipientPubkey={author.pubkey}
		{lightningAddress}
		eventId={slide.id}
		eventKind={NOSTR_KINDS.STORY_STATUS}
		onPaid={handleZapPaid}
		onClose={() => (paused = false)}
	/>
{/if}

<style>
	@keyframes story-progress {
		from {
			width: 0%;
		}
		to {
			width: 100%;
		}
	}
</style>
