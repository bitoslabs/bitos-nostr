<script lang="ts">
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { stories, type StorySlide, type StoryAuthor } from '$lib/nostr/stories.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { timeAgo, shortKey } from '$lib/utils/format';

	/**
	 * Story engagement sheet — a scannable list of who viewed, liked, and
	 * replied to a story slide. The "Views" section is only shown to the story's
	 * author (mirrors Instagram). Everyone can read the likes/replies and post a
	 * new reply from the box at the top.
	 */
	let {
		slide,
		author,
		open = $bindable(false)
	}: { slide: StorySlide | null | undefined; author: StoryAuthor; open?: boolean } = $props();

	const isAuthor = $derived(author.pubkey === identity.current?.pk?.toLowerCase());
	const interaction = $derived(slide ? stories.getInteraction(slide.id) : undefined);

	let replyText = $state('');
	let replying = $state(false);

	// If the slide vanishes (story closed), dismiss the sheet.
	$effect(() => {
		if (open && !slide) open = false;
	});

	function nameOf(pubkey: string) {
		const p = profiles.get(pubkey);
		return p?.display_name || p?.name || shortKey(pubkey);
	}

	function plural(n: number, word: string) {
		return n === 1 ? word : `${word}s`;
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
</script>

<Dialog bind:open title="Story activity">
	<div class="space-y-5">
		<!-- Reply box -->
		<div class="flex items-center gap-2">
			{#if identity.current}
				<Avatar
					pubkey={identity.current.pk}
					name="You"
					picture={profiles.get(identity.current.pk)?.picture}
					size={32}
				/>
			{/if}
			<input
				bind:value={replyText}
				type="text"
				placeholder={`Reply to ${nameOf(author.pubkey)}…`}
				disabled={!identity.current || replying}
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						void submitReply();
					}
				}}
				class="h-10 flex-1 rounded-full bg-[var(--ui-bg-muted)] px-4 text-[13px] text-[var(--ui-text)] outline-none placeholder:text-[var(--ui-text-dimmed)] focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60"
			/>
			<button
				type="button"
				onclick={submitReply}
				disabled={!replyText.trim() || replying || !identity.current}
				class="grid size-10 shrink-0 place-items-center rounded-full bg-primary-500 text-white shadow-[var(--glow-primary)] transition hover:bg-primary-600 disabled:pointer-events-none disabled:opacity-50"
				aria-label="Post reply"
			>
				<Icon
					name={replying ? 'i-lucide-loader-circle' : 'i-lucide-send-horizontal'}
					class="size-4 {replying ? 'animate-spin' : ''}"
				/>
			</button>
		</div>

		<!-- Views (author only) -->
		{#if isAuthor}
			<section>
				<h3
					class="mb-2 flex items-center gap-1.5 text-[12px] font-bold text-[var(--ui-text-muted)] uppercase"
				>
					<Icon name="i-lucide-eye" class="size-3.5" />
					{interaction?.viewCount ?? 0} {plural(interaction?.viewCount ?? 0, 'view')}
				</h3>
				{#if (interaction?.views.length ?? 0) > 0}
					<ul class="space-y-1">
						{#each interaction!.views as viewer (viewer)}
							<li>
								<a
									href={`/profile/${viewer}`}
									class="flex items-center gap-2 rounded-lg p-1.5 transition hover:bg-[var(--interactive-hover-bg)]"
								>
									<Avatar
										pubkey={viewer}
										name={nameOf(viewer)}
										picture={profiles.get(viewer)?.picture}
										size={32}
									/>
									<span class="truncate text-[13px] font-semibold text-[var(--ui-text)]"
										>{nameOf(viewer)}</span
									>
								</a>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="text-[12.5px] text-[var(--ui-text-dimmed)]">No views yet.</p>
				{/if}
			</section>
		{/if}

		<!-- Likes -->
		<section>
			<h3
				class="mb-2 flex items-center gap-1.5 text-[12px] font-bold text-[var(--ui-text-muted)] uppercase"
			>
				<Icon name="i-solar-heart-linear" class="size-3.5" />
				{interaction?.likeCount ?? 0} {plural(interaction?.likeCount ?? 0, 'like')}
			</h3>
			{#if (interaction?.likes.length ?? 0) > 0}
				<ul class="space-y-1">
					{#each interaction!.likes as like (like.pubkey)}
						<li>
							<a
								href={`/profile/${like.pubkey}`}
								class="flex items-center gap-2 rounded-lg p-1.5 transition hover:bg-[var(--interactive-hover-bg)]"
							>
								<Avatar
									pubkey={like.pubkey}
									name={nameOf(like.pubkey)}
									picture={profiles.get(like.pubkey)?.picture}
									size={32}
								/>
								<span class="truncate text-[13px] font-semibold text-[var(--ui-text)]"
									>{nameOf(like.pubkey)}</span
								>
								<span class="ml-auto text-[16px]">{like.emoji}</span>
							</a>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-[12.5px] text-[var(--ui-text-dimmed)]">No likes yet.</p>
			{/if}
		</section>

		<!-- Replies -->
		<section>
			<h3
				class="mb-2 flex items-center gap-1.5 text-[12px] font-bold text-[var(--ui-text-muted)] uppercase"
			>
				<Icon name="i-lucide-message-circle" class="size-3.5" />
				{interaction?.replyCount ?? 0} {plural(interaction?.replyCount ?? 0, 'reply')}
			</h3>
			{#if (interaction?.replies.length ?? 0) > 0}
				<ul class="space-y-2">
					{#each interaction!.replies as reply (reply.id)}
						<li class="flex gap-2">
							<a href={`/profile/${reply.pubkey}`} class="shrink-0">
								<Avatar
									pubkey={reply.pubkey}
									name={nameOf(reply.pubkey)}
									picture={profiles.get(reply.pubkey)?.picture}
									size={28}
								/>
							</a>
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-1.5">
									<a
										href={`/profile/${reply.pubkey}`}
										class="truncate text-[12.5px] font-bold text-[var(--ui-text)] transition hover:text-primary-500"
										>{nameOf(reply.pubkey)}</a
									>
									<time class="shrink-0 text-[11px] text-[var(--ui-text-dimmed)]"
										>{timeAgo(reply.createdAt)}</time
									>
								</div>
								<p
									class="mt-0.5 text-[13px] leading-relaxed break-words whitespace-pre-wrap text-[var(--ui-text)]"
								>
									{reply.content}
								</p>
							</div>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-[12.5px] text-[var(--ui-text-dimmed)]">No replies yet.</p>
			{/if}
		</section>
	</div>
</Dialog>
