<script lang="ts">
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { cn } from '$lib/utils/cn';
	import { stories, type StorySlide, type StoryAuthor } from '$lib/nostr/stories.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { timeAgo, shortKey } from '$lib/utils/format';

	/**
	 * Premium story engagement sheet — a focused, Instagram-style view of who
	 * viewed / liked / replied to a story slide.
	 *
	 * Layout (top → bottom): a blurred story "hero" header, a segmented stat
	 * tab bar (Replies · Likes · Views[author-only]), a scrollable list of
	 * actors with staggered entrance + empty states, and a pinned glass composer
	 * (reply input + quick ❤️ + send). It opens as a bottom sheet on mobile and
	 * a centered modal on desktop.
	 */
	type Tab = 'replies' | 'likes' | 'views';

	let {
		slide,
		author,
		open = $bindable(false)
	}: { slide: StorySlide | null | undefined; author: StoryAuthor; open?: boolean } = $props();

	const isAuthor = $derived(author.pubkey === identity.current?.pk?.toLowerCase());
	const interaction = $derived(slide ? stories.getInteraction(slide.id) : undefined);
	const liked = $derived(!!interaction?.likedByMe);

	const meProfile = $derived(identity.current ? profiles.get(identity.current.pk) : undefined);
	const meName = $derived(meProfile?.display_name || meProfile?.name || 'You');
	const profile = $derived(profiles.get(author.pubkey));
	const authorName = $derived(profile?.display_name || profile?.name || shortKey(author.pubkey));

	const tabs = $derived<Tab[]>(isAuthor ? ['views', 'replies', 'likes'] : ['replies', 'likes']);
	let activeTab = $state<Tab>('replies');
	let replyText = $state('');
	let replying = $state(false);
	let liking = $state(false);
	let burst = $state(false);

	// Backdrop for the hero: the slide's image (blurred), its saved gradient,
	// or the BitOS brand gradient as a final fallback.
	const backdropStyle = $derived(
		slide?.bg
			? `background:${slide.bg}`
			: 'background:linear-gradient(135deg, var(--color-primary-600), var(--color-accent-500))'
	);

	function nameOf(pubkey: string) {
		const p = profiles.get(pubkey);
		return p?.display_name || p?.name || shortKey(pubkey);
	}
	function handleOf(pubkey: string) {
		const p = profiles.get(pubkey);
		return p?.nip05 ? p.nip05 : shortKey(pubkey, 6, 6);
	}
	function tabMeta(tab: Tab) {
		switch (tab) {
			case 'views':
				return { label: 'Views', icon: 'i-lucide-eye', count: interaction?.viewCount ?? 0 };
			case 'likes':
				return { label: 'Likes', icon: 'i-lucide-heart', count: interaction?.likeCount ?? 0 };
			default:
				return {
					label: 'Replies',
					icon: 'i-lucide-message-circle',
					count: interaction?.replyCount ?? 0
				};
		}
	}

	// Open on the most relevant tab per role: authors land on the viewer list,
	// everyone else on replies. Selection is preserved while the sheet stays open.
	$effect(() => {
		if (!open) return;
		activeTab = isAuthor ? 'views' : 'replies';
	});
	// If the slide vanishes (story closed), dismiss the sheet.
	$effect(() => {
		if (open && !slide) open = false;
	});

	function onKey(e: KeyboardEvent) {
		if (open && e.key === 'Escape') open = false;
	}

	async function toggleLike() {
		if (!slide || liking) return;
		if (!identity.current) {
			toasts.error('Create or import a key first');
			return;
		}
		liking = true;
		try {
			if (liked) {
				await stories.unlike(slide);
			} else {
				await stories.like(slide);
				burst = true;
				setTimeout(() => (burst = false), 600);
			}
		} catch (e) {
			toasts.error((e as Error).message || 'Could not react');
		} finally {
			liking = false;
		}
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
			activeTab = 'replies';
			toasts.success('Reply posted');
		} catch (e) {
			toasts.error((e as Error).message || 'Could not post reply');
		} finally {
			replying = false;
		}
	}
</script>

<svelte:window onkeydown={onKey} />

{#if open}
	<div class="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4">
		<!-- Backdrop -->
		<button
			type="button"
			aria-label="Close"
			tabindex="-1"
			class="animate-fade absolute inset-0 bg-black/60 backdrop-blur-md"
			onclick={() => (open = false)}
		></button>

		<!-- Panel -->
		<div
			class="surface-card animate-rise relative z-10 flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-[calc(var(--ui-radius)+0.6rem)] sm:max-h-[88vh] sm:rounded-[calc(var(--ui-radius)+0.4rem)]"
			style="box-shadow:var(--shadow-pop)"
			role="dialog"
			aria-modal="true"
			aria-label="Story activity"
		>
			<!-- Mobile sheet grabber -->
			<div
				class="absolute left-1/2 top-2 z-30 hidden h-1 w-10 -translate-x-1/2 rounded-full bg-[var(--ui-border-accented)] sm:block"
				aria-hidden="true"
			></div>

			<!-- HERO: blurred story context -->
			<div class="relative shrink-0 overflow-hidden">
				<div class="absolute inset-0" style={backdropStyle}></div>
				{#if slide?.imageUrl}
					<img
						src={slide.imageUrl}
						alt=""
						class="absolute inset-0 size-full scale-125 object-cover blur-2xl"
						loading="lazy"
					/>
				{/if}
				<div class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/55 to-black/25"></div>

				<div class="relative px-4 pt-5 pb-3">
					<div class="flex items-center gap-2.5">
						<a
							href={`/profile/${author.pubkey}`}
							onclick={() => (open = false)}
							class="rounded-full bg-gradient-to-tr from-primary-500 via-accent-500 to-warm-500 p-[2px]"
							aria-label={authorName}
						>
							<span class="block rounded-full bg-[var(--surface-bg)] p-[2px]">
								<Avatar
									pubkey={author.pubkey}
									name={authorName}
									picture={profile?.picture}
									size={36}
								/>
							</span>
						</a>
						<div class="min-w-0 flex-1">
							<a
								href={`/profile/${author.pubkey}`}
								onclick={() => (open = false)}
								class="block truncate text-[14px] font-bold text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.4)]"
							>
								{authorName}
							</a>
							<p class="text-[11.5px] font-medium text-white/75">
								{#if slide}{timeAgo(slide.createdAt)} · story{:else}Story{/if}
							</p>
						</div>
						<button
							type="button"
							onclick={() => (open = false)}
							class="grid size-8 shrink-0 place-items-center rounded-full bg-white/15 text-white transition hover:bg-white/25"
							aria-label="Close"
						>
							<Icon name="i-lucide-x" class="size-4.5" />
						</button>
					</div>

					{#if slide?.content?.trim()}
						<p
							class="mt-2.5 line-clamp-2 text-[12.5px] font-medium leading-snug break-words text-white/85 [text-shadow:0_1px_4px_rgba(0,0,0,0.45)]"
						>
							{slide.content}
						</p>
					{/if}
				</div>
			</div>

			<!-- SEGMENTED STAT TABS -->
			<div
				class="flex shrink-0 items-center gap-1 border-b border-[var(--ui-border)] bg-[var(--surface-bg)] p-2"
			>
				{#each tabs as tab (tab)}
					{@const m = tabMeta(tab)}
					<button
						type="button"
						onclick={() => (activeTab = tab)}
						class={cn(
							'group relative flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-[12.5px] font-bold transition',
							activeTab === tab
								? 'bg-[var(--active-surface-bg)] text-[var(--active-surface-text)]'
								: 'text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]'
						)}
						aria-pressed={activeTab === tab}
					>
						<Icon
							name={m.icon}
							class={cn(
								'size-3.5',
								activeTab === tab && tab === 'likes' && 'text-[var(--tone-error-text)]'
							)}
						/>
						<span>{m.label}</span>
						<span
							class={cn(
								'rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums',
								activeTab === tab
									? 'bg-[var(--active-badge-bg)] text-[var(--active-badge-text)]'
									: 'bg-[var(--ui-bg-muted)] text-[var(--ui-text-dimmed)]'
							)}
						>
							{m.count}
						</span>
					</button>
				{/each}
			</div>

			<!-- BODY -->
			<div class="min-h-0 flex-1 overflow-y-auto px-2.5 py-2.5">
				{#key activeTab}
					<div class="animate-fade">
						{#if activeTab === 'replies'}
							{#if (interaction?.replies.length ?? 0) > 0}
								<ul class="space-y-0.5">
									{#each interaction!.replies as reply, i (reply.id)}
										<li
											class="fade-up flex gap-2.5 rounded-xl p-2 transition hover:bg-[var(--ui-bg-muted)]"
											style="animation-delay:{Math.min(i, 8) * 0.035}s"
										>
											<a href={`/profile/${reply.pubkey}`} class="shrink-0">
												<Avatar
													pubkey={reply.pubkey}
													name={nameOf(reply.pubkey)}
													picture={profiles.get(reply.pubkey)?.picture}
													size={34}
												/>
											</a>
											<div class="min-w-0 flex-1">
												<div class="flex items-center gap-1.5">
													<a
														href={`/profile/${reply.pubkey}`}
														class="truncate text-[12.5px] font-bold text-[var(--ui-text)] transition hover:text-primary-500"
														>{nameOf(reply.pubkey)}</a
													>
													<time
														class="ml-auto shrink-0 text-[11px] text-[var(--ui-text-dimmed)]"
														>{timeAgo(reply.createdAt)}</time
													>
												</div>
												<p
													class="mt-1 text-[13px] leading-relaxed break-words whitespace-pre-wrap text-[var(--ui-text)]"
												>
													{reply.content}
												</p>
											</div>
										</li>
									{/each}
								</ul>
							{:else}
								{@render emptyState({
									icon: 'i-lucide-message-circle',
									title: 'No replies yet',
									hint: 'Start the conversation — replies are posted to Nostr.'
								})}
							{/if}
						{:else if activeTab === 'likes'}
							{#if (interaction?.likes.length ?? 0) > 0}
								<ul class="space-y-0.5">
									{#each interaction!.likes as like, i (like.pubkey)}
										<li
											class="fade-up"
											style="animation-delay:{Math.min(i, 8) * 0.035}s"
										>
											<a
												href={`/profile/${like.pubkey}`}
												class="group flex items-center gap-3 rounded-xl p-2 transition hover:bg-[var(--ui-bg-muted)]"
											>
												<Avatar
													pubkey={like.pubkey}
													name={nameOf(like.pubkey)}
													picture={profiles.get(like.pubkey)?.picture}
													size={36}
												/>
												<div class="min-w-0 flex-1">
													<p
														class="truncate text-[13px] font-bold text-[var(--ui-text)] group-hover:text-primary-500"
													>
														{nameOf(like.pubkey)}
													</p>
													<p class="truncate text-[11px] text-[var(--ui-text-dimmed)]">
														{handleOf(like.pubkey)}
													</p>
												</div>
												<span
													class="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--tone-error-bg)] text-[15px]"
												>
													{like.emoji}
												</span>
											</a>
										</li>
									{/each}
								</ul>
							{:else}
								{@render emptyState({
									icon: 'i-lucide-heart',
									title: 'No likes yet',
									hint: 'Likes will show up here the moment someone reacts.'
								})}
							{/if}
						{:else}
							<!-- Views (author only) -->
							{#if (interaction?.views.length ?? 0) > 0}
								<ul class="space-y-0.5">
									{#each interaction!.views as viewer, i (viewer)}
										<li class="fade-up" style="animation-delay:{Math.min(i, 8) * 0.035}s">
											<a
												href={`/profile/${viewer}`}
												class="group flex items-center gap-3 rounded-xl p-2 transition hover:bg-[var(--ui-bg-muted)]"
											>
												<Avatar
													pubkey={viewer}
													name={nameOf(viewer)}
													picture={profiles.get(viewer)?.picture}
													size={36}
												/>
												<div class="min-w-0 flex-1">
													<p
														class="truncate text-[13px] font-bold text-[var(--ui-text)] group-hover:text-primary-500"
													>
														{nameOf(viewer)}
													</p>
													<p class="truncate text-[11px] text-[var(--ui-text-dimmed)]">
														{handleOf(viewer)}
													</p>
												</div>
												<Icon
													name="i-lucide-eye"
													class="size-4 shrink-0 text-[var(--ui-text-dimmed)]"
												/>
											</a>
										</li>
									{/each}
								</ul>
							{:else}
								{@render emptyState({
									icon: 'i-lucide-eye',
									title: 'No views yet',
									hint: 'When people watch this story, they appear here.'
								})}
							{/if}
						{/if}
					</div>
				{/key}
			</div>

			<!-- COMPOSER -->
			{#if identity.current}
				<div
					class="shrink-0 border-t border-[var(--ui-border)] bg-[var(--surface-bg)] px-3 py-2.5"
				>
					<div class="flex items-center gap-2">
						<Avatar
							pubkey={identity.current.pk}
							name={meName}
							picture={meProfile?.picture}
							size={32}
						/>
						<input
							bind:value={replyText}
							type="text"
							placeholder={`Reply to ${authorName}…`}
							disabled={replying}
							maxlength={280}
							onkeydown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									void submitReply();
								}
							}}
							class="h-10 flex-1 rounded-full border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-4 text-[13px] text-[var(--ui-text)] outline-none transition placeholder:text-[var(--ui-text-dimmed)] focus:border-primary-500/40 focus:bg-[var(--surface-bg)] focus:ring-2 focus:ring-primary-500/25 disabled:opacity-60"
						/>
						<button
							type="button"
							onclick={toggleLike}
							disabled={liking}
							class={cn(
								'relative grid size-10 shrink-0 place-items-center rounded-full transition hover:bg-[var(--ui-bg-muted)]',
								liked ? 'text-[var(--tone-error-text)]' : 'text-[var(--ui-text-muted)]'
							)}
							aria-label={liked ? 'Unlike story' : 'Like story'}
						>
							<Icon
								name={liked ? 'i-solar-heart-bold' : 'i-solar-heart-linear'}
								class={cn('size-5 transition', liked && 'scale-110')}
							/>
							{#if burst}
								<span
									class="heart-burst pointer-events-none absolute inset-0 grid place-items-center text-[var(--tone-error-text)]"
								>
									<Icon name="i-solar-heart-bold" class="size-5" />
								</span>
							{/if}
						</button>
						<button
							type="button"
							onclick={submitReply}
							disabled={!replyText.trim() || replying}
							class="grid size-10 shrink-0 place-items-center rounded-full bg-primary-500 text-white shadow-[var(--glow-primary)] transition hover:bg-primary-600 disabled:pointer-events-none disabled:opacity-40"
							aria-label="Post reply"
						>
							<Icon
								name={replying ? 'i-lucide-loader-circle' : 'i-lucide-send-horizontal'}
								class={cn('size-4', replying && 'animate-spin')}
							/>
						</button>
					</div>
				</div>
			{:else}
				<div
					class="shrink-0 border-t border-[var(--ui-border)] bg-[var(--surface-bg)] px-4 py-3 text-center text-[12px] text-[var(--ui-text-dimmed)]"
				>
					Create or import a key to reply or react.
				</div>
			{/if}
		</div>
	</div>
{/if}

{#snippet emptyState(opts: { icon: string; title: string; hint: string })}
	<div class="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
		<div
			class="grid size-14 place-items-center rounded-full bg-[var(--ui-bg-muted)] text-[var(--ui-text-dimmed)]"
		>
			<Icon name={opts.icon} class="size-6" />
		</div>
		<div class="space-y-1">
			<p class="text-[13px] font-bold text-[var(--ui-text-muted)]">{opts.title}</p>
			<p class="max-w-[224px] text-[11.5px] leading-relaxed text-[var(--ui-text-dimmed)]">
				{opts.hint}
			</p>
		</div>
	</div>
{/snippet}
