<script lang="ts">
	/**
	 * Bitz comments panel — the side/bottom sheet opened from a reel's action
	 * rail. Self-contained: owns comment loading + pagination, the two-level
	 * thread layout, reply composition, and per-comment actions (like / zap /
	 * delete). The page only passes the reel being watched; swiping while the
	 * panel is open swaps the thread through the `reel` prop.
	 *
	 * Relay strategy (fast paint + full coverage): the primary read relay
	 * answers first and paints the page while every other read relay is
	 * queried in parallel in the same round — their extra comments and
	 * reactions merge into the thread as they land (`queryParallelProgressive`).
	 * The previous code fetched the other relays only after the primary EOSE
	 * and then discarded their results, so threads were effectively
	 * primary-relay-only.
	 */
	import { untrack } from 'svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import PowBadge from '$lib/components/ui/PowBadge.svelte';
	import NoteZapDialog from '$lib/components/feed/NoteZapDialog.svelte';
	import CommentBody from '$lib/components/feed/CommentBody.svelte';
	import ReplyComposer from '$lib/components/feed/ReplyComposer.svelte';
	import { feed } from '$lib/nostr/feed.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { queryParallelProgressive } from '$lib/nostr/pool';
	import { applyActivityToNotes } from '$lib/nostr/zaps';
	import {
		commentTree,
		commentsFor,
		commentPages,
		optimisticCommentZaps
	} from '$lib/nostr/comments.svelte';
	import { toFeedNote } from '$lib/nostr/feed-note';
	import { NOSTR_KINDS, type FeedNote } from '$lib/nostr/types';
	import type { ReelNote } from '$lib/stores/bitz-session.svelte';
	import { privacyNotificationSettings } from '$lib/stores/privacy-notification-settings.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { shortKey, timeAgo } from '$lib/utils/format';
	import { compactSats } from '$lib/utils/profile-stats';
	import { hasLightning } from '$lib/utils/verification';
	import type { Event } from 'nostr-tools/pure';

	let {
		reel,
		onClose,
		onNavigate
	}: {
		/** The reel whose thread is open (the page swaps it while swiping). */
		reel: ReelNote;
		onClose: () => void;
		/** Previous/next reel from the panel header (page-owned scrolling). */
		onNavigate: (delta: -1 | 1) => void;
	} = $props();

	const COMMENTS_PAGE_SIZE = 80;

	let loadingComments = $state(false);
	let commentsLoadError = $state('');
	let deletingCommentId = $state('');
	/** The comment being replied to (full note, not just id/name): replies must
	 * chain NIP-10 tags to this comment so they land nested under it — exactly
	 * how feed-card comment replies are saved. Null = replying to the reel. */
	let commentReplyTarget = $state<FeedNote | null>(null);
	let commentPendingDelete = $state<FeedNote | null>(null);
	let deleteCommentOpen = $state(false);

	// --- Zap a comment ---
	let zapCommentTarget = $state<FeedNote | null>(null);
	let zapCommentOpen = $state(false);
	const zapCommentProfile = $derived(
		zapCommentTarget ? profiles.get(zapCommentTarget.pubkey) : undefined
	);
	const zapCommentAddress = $derived(zapCommentProfile?.lud16 || zapCommentProfile?.lud06 || '');

	const activeComments = $derived(commentsFor(reel.id));
	const activeCommentTree = $derived(commentTree(reel.id));
	const activeTopLevelComments = $derived(activeCommentTree.top);
	const activeCommentPage = $derived(commentPages[reel.id]);
	/**
	 * NIP-22 comments are for non-kind-1 Bitz events. Some legacy video posts
	 * are ordinary kind-1 notes; passing either those, or an unknown cached
	 * kind, to `feed.comment()` causes its intentional NIP-10 guard to throw.
	 * Omitting this target lets ReplyComposer use `feed.reply()` for that safe
	 * compatibility path instead.
	 */
	const commentTarget = $derived.by(() => {
		const kind = reel.raw?.kind;
		return typeof kind === 'number' && kind !== NOSTR_KINDS.TEXT_NOTE
			? { id: reel.id, pubkey: reel.pubkey, kind }
			: undefined;
	});

	// The panel follows the player: swiping while open swaps the thread here.
	// Reply state resets with the swap; loads dedupe through `commentPages`
	// (module-level), so revisiting a thread paints instantly from the feed
	// store instead of refetching. Only the `reel` read is tracked — the load
	// itself must not re-run on pagination-state writes.
	$effect(() => {
		const target = reel;
		untrack(() => {
			commentReplyTarget = null;
			void loadComments(target);
		});
	});

	async function loadComments(target: ReelNote, options: { force?: boolean; more?: boolean } = {}) {
		const page = commentPages[target.id];
		if (!options.force && !options.more && page?.loaded) return;
		if (options.more && (!page?.hasMore || !page.oldestCreatedAt)) return;
		loadingComments = true;
		commentsLoadError = '';
		try {
			// ADR-003 migration window: read both NIP-22 comments (kind 1111,
			// uppercase E root) and legacy kind-1 replies so old and new clients
			// see one merged thread.
			const filter: {
				kinds: number[];
				'#e'?: string[];
				'#E'?: string[];
				limit: number;
				until?: number;
			} = {
				kinds: [NOSTR_KINDS.COMMENT, NOSTR_KINDS.TEXT_NOTE],
				'#e': [target.id],
				limit: COMMENTS_PAGE_SIZE
			};
			if (options.more) filter.until = page!.oldestCreatedAt - 1;
			// NIP-22 roots use uppercase `E`, while legacy/NIP-10 replies use
			// lowercase `e`. Ask for both explicitly: relay tag filters are case
			// sensitive, so only querying `#e` silently loses valid comments.
			const rootFilter = { ...filter, '#E': [target.id] };
			delete rootFilter['#e'];
			// 1 relay first, others in parallel: the primary relay paints the
			// first page, and the other read relays — already queried in the
			// same round — merge their extra comments in as they land.
			const replyEvents = await queryParallelProgressive([filter, rootFilter], {
				onSecondary: (merged) => void commitThread(target, merged)
			});
			await commitThread(target, replyEvents);
		} catch (e) {
			commentsLoadError = (e as Error).message || 'Could not load comments';
			toasts.error(commentsLoadError);
		} finally {
			loadingComments = false;
		}
	}

	/** Fold one batch of relay reply events into the shared feed store: parse →
	 *  keep the reel's thread → fetch reactions → upsert. Runs for the primary
	 *  paint and again for the parallel secondary merge — upserts are
	 *  idempotent, so the second pass only adds what landed. */
	async function commitThread(target: ReelNote, events: Event[]) {
		updatePageCursor(target, events);
		// Keep the whole thread, not just direct replies: nested replies-to-
		// comments reference the reel through their NIP-10 root tag (or the
		// uppercase E tag on kind-1111 comments).
		const replies = events
			.map(toFeedNote)
			.filter((note) =>
				note.tags.some((tag) => (tag[0] === 'e' || tag[0] === 'E') && tag[1] === target.id)
			);
		if (!replies.length) return;
		const replyIds = replies.map((reply) => reply.id);
		// Activity is an enhancement, never a dependency for rendering the
		// thread. A relay that rejects/times out the reaction query must not
		// make the comments themselves disappear.
		let reactions: Event[] = [];
		try {
			reactions = await queryParallelProgressive([
				{ kinds: [NOSTR_KINDS.REACTION], '#e': replyIds, limit: 300 }
			]);
		} catch {
			// The visible zero-count fallback is preferable to dropping comments.
		}
		const withActivity = applyActivityToNotes(replies, reactions, identity.current?.pk);
		for (const reply of withActivity) feed.upsertNote(reply);
		// Metadata is best-effort. Avatar/name fallbacks remain usable while a
		// profile event is unavailable or a relay metadata request fails.
		void profiles.ensure(withActivity.map((reply) => reply.pubkey)).catch(() => {});
	}

	/** Advance the backwards pagination cursor. Runs for the primary page and
	 *  again for the secondary merge, so `until` always points at the oldest
	 *  event seen from any relay. */
	function updatePageCursor(target: ReelNote, events: Event[]) {
		const prev = commentPages[target.id];
		const oldestInPage = events.reduce(
			(oldest, event) => Math.min(oldest, event.created_at),
			Number.POSITIVE_INFINITY
		);
		const oldestCreatedAt = Number.isFinite(oldestInPage)
			? Math.min(prev?.oldestCreatedAt || Number.POSITIVE_INFINITY, oldestInPage)
			: prev?.oldestCreatedAt || 0;
		commentPages[target.id] = {
			loaded: true,
			oldestCreatedAt,
			hasMore: events.length >= COMMENTS_PAGE_SIZE && oldestCreatedAt > 0
		};
	}

	async function loadMoreComments() {
		if (loadingComments || !activeCommentPage?.hasMore) return;
		await loadComments(reel, { more: true });
	}

	async function likeComment(comment: FeedNote) {
		try {
			await feed.react(comment, '❤️');
			await loadComments(reel, { force: true });
		} catch (e) {
			toasts.error((e as Error).message);
		}
	}

	function commentZapSats(comment: FeedNote) {
		return comment.zapTotalSats + (optimisticCommentZaps[comment.id] ?? 0);
	}

	function zapComment(comment: FeedNote) {
		const profile = profiles.get(comment.pubkey);
		if (!profile?.lud16 && !profile?.lud06) {
			toasts.info('This author has no Lightning address');
			return;
		}
		zapCommentTarget = comment;
		zapCommentOpen = true;
	}

	function handleCommentZapPaid(sats: number) {
		if (!zapCommentTarget) return;
		optimisticCommentZaps[zapCommentTarget.id] =
			(optimisticCommentZaps[zapCommentTarget.id] ?? 0) + sats;
	}

	function askDeleteComment(comment: FeedNote) {
		if (comment.pubkey !== identity.current?.pk) return;
		commentPendingDelete = comment;
		deleteCommentOpen = true;
	}

	async function deleteComment() {
		const comment = commentPendingDelete;
		if (!comment || deletingCommentId || comment.pubkey !== identity.current?.pk) return;
		deletingCommentId = comment.id;
		try {
			await feed.deleteNote(comment);
			commentPendingDelete = null;
			deleteCommentOpen = false;
			toasts.success('Comment deleted');
		} catch (e) {
			toasts.error((e as Error).message || 'Could not delete comment');
		} finally {
			deletingCommentId = '';
		}
	}
</script>

<!-- Mobile backdrop: tap outside dismisses the sheet. -->
<button
	type="button"
	class="fixed inset-0 z-40 bg-black/45 lg:hidden"
	aria-label="Close comments"
	onclick={onClose}
></button>
<aside
	class="reel-comments-panel fixed inset-x-0 bottom-0 z-50 flex max-h-[78vh] flex-col overflow-hidden rounded-t-3xl bg-[var(--ui-bg)] text-[var(--ui-text)] md:border-l md:border-[var(--ui-border-muted)] lg:inset-y-0 lg:right-0 lg:left-auto lg:h-full lg:max-h-none lg:w-[390px] lg:rounded-none"
	aria-label="Bitz comments"
>
	<header class="flex h-14 shrink-0 items-center justify-between px-4">
		<h2 class="text-[16px] font-extrabold text-[var(--ui-text-highlighted)]">
			Comments <span class="ml-1 text-[var(--ui-text-dimmed)]">{activeComments.length}</span>
		</h2>
		<div class="flex items-center gap-1">
			<button
				type="button"
				onclick={() => onNavigate(-1)}
				class="grid size-9 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text-highlighted)]"
				aria-label="Previous bitz"
			>
				<Icon name="i-lucide-chevron-up" class="size-4" />
			</button>
			<button
				type="button"
				onclick={() => onNavigate(1)}
				class="grid size-9 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text-highlighted)]"
				aria-label="Next bitz"
			>
				<Icon name="i-lucide-chevron-down" class="size-4" />
			</button>
			<button
				type="button"
				onclick={() => loadComments(reel, { force: true })}
				disabled={loadingComments}
				class="grid size-9 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text-highlighted)] disabled:cursor-not-allowed disabled:opacity-60"
				aria-label="Refresh comments"
			>
				<Icon name="i-lucide-rotate-cw" class="size-4 {loadingComments ? 'animate-spin' : ''}" />
			</button>
			<button
				type="button"
				onclick={onClose}
				class="grid size-9 place-items-center rounded-full bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)] transition hover:text-[var(--ui-text-highlighted)]"
				aria-label="Close comments"
			>
				<Icon name="i-lucide-x" class="size-5" />
			</button>
		</div>
	</header>
	<div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
		{#if loadingComments && !activeComments.length}
			<div class="flex h-36 items-center justify-center">
				<div
					class="size-6 animate-spin rounded-full border-2 border-[var(--ui-border)] border-t-primary-500"
				></div>
			</div>
		{:else}
			<div class="space-y-6">
				{#if commentsLoadError && !activeComments.length}
					<div class="flex h-44 flex-col items-center justify-center text-center">
						<div
							class="grid size-12 place-items-center rounded-2xl bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)]"
						>
							<Icon name="i-lucide-wifi-off" class="size-6" />
						</div>
						<p class="mt-3 text-[14px] font-bold text-[var(--ui-text-highlighted)]">
							Couldn’t load comments
						</p>
						<button
							type="button"
							onclick={() => loadComments(reel, { force: true })}
							class="mt-3 text-[12px] font-bold text-primary-500 transition hover:text-primary-600"
						>
							Try again
						</button>
					</div>
				{:else}
					{#if activeCommentPage?.hasMore}
						<button
							type="button"
							onclick={loadMoreComments}
							disabled={loadingComments || !activeCommentPage?.hasMore}
							class="mx-auto flex h-9 items-center gap-2 rounded-full border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-4 text-[12px] font-bold text-[var(--ui-text-muted)] transition hover:border-primary-500 hover:text-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
						>
							<Icon
								name={loadingComments ? 'i-lucide-loader-circle' : 'i-lucide-chevron-up'}
								class="size-3.5 {loadingComments ? 'animate-spin' : ''}"
							/>
							{loadingComments ? 'Loading comments…' : 'Load more comments'}
						</button>
					{/if}
					{#if activeComments.length}
						{#snippet commentRow(comment: FeedNote, nested: boolean)}
							{@const commentProfile = profiles.get(comment.pubkey)}
							{@const commentName =
								commentProfile?.display_name || commentProfile?.name || shortKey(comment.pubkey)}
							{@const commentLiked = comment.reactions.some((reaction) => reaction.byMe)}
							{@const commentLikes = comment.reactions.reduce(
								(sum, reaction) => sum + reaction.count,
								0
							)}
							<div class="flex {nested ? 'gap-2' : 'gap-3'}">
								<a href={`/profile/${comment.pubkey}`} class="shrink-0">
									<Avatar
										pubkey={comment.pubkey}
										name={commentName}
										picture={commentProfile?.picture}
										lightning={hasLightning(commentProfile)}
										size={nested ? 22 : 34}
										frame={!nested}
									/>
								</a>
								<div class="min-w-0 flex-1">
									<div class="flex min-w-0 items-center gap-1.5">
										<a
											href={`/profile/${comment.pubkey}`}
											class="truncate text-[12px] font-extrabold text-[var(--ui-text-highlighted)] hover:text-primary-500"
										>
											{commentName}
										</a>
										{#if commentProfile?.nip05}
											<Icon name="i-lucide-badge-check" class="size-3 shrink-0 text-primary-500" />
										{/if}
										{#if comment.pubkey === identity.current?.pk}
											<span
												class="rounded-full bg-primary-500/15 px-1 py-px text-[9px] font-bold text-primary-600 uppercase"
												>you</span
											>
										{/if}
										{#if comment.pow}
											<PowBadge bits={comment.pow} micro id={comment.id} />
										{/if}
										<a
											href={`/note/${comment.id}?from=bitz`}
											class="ml-auto shrink-0 text-[10.5px] font-semibold text-[var(--ui-text-dimmed)] hover:text-primary-500"
										>
											{timeAgo(comment.createdAt)}
										</a>
									</div>
									<CommentBody content={comment.content} tags={comment.tags} compact />
									<div
										class="mt-1 flex items-center gap-3 text-[11px] font-bold text-[var(--ui-text-dimmed)]"
									>
										<button
											type="button"
											onclick={() => likeComment(comment)}
											class="inline-flex items-center gap-1 {commentLiked
												? 'text-[var(--tone-error-text)]'
												: 'transition hover:text-[var(--tone-error-text)]'}"
											aria-label="Like comment"
										>
											<Icon
												name={commentLiked ? 'i-solar-heart-bold' : 'i-solar-heart-linear'}
												class="size-3 {commentLiked ? 'text-primary-500' : ''}"
											/>
											{#if commentLikes}<span class="font-semibold">{commentLikes}</span>{/if}
										</button>
										<button
											type="button"
											onclick={() => zapComment(comment)}
											class="inline-flex items-center gap-1 transition hover:text-warm-500"
											aria-label="Zap sats to this comment"
										>
											<Icon name="i-lucide-zap" class="size-3 fill-current" />
											{#if commentZapSats(comment)}
												<span class="font-semibold">{compactSats(commentZapSats(comment))}</span>
											{:else}Zap{/if}
										</button>
										<button
											type="button"
											onclick={() => (commentReplyTarget = comment)}
											disabled={!privacyNotificationSettings.canCommentOn(comment.pubkey)}
											class="transition hover:text-primary-500 disabled:pointer-events-none disabled:opacity-40"
										>
											Reply
										</button>
										{#if comment.pubkey === identity.current?.pk}
											<button
												type="button"
												onclick={() => askDeleteComment(comment)}
												disabled={deletingCommentId === comment.id}
												class="transition hover:text-[var(--ui-text-highlighted)] disabled:cursor-not-allowed disabled:opacity-60"
											>
												{deletingCommentId === comment.id ? 'Deleting' : 'Delete'}
											</button>
										{/if}
									</div>
								</div>
							</div>
						{/snippet}
						{#each activeTopLevelComments as comment (comment.id)}
							{@render commentRow(comment, false)}
							{#if activeCommentTree.children.get(comment.id)?.length}
								<!-- Same X-style level-two treatment as PostCard: descendants
							     are visually grouped, but never gain a third indent. -->
								<div class="mt-3 ml-5 space-y-3 border-l border-[var(--ui-border-muted)] pl-3">
									{#each activeCommentTree.children.get(comment.id) ?? [] as child (child.id)}
										{@render commentRow(child, true)}
									{/each}
								</div>
							{/if}
						{/each}
					{:else}
						<div class="flex h-44 flex-col items-center justify-center text-center">
							<div
								class="grid size-12 place-items-center rounded-2xl bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)]"
							>
								<Icon name="i-lucide-message-circle" class="size-6" />
							</div>
							<p class="mt-3 text-[14px] font-bold text-[var(--ui-text-highlighted)]">
								No comments yet
							</p>
							<p class="mt-1 text-[12px] text-[var(--ui-text-muted)]">Start the conversation.</p>
						</div>
					{/if}
				{/if}
			</div>
		{/if}
	</div>

	<div class="shrink-0 bg-transparent p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
		{#key `${reel.id}:${commentReplyTarget?.id ?? ''}`}
			{@const replyTargetProfile = commentReplyTarget
				? profiles.get(commentReplyTarget.pubkey)
				: undefined}
			{@const replyTargetName = commentReplyTarget
				? replyTargetProfile?.display_name ||
					replyTargetProfile?.name ||
					shortKey(commentReplyTarget.pubkey)
				: ''}
			<ReplyComposer
				parent={commentReplyTarget ?? reel}
				{commentTarget}
				placeholder={commentReplyTarget ? `Reply to ${replyTargetName}…` : 'Add a comment…'}
				autofocus={!!commentReplyTarget}
				initialMention={commentReplyTarget
					? { pubkey: commentReplyTarget.pubkey, name: replyTargetName }
					: undefined}
				onSubmitted={() => {
					commentReplyTarget = null;
					void loadComments(reel, { force: true });
				}}
				onCancel={() => (commentReplyTarget = null)}
			/>
		{/key}
	</div>
</aside>

<Dialog bind:open={deleteCommentOpen} title="Delete comment">
	<div class="space-y-2">
		<p class="text-[14px] font-semibold text-[var(--ui-text)]">Delete this comment?</p>
		<p class="text-[13px] leading-relaxed text-[var(--ui-text-muted)]">
			BitOS will publish a delete event to your relays and remove the comment locally.
		</p>
	</div>

	{#snippet footer()}
		<button
			type="button"
			onclick={() => {
				commentPendingDelete = null;
				deleteCommentOpen = false;
			}}
			disabled={!!deletingCommentId}
			class="inline-flex h-9 items-center justify-center rounded-full border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-4 text-[13px] font-bold text-[var(--ui-text)] transition hover:border-primary-500 hover:text-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
		>
			Cancel
		</button>
		<button
			type="button"
			onclick={deleteComment}
			disabled={!!deletingCommentId}
			class="inline-flex h-9 items-center gap-2 rounded-full bg-[var(--tone-error-text)] px-4 text-[13px] font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
		>
			<Icon
				name={deletingCommentId ? 'i-lucide-loader-circle' : 'i-lucide-trash-2'}
				class="size-4 {deletingCommentId ? 'animate-spin' : ''}"
			/>
			{deletingCommentId ? 'Deleting' : 'Delete'}
		</button>
	{/snippet}
</Dialog>

{#if zapCommentTarget}
	<NoteZapDialog
		bind:open={zapCommentOpen}
		recipientPubkey={zapCommentTarget.pubkey}
		lightningAddress={zapCommentAddress}
		eventId={zapCommentTarget.id}
		onPaid={handleCommentZapPaid}
		onClose={() => (zapCommentTarget = null)}
	/>
{/if}
