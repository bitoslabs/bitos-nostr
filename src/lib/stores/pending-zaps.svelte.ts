/**
 * Pending-zap tracker — reconciliation layer for zaps whose confirmation may
 * outlive the zap dialog.
 *
 * When `lightning:` hands the invoice to an external wallet (Wall of Satoshi,
 * Zeus, …), the tab is backgrounded and its WebSocket subscriptions die.
 * Previously the receipt listener simply vanished with it: the sender never
 * saw confirmation and the local sent-ledger never recorded the zap.
 *
 * This store persists every issued zap (invoice + zap-request id + context)
 * to localStorage and re-subscribes for receipts:
 *   • while the zap dialog is open (its own listener remains the fast path);
 *   • on `visibilitychange`/`pageshow` — the user returning from the wallet;
 *   • on app startup, via `start()` from the root layout.
 *
 * A matched kind 9735 (description.id === pending requestId) records the sent
 * entry, fires `onConfirmed` (toast) and clears the pending record.
 */
import { browser } from '$app/environment';
import { SvelteSet } from 'svelte/reactivity';
import { wallet } from '$lib/nostr/wallet.svelte';
import { subscribe } from '$lib/nostr/pool';
import { toasts } from '$lib/stores/toasts.svelte';

const STORAGE_KEY = 'bitos:pending-zaps';
/** Drop unresolved pendings after 24h — the invoice has expired by then. */
const MAX_AGE_SEC = 24 * 60 * 60;
/** Re-query window when re-subscribing: receipts published since creation. */
const RECEIPT_QUERY_SLACK_SEC = 120;

export interface PendingZap {
	/** Zap-request (9734) id — matches the receipt's description.id. */
	requestId: string;
	/** Fallback record id when the zap has no 9734 (plain LNURL pay). */
	recordId: string;
	recipientPubkey: string;
	recipientName?: string;
	targetNoteId?: string;
	sats: number;
	memo?: string;
	invoice: string;
	createdAt: number;
}

type ConfirmedHandler = (zap: PendingZap) => void;
const confirmedHandlers = new SvelteSet<ConfirmedHandler>();

/** Subscribe to global zap-confirmed notifications (e.g. layout toast). */
export function onPendingZapConfirmed(handler: ConfirmedHandler): () => void {
	confirmedHandlers.add(handler);
	return () => confirmedHandlers.delete(handler);
}

function loadAll(): PendingZap[] {
	if (!browser) return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as PendingZap[];
		if (!Array.isArray(parsed)) return [];
		const cutoff = Math.floor(Date.now() / 1000) - MAX_AGE_SEC;
		return parsed.filter(
			(zap) =>
				zap &&
				typeof zap.requestId === 'string' &&
				typeof zap.recordId === 'string' &&
				typeof zap.invoice === 'string' &&
				zap.createdAt >= cutoff
		);
	} catch {
		return [];
	}
}

function persistAll(zaps: PendingZap[]) {
	if (!browser) return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(zaps));
	} catch {
		/* quota — best-effort */
	}
}

class PendingZapsStore {
	items = $state<PendingZap[]>([]);
	private stopSub: (() => void) | null = null;
	private started = false;

	/** Register a freshly issued zap invoice for later reconciliation. */
	track(zap: Omit<PendingZap, 'createdAt'> & { createdAt?: number }) {
		if (!browser) return;
		const entry: PendingZap = { ...zap, createdAt: zap.createdAt ?? Math.floor(Date.now() / 1000) };
		// Replace an older entry for the same request (e.g. re-generated invoice).
		this.items = [entry, ...this.items.filter((z) => z.requestId !== entry.requestId)].slice(0, 30);
		persistAll(this.items);
		if (!this.stopSub) this.relisten();
	}

	/** Forget a pending zap (confirmed, or the user abandoned it). */
	forget(requestId: string) {
		if (!this.items.some((z) => z.requestId === requestId)) return;
		this.items = this.items.filter((z) => z.requestId !== requestId);
		persistAll(this.items);
		if (!this.items.length) this.stopListening();
	}

	/** Load persisted pendings + open the receipt subscription. Layout hook. */
	start = () => {
		if (!browser) return;
		this.items = loadAll();
		this.started = true;
		if (this.items.length) this.relisten();
	};

	/** Close the subscription (account switch / teardown). */
	stop = () => {
		this.stopListening();
		this.items = [];
		this.started = false;
	};

	/**
	 * Re-subscribe for receipts of all pendings. `since` covers the oldest
	 * pending's creation so receipts published while the tab was frozen (the
	 * mobile deeplink case) are re-fetched on return.
	 */
	relisten() {
		if (!browser || !this.items.length) return;
		this.stopSub?.();
		this.stopSub = null;
		const recipients = [...new Set(this.items.map((z) => z.recipientPubkey))];
		const oldest = Math.min(...this.items.map((z) => z.createdAt));
		const byRequest = new Map(this.items.map((z) => [z.requestId, z]));
		this.stopSub = subscribe(
			[
				{
					kinds: [9735],
					'#p': recipients,
					since: Math.max(0, oldest - RECEIPT_QUERY_SLACK_SEC)
				}
			],
			{
				onevent: (event) => {
					const description = event.tags.find((tag) => tag[0] === 'description')?.[1];
					if (!description) return;
					try {
						const receipt = JSON.parse(description) as { id?: string };
						const pending = receipt.id ? byRequest.get(receipt.id) : undefined;
						if (!pending) return;
						this.confirm(pending);
					} catch {
						/* malformed description */
					}
				}
			}
		);
	}

	private confirm(zap: PendingZap) {
		this.forget(zap.requestId);
		wallet.recordSent({
			id: zap.recordId,
			amountSats: zap.sats,
			recipientPubkey: zap.recipientPubkey,
			targetNoteId: zap.targetNoteId,
			memo: zap.memo
		});
		for (const handler of confirmedHandlers) {
			try {
				handler(zap);
			} catch {
				/* handlers must not break reconciliation */
			}
		}
	}

	private stopListening() {
		this.stopSub?.();
		this.stopSub = null;
	}
}

export const pendingZaps = new PendingZapsStore();

// Layout wiring: reconcile persisted zaps on load, re-arm on tab return, and
// surface a toast when an external-wallet zap finally confirms.
if (browser) {
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') pendingZaps.relisten();
	});
	window.addEventListener('pageshow', (event) => {
		if ((event as PageTransitionEvent).persisted) pendingZaps.relisten();
	});
	onPendingZapConfirmed((zap) => {
		toasts.success(
			`⚡ ${zap.sats.toLocaleString()} sats zap${zap.recipientName ? ` to ${zap.recipientName}` : ''} confirmed`
		);
	});
}
