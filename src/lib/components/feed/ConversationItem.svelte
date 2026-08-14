<script lang="ts">
	import HexAvatar from '$lib/components/ui/HexAvatar.svelte';
	import { cn } from '$lib/utils/cn';
	import type { Conversation } from '$lib/components/premium/data';

	/** A conversation list row (left pane of Messages). */
	let {
		conversation,
		active = false,
		onClick
	}: { conversation: Conversation; active?: boolean; onClick?: (c: Conversation) => void } = $props();
</script>

<button
	type="button"
	onclick={() => onClick?.(conversation)}
	class={cn(
		'flex w-full gap-3 border-b border-[var(--ui-border-muted)] p-3 px-4 text-left transition-all',
		active
			? 'border-l-2 pl-[13px] border-l-[var(--ui-color-primary-500)] bg-[color-mix(in_oklab,var(--ui-color-primary-500)_10%,transparent)]'
			: 'hover:bg-[var(--interactive-hover-bg)]'
	)}
>
	<HexAvatar
		name={conversation.name}
		picture={conversation.picture}
		pubkey={conversation.npub}
		verified={conversation.verified}
		size={40}
	/>
	<div class="min-w-0 flex-1">
		<div class="flex items-center justify-between">
			<span class="truncate text-sm font-semibold">{conversation.name}</span>
			<span class="ml-1.5 shrink-0 text-[11px] text-[var(--ui-text-muted)]">{conversation.time}</span>
		</div>
		<div class={cn('mt-0.5 truncate text-xs', conversation.unread ? 'text-[var(--ui-text)]' : 'text-[var(--ui-text-muted)]')}>
			{conversation.last}
		</div>
	</div>
	{#if conversation.unread}
		<span class="self-center shrink-0 rounded-full bg-[var(--ui-color-primary-500)] px-1.5 py-0.5 font-mono text-[10px] font-bold text-black">
			{conversation.unread}
		</span>
	{/if}
</button>
