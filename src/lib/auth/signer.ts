/**
 * NostrSigner — plan §18 authentication seam.
 *
 * Services/controllers sign through this interface and never touch raw key
 * material (`nostr_nsec` / `identity.current.sk`) themselves. The local
 * implementation keeps the current localStorage flow; NIP-46 bunkers and
 * NIP-55 external signers can be added later as additional implementations
 * without touching call sites.
 */
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/pure';
import { bytesToHex, hexToBytes } from '$lib/nostr/hex';
import { identity } from '$lib/nostr/identity.svelte';

/** Minimal unsigned shape handed to a signer (nostr-tools EventTemplate). */
export type UnsignedEvent = Parameters<typeof finalizeEvent>[0];

export interface NostrSigner {
	/** Pubkey (hex) this signer will authorize events as. */
	getPublicKey(): Promise<string>;
	/** Sign an unsigned event, returning a fully authorized Nostr event. */
	sign(event: UnsignedEvent): Promise<Event>;
	/** Whether the signer can sign right now (identity loaded, bunker up…). */
	isAvailable(): Promise<boolean>;
}

/**
 * Local signer over the built-in identity store (current flow, kept for
 * compatibility). Reads the key at call time — never cached — so account
 * switches and logout take effect immediately.
 */
export class LocalSigner implements NostrSigner {
	async getPublicKey(): Promise<string> {
		const id = identity.current;
		if (!id) throw new Error('No identity — create or import a key first');
		return id.pk;
	}

	async sign(unsigned: UnsignedEvent): Promise<Event> {
		const id = identity.current;
		if (!id) throw new Error('No identity — create or import a key first');
		return finalizeEvent(unsigned, hexToBytes(id.sk));
	}

	async isAvailable(): Promise<boolean> {
		return identity.current !== null;
	}
}

/** Deterministic signer for tests — fixed key, never shipped with production. */
export class TestSigner implements NostrSigner {
	readonly pubkey: string;

	constructor(secretHex: string) {
		if (!/^[0-9a-fA-F]{64}$/.test(secretHex)) throw new Error('Expected 64-char hex secret');
		const normalized = secretHex.toLowerCase();
		this.pubkey = getPublicKey(hexToBytes(normalized));
		this.secret = normalized;
	}

	private secret: string;

	async getPublicKey(): Promise<string> {
		return this.pubkey;
	}

	async sign(unsigned: UnsignedEvent): Promise<Event> {
		return finalizeEvent(unsigned, hexToBytes(this.secret));
	}

	async isAvailable(): Promise<boolean> {
		return true;
	}
}

/**
 * The signer for the active account. Single seam: when NIP-46/NIP-55 arrive,
 * this is the only place that decides which implementation is returned.
 */
export function activeSigner(): NostrSigner {
	return new LocalSigner();
}

/** Convenience for call sites that still validate hex pubkeys inline. */
export function pubkeyOf(event: Event): string {
	return event.pubkey;
}

/** Test/verification helper: hex-encode raw bytes (re-exported for symmetry). */
export { bytesToHex };

/* ---------- PoW-aware signing (CORE-006b) ---------------------------------- */

/**
 * Sign a (possibly pre-mined) unsigned event through a NostrSigner.
 *
 * NIP-13 mining commits to the full serialized event — including the `pubkey`
 * field — before the signature exists, so PoW flows need the signer's pubkey
 * up front (`getPublicKey`), then hand the mined template to `sign`.
 *
 * Throws when the miner's `pubkey` doesn't match the signer's: that means the
 * active account changed between mining and signing, and publishing would
 * attribute one key's proof-of-work to another account.
 */
export async function signMined(unsigned: UnsignedEvent, signer = activeSigner()): Promise<Event> {
	const [event, expectedPubkey] = await Promise.all([signer.sign(unsigned), signer.getPublicKey()]);
	if (event.pubkey !== expectedPubkey) {
		throw new Error(
			'Signer pubkey changed during publish — aborting to avoid attributing work to another account'
		);
	}
	return event;
}
