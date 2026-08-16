import { describe, expect, it } from 'vitest';
import { bolt11Expiry, lnurlSupportsZap, satsFromBolt11, zapRelayTagUrls } from './zaps';

/**
 * BOLT11 expiry parsing tests.
 *
 * The timestamp vector mirrors the BOLT #11 spec example, whose data part
 * starts with `pvjluez` — the 35-bit encoding of unix 1496314658. The `x`
 * vector is synthetic: `pqqqqqq` encodes 2^30 and field `xqzpu` encodes a
 * 60-second relative expiry (`qz` = two-word length 2, `pu` = 60).
 */

// Filler keeps the string shaped like an invoice (≥ timestamp + signature).
const FILLER = 'q'.repeat(200);

describe('bolt11Expiry', () => {
	it('reads the timestamp and applies the default 3600s expiry', () => {
		expect(bolt11Expiry(`lnbc1pvjluez${FILLER}`)).toBe(1496314658 + 3600);
	});

	it('honours an explicit x expiry field', () => {
		expect(bolt11Expiry(`lnbc1pqqqqqqxqzpu${FILLER}`)).toBe(2 ** 30 + 60);
	});

	it('keeps tag alignment before reading an x expiry field', () => {
		// `pq pq` is a one-word non-expiry field before `xqzpu`.
		expect(bolt11Expiry(`lnbc1pqqqqqqpqpqxqzpu${FILLER}`)).toBe(2 ** 30 + 60);
	});

	it('accepts uppercase invoices', () => {
		expect(bolt11Expiry(`LNBC1PVJLUEZ${FILLER}`)).toBe(1496314658 + 3600);
	});

	it('parses with an amount + unit prefix in the human-readable part', () => {
		expect(bolt11Expiry(`lnbc20m1pvjluez${FILLER}`)).toBe(1496314658 + 3600);
	});

	it('rejects non-invoices', () => {
		expect(bolt11Expiry('')).toBeNull();
		expect(bolt11Expiry('nonsense')).toBeNull();
		expect(
			bolt11Expiry('lnurl1dp68gurn8ghj7mr0vdskc6r0wd6x7mrww94excttpv93kycetevvdan8vctn')
		).toBeNull();
	});
});

describe('satsFromBolt11', () => {
	it('decodes unit prefixes into whole sats', () => {
		expect(satsFromBolt11('lnbc20m1' + FILLER)).toBe(2_000_000);
		expect(satsFromBolt11('lnbc900u1' + FILLER)).toBe(90_000);
		expect(satsFromBolt11('lnbc50n1' + FILLER)).toBe(5);
	});
});

describe('lnurlSupportsZap', () => {
	it('accepts provider (zapper) keys that differ from the recipient pubkey', () => {
		// NIP-57: nostrPubkey is the Lightning provider's receipt-signing key,
		// not the recipient's Nostr key — must not be matched against it.
		expect(lnurlSupportsZap({ allowsNostr: true, nostrPubkey: 'ab'.repeat(32) })).toBe(true);
	});

	it('rejects providers without nostr support or a valid signing key', () => {
		expect(lnurlSupportsZap(undefined)).toBe(false);
		expect(lnurlSupportsZap({})).toBe(false);
		expect(lnurlSupportsZap({ allowsNostr: false, nostrPubkey: 'ab'.repeat(32) })).toBe(false);
		expect(lnurlSupportsZap({ allowsNostr: true })).toBe(false);
		expect(lnurlSupportsZap({ allowsNostr: true, nostrPubkey: 'npub1xyz' })).toBe(false);
	});
});

describe('zapRelayTagUrls', () => {
	it('prefers recipient read relays and appends a few of our own', () => {
		const recipient = ['wss://a.example', 'wss://b.example', 'wss://c.example'];
		const own = ['wss://own1.example', 'wss://own2.example'];
		expect(zapRelayTagUrls(recipient, own)).toEqual([
			'wss://a.example',
			'wss://b.example',
			'wss://c.example',
			'wss://own1.example',
			'wss://own2.example'
		]);
	});

	it('deduplicates overlapping relays and caps the list', () => {
		const recipient = Array.from({ length: 10 }, (_, i) => `wss://r${i}.example`);
		const own = ['wss://r1.example', ...Array.from({ length: 5 }, (_, i) => `wss://o${i}.example`)];
		expect(zapRelayTagUrls(recipient, own)).toHaveLength(8);
		expect(new Set(zapRelayTagUrls(recipient, own)).size).toBe(8);
	});

	it('falls back to our relays when the recipient list is empty', () => {
		expect(zapRelayTagUrls([], ['wss://only.example'])).toEqual(['wss://only.example']);
	});
});
