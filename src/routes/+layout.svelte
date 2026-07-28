<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { registerIcons } from '$lib/icons';
	import { preferences } from '$lib/theme/preferences.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { relays } from '$lib/nostr/relays.svelte';
	import { feed } from '$lib/nostr/feed.svelte';
	import { dms } from '$lib/nostr/dms.svelte';
	import { groupSync } from '$lib/nostr/group-sync.svelte';
	import { contacts } from '$lib/nostr/contacts.svelte';
	import { notifications } from '$lib/nostr/notifications.svelte';
	import { ensureConnected } from '$lib/nostr/pool';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { callAlerts } from '$lib/stores/call-alerts.svelte';
	import IncomingCallOverlay from '$lib/components/calls/IncomingCallOverlay.svelte';
	import NavRail from '$lib/components/shell/NavRail.svelte';
	import MobileTabBar from '$lib/components/shell/MobileTabBar.svelte';
	import Onboarding from '$lib/components/Onboarding.svelte';
	import Toaster from '$lib/components/ui/Toaster.svelte';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();

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
		if (!browser || page.url.pathname === '/messages') return;
		for (const conversation of dms.conversations) {
			for (const message of conversation.messages) {
				const signal = parseCallSignal(message.content);
				if (signal?.type === 'end' || signal?.type === 'log') closedCallIds.add(signal.callId);
			}
		}
		for (const conversation of dms.conversations) {
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

	onMount(() => {
		preferences.load();
		preferences.apply();
		preferences.startSystemWatcher();
		identity.load();
		relays.load();
	});

	// React to login/logout (onboarding) at runtime: start/stop subscriptions.
	let lastPk = $state<string | null>(null);
	$effect(() => {
		const pk = identity.current?.pk ?? null;
		if (pk === lastPk) return;
		lastPk = pk;
		if (pk) {
			ensureConnected();
			contacts.start();
			feed.start();
			dms.start();
			notifications.start();
		} else {
			contacts.stop();
			feed.stop();
			dms.stop();
			notifications.stop();
		}
	});

	// React to relay list changes — restart the feed subscription.
	let lastRelays = $state<string>('');
	$effect(() => {
		const sig = relays.urls.join(',');
		if (sig === lastRelays || !identity.current) return;
		lastRelays = sig;
		ensureConnected();
		contacts.start();
		feed.start();
		dms.start();
		notifications.start();
	});

	$effect(() => {
		void page.url.pathname;
		for (const conversation of dms.conversations) {
			void conversation.messages.length;
		}
		if (page.url.pathname !== '/messages') groupSync.processDms();
		alertIncomingCalls();
	});

	const hasIdentity = $derived(identity.ready && !!identity.current);
</script>

<svelte:head>
	<title>BitOS</title>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if !identity.ready}
	<!-- brief boot state -->
	<div class="grid h-screen place-items-center">
		<div
			class="size-7 animate-spin rounded-full border-2 border-[var(--ui-border)] border-t-primary-500"
		></div>
	</div>
{:else if !hasIdentity}
	<Onboarding />
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
			{@render children?.()}
		</main>
	</div>

	<MobileTabBar />
{/if}

<IncomingCallOverlay />
<Toaster />
