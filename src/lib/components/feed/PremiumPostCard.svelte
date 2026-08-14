<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import HexAvatar from '$lib/components/ui/HexAvatar.svelte';
	import PowBadge from '$lib/components/ui/PowBadge.svelte';
	import { cn } from '$lib/utils/cn';
	import { formatCompact } from '$lib/utils/format';

	/** Author of a premium post card. */
	export type PostAuthor = {
		name: string;
		npub: string;
		picture?: string | null;
		pubkey?: string;
		verified?: boolean;
	};

	/** Engagement counters shown on the action row. */
	export type PostStats = {
		replies?: number;
		reposts?: number;
		likes?: number;
		zaps?: number;
		sats?: number;
	};

	/** An optional quoted (reposted) note rendered inline. */
	export type PostQuote = {
		author: string;
		npub: string;
		content: string;
		pow?: number;
	};

	/**
	 * Premium feed post card: hex avatar, verified badge, kind chip + event id,
	 * body, optional media, optional quote, a PoW badge, and a mono action row
	 * (reply / repost / like / zap / bookmark). Fully controlled — the parent
	 * owns the note state and reacts via callbacks.
	 */
	let {
		author,
		time,
		content,
		image,
		kind = 1,
		pow = 0,
		eventId,
		stats = {},
		quote,
		liked = false,
		zapped = false,
		reposted = false,
		onReply,
		onRepost,
		onLike,
		onZap,
		onBookmark,
		onCopyId,
		class: cls
	}: {
		author: PostAuthor;
		time: string;
		content: string;
		image?: string;
		kind?: number;
		pow?: number;
		/** Optional hex event id — powers the PoW badge receipt. */
		eventId?: string;
		stats?: PostStats;
		quote?: PostQuote;
		liked?: boolean;
		zapped?: boolean;
		reposted?: boolean;
		onReply?: () => void;
		onRepost?: () => void;
		onLike?: () => void;
		onZap?: () => void;
		onBookmark?: () => void;
		onCopyId?: () => void;
		class?: string;
	} = $props();
</script>

<article
	class={cn('premium-card cursor-pointer border-x-0 border-t-0 p-3.5 px-4 transition-all', cls)}
>
	<div class="flex gap-3">
		<HexAvatar
			name={author.name}
			picture={author.picture}
			pubkey={author.pubkey ?? author.npub}
			verified={author.verified}
			size={44}
		/>
		<div class="min-w-0 flex-1">
			<!-- Meta row -->
			<div class="mb-1 flex flex-wrap items-center gap-1.5">
				<span class="text-[15px] font-semibold">{author.name}</span>
				<span class="font-mono text-xs text-[var(--ui-text-muted)]">{author.npub}</span>
				<span class="text-[13px] text-[var(--ui-text-dimmed)]">·</span>
				<span class="text-[13px] text-[var(--ui-text-muted)]">{time}</span>
				<span class="ml-auto flex items-center gap-1">
					<span
						class="rounded-full border border-[var(--ui-border-muted)] bg-[var(--interactive-hover-bg)] px-2 py-0.5 font-mono text-[10px] text-[var(--ui-text-muted)]"
					>
						kind:{kind}
					</span>
					<button
						type="button"
						onclick={(e) => {
							e.stopPropagation();
							onCopyId?.();
						}}
						class="cursor-pointer border-none bg-transparent p-1 text-[var(--ui-text-muted)] transition hover:text-[var(--ui-text)]"
						title="Copy event ID"
						aria-label="Copy event ID"
					>
						<Icon name="i-lucide-fingerprint" class="size-3.5" />
					</button>
				</span>
			</div>

			<!-- Body -->
			<div class="text-[15px] leading-relaxed whitespace-pre-wrap text-[var(--ui-text)]">
				{content}
			</div>

			{#if image}
				<div
					class="mt-3 max-h-[380px] overflow-hidden rounded-2xl border border-[var(--ui-border-muted)]"
				>
					<img src={image} alt="" class="size-full object-cover" loading="lazy" />
				</div>
			{/if}

			{#if quote}
				<div
					class="mt-3 cursor-pointer rounded-2xl border border-[var(--ui-border-muted)] p-3 transition-all hover:bg-[var(--interactive-hover-bg)]"
				>
					<div class="mb-1.5 flex items-center gap-2">
						<span class="text-[13px] font-semibold">{quote.author}</span>
						<span class="font-mono text-[11px] text-[var(--ui-text-muted)]">{quote.npub}</span>
						{#if quote.pow}
							<PowBadge bits={quote.pow} compact={true} showLabel={false} />
						{/if}
					</div>
					<div class="text-sm leading-relaxed text-[var(--ui-text-muted)]">{quote.content}</div>
				</div>
			{/if}

			{#if pow > 0}
				<div class="mt-2.5 w-fit">
					<PowBadge bits={pow} id={eventId} />
				</div>
			{/if}

			<!-- Action row -->
			<div class="mt-2.5 flex max-w-[425px] justify-between">
				<button
					type="button"
					onclick={(e) => {
						e.stopPropagation();
						onReply?.();
					}}
					class="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 font-mono text-[13px] text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
				>
					<Icon name="i-lucide-message-circle" class="size-4" />
					<span>{stats.replies ?? 0}</span>
				</button>
				<button
					type="button"
					onclick={(e) => {
						e.stopPropagation();
						onRepost?.();
					}}
					class={cn(
						'flex items-center gap-1.5 rounded-full px-2.5 py-1.5 font-mono text-[13px] transition hover:bg-[var(--interactive-hover-bg)]',
						reposted
							? 'text-[var(--tone-success-text)]'
							: 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'
					)}
				>
					<Icon name="i-lucide-repeat-2" class="size-4" />
					<span>{stats.reposts ?? 0}</span>
				</button>
				<button
					type="button"
					onclick={(e) => {
						e.stopPropagation();
						onLike?.();
					}}
					class={cn(
						'flex items-center gap-1.5 rounded-full px-2.5 py-1.5 font-mono text-[13px] transition hover:bg-[var(--interactive-hover-bg)]',
						liked
							? 'text-[var(--tone-warning-text)]'
							: 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'
					)}
				>
					<Icon
						name={liked ? 'i-lucide-heart' : 'i-lucide-heart'}
						class="size-4 {liked ? 'fill-current' : ''}"
					/>
					<span>{stats.likes ?? 0}</span>
				</button>
				<button
					type="button"
					onclick={(e) => {
						e.stopPropagation();
						onZap?.();
					}}
					class={cn(
						'flex items-center gap-1.5 rounded-full px-2.5 py-1.5 font-mono text-[13px] transition hover:bg-[var(--interactive-hover-bg)]',
						zapped
							? 'text-[var(--ui-color-primary-500)]'
							: 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'
					)}
				>
					<Icon name="i-lucide-zap" class="size-4" />
					<span>{formatCompact(stats.sats ?? 0)} sats</span>
				</button>
				<button
					type="button"
					onclick={(e) => {
						e.stopPropagation();
						onBookmark?.();
					}}
					class="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 font-mono text-[13px] text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
					aria-label="Bookmark"
				>
					<Icon name="i-lucide-bookmark" class="size-4" />
				</button>
			</div>
		</div>
	</div>
</article>
