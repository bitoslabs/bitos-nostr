/** Minimal NIP-47 (Nostr Wallet Connect) client.
 *
 * The connection URI contains a spending secret. When the user chooses a
 * custom NWC wallet, the URI is retained in localStorage on this device so it
 * can be restored after reload.
 */
import { browser } from '$app/environment';
import { nip04 } from 'nostr-tools';
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, getPublicKey, type Event } from 'nostr-tools/pure';
import { hexToBytes } from './hex';

interface Connection {
	pubkey: string;
	relays: string[];
	secret: string;
}

interface Response {
	result_type?: string;
	result?: Record<string, unknown>;
	error?: { code?: string; message?: string };
}

let connection: Connection | null = null;
let pool: SimplePool | null = null;
const STORAGE_KEY = 'bitos:nwc-wallets';

function getPool() {
	if (!browser) throw new Error('NWC is only available in the browser.');
	return (pool ??= new SimplePool());
}

export function isNwcConnected() {
	return connection !== null;
}

export function connectNwc(uri: string) {
	let parsed: URL;
	try {
		parsed = new URL(uri.trim());
	} catch {
		throw new Error('This NWC connection string is invalid.');
	}
	const pubkey = (parsed.pathname || parsed.host).replace(/^\//, '');
	const relays = parsed.searchParams.getAll('relay');
	const secret = parsed.searchParams.get('secret') ?? '';
	if (
		!/^nostr\+walletconnect:$/i.test(parsed.protocol) ||
		!/^[0-9a-f]{64}$/i.test(pubkey) ||
		!/^[0-9a-f]{64}$/i.test(secret) ||
		!relays.length
	) {
		throw new Error('This NWC connection string is invalid.');
	}
	connection = { pubkey, relays: [...new Set(relays)], secret };
	if (browser) localStorage.setItem(STORAGE_KEY, uri.trim());
}

/** Restore the last custom NWC URI saved on this device, without making a request yet. */
export function restoreSavedNwc() {
	if (!browser || connection) return false;
	const uri = localStorage.getItem(STORAGE_KEY);
	if (!uri) return false;
	try {
		connectNwc(uri);
		return true;
	} catch {
		localStorage.removeItem(STORAGE_KEY);
		return false;
	}
}

export function disconnectNwc() {
	connection = null;
}

/** Disconnect and remove the locally saved NWC spending connection. */
export function forgetNwc() {
	connection = null;
	if (browser) localStorage.removeItem(STORAGE_KEY);
}

async function request(method: string, params: Record<string, unknown> = {}) {
	if (!connection) throw new Error('No custom NWC wallet is connected.');
	const active = connection;
	// In NIP-47 the URI's `secret` is the client key. It encrypts/signs every
	// request; generating a replacement key would make the wallet reject it.
	const secret = hexToBytes(active.secret);
	const content = await nip04.encrypt(
		active.secret,
		active.pubkey,
		JSON.stringify({ method, params })
	);
	const event = finalizeEvent(
		{
			kind: 23194,
			created_at: Math.floor(Date.now() / 1000),
			tags: [['p', active.pubkey]],
			content
		},
		secret
	);
	const clientPubkey = getPublicKey(secret);
	const p = getPool();

	return new Promise<Response>((resolve, reject) => {
		let settled = false;
		const finish = (fn: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			sub.close();
			fn();
		};
		const sub = p.subscribeMany(
			active.relays,
			{
				kinds: [23195],
				authors: [active.pubkey],
				'#p': [clientPubkey],
				'#e': [event.id]
			},
			{
				onevent: async (response: Event) => {
					try {
						const plaintext = await nip04.decrypt(active.secret, active.pubkey, response.content);
						const decoded = JSON.parse(plaintext) as Response;
						if (decoded.error)
							throw new Error(
								decoded.error.message || decoded.error.code || 'Wallet request failed.'
							);
						finish(() => resolve(decoded));
					} catch (error) {
						finish(() =>
							reject(error instanceof Error ? error : new Error('Invalid wallet response.'))
						);
					}
				}
			}
		);
		const timeout = setTimeout(
			() => finish(() => reject(new Error('Wallet did not respond. Please try again.'))),
			20_000
		);
		void Promise.allSettled(p.publish(active.relays, event)).then((published) => {
			if (!published.some((result) => result.status === 'fulfilled')) {
				finish(() => reject(new Error('Could not reach the wallet relay.')));
			}
		});
	});
}

export async function nwcInfo() {
	const response = await request('get_info');
	return response.result ?? {};
}

export async function nwcBalanceSats() {
	const response = await request('get_balance');
	const msats = Number(response.result?.balance ?? 0);
	return Number.isFinite(msats) ? Math.round(msats / 1000) : null;
}

export async function nwcPayInvoice(invoice: string) {
	const response = await request('pay_invoice', { invoice });
	return typeof response.result?.preimage === 'string' ? response.result.preimage : '';
}

export async function nwcMakeInvoice(amountSats: number, description = '') {
	const response = await request('make_invoice', {
		amount: Math.round(amountSats * 1000),
		description
	});
	const invoice = response.result?.invoice;
	return typeof invoice === 'string' ? invoice : null;
}
