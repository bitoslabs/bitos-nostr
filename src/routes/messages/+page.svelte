<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { decode } from 'nostr-tools/nip19';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import { dms } from '$lib/nostr/dms.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { shortKey, timeAgo } from '$lib/utils/format';
	import {
		demoChats,
		demoDesignThread,
		chatMembers,
		chatMedia,
		chatFiles,
		voiceBars,
		colorBg,
		type ChatListItem,
		type ChatMessage
	} from '$lib/data/chat';
	import { pic } from '$lib/data/mock';

	let selected = $state<string>('demo-design'); // Design Chat open by default
	let draft = $state('');
	let filter = $state<'all' | 'unread' | 'groups'>('all');
	let query = $state('');
	let showNew = $state(false);
	let newPeerInput = $state('');
	let notificationsOn = $state(true);
	let threadEl: HTMLDivElement | undefined = $state();
	// Local mutable copy of the demo Design Chat thread (the import is readonly).
	let thread = $state<ChatMessage[]>([...demoDesignThread]);

	// Merge real conversations on top of the demo list.
	const conversations = $derived<ChatListItem[]>([
		...dms.conversations.map((c) => {
			const p = profiles.get(c.peer);
			const name = p?.display_name || p?.name || shortKey(c.peer);
			return {
				id: c.peer,
				name,
				initials: name.slice(0, 2).toUpperCase(),
				color: 'primary',
				preview: c.lastMessage?.content ?? 'No messages yet',
				previewPrefix: c.lastMessage?.mine ? 'You:' : '',
				time: c.lastMessage ? timeAgo(c.lastMessage.createdAt) : '',
				unread: c.unread
			} as ChatListItem;
		}),
		...demoChats
	]);

	const filtered = $derived(
		conversations.filter((c) => {
			if (filter === 'unread' && !c.unread) return false;
			if (filter === 'groups' && !c.group) return false;
			if (query) {
				const q = query.toLowerCase();
				return c.name.toLowerCase().includes(q) || c.preview.toLowerCase().includes(q);
			}
			return true;
		})
	);

	const active = $derived(conversations.find((c) => c.id === selected));
	const unreadTotal = $derived(conversations.reduce((s, c) => s + (c.unread ?? 0), 0));

	// Resolve a ?to= param into a conversation.
	function resolveTo(param: string | null) {
		if (!param) return;
		let peer = param.trim();
		if (peer.startsWith('npub1')) {
			try {
				const d = decode(peer);
				if (d.type === 'npub') peer = d.data as string;
			} catch {
				/* ignore */
			}
		}
		if (/^[0-9a-fA-F]{64}$/.test(peer)) {
			selected = peer.toLowerCase();
			profiles.ensure([peer.toLowerCase()]);
		}
	}
	onMount(() => resolveTo(page.url.searchParams.get('to')));
	$effect(() => resolveTo(page.url.searchParams.get('to')));

	$effect(() => {
		void selected;
		if (threadEl) threadEl.scrollTop = threadEl.scrollHeight;
	});

	function selectChat(id: string) {
		selected = id;
		const item = conversations.find((c) => c.id === id);
		if (item && !item.demo) dms.markRead(id);
	}

	function isMine(m: ChatMessage) {
		return 'mine' in m && m.mine;
	}

	async function send() {
		const body = draft.trim();
		if (!body) return;
		if (active?.demo) {
			// echo into the demo thread
			thread.push({
				id: 'me-' + Date.now(),
				mine: true,
				time: new Date().toLocaleTimeString('en-US', {
					hour: 'numeric',
					minute: '2-digit',
					hour12: true
				}),
				text: body
			});
			thread = [...thread];
			draft = '';
			return;
		}
		if (!active) return;
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
			send();
		}
	}

	function startNew() {
		const input = newPeerInput.trim();
		if (!input) return;
		let peer = input;
		if (peer.startsWith('npub1')) {
			try {
				const d = decode(peer);
				if (d.type === 'npub') peer = d.data as string;
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

	// Real messages for the selected peer (if any).
	const realMessages = $derived(
		active && !active.demo
			? (dms.conversations.find((c) => c.peer === active.id)?.messages ?? [])
			: []
	);
</script>

<div class="flex h-full">
	<!-- ============ CHAT LIST ============ -->
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
						{unreadTotal} new · {dms.conversations.length} live
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
			<Input bind:value={query} class="w-full" icon="i-lucide-search" placeholder="Search messages…" />
			<div class="mt-3 flex gap-1">
				{#each [{ k: 'all', l: 'All' }, { k: 'unread', l: 'Unread', n: unreadTotal }, { k: 'groups', l: 'Groups' }] as t (t.k)}
					<button
						type="button"
						onclick={() => (filter = t.k as typeof filter)}
						class="pill-tab flex items-center gap-1 {filter === t.k ? 'active' : ''}"
					>
						{t.l}
						{#if t.n}
							<span class="rounded-full bg-primary-500 px-1.5 py-0.5 text-[10px] text-white"
								>{t.n}</span
							>
						{/if}
					</button>
				{/each}
			</div>
		</header>

		<div class="min-h-0 flex-1 overflow-y-auto">
			{#each filtered as c (c.id)}
				<button
					type="button"
					onclick={() => selectChat(c.id)}
					class="chat-item flex w-full cursor-pointer items-start gap-3 px-4 py-3.5 text-left {selected ===
					c.id
						? 'active'
						: ''}"
				>
					<div class="relative shrink-0">
						<div
							class="grid size-12 place-items-center rounded-2xl font-bold text-white shadow-sm {colorBg[
								c.color
							]}"
						>
							{c.initials}
						</div>
						{#if c.online}
							<span
								class="absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full bg-accent-500 ring-2 ring-[var(--surface-bg)]"
							></span>
						{:else if c.away}
							<span
								class="absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full bg-warm-500 ring-2 ring-[var(--surface-bg)]"
							></span>
						{/if}
					</div>
					<div class="min-w-0 flex-1">
						<div class="mb-0.5 flex items-center justify-between">
							<h3 class="flex items-center gap-1.5 truncate text-[14.5px] font-bold">
								{c.name}
								{#if c.group}<Icon
										name="i-lucide-users"
										class="size-3 text-[var(--ui-text-dimmed)]"
									/>{/if}
							</h3>
							<span
								class="ml-2 shrink-0 text-[11px] {c.unread
									? 'font-semibold text-primary-500'
									: 'text-[var(--ui-text-muted)]'}">{c.time}</span
							>
						</div>
						<div class="flex items-center justify-between">
							<p class="flex items-center gap-1.5 truncate text-[13px] text-[var(--ui-text-muted)]">
								{#if c.voice}
									<Icon name="i-lucide-mic" class="size-3.5 text-primary-500" />{c.voice}
								{:else if c.photo}
									<Icon name="i-lucide-image" class="size-3.5 text-accent-500" />Photo
								{:else}
									{#if c.previewPrefix}<span class="font-semibold text-[var(--ui-text)]"
											>{c.previewPrefix}</span
										>{/if}
									{c.preview}
								{/if}
							</p>
							{#if c.unread}
								<span
									class="ml-2 grid size-5 shrink-0 place-items-center rounded-full bg-primary-500 text-[10px] font-bold text-white"
									>{c.unread}</span
								>
							{/if}
						</div>
					</div>
				</button>
			{/each}
			{#if !filtered.length}
				<p class="px-4 py-10 text-center text-[12.5px] text-[var(--ui-text-dimmed)]">
					No chats match{#if query}
						“{query}”{/if}.
				</p>
			{/if}
		</div>
	</aside>

	<!-- ============ THREAD ============ -->
	<section class="chat-canvas {selected ? 'flex' : 'hidden sm:flex'} min-w-0 flex-1 flex-col">
		{#if active}
			<!-- Header -->
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
					<div class="relative shrink-0">
						<div
							class="grid size-11 place-items-center rounded-2xl font-bold text-white shadow-md {colorBg[
								active.color
							]}"
						>
							{active.initials}
						</div>
							{#if active.online}<span
								class="absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full bg-accent-500 ring-2 ring-[var(--surface-bg)]"
							></span>{/if}
					</div>
					<div class="min-w-0">
						<h2 class="flex items-center gap-2 text-[15px] font-bold">
							<span class="truncate">{active.name}</span>
							{#if active.group}<span
									class="rounded-full bg-primary-500/10 px-2 py-0.5 text-[10px] font-semibold text-primary-500"
									>GROUP</span
								>{/if}
							{#if !active.demo}<span class="font-mono text-[11px] text-[var(--ui-text-dimmed)]"
									>{shortKey(active.id, 6, 6)}</span
								>{/if}
						</h2>
						<p class="flex items-center gap-1.5 text-[12px] text-[var(--ui-text-muted)]">
							{#if active.demo}
								<span class="text-accent-500">●</span> 5 online · 28 members
							{:else}
								<Icon name="i-lucide-lock" class="size-3.5 text-[var(--tone-success-text)]" /> Encrypted
								· NIP-04
							{/if}
						</p>
					</div>
				</div>
				<div class="flex items-center gap-1">
					<button
						type="button"
						onclick={() => toasts.info('Voice call')}
						class="grid size-10 place-items-center rounded-xl text-[var(--ui-text-muted)] hover:bg-[var(--interactive-hover-bg)] hover:text-primary-500"
						><Icon name="i-lucide-phone" class="size-[15px]" /></button
					>
					<button
						type="button"
						onclick={() => toasts.info('Video call')}
						class="grid size-10 place-items-center rounded-xl text-[var(--ui-text-muted)] hover:bg-[var(--interactive-hover-bg)] hover:text-primary-500"
						><Icon name="i-lucide-video" class="size-[15px]" /></button
					>
				</div>
			</header>

			<!-- Pinned (demo design chat only) -->
			{#if active.demo}
				<div
					class="flex shrink-0 items-center gap-3 border-b border-warm-500/20 bg-warm-500/10 px-5 py-2.5"
				>
					<Icon name="i-lucide-pin" class="size-4 shrink-0 text-warm-500" />
					<div class="min-w-0 flex-1">
						<p class="truncate text-[12px] font-semibold">Design Review Meeting — Today 11:00 AM</p>
						<p class="truncate text-[11px] text-[var(--ui-text-muted)]">
							Pinned by Sarah Chen · 2 hours ago
						</p>
					</div>
					<button
						type="button"
						class="shrink-0 text-[11px] font-semibold text-primary-500 hover:underline">View</button
					>
				</div>
			{/if}

			<!-- Messages -->
			<div bind:this={threadEl} class="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
				{#if active.demo}
					<div class="date-divider">
						<span
							class="rounded-full bg-[var(--surface-bg)] px-3 py-1 text-[11px] font-semibold text-[var(--ui-text-muted)]"
							>Today</span
						>
					</div>
					{#each thread as m (m.id)}
						<div class="msg-in flex gap-2.5 {isMine(m) ? 'justify-end' : ''}">
							{#if !isMine(m) && m.initials}
								<div
									class="mt-auto grid size-8 shrink-0 place-items-center rounded-xl text-xs font-bold text-white {colorBg[
										m.color ?? 'primary'
									]}"
								>
									{m.initials}
								</div>
							{/if}
							<div class="max-w-[70%]">
								<div class="mb-1 flex items-baseline gap-2 {isMine(m) ? 'justify-end' : ''}">
									{#if isMine(m)}
										<span class="text-[10px] text-[var(--ui-text-dimmed)]">{m.time}</span><span
											class="text-[12px] font-bold text-primary-500">You</span
										>
									{:else}
										<span class="text-[12px] font-bold">{m.author}</span><span
											class="text-[10px] text-[var(--ui-text-dimmed)]">{m.time}</span
										>
									{/if}
								</div>
								{#if 'text' in m}
									<div class="bubble-in px-4 py-2.5 text-[14px] leading-relaxed">
										{@html m.text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}
									</div>
								{:else if 'image' in m}
									<div class="bubble-in overflow-hidden p-2">
										<img src={m.image} class="w-full rounded-xl" alt="" />
										{#if m.caption}<p class="px-2 py-2 text-[14px] leading-relaxed">
												{m.caption}
											</p>{/if}
									</div>
									{#if m.reaction}<div
											class="reaction mt-1 inline-flex items-center gap-1 rounded-full border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-2 py-0.5 text-[12px] shadow-sm"
										>
											{m.reaction}
										</div>{/if}
								{:else if 'voice' in m}
									<div class="bubble-in flex min-w-[280px] items-center gap-3 px-4 py-3">
										<button
											type="button"
											class="grid size-9 shrink-0 place-items-center rounded-full bg-primary-500 text-white transition hover:bg-primary-600"
											><Icon name="i-lucide-play" class="ml-0.5 size-3.5" /></button
										>
										<div class="flex h-8 flex-1 items-center gap-[2px]">
											{#each voiceBars as b}<div
													class="wave-bar w-[3px] rounded-full bg-primary-500"
													style="height:{b.height}%;animation-delay:{b.delay}"
												></div>{/each}
										</div>
										<span class="shrink-0 text-[11px] font-semibold text-[var(--ui-text-muted)]"
											>{m.voice}</span
										>
									</div>
								{/if}
								{#if isMine(m)}<div class="mt-1 flex items-center justify-end gap-1">
										<Icon name="i-lucide-check-check" class="size-3 text-accent-500" /><span
											class="text-[10px] text-[var(--ui-text-dimmed)]">Read by 12</span
										>
									</div>{/if}
							</div>
						</div>
					{/each}
					<!-- typing -->
					<div class="flex gap-2.5">
						<div
							class="grid size-8 shrink-0 place-items-center rounded-xl bg-accent-500 text-xs font-bold text-white"
						>
							OC
						</div>
						<div class="bubble-in flex items-center gap-1.5 px-4 py-3">
							<span class="typing-dot size-1.5 rounded-full bg-[var(--ui-text-muted)]"></span>
							<span
								class="typing-dot size-1.5 rounded-full bg-[var(--ui-text-muted)]"
								style="animation-delay:.2s"
							></span>
							<span
								class="typing-dot size-1.5 rounded-full bg-[var(--ui-text-muted)]"
								style="animation-delay:.4s"
							></span>
							<span class="ml-1 text-[11px] text-[var(--ui-text-muted)]">Olivia is typing</span>
						</div>
					</div>
				{:else}
					{#if !realMessages.length}
						<div class="flex h-full flex-col items-center justify-center gap-2 text-center">
							<Icon name="i-lucide-message-circle" class="size-8 text-[var(--ui-text-dimmed)]" />
							<p class="text-[13px] text-[var(--ui-text-muted)]">Say hello — it's encrypted.</p>
						</div>
					{:else}
						{#each realMessages as msg (msg.id)}
							<div class="msg-in flex {msg.mine ? 'justify-end' : 'justify-start'}">
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
					{/if}
				{/if}
			</div>

			<!-- Input -->
			<footer class="shrink-0 border-t border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-5 py-3">
				<div class="flex items-end gap-2">
					<button
						type="button"
						class="grid size-10 shrink-0 place-items-center rounded-xl text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)]"
						><Icon name="i-lucide-paperclip" class="size-4" /></button
					>
					<button
						type="button"
						class="grid size-10 shrink-0 place-items-center rounded-xl text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)]"
						><Icon name="i-lucide-image" class="size-4" /></button
					>
					<div
						class="flex flex-1 items-center gap-2 rounded-2xl bg-[var(--ui-bg-muted)] px-4 py-2.5"
					>
						<input
							type="text"
							bind:value={draft}
							onkeydown={onKey}
							placeholder="Type a message…"
							class="flex-1 bg-transparent text-[14px] outline-none placeholder:text-[var(--ui-text-dimmed)]"
						/>
						<button type="button" class="text-[var(--ui-text-muted)] transition hover:text-warm-500"
							><Icon name="i-lucide-smile" class="size-5" /></button
						>
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
						Select a conversation or start a new one.
					</p>
				</div>
			</div>
		{/if}
	</section>

	<!-- ============ INFO PANEL (demo) ============ -->
	<aside
		class="hidden w-[320px] shrink-0 flex-col overflow-y-auto border-l border-[var(--ui-border-muted)] bg-[var(--surface-bg)] xl:flex"
	>
		<div class="relative border-b border-[var(--ui-border-muted)] px-6 pt-8 pb-5 text-center">
			<div
				class="mx-auto mb-3 grid size-20 place-items-center rounded-3xl bg-primary-500 font-display text-2xl font-extrabold text-white shadow-[var(--glow-primary)]"
			>
				DC
			</div>
			<h2 class="font-display text-[22px] font-extrabold tracking-tight">
				{active?.name ?? 'Select a chat'}
			</h2>
			<p class="mt-1 text-[12px] text-[var(--ui-text-muted)]">
				{active?.group ? 'Group · 28 members · 5 online' : 'Direct message'}
			</p>
		</div>

		<div class="border-b border-[var(--ui-border-muted)] px-5 py-4">
			<h3 class="mb-2 text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase">
				Description
			</h3>
			<p class="text-[13px] leading-relaxed">
				Where designers collaborate, share ideas, and ship beautiful products together.
			</p>
		</div>

		<div
			class="flex items-center justify-between border-b border-[var(--ui-border-muted)] px-5 py-4"
		>
			<div class="flex items-center gap-3">
				<div class="grid size-9 place-items-center rounded-xl bg-accent-500/10">
					<Icon name="i-lucide-bell" class="size-4 text-accent-500" />
				</div>
				<div>
					<p class="text-[13px] font-semibold">Notifications</p>
					<p class="text-[11px] text-[var(--ui-text-muted)]">All messages</p>
				</div>
			</div>
			<button
				type="button"
				class="toggle {notificationsOn ? 'on' : ''}"
				onclick={() => (notificationsOn = !notificationsOn)}
				aria-label="Toggle notifications"
			></button>
		</div>

		<div class="border-b border-[var(--ui-border-muted)] px-5 py-4">
			<div class="mb-3 flex items-center justify-between">
				<h3 class="text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase">
					Members · 28
				</h3>
				<button type="button" class="text-[11px] font-semibold text-primary-500 hover:underline"
					>View all</button
				>
			</div>
			<div class="space-y-2.5">
				{#each chatMembers as mb (mb.name)}
					<div
						class="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-[var(--interactive-hover-bg)]"
					>
						<div class="relative">
							<div
								class="grid size-9 place-items-center rounded-xl text-xs font-bold text-white {colorBg[
									mb.color
								]}"
							>
								{mb.initials}
							</div>
							{#if mb.status === 'Online' || mb.status === 'Active now'}<span
									class="absolute -right-0.5 -bottom-0.5 size-3 rounded-full bg-accent-500 ring-2 ring-[var(--surface-bg)]"
								></span>{/if}
						</div>
						<div class="flex-1">
							<p class="flex items-center gap-1.5 text-[13px] font-semibold">
								{mb.name}{#if mb.role}<span
										class="rounded bg-primary-500/10 px-1.5 py-0.5 text-[9px] font-bold text-primary-500"
										>{mb.role}</span
									>{/if}
							</p>
							<p
								class="text-[11px] {mb.status === 'Online' || mb.status === 'Active now'
									? 'text-accent-500'
									: 'text-[var(--ui-text-muted)]'}"
							>
								{mb.status}
							</p>
						</div>
					</div>
				{/each}
			</div>
		</div>

		<div class="border-b border-[var(--ui-border-muted)] px-5 py-4">
			<div class="mb-3 flex items-center justify-between">
				<h3 class="text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase">
					Media · 142
				</h3>
				<button type="button" class="text-[11px] font-semibold text-primary-500 hover:underline"
					>See all</button
				>
			</div>
			<div class="grid grid-cols-3 gap-1.5">
				{#each chatMedia.slice(0, 5) as s (s)}
					<div class="aspect-square overflow-hidden rounded-lg">
						<img src={pic(s, 200, 200)} class="size-full object-cover" alt="" />
					</div>
				{/each}
				<div class="relative aspect-square overflow-hidden rounded-lg">
					<img src={pic('m6', 200, 200)} class="size-full object-cover" alt="" />
					<div
						class="absolute inset-0 grid place-items-center bg-ink/60 text-sm font-bold text-white"
					>
						+136
					</div>
				</div>
			</div>
		</div>

		<div class="px-5 py-4">
			<h3 class="mb-3 text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase">
				Files · 24
			</h3>
			<div class="space-y-2">
				{#each chatFiles as f (f.name)}
					<div
						class="flex cursor-pointer items-center gap-3 rounded-lg p-2 transition hover:bg-[var(--interactive-hover-bg)]"
					>
						<div class="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-500/10">
							<Icon name={f.icon} class="size-4 {f.color}" />
						</div>
						<div class="min-w-0 flex-1">
							<p class="truncate text-[12px] font-semibold">{f.name}</p>
							<p class="text-[10px] text-[var(--ui-text-muted)]">{f.size}</p>
						</div>
						<Icon name="i-lucide-download" class="size-3.5 text-[var(--ui-text-dimmed)]" />
					</div>
				{/each}
			</div>
		</div>
	</aside>
</div>

<!-- New message dialog -->
<Dialog bind:open={showNew} title="New message">
	<p class="mb-3 text-[13px] text-[var(--ui-text-muted)]">
		Enter the recipient's <span class="font-semibold">npub</span> or hex public key.
	</p>
	<Input
		bind:value={newPeerInput}
		icon="i-lucide-user"
		placeholder="npub1… or 64-char hex"
		class="font-mono text-[12.5px]"
	/>
	{#snippet footer()}
		<Button color="neutral" variant="subtle" onclick={() => (showNew = false)}>Cancel</Button>
		<Button color="primary" icon="i-lucide-message-square-plus" onclick={startNew}
			>Start chat</Button
		>
	{/snippet}
</Dialog>
