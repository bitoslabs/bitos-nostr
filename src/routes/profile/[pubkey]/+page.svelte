<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { decode, npubEncode } from 'nostr-tools/nip19';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import PostCard from '$lib/components/feed/PostCard.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { queryOnce } from '$lib/nostr/pool';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { NOSTR_KINDS, type FeedNote } from '$lib/nostr/types';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { shortKey, timeFull } from '$lib/utils/format';

	const NOTE_LIMIT = 60;
	const mediaUrlPattern = /https?:\/\/\S+\.(?:apng|avif|gif|jpe?g|png|webp)(?:[?#]\S*)?/i;
	const hashtagPattern = /(?:^|\s)#([\p{L}\p{N}_-]{2,60})/gu;

	const pubkey = $derived(resolvePubkey(page.params.pubkey));
	const profile = $derived(pubkey ? profiles.get(pubkey) : undefined);
	const displayName = $derived(
		profile?.display_name || profile?.name || (pubkey ? shortKey(pubkey) : 'Profile')
	);
	const npub = $derived(pubkey ? npubEncode(pubkey) : '');
	const isMe = $derived(!!pubkey && identity.current?.pk === pubkey);

	let loading = $state(true);
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
		profile?.website
			? profile.website.startsWith('http')
				? profile.website
				: `https://${profile.website}`
			: ''
	);
	const highlights = $derived(buildHighlights(notes));

	function resolvePubkey(value: string | undefined) {
		if (!value) return '';
		if (/^[0-9a-f]{64}$/i.test(value)) return value.toLowerCase();
		if (value.startsWith('npub1')) {
			try {
				const decoded = decode(value);
				if (decoded.type === 'npub') return decoded.data as string;
			} catch {
				return '';
			}
		}
		return '';
	}

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
			repostCount: 0
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

	async function loadProfile(nextPubkey: string) {
		if (!nextPubkey || loadedFor === nextPubkey) return;
		loading = true;
		loadedFor = nextPubkey;
		profiles.ensure([nextPubkey]);
		try {
			const events = await queryOnce([
				{ kinds: [NOSTR_KINDS.METADATA], authors: [nextPubkey], limit: 1 },
				{ kinds: [NOSTR_KINDS.TEXT_NOTE], authors: [nextPubkey], limit: NOTE_LIMIT }
			]);
			const noteEvents = events
				.filter((event) => event.kind === NOSTR_KINDS.TEXT_NOTE)
				.sort((a, b) => b.created_at - a.created_at);
			notes = noteEvents.map(toFeedNote);
		} catch (e) {
			toasts.error((e as Error).message || 'Could not load profile');
		} finally {
			loading = false;
		}
	}

	async function copyProfile() {
		try {
			await navigator.clipboard.writeText(`nostr:${npub}`);
			toasts.success('Profile link copied');
		} catch {
			toasts.error('Could not copy profile link');
		}
	}

	onMount(() => {
		if (pubkey) void loadProfile(pubkey);
	});

	$effect(() => {
		if (pubkey) void loadProfile(pubkey);
	});
</script>

<svelte:head><title>{displayName} · BitOS</title></svelte:head>

<div class="h-full overflow-y-auto">
	<div class="relative h-[180px] bg-primary-500 sm:h-[200px]">
		{#if profile?.banner}
			<img src={profile.banner} class="absolute inset-0 size-full object-cover" alt="" />
		{:else}
			<div
				class="absolute inset-0 bg-[linear-gradient(135deg,var(--ui-color-primary-500),var(--color-accent-500))]"
			></div>
		{/if}
		<div class="absolute inset-0 bg-black/15"></div>
		{#if isMe}
			<a
				href="/settings"
				class="absolute top-4 right-4 flex items-center gap-1.5 rounded-lg bg-black/30 px-3 py-1.5 text-[12px] font-semibold text-white backdrop-blur transition hover:bg-black/50"
			>
				<Icon name="i-lucide-camera" class="size-3.5" /> Edit cover
			</a>
		{/if}
	</div>

	<div class="mx-auto max-w-[900px] px-6">
		<div class="relative -mt-16 mb-5 flex flex-col gap-4 sm:flex-row sm:items-end">
			<Avatar
				{pubkey}
				name={displayName}
				picture={profile?.picture}
				size={128}
				class="rounded-3xl shadow-xl ring-4 ring-[var(--ui-bg)]"
			/>
			<div class="min-w-0 flex-1 pb-2">
				<div class="flex min-w-0 items-center gap-2">
					<h1
						class="truncate font-display text-[28px] leading-tight font-extrabold tracking-tight sm:text-[30px]"
					>
						{displayName}
					</h1>
					{#if profile?.nip05}
						<Icon name="i-lucide-badge-check" class="size-5 shrink-0 text-primary-500" />
					{/if}
				</div>
				<p class="mt-1 truncate font-mono text-[13px] text-[var(--ui-text-muted)]">
					{shortKey(npub)}
				</p>
				<div class="mt-2 flex gap-4 text-[13px]">
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
			<div class="flex gap-2 pb-2">
				{#if isMe}
					<a
						href="/settings"
						class="rounded-full bg-primary-500 px-5 py-2.5 text-[13px] font-bold text-white shadow-[var(--glow-primary)] transition hover:bg-primary-600"
						>Edit profile</a
					>
				{:else}
					<a
						href={`/messages?to=${pubkey}`}
						class="rounded-full bg-primary-500 px-5 py-2.5 text-[13px] font-bold text-white shadow-[var(--glow-primary)] transition hover:bg-primary-600"
						>Message</a
					>
				{/if}
				<button
					type="button"
					onclick={copyProfile}
					class="grid size-10 place-items-center rounded-full border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] text-[var(--ui-text-muted)] transition hover:text-primary-500"
					aria-label="Copy profile link"
				>
					<Icon name="i-lucide-share-2" class="size-5" />
				</button>
			</div>
		</div>

		<div class="post-card mb-5 p-4">
			<p class="text-[14px] leading-relaxed text-[var(--ui-text)]">
				{profile?.about || 'No profile bio published yet.'}
			</p>
			<div class="mt-3 flex flex-wrap gap-4 text-[12px] text-[var(--ui-text-muted)]">
				{#if profile?.website}
					<a
						href={normalizedWebsite}
						target="_blank"
						rel="noreferrer"
						class="flex items-center gap-1.5 hover:text-primary-500"
					>
						<Icon name="i-lucide-link" class="size-3.5 text-primary-500" />
						{profile.website}
					</a>
				{/if}
				{#if profile?.nip05}
					<span class="flex items-center gap-1.5">
						<Icon name="i-lucide-badge-check" class="size-3.5 text-primary-500" />
						{profile.nip05}
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
				<button
					type="button"
					onclick={() => (activeTab = 'posts')}
					class="border-b-2 px-4 py-3 text-[13px] font-bold transition {activeTab === 'posts'
						? 'border-primary-500 text-[var(--ui-text)]'
						: 'border-transparent text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
				>
					Posts
				</button>
				<button
					type="button"
					onclick={() => (activeTab = 'replies')}
					class="border-b-2 px-4 py-3 text-[13px] font-bold transition {activeTab === 'replies'
						? 'border-primary-500 text-[var(--ui-text)]'
						: 'border-transparent text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
				>
					Replies
				</button>
				<button
					type="button"
					onclick={() => (activeTab = 'media')}
					class="border-b-2 px-4 py-3 text-[13px] font-bold transition {activeTab === 'media'
						? 'border-primary-500 text-[var(--ui-text)]'
						: 'border-transparent text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
				>
					Media
				</button>
			</div>
		</div>

		{#if !pubkey}
			<div class="post-card py-16 text-center">
				<p class="text-[15px] font-semibold">Invalid profile</p>
				<p class="mt-1 text-[13px] text-[var(--ui-text-muted)]">
					This profile key could not be decoded.
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
					<PostCard {note} index={i} />
				{/each}
			</div>
		{:else}
			<div class="post-card py-16 text-center">
				<p class="text-[15px] font-semibold">No {activeTab} found</p>
				<p class="mt-1 text-[13px] text-[var(--ui-text-muted)]">
					This relay set did not return matching notes.
				</p>
			</div>
		{/if}
	</div>
</div>
