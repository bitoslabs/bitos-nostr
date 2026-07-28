/** Byte ⇄ hex helpers for nostr-tools interop (it wants Uint8Array secrets). */

export function bytesToHex(bytes: Uint8Array): string {
	let out = '';
	for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
	return out;
}

export function hexToBytes(hex: string): Uint8Array {
	const clean = hex.length % 2 ? '0' + hex : hex;
	const out = new Uint8Array(clean.length / 2);
	for (let i = 0; i < out.length; i++) {
		out[i] = parseInt(clean.slice(2 * i, 2 * i + 2), 16);
	}
	return out;
}
