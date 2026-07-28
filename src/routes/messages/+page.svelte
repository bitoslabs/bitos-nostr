<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { decode } from 'nostr-tools/nip19';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import { dms } from '$lib/nostr/dms.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { shortKey, timeAgo } from '$lib/utils/format';

	type ChatRow = {
		id: string;
		name: string;
		preview: string;
		previewPrefix: string;
		time: string;
		unread: number;
	};

	let selected = $state('');
	let draft = $state('');
	let filter = $state<'all' | 'unread'>('all');
	let query = $state('');
	let showNew = $state(false);
	let newPeerInput = $state('');
	let threadEl: HTMLDivElement | undefined = $state();

	const conversations = $derived<ChatRow[]>(
		dms.conversations.map((conversation) => {
			const profile = profiles.get(conversation.peer);
			const name = profile?.display_name || profile?.name || shortKey(conversation.peer);
			return {
				id: conversation.peer,
				name,
				preview: conversation.lastMessage?.content ?? 'No messages yet',
				previewPrefix: conversation.lastMessage?.mine ? 'You:' : '',
				time: conversation.lastMessage ? timeAgo(conversation.lastMessage.createdAt) : '',
				unread: conversation.unread
			};
		})
	);
	const filtered = $derived(
		conversations.filter((conversation) => {
			if (filter === 'unread' && !conversation.unread) return false;
			if (!query) return true;
			const q = query.toLowerCase();
			return (
				conversation.name.toLowerCase().includes(q) ||
				conversation.preview.toLowerCase().includes(q) ||
				conversation.id.toLowerCase().includes(q)
			);
		})
	);
	const active = $derived(conversations.find((conversation) => conversation.id === selected));
	const activeMessages = $derived(
		selected
			? (dms.conversations.find((conversation) => conversation.peer === selected)?.messages ?? [])
			: []
	);
	const unreadTotal = $derived(dms.unreadCount);

	function resolveTo(param: string | null) {
		if (!param) return;
		let peer = param.trim();
		if (peer.startsWith('npub1')) {
			try {
				const decoded = decode(peer);
				if (decoded.type === 'npub') peer = decoded.data as string;
			} catch {
				return;
			}
		}
		if (/^[0-9a-fA-F]{64}$/.test(peer)) {
			peer = peer.toLowerCase();
			dms.forPeer(peer);
			profiles.ensure([peer]);
			selectChat(peer);
		}
	}

	function selectChat(peer: string) {
		selected = peer;
		dms.markRead(peer);
	}

	async function send() {
		const body = draft.trim();
		if (!body || !active) return;
		draft = '';
		try {
			await dms.send(active.id, body);
		} catch (e) {
			toasts.error((e as Error).message);
		}
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			void send();
		}
	}

	function startNew() {
		const input = newPeerInput.trim();
		if (!input) return;
		let peer = input;
		if (peer.startsWith('npub1')) {
			try {
				const decoded = decode(peer);
				if (decoded.type === 'npub') peer = decoded.data as string;
			} catch {
				toasts.error('Invalid npub');
				return;
			}
		}
		if (!/^[0-9a-fA-F]{64}$/.test(peer)) {
			toasts.error('Enter a valid npub or 64-char hex pubkey');
			return;
		}
		peer = peer.toLowerCase();
		if (peer === identity.current?.pk) {
			toasts.warning("You can't message yourself");
			return;
		}
		dms.forPeer(peer);
		profiles.ensure([peer]);
		selectChat(peer);
		showNew = false;
		newPeerInput = '';
	}

	onMount(() => resolveTo(page.url.searchParams.get('to')));
	$effect(() => resolveTo(page.url.searchParams.get('to')));
	$effect(() => {
		void activeMessages.length;
		if (threadEl) threadEl.scrollTop = threadEl.scrollHeight;
	});
</script>

<div class="flex h-full">
	<aside
		class="flex w-full shrink-0 flex-col border-r border-[var(--ui-border-muted)] bg-[var(--surface-bg)] sm:w-[340px] {selected
			? 'hidden sm:flex'
			: 'flex'}"
	>
		<header class="border-b border-[var(--ui-border-muted)] px-5 pt-5 pb-3">
			<div class="mb-4 flex items-center justify-between">
				<div>
					<h1 class="font-display text-[26px] leading-none font-extrabold tracking-tight">
						Messages
					</h1>
					<p
						class="mt-1.5 text-[11px] font-medium tracking-wide text-[var(--ui-text-muted)] uppercase"
					>
						{unreadTotal} unread · {dms.conversations.length} live
					</p>
				</div>
				<button
					type="button"
					onclick={() => (showNew = true)}
					class="grid size-10 place-items-center rounded-xl bg-primary-500 text-white shadow-[var(--glow-primary)] transition-all hover:scale-105 hover:bg-primary-600 active:scale-95"
					aria-label="New chat"
				>
					<Icon name="i-lucide-square-pen" class="size-4" />
				</button>
			</div>
			<Input
				bind:value={query}
				class="w-full"
				icon="i-lucide-search"
				placeholder="Search messages..."
			/>
			<div class="mt-3 flex gap-1">
				{#each [{ k: 'all', l: 'All' }, { k: 'unread', l: 'Unread', n: unreadTotal }] as tab (tab.k)}
					<button
						type="button"
						onclick={() => (filter = tab.k as typeof filter)}
						class="pill-tab flex items-center gap-1 {filter === tab.k ? 'active' : ''}"
					>
						{tab.l}
						{#if tab.n}
							<span class="rounded-full bg-primary-500 px-1.5 py-0.5 text-[10px] text-white">
								{tab.n}
							</span>
						{/if}
					</button>
				{/each}
			</div>
		</header>

		<div class="min-h-0 flex-1 overflow-y-auto">
			{#each filtered as conversation (conversation.id)}
				<button
					type="button"
					onclick={() => selectChat(conversation.id)}
					class="chat-item flex w-full cursor-pointer items-start gap-3 px-4 py-3.5 text-left {selected ===
					conversation.id
						? 'active'
						: ''}"
				>
					<Avatar
						pubkey={conversation.id}
						name={conversation.name}
						picture={profiles.get(conversation.id)?.picture}
						size={48}
						class="rounded-2xl"
					/>
					<div class="min-w-0 flex-1">
						<div class="mb-0.5 flex items-center justify-between">
							<h3 class="truncate text-[14.5px] font-bold">{conversation.name}</h3>
							<span class="ml-2 shrink-0 text-[11px] text-[var(--ui-text-muted)]">
								{conversation.time}
							</span>
						</div>
						<div class="flex items-center justify-between">
							<p class="truncate text-[13px] text-[var(--ui-text-muted)]">
								{#if conversation.previewPrefix}
									<span class="font-semibold text-[var(--ui-text)]"
										>{conversation.previewPrefix}</span
									>
								{/if}
								{conversation.preview}
							</p>
							{#if conversation.unread}
								<span
									class="ml-2 grid size-5 shrink-0 place-items-center rounded-full bg-primary-500 text-[10px] font-bold text-white"
								>
									{conversation.unread}
								</span>
							{/if}
						</div>
					</div>
				</button>
			{/each}
			{#if !filtered.length}
				<p class="px-4 py-10 text-center text-[12.5px] text-[var(--ui-text-dimmed)]">
					No real conversations yet.
				</p>
			{/if}
		</div>
	</aside>

	<section class="chat-canvas {selected ? 'flex' : 'hidden sm:flex'} min-w-0 flex-1 flex-col">
		{#if active}
			<header
				class="flex h-[72px] shrink-0 items-center justify-between border-b border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-5"
			>
				<button
					type="button"
					onclick={() => (selected = '')}
					class="grid size-8 shrink-0 place-items-center rounded-lg text-[var(--ui-text-muted)] hover:bg-[var(--interactive-hover-bg)] sm:hidden"
					aria-label="Back"
				>
					<Icon name="i-lucide-arrow-left" class="size-5" />
				</button>
				<div class="flex min-w-0 items-center gap-3">
					<Avatar
						pubkey={active.id}
						name={active.name}
						picture={profiles.get(active.id)?.picture}
						size={44}
						class="rounded-2xl"
					/>
					<div class="min-w-0">
						<h2 class="flex items-center gap-2 text-[15px] font-bold">
							<span class="truncate">{active.name}</span>
							<span class="font-mono text-[11px] text-[var(--ui-text-dimmed)]">
								{shortKey(active.id, 6, 6)}
							</span>
						</h2>
						<p class="flex items-center gap-1.5 text-[12px] text-[var(--ui-text-muted)]">
							<Icon name="i-lucide-lock" class="size-3.5 text-[var(--tone-success-text)]" />
							Encrypted · NIP-04
						</p>
					</div>
				</div>
			</header>

			<div bind:this={threadEl} class="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
				{#if activeMessages.length}
					{#each activeMessages as msg (msg.id)}
						<div class="flex {msg.mine ? 'justify-end' : 'justify-start'}">
							<div
								class="max-w-[78%] {msg.mine
									? 'bubble-out rounded-br-md'
									: 'bubble-in rounded-bl-md'} px-4 py-2.5 text-[14px] leading-relaxed"
							>
								<p class="break-words whitespace-pre-wrap">{msg.content}</p>
								<div
									class="mt-0.5 text-right text-[10px] {msg.mine
										? 'text-white/60'
										: 'text-[var(--ui-text-dimmed)]'}"
								>
									{new Date(msg.createdAt * 1000).toLocaleTimeString(undefined, {
										hour: '2-digit',
										minute: '2-digit'
									})}
								</div>
							</div>
						</div>
					{/each}
				{:else}
					<div class="flex h-full flex-col items-center justify-center gap-2 text-center">
						<Icon name="i-lucide-message-circle" class="size-8 text-[var(--ui-text-dimmed)]" />
						<p class="text-[13px] text-[var(--ui-text-muted)]">Say hello. It will be encrypted.</p>
					</div>
				{/if}
			</div>

			<footer
				class="shrink-0 border-t border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-5 py-3"
			>
				<div class="flex items-end gap-2">
					<div
						class="flex flex-1 items-center gap-2 rounded-2xl bg-[var(--ui-bg-muted)] px-4 py-2.5"
					>
						<input
							type="text"
							bind:value={draft}
							onkeydown={onKey}
							placeholder="Type a message..."
							class="flex-1 bg-transparent text-[14px] outline-none placeholder:text-[var(--ui-text-dimmed)]"
						/>
					</div>
					<button
						type="button"
						onclick={send}
						disabled={!draft.trim()}
						class="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-500 text-white shadow-[var(--glow-primary)] transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
						aria-label="Send"
					>
						<Icon name="i-lucide-send" class="size-4" />
					</button>
				</div>
			</footer>
		{:else}
			<div class="hidden flex-col items-center justify-center gap-3 text-center sm:flex">
				<div
					class="grid size-16 place-items-center rounded-2xl bg-[var(--ui-bg-muted)] text-[var(--ui-text-dimmed)]"
				>
					<Icon name="i-lucide-message-circle" class="size-8" />
				</div>
				<div>
					<p class="text-[15px] font-semibold">Your messages</p>
					<p class="mt-1 text-[13px] text-[var(--ui-text-muted)]">
						Select a real conversation or start a new one.
					</p>
				</div>
			</div>
		{/if}
	</section>
</div>

<Dialog bind:open={showNew} title="New message">
	<p class="mb-3 text-[13px] text-[var(--ui-text-muted)]">
		Enter the recipient's <span class="font-semibold">npub</span> or hex public key.
	</p>
	<Input
		bind:value={newPeerInput}
		icon="i-lucide-user"
		placeholder="npub1... or 64-char hex"
		class="font-mono text-[12.5px]"
	/>
	{#snippet footer()}
		<Button color="neutral" variant="subtle" onclick={() => (showNew = false)}>Cancel</Button>
		<Button color="primary" icon="i-lucide-message-square-plus" onclick={startNew}
			>Start chat</Button
		>
	{/snippet}
</Dialog>
