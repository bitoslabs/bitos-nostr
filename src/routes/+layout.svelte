<script lang="ts">
	import '../app.css';
	import { onMount, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { browser, dev } from '$app/environment';
	import { page } from '$app/state';
	import { registerIcons } from '$lib/icons';
	import { preferences } from '$lib/theme/preferences.svelte';
	import { feedPreferences } from '$lib/stores/feed-preferences.svelte';
	import { media } from '$lib/stores/media.svelte';
	import { callSettings } from '$lib/stores/call-settings.svelte';
	import { clearAccountCaches } from '$lib/stores/account-cache';
	import { blocks } from '$lib/stores/blocks.svelte';
	import { mutes } from '$lib/stores/mutes.svelte';
	import { hashtagFollows } from '$lib/stores/hashtag-follows.svelte';
	import { privacyNotificationSettings } from '$lib/stores/privacy-notification-settings.svelte';
	import { titleBadge } from '$lib/stores/title-badge.svelte';
	import { settingsSync } from '$lib/stores/settings-sync.svelte';
	import { bookmarks } from '$lib/stores/bookmarks.svelte';
	import { walletPrefs } from '$lib/stores/wallet-prefs.svelte';
	import { wallet } from '$lib/nostr/wallet.svelte';
	import { algorithmPreferences, interactionProfile } from '$lib/algorithm';
	import { popovers } from '$lib/stores/popovers.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { relays } from '$lib/nostr/relays.svelte';
	import { publishNip65List, relayListSignature } from '$lib/nostr/nip65';
	import { feed } from '$lib/nostr/feed.svelte';
	import { dms } from '$lib/nostr/dms.svelte';
	import { nip29 } from '$lib/nostr/groups.svelte';
	import { groupSync } from '$lib/nostr/group-sync.svelte';
	import { contacts } from '$lib/nostr/contacts.svelte';
	import { stories } from '$lib/nostr/stories.svelte';
	import { notifications } from '$lib/nostr/notifications.svelte';
	import { ensureConnected, onRelayAck, publish as publishEvent } from '$lib/nostr/pool';
	import { DEFAULT_MIN_ACKS, pendingOutbox, recordAck } from '$lib/stores/event-outbox';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { callAlerts } from '$lib/stores/call-alerts.svelte';
	import { authMessageForPath, isProtectedRoute, isStandalonePublicRoute } from '$lib/auth/access';
	import PublicShell from '$lib/components/PublicShell.svelte';
	import AuthRequired from '$lib/components/auth/AuthRequired.svelte';
	import BootSplash from '$lib/components/ui/BootSplash.svelte';
	import IncomingCallOverlay from '$lib/components/calls/IncomingCallOverlay.svelte';
	import NavRail from '$lib/components/shell/NavRail.svelte';
	import MobileTabBar from '$lib/components/shell/MobileTabBar.svelte';
	import NetworkBar from '$lib/components/shell/NetworkBar.svelte';
	import AppRightRail from '$lib/components/shell/AppRightRail.svelte';
	import Toaster from '$lib/components/ui/Toaster.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';
	import AccountSwitcherDialog from '$lib/components/ui/AccountSwitcherDialog.svelte';
	import AccountSwitcherOverlay from '$lib/components/ui/AccountSwitcherOverlay.svelte';

	let { children } = $props();
	const favicon = '/favicon.ico';

	type CallKind = 'voice' | 'video';
	type CallSignalType = 'offer' | 'answer' | 'ice' | 'end' | 'log';
	type CallSignal = {
		callId: string;
		type: CallSignalType;
		kind: CallKind;
		from: string;
		groupId?: string;
	};

	const CALL_SIGNAL_PREFIX = 'bitos://call-signal?';
	const SETTINGS_AUTO_RESTORE_ACCOUNT_KEY = 'bitos:settings-auto-restore-account';
	// Deliberately non-reactive: call de-dup bookkeeping only.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const alertedCallOffers = new Set<string>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const closedCallIds = new Set<string>();

	registerIcons();

	function displayNameForPubkey(pubkey: string) {
		const profile = profiles.get(pubkey);
		return profile?.display_name || profile?.name || `${pubkey.slice(0, 8)}...${pubkey.slice(-4)}`;
	}

	function parseCallSignal(content: string): CallSignal | null {
		const line = content
			.split(/\s+/)
			.find(
				(part) =>
					part.startsWith(CALL_SIGNAL_PREFIX) || part.startsWith(`nostr:${CALL_SIGNAL_PREFIX}`)
			);
		if (!line) return null;
		const raw = line.startsWith('nostr:') ? line.slice('nostr:'.length) : line;
		try {
			const params = new URLSearchParams(raw.slice(CALL_SIGNAL_PREFIX.length));
			const callId = params.get('callId')?.trim();
			const type = params.get('type')?.trim() as CallSignalType | undefined;
			const kind = params.get('kind')?.trim() as CallKind | undefined;
			const from = params.get('from')?.trim();
			if (
				!callId ||
				!type ||
				!['offer', 'answer', 'ice', 'end', 'log'].includes(type) ||
				!kind ||
				!['voice', 'video'].includes(kind) ||
				!from ||
				!/^[0-9a-fA-F]{64}$/.test(from)
			) {
				return null;
			}
			return {
				callId,
				type,
				kind,
				from: from.toLowerCase(),
				groupId: params.get('groupId')?.trim() || undefined
			};
		} catch {
			return null;
		}
	}

	function isExpiredCallOffer(createdAt: number) {
		return Math.floor(Date.now() / 1000) - createdAt > 90;
	}

	function openMessagesForCall(signal: CallSignal) {
		// Built once per navigation — never reactive state.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const params = new URLSearchParams({ to: signal.from, answer: signal.callId });
		if (signal.groupId) params.set('group', signal.groupId);
		void goto(`/messages?${params.toString()}`);
	}

	function showBrowserCallNotification(title: string, body: string, signal: CallSignal) {
		if (!browser || !('Notification' in window) || Notification.permission !== 'granted') return;
		const notification = new Notification(title, {
			body,
			icon: favicon
		});
		notification.onclick = () => {
			window.focus();
			openMessagesForCall(signal);
			notification.close();
		};
	}

	function alertIncomingCalls() {
		if (!privacyNotificationSettings.state.dms) return;
		if (!browser || page.url.pathname === '/messages') return;
		for (const conversation of dms.conversations) {
			if (blocks.has(conversation.peer)) continue;
			for (const message of conversation.messages) {
				const signal = parseCallSignal(message.content);
				if (signal?.type === 'end' || signal?.type === 'log') closedCallIds.add(signal.callId);
			}
		}
		for (const conversation of dms.conversations) {
			if (blocks.has(conversation.peer)) continue;
			for (const message of conversation.messages) {
				if (message.mine) continue;
				const signal = parseCallSignal(message.content);
				if (
					!signal ||
					signal.type !== 'offer' ||
					isExpiredCallOffer(message.createdAt) ||
					closedCallIds.has(signal.callId)
				) {
					if (signal?.callId && closedCallIds.has(signal.callId))
						callAlerts.closeCall(signal.callId);
					continue;
				}
				if (alertedCallOffers.has(message.id)) continue;
				alertedCallOffers.add(message.id);
				profiles.ensure([signal.from]);
				const caller = displayNameForPubkey(signal.from);
				const title = `${signal.groupId ? 'Group ' : ''}${signal.kind === 'video' ? 'Video' : 'Voice'} call`;
				const body = `${caller} is calling. Open Messages to answer.`;
				callAlerts.upsert({
					id: message.id,
					callId: signal.callId,
					kind: signal.kind,
					from: signal.from,
					groupId: signal.groupId,
					callerName: caller,
					createdAt: message.createdAt
				});
				toasts.info(`${title} from ${caller}`, 8000);
				showBrowserCallNotification(title, body, signal);
			}
		}
	}

	function stopAccountServices() {
		contacts.stop();
		stories.stop();
		feed.stop();
		dms.stop();
		notifications.stop();
	}

	function clearRuntimeAccountState() {
		feed.clear();
		stories.clear();
		notifications.clear();
		bookmarks.clear();
		callAlerts.clear();
		wallet.clear();
	}

	function shouldAutoRestoreSettings(pubkey: string, previousPubkey: string | null) {
		if (!browser) return false;
		if (previousPubkey && previousPubkey !== pubkey) return true;
		return localStorage.getItem(SETTINGS_AUTO_RESTORE_ACCOUNT_KEY) !== pubkey;
	}

	function markSettingsAutoRestoreAttempted(pubkey: string) {
		if (!browser) return;
		localStorage.setItem(SETTINGS_AUTO_RESTORE_ACCOUNT_KEY, pubkey);
	}

	function clearSettingsAutoRestoreAttempt() {
		if (!browser) return;
		localStorage.removeItem(SETTINGS_AUTO_RESTORE_ACCOUNT_KEY);
	}

	async function restoreSyncedSettingsFor(pubkey: string) {
		try {
			const restored = await settingsSync.restoreLatestBackup();
			if (identity.current?.pk !== pubkey) return;
			markSettingsAutoRestoreAttempted(pubkey);
			if (restored) toasts.success('Synced settings restored');
		} catch {
			if (identity.current?.pk === pubkey) markSettingsAutoRestoreAttempted(pubkey);
			/* Settings sync is best-effort on account switch. */
		}
	}

	onMount(() => {
		// Dismiss the static splash from app.html once the app has mounted.
		const splash = document.getElementById('boot-splash');
		if (splash) {
			splash.classList.add('bs-out');
			setTimeout(() => splash.remove(), 400);
		}
		if ('serviceWorker' in navigator) {
			if (dev) {
				// The SW is cache-first for same-origin GETs — in dev that caches
				// Vite module URLs and serves stale code after every edit (broken
				// HMR, phantom old UI). Never register it in dev, and unregister
				// any copy left over from a previous production run.
				void navigator.serviceWorker
					.getRegistrations()
					.then((registrations) => {
						for (const registration of registrations) void registration.unregister();
					})
					.catch(() => {
						/* best-effort cleanup */
					});
			} else {
				void navigator.serviceWorker
					.register('/service-worker.js', { type: 'module' })
					.catch((e) => {
						/* PWA support is best-effort. */
						console.error('Failed to register service worker:', e);
					});
			}
		}
		preferences.load();
		preferences.apply();
		preferences.startSystemWatcher();
		media.load();
		walletPrefs.load();
		wallet.restoreCustomNwc();
		profiles.load();
		blocks.load();
		mutes.load();
		hashtagFollows.load();
		privacyNotificationSettings.load();
		relays.load();
		identity.load();
		algorithmPreferences.load();
		interactionProfile.load();

		// PUB-012 (§12.2): record relay ACKs into the local outbox so signed
		// events graduate once the durability threshold is met, then drain
		// anything still short of it by re-sending the SAME signed events —
		// never re-signed, never rebuilt. Closes over the app lifetime.
		const stopAckObserver = onRelayAck((eventId, relayUrl) => {
			recordAck(eventId, relayUrl, { minAcks: DEFAULT_MIN_ACKS });
		});
		const outboxDrain = setInterval(() => {
			const pending = pendingOutbox(DEFAULT_MIN_ACKS);
			for (const entry of pending) {
				// pendingOutbox has already validated the shape — this event was
				// signed by us and previously agreed to publish.
				void publishEvent(entry.event as import('nostr-tools/pure').Event).catch(() => {
					/* stays pending; the next drain retries */
				});
			}
		}, 15_000);
		return () => {
			stopAckObserver();
			clearInterval(outboxDrain);
		};
	});

	// React to login/logout (onboarding) at runtime: start/stop subscriptions.
	/**
	 * NIP-65 publisher — fires when the effective relay signature differs from
	 * the last one we published (persisted). Debounced so tweaking several
	 * relays in Settings produces a single kind 10002 event. First login run
	 * publishes too if the remote list was never recorded — cheap interop win.
	 */
	const NIP65_SIG_KEY = 'bitos:nip65-published-sig';
	let nip65Timer: ReturnType<typeof setTimeout> | undefined;
	function publishRelayListIfChanged() {
		if (!browser || !identity.current) return;
		if (nip65Timer) clearTimeout(nip65Timer);
		nip65Timer = setTimeout(() => {
			nip65Timer = undefined;
			const sig = relayListSignature(relays.list);
			let lastPublished: string | null = null;
			try {
				lastPublished = localStorage.getItem(NIP65_SIG_KEY);
			} catch {
				/* ignore */
			}
			if (sig === lastPublished) return;
			void publishNip65List(relays.list)
				.then(() => {
					try {
						localStorage.setItem(NIP65_SIG_KEY, sig);
					} catch {
						/* ignore */
					}
				})
				.catch(() => undefined); // offline — retried on next change/login
		}, 4_000);
	}

	let lastPk = $state<string | null>(null);
	$effect(() => {
		const pk = identity.current?.pk ?? null;
		if (pk === lastPk) return;
		const previousPk = lastPk;
		lastPk = pk;
		stopAccountServices();
		if (previousPk && previousPk !== pk) {
			clearAccountCaches();
			clearRuntimeAccountState();
			algorithmPreferences.resetAll();
			interactionProfile.clear(false);
			preferences.reload();
			media.reset();
			privacyNotificationSettings.reload();
			void mutes.flush(); // publish any pending NIP-51 changes (guard-checked)
			void blocks.flush();
			void hashtagFollows.flush();
			nip29.stop();
			nip29.clear();
			blocks.load();
			mutes.load();
			hashtagFollows.load();
			feedPreferences.reload();
			callSettings.reload();
			relays.load();
			walletPrefs.load();
			wallet.disconnectWallet();
			wallet.restoreCustomNwc();
		}
		if (pk) {
			// Always revalidate the active account's own metadata. This fixes imports
			// and account switching when the local account record has no cached name.
			void profiles.refresh([pk]).then(() => {
				const profile = profiles.get(pk);
				if (profile && identity.current?.pk === pk) identity.setProfile(profile);
			});
			ensureConnected();
			contacts.start();
			stories.start();
			feed.start();
			dms.start();
			notifications.start();
			nip29.start();
			// NIP-51: merge mute/block lists from relays, push local-only entries.
			void mutes.sync();
			void blocks.sync();
			// NIP-51: same for followed hashtags (kind 30015 interest set).
			void hashtagFollows.sync();
			if (shouldAutoRestoreSettings(pk, previousPk)) {
				void restoreSyncedSettingsFor(pk);
			}
		} else {
			if (previousPk) clearSettingsAutoRestoreAttempt();
			clearRuntimeAccountState();
			ensureConnected();
			feed.start();
		}
	});

	// React to relay list changes — restart the feed subscription.
	let lastRelays = $state<string>('');
	$effect(() => {
		const sig = relays.urls.join(',');
		if (sig === lastRelays) return;
		lastRelays = sig;
		ensureConnected();
		feed.start();
		if (identity.current) {
			contacts.start();
			stories.start();
			dms.start();
			notifications.start();
			// Relay set changed — re-merge moderation lists from the new sources.
			void mutes.sync();
			void blocks.sync();
			void hashtagFollows.sync();
			// NIP-65: republish the user's relay list (debounced, only on change).
			void publishRelayListIfChanged();
		}
	});

	// Stories are scoped to me + my follow list, and contacts load asynchronously.
	// Refresh the story subscription when the follow list changes.
	let lastStoryAuthors = $state('');
	$effect(() => {
		const pk = identity.current?.pk ?? '';
		if (!pk) {
			lastStoryAuthors = '';
			return;
		}
		const sig = `${pk}:${contacts.following.join(',')}`;
		if (sig === lastStoryAuthors) return;
		lastStoryAuthors = sig;
		stories.start();
	});

	// Tab-title unread badge ("(3) Messages · BitOS") mirrors the nav badges:
	// notifications + DMs (privacy-gated) + NIP-29 community unreads.
	$effect(() => {
		if (!identity.current) {
			titleBadge.setCount(0);
			return;
		}
		const dmUnread = privacyNotificationSettings.state.dms ? dms.unreadCount : 0;
		const communitiesUnread = nip29.groups.reduce((sum, g) => sum + g.unread, 0);
		titleBadge.setCount(notifications.unreadCount + dmUnread + communitiesUnread);
	});

	$effect(() => {
		void page.url.pathname;
		for (const conversation of dms.conversations) {
			void conversation.messages.length;
		}
		// These routines update other reactive stores. Keep those writes out of this
		// effect's dependency set so a call alert update cannot re-run this effect.
		untrack(() => {
			if (page.url.pathname !== '/messages') groupSync.processDms();
			alertIncomingCalls();
		});
	});

	const hasIdentity = $derived(identity.ready && !!identity.current);
	const isPublicRoute = $derived(isStandalonePublicRoute(page.url.pathname));
	const isShowcase = $derived(page.url.pathname === '/pulse');
	const routeNeedsAuth = $derived(isProtectedRoute(page.url.pathname));
	const authMessage = $derived(authMessageForPath(page.url.pathname));

	// Premium 3-column shell (docs/ui.html): the right rail shows on content
	// routes. Multi-pane routes (messages, settings, reels) own their own layout
	// and opt out so their internal columns get the full center width. Home uses
	// the same consolidated AppRightRail as the rest of the content routes.
	const railHiddenPrefixes = ['/messages', '/settings', '/bitz', '/studio/create'];
	// Full-bleed editor surfaces (studio) drop the centered container clamp too —
	// their panels stretch to the whole main column like messages/settings panes.
	const breakoutRoutes = /^\/studio\/create\/?$/;
	const isBreakout = $derived(breakoutRoutes.test(page.url.pathname));
	const publicRailRoutes = new Set(['/', '/discover']);
	const showRail = $derived(
		(hasIdentity || publicRailRoutes.has(page.url.pathname)) &&
			!railHiddenPrefixes.some(
				(p) => page.url.pathname === p || page.url.pathname.startsWith(`${p}/`)
			)
	);
	const relayTotal = $derived(relays.list.length);
	const relayConnected = $derived(relays.list.filter((r) => r.status === 'ok').length);
	const relayChecking = $derived(relays.list.some((r) => r.status === 'connecting'));

	// All authenticated routes share a centered cluster with the desktop
	// navigation rail; individual pages control their own content treatment.
</script>

<svelte:head>
	<title>BitOS</title>
	<link rel="icon" href={favicon} />
</svelte:head>

<svelte:window
	onclick={(event) => {
		if (!(event.target instanceof Element) || !event.target.closest('[data-popover-panel]')) {
			popovers.close();
		}
	}}
	onkeydown={(event) => {
		if (event.key === 'Escape') popovers.close();
	}}
/>

{#if !identity.ready}
	<!-- brief boot state (static twin lives in app.html) -->
	<BootSplash />
{:else if isShowcase}
	<!-- Full-bleed premium UI showcase — owns the whole viewport. -->
	{@render children?.()}
{:else if isPublicRoute}
	<PublicShell>
		{@render children?.()}
	</PublicShell>
{:else}
	<!-- Premium shell (docs/ui.html): film grain, a top
	     throughput bar, and a responsive nav · main · right-rail grid. -->
	<div class="grain" aria-hidden="true"></div>
	<NetworkBar connected={relayConnected} total={relayTotal} checking={relayChecking} />

	<!-- Keep this shell out of its own stacking context. Full-screen viewers rendered
	     by page content must be able to layer above the mobile tab bar. -->
	<div class="relative flex h-screen w-full justify-center overflow-hidden">
		<!-- Breakout editors (studio) drop the centered container clamp too — the
		     editing surface owns the whole width next to the nav rail. -->
		<div
			class={isBreakout
				? 'flex h-full w-full overflow-hidden'
				: 'flex w-full max-w-[var(--ui-container)] overflow-hidden'}
		>
			<!-- Desktop nav rail (premium icon rail) -->
			<aside
				class="z-20 hidden w-[260px] shrink-0 border-r border-[var(--ui-border-muted)] lg:flex lg:flex-col"
			>
				<NavRail />
			</aside>

			<!-- Main view (each route renders its own premium layout) -->
			<main class="min-w-0 flex-1 pb-[calc(4.25rem+env(safe-area-inset-bottom))] lg:pb-0">
				{#if routeNeedsAuth && !hasIdentity}
					<AuthRequired title={authMessage.title} description={authMessage.description} />
				{:else if isBreakout}
					<!-- Full-bleed editors: fill the entire main column, no center clamp. -->
					<div class="h-full">{@render children?.()}</div>
				{:else}
					{@render children?.()}
				{/if}
			</main>

			<!-- Right rail: network pulse · trending · active relays (xl and up) -->
			{#if showRail}
				<div class="hidden w-[340px] shrink-0 overflow-y-auto xl:block">
					<AppRightRail
						showTrending={page.url.pathname !== '/notifications'}
						showSuggestions={hasIdentity}
					/>
				</div>
			{/if}
		</div>
	</div>

	<MobileTabBar />
{/if}

<IncomingCallOverlay />
<Toaster />
<!-- Global switch-account dialog + boot-style switch transition overlay.
     Mounted before ConfirmDialog so removal confirms stack above it. -->
<AccountSwitcherDialog />
<ConfirmDialog />
<AccountSwitcherOverlay />
