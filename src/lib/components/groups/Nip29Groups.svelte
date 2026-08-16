<script lang="ts">
	import { untrack } from 'svelte';
	import { browser } from '$app/environment';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import {
		nip29,
		DEFAULT_GROUP_RELAYS,
		type Nip29GroupListing,
		type GroupAttachment,
		type Nip29Message
	} from '$lib/nostr/groups.svelte';
	import { media } from '$lib/stores/media.svelte';
	import type { GroupRoster } from '$lib/nostr/groups.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { confirms } from '$lib/stores/confirms.svelte';
	import { readDraft, createDraftWriter } from '$lib/stores/drafts';
	import { shortKey, timeAgo } from '$lib/utils/format';
	import { cn } from '$lib/utils/cn';

	/**
	 * NIP-29 Communities — public, relay-hosted group chats that interop with
	 * every NIP-29 client (0xchat, chachat, …).
	 *
	 * UX design:
	 *  - Mobile-first: list and chat swap full-screen; a back button returns
	 *    to the list (mirrors the DM pane behavior).
	 *  - Education: a one-line explainer distinguishes Communities (public,
	 *    cross-app) from the encrypted private Groups tab.
	 *  - Drafts: unsent text survives switching groups (per-group draft key).
	 *  - Connection dot: live relay subscription health at a glance.
	 */
	let { joinPreset }: { joinPreset?: { relay: string; id: string } } = $props();

	let activeGroupId = $state<string | null>(null);
	let draft = $state('');
	let sending = $state(false);
	let joinOpen = $state(false);
	let discoverOpen = $state(false);
	let createOpen = $state(false);
	let joinRelay = $state<string>(DEFAULT_GROUP_RELAYS[0]);
	let joinGroupId = $state('');
	let createName = $state('');
	let createRelay = $state<string>(DEFAULT_GROUP_RELAYS[0]);
	let discoverRelay = $state<string>(DEFAULT_GROUP_RELAYS[0]);
	let listings = $state<Nip29GroupListing[]>([]);
	let discovering = $state(false);
	let busy = $state(false);
	let chatEl = $state<HTMLDivElement | undefined>(undefined);
	/** Message being replied to (kind 10 thread reply). */
	let replyTo = $state<Nip29Message | null>(null);
	/** Pending attachment (one at a time keeps the composer simple). */
	let attachment = $state<GroupAttachment | null>(null);
	let uploading = $state(false);
	let fileInput = $state<HTMLInputElement | null>(null);
	let draftInput = $state<HTMLTextAreaElement | null>(null);
	/** History pagination. */
	let olderLoading = $state(false);
	let hasOlder = $state(true);
	let unsendBusy = $state(false);
	/** Quick emoji palette. */
	let emojiOpen = $state(false);
	/** Members + admin management panel. */
	let rosterOpen = $state(false);
	let roster = $state<GroupRoster | undefined>(undefined);
	let rosterLoading = $state(false);
	/** Rename / edit metadata (admins). */
	let renameOpen = $state(false);
	let renameName = $state('');
	let renameAbout = $state('');
	let renamePicture = $state('');
	let adminBusy = $state(false);

	const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
		{
			label: 'Smileys',
			emojis: ['😀', '😂', '🥹', '😊', '😍', '🤔', '😅', '🫡', '😴', '🤯', '😎', '🥳']
		},
		{
			label: 'Hands',
			emojis: ['👍', '👎', '🙏', '👏', '🤝', '💪', '🫶', '✌️', '🤙', '👊']
		},
		{
			label: 'Hearts',
			emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🔥', '✨', '⚡']
		},
		{
			label: 'Bitcoin',
			emojis: ['🟠', '🪙', '💸', '🤑', '🧿', '🌐']
		}
	];

	function insertEmoji(emoji: string) {
		const el = draftInput;
		if (!el) {
			draft += emoji;
			return;
		}
		const start = el.selectionStart ?? draft.length;
		const end = el.selectionEnd ?? draft.length;
		draft = draft.slice(0, start) + emoji + draft.slice(end);
		requestAnimationFrame(() => {
			el.focus();
			const pos = start + emoji.length;
			el.setSelectionRange(pos, pos);
		});
	}

	async function openRoster() {
		if (!activeGroup) return;
		rosterOpen = true;
		rosterLoading = true;
		try {
			roster = await nip29.fetchRoster(activeGroup);
		} finally {
			rosterLoading = false;
		}
	}

	function openRename() {
		if (!activeGroup) return;
		renameName = activeGroup.name ?? '';
		renameAbout = activeGroup.about ?? '';
		renamePicture = activeGroup.picture ?? '';
		renameOpen = true;
	}

	async function saveRename() {
		if (!activeGroup || adminBusy) return;
		adminBusy = true;
		try {
			await nip29.editGroupMetadata(activeGroup.id, {
				name: renameName,
				about: renameAbout,
				picture: renamePicture
			});
			toasts.success('Community updated');
			renameOpen = false;
		} catch (e) {
			toasts.error((e as Error).message || 'Relay refused (admins only)');
		} finally {
			adminBusy = false;
		}
	}

	/**
	 * Run a roster admin action. Destructive ones (kick / revoke admin) ask
	 * for confirmation first — the relay enforces them immediately and there
	 * is no undo.
	 */
	async function rosterAction(
		fn: () => Promise<void>,
		done: string,
		confirm?: { title: string; message: string; confirmLabel: string; icon: string }
	) {
		if (adminBusy || !activeGroup) return;
		if (confirm) {
			const ok = await confirms.danger(confirm);
			if (!ok) return;
		}
		adminBusy = true;
		try {
			await fn();
			toasts.success(done);
			roster = await nip29.fetchRoster(activeGroup);
		} catch (e) {
			toasts.error((e as Error).message || 'Relay refused (admins only)');
		} finally {
			adminBusy = false;
		}
	}

	function nameForRoster(pubkey: string) {
		const p = profiles.get(pubkey);
		return p?.display_name || p?.name || shortKey(pubkey, 6, 4);
	}
	/** Per-group draft writer — swapped when the open group changes. */
	let draftWriter = createDraftWriter('nip29:none');

	const me = $derived(identity.current);
	const groups = $derived(nip29.groups);
	const activeGroup = $derived(groups.find((g) => g.id === activeGroupId) ?? null);
	const messages = $derived(
		activeGroup ? nip29.messagesFor(activeGroup.id, activeGroup.relay) : []
	);
	const totalUnread = $derived(groups.reduce((sum, g) => sum + g.unread, 0));

	const isAdminHere = $derived(!!activeGroup && nip29.isAdmin(activeGroup.id));
	const memberCount = $derived.by(() => {
		if (!activeGroup) return 0;
		return roster?.members.length ?? roster?.admins.length ?? 0;
	});

	// Deep link (?relay=…&id=…): open the join dialog prefilled, once.
	$effect(() => {
		if (!joinPreset) return;
		untrack(() => {
			joinRelay = joinPreset.relay;
			joinGroupId = joinPreset.id;
			joinOpen = true;
		});
	});

	// Autoscroll to the newest message.
	$effect(() => {
		void messages.length;
		if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
	});

	// Swap the per-group draft when the open group changes; restore its text.
	$effect(() => {
		const id = activeGroup?.id;
		if (!id) return;
		untrack(() => {
			draftWriter.flush();
			draftWriter = createDraftWriter(`nip29:${id}`);
			const saved = readDraft(`nip29:${id}`);
			draft = saved?.text ?? '';
		});
	});

	// Debounced draft persistence while typing.
	$effect(() => {
		if (!activeGroup || !draft.trim()) return;
		draftWriter.write({ text: draft });
	});

	function openGroup(id: string) {
		activeGroupId = id;
		emojiOpen = false;
		hasOlder = true;
		nip29.markRead(id);
		const group = nip29.groups.find((g) => g.id === id);
		if (group) {
			// Roster powers the admin tools + member count; metadata refreshes the name.
			void nip29.fetchRoster(group).then((r) => (roster = r ?? roster));
			void nip29.refreshGroup(group);
		}
	}

	/** Mobile back: flush the draft and return to the list. */
	function backToList() {
		draftWriter.flush();
		activeGroupId = null;
	}

	function nameFor(pubkey: string) {
		const p = profiles.get(pubkey);
		return p?.display_name || p?.name || shortKey(pubkey, 6, 4);
	}

	/** Safe host display for a relay URL (never throws on odd cached data). */
	function hostOf(relay: string) {
		try {
			return new URL(relay).host;
		} catch {
			return relay;
		}
	}

	function parentOf(message: Nip29Message): Nip29Message | undefined {
		if (!message.replyTo || !activeGroup) return undefined;
		return nip29
			.messagesFor(activeGroup.id, activeGroup.relay)
			.find((m) => m.id === message.replyTo);
	}

	async function send() {
		if (!activeGroup || sending) return;
		if (!draft.trim() && !attachment) return;
		sending = true;
		try {
			await nip29.send(activeGroup.id, draft, {
				replyTo: replyTo?.id,
				rootId: replyTo?.rootId ?? replyTo?.id,
				attachments: attachment ? [attachment] : []
			});
			draftWriter.clear();
			draft = '';
			attachment = null;
			replyTo = null;
		} catch (e) {
			toasts.error((e as Error).message || 'Could not send');
		} finally {
			sending = false;
		}
	}

	async function onFileChosen(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file || !me) return;
		const provider =
			media.state.defaultProvider !== 'none'
				? media.state.defaultProvider
				: media.configured[0]?.id;
		uploading = true;
		try {
			const result = await media.upload(file, provider, { pubkey: me.pk, purpose: 'group' });
			attachment = {
				url: result.url,
				kind: result.kind === 'image' ? 'image' : result.kind === 'video' ? 'video' : 'file',
				name: file.name
			};
		} catch (err) {
			toasts.error((err as Error).message);
		} finally {
			uploading = false;
		}
	}

	async function loadOlder() {
		if (!activeGroup || olderLoading || !hasOlder) return;
		olderLoading = true;
		try {
			const added = await nip29.loadOlder(activeGroup.id);
			if (added === 0) hasOlder = false;
		} finally {
			olderLoading = false;
		}
	}

	async function unsendMessage(message: Nip29Message) {
		if (!activeGroup || unsendBusy) return;
		const confirmed = await confirms.danger({
			title: 'Unsend this message?',
			message:
				'It is hidden on your device immediately. Other members see it removed too, if the group relay honors NIP-09 deletes.',
			confirmLabel: 'Unsend',
			icon: 'i-lucide-trash-2'
		});
		if (!confirmed) return;
		unsendBusy = true;
		try {
			await nip29.deleteMessage(activeGroup.id, message.id);
			toasts.success('Message unsent');
		} catch (e) {
			toasts.error((e as Error).message);
		} finally {
			unsendBusy = false;
		}
	}

	/** Copy a shareable deep-link invite for the open community. */
	async function shareInvite() {
		if (!activeGroup || !browser) return;
		const link = `${location.origin}/communities?relay=${encodeURIComponent(activeGroup.relay)}&id=${encodeURIComponent(activeGroup.id)}`;
		try {
			await navigator.clipboard.writeText(link);
			toasts.success('Invite link copied — share it anywhere');
		} catch {
			toasts.info(link);
		}
	}

	async function doJoin() {
		if (busy) return;
		busy = true;
		try {
			const group = await nip29.join(joinGroupId, joinRelay);
			toasts.success(`Joined ${group.name ?? group.id.slice(0, 10)}`);
			joinOpen = false;
			joinGroupId = '';
			openGroup(group.id);
		} catch (e) {
			toasts.error((e as Error).message);
		} finally {
			busy = false;
		}
	}

	async function doDiscover() {
		if (discovering) return;
		discovering = true;
		listings = [];
		try {
			listings = await nip29.discover(discoverRelay);
			if (!listings.length) toasts.info('No public groups found on that relay');
		} catch (e) {
			toasts.error((e as Error).message || 'Relay unreachable');
		} finally {
			discovering = false;
		}
	}

	async function joinListing(listing: Nip29GroupListing) {
		try {
			await nip29.join(listing.id, listing.relay);
			toasts.success(`Joined ${listing.name}`);
			discoverOpen = false;
			openGroup(listing.id);
		} catch (e) {
			toasts.error((e as Error).message);
		}
	}

	async function doCreate() {
		if (busy) return;
		busy = true;
		try {
			const id = await nip29.createGroup(createName, createRelay);
			toasts.success('Community created — you are the admin');
			createOpen = false;
			createName = '';
			openGroup(id);
		} catch (e) {
			toasts.error((e as Error).message || 'Relay refused (admin key needed)');
		} finally {
			busy = false;
		}
	}

	async function leaveActive() {
		if (!activeGroup) return;
		const name = activeGroup.name ?? activeGroup.id.slice(0, 10);
		const confirmed = await confirms.danger({
			title: `Leave ${name}?`,
			message:
				'You will stop receiving messages from this community. You can re-join later with an invite link — but if it is a closed group, an admin must re-add you.',
			confirmLabel: 'Leave',
			icon: 'i-lucide-log-out'
		});
		if (!confirmed) return;
		try {
			await nip29.leave(activeGroup.id);
			activeGroupId = null;
			toasts.info(`Left ${name}`);
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
</script>

<div class="flex h-full min-h-0">
	<!-- ─── Group list (full-screen on mobile until a group opens) ─── -->
	<div
		class="{activeGroupId
			? 'hidden md:flex'
			: 'flex'} w-full max-w-xs shrink-0 flex-col border-r border-[var(--ui-border-muted)] md:w-80"
	>
		<div class="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
			<h2 class="flex items-center gap-2 text-[15px] font-bold">
				Communities
				{#if nip29.connected}
					<span
						class="size-1.5 rounded-full bg-emerald-500"
						title="Connected to group relays"
						aria-label="Connected"
					></span>
				{/if}
				{#if totalUnread}
					<span class="rounded-full bg-primary-500 px-1.5 py-0.5 text-[10px] font-bold text-white"
						>{totalUnread}</span
					>
				{/if}
			</h2>
			<div class="flex items-center gap-1">
				<button
					type="button"
					onclick={() => (discoverOpen = true)}
					class="grid size-8 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
					title="Browse public communities"
					aria-label="Discover communities"
				>
					<Icon name="i-lucide-compass" class="size-[17px]" />
				</button>
				<button
					type="button"
					onclick={() => (joinOpen = true)}
					class="grid size-8 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
					title="Join with a group id"
					aria-label="Join community by id"
				>
					<Icon name="i-lucide-plus" class="size-[17px]" />
				</button>
			</div>
		</div>
		<p class="px-4 pb-2 text-[11px] leading-snug text-[var(--ui-text-dimmed)]">
			Public rooms on group relays — anyone from any Nostr app can join.
		</p>

		<div class="min-h-0 flex-1 overflow-y-auto">
			{#if !me}
				<div class="flex flex-col items-center gap-2 px-6 py-10 text-center">
					<Icon name="i-lucide-users-round" class="size-6 text-[var(--ui-text-dimmed)]" />
					<p class="text-[12.5px] font-semibold text-[var(--ui-text-muted)]">
						Sign in to join communities
					</p>
				</div>
			{:else if !groups.length}
				<!-- Education empty state: Communities vs private Groups -->
				<div class="mx-3 mt-1 space-y-2">
					<button
						type="button"
						onclick={() => (discoverOpen = true)}
						class="flex w-full flex-col items-center gap-2 rounded-2xl border border-dashed border-[var(--ui-border)] px-3 py-6 text-center transition hover:border-primary-500/40"
					>
						<Icon name="i-lucide-users-round" class="size-5 text-primary-500" />
						<span class="text-[12.5px] font-bold text-[var(--ui-text-muted)]"
							>Discover communities</span
						>
						<span class="text-[11px] text-[var(--ui-text-dimmed)]"
							>Browse public rooms on a group relay</span
						>
					</button>
					<div
						class="rounded-2xl bg-[var(--ui-bg-muted)] px-3.5 py-3 text-[11px] leading-relaxed text-[var(--ui-text-dimmed)]"
					>
						<p class="mb-1 flex items-center gap-1.5 font-bold text-[var(--ui-text-muted)]">
							<Icon name="i-lucide-info" class="size-3.5" /> Which group type?
						</p>
						<p>
							<strong class="text-[var(--ui-text)]">Communities</strong> — public, hosted on relays, works
							across apps.
						</p>
						<p>
							<strong class="text-[var(--ui-text)]">Groups</strong> — private, end-to-end encrypted, BitOS-to-BitOS.
						</p>
					</div>
				</div>
			{:else}
				{#each groups as group (group.id)}
					<button
						type="button"
						onclick={() => openGroup(group.id)}
						class={cn(
							'flex w-full items-center gap-3 px-4 py-2.5 text-left transition',
							activeGroupId === group.id
								? 'bg-[color-mix(in_oklab,var(--ui-color-primary-500)_10%,transparent)]'
								: 'hover:bg-[var(--interactive-hover-bg)]'
						)}
					>
						<Avatar
							pubkey={group.id}
							name={group.name ?? group.id.slice(0, 8)}
							picture={group.picture}
							size={38}
						/>
						<span class="min-w-0 flex-1">
							<span class="block truncate text-[13.5px] font-bold"
								>{group.name ?? group.id.slice(0, 12)}</span
							>
							<span class="block truncate font-mono text-[10px] text-[var(--ui-text-dimmed)]">
								{hostOf(group.relay)}
							</span>
						</span>
						{#if group.unread}
							<span
								class="grid min-w-5 place-items-center rounded-full bg-primary-500 px-1.5 text-[10px] font-bold text-white"
								>{group.unread}</span
							>
						{/if}
					</button>
				{/each}
			{/if}
		</div>
	</div>

	<!-- ─── Chat view (hidden on mobile until a group opens) ─── -->
	<div class="{activeGroupId ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col">
		{#if activeGroup}
			<header
				class="flex shrink-0 items-center gap-3 border-b border-[var(--ui-border-muted)] px-3 py-3 md:px-4"
			>
				<button
					type="button"
					onclick={backToList}
					class="grid size-8 shrink-0 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)] md:hidden"
					aria-label="Back to communities"
				>
					<Icon name="i-lucide-arrow-left" class="size-5" />
				</button>
				<Avatar
					pubkey={activeGroup.id}
					name={activeGroup.name ?? activeGroup.id.slice(0, 8)}
					picture={activeGroup.picture}
					size={36}
				/>
				<div class="min-w-0 flex-1">
					<p class="truncate text-[14px] font-bold">
						{activeGroup.name ?? activeGroup.id.slice(0, 16)}
					</p>
					<p class="truncate font-mono text-[10px] text-[var(--ui-text-dimmed)]">
						{activeGroup.relay}
					</p>
				</div>
				<button
					type="button"
					onclick={openRoster}
					class="flex h-8 shrink-0 items-center gap-1 rounded-full px-2 text-[12px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
					title="Members &amp; admins"
					aria-label="Open members list"
				>
					<Icon name="i-lucide-users-round" class="size-4" />
					{#if memberCount}{memberCount}{/if}
				</button>
				{#if isAdminHere}
					<button
						type="button"
						onclick={openRename}
						class="grid size-8 shrink-0 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
						title="Rename / edit community (admin)"
						aria-label="Edit community"
					>
						<Icon name="i-lucide-pencil" class="size-4" />
					</button>
				{/if}
				<button
					type="button"
					onclick={shareInvite}
					class="grid size-8 shrink-0 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
					title="Copy invite link"
					aria-label="Copy invite link"
				>
					<Icon name="i-lucide-share-2" class="size-4" />
				</button>
				<button
					type="button"
					onclick={leaveActive}
					class="shrink-0 rounded-full px-3 py-1.5 text-[11.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[color-mix(in_oklab,var(--tone-error-text)_10%,transparent)] hover:text-[var(--tone-error-text)]"
				>
					Leave
				</button>
			</header>

			<div bind:this={chatEl} class="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
				{#if messages.length && hasOlder}
					<button
						type="button"
						onclick={loadOlder}
						disabled={olderLoading}
						class="mx-auto flex items-center gap-1.5 rounded-full border border-[var(--ui-border-muted)] px-3 py-1.5 text-[11px] font-bold text-[var(--ui-text-muted)] transition hover:border-primary-500/40 hover:text-primary-500 disabled:opacity-50"
					>
						<Icon
							name={olderLoading ? 'i-lucide-loader-circle' : 'i-lucide-history'}
							class="size-3.5 {olderLoading ? 'animate-spin' : ''}"
						/>
						{olderLoading ? 'Loading…' : 'Load earlier messages'}
					</button>
				{/if}
				{#if nip29.loading}
					<p class="py-8 text-center text-[12px] text-[var(--ui-text-dimmed)]">
						<Icon name="i-lucide-loader-circle" class="mr-1 inline size-3.5 animate-spin" />
						Connecting to {hostOf(activeGroup.relay)}…
					</p>
				{/if}
				{#each messages as message (message.id)}
					{@const parent = parentOf(message)}
					<div class="group/msg flex flex-col {message.mine ? 'items-end' : 'items-start'}">
						{#if parent}
							<!-- Threaded reply quote (NIP-10) -->
							<div
								class="mb-0.5 flex max-w-[78%] items-center gap-1.5 truncate rounded-lg border-l-2 px-2 py-1 text-[11px] {message.mine
									? 'border-primary-400 text-white/70'
									: 'border-primary-500 text-[var(--ui-text-dimmed)]'}"
							>
								<Icon name="i-lucide-corner-down-right" class="size-3 shrink-0" />
								<span class="shrink-0 font-bold">{nameFor(parent.pubkey)}</span>
								<span class="truncate"
									>{parent.text || (parent.media[0] ? '📎 attachment' : '')}</span
								>
							</div>
						{/if}
						<div
							class="flex max-w-[78%] items-end gap-1.5 {message.mine ? 'flex-row-reverse' : ''}"
						>
							<div
								class="overflow-hidden rounded-2xl px-3.5 py-2 {message.mine
									? 'bg-primary-500 text-white'
									: 'bg-[var(--ui-bg-muted)] text-[var(--ui-text)]'}"
							>
								{#if !message.mine}
									<p class="text-[11px] font-bold text-primary-500">
										{nameFor(message.pubkey)}
									</p>
								{/if}
								{#each message.media as attachment_ (attachment_.url)}
									{#if attachment_.kind === 'image'}
										<a href={attachment_.url} target="_blank" rel="noreferrer" class="mb-1.5 block">
											<img
												src={attachment_.url}
												alt={attachment_.name ?? 'shared image'}
												class="max-h-64 rounded-xl object-cover"
												loading="lazy"
											/>
										</a>
									{:else if attachment_.kind === 'video'}
										<!-- svelte-ignore a11y_media_has_caption -->
										<video
											src={attachment_.url}
											controls
											playsinline
											class="mb-1.5 max-h-64 rounded-xl"
										></video>
									{:else}
										<a
											href={attachment_.url}
											target="_blank"
											rel="noreferrer"
											class="mb-1.5 flex items-center gap-2 rounded-xl bg-black/10 px-2.5 py-2 text-[12px] font-bold underline decoration-transparent transition hover:decoration-current"
										>
											<Icon name="i-lucide-file" class="size-4 shrink-0" />
											<span class="truncate">{attachment_.name ?? 'Download file'}</span>
										</a>
									{/if}
								{/each}
								{#if message.text}
									<p class="text-[13px] leading-snug break-words whitespace-pre-wrap">
										{message.text}
									</p>
								{/if}
								<p
									class="mt-0.5 text-right text-[9.5px] {message.mine
										? 'text-white/60'
										: 'text-[var(--ui-text-dimmed)]'}"
								>
									{timeAgo(message.createdAt)}
								</p>
							</div>
							<!-- Reply action: visible on hover / always on touch -->
							<button
								type="button"
								onclick={() => {
									replyTo = message;
									draftInput?.focus();
								}}
								class="grid size-7 shrink-0 place-items-center rounded-full text-[var(--ui-text-dimmed)] opacity-100 transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)] md:opacity-0 md:group-hover/msg:opacity-100"
								aria-label="Reply to {nameFor(message.pubkey)}"
								title="Reply"
							>
								<Icon name="i-lucide-message-circle-reply" class="size-3.5" />
							</button>
							{#if message.mine}
								<button
									type="button"
									disabled={unsendBusy}
									onclick={() => unsendMessage(message)}
									class="grid size-7 shrink-0 place-items-center rounded-full text-[var(--ui-text-dimmed)] opacity-100 transition hover:bg-[color-mix(in_oklab,var(--tone-error-text)_10%,transparent)] hover:text-[var(--tone-error-text)] disabled:opacity-40 md:opacity-0 md:group-hover/msg:opacity-100"
									aria-label="Unsend message"
									title="Unsend"
								>
									<Icon name="i-lucide-trash-2" class="size-3.5" />
								</button>
							{/if}
						</div>
					</div>
				{:else}
					<p class="py-8 text-center text-[12px] text-[var(--ui-text-dimmed)]">
						No messages yet — say hello 👋
					</p>
				{/each}
			</div>

			<div
				class="shrink-0 border-t border-[var(--ui-border-muted)] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
			>
				{#if replyTo}
					<!-- Reply composer bar -->
					<div
						class="mb-2 flex items-center gap-2 rounded-xl bg-[var(--ui-bg-muted)] px-3 py-1.5 text-[11.5px]"
					>
						<Icon name="i-lucide-corner-down-right" class="size-3.5 shrink-0 text-primary-500" />
						<span class="min-w-0 flex-1 truncate">
							<span class="font-bold">{nameFor(replyTo.pubkey)}</span>
							<span class="text-[var(--ui-text-dimmed)]"
								>&nbsp;{replyTo.text || (replyTo.media[0] ? '📎 attachment' : '')}</span
							>
						</span>
						<button
							type="button"
							onclick={() => (replyTo = null)}
							class="grid size-5 shrink-0 place-items-center rounded-full text-[var(--ui-text-dimmed)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
							aria-label="Cancel reply"
						>
							<Icon name="i-lucide-x" class="size-3" />
						</button>
					</div>
				{/if}
				{#if attachment}
					<!-- Pending attachment chip -->
					<div class="mb-2 flex items-center gap-2.5 rounded-xl bg-[var(--ui-bg-muted)] px-3 py-2">
						<Icon
							name={attachment.kind === 'image'
								? 'i-lucide-image'
								: attachment.kind === 'video'
									? 'i-lucide-video'
									: 'i-lucide-file'}
							class="size-4 shrink-0 text-primary-500"
						/>
						<span class="min-w-0 flex-1 truncate text-[12px] font-semibold"
							>{attachment.name ?? attachment.url}</span
						>
						<button
							type="button"
							onclick={() => (attachment = null)}
							class="grid size-5 shrink-0 place-items-center rounded-full text-[var(--ui-text-dimmed)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--tone-error-text)]"
							aria-label="Remove attachment"
						>
							<Icon name="i-lucide-x" class="size-3" />
						</button>
					</div>
				{/if}
				<div class="relative flex items-end gap-2">
					<!-- Quick emoji palette -->
					{#if emojiOpen}
						<button
							type="button"
							class="fixed inset-0 z-20 cursor-default"
							tabindex="-1"
							aria-label="Close emoji picker"
							onclick={() => (emojiOpen = false)}
						></button>
						<div
							class="absolute bottom-12 left-0 z-30 w-64 rounded-2xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] p-2 shadow-[var(--shadow-pop)]"
							role="menu"
							aria-label="Emoji picker"
						>
							<div class="mb-1.5 max-h-44 space-y-2 overflow-y-auto">
								{#each EMOJI_GROUPS as group (group.label)}
									<div>
										<p
											class="mb-1 text-[9.5px] font-bold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
										>
											{group.label}
										</p>
										<div class="grid grid-cols-8 gap-0.5">
											{#each group.emojis as emoji (emoji)}
												<button
													type="button"
													onclick={() => insertEmoji(emoji)}
													class="grid size-7 place-items-center rounded-lg text-[17px] transition hover:bg-[var(--ui-bg-muted)] active:scale-90"
													aria-label={`Insert ${emoji}`}
												>
													{emoji}
												</button>
											{/each}
										</div>
									</div>
								{/each}
							</div>
							<button
								type="button"
								onclick={() => (emojiOpen = false)}
								class="w-full rounded-lg py-1 text-[11px] font-bold text-[var(--ui-text-dimmed)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]"
							>
								Close
							</button>
						</div>
					{/if}
					<button
						type="button"
						onclick={() => (emojiOpen = !emojiOpen)}
						disabled={sending}
						class="grid size-10 shrink-0 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)] disabled:opacity-40"
						aria-label="Add emoji"
						title="Add emoji"
					>
						<Icon name="i-lucide-smile" class="size-[18px]" />
					</button>
					<input
						bind:this={fileInput}
						type="file"
						class="hidden"
						onchange={onFileChosen}
						accept="image/*,video/*,.pdf,.zip,.mp3,.wav,.ogg"
					/>
					<button
						type="button"
						onclick={() => fileInput?.click()}
						disabled={uploading || sending}
						class="grid size-10 shrink-0 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)] disabled:opacity-40"
						aria-label="Attach image or file"
						title="Attach image or file"
					>
						<Icon
							name={uploading ? 'i-lucide-loader-circle' : 'i-lucide-paperclip'}
							class="size-[18px] {uploading ? 'animate-spin' : ''}"
						/>
					</button>
					<textarea
						bind:this={draftInput}
						bind:value={draft}
						rows="1"
						placeholder="Message {activeGroup.name ?? 'the group'}…"
						disabled={sending}
						onkeydown={onKey}
						class="max-h-28 min-h-10 flex-1 resize-none rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3.5 py-2.5 text-[13px] transition outline-none placeholder:text-[var(--ui-text-dimmed)] focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:opacity-60"
					></textarea>
					<button
						type="button"
						onclick={send}
						disabled={(!draft.trim() && !attachment) || sending || uploading}
						aria-label="Send community message"
						class="grid size-10 shrink-0 place-items-center rounded-full bg-primary-500 text-white transition hover:bg-primary-600 active:scale-95 disabled:opacity-40"
					>
						<Icon
							name={sending ? 'i-lucide-loader-circle' : 'i-lucide-send'}
							class="size-[18px] {sending ? 'animate-spin' : ''}"
						/>
					</button>
				</div>
			</div>
		{:else}
			<div class="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
				<Icon name="i-lucide-users-round" class="size-8 text-[var(--ui-text-dimmed)]" />
				<p class="text-[13px] font-semibold text-[var(--ui-text-muted)]">
					Pick a community to start chatting
				</p>
				<p class="max-w-64 text-[11.5px] leading-relaxed text-[var(--ui-text-dimmed)]">
					Communities are public rooms hosted on relays — members from other Nostr apps join
					seamlessly.
				</p>
				<Button color="primary" variant="subtle" size="sm" onclick={() => (createOpen = true)}>
					<Icon name="i-lucide-plus" class="size-4" /> Create a community
				</Button>
			</div>
		{/if}
	</div>
</div>

<!-- ─── Join by id ─── -->
<Dialog bind:open={joinOpen} title="Join a community">
	<div class="space-y-3">
		<label class="block space-y-1">
			<span class="text-[12px] font-bold text-[var(--ui-text-muted)]">Group relay</span>
			<input
				bind:value={joinRelay}
				type="url"
				placeholder="wss://groups.0x.chat"
				class="w-full rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 py-2 font-mono text-[12.5px] outline-none focus:border-primary-500"
			/>
		</label>
		<label class="block space-y-1">
			<span class="text-[12px] font-bold text-[var(--ui-text-muted)]">Group id</span>
			<input
				bind:value={joinGroupId}
				placeholder="hex id or name (e.g. cheerful-straw-lotus)"
				class="w-full rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 py-2 font-mono text-[12.5px] outline-none focus:border-primary-500"
			/>
		</label>
		<p class="text-[11px] leading-snug text-[var(--ui-text-dimmed)]">
			Ask a community admin for their relay + group id, or use Discover to browse.
		</p>
	</div>
	{#snippet footer()}
		<Button color="neutral" variant="subtle" onclick={() => (joinOpen = false)}>Cancel</Button>
		<Button color="primary" onclick={doJoin} disabled={busy || !joinGroupId.trim()}>
			{busy ? 'Joining…' : 'Join'}
		</Button>
	{/snippet}
</Dialog>

<!-- ─── Discover ─── -->
<Dialog bind:open={discoverOpen} title="Discover communities">
	<div class="space-y-3">
		<div class="flex flex-wrap gap-1.5">
			{#each DEFAULT_GROUP_RELAYS as relay (relay)}
				<button
					type="button"
					onclick={() => (discoverRelay = relay)}
					class="rounded-full border px-2.5 py-1 font-mono text-[10.5px] transition {discoverRelay ===
					relay
						? 'border-primary-500 bg-primary-500/10 text-primary-600'
						: 'border-[var(--ui-border-muted)] text-[var(--ui-text-muted)] hover:border-primary-500/40'}"
				>
					{hostOf(relay)}
				</button>
			{/each}
		</div>
		<div class="flex gap-2">
			<input
				bind:value={discoverRelay}
				type="url"
				placeholder="wss://your-group-relay"
				class="min-w-0 flex-1 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 py-2 font-mono text-[12px] outline-none focus:border-primary-500"
			/>
			<Button color="primary" variant="subtle" size="sm" onclick={doDiscover} disabled={discovering}
				>Browse</Button
			>
		</div>
		{#if discovering}
			<p class="py-4 text-center text-[12px] text-[var(--ui-text-dimmed)]">
				<Icon name="i-lucide-loader-circle" class="mr-1 inline size-3.5 animate-spin" /> Loading communities…
			</p>
		{:else if listings.length}
			<div class="max-h-72 space-y-1.5 overflow-y-auto">
				{#each listings as listing (listing.id)}
					{#if groups.some((g) => g.id === listing.id && g.relay === listing.relay)}
						<div
							class="flex items-center justify-between gap-3 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3 py-2 opacity-60"
						>
							<div class="min-w-0">
								<p class="truncate text-[13px] font-bold">{listing.name}</p>
								<p class="truncate text-[11px] text-[var(--ui-text-dimmed)]">
									{listing.about ?? listing.id.slice(0, 20)}
								</p>
							</div>
							<span class="shrink-0 text-[11px] font-bold text-[var(--ui-text-dimmed)]">Joined</span
							>
						</div>
					{:else}
						<div
							class="flex items-center justify-between gap-3 rounded-xl border border-[var(--ui-border-muted)] px-3 py-2"
						>
							<div class="min-w-0">
								<p class="truncate text-[13px] font-bold">{listing.name}</p>
								<p class="truncate text-[11px] text-[var(--ui-text-dimmed)]">
									{listing.about ?? listing.id.slice(0, 20)}
								</p>
							</div>
							<Button
								color="primary"
								variant="subtle"
								size="sm"
								onclick={() => joinListing(listing)}>Join</Button
							>
						</div>
					{/if}
				{/each}
			</div>
		{:else if !discovering}
			<p class="py-3 text-center text-[11.5px] text-[var(--ui-text-dimmed)]">
				Pick a relay above and press Browse to list its public communities.
			</p>
		{/if}
	</div>
</Dialog>

<!-- ─── Create ─── -->
<Dialog bind:open={createOpen} title="Create a community">
	<div class="space-y-3">
		<label class="block space-y-1">
			<span class="text-[12px] font-bold text-[var(--ui-text-muted)]">Name</span>
			<input
				bind:value={createName}
				maxlength="80"
				placeholder="My community"
				class="w-full rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 py-2 text-[13px] outline-none focus:border-primary-500"
			/>
		</label>
		<label class="block space-y-1">
			<span class="text-[12px] font-bold text-[var(--ui-text-muted)]">Group relay</span>
			<input
				bind:value={createRelay}
				type="url"
				class="w-full rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 py-2 font-mono text-[12px] outline-none focus:border-primary-500"
			/>
		</label>
		<p class="text-[11px] leading-snug text-[var(--ui-text-dimmed)]">
			Creating needs admin permission on the relay (public relays grant it to anyone). You become
			the community admin and can pin the invite link anywhere.
		</p>
	</div>
	{#snippet footer()}
		<Button color="neutral" variant="subtle" onclick={() => (createOpen = false)}>Cancel</Button>
		<Button color="primary" onclick={doCreate} disabled={busy || !createName.trim()}>
			{busy ? 'Creating…' : 'Create'}
		</Button>
	{/snippet}
</Dialog>

<!-- ─── Members &amp; admins ─── -->
<Dialog bind:open={rosterOpen} title="Members">
	<div class="space-y-3">
		{#if rosterLoading}
			<p class="py-6 text-center text-[12px] text-[var(--ui-text-dimmed)]">
				<Icon name="i-lucide-loader-circle" class="mr-1 inline size-3.5 animate-spin" /> Loading roster
				from the relay…
			</p>
		{:else if !roster || (!roster.members.length && !roster.admins.length)}
			<p class="py-4 text-center text-[12px] text-[var(--ui-text-dimmed)]">
				This relay did not publish a member list (kinds 39001/39002). Members are still enforced
				server-side — the roster is simply private.
			</p>
		{:else}
			{#if roster.admins.length}
				<p class="text-[10.5px] font-bold tracking-wider text-[var(--ui-text-dimmed)] uppercase">
					Admins
				</p>
				<div class="space-y-1">
					{#each roster.admins as pk (pk)}
						<div class="flex items-center gap-2.5 rounded-xl px-2 py-1.5">
							<Avatar pubkey={pk} name={nameForRoster(pk)} size={30} />
							<a
								href="/profile/{pk}"
								class="min-w-0 flex-1 truncate text-[13px] font-bold hover:underline"
							>
								{nameForRoster(pk)}
							</a>
							<span
								class="grid size-5 shrink-0 place-items-center rounded-full bg-warm-500/15 text-warm-500"
								title="Admin"
							>
								<Icon name="i-lucide-crown" class="size-3" />
							</span>
							{#if isAdminHere && pk !== me?.pk?.toLowerCase()}
								<button
									type="button"
									disabled={adminBusy}
									onclick={() =>
										rosterAction(() => nip29.demoteAdmin(activeGroup!.id, pk), 'Admin removed', {
											title: `Revoke admin for ${nameForRoster(pk)}?`,
											message:
												'They keep their membership but lose the ability to manage the community.',
											confirmLabel: 'Revoke',
											icon: 'i-lucide-crown'
										})}
									class="shrink-0 rounded-full px-2 py-1 text-[10.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[color-mix(in_oklab,var(--tone-error-text)_10%,transparent)] hover:text-[var(--tone-error-text)] disabled:opacity-40"
								>
									Revoke
								</button>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
			{#if roster.members.length}
				<p
					class="pt-1 text-[10.5px] font-bold tracking-wider text-[var(--ui-text-dimmed)] uppercase"
				>
					Members · {roster.members.length}
				</p>
				<div class="max-h-56 space-y-1 overflow-y-auto">
					{#each roster.members.filter((pk) => !roster!.admins.includes(pk)) as pk (pk)}
						<div class="flex items-center gap-2.5 rounded-xl px-2 py-1.5">
							<Avatar pubkey={pk} name={nameForRoster(pk)} size={30} />
							<a
								href="/profile/{pk}"
								class="min-w-0 flex-1 truncate text-[13px] font-semibold hover:underline"
							>
								{nameForRoster(pk)}
							</a>
							{#if isAdminHere && pk !== me?.pk?.toLowerCase()}
								<button
									type="button"
									disabled={adminBusy}
									onclick={() =>
										rosterAction(
											() => nip29.promoteToAdmin(activeGroup!.id, pk),
											'Promoted to admin'
										)}
									class="shrink-0 rounded-full px-2 py-1 text-[10.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-primary-500/10 hover:text-primary-600 disabled:opacity-40"
								>
									Make admin
								</button>
								<button
									type="button"
									disabled={adminBusy}
									onclick={() =>
										rosterAction(() => nip29.removeMember(activeGroup!.id, pk), 'Member removed', {
											title: `Kick ${nameForRoster(pk)}?`,
											message:
												'The relay removes their access immediately. For closed groups they cannot re-join without a new invite.',
											confirmLabel: 'Kick',
											icon: 'i-lucide-user-minus'
										})}
									class="shrink-0 rounded-full px-2 py-1 text-[10.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[color-mix(in_oklab,var(--tone-error-text)_10%,transparent)] hover:text-[var(--tone-error-text)] disabled:opacity-40"
								>
									Kick
								</button>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
			<p class="text-[10.5px] leading-snug text-[var(--ui-text-dimmed)]">
				Actions publish NIP-29 admin events (kinds 9000–9004) — the group relay enforces permissions{#if !isAdminHere}.
					You are not an admin here, so this view is read-only{/if}.
			</p>
		{/if}
	</div>
</Dialog>

<!-- ─── Rename / edit metadata (admin) ─── -->
<Dialog bind:open={renameOpen} title="Edit community">
	<div class="space-y-3">
		<label class="block space-y-1">
			<span class="text-[12px] font-bold text-[var(--ui-text-muted)]">Name</span>
			<input
				bind:value={renameName}
				maxlength="80"
				class="w-full rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 py-2 text-[13px] outline-none focus:border-primary-500"
			/>
		</label>
		<label class="block space-y-1">
			<span class="text-[12px] font-bold text-[var(--ui-text-muted)]">About</span>
			<textarea
				bind:value={renameAbout}
				rows="2"
				maxlength="500"
				class="w-full resize-none rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 py-2 text-[13px] outline-none focus:border-primary-500"
			></textarea>
		</label>
		<label class="block space-y-1">
			<span class="text-[12px] font-bold text-[var(--ui-text-muted)]">Picture URL</span>
			<input
				bind:value={renamePicture}
				type="url"
				placeholder="https://…"
				class="w-full rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg-muted)] px-3 py-2 font-mono text-[12px] outline-none focus:border-primary-500"
			/>
		</label>
		<p class="text-[11px] leading-snug text-[var(--ui-text-dimmed)]">
			Publishes a kind 9002 metadata edit — the relay updates its kind 39000 announcement, so every
			client sees the new name.
		</p>
	</div>
	{#snippet footer()}
		<Button color="neutral" variant="subtle" onclick={() => (renameOpen = false)}>Cancel</Button>
		<Button color="primary" onclick={saveRename} disabled={adminBusy || !renameName.trim()}>
			{adminBusy ? 'Saving…' : 'Save'}
		</Button>
	{/snippet}
</Dialog>
