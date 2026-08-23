import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (key: string) => memory.get(key) ?? null,
	setItem: (key: string, value: string) => void memory.set(key, value),
	removeItem: (key: string) => void memory.delete(key)
});

const {
	readOutbox,
	stageEvent,
	recordAck,
	recordFailure,
	pendingOutbox,
	meetsThreshold,
	parseOutboxEntry,
	clearOutbox,
	EVENT_OUTBOX_KEY,
	MAX_OUTBOX_ENTRIES
} = await import('./event-outbox');

function signedEvent(id = 'a'.repeat(64)) {
	return {
		id,
		pubkey: 'b'.repeat(64),
		kind: 22,
		content: 'caption',
		created_at: 1_700_000_000,
		tags: [['imeta', 'url https://cdn.example/x.mp4']],
		sig: 'c'.repeat(128)
	};
}

beforeEach(() => {
	memory.clear();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('stageEvent', () => {
	it('stores the signed event with no outcomes yet', () => {
		stageEvent(signedEvent());
		const entries = readOutbox();
		expect(entries).toHaveLength(1);
		expect(entries[0].event.id).toBe('a'.repeat(64));
		expect(entries[0].acks).toEqual([]);
		expect(entries[0].failures).toEqual([]);
	});

	it('is idempotent per event id — never stages a duplicate', () => {
		stageEvent(signedEvent());
		stageEvent(signedEvent());
		expect(readOutbox()).toHaveLength(1);
	});

	it('keeps the ring bounded — oldest entries fall off first', () => {
		const first = signedEvent('1'.repeat(64));
		stageEvent(first, { now: 1 });
		for (let i = 0; i < MAX_OUTBOX_ENTRIES; i++) {
			// 64-char hex ids: zero-padded counter keeps the length stable
			const id = i.toString(16).padStart(64, '0');
			stageEvent(signedEvent(id), { now: 2 + i });
		}
		const entries = readOutbox();
		expect(entries).toHaveLength(MAX_OUTBOX_ENTRIES);
		expect(entries.some((entry) => entry.event.id === first.id)).toBe(false);
	});
});

describe('meetsThreshold / recordAck', () => {
	it('graduates only after minAcks distinct relays ack', () => {
		const event = signedEvent();
		stageEvent(event);
		recordAck(event.id, 'wss://one.example', { minAcks: 2 });
		expect(pendingOutbox(2)).toHaveLength(1);
		recordAck(event.id, 'wss://two.example', { minAcks: 2 });
		// threshold met → entry dropped from storage
		expect(readOutbox()).toHaveLength(0);
		expect(pendingOutbox(2)).toHaveLength(0);
	});

	it('counts a relay once even after duplicate ACKs', () => {
		const event = signedEvent();
		stageEvent(event);
		recordAck(event.id, 'wss://one.example', { minAcks: 2 });
		recordAck(event.id, 'wss://one.example', { minAcks: 2 });
		expect(meetsThreshold(readOutbox()[0] ?? ({ acks: [] } as never), 2)).toBe(false);
		expect(pendingOutbox(2)).toHaveLength(1);
	});

	it('default threshold is one relay ACK', () => {
		const event = signedEvent();
		stageEvent(event);
		recordAck(event.id, 'wss://only.example');
		expect(readOutbox()).toHaveLength(0);
	});

	it('retains per-relay failure reasons for debug UX (§12.2)', () => {
		const event = signedEvent();
		stageEvent(event);
		recordFailure(event.id, 'wss://bad.example', 'timeout', { now: 5 });
		recordFailure(event.id, 'wss://bad.example', 'timeout', { now: 6 }); // deduped
		recordFailure(event.id, 'wss://bad.example', 'rejected: blocked', { now: 7 });
		const entry = readOutbox()[0];
		expect(entry.failures).toHaveLength(2);
	});
});

describe('parseOutboxEntry', () => {
	it('rejects corrupt rows, foreign versions, and malformed ids', () => {
		expect(parseOutboxEntry(null)).toBeNull();
		expect(parseOutbufEntryMalformed()).toBeNull();
	});

	it('drops malformed ack/failure rows but keeps the entry', () => {
		memory.set(
			EVENT_OUTBOX_KEY,
			JSON.stringify([
				{
					version: 1,
					event: signedEvent(),
					createdAt: 1,
					acks: [{ url: 'wss://ok.example', at: 3 }, { url: 42 }, 'nope'],
					failures: [{ url: 'wss://x', at: 1 }]
				}
			])
		);
		const entries = readOutbox();
		expect(entries).toHaveLength(1);
		expect(entries[0].acks).toEqual([{ url: 'wss://ok.example', at: 3 }]);
		expect(entries[0].failures).toEqual([]);
	});
});

describe('clearOutbox', () => {
	it('removes all staged events', () => {
		stageEvent(signedEvent());
		clearOutbox();
		expect(readOutbox()).toEqual([]);
	});
});

// helper: an entry whose event shape fails validation
function parseOutbufEntryMalformed() {
	return parseOutboxEntry({ version: 1, event: { id: 'not-hex' } });
}
