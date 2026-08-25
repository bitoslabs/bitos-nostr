/**
 * Signed-event outbox (plan PUB-012, §12.2).
 *
 * "keep signed event in local outbox until configured durability threshold
 * is met; retry to relays without changing signed event; do not silently
 * rebuild/sign a different event on retry."
 *
 * Web maps the plan's SQLite `outbox` table onto localStorage: a small ring
 * of pending signed events, each with per-relay ACK outcomes. A run stays in
 * the outbox until `minAcks` distinct relays have accepted the SAME event id
 * (the durability threshold), then it graduates and is dropped. Only the
 * signed event JSON is stored — never a rebuildable draft — so a retry can
 * never produce a different signature.
 */
import { browser } from '$app/environment';

export const EVENT_OUTBOX_KEY = 'bitos:event-outbox';
export const EVENT_OUTBOX_VERSION = 1;

/** Signed events are tiny; the ring exists so an offline streak cannot wedge
 *  storage on churn (reactions/replies) — oldest runs fall off first. */
export const MAX_OUTBOX_ENTRIES = 100;

/** Default §12.2 threshold: "at least one relay ACK for publish success". */
export const DEFAULT_MIN_ACKS = 1;

interface SignedEventShape {
	id: string;
	pubkey: string;
	kind: number;
	content: string;
	created_at: number;
	tags: unknown;
	sig: string;
}

export interface OutboxAck {
	url: string;
	at: number;
}

export interface OutboxEntry {
	version: number;
	/** Signed event, retried byte-for-byte (never re-signed). */
	event: SignedEventShape;
	createdAt: number;
	/** Relay URLs that returned `OK: true` for this exact event id. */
	acks: OutboxAck[];
	/** URLs that refused or failed — kept for retry/debug UX (§12.2). */
	failures: { url: string; reason: string; at: number }[];
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

/** Strict shape check — an entry that cannot round-trip is dropped, never thrown. */
export function parseOutboxEntry(raw: unknown): OutboxEntry | null {
	if (!isPlainObject(raw)) return null;
	if (raw.version !== EVENT_OUTBOX_VERSION) return null;
	const event = raw.event;
	if (!isPlainObject(event)) return null;
	if (typeof event.id !== 'string' || !/^[0-9a-f]{64}$/.test(event.id)) return null;
	if (typeof event.pubkey !== 'string' || typeof event.sig !== 'string') return null;
	if (!isFiniteNumber(event.kind) || !isFiniteNumber(event.created_at)) return null;
	if (typeof event.content !== 'string' || !Array.isArray(event.tags)) return null;

	const acks: OutboxAck[] = Array.isArray(raw.acks)
		? raw.acks.filter(
				(a): a is OutboxAck => isPlainObject(a) && typeof a.url === 'string' && isFiniteNumber(a.at)
			)
		: [];
	const failures = Array.isArray(raw.failures)
		? raw.failures.filter(
				(f): f is { url: string; reason: string; at: number } =>
					isPlainObject(f) &&
					typeof f.url === 'string' &&
					typeof f.reason === 'string' &&
					isFiniteNumber(f.at)
			)
		: [];

	return {
		version: EVENT_OUTBOX_VERSION,
		event: event as unknown as SignedEventShape,
		createdAt: isFiniteNumber(raw.createdAt) ? raw.createdAt : Date.now(),
		acks,
		failures
	};
}

export function readOutbox(): OutboxEntry[] {
	if (!browser) return [];
	try {
		const raw = localStorage.getItem(EVENT_OUTBOX_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed
			.map(parseOutboxEntry)
			.filter((e): e is OutboxEntry => e !== null)
			.slice(0, MAX_OUTBOX_ENTRIES);
	} catch {
		return [];
	}
}

function writeOutbox(entries: OutboxEntry[]) {
	if (!browser) return;
	try {
		localStorage.setItem(EVENT_OUTBOX_KEY, JSON.stringify(entries.slice(0, MAX_OUTBOX_ENTRIES)));
	} catch {
		/* quota — the ring already trims; drop silently rather than wedge publishing */
	}
}

/** Record a signed event for durability tracking. Idempotent per event id. */
export function stageEvent(
	event: SignedEventShape,
	options: { minAcks?: number; now?: number } = {}
): OutboxEntry[] {
	if (!browser) return [];
	const minAcks = options.minAcks ?? DEFAULT_MIN_ACKS;
	const existing = readOutbox();
	if (existing.some((entry) => entry.event.id === event.id)) return existing;
	const entries = [
		{
			version: EVENT_OUTBOX_VERSION,
			event,
			createdAt: options.now ?? Date.now(),
			acks: [],
			failures: []
		},
		...existing
	];
	writeOutbox(trimGraduated(entries, minAcks));
	return readOutbox();
}

/** §12.2 durability: an entry graduates once `minAcks` distinct relays OK'd it. */
export function meetsThreshold(entry: OutboxEntry, minAcks = DEFAULT_MIN_ACKS): boolean {
	const seen = new Set<string>();
	let count = 0;
	for (const ack of entry.acks) {
		if (!seen.has(ack.url)) {
			seen.add(ack.url);
			count++;
		}
	}
	return count >= minAcks;
}

export function recordAck(
	eventId: string,
	url: string,
	options: { minAcks?: number; now?: number } = {}
): OutboxEntry[] {
	if (!browser) return [];
	const minAcks = options.minAcks ?? DEFAULT_MIN_ACKS;
	const entries = readOutbox().map((entry) => {
		if (entry.event.id !== eventId) return entry;
		if (entry.acks.some((ack) => ack.url === url)) return entry;
		return { ...entry, acks: [...entry.acks, { url, at: options.now ?? Date.now() }] };
	});
	writeOutbox(trimGraduated(entries, minAcks));
	return readOutbox();
}

export function recordFailure(
	eventId: string,
	url: string,
	reason: string,
	options: { now?: number } = {}
): OutboxEntry[] {
	if (!browser) return [];
	const at = options.now ?? Date.now();
	const entries = readOutbox().map((entry) => {
		if (entry.event.id !== eventId) return entry;
		if (entry.failures.some((f) => f.url === url && f.reason === reason)) return entry;
		return { ...entry, failures: [...entry.failures, { url, reason, at }] };
	});
	writeOutbox(entries);
	return readOutbox();
}

/** Drop graduated entries (kept in memory until the next write otherwise). */
function trimGraduated(entries: OutboxEntry[], minAcks: number): OutboxEntry[] {
	const trimmed = entries.filter((entry) => !meetsThreshold(entry, minAcks));
	return trimmed.slice(0, MAX_OUTBOX_ENTRIES);
}

/** Entries still short of the threshold — what a retry drain should send. */
export function pendingOutbox(minAcks = DEFAULT_MIN_ACKS): OutboxEntry[] {
	return readOutbox().filter((entry) => !meetsThreshold(entry, minAcks));
}

export function clearOutbox() {
	if (!browser) return;
	try {
		localStorage.removeItem(EVENT_OUTBOX_KEY);
	} catch {
		/* ignore */
	}
}
