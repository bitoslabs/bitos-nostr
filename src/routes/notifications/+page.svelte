<script lang="ts">
	import { onMount, tick } from 'svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { notifications } from '$lib/nostr/notifications.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { popovers } from '$lib/stores/popovers.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { dayLabel, shortKey, timeAgo, timeFull } from '$lib/utils/format';
	import type { NotificationItem } from '$lib/nostr/types';

	type Filter = 'all' | 'unread' | 'mention';

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

	const FILTER_LABELS: { key: Filter; label: string }[] = [
		{ key: 'all', label: 'All' },
		{ key: 'unread', label: 'Unread' },
		{ key: 'mention', label: 'Mentions' }
	];

	let filter = $state<Filter>('all');
	let query = $state('');
	let rawOpen = $state(false);
	let rawEvent = $state('');

	const unread = $derived(notifications.unreadCount);

	const filtered = $derived(
		notifications.visible.filter((item) => {
			if (filter === 'unread' && item.read) return false;
			if (filter === 'mention' && item.type !== 'mention') return false;
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

	/** "Alice, Bob and 3 others" — unique by pubkey, capped for readout. */
	function actorSummary(items: NotificationItem[]): { names: string; extra: number } {
		const names: string[] = [];
		const seen: string[] = [];
		for (const item of items) {
			if (seen.includes(item.pubkey)) continue;
			seen.push(item.pubkey);
			names.push(actorName(item.pubkey));
			if (names.length === 2) break;
		}
		const extra = items.length - names.length;
		return { names: names.join(', '), extra };
	}

	function preview(item: NotificationItem) {
		if (item.type === 'like') return item.content || '❤️';
		if (item.type === 'follow') return '';
		if (item.type === 'zap') return item.content || '';
		const body = item.content.trim().replace(/\s+/g, ' ');
		return body.length > 140 ? `${body.slice(0, 140).trimEnd()}…` : body;
	}

	function targetLink(item: NotificationItem) {
		return item.targetId ? `/note/${item.targetId}` : `/profile/${item.pubkey}`;
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

<div bind:this={listEl} class="h-full overflow-y-auto">
	<div class="mx-auto max-w-[720px] px-5 py-6">
		<!-- Header -->
		<header class="mb-4 flex items-center justify-between gap-4">
			<div>
				<h1 class="font-display text-[32px] leading-none font-extrabold tracking-tight">
					Notifications
				</h1>
				<p class="mt-1.5 text-[12px] text-[var(--ui-text-muted)]">
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
				</p>
			</div>
			<button
				type="button"
				onclick={() => notifications.markAllRead()}
				disabled={!unread}
				class="inline-flex items-center gap-2 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-3 py-2 text-[12px] font-bold text-[var(--ui-text-muted)] transition hover:text-primary-500 disabled:pointer-events-none disabled:opacity-50"
			>
				<Icon name="i-lucide-check-check" class="size-4" />
				Mark read
			</button>
		</header>

		<!-- Filters + search -->
		<div class="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
			<div class="flex flex-wrap gap-1.5">
				{#each FILTER_LABELS as f (f.key)}
					<button
						type="button"
						onclick={() => (filter = f.key)}
						class="pill-tab flex items-center gap-1.5 {filter === f.key ? 'active' : ''}"
					>
						{f.label}
						{#if f.key === 'unread' && unread}
							<span class="rounded-full bg-primary-500 px-1.5 py-0.5 text-[10px] text-white">
								{unread}
							</span>
						{:else if f.key === 'mention'}
							{@const n = notifications.countByType['mention'] ?? 0}
							{#if n}
								<span
									class="rounded-full bg-[var(--ui-bg-accented)] px-1.5 py-0.5 text-[10px] text-[var(--ui-text-muted)]"
								>
									{n}
								</span>
							{/if}
						{/if}
					</button>
				{/each}
			</div>
			<div
				class="flex items-center gap-2 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-3 py-2 sm:ml-auto sm:w-[220px]"
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
			<div role="log" aria-live="polite" aria-atomic="false" class="space-y-6">
				{#each sections as section (section.label)}
					<section>
						<h2
							class="mb-2 px-1 text-[11px] font-bold tracking-[0.08em] text-[var(--ui-text-dimmed)] uppercase"
						>
							{section.label}
						</h2>
						<div class="space-y-2.5">
							{#each section.rows as row (row.kind === 'group' ? row.first.id : row.item.id)}
								{@const item = row.kind === 'group' ? row.first : row.item}
								{@const meta = TYPE_META[item.type]}
								{@const profile = profiles.get(item.pubkey)}
								{@const menuId = `notif:${item.id}`}
								{@const menuOpen = popovers.isOpen(menuId)}
								<article
									class="post-card relative overflow-visible transition hover:border-primary-500/25 {menuOpen
										? 'z-30'
										: 'z-0'} {!item.read ? 'bg-[var(--active-surface-bg)]' : ''}"
								>
									<!-- Unread accent stripe -->
									{#if !item.read}
										<span
											class="absolute top-0 bottom-0 left-0 w-[3px]"
											style="background:{meta.color}"
										></span>
									{/if}

									<a
										href={targetLink(item)}
										onclick={() => openRow(item)}
										class="flex items-start gap-3 p-4 pr-14"
										aria-label="{actorName(item.pubkey)} {meta.verb}"
									>
										<div class="relative shrink-0">
											{#if row.kind === 'group'}
												{@const actors = row.items.slice(0, 3)}
												<div class="flex -space-x-3">
													{#each actors as g, i (g.id)}
														<div class="relative z-{10 - i}">
															<Avatar
																pubkey={g.pubkey}
																name={actorName(g.pubkey)}
																picture={profiles.get(g.pubkey)?.picture}
																size={40}
																frame
																class="ring-2 ring-[var(--surface-bg)]"
															/>
														</div>
													{/each}
												</div>
												<span
													class="absolute -right-1 -bottom-1 z-20 grid size-5 place-items-center rounded-full text-white ring-2 ring-[var(--surface-bg)]"
													style="background:{meta.color}"
												>
													<Icon name={meta.icon} class="size-3" />
												</span>
											{:else}
												<Avatar
													pubkey={item.pubkey}
													name={actorName(item.pubkey)}
													picture={profile?.picture}
													size={44}
													frame
												/>
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
														{@const { names, extra } = actorSummary(row.items)}
														<span class="font-bold">{names}</span>
														{#if extra > 0}
															<span class="font-bold">
																and {extra} other{extra > 1 ? 's' : ''}</span
															>
														{/if}
														<span class="text-[var(--ui-text-muted)]"> {meta.verb}</span>
													{:else}
														<span class="font-bold">{actorName(item.pubkey)}</span>
														<span class="text-[var(--ui-text-muted)]"> {meta.verb}</span>
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
												<p
													class="mt-1 line-clamp-2 text-[13px] leading-relaxed break-words text-[var(--ui-text-muted)]"
												>
													{preview(item)}
												</p>
											{/if}

											{#if item.targetId}
												<p class="mt-2 font-mono text-[10.5px] text-[var(--ui-text-dimmed)]">
													{shortKey(item.targetId, 8, 6)}
												</p>
											{/if}
										</div>
									</a>

									<!-- Overflow actions (sibling of <a>, so no nested interactives) -->
									<div class="absolute top-2.5 right-2.5 z-20 shrink-0">
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

<svelte:window
	onclick={() => popovers.close()}
	onkeydown={(e) => e.key === 'Escape' && popovers.close()}
/>
