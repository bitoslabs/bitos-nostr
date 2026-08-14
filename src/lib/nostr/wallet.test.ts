import { describe, expect, it } from 'vitest';
import { receiptToZapEntry } from './wallet.svelte';
import type { Event } from './types';

const ME = 'a'.repeat(64);
const SENDER = 'b'.repeat(64);
const LNURL_PUBKEY = 'c'.repeat(64);

function makeReceipt(overrides: Partial<Event> & { tags?: string[][] }): Event {
	return {
		id: 'receipt1',
		pubkey: LNURL_PUBKEY,
		kind: 9735,
		created_at: 1_700_000_000,
		content: '',
		tags: [],
		sig: '',
		...overrides
	};
}

/** Build a `description` tag containing a signed-looking kind 9734 zap request. */
function descriptionTag(sender: string, memo?: string) {
	const zapRequest = {
		kind: 9734,
		pubkey: sender,
		content: memo ?? '',
		created_at: 1_699_999_999,
		tags: [['relays', 'wss://relay.example.com']]
	};
	return ['description', JSON.stringify(zapRequest)];
}

describe('receiptToZapEntry', () => {
	it('parses a NIP-57 receipt with an amount tag + sender from the description', () => {
		const event = makeReceipt({
			tags: [
				['p', ME],
				['e', 'note1'],
				['amount', '21000000'],
				['bolt11', 'lnbc210n1pj...'],
				descriptionTag(SENDER, 'Great post!')
			]
		});
		const entry = receiptToZapEntry(event, ME);
		expect(entry).not.toBeNull();
		expect(entry!.amountSats).toBe(21000);
		expect(entry!.direction).toBe('received');
		expect(entry!.recipientPubkey).toBe(ME);
		expect(entry!.senderPubkey).toBe(SENDER);
		expect(entry!.targetNoteId).toBe('note1');
		expect(entry!.memo).toBe('Great post!');
		expect(entry!.bolt11).toBe('lnbc210n1pj...');
	});

	it('falls back to the bolt11 amount when no `amount` tag is present', () => {
		const event = makeReceipt({
			tags: [['p', ME], ['bolt11', 'lnbc1000n1pj...'], descriptionTag(SENDER)]
		});
		// "lnbc1000n" → 1000 milli-nano ... → 100 sats via satsFromBolt11.
		const entry = receiptToZapEntry(event, ME);
		expect(entry).not.toBeNull();
		expect(entry!.amountSats).toBeGreaterThan(0);
	});

	it('recovers the sender pubkey lowercased', () => {
		const upper = 'D'.repeat(64);
		const event = makeReceipt({
			tags: [['p', ME], ['amount', '1000'], descriptionTag(upper)]
		});
		const entry = receiptToZapEntry(event, ME);
		expect(entry!.senderPubkey).toBe(upper.toLowerCase());
	});

	it('falls back to the receipt pubkey when the description is malformed', () => {
		const event = makeReceipt({
			tags: [['p', ME], ['amount', '21000'], ['description', 'not-json']]
		});
		const entry = receiptToZapEntry(event, ME);
		expect(entry!.senderPubkey).toBe(LNURL_PUBKEY);
		expect(entry!.memo).toBeUndefined();
	});

	it('returns null when there is no recipient (#p) tag', () => {
		const event = makeReceipt({
			tags: [['amount', '21000'], descriptionTag(SENDER)]
		});
		expect(receiptToZapEntry(event, ME)).toBeNull();
	});

	it('returns null when no spendable amount can be derived', () => {
		const event = makeReceipt({
			tags: [['p', ME], descriptionTag(SENDER)]
		});
		expect(receiptToZapEntry(event, ME)).toBeNull();
	});

	it('records an empty memo as undefined', () => {
		const event = makeReceipt({
			tags: [['p', ME], ['amount', '21000'], descriptionTag(SENDER, '   ')]
		});
		expect(receiptToZapEntry(event, ME)!.memo).toBeUndefined();
	});
});
