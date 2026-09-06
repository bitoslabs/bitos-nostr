<script lang="ts">
	import Icon from './Icon.svelte';
	import { recentHashtags } from '$lib/stores/recent-hashtags.svelte';

	let {
		/** Insert the picked tag into the host input at the cursor. */
		onpick,
		/** Current input text — tags already typed there are hidden. */
		activeText = '',
		max = 6,
		class: className = ''
	}: {
		onpick: (tag: string) => void;
		activeText?: string;
		max?: number;
		class?: string;
	} = $props();

	// Same hashtag charset the post parser uses, so hidden == already tagged.
	const usedTags = $derived(
		new Set(
			[...activeText.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]{2,60})/gu)].map((match) =>
				match[1]!.toLowerCase()
			)
		)
	);
	const visibleTags = $derived(
		recentHashtags.tags.filter((tag) => !usedTags.has(tag)).slice(0, max)
	);

	/**
	 * Insert on pointerdown with focus kept in the textarea — clicking a chip
	 * must not collapse the composer or lose the cursor position. The click
	 * handler only answers keyboard activation (detail 0), so a mouse press
	 * never inserts twice.
	 */
	function pick(tag: string, event: Event) {
		event.preventDefault();
		onpick(tag);
	}
</script>

{#if visibleTags.length}
	<div
		class="flex flex-wrap items-center gap-1.5 {className}"
		role="group"
		aria-label="Recent hashtags — click to reuse"
	>
		<span
			class="flex items-center gap-1 text-[10px] font-bold tracking-wide text-[var(--ui-text-dimmed)] uppercase"
		>
			<Icon name="i-lucide-history" class="size-3.5" />
			Recent
		</span>
		{#each visibleTags as tag (tag)}
			<span
				class="group flex items-center overflow-hidden rounded-full border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] transition"
			>
				<button
					type="button"
					onpointerdown={(event) => pick(tag, event)}
					onclick={(event) => event.detail === 0 && pick(tag, event)}
					class="py-1 pl-2.5 text-[11px] font-bold text-[var(--ui-text-muted)] transition hover:text-primary-600 focus-visible:text-primary-600 focus-visible:outline-none"
				>
					<span class="text-primary-500">#</span>{tag}
				</button>
				<button
					type="button"
					onclick={() => recentHashtags.remove(tag)}
					aria-label="Forget #{tag}"
					title="Forget #{tag}"
					class="grid size-5 place-items-center text-[var(--ui-text-dimmed)] opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100 hover:text-[var(--ui-text)] focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
				>
					<Icon name="i-lucide-x" class="size-3" />
				</button>
			</span>
		{/each}
		<button
			type="button"
			onclick={() => recentHashtags.clear()}
			aria-label="Clear recent hashtags"
			title="Clear recent hashtags"
			class="grid size-5 place-items-center rounded-full text-[var(--ui-text-dimmed)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]"
		>
			<Icon name="i-lucide-eraser" class="size-3.5" />
		</button>
	</div>
{/if}
