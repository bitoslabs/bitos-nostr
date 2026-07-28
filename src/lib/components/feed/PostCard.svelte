<script lang="ts">
	import { browser } from '$app/environment';
	import { noteEncode, npubEncode } from 'nostr-tools/nip19';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { feed } from '$lib/nostr/feed.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { shortKey, timeAgo, timeFull } from '$lib/utils/format';
	import { popovers } from '$lib/stores/popovers.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import type { FeedNote } from '$lib/nostr/types';

	let { note, index = 0 }: { note: FeedNote; index?: number } = $props();

	const profile = $derived(profiles.get(note.pubkey));
	const displayName = $derived(profile?.display_name || profile?.name || shortKey(note.pubkey));
	const isMe = $derived(identity.current?.pk === note.pubkey);
	const liked = $derived(note.reactions.some((r) => r.byMe));
	const reactionCount = $derived(note.reactions.reduce((s, r) => s + r.count, 0));
	const menuId = $derived(`post-menu:${note.id}`);
	const menuOpen = $derived(popovers.isOpen(menuId));
	const noteLink = $derived(`nostr:${noteEncode(note.id)}`);
	const authorNpub = $derived(npubEncode(note.pubkey));
	const rawNote = $derived(
		JSON.stringify(
			{
				id: note.id,
				author: note.pubkey,
				authorNpub,
				createdAt: note.createdAt,
				content: note.content,
				tags: note.tags,
				replyTo: note.replyTo,
				reactions: note.reactions,
				repostCount: note.repostCount
			},
			null,
			2
		)
	);
	let burst = $state(false);
	let rawOpen = $state(false);
	let saved = $state(isSaved());

	function savedIds() {
		if (!browser) return [];
		try {
			const value = localStorage.getItem('bitos:saved-notes');
			return value ? (JSON.parse(value) as string[]) : [];
		} catch {
			return [];
		}
	}

	function isSaved() {
		return savedIds().includes(note.id);
	}

	function persistSaved(ids: string[]) {
		if (!browser) return;
		localStorage.setItem('bitos:saved-notes', JSON.stringify(ids));
	}

	async function copyText(value: string, label: string) {
		try {
			await navigator.clipboard.writeText(value);
			toasts.success(`${label} copied`);
		} catch {
			toasts.error(`Could not copy ${label.toLowerCase()}`);
		} finally {
			popovers.close();
		}
	}

	function toggleSaved() {
		const ids = savedIds();
		if (ids.includes(note.id)) {
			persistSaved(ids.filter((id) => id !== note.id));
			saved = false;
			toasts.info('Removed from saved');
		} else {
			persistSaved([note.id, ...ids]);
			saved = true;
			toasts.success('Saved');
		}
		popovers.close();
	}

	function hideNote() {
		feed.hideNote(note.id);
		toasts.info('Note hidden');
		popovers.close();
	}

	function muteAuthor() {
		feed.muteAuthor(note.pubkey);
		toasts.info(`Muted ${displayName}`);
		popovers.close();
	}

	async function deleteNote() {
		popovers.close();
		if (!confirm('Request deletion for this note?')) return;
		try {
			await feed.deleteNote(note);
			toasts.success('Deletion request published');
		} catch (e) {
			toasts.error((e as Error).message);
		}
	}

	function showRaw() {
		rawOpen = true;
		popovers.close();
	}

	async function react() {
		try {
			await feed.react(note, '❤️');
			if (!liked) {
				burst = true;
				setTimeout(() => (burst = false), 600);
			}
		} catch (e) {
			toasts.error((e as Error).message);
		}
	}
</script>

<article
	class="post-card fade-up relative overflow-visible"
	style="animation-delay:{index * 0.05}s"
>
	<!-- Author header -->
	<header class="flex items-center justify-between gap-2 p-4 pb-3">
		<a href={`/profile/${note.pubkey}`} class="flex min-w-0 flex-1 items-center gap-3">
			<Avatar pubkey={note.pubkey} name={displayName} picture={profile?.picture} size={44} />
			<div class="min-w-0 flex-1 leading-tight">
				<p class="flex min-w-0 items-center gap-1.5 text-[14px] font-bold">
					<span class="truncate">{displayName}</span>
					{#if note.reactions.length}<Icon
							name="i-lucide-badge-check"
							class="size-4 shrink-0 text-primary-500"
						/>{/if}
					{#if isMe}
						<span
							class="rounded-full bg-primary-500/15 px-1.5 py-px text-[9px] font-bold text-primary-600 uppercase"
							>you</span
						>
					{/if}
				</p>
				<p class="flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--ui-text-dimmed)]">
					<span class="truncate font-mono">{shortKey(note.pubkey, 8, 6)}</span>
					<span>·</span>
					<time class="shrink-0" title={timeFull(note.createdAt)}>{timeAgo(note.createdAt)}</time>
				</p>
			</div>
		</a>
		<div class="relative shrink-0">
			<button
				type="button"
				onclick={(e) => {
					e.stopPropagation();
					popovers.toggle(menuId);
				}}
				class="grid size-9 place-items-center rounded-lg text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] {menuOpen
					? 'bg-[var(--interactive-hover-bg)] text-[var(--ui-text)]'
					: ''}"
				aria-label="Post actions"
				aria-expanded={menuOpen}
			>
				<Icon name="i-lucide-ellipsis" class="size-5" />
			</button>

			{#if menuOpen}
				<div
					class="absolute top-10 right-0 z-30 w-60 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] p-1.5 shadow-[var(--shadow-pop)]"
				>
					<a
						href={`/messages?to=${note.pubkey}`}
						class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
					>
						<Icon name="i-lucide-message-circle" class="size-4 shrink-0" />
						Message author
					</a>
					<button
						type="button"
						onclick={toggleSaved}
						class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
					>
						<Icon
							name={saved ? 'i-lucide-bookmark-x' : 'i-lucide-bookmark'}
							class="size-4 shrink-0"
						/>
						{saved ? 'Unsave note' : 'Save note'}
					</button>
					<button
						type="button"
						onclick={() => copyText(noteLink, 'Note link')}
						class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
					>
						<Icon name="i-lucide-link" class="size-4 shrink-0" />
						Copy note link
					</button>
					<button
						type="button"
						onclick={() => copyText(note.id, 'Note ID')}
						class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
					>
						<Icon name="i-lucide-fingerprint" class="size-4 shrink-0" />
						Copy note ID
					</button>
					<button
						type="button"
						onclick={() => copyText(authorNpub, 'Author npub')}
						class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
					>
						<Icon name="i-lucide-user-round" class="size-4 shrink-0" />
						Copy author npub
					</button>
					<button
						type="button"
						onclick={showRaw}
						class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
					>
						<Icon name="i-lucide-braces" class="size-4 shrink-0" />
						View raw note
					</button>
					<div class="my-1 h-px bg-[var(--ui-border-muted)]"></div>
					<button
						type="button"
						onclick={hideNote}
						class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
					>
						<Icon name="i-lucide-eye-off" class="size-4 shrink-0" />
						Hide note
					</button>
					{#if !isMe}
						<button
							type="button"
							onclick={muteAuthor}
							class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
						>
							<Icon name="i-lucide-volume-x" class="size-4 shrink-0" />
							Mute author
						</button>
					{:else}
						<button
							type="button"
							onclick={deleteNote}
							class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[var(--tone-error-text)] transition-colors hover:bg-[var(--tone-error-bg)]"
						>
							<Icon name="i-lucide-trash-2" class="size-4 shrink-0" />
							Delete note
						</button>
					{/if}
				</div>
			{/if}
		</div>
	</header>

	<!-- Body -->
	<p class="px-4 pb-3 text-[14.5px] leading-relaxed break-words whitespace-pre-wrap">
		{note.content}
	</p>

	<!-- Reactions summary -->
	{#if reactionCount > 0}
		<div
			class="flex items-center justify-between px-4 pt-1 pb-2 text-[12px] text-[var(--ui-text-dimmed)]"
		>
			<div class="flex items-center gap-1.5">
				<span
					class="grid size-5 place-items-center rounded-full bg-primary-500 text-[10px] ring-2 ring-[var(--surface-bg)]"
					>❤️</span
				>
				<span>{reactionCount}</span>
			</div>
			<span>{note.repostCount || 0} reposts</span>
		</div>
	{/if}

	<!-- Action bar -->
	<div
		class="mx-4 my-2 flex items-center justify-around border-y border-[var(--ui-border-muted)] py-1.5"
	>
		<button
			type="button"
			onclick={react}
			class="relative flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors hover:bg-primary-500/10 {liked
				? 'text-primary-500'
				: 'text-[var(--ui-text-muted)] hover:text-primary-500'}"
		>
			<span class="relative">
				<Icon name="i-lucide-heart" class="size-[16px] {liked ? 'fill-primary-500' : ''}" />
				{#if burst}
					<span class="heart-burst pointer-events-none absolute inset-0 text-primary-500">
						<Icon name="i-lucide-heart" class="size-[16px]" />
					</span>
				{/if}
			</span>
			<span>Like</span>
		</button>
		<a
			href={`/messages?to=${note.pubkey}`}
			class="flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
		>
			<Icon name="i-lucide-message-circle" class="size-[16px]" />
			<span>Comment</span>
		</a>
		<button
			type="button"
			onclick={() => copyText(noteLink, 'Note link')}
			class="flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
		>
			<Icon name="i-lucide-share" class="size-[16px]" />
			<span>Share</span>
		</button>
		<button
			type="button"
			onclick={toggleSaved}
			class="flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
		>
			<Icon name={saved ? 'i-lucide-bookmark-check' : 'i-lucide-bookmark'} class="size-[16px]" />
		</button>
	</div>

	<!-- Comment input -->
	<div class="px-4 pt-1 pb-4">
		<div class="flex items-center gap-2">
			{#if identity.current}
				{@const mk = profiles.get(identity.current.pk)}
				<div
					class="grid size-7 shrink-0 place-items-center rounded-lg bg-warm-500 text-[10px] font-bold text-white"
				>
					{(mk?.display_name || 'Y').slice(0, 2).toUpperCase()}
				</div>
			{/if}
			<input
				type="text"
				placeholder="Add a comment…"
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						(e.currentTarget as HTMLInputElement).value = '';
						toasts.success('Comment posted');
					}
				}}
				class="flex-1 rounded-full bg-[var(--ui-bg-muted)] px-4 py-2 text-[13px] text-[var(--ui-text)] transition outline-none placeholder:text-[var(--ui-text-dimmed)] focus:bg-[var(--surface-bg)] focus:ring-2 focus:ring-primary-500/30"
			/>
		</div>
	</div>
</article>

<Dialog bind:open={rawOpen} title="Raw note">
	<div class="space-y-3">
		<div class="flex items-center gap-2">
			<button
				type="button"
				onclick={() => copyText(rawNote, 'Raw note')}
				class="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-3 py-2 text-[12px] font-bold text-white transition hover:bg-primary-600"
			>
				<Icon name="i-lucide-copy" class="size-4" />
				Copy JSON
			</button>
		</div>
		<pre
			class="max-h-[52vh] overflow-auto rounded-xl bg-[var(--ui-bg-muted)] p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-[var(--ui-text-muted)]">{rawNote}</pre>
	</div>
</Dialog>
