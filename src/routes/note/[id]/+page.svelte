<script lang="ts">
	import { page } from '$app/state';
	import { decode } from 'nostr-tools/nip19';
	import Icon from '$lib/components/ui/Icon.svelte';
	import PostCard from '$lib/components/feed/PostCard.svelte';
	import { feed } from '$lib/nostr/feed.svelte';
	import { queryPrimaryFirst } from '$lib/nostr/pool';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { NOSTR_KINDS, type FeedNote } from '$lib/nostr/types';
	import { toFeedNote } from '$lib/nostr/feed-note';
	import { applyActivityToNotes } from '$lib/nostr/zaps';
	import { identity } from '$lib/nostr/identity.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { shortKey } from '$lib/utils/format';

	let loading = $state(true);
	let note = $state<FeedNote | null>(null);
	let loadedFor = $state('');

	const noteId = $derived(resolveNoteId(page.params.id));
	const noteSource = $derived(page.url.searchParams.get('from'));
	const requestedReturnTo = $derived(page.url.searchParams.get('returnTo'));
	const safeReturnTo = $derived(
		requestedReturnTo?.startsWith('/') && !requestedReturnTo.startsWith('//')
			? requestedReturnTo
			: ''
	);
	const backHref = $derived(
		safeReturnTo ||
			(noteSource === 'reels'
				? '/reels'
				: noteSource === 'discover'
					? '/discover'
					: '/notifications')
	);
	const backLabel = $derived(
		safeReturnTo
			? safeReturnTo.startsWith('/profile')
				? 'Profile'
				: safeReturnTo.startsWith('/notifications')
					? 'Notifications'
					: 'Back'
			: noteSource === 'reels'
				? 'Reels'
				: noteSource === 'discover'
					? 'Discover'
					: 'Notifications'
	);

	function resolveNoteId(value: string | undefined) {
		if (!value) return '';
		if (/^[0-9a-f]{64}$/i.test(value)) return value.toLowerCase();
		if (value.startsWith('note1') || value.startsWith('nevent1')) {
			try {
				const decoded = decode(value);
				if (decoded.type === 'note') return decoded.data as string;
				if (decoded.type === 'nevent') return (decoded.data as { id: string }).id;
			} catch {
				return '';
			}
		}
		return '';
	}

	async function loadNote(id: string) {
		if (!id || loadedFor === id) return;
		loading = true;
		loadedFor = id;
		try {
			const currentLoad = id;
			const applyNoteEvent = async (
				event?: Awaited<ReturnType<typeof queryPrimaryFirst>>[number]
			) => {
				if (!event) {
					note = null;
					return;
				}
				profiles.ensure([event.pubkey]);
				const [hydrated] = applyActivityToNotes(
					[toFeedNote(event)],
					await queryPrimaryFirst(
						[{ kinds: [NOSTR_KINDS.REACTION, NOSTR_KINDS.ZAP], '#e': [id], limit: 500 }],
						{
							onSecondary: (mergedActivity) => {
								if (loadedFor !== currentLoad) return;
								const [nextHydrated] = applyActivityToNotes(
									[toFeedNote(event)],
									mergedActivity,
									identity.current?.pk
								);
								note = nextHydrated;
								feed.upsertNote(nextHydrated);
							}
						}
					),
					identity.current?.pk
				);
				note = hydrated;
				feed.upsertNote(hydrated);
			};
			const [event] = await queryPrimaryFirst([{ ids: [id], limit: 1 }], {
				onSecondary: (mergedEvents) => {
					if (loadedFor !== currentLoad) return;
					void applyNoteEvent(mergedEvents[0]);
				}
			});
			if (loadedFor !== currentLoad) return;
			if (!event) {
				note = null;
				return;
			}
			await applyNoteEvent(event);
			await loadReplies(id);
		} catch (e) {
			toasts.error((e as Error).message || 'Could not load note');
		} finally {
			loading = false;
		}
	}

	async function loadReplies(id: string) {
		const applyReplies = async (events: Awaited<ReturnType<typeof queryPrimaryFirst>>) => {
			const replyEvents = events.map(toFeedNote).filter((item) => item.replyTo === id);
			if (!replyEvents.length) return;
			const replyIds = replyEvents.map((reply) => reply.id);
			const hydratedReplies = applyActivityToNotes(
				replyEvents,
				await queryPrimaryFirst([
					{ kinds: [NOSTR_KINDS.REACTION, NOSTR_KINDS.ZAP], '#e': replyIds, limit: 500 }
				]),
				identity.current?.pk
			);
			profiles.ensure(hydratedReplies.map((reply) => reply.pubkey));
			for (const reply of hydratedReplies) feed.upsertNote(reply);
		};
		const events = await queryPrimaryFirst(
			[{ kinds: [NOSTR_KINDS.TEXT_NOTE], '#e': [id], limit: 200 }],
			{
				onSecondary: (mergedEvents) => {
					void applyReplies(mergedEvents);
				}
			}
		);
		await applyReplies(events);
	}

	$effect(() => {
		if (noteId) void loadNote(noteId);
	});
</script>

<svelte:head><title>Note · BitOS</title></svelte:head>

<div class="h-full overflow-y-auto">
	<div class="mx-auto max-w-[640px] px-5 py-6">
		<header class="mb-5">
			<a
				href={backHref}
				class="mb-4 inline-flex items-center gap-2 text-[13px] font-bold text-[var(--ui-text-muted)] transition hover:text-primary-500"
			>
				<Icon name="i-lucide-arrow-left" class="size-4" />
				{backLabel}
			</a>
			<h1 class="font-display text-[30px] leading-none font-extrabold tracking-tight">Note</h1>
			{#if noteId}
				<p class="mt-1.5 font-mono text-[12px] text-[var(--ui-text-muted)]">
					{shortKey(noteId, 10, 8)}
				</p>
			{/if}
		</header>

		{#if !noteId}
			<div class="post-card py-16 text-center">
				<p class="text-[15px] font-semibold">Invalid note</p>
				<p class="mt-1 text-[13px] text-[var(--ui-text-muted)]">
					This note id could not be decoded.
				</p>
			</div>
		{:else if loading}
			<div class="flex flex-col items-center gap-3 py-20 text-center">
				<div
					class="size-7 animate-spin rounded-full border-2 border-[var(--ui-border)] border-t-primary-500"
				></div>
				<p class="text-[13px] text-[var(--ui-text-muted)]">Loading note from relays...</p>
			</div>
		{:else if note}
			<PostCard {note} onNoteChange={(next) => (note = next)} />
		{:else}
			<div class="post-card py-16 text-center">
				<p class="text-[15px] font-semibold">Note not found</p>
				<p class="mt-1 text-[13px] text-[var(--ui-text-muted)]">
					Your relays did not return this event.
				</p>
			</div>
		{/if}
	</div>
</div>
