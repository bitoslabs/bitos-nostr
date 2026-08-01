<script lang="ts">
	import { onMount } from 'svelte';
	import { npubEncode } from 'nostr-tools/nip19';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import PostCard from '$lib/components/feed/PostCard.svelte';
	import StoryRing from '$lib/components/feed/StoryRing.svelte';
	import ProfileActionMenu from '$lib/components/profile/ProfileActionMenu.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { queryOnce } from '$lib/nostr/pool';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { NOSTR_KINDS, type FeedNote } from '$lib/nostr/types';
	import { applyActivityToNotes } from '$lib/nostr/zaps';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { shortKey, timeFull } from '$lib/utils/format';

	const NOTE_LIMIT = 80;
	const mediaUrlPattern = /https?:\/\/\S+\.(?:apng|avif|gif|jpe?g|png|webp)(?:[?#]\S*)?/i;
	const hashtagPattern = /(?:^|\s)#([\p{L}\p{N}_-]{2,60})/gu;

	const me = $derived(identity.current);
	const pubkey = $derived(me?.pk ?? '');
	const myProfile = $derived(pubkey ? profiles.get(pubkey) : undefined);
	const displayName = $derived(myProfile?.display_name || myProfile?.name || 'You');
	const npub = $derived(pubkey ? npubEncode(pubkey) : '');
	const lightning = $derived(myProfile?.lud16 || myProfile?.lud06 || '');

	let loading = $state(false);
	let loadedFor = $state('');
	let notes = $state<FeedNote[]>([]);
	let activeTab = $state<'posts' | 'replies' | 'media'>('posts');

	const posts = $derived(notes.filter((note) => !note.replyTo));
	const replies = $derived(notes.filter((note) => !!note.replyTo));
	const media = $derived(notes.filter((note) => mediaUrlPattern.test(note.content)));
	const visibleNotes = $derived(
		activeTab === 'posts' ? posts : activeTab === 'replies' ? replies : media
	);
	const normalizedWebsite = $derived(
		myProfile?.website
			? myProfile.website.startsWith('http')
				? myProfile.website
				: `https://${myProfile.website}`
			: ''
	);
	const highlights = $derived(buildHighlights(notes));

	function toFeedNote(ev: {
		id: string;
		pubkey: string;
		content: string;
		created_at: number;
		tags: string[][];
	}): FeedNote {
		const replyTag = ev.tags.find((tag) => tag[0] === 'e' && tag[3] === 'reply');
		return {
			id: ev.id,
			pubkey: ev.pubkey,
			content: ev.content,
			createdAt: ev.created_at,
			tags: ev.tags,
			replyTo: replyTag?.[1],
			reactions: [],
			repostCount: 0,
			zapCount: 0,
			zapTotalSats: 0
		};
	}

	function buildHighlights(items: FeedNote[]) {
		const counts: Record<string, number> = {};
		for (const item of items) {
			for (const match of item.content.matchAll(hashtagPattern)) {
				const tag = match[1].toLowerCase();
				counts[tag] = (counts[tag] ?? 0) + 1;
			}
			for (const tag of item.tags) {
				if (tag[0] !== 't' || !tag[1]) continue;
				const value = tag[1].toLowerCase();
				counts[value] = (counts[value] ?? 0) + 1;
			}
		}
		return Object.entries(counts)
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
			.slice(0, 6)
			.map(([tag, count]) => ({ tag, count }));
	}

	async function loadMyProfile(nextPubkey: string) {
		if (!nextPubkey || loadedFor === nextPubkey) return;
		loading = true;
		loadedFor = nextPubkey;
		profiles.ensure([nextPubkey]);
		try {
			const events = await queryOnce([
				{ kinds: [NOSTR_KINDS.METADATA], authors: [nextPubkey], limit: 1 },
				{ kinds: [NOSTR_KINDS.TEXT_NOTE], authors: [nextPubkey], limit: NOTE_LIMIT }
			]);
			const nextNotes = events
				.filter((event) => event.kind === NOSTR_KINDS.TEXT_NOTE)
				.sort((a, b) => b.created_at - a.created_at)
				.map(toFeedNote);
			const noteIds = nextNotes.map((note) => note.id);
			const activity = noteIds.length
				? await queryOnce([
						{ kinds: [NOSTR_KINDS.REACTION, NOSTR_KINDS.ZAP], '#e': noteIds, limit: 500 }
					])
				: [];
			notes = applyActivityToNotes(nextNotes, activity, me?.pk);
		} catch (e) {
			toasts.error((e as Error).message || 'Could not load profile');
		} finally {
			loading = false;
		}
	}

	function updateNote(next: FeedNote) {
		notes = notes.map((note) => (note.id === next.id ? next : note));
	}

	onMount(() => {
		if (pubkey) void loadMyProfile(pubkey);
	});

	$effect(() => {
		if (pubkey) void loadMyProfile(pubkey);
	});
</script>

<svelte:head><title>Profile · BitOS</title></svelte:head>

<div class="h-full overflow-y-auto">
	<div class="relative h-[180px] overflow-hidden bg-primary-500 sm:h-[200px]">
		{#if myProfile?.banner}
			<img src={myProfile.banner} class="absolute inset-0 size-full object-cover" alt="" />
		{:else}
			<div
				class="absolute inset-0 bg-[radial-gradient(circle_at_top_left,var(--color-primary-400),transparent_38%),linear-gradient(115deg,var(--ui-color-primary-500)_0%,var(--color-accent-500)_52%,var(--color-warm-400)_100%)]"
			></div>
		{/if}
		<div class="absolute inset-0 bg-black/15"></div>
		<a
			href="/settings"
			class="absolute top-4 right-4 flex items-center gap-1.5 rounded-lg bg-black/30 px-3 py-1.5 text-[12px] font-semibold text-white backdrop-blur transition hover:bg-black/50"
		>
			<Icon name="i-lucide-camera" class="size-3.5" /> Edit cover
		</a>
	</div>

	<div class="mx-auto max-w-[900px] px-6">
		<div
			class="relative -mt-12 mb-5 flex flex-col items-center gap-4 text-center sm:-mt-16 sm:flex-row sm:items-end sm:text-left"
		>
			<StoryRing {pubkey} rounded="mask-squircle">
				<Avatar
					{pubkey}
					name={displayName}
					picture={myProfile?.picture}
					size={96}
					class="mask-squircle shadow-xl ring-4 ring-[var(--ui-bg)]"
				/>
			</StoryRing>
			<div class="min-w-0 flex-1 pb-4">
				<div class="flex min-w-0 items-center justify-center gap-2 sm:justify-start">
					<h1
						class="truncate font-display text-[28px] leading-tight font-extrabold tracking-tight sm:text-[30px]"
					>
						{displayName}
					</h1>
					{#if myProfile?.nip05}
						<Icon name="i-lucide-badge-check" class="size-5 shrink-0 text-primary-500" />
					{/if}
				</div>
				<p class="mt-1 truncate font-mono text-[13px] text-[var(--ui-text-muted)]">
					{shortKey(npub, 10, 8)}
				</p>
				<div class="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[13px] sm:justify-start">
					<span
						><strong class="font-bold">{posts.length}</strong>
						<span class="text-[var(--ui-text-muted)]">posts</span></span
					>
					<span
						><strong class="font-bold">{replies.length}</strong>
						<span class="text-[var(--ui-text-muted)]">replies</span></span
					>
					<span
						><strong class="font-bold">{media.length}</strong>
						<span class="text-[var(--ui-text-muted)]">media</span></span
					>
				</div>
			</div>
			<div class="flex w-full flex-wrap justify-center gap-2 pb-2 sm:w-auto sm:justify-end">
				<a
					href="/settings"
					class="rounded-full bg-primary-500 px-5 py-2.5 text-[13px] font-bold text-white shadow-[var(--glow-primary)] transition hover:bg-primary-600"
					>Edit profile</a
				>
				<ProfileActionMenu {pubkey} {npub} {lightning} />
			</div>
		</div>

		<div class="post-card mb-5 p-4">
			<p class="text-[14px] leading-relaxed">
				{myProfile?.about || 'No profile bio published yet.'}
			</p>
			<div class="mt-3 flex flex-wrap gap-4 text-[12px] text-[var(--ui-text-muted)]">
				{#if myProfile?.website}
					<a
						href={normalizedWebsite}
						target="_blank"
						rel="noreferrer"
						class="flex items-center gap-1.5 hover:text-primary-500"
					>
						<Icon name="i-lucide-link" class="size-3.5 text-primary-500" />
						{myProfile.website}
					</a>
				{/if}
				{#if myProfile?.nip05}
					<span class="flex items-center gap-1.5">
						<Icon name="i-lucide-badge-check" class="size-3.5 text-primary-500" />
						{myProfile.nip05}
					</span>
				{/if}
				{#if myProfile?.lud16 || myProfile?.lud06}
					<span class="flex items-center gap-1.5">
						<Icon name="i-lucide-zap" class="size-3.5 text-primary-500" />
						{myProfile.lud16 || myProfile.lud06}
					</span>
				{/if}
				{#if notes[0]}
					<span class="flex items-center gap-1.5">
						<Icon name="i-lucide-clock" class="size-3.5 text-primary-500" />
						Latest note {timeFull(notes[0].createdAt)}
					</span>
				{/if}
			</div>
		</div>

		<div class="mb-5">
			<h3 class="mb-3 font-display text-[16px] font-extrabold">Highlights</h3>
			<div
				class="flex [scrollbar-width:none] gap-3 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden"
			>
				{#if highlights.length}
					{#each highlights as h (h.tag)}
						<button
							type="button"
							onclick={() => toasts.info(`#${h.tag}`)}
							class="flex shrink-0 cursor-pointer flex-col items-center gap-1.5"
						>
							<div class="grid size-16 place-items-center rounded-2xl bg-primary-500 text-white">
								<Icon name="i-lucide-hash" class="size-6" />
							</div>
							<span class="max-w-20 truncate text-[11px] font-medium text-[var(--ui-text-muted)]"
								>#{h.tag}</span
							>
						</button>
					{/each}
				{:else}
					<div class="flex shrink-0 flex-col items-center gap-1.5">
						<div
							class="grid size-16 place-items-center rounded-2xl border-2 border-dashed border-[var(--ui-border-accented)] bg-[var(--ui-bg-muted)] text-[var(--ui-text-dimmed)]"
						>
							<Icon name="i-lucide-sparkles" />
						</div>
						<span class="text-[11px] font-medium text-[var(--ui-text-muted)]">Quiet</span>
					</div>
				{/if}
			</div>
		</div>

		<div class="mb-5 border-b border-[var(--ui-border-muted)]">
			<div class="flex gap-1">
				{#each ['posts', 'replies', 'media'] as tab (tab)}
					<button
						type="button"
						onclick={() => (activeTab = tab as 'posts' | 'replies' | 'media')}
						class="border-b-2 px-4 py-3 text-[13px] font-bold capitalize transition {activeTab ===
						tab
							? 'border-primary-500 text-[var(--ui-text)]'
							: 'border-transparent text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
					>
						{tab}
					</button>
				{/each}
			</div>
		</div>

		{#if !me}
			<div class="post-card py-16 text-center">
				<p class="text-[15px] font-semibold">No identity loaded</p>
				<p class="mt-1 text-[13px] text-[var(--ui-text-muted)]">
					Create or import a key to view your profile.
				</p>
			</div>
		{:else if loading}
			<div class="flex flex-col items-center gap-3 py-16 text-center">
				<div
					class="size-7 animate-spin rounded-full border-2 border-[var(--ui-border)] border-t-primary-500"
				></div>
				<p class="text-[13px] text-[var(--ui-text-muted)]">Loading profile from relays...</p>
			</div>
		{:else if visibleNotes.length}
			<div class="space-y-5 pb-8">
				{#each visibleNotes as note, i (note.id)}
					<PostCard {note} index={i} onNoteChange={updateNote} />
				{/each}
			</div>
		{:else}
			<div class="post-card py-16 text-center">
				<p class="text-[15px] font-semibold">No {activeTab} found</p>
				<p class="mt-1 text-[13px] text-[var(--ui-text-muted)]">
					Your configured relays did not return matching notes.
				</p>
			</div>
		{/if}
	</div>
</div>
