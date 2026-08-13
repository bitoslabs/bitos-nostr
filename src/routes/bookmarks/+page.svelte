<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import PostCard from '$lib/components/feed/PostCard.svelte';
	import { bookmarks } from '$lib/stores/bookmarks.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import type { FeedNote } from '$lib/nostr/types';

	const validItems = $derived(
		bookmarks.items.filter((item) => /^[0-9a-fA-F]{64}$/.test(item.note.pubkey))
	);
	const unavailableItems = $derived(
		bookmarks.items.filter((item) => !/^[0-9a-fA-F]{64}$/.test(item.note.pubkey))
	);

	function updateNote(next: FeedNote) {
		bookmarks.save(next);
	}

	$effect(() => {
		if (validItems.length) profiles.ensure(validItems.map((item) => item.note.pubkey));
	});
</script>

<svelte:head><title>Bookmarks · BitOS</title></svelte:head>

<div class="h-full overflow-y-auto">
	<div class="page-container page-container--feed py-6">
		<div class="mb-5 flex items-center justify-between">
			<div>
				<h1 class="font-display text-[32px] leading-none font-extrabold tracking-tight">
					Bookmarks
				</h1>
				<p class="mt-1.5 text-[12px] text-[var(--ui-text-muted)]">Notes you saved for later</p>
			</div>
			<div
				class="grid size-10 place-items-center rounded-xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] text-primary-500"
			>
				<Icon name="i-lucide-bookmark-check" class="size-5" />
			</div>
		</div>

		{#if bookmarks.items.length}
			<div class="space-y-5 pb-8">
				{#each validItems as item, i (item.id)}
					<PostCard note={item.note} index={i} onNoteChange={updateNote} />
				{/each}

				{#each unavailableItems as item (item.id)}
					<div class="post-card p-4">
						<div class="flex items-start gap-3">
							<div
								class="grid size-11 shrink-0 place-items-center rounded-full bg-[var(--ui-bg-muted)] text-[var(--ui-text-dimmed)]"
							>
								<Icon name="i-lucide-bookmark" class="size-5" />
							</div>
							<div class="min-w-0 flex-1">
								<p class="text-[14px] font-bold">Saved note unavailable</p>
								<p class="mt-1 text-[13px] leading-relaxed text-[var(--ui-text-muted)]">
									This old bookmark only saved the note ID. Save the note again from the feed to
									keep a full preview here.
								</p>
								<p class="mt-2 truncate font-mono text-[11px] text-[var(--ui-text-dimmed)]">
									{item.id}
								</p>
							</div>
							<button
								type="button"
								onclick={() => bookmarks.remove(item.id)}
								class="grid size-9 shrink-0 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--tone-error-text)]"
								aria-label="Remove bookmark"
							>
								<Icon name="i-lucide-x" class="size-4" />
							</button>
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<div class="post-card py-16 text-center">
				<div
					class="mx-auto grid size-14 place-items-center rounded-2xl bg-primary-500/10 text-primary-500"
				>
					<Icon name="i-lucide-bookmark" class="size-7" />
				</div>
				<p class="mt-4 text-[15px] font-semibold">No bookmarks yet</p>
				<p class="mt-1 text-[13px] text-[var(--ui-text-muted)]">
					Tap the bookmark button on any note to save it here.
				</p>
			</div>
		{/if}
	</div>
</div>
