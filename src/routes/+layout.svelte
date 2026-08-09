<script lang="ts">
	import '../app.css';
	import { onMount, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { registerIcons } from '$lib/icons';
	import { preferences } from '$lib/theme/preferences.svelte';
	import { media } from '$lib/stores/media.svelte';
	import { clearAccountCaches } from '$lib/stores/account-cache';
	import { blocks } from '$lib/stores/blocks.svelte';
	import { mutes } from '$lib/stores/mutes.svelte';
	import { privacyNotificationSettings } from '$lib/stores/privacy-notification-settings.svelte';
	import { settingsSync } from '$lib/stores/settings-sync.svelte';
	import { bookmarks } from '$lib/stores/bookmarks.svelte';
	import { algorithmPreferences, interactionProfile } from '$lib/algorithm';
	import { popovers } from '$lib/stores/popovers.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { relays } from '$lib/nostr/relays.svelte';
	import { feed } from '$lib/nostr/feed.svelte';
	import { dms } from '$lib/nostr/dms.svelte';
	import { groupSync } from '$lib/nostr/group-sync.svelte';
	import { contacts } from '$lib/nostr/contacts.svelte';
	import { stories } from '$lib/nostr/stories.svelte';
	import { notifications } from '$lib/nostr/notifications.svelte';
	import { ensureConnected } from '$lib/nostr/pool';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { callAlerts } from '$lib/stores/call-alerts.svelte';
	import { authMessageForPath, isProtectedRoute, isStandalonePublicRoute } from '$lib/auth/access';
	import PublicShell from '$lib/components/PublicShell.svelte';
	import AuthRequired from '$lib/components/auth/AuthRequired.svelte';
	import IncomingCallOverlay from '$lib/components/calls/IncomingCallOverlay.svelte';
	import NavRail from '$lib/components/shell/NavRail.svelte';
	import MobileTabBar from '$lib/components/shell/MobileTabBar.svelte';
	import Toaster from '$lib/components/ui/Toaster.svelte';
	import ConfirmDialog from '$lib/components/ui/ConfirmDialog.svelte';

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
	const alertedCallOffers = new Set<string>();
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
		if ('serviceWorker' in navigator) {
			void navigator.serviceWorker.register('/service-worker.js', { type: 'module' }).catch((e) => {
				/* PWA support is best-effort. */
				console.error('Failed to register service worker:', e);
			});
		}
		preferences.load();
		preferences.apply();
		preferences.startSystemWatcher();
		media.load();
		profiles.load();
		blocks.load();
		mutes.load();
		privacyNotificationSettings.load();
		relays.load();
		identity.load();
		algorithmPreferences.load();
		interactionProfile.load();
	});

	// React to login/logout (onboarding) at runtime: start/stop subscriptions.
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
		}
		if (pk) {
			ensureConnected();
			contacts.start();
			stories.start();
			feed.start();
			dms.start();
			notifications.start();
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
	const routeNeedsAuth = $derived(isProtectedRoute(page.url.pathname));
	const authMessage = $derived(authMessageForPath(page.url.pathname));
</script>

<svelte:head>
	<title>BitOS</title>
	<link rel="icon" href={favicon} />
</svelte:head>

<svelte:window
	onclick={() => popovers.close()}
	onkeydown={(event) => {
		if (event.key === 'Escape') popovers.close();
	}}
/>

{#if !identity.ready}
	<!-- brief boot state -->
	<div class="grid h-screen place-items-center">
		<div
			class="size-7 animate-spin rounded-full border-2 border-[var(--ui-border)] border-t-primary-500"
		></div>
	</div>
{:else if isPublicRoute}
	<PublicShell>
		{@render children?.()}
	</PublicShell>
{:else}
	<div class="flex h-screen w-full overflow-hidden">
		<!-- Desktop nav rail (Pulse icon rail) -->
		<aside
			class="z-20 hidden w-[76px] shrink-0 border-r border-[var(--ui-border-muted)] bg-[var(--surface-bg)] lg:flex lg:flex-col"
		>
			<NavRail />
		</aside>

		<!-- Main view (full-bleed; each route renders its own Pulse layout) -->
		<main
			class="min-w-0 flex-1 bg-[var(--ui-bg)] pb-[calc(4.25rem+env(safe-area-inset-bottom))] lg:pb-0"
		>
			{#if routeNeedsAuth && !hasIdentity}
				<AuthRequired title={authMessage.title} description={authMessage.description} />
			{:else}
				{@render children?.()}
			{/if}
		</main>
	</div>

	<MobileTabBar />
{/if}

<IncomingCallOverlay />
<Toaster />
<ConfirmDialog />
