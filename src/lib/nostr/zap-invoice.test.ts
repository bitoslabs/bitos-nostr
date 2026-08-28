import { describe, expect, it, vi } from 'vitest';
import { createZapInvoice, fetchLnurlPayDetails, resolveZapReceiptRelays } from './zap-invoice';
import * as nip65 from './nip65';

const RECIPIENT = 'a'.repeat(64);

function lnurlMetadata(overrides: Record<string, unknown> = {}) {
	return {
		status: 'OK',
		callback: 'https://provider.example/callback',
		minSendable: 1000,
		maxSendable: 100_000_000,
		allowsNostr: true,
		nostrPubkey: 'b'.repeat(64),
		...overrides
	};
}

function lnurlFetchMock(body: () => Record<string, unknown>) {
	return vi.fn(async () => new Response(JSON.stringify(body())));
}

describe('fetchLnurlPayDetails', () => {
	it('parses metadata and detects NIP-57 support', async () => {
		const fetchMock = lnurlFetchMock(() => lnurlMetadata());
		vi.stubGlobal('fetch', fetchMock);
		const details = await fetchLnurlPayDetails('user@provider.example');
		expect(details.supportsZap).toBe(true);
		expect(details.callback).toBe('https://provider.example/callback');
		expect(fetchMock.mock.calls[0][0]).toBe('https://provider.example/.well-known/lnurlp/user');
		vi.unstubAllGlobals();
	});

	it('throws a friendly error when the provider is unreachable', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 500 })));
		await expect(fetchLnurlPayDetails('user@provider.example')).rejects.toThrow(
			'Could not reach the Lightning provider.'
		);
		vi.unstubAllGlobals();
	});

	it('rejects malformed lightning addresses', async () => {
		await expect(fetchLnurlPayDetails('no-at-sign')).rejects.toThrow('invalid');
	});
});

describe('resolveZapReceiptRelays', () => {
	it('uses the recipient NIP-65 read relays when found', async () => {
		const lookup = vi
			.spyOn(nip65, 'lookupNip65RelayList')
			.mockResolvedValue({ found: true, readRelays: ['wss://recipient.example'] });
		const relays = await resolveZapReceiptRelays(RECIPIENT, ['wss://own.example']);
		expect(relays[0]).toBe('wss://recipient.example');
		expect(relays).toContain('wss://own.example');
		lookup.mockRestore();
	});

	it('pads with popular relays when the lookup fails', async () => {
		const lookup = vi
			.spyOn(nip65, 'lookupNip65RelayList')
			.mockRejectedValue(new Error('offline'));
		const relays = await resolveZapReceiptRelays(RECIPIENT, []);
		expect(relays).toContain('wss://relay.damus.io');
		expect(relays.length).toBeGreaterThanOrEqual(5);
		lookup.mockRestore();
	});
});

describe('createZapInvoice', () => {
	it('builds a signed 9734 with the resolved relays tag and returns the pr', async () => {
		const lookup = vi
			.spyOn(nip65, 'lookupNip65RelayList')
			.mockResolvedValue({ found: true, readRelays: ['wss://recipient.example'] });
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const url = String(input);
				if (url.includes('.well-known/lnurlp')) {
					return new Response(JSON.stringify(lnurlMetadata()));
				}
				// Callback fetch: assert the nostr param carries the signed request.
				const parsed = new URL(url);
				const nostrParam = JSON.parse(parsed.searchParams.get('nostr')!) as {
					kind: number;
					tags: string[][];
				};
				expect(nostrParam.kind).toBe(9734);
				const relaysTag = nostrParam.tags.find((tag) => tag[0] === 'relays');
				expect(relaysTag).toContain('wss://recipient.example');
				return new Response(JSON.stringify({ status: 'OK', pr: 'lnbc1test' }));
			})
		);

		const outcome = await createZapInvoice(
			{
				recipientPubkey: RECIPIENT,
				lightningAddress: 'user@provider.example',
				sats: 21,
				comment: 'nice!',
				eventId: 'e'.repeat(64),
				eventKind: 1,
				anonymous: false
			},
			{ signingSecretHex: 'c'.repeat(64), ownWritableUrls: ['wss://own.example'] }
		);

		expect(outcome.invoice).toBe('lnbc1test');
		expect(outcome.zapRequest?.kind).toBe(9734);
		expect(outcome.recordId).toBe(outcome.zapRequest?.id);
		expect(outcome.receiptRelays).toContain('wss://recipient.example');

		lookup.mockRestore();
		vi.unstubAllGlobals();
	});

	it('falls back to a comment param when the provider cannot zap', async () => {
		const lookup = vi.spyOn(nip65, 'lookupNip65RelayList');
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const url = String(input);
				if (url.includes('.well-known/lnurlp')) {
					return new Response(
						JSON.stringify(lnurlMetadata({ allowsNostr: false, commentAllowed: 200 }))
					);
				}
				const parsed = new URL(url);
				expect(parsed.searchParams.get('nostr')).toBeNull();
				expect(parsed.searchParams.get('comment')).toBe('nice!');
				return new Response(JSON.stringify({ status: 'OK', pr: 'lnbc1plain' }));
			})
		);

		const outcome = await createZapInvoice(
			{
				recipientPubkey: RECIPIENT,
				lightningAddress: 'user@provider.example',
				sats: 21,
				comment: 'nice!',
				anonymous: false
			},
			{ signingSecretHex: 'c'.repeat(64), ownWritableUrls: [] }
		);

		expect(outcome.zapRequest).toBeNull();
		expect(outcome.invoice).toBe('lnbc1plain');
		expect(lookup).not.toHaveBeenCalled();
		lookup.mockRestore();
		vi.unstubAllGlobals();
	});

	it('enforces the provider min/max bounds', async () => {
		// 21 sats = 21 000 msat < 100 000 msat minimum → reject before callback.
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify(lnurlMetadata({ minSendable: 100_000 }))))
		);
		await expect(
			createZapInvoice(
				{
					recipientPubkey: RECIPIENT,
					lightningAddress: 'user@provider.example',
					sats: 21,
					anonymous: false
				},
				{ signingSecretHex: 'c'.repeat(64), ownWritableUrls: [] }
			)
		).rejects.toThrow('Minimum amount is 100 sats.');
		vi.unstubAllGlobals();
	});
});
