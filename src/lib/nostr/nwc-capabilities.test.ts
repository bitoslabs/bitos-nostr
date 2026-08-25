import { describe, expect, it } from 'vitest';
import {
	NWC_USED_METHODS,
	classifyNwcError,
	nwcGrantsUsedMethods,
	parseNwcCapabilities,
	redactNwcUri
} from './nwc-capabilities';

const WALLET_PK = 'aa'.repeat(32);

describe('parseNwcCapabilities', () => {
	it('splits granted methods from unknown future ones, dedupes', () => {
		const caps = parseNwcCapabilities({
			methods: ['get_balance', 'get_balance', 'pay_invoice', 'future_method']
		});
		expect(caps.methods).toEqual(['get_balance', 'pay_invoice']);
		expect(caps.unknownMethods).toEqual(['future_method']);
	});

	it('tolerates missing/malformed result shapes', () => {
		expect(parseNwcCapabilities(undefined)).toEqual({ methods: [], unknownMethods: [] });
		expect(parseNwcCapabilities(null)).toEqual({ methods: [], unknownMethods: [] });
		expect(parseNwcCapabilities({ methods: 'nope' })).toEqual({ methods: [], unknownMethods: [] });
		expect(parseNwcCapabilities({ methods: [42, null, 'get_info'] }).methods).toEqual(['get_info']);
	});
});

describe('nwcGrantsUsedMethods', () => {
	it('true only when every method this build calls is granted', () => {
		expect(nwcGrantsUsedMethods(parseNwcCapabilities({ methods: [...NWC_USED_METHODS] }))).toBe(
			true
		);
		expect(
			nwcGrantsUsedMethods(parseNwcCapabilities({ methods: ['get_balance', 'pay_invoice'] }))
		).toBe(false);
	});
});

describe('classifyNwcError', () => {
	it('maps NIP-47 codes to actionable classes', () => {
		expect(classifyNwcError({ error: { code: 'RATE_LIMITED', message: 'slow down' } })).toEqual({
			code: 'RATE_LIMITED',
			action: 'retry-with-backoff',
			message: 'slow down'
		});
		expect(classifyNwcError({ error: { code: 'NOT_ENOUGH_FUNDS' } }).action).toBe(
			'insufficient-funds'
		);
		expect(classifyNwcError({ error: { code: 'QUOTA_EXCEEDED' } }).action).toBe('deny-persistent');
		expect(classifyNwcError({ error: { code: 'UNAUTHORIZED' } }).action).toBe('auth');
	});

	it('recognizes codes embedded in thrown Error messages', () => {
		expect(classifyNwcError(new Error('wallet said PAYMENT_PENDING, try later'))).toEqual({
			code: 'PAYMENT_PENDING',
			action: 'retry-with-backoff',
			message: 'wallet said PAYMENT_PENDING, try later'
		});
	});

	it('unknown shapes classify as UNKNOWN/fatal without throwing', () => {
		expect(classifyNwcError({ error: { code: 'SOMETHING_NEW' } })).toEqual({
			code: 'UNKNOWN',
			action: 'fatal',
			message: 'Wallet request failed.'
		});
		expect(classifyNwcError('plain string')).toEqual({
			code: 'UNKNOWN',
			action: 'fatal',
			message: 'plain string'
		});
		expect(classifyNwcError(undefined)).toEqual({
			code: 'UNKNOWN',
			action: 'fatal',
			message: 'Wallet request failed.'
		});
	});
});

describe('redactNwcUri', () => {
	it('keeps a truncated wallet key + relays, never the secret', () => {
		const uri = `nostr+walletconnect:${WALLET_PK}?relay=wss%3A%2F%2Fa.example&relay=wss%3A%2F%2Fb.example&secret=${'ff'.repeat(32)}`;
		const redacted = redactNwcUri(uri);
		expect(redacted).toContain(WALLET_PK.slice(0, 8));
		expect(redacted).toContain('a.example');
		expect(redacted).not.toContain('f'.repeat(8));
		expect(redacted).toContain('secret=…');
	});

	it('invalid input degrades to a constant, never echoes the input', () => {
		expect(redactNwcUri('not a uri at all')).toBe('nostr+walletconnect:<invalid>');
	});
});
