/**
 * WebLN bridge — a typed, gracefully-degrading wrapper around the browser
 * WebLN provider (Alby, Mutiny, NWC, etc.). No caller needs to guard against
 * the absence of a wallet: every helper returns a safe result (`null`/`false`)
 * or rejects with a descriptive error when no provider is present.
 *
 * Reference: https://www.webln.guide/developer/connecting/connect-provider
 */
import { browser } from '$app/environment';

export interface WebLNNode {
	alias: string;
	pubkey: string;
	color?: string;
}

export interface WebLNInfo {
	node: WebLNNode;
	methods?: string[];
	supported?: string[];
}

export interface WebLNInvoice {
	paymentRequest: string;
	paymentHash?: string;
	rHash?: string;
	expiresAt?: number;
	description?: string;
}

export interface WebLNInvoiceRequest {
	/** Amount in sats. */
	amount?: number;
	/** Optional memo suggested to the wallet. */
	defaultMemo?: string;
}

export interface WebLNPaymentResult {
	preimage: string;
}

export interface WebLNProvider {
	enable(): Promise<void>;
	disable?(): Promise<void>;
	getInfo(): Promise<WebLNInfo>;
	sendPayment(paymentRequest: string): Promise<WebLNPaymentResult>;
	makeInvoice(request: WebLNInvoiceRequest): Promise<WebLNInvoice>;
	signMessage?(message: string): Promise<{ signature: string; message: string }>;
	verifyMessage?(message: string, signature: string): Promise<boolean>;
	/** Millisatoshis available to spend (Alby/NWC). */
	getBalance?(): Promise<number>;
}

declare global {
	interface Window {
		webln?: WebLNProvider;
	}
}

/** True when a WebLN provider has injected itself onto `window`. */
export function hasWebLN(): boolean {
	return browser && typeof window !== 'undefined' && !!window.webln;
}

let enabling: Promise<boolean> | null = null;

/**
 * Enable WebLN exactly once per session. The first call triggers the wallet's
 * permission prompt; subsequent calls resolve from the cached promise so we
 * never double-prompt. Callers can `try`/`catch` the rejection (user denied).
 */
export async function enableWebLN(): Promise<boolean> {
	if (!hasWebLN()) return false;
	if (!enabling) {
		enabling = window
			.webln!.enable()
			.then(() => true)
			.catch((error: unknown) => {
				// Reset so a later retry isn't locked to the failed promise.
				enabling = null;
				throw error instanceof Error ? error : new Error('WebLN permission denied');
			});
	}
	return enabling;
}

/** Forget the cached enable promise (after a disconnect) so it re-prompts. */
export function resetWebLNCache() {
	enabling = null;
}

/** Wallet node info (alias/pubkey) once enabled, or `null`. */
export async function getWebLNInfo(): Promise<WebLNInfo | null> {
	if (!hasWebLN()) return null;
	try {
		await enableWebLN();
		return await window.webln!.getInfo();
	} catch {
		return null;
	}
}

/**
 * Live wallet balance in **sats**. Returns `null` when WebLN is absent, not
 * yet enabled, or the provider doesn't expose `getBalance`.
 */
export async function weblnBalanceSats(): Promise<number | null> {
	if (!hasWebLN()) return null;
	try {
		await enableWebLN();
		if (window.webln?.getBalance) {
			const msats = await window.webln.getBalance();
			return Math.round(msats / 1000);
		}
	} catch {
		return null;
	}
	return null;
}

/**
 * Pay a BOLT11 invoice through the connected wallet. Rejects on denial/failure
 * with a human-readable message so the caller can surface a toast.
 */
export async function payWithWebLN(invoice: string): Promise<string> {
	if (!hasWebLN()) throw new Error('No Lightning wallet found');
	await enableWebLN();
	const result = await window.webln!.sendPayment(invoice);
	return result.preimage;
}

/**
 * Create a deposit invoice for `amountSats` from the connected wallet.
 * Returns the BOLT11 string, or `null` when unavailable.
 */
export async function makeWebLNInvoice(amountSats: number, memo = ''): Promise<string | null> {
	if (!hasWebLN()) return null;
	try {
		await enableWebLN();
		const invoice = await window.webln!.makeInvoice({ amount: amountSats, defaultMemo: memo });
		return invoice.paymentRequest;
	} catch {
		return null;
	}
}
