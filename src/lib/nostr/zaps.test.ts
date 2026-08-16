import { describe, expect, it } from 'vitest';
import { bolt11Expiry, satsFromBolt11 } from './zaps';

/**
 * BOLT11 expiry parsing tests.
 *
 * The timestamp vector mirrors the BOLT #11 spec example, whose data part
 * starts with `pvjluez` — the 35-bit encoding of unix 1496314658. The `x`
 * vector is synthetic: `pqqqqqq` encodes 2^30 and field `xzpu` encodes a
 * 60-second relative expiry (`z` = length 2, `pu` = 60).
 */

// Filler keeps the string shaped like an invoice (≥ timestamp + signature).
const FILLER = 'q'.repeat(200);

describe('bolt11Expiry', () => {
	it('reads the timestamp and applies the default 3600s expiry', () => {
		expect(bolt11Expiry(`lnbc1pvjluez${FILLER}`)).toBe(1496314658 + 3600);
	});

	it('honours an explicit x expiry field', () => {
		expect(bolt11Expiry(`lnbc1pqqqqqqxzpu${FILLER}`)).toBe(2 ** 30 + 60);
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
