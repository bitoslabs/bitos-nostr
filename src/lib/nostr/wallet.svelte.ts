/**
 * Wallet & zap ledger store. Aggregates the active account's NIP-57 zap
 * receipts into a unified, reactive ledger:
 *
 *  • Received zaps — authoritative, queried from relays via `#p = me` on
 *    kind 9735, with the sender pubkey recovered from each receipt's embedded
 *    kind 9734 zap request (the `description` tag).
 *  • Sent zaps — locally tracked (recorded when the in-app zap flow pays an
 *    invoice and confirms a receipt), persisted to localStorage. "Sent" cannot
 *    be queried efficiently over vanilla relays (the sender lives in content,
 *    not a tag), so local tracking is the honest primary source — the same
 *    approach Damus/Amethyst use.
 *  • WebLN balance — when a Lightning wallet (Alby/NWC) is connected, the
 *    hero surfaces the live spendable balance instead of the received total.
 *
 * The store follows the same lifecycle pattern as `notifications`: `start()`
 * on mount, `stop()` on unmount / account switch.
 */
import { browser } from '$app/environment';
import { queryPrimaryFirst, subscribe } from './pool';
import { identity } from './identity.svelte';
import { profiles } from './profiles.svelte';
import { blocks } from '$lib/stores/blocks.svelte';
import { satsFromBolt11 } from './zaps';
import {
	hasWebLN,
	getWebLNInfo,
	weblnBalanceSats,
	type WebLNInfo
} from './webln';
import { NOSTR_KINDS, type Event } from './types';

const RECEIVED_LIMIT = 200;
const MAX_RECEIVED = 500;
const SENT_KEY = 'bitos:sent-zaps';

export interface ZapEntry {
	/** Receipt event id (received) or local record id (sent). */
	id: string;
	direction: 'received' | 'sent';
	amountSats: number;
	/** Sender pubkey (recovered from the embedded zap request). */
	senderPubkey: string;
	/** Recipient pubkey (the `#p` tag on a receipt). */
	recipientPubkey: string;
	/** Optional target note (`#e` tag). */
	targetNoteId?: string;
	/** Optional memo (zap request content). */
	memo?: string;
	/** BOLT11 invoice (truncated for display as a "txid"). */
	bolt11?: string;
	createdAt: number;
}

interface SentRecord {
	id: string;
	amountSats: number;
	recipientPubkey: string;
	targetNoteId?: string;
	memo?: string;
	createdAt: number;
}

/**
 * Pure parser: turn a kind 9735 NIP-57 zap receipt into a ledger entry for the
 * recipient `me`. The amount prefers the `amount` tag (msat → sats); the
 * sender is recovered from the embedded kind 9734 zap request inside the
 * `description` tag. Returns `null` when the receipt is malformed or carries
 * no spendable amount. Exported for unit testing.
 */
export function receiptToZapEntry(event: Event, me: string): ZapEntry | null {
	const recipient = event.tags.find((tag) => tag[0] === 'p' && tag[1])?.[1]?.toLowerCase();
	if (!recipient) return null;

	const amountTag = event.tags.find((tag) => tag[0] === 'amount' && tag[1])?.[1];
	const msats = amountTag ? Number(amountTag) : 0;
	const bolt11 = event.tags.find((tag) => tag[0] === 'bolt11' && tag[1])?.[1];
	const amountSats =
		Number.isFinite(msats) && msats > 0
			? Math.round(msats / 1000)
			: bolt11
				? satsFromBolt11(bolt11)
				: 0;
	if (!amountSats) return null;

	const targetNoteId = event.tags.find((tag) => tag[0] === 'e' && tag[1])?.[1];
	const description = event.tags.find((tag) => tag[0] === 'description' && tag[1])?.[1];

	let senderPubkey = event.pubkey;
	let memo: string | undefined;
	if (description) {
		try {
			const zapRequest = JSON.parse(description) as {
				pubkey?: string;
				content?: string;
				tags?: string[][];
			};
			if (zapRequest.pubkey) senderPubkey = zapRequest.pubkey.toLowerCase();
			memo = zapRequest.content?.trim() || undefined;
		} catch {
			/* malformed description — fall back to receipt pubkey */
		}
	}

	return {
		id: event.id,
		direction: 'received',
		amountSats,
		senderPubkey,
		recipientPubkey: recipient,
		targetNoteId,
		memo,
		bolt11,
		createdAt: event.created_at
	};
}

class WalletStore {
	received = $state<ZapEntry[]>([]);
	/** Locally-tracked sent zaps, newest first. */
	sent = $state<ZapEntry[]>([]);
	loading = $state(false);
	connected = $state(false);
	error = $state<string | null>(null);

	// --- WebLN wallet connection state ---
	weblnAvailable = $state(false);
	weblnEnabled = $state(false);
	weblnInfo = $state<WebLNInfo | null>(null);
	/** Live spendable balance from the connected wallet, in sats. */
	weblnBalance = $state<number | null>(null);
	weblnBusy = $state(false);

	private unsub: (() => void) | null = null;

	/** All entries, newest first, with the active user's blocks filtered out. */
	ledger = $derived([...this.received, ...this.sent]
		.filter((entry) => {
			const other = entry.direction === 'received' ? entry.senderPubkey : entry.recipientPubkey;
			return !blocks.has(other);
		})
		.sort((a, b) => b.createdAt - a.createdAt));

	totalReceived = $derived(
		this.received.reduce((sum, entry) => sum + entry.amountSats, 0)
	);
	totalSent = $derived(this.sent.reduce((sum, entry) => sum + entry.amountSats, 0));
	countReceived = $derived(this.received.length);
	countSent = $derived(this.sent.length);
	avgReceived = $derived(
		this.countReceived ? Math.round(this.totalReceived / this.countReceived) : 0
	);
	/** Net sats (received − sent) — the honest "balance" without a live wallet. */
	net = $derived(this.totalReceived - this.totalSent);

	/**
	 * The headline number for the Zaps hero. When a WebLN wallet is connected,
	 * this is the live spendable balance; otherwise it is the total sats the
	 * account has earned (always available from relays).
	 */
	balance = $derived(this.weblnEnabled && this.weblnBalance !== null ? this.weblnBalance : this.totalReceived);
	balanceSource = $derived<'wallet' | 'earned'>(
		this.weblnEnabled && this.weblnBalance !== null ? 'wallet' : 'earned'
	);

	// ---------------------------------------------------------------------------
	// Lifecycle
	// ---------------------------------------------------------------------------

	start = () => {
		if (!browser) return;
		const me = identity.current?.pk;
		if (!me) return;
		this.stop();
		this.detectWebLN();
		this.loadSent();
		this.received = [];
		this.loading = true;
		this.connected = false;
		this.error = null;
		this.unsub = subscribe(
			[{ kinds: [NOSTR_KINDS.ZAP], '#p': [me], limit: RECEIVED_LIMIT }],
			{
				oneose: () => {
					this.loading = false;
					this.connected = true;
					this.error = null;
				},
				onclose: () => {
					this.loading = false;
					this.connected = false;
				},
				onevent: (event) => this.ingestReceived(event)
			}
		);
	};

	stop = () => {
		if (this.unsub) {
			this.unsub();
			this.unsub = null;
		}
		this.connected = false;
	};

	clear = () => {
		this.received = [];
		this.sent = [];
		this.loading = false;
		this.connected = false;
		this.error = null;
	};

	/** Pull a larger historical batch (used by "load more"). */
	async loadMoreReceived() {
		const me = identity.current?.pk;
		if (!me) return;
		const oldest = this.received.at(-1);
		try {
			const events = await queryPrimaryFirst([
				{
					kinds: [NOSTR_KINDS.ZAP],
					'#p': [me],
					limit: RECEIVED_LIMIT,
					...(oldest ? { until: oldest.createdAt - 1 } : {})
				}
			]);
			let added = 0;
			for (const event of events.sort((a, b) => b.created_at - a.created_at)) {
				if (this.ingestReceived(event)) added += 1;
			}
			return added;
		} catch (e) {
			this.error = (e as Error).message;
			return 0;
		}
	}

	// ---------------------------------------------------------------------------
	// Received ingestion
	// ---------------------------------------------------------------------------

	/** Parse + prepend a kind 9735 receipt. Returns true if it was new. */
	private ingestReceived(event: Event): boolean {
		const me = identity.current?.pk;
		if (!me) return false;
		if (this.received.some((entry) => entry.id === event.id)) return false;

		const entry = this.receiptToEntry(event, me);
		if (!entry) return false;
		// The sender pubkey lives in the embedded zap request — hydrate the
		// profile so the row can render a name/avatar without a second pass.
		profiles.ensure([entry.senderPubkey, entry.recipientPubkey]);

		this.received = [entry, ...this.received]
			.sort((a, b) => b.createdAt - a.createdAt)
			.slice(0, MAX_RECEIVED);
		return true;
	}

		/**
		 * Turn a kind 9735 zap receipt into a ledger entry. (Pure parser in
		 * `receiptToZapEntry`; see module docs.)
		 */
	private receiptToEntry(event: Event, me: string): ZapEntry | null {
		return receiptToZapEntry(event, me);
	}

	// ---------------------------------------------------------------------------
	// Sent tracking (local)
	// ---------------------------------------------------------------------------

	/** Record a successfully-paid zap for the Sent ledger + persistence. */
	recordSent(record: Omit<SentRecord, 'createdAt'> & { createdAt?: number }) {
		const entry: ZapEntry = {
			id: record.id,
			direction: 'sent',
			amountSats: Math.max(1, Math.round(record.amountSats)),
			senderPubkey: identity.current?.pk ?? '',
			recipientPubkey: record.recipientPubkey,
			targetNoteId: record.targetNoteId,
			memo: record.memo,
			createdAt: record.createdAt ?? Math.floor(Date.now() / 1000)
		};
		if (this.sent.some((existing) => existing.id === entry.id)) return;
		this.sent = [entry, ...this.sent].slice(0, MAX_RECEIVED);
		profiles.ensure([entry.recipientPubkey]);
		this.persistSent();
	}

	private loadSent() {
		if (!browser) return;
		const me = identity.current?.pk;
		if (!me) return;
		try {
			const raw = localStorage.getItem(`${SENT_KEY}:${me}`);
			if (!raw) return;
			const records = JSON.parse(raw) as SentRecord[];
			this.sent = records.map((record) => ({
				id: record.id,
				direction: 'sent' as const,
				amountSats: record.amountSats,
				senderPubkey: me,
				recipientPubkey: record.recipientPubkey,
				targetNoteId: record.targetNoteId,
				memo: record.memo,
				createdAt: record.createdAt
			}));
		} catch {
			this.sent = [];
		}
	}

	private persistSent() {
		if (!browser) return;
		const me = identity.current?.pk;
		if (!me) return;
		const records: SentRecord[] = this.sent.map((entry) => ({
			id: entry.id,
			amountSats: entry.amountSats,
			recipientPubkey: entry.recipientPubkey,
			targetNoteId: entry.targetNoteId,
			memo: entry.memo,
			createdAt: entry.createdAt
		}));
		localStorage.setItem(`${SENT_KEY}:${me}`, JSON.stringify(records));
	}

	// ---------------------------------------------------------------------------
	// WebLN wallet
	// ---------------------------------------------------------------------------

	/** Detect a WebLN provider without prompting. */
	detectWebLN() {
		this.weblnAvailable = hasWebLN();
	}

	/** Enable the wallet (prompts the user) and pull info + balance. */
	async connectWallet() {
		if (!hasWebLN()) {
			this.error = 'No Lightning wallet found. Install Alby or another WebLN wallet to connect.';
			return false;
		}
		this.weblnBusy = true;
		this.error = null;
		try {
			this.weblnInfo = await getWebLNInfo();
			this.weblnBalance = await weblnBalanceSats();
			this.weblnEnabled = this.weblnInfo != null;
			return this.weblnEnabled;
		} catch (e) {
			this.weblnEnabled = false;
			this.error = (e as Error).message || 'Could not connect wallet';
			return false;
		} finally {
			this.weblnBusy = false;
		}
	}

	disconnectWallet() {
		this.weblnEnabled = false;
		this.weblnInfo = null;
		this.weblnBalance = null;
		this.weblnBusy = false;
	}

	/** Refresh the live balance from the connected wallet. */
	async refreshBalance() {
		if (!this.weblnEnabled) return;
		this.weblnBalance = await weblnBalanceSats();
	}
}

export const wallet = new WalletStore();
