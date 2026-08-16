<script lang="ts">
	import { onMount, tick } from 'svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import NotificationMedia from '$lib/components/feed/NotificationMedia.svelte';
	import OriginNotePreview from '$lib/components/feed/OriginNotePreview.svelte';
	import { notifications } from '$lib/nostr/notifications.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { popovers } from '$lib/stores/popovers.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { dayLabel, shortKey, timeAgo, timeFull } from '$lib/utils/format';
	import {
		cleanNotificationPreview,
		extractNotificationMedia,
		type ImageMeta
	} from '$lib/utils/imeta';
	import { parseContent } from '$lib/utils/note-content';
	import { decode as decodeBech32 } from 'nostr-tools/nip19';
	import { getPow } from 'nostr-tools/nip13';
	import PowBadge from '$lib/components/ui/PowBadge.svelte';
	import type { NotificationItem } from '$lib/nostr/types';

	type Filter = 'all' | 'unread' | 'mention' | 'zap' | 'like' | 'repost' | 'follow' | 'comment';

	/** Semantic per-type presentation config (icon + accent color + verb). */
	const TYPE_META: Record<NotificationItem['type'], { icon: string; color: string; verb: string }> =
		{
			like: { icon: 'i-lucide-heart', color: 'var(--color-warm-500)', verb: 'liked your note' },
			comment: {
				icon: 'i-lucide-message-circle',
				color: 'var(--ui-color-primary-500)',
				verb: 'commented on your note'
			},
			repost: {
				icon: 'i-lucide-repeat-2',
				color: 'var(--color-accent-500)',
				verb: 'reposted your note'
			},
			follow: {
				icon: 'i-lucide-user-plus',
				color: 'var(--ui-color-primary-500)',
				verb: 'followed you'
			},
			mention: {
				icon: 'i-lucide-at-sign',
				color: 'var(--ui-color-primary-500)',
				verb: 'mentioned you'
			},
			zap: { icon: 'i-lucide-zap', color: 'var(--color-warm-500)', verb: 'sent you a zap' }
		};

	function verbFor(item: NotificationItem) {
		if (item.type === 'like' && item.targetKind === 'comment') return 'liked your comment';
		if (item.type === 'comment' && item.targetKind === 'comment') return 'replied to your comment';
		return TYPE_META[item.type].verb;
	}

	const PRIMARY_FILTERS: { key: Filter; label: string }[] = [
		{ key: 'all', label: 'All' },
		{ key: 'unread', label: 'Unread' },
		{ key: 'mention', label: 'Mentions' },
		{ key: 'comment', label: 'Replies' }
	];

	const ACTIVITY_FILTERS: { key: Filter; label: string; icon?: string }[] = [
		{ key: 'zap', label: 'Zaps', icon: 'i-lucide-zap' },
		{ key: 'like', label: 'Likes' },
		{ key: 'repost', label: 'Reposts', icon: 'i-lucide-repeat-2' },
		{ key: 'follow', label: 'Follows', icon: 'i-lucide-user-plus' }
	];

	let filter = $state<Filter>('all');
	let query = $state('');
	let mobileSearchOpen = $state(false);
	let rawOpen = $state(false);
	let rawEvent = $state('');

	const unread = $derived(notifications.unreadCount);

	function countFor(filterKey: Filter) {
		if (filterKey === 'unread') return unread;
		if (filterKey === 'all') return notifications.visible.length;
		return notifications.countByType[filterKey] ?? 0;
	}

	const filtered = $derived(
		notifications.visible.filter((item) => {
			if (filter === 'unread' && item.read) return false;
			if (filter !== 'all' && filter !== 'unread' && item.type !== filter) return false;
			if (!query.trim()) return true;
			const q = query.trim().toLowerCase();
			const name = actorName(item.pubkey).toLowerCase();
			return name.includes(q) || item.content.toLowerCase().includes(q);
		})
	);

	/** Fold consecutive same-type + same-target items into a single row (iOS-style). */
	type Row =
		| { kind: 'single'; item: NotificationItem }
		| { kind: 'group'; items: NotificationItem[]; first: NotificationItem };

	type Section = { label: string; rows: Row[] };

	const sections = $derived.by<Section[]>(() => {
		const out: Section[] = [];
		let currentDay = '';
		let current: Section | null = null;

		const flushGroup = (buf: NotificationItem[]) => {
			if (!buf.length || !current) return;
			if (buf.length === 1) current.rows.push({ kind: 'single', item: buf[0] });
			else current.rows.push({ kind: 'group', items: [...buf], first: buf[0] });
		};

		let buf: NotificationItem[] = [];
		let lastKey = '';
		for (const item of filtered) {
			const day = dayLabel(item.createdAt);
			if (day !== currentDay) {
				flushGroup(buf);
				buf = [];
				lastKey = '';
				currentDay = day;
				current = { label: day, rows: [] };
				out.push(current);
			}
			const key = `${item.type}:${item.targetId ?? ''}`;
			// Aggregate only likes/comments/reposts/zaps that target the same note.
			const aggregatable = item.type !== 'follow';
			if (aggregatable && key === lastKey) {
				buf.push(item);
			} else {
				flushGroup(buf);
				buf = [item];
				lastKey = aggregatable ? key : '';
			}
		}
		flushGroup(buf);
		return out;
	});

	/** Track which items were present when the list opened, so live new arrivals
	 *  stay unread (mimics iMessage/Telegram "mark existing read on view"). */
	let seenAt = $state(0);

	$effect(() => {
		// When the relay finishes its initial batch, snapshot the cutoff time
		// and mark everything up to it as read shortly after.
		if (notifications.connected && !notifications.loading && !seenAt) {
			const cutoff = notifications.visible[0]?.createdAt ?? 0;
			seenAt = cutoff;
			const ids = notifications.visible
				.filter((item) => item.createdAt <= cutoff)
				.map((item) => item.id);
			const t = setTimeout(() => notifications.markVisibleRead(ids), 1400);
			return () => clearTimeout(t);
		}
	});

	function actorName(pubkey: string) {
		const profile = profiles.get(pubkey);
		return profile?.display_name || profile?.name || shortKey(pubkey);
	}

	/** Whether an actor has a verified NIP-05 handle (for the badge check). */
	function hasNip05(pubkey: string): boolean {
		return !!profiles.get(pubkey)?.nip05;
	}

	/** Resolve inline `nostr:npub1…` / `nprofile1…` mentions to `@name` plain
	 *  text (no links — the whole card is already a single anchor). */
	function resolveMentions(text: string): string {
		return parseContent(text)
			.map((token) => {
				if (token.type !== 'nostr') return token.value;
				const raw = token.value.startsWith('nostr:') ? token.value.slice(6) : token.value;
				let decoded;
				try {
					decoded = decodeBech32(raw);
				} catch {
					return shortKey(raw, 12, 6);
				}
				let pubkey: string | undefined;
				if (decoded.type === 'npub') pubkey = decoded.data as string;
				else if (decoded.type === 'nprofile') pubkey = (decoded.data as { pubkey: string }).pubkey;
				if (pubkey) {
					const profile = profiles.get(pubkey);
					return '@' + (profile?.display_name || profile?.name || shortKey(pubkey));
				}
				return shortKey(raw, 12, 6);
			})
			.join('');
	}

	/** "Alice, Bob and 3 others" — unique by pubkey, capped for readout. */
	function actorSummary(items: NotificationItem[]): { actors: NotificationItem[]; extra: number } {
		const actors: NotificationItem[] = [];
		const seen: string[] = [];
		for (const item of items) {
			if (seen.includes(item.pubkey)) continue;
			seen.push(item.pubkey);
			actors.push(item);
			if (actors.length === 2) break;
		}
		const extra = items.length - actors.length;
		return { actors, extra };
	}

	/** Cached media extraction per notification so live re-renders stay cheap.
	 *  A plain object (not SvelteMap) on purpose: it's a memo, never rendered. */
	const mediaCache: Record<string, ImageMeta[]> = {};

	/** Mined difficulty of the *incoming* event itself (nonce-tagged only),
	 *  memoized per id. `item.id` is the event id, so its leading zeros are
	 *  the receipt — same micro-badge treatment as the comment list. */
	const powCache: Record<string, number | undefined> = {};
	function powFor(item: NotificationItem): number | undefined {
		if (item.id in powCache) return powCache[item.id];
		const nonce = item.raw?.tags?.find((t) => t[0] === 'nonce');
		const bits = nonce ? getPow(item.id) : undefined;
		powCache[item.id] = bits;
		return bits;
	}

	function preview(item: NotificationItem) {
		if (item.type === 'like') return item.content || '❤️';
		if (item.type === 'follow') return '';
		if (item.type === 'zap') return item.content || '';
		// Strip image/video URLs (and any imeta-referenced media) so the preview
		// reads as prose, then resolve inline mentions to readable @names.
		const body = resolveMentions(
			cleanNotificationPreview({
				content: item.content,
				tags: item.raw?.tags ?? []
			})
		);
		return body.length > 140 ? `${body.slice(0, 140).trimEnd()}…` : body;
	}

	function mediaFor(item: NotificationItem): ImageMeta[] {
		const cached = mediaCache[item.id];
		if (cached) return cached;
		const parsed = item.raw ? extractNotificationMedia(item.raw) : [];
		mediaCache[item.id] = parsed;
		return parsed;
	}

	function profileLink(pubkey: string) {
		return `/profile/${pubkey}`;
	}

	/** Link the notification body to the note/event that caused it, when available. */
	function sourceLink(item: NotificationItem) {
		const sourceId = item.targetId ?? (item.type === 'mention' ? item.id : undefined);
		return sourceId ? `/note/${sourceId}` : undefined;
	}

	async function copyTarget(item: NotificationItem) {
		try {
			await navigator.clipboard.writeText(item.targetId ?? item.pubkey);
			toasts.success(item.targetId ? 'Note id copied' : 'Profile id copied');
		} catch {
			toasts.error('Could not copy id');
		}
		popovers.close();
	}

	async function copyRawEvent() {
		try {
			await navigator.clipboard.writeText(rawEvent);
			toasts.success('Raw event copied');
		} catch {
			toasts.error('Could not copy raw event');
		}
	}

	function rawEventJson(item: NotificationItem) {
		return JSON.stringify(
			item.raw ?? {
				id: item.id,
				type: item.type,
				pubkey: item.pubkey,
				targetId: item.targetId,
				content: item.content,
				createdAt: item.createdAt,
				amountSats: item.amountSats
			},
			null,
			2
		);
	}

	function viewRawEvent(item: NotificationItem) {
		rawEvent = rawEventJson(item);
		rawOpen = true;
		popovers.close();
	}

	function openRow(item: NotificationItem) {
		notifications.markRead(item.id);
	}

	function muteType(type: NotificationItem['type']) {
		notifications.toggleMute(type);
		const meta = TYPE_META[type];
		const muted = notifications.muted.has(type);
		toasts.info(`${muted ? 'Muted' : 'Unmuted'} ${meta.verb.split(' ')[0]} notifications`);
		popovers.close();
	}

	onMount(() => {
		// Reset the "seen" cutoff when navigating away and back.
		return () => {
			seenAt = 0;
		};
	});

	// Keep sections in view when new live items arrive above the fold.
	let listEl: HTMLDivElement | undefined = $state();
	$effect(() => {
		void notifications.visible.length;
		void tick();
		if (listEl) listEl.scrollTop = listEl.scrollTop; // no-op ref to keep linter calm
	});
</script>

<svelte:head>
	<title>Notifications · BitOS</title>
</svelte:head>

<div class="flex h-full">
	<div bind:this={listEl} class="min-w-0 flex-1 overflow-y-auto">
		<PageHeader title="Notifications">
			{#snippet subtitle()}
				<span class="inline-flex items-center gap-1">
					{#if notifications.connected}
						<span class="live-dot"></span>
						Live
					{:else if notifications.loading}
						<Icon name="i-lucide-loader-circle" class="size-3 animate-spin" />
						Connecting…
					{:else}
						<span class="size-1.5 rounded-full bg-[var(--tone-error-text)]"></span>
						Offline
					{/if}
				</span>
				· {unread} unread · {notifications.visible.length} activities
			{/snippet}
			{#snippet actions()}
				<button
					type="button"
					onclick={() => (mobileSearchOpen = !mobileSearchOpen)}
					class="icon-btn size-9 sm:hidden {mobileSearchOpen ? 'is-active' : ''}"
					aria-label="Search notifications"
					aria-expanded={mobileSearchOpen}
				>
					<Icon name={mobileSearchOpen ? 'i-lucide-x' : 'i-lucide-search'} class="size-[18px]" />
				</button>
				<button
					type="button"
					onclick={() => notifications.markAllRead()}
					disabled={!unread}
					class="icon-btn size-9 disabled:pointer-events-none disabled:opacity-40"
					aria-label="Mark all read"
					title="Mark all notifications as read"
				>
					<Icon name="i-lucide-check-check" class="size-[18px]" />
				</button>
			{/snippet}
			{#snippet tabs()}
				<div class="flex w-full min-w-max items-center gap-1 px-[clamp(1rem,3vw,1.5rem)]">
					<div class="flex items-center gap-1" role="tablist" aria-label="Notification filters">
						{#each PRIMARY_FILTERS as f (f.key)}
							{@const n = countFor(f.key)}
							<button
								type="button"
								role="tab"
								aria-selected={filter === f.key}
								onclick={() => (filter = f.key)}
								class="relative shrink-0 px-3 py-2.5 text-[12px] font-bold transition {filter ===
								f.key
									? 'text-primary-600'
									: 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
							>
								{f.label}{#if f.key !== 'all' && n}<span
										class="ml-1.5 font-mono text-[10px] opacity-70">{n}</span
									>{/if}
								{#if filter === f.key}<span
										class="absolute right-2 bottom-0 left-2 h-0.5 rounded-full bg-primary-500"
									></span>{/if}
							</button>
						{/each}
					</div>
					<div
						class="ml-auto hidden w-[180px] shrink-0 items-center gap-2 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-3 py-1.5 sm:flex"
					>
						<Icon name="i-lucide-search" class="size-3.5 shrink-0 text-[var(--ui-text-dimmed)]" />
						<input
							type="search"
							bind:value={query}
							placeholder="Search activity…"
							aria-label="Search notifications"
							class="w-full bg-transparent text-[12px] outline-none placeholder:text-[var(--ui-text-dimmed)]"
						/>
					</div>
				</div>
			{/snippet}
		</PageHeader>
		{#if mobileSearchOpen}
			<div class="border-b border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-4 py-2.5 sm:hidden">
				<div
					class="flex items-center gap-2 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-3 py-2"
				>
					<Icon name="i-lucide-search" class="size-4 shrink-0 text-[var(--ui-text-dimmed)]" />
					<input
						type="search"
						bind:value={query}
						placeholder="Search activity…"
						class="w-full bg-transparent text-[13px] outline-none placeholder:text-[var(--ui-text-dimmed)]"
					/>
				</div>
			</div>
		{/if}
		<div class="page-container page-container--notifications py-4">
			<div class="mb-5">
				<div class="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
					<span
						class="shrink-0 text-[11px] font-bold tracking-[0.06em] text-[var(--ui-text-dimmed)] uppercase"
						>Activity types</span
					>
					<div
						class="flex w-full [scrollbar-width:none] items-center gap-1 overflow-x-auto [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
						role="tablist"
						aria-label="Activity type filters"
					>
						{#each ACTIVITY_FILTERS as f (f.key)}
							{@const n = countFor(f.key)}
							<button
								type="button"
								role="tab"
								aria-selected={filter === f.key}
								onclick={() => (filter = f.key)}
								class:active={filter === f.key}
								class="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-semibold text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)] {filter ===
								f.key
									? 'bg-primary-500/10 text-primary-600'
									: ''}"
							>
								{#if f.icon}<Icon name={f.icon} class="size-3.5" />{/if}
								{f.label}
								{#if n}<span
										class="inline-grid h-4.5 min-w-4.5 place-items-center rounded-full bg-[var(--ui-bg-accented)] px-1 text-[10px] leading-none font-bold text-[var(--ui-text-muted)]"
										>{n}</span
									>{/if}
							</button>
						{/each}
					</div>
				</div>
			</div>

			<!-- States -->
			{#if notifications.loading && !notifications.items.length}
				<div class="flex flex-col items-center gap-3 py-20 text-center">
					<div
						class="size-7 animate-spin rounded-full border-2 border-[var(--ui-border)] border-t-primary-500"
					></div>
					<p class="text-[13px] text-[var(--ui-text-muted)]">Loading activity from relays…</p>
				</div>
			{:else if !notifications.connected && !notifications.items.length}
				<div class="post-card flex flex-col items-center gap-3 py-16 text-center">
					<div
						class="grid size-14 place-items-center rounded-2xl bg-[var(--tone-error-bg)] text-[var(--tone-error-text)]"
					>
						<Icon name="i-lucide-wifi-off" class="size-7" />
					</div>
					<div>
						<p class="text-[15px] font-semibold">Couldn't reach relays</p>
						<p class="mt-1 text-[13px] text-[var(--ui-text-muted)]">
							We'll keep retrying, or tap below to try again.
						</p>
					</div>
					<button
						type="button"
						onclick={() => notifications.start()}
						class="mt-1 inline-flex items-center gap-2 rounded-full bg-primary-500 px-4 py-2 text-[12.5px] font-bold text-white shadow-[var(--glow-primary)] transition hover:bg-primary-600"
					>
						<Icon name="i-lucide-refresh-ccw" class="size-4" />
						Reconnect
					</button>
				</div>
			{:else if !filtered.length}
				<div class="post-card flex flex-col items-center gap-3 py-16 text-center">
					<div
						class="grid size-14 place-items-center rounded-2xl bg-[var(--ui-bg-muted)] text-[var(--ui-text-dimmed)]"
					>
						<Icon
							name={query || filter !== 'all' ? 'i-lucide-search-x' : 'i-lucide-bell'}
							class="size-7"
						/>
					</div>
					<div>
						<p class="text-[15px] font-semibold">
							{query || filter !== 'all' ? 'No matching activity' : 'No notifications yet'}
						</p>
						<p class="mt-1 text-[13px] text-[var(--ui-text-muted)]">
							{query || filter !== 'all'
								? 'Try a different filter or search term.'
								: 'Likes, comments, reposts, mentions, zaps and follows will appear here.'}
						</p>
					</div>
				</div>
			{:else}
				<!-- Live region: screen readers announce fresh activity -->
				<div role="log" aria-live="polite" aria-atomic="false" class="notifications-list space-y-5">
					{#each sections as section (section.label)}
						<section>
							<h2
								class="mb-2 text-[11px] font-bold tracking-[0.08em] text-[var(--ui-text-dimmed)] uppercase"
							>
								{section.label}
							</h2>
							<div>
								{#each section.rows as row (row.kind === 'group' ? row.first.id : row.item.id)}
									{@const item = row.kind === 'group' ? row.first : row.item}
									{@const meta = TYPE_META[item.type]}
									{@const profile = profiles.get(item.pubkey)}
									{@const menuId = `notif:${item.id}`}
									{@const menuOpen = popovers.isOpen(menuId)}
									<article
										class="post-card relative overflow-visible transition hover:border-primary-500/25 {menuOpen
											? 'z-30'
											: 'z-0'} {!item.read ? 'notification-row--unread' : ''}"
										style={!item.read ? `--notification-accent: ${meta.color}` : undefined}
									>
										<!-- Unread accent stripe -->
										{#if !item.read}
											<span
												class="notification-accent absolute top-0 bottom-0 left-0 z-10 w-[3px]"
												style="background:var(--notification-accent)"
											></span>
										{/if}

										<div class="flex items-start gap-3 py-3.5 pr-12">
											<div class="relative shrink-0">
												{#if row.kind === 'group'}
													{@const actors = row.items.slice(0, 3)}
													<div class="flex -space-x-2">
														{#each actors as g, i (g.id)}
															<a
																href={profileLink(g.pubkey)}
																onclick={() => openRow(g)}
																class="hex-clip relative shrink-0 bg-[var(--surface-bg)] p-[2px] transition hover:z-20 hover:bg-primary-500/40"
																style="z-index:{10 - i}"
																aria-label={`View ${actorName(g.pubkey)}'s profile`}
															>
																<Avatar
																	pubkey={g.pubkey}
																	name={actorName(g.pubkey)}
																	picture={profiles.get(g.pubkey)?.picture}
																	size={40}
																	shape="hex"
																/>
															</a>
														{/each}
													</div>
													<span
														class="absolute -right-1 -bottom-1 z-20 grid size-5 place-items-center rounded-full text-white ring-2 ring-[var(--surface-bg)]"
														style="background:{meta.color}"
													>
														<Icon name={meta.icon} class="size-3" />
													</span>
												{:else}
												<a
													href={profileLink(item.pubkey)}
													onclick={() => openRow(item)}
													class="hex-clip block size-12 shrink-0 bg-[var(--surface-bg)] p-[2px] transition hover:bg-primary-500/40"
														aria-label={`View ${actorName(item.pubkey)}'s profile`}
													>
														<Avatar
															pubkey={item.pubkey}
															name={actorName(item.pubkey)}
															picture={profile?.picture}
															size={44}
															shape="hex"
														/>
													</a>
													<span
														class="absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full text-white ring-2 ring-[var(--surface-bg)]"
														style="background:{meta.color}"
													>
														<Icon name={meta.icon} class="size-3" />
													</span>
												{/if}
											</div>

											<div class="min-w-0 flex-1">
												<div class="flex min-w-0 items-start justify-between gap-3">
													<p class="min-w-0 text-[14px] leading-snug">
														{#if row.kind === 'group'}
															{@const { actors: summaryActors, extra } = actorSummary(row.items)}
															{#each summaryActors as actor, i (actor.id)}
																<a
																	href={profileLink(actor.pubkey)}
																	onclick={() => openRow(actor)}
																	class="font-bold hover:text-primary-500"
																	>{actorName(actor.pubkey)}</a
																>
																{#if i === 0 && summaryActors.length > 1}<span class="font-bold"
																		>,
																	</span>{/if}
															{/each}
															{#if extra > 0}
																<span class="font-bold">
																	and {extra} other{extra > 1 ? 's' : ''}</span
																>
															{/if}
															{#if sourceLink(row.first)}
																<a
																	href={sourceLink(row.first)}
																	onclick={() => openRow(row.first)}
																	class="text-[var(--ui-text-muted)] hover:text-primary-500"
																	>{verbFor(row.first)}</a
																>
															{:else}
																<span class="text-[var(--ui-text-muted)]">
																	{verbFor(row.first)}</span
																>
															{/if}
														{:else}
															<span class="inline-flex items-center gap-1 align-text-bottom">
																<a
																	href={profileLink(item.pubkey)}
																	onclick={() => openRow(item)}
																	class="font-bold hover:text-primary-500">{actorName(item.pubkey)}</a
																>
																{#if hasNip05(item.pubkey)}
																	<Icon
																		name="i-lucide-badge-check"
																		class="size-3.5 shrink-0 text-primary-500"
																	/>
																{/if}
															</span>
															{#if identity.current?.pk === item.pubkey}
																<span
																	class="rounded-full bg-primary-500/15 px-1.5 py-px text-[9px] font-bold text-primary-600 uppercase"
																	>you</span
																>
															{/if}
															{#if powFor(item)}
																<PowBadge bits={powFor(item) ?? 0} micro id={item.id} />
															{/if}
															{#if sourceLink(item)}
																<a
																	href={sourceLink(item)}
																	onclick={() => openRow(item)}
																	class="text-[var(--ui-text-muted)] hover:text-primary-500"
																	>{verbFor(item)}</a
																>
															{:else}
																<span class="text-[var(--ui-text-muted)]"> {verbFor(item)}</span>
															{/if}
															{#if item.type === 'zap' && item.amountSats}
																<span
																	class="ml-1 inline-flex items-center gap-1 font-bold text-[var(--color-warm-500)]"
																>
																	<Icon name="i-lucide-zap" class="size-3.5" />
																	{item.amountSats.toLocaleString()} sats
																</span>
															{/if}
														{/if}
													</p>
													<div class="mt-0.5 flex shrink-0 items-center gap-2">
														<time
															class="text-[11px] text-[var(--ui-text-dimmed)]"
															title={timeFull(item.createdAt)}
														>
															{timeAgo(item.createdAt)}
														</time>
														{#if !item.read}
															<span class="size-2 rounded-full bg-primary-500"></span>
														{/if}
													</div>
												</div>

												{#if preview(item)}
													{#if sourceLink(item)}
														<a
															href={sourceLink(item)}
															onclick={() => openRow(item)}
															class="mt-1 line-clamp-2 block text-[13px] leading-relaxed break-words text-[var(--ui-text-muted)] hover:text-primary-500"
														>
															{preview(item)}
														</a>
													{:else}
														<p
															class="mt-1 line-clamp-2 text-[13px] leading-relaxed break-words text-[var(--ui-text-muted)]"
														>
															{preview(item)}
														</p>
													{/if}
												{/if}

												{#if item.targetId && ['like', 'comment', 'mention', 'repost', 'zap'].includes(item.type)}
													<OriginNotePreview noteId={item.targetId} />
												{/if}
											</div>
										</div>

										{#if row.kind === 'single' && mediaFor(item).length}
											{@const media = mediaFor(item)}
											<!-- Media is a sibling of the row content so its zoom buttons don't nest
										     inside the link (matches PostCard's separation pattern). -->
											<div class="pb-3.5 pl-[56px]">
												<NotificationMedia
													{media}
													tags={item.raw?.tags ?? []}
													content={item.content}
												/>
											</div>
										{/if}

										<!-- The overflow action uses the same far-right column as the page-level actions. -->
										<div
											class="absolute top-2.5 z-20 shrink-0"
											style={item.read
												? 'right:calc(0.625rem - clamp(1rem, 3vw, 1.5rem))'
												: 'right:0.625rem'}
										>
											{@render notificationActions()}
										</div>

										<!-- The menu remains outside all row links. -->
										{#snippet notificationActions()}
											<div class="relative z-20 shrink-0">
												<button
													type="button"
													onclick={(e) => {
														e.preventDefault();
														e.stopPropagation();
														popovers.toggle(menuId);
													}}
													class="grid size-8 place-items-center rounded-lg text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] {menuOpen
														? 'bg-[var(--interactive-hover-bg)] text-[var(--ui-text)]'
														: ''}"
													aria-label="Notification actions"
													aria-expanded={menuOpen}
												>
													<Icon name="i-lucide-ellipsis" class="size-[18px]" />
												</button>
												{#if menuOpen}
													<div
														class="absolute top-9 right-0 z-50 w-52 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] p-1.5 shadow-[var(--shadow-pop)]"
														role="menu"
													>
														{#if !item.read}
															<button
																type="button"
																role="menuitem"
																onclick={() => {
																	notifications.markRead(item.id);
																	popovers.close();
																}}
																class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
															>
																<Icon name="i-lucide-check" class="size-4 shrink-0" />
																Mark as read
															</button>
														{/if}
														<a
															href={`/profile/${item.pubkey}`}
															role="menuitem"
															class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
														>
															<Icon name="i-lucide-user" class="size-4 shrink-0" />
															View profile
														</a>
														<button
															type="button"
															role="menuitem"
															onclick={() => copyTarget(item)}
															class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
														>
															<Icon name="i-lucide-fingerprint" class="size-4 shrink-0" />
															{item.targetId ? 'Copy note id' : 'Copy profile id'}
														</button>
														<button
															type="button"
															role="menuitem"
															onclick={() => viewRawEvent(item)}
															class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
														>
															<Icon name="i-lucide-code-2" class="size-4 shrink-0" />
															View raw event
														</button>
														<button
															type="button"
															role="menuitem"
															onclick={() => muteType(item.type)}
															class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
														>
															<Icon
																name={notifications.muted.has(item.type)
																	? 'i-lucide-bell-ring'
																	: 'i-lucide-bell-off'}
																class="size-4 shrink-0"
															/>
															{notifications.muted.has(item.type)
																? 'Unmute this type'
																: 'Mute this type'}
														</button>
													</div>
												{/if}
											</div>
										{/snippet}
									</article>
								{/each}
							</div>
						</section>
					{/each}
				</div>

				<div class="py-8 text-center">
					<button
						type="button"
						onclick={() => notifications.loadMore()}
						disabled={notifications.loadingMore || !notifications.hasMore}
						class="inline-flex items-center justify-center gap-2 rounded-full border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-6 py-2.5 text-[13px] font-semibold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-accented)] disabled:cursor-default disabled:opacity-60 disabled:hover:bg-[var(--surface-bg)]"
					>
						{#if notifications.loadingMore}
							<Icon name="i-lucide-loader-circle" class="size-4 animate-spin" />
							Loading older activity
						{:else if notifications.hasMore}
							Load older notifications
						{:else}
							End of relay results
						{/if}
					</button>
				</div>
			{/if}
		</div>
	</div>
</div>

<Dialog bind:open={rawOpen} title="Raw event">
	<div class="space-y-3">
		<div class="flex items-center gap-2">
			<button
				type="button"
				onclick={copyRawEvent}
				class="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-3 py-2 text-[12px] font-bold text-white transition hover:bg-primary-600"
			>
				<Icon name="i-lucide-copy" class="size-4" />
				Copy JSON
			</button>
		</div>
		<pre
			class="max-h-[52vh] overflow-auto rounded-xl bg-[var(--ui-bg-muted)] p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-[var(--ui-text-muted)]">{rawEvent}</pre>
	</div>
</Dialog>
