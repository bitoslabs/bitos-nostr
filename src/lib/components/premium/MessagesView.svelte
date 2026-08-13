<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import HexAvatar from '$lib/components/ui/HexAvatar.svelte';
	import LivePill from '$lib/components/ui/LivePill.svelte';
	import ConversationItem from '$lib/components/feed/ConversationItem.svelte';
	import ChatBubble from '$lib/components/feed/ChatBubble.svelte';
	import { conversations, chatMessages, account } from '$lib/components/premium/data';

	/**
	 * Messages view: a two-pane layout (conversation list + chat). The left pane
	 * lists conversations; the right pane shows the selected thread with an
	 * E2E-encrypted banner, bubbles, and a composer row.
	 */
	let activeId = $state(conversations[0]?.id ?? '');
	const active = $derived(conversations.find((c) => c.id === activeId));
	let draft = $state('');
	let thread = $state([...chatMessages]);

	function send() {
		const text = draft.trim();
		if (!text) return;
		thread = [...thread, { id: 'm' + Math.random().toString(36).slice(2, 6), mine: true, text }];
		draft = '';
	}
</script>

<!-- Header -->
<header
	class="sticky top-0 z-30 border-b border-[var(--ui-border-muted)] bg-[color-mix(in_oklab,var(--ui-bg)_75%,transparent)] p-3.5 px-4 backdrop-blur-xl"
>
	<div class="flex items-center justify-between">
		<h1 class="m-0 text-xl font-bold tracking-tight">Messages</h1>
		<div class="flex items-center gap-2">
			<LivePill label="NIP-44 E2E" tone="success" icon />
			<button type="button" class="icon-btn size-9" aria-label="New message">
				<Icon name="i-lucide-square-pen" class="size-4" />
			</button>
		</div>
	</div>
</header>

<div class="grid min-h-[calc(100vh-70px)] grid-cols-[280px_1fr] max-[900px]:grid-cols-1">
	<!-- Conversation list -->
	<div class="border-r border-[var(--ui-border-muted)] max-[900px]:hidden">
		{#each conversations as c (c.id)}
			<ConversationItem conversation={c} active={c.id === activeId} onClick={(x) => (activeId = x.id)} />
		{/each}
	</div>

	<!-- Chat panel -->
	{#if active}
		<div class="flex flex-col">
			<div class="flex items-center gap-3 border-b border-[var(--ui-border-muted)] p-3 px-4">
				<HexAvatar name={active.name} picture={active.picture} pubkey={active.npub} verified={active.verified} size={36} />
				<div class="flex-1">
					<div class="text-sm font-semibold">{active.name}</div>
					<div class="font-mono text-[11px] text-[var(--ui-text-muted)]">{active.npub} · last seen 2m ago</div>
				</div>
				<button type="button" class="icon-btn size-9" aria-label="Zap"><Icon name="i-lucide-zap" class="size-4" /></button>
				<button type="button" class="icon-btn size-9" aria-label="Info"><Icon name="i-lucide-info" class="size-4" /></button>
			</div>

			<div class="chat-canvas flex flex-1 flex-col gap-3 overflow-y-auto p-4">
				<div class="mb-2 text-center">
					<LivePill label="Messages are end-to-end encrypted · NIP-44" tone="success" icon />
				</div>
				{#each thread as m (m.id)}
					<ChatBubble text={m.text} mine={m.mine} />
					{#if m.text.includes('1000 sats')}
						<div class="py-1.5 text-center font-mono text-[11px] text-[var(--ui-text-muted)]">⚡ 1,000 sats received · just now</div>
					{/if}
				{/each}
			</div>

			<div class="flex items-center gap-2.5 border-t border-[var(--ui-border-muted)] p-3.5 px-4">
				<button type="button" class="icon-btn size-9" aria-label="Attach"><Icon name="i-lucide-paperclip" class="size-4" /></button>
				<input
					bind:value={draft}
					onkeydown={(e) => e.key === 'Enter' && send()}
					type="text"
					placeholder="Encrypted message…"
					class="flex-1 rounded-full border border-[var(--ui-border-muted)] bg-[var(--interactive-hover-bg)] py-2.5 px-4 text-sm text-[var(--ui-text)] outline-none focus:border-[var(--ui-color-primary-500)]"
				/>
				<button type="button" onclick={send} class="glow-accent rounded-full bg-[var(--ui-color-primary-500)] px-4 py-2.5 text-sm font-semibold text-[var(--ui-text-inverted)] transition-all hover:-translate-y-0.5">Send</button>
			</div>
		</div>
	{:else}
		<div class="grid flex-1 place-items-center text-[var(--ui-text-muted)]"><Icon name="i-lucide-message-circle" class="size-8" /></div>
	{/if}
</div>
