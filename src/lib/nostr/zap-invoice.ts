/**
 * NIP-57 zap invoice resolver — shared by the note zap dialog and the support
 * widget so both use the same robust receipt-delivery policy.
 *
 * The critical part is not the invoice (any LNURL client can make one); it is
 * the `relays` tag of the kind 9734 zap request. The recipient's LNURL
 * provider publishes the kind 9735 receipt ONLY to those relays. If the tag
 * misses where the recipient listens, sats move but no notification ever
 * arrives — the "Wall of Satoshi paid, recipient saw nothing" failure.
 *
 * Policy implemented here:
 *  1. Look up the recipient's kind 10002 (NIP-65) across ALL our read relays,
 *     racing them and capping the wait (~2.5s) so a dead primary can't starve
 *     the zap flow on mobile.
 *  2. Prefer their read relays; append our writable relays for sender-side
 *     confirmation.
 *  3. Pad the tag to a healthy size with popular public writable relays, so
 *     even a missing NIP-65 list yields a receipt somewhere the recipient's
 *     client (or its indexer) reads.
 */
import { encodeBytes } from 'nostr-tools/nip19';
import { finalizeEvent, generateSecretKey, type Event } from 'nostr-tools/pure';
import { lookupNip65RelayList } from './nip65';
import { lnurlSupportsZap, zapRelayTagUrls } from './zaps';
import { hexToBytes } from './hex';

export interface LnurlPayDetails {
	/** Callback base URL from the provider's LNURL-pay metadata. */
	callback: string;
	minSendable?: number;
	maxSendable?: number;
	commentAllowed?: number;
	/** Provider supports NIP-57 (will publish a 9735 receipt). */
	supportsZap: boolean;
}

export interface ZapInvoiceRequest {
	/** Recipient Nostr pubkey (hex). */
	recipientPubkey: string;
	/** Lightning address (`user@domain`). */
	lightningAddress: string;
	/** Amount in whole sats. */
	sats: number;
	/** Zap message (kind 9734 content). */
	comment?: string;
	/** Target note id (`e` tag), if zapping a note. */
	eventId?: string;
	/** Target note kind (`k` tag). */
	eventKind?: number;
	/** Sign with an ephemeral key instead of the active identity. */
	anonymous: boolean;
}

export interface ZapInvoiceOutcome {
	/** BOLT11 payment request. */
	invoice: string;
	/** Signed kind 9734 zap request (absent when the provider can't zap). */
	zapRequest: Event | null;
	/** Relays written into the request's `relays` tag (for diagnostics). */
	receiptRelays: string[];
	/** Assembly record id (zap-request id, or synthetic when not a zap). */
	recordId: string;
}

export class ZapInvoiceError extends Error {}

/** Fetch and sanity-check an LNURL-pay endpoint. Throws `ZapInvoiceError`. */
export async function fetchLnurlPayDetails(lightningAddress: string): Promise<LnurlPayDetails> {
	const [user, domain] = lightningAddress.split('@');
	if (!user || !domain || lightningAddress.includes('://')) {
		throw new ZapInvoiceError('The author Lightning address is invalid.');
	}
	const lnurlEndpoint = `https://${domain}/.well-known/lnurlp/${encodeURIComponent(user)}`;
	let metadataResponse: Response;
	try {
		metadataResponse = await fetch(lnurlEndpoint);
	} catch {
		throw new ZapInvoiceError('Could not reach the Lightning provider.');
	}
	if (!metadataResponse.ok) throw new ZapInvoiceError('Could not reach the Lightning provider.');
	const metadata = (await metadataResponse.json()) as {
		status?: string;
		errors?: string;
		callback?: string;
		commentAllowed?: number;
		minSendable?: number;
		maxSendable?: number;
		allowsNostr?: boolean;
		nostrPubkey?: string;
	};
	if (metadata.status === 'ERROR' || !metadata.callback) {
		throw new ZapInvoiceError(metadata.errors || 'The Lightning provider rejected the request.');
	}
	return {
		callback: metadata.callback,
		minSendable: metadata.minSendable,
		maxSendable: metadata.maxSendable,
		commentAllowed: metadata.commentAllowed,
		supportsZap: lnurlSupportsZap(metadata)
	};
}

/**
 * Resolve the receipt-relay tag: recipient's NIP-65 read relays first, our
 * writable relays for confirmation, padded with popular fallbacks (see module
 * docs). Never returns an empty list.
 */
export async function resolveZapReceiptRelays(
	recipientPubkey: string,
	ownWritableUrls: string[],
	options: { nip65TimeoutMs?: number } = {}
): Promise<string[]> {
	let recipientReadRelays: string[] = [];
	try {
		const lookup = await lookupNip65RelayList(recipientPubkey, {
			timeoutMs: options.nip65TimeoutMs
		});
		recipientReadRelays = lookup.readRelays;
	} catch {
		/* offline/dead sockets — fall back to popular relays below */
	}
	return zapRelayTagUrls(recipientReadRelays, ownWritableUrls);
}

/**
 * Full zap-invoice flow: LNURL metadata → relay-tag resolution → signed
 * kind 9734 → callback fetch → BOLT11 `pr`.
 *
 * `signingSecretHex` is the active identity's secret key; an ephemeral key is
 * generated when `request.anonymous` is set or no key is available.
 */
export async function createZapInvoice(
	request: ZapInvoiceRequest,
	options: {
		signingSecretHex?: string;
		ownWritableUrls: string[];
		nip65TimeoutMs?: number;
	} & Partial<{ onDetails: (details: LnurlPayDetails) => void }>
): Promise<ZapInvoiceOutcome> {
	const sats = Math.max(1, Math.round(request.sats));
	const millisats = sats * 1000;

	const details = await fetchLnurlPayDetails(request.lightningAddress);
	options.onDetails?.(details);

	if (details.minSendable && millisats < details.minSendable) {
		throw new ZapInvoiceError(`Minimum amount is ${Math.ceil(details.minSendable / 1000)} sats.`);
	}
	if (details.maxSendable && millisats > details.maxSendable) {
		throw new ZapInvoiceError(`Maximum amount is ${Math.floor(details.maxSendable / 1000)} sats.`);
	}

	const callback = new URL(details.callback);
	callback.searchParams.set('amount', String(millisats));

	let zapRequest: Event | undefined;
	let receiptRelays: string[] = [];
	if (details.supportsZap) {
		receiptRelays = await resolveZapReceiptRelays(
			request.recipientPubkey,
			options.ownWritableUrls,
			{ nip65TimeoutMs: options.nip65TimeoutMs }
		);
		const anonymous = request.anonymous || !options.signingSecretHex;
		zapRequest = finalizeEvent(
			{
				kind: 9734,
				content: request.comment?.trim() ?? '',
				created_at: Math.floor(Date.now() / 1000),
				tags: [
					['relays', ...receiptRelays],
					['amount', String(millisats)],
					['p', request.recipientPubkey],
					...(request.eventId ? [['e', request.eventId] as string[]] : []),
					...(request.eventKind ? [['k', String(request.eventKind)] as string[]] : [])
				]
			},
			anonymous ? generateSecretKey() : hexToBytes(options.signingSecretHex!)
		);
		callback.searchParams.set('nostr', JSON.stringify(zapRequest));
		callback.searchParams.set(
			'lnurl',
			encodeBytes('lnurl', new TextEncoder().encode(lnurlEndpointOf(request.lightningAddress)))
		);
	} else if (request.comment && (details.commentAllowed ?? 0) > 0) {
		callback.searchParams.set('comment', request.comment.slice(0, details.commentAllowed!));
	}

	const recordId = zapRequest?.id ?? `${request.eventId ?? request.recipientPubkey}:${sats}:${Date.now()}`;

	let invoiceResponse: Response;
	try {
		invoiceResponse = await fetch(callback);
	} catch {
		throw new ZapInvoiceError('Could not create a Lightning invoice.');
	}
	if (!invoiceResponse.ok) throw new ZapInvoiceError('Could not create a Lightning invoice.');
	const payment = (await invoiceResponse.json()) as {
		status?: string;
		pr?: string;
		reason?: string;
	};
	if (payment.status === 'ERROR' || !payment.pr) {
		throw new ZapInvoiceError(payment.reason || 'No invoice was returned.');
	}

	return {
		invoice: payment.pr,
		zapRequest: zapRequest ?? null,
		receiptRelays,
		recordId
	};
}

function lnurlEndpointOf(lightningAddress: string): string {
	const [user, domain] = lightningAddress.split('@');
	return `https://${domain}/.well-known/lnurlp/${encodeURIComponent(user)}`;
}
