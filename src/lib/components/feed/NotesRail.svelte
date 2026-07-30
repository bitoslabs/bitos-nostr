<script lang="ts">
	/**
	 * Messenger / Instagram-style "Notes" rail — rounded pills showing each
	 * contact's latest short status (their newest text story). Shares the same
	 * kind 30315 data as the Stories bar above.
	 */
	import Icon from '$lib/components/ui/Icon.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { stories, type StoryAuthor } from '$lib/nostr/stories.svelte';
	import StoryViewer from './StoryViewer.svelte';

	const me = $derived(identity.current);

	// One pill per author (their newest slide), excluding self, that has text.
	const noteAuthors = $derived(
		stories.authors.filter(
			(a) => a.pubkey !== me?.pk?.toLowerCase() && a.slides.some((s) => s.content.trim())
		)
	);

	let viewing = $state<StoryAuthor | null>(null);

	function preview(author: StoryAuthor): string {
		const withText = author.slides.find((s) => s.content.trim());
		return withText?.content.trim() ?? '';
	}

	function nameFor(pubkey: string) {
		const p = profiles.get(pubkey);
		return p?.display_name || p?.name || pubkey.slice(0, 8);
	}
</script>

{#if noteAuthors.length}
	<div class="mb-4 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-3 py-2.5">
		<div
			class="mb-2 flex items-center justify-between gap-3 text-[11px] font-bold tracking-wide text-[var(--ui-text-muted)] uppercase"
		>
			<span class="flex items-center gap-1.5">
				<Icon name="i-lucide-sticky-note" class="size-3.5 text-accent-500" />
				Notes
			</span>
			<span class="text-[10px] tracking-normal text-[var(--ui-text-dimmed)]">
				{noteAuthors.length}
			</span>
		</div>
		<div class="flex [scrollbar-width:none] gap-2.5 overflow-x-auto pb-0.5 [&::-webkit-scrollbar]:hidden">
			{#each noteAuthors as author (author.pubkey)}
				{@const name = nameFor(author.pubkey)}
				{@const profile = profiles.get(author.pubkey)}
				{@const note = preview(author)}
				<button
					type="button"
					onclick={() => (viewing = author)}
					class="group relative flex min-w-[170px] max-w-[220px] shrink-0 items-center gap-2.5 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-2.5 py-2 text-left transition hover:border-primary-500/35 hover:bg-primary-500/5 {author.hasUnseen
						? 'border-primary-500/25 bg-primary-500/10'
						: ''}"
				>
					<div
						class="shrink-0 rounded-full p-[2px] {author.hasUnseen
							? 'bg-gradient-to-tr from-primary-500 via-accent-500 to-warm-500'
							: 'bg-transparent'}"
					>
						<Avatar
							pubkey={author.pubkey}
							{name}
							picture={profile?.picture}
							size={34}
							class="ring-2 ring-[var(--ui-bg-muted)]"
						/>
					</div>
					<div class="min-w-0 flex-1 leading-tight">
						<span class="block truncate text-[12px] font-bold text-[var(--ui-text)]">{name}</span>
						<span class="mt-0.5 line-clamp-2 text-[11px] leading-snug text-[var(--ui-text-muted)]">
							{note}
						</span>
					</div>
					{#if author.hasUnseen}
						<span class="absolute top-2 right-2 size-1.5 rounded-full bg-accent-500"></span>
					{/if}
				</button>
			{/each}
		</div>
	</div>
{/if}

{#if viewing}
	<StoryViewer author={viewing} onclose={() => (viewing = null)} />
{/if}
