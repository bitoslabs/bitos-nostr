/** NIP-65 relay-list querying and parsing.
 *
 * A kind 10002 event contains `r` tags in the form
 * `["r", "wss://relay.example", "read" | "write"]`. A missing marker means
 * the relay supports both reads and writes.
 */
import type { Event } from 'nostr-tools/pure';
import { browser } from '$app/environment';
import { queryPrimaryFirst, subscribeUrls } from './pool';
import { relays } from './relays.svelte';
import { NOSTR_KINDS, type RecommendedRelay } from './types';

export interface Nip65Relay {
	url: string;
	read: boolean;
	write: boolean;
}

const RELAY_URL_RE = /^wss?:\/\/[^\s/]+(:\d+)?(\/[^\s]*)?$/i;

function normalizeRelayUrl(url: string): string {
	return url.trim().replace(/\/+$/, '');
}

/** Extract, validate, and merge duplicate relay tags from a NIP-65 event. */
export function parseNip65RelayList(event: Pick<Event, 'tags'>): Nip65Relay[] {
	const parsed = new Map<string, Nip65Relay>();
	for (const tag of event.tags) {
		if (tag[0] !== 'r' || typeof tag[1] !== 'string') continue;
		const url = normalizeRelayUrl(tag[1]);
		if (!RELAY_URL_RE.test(url)) continue;

		const marker = tag[2];
		const read = marker !== 'write';
		const write = marker !== 'read';
		const existing = parsed.get(url);
		parsed.set(url, {
			url,
			read: read || existing?.read || false,
			write: write || existing?.write || false
		});
	}
	return [...parsed.values()];
}

/** Query the most recent NIP-65 list published by a public key. */
export async function queryNip65RelayList(pubkey: string): Promise<Nip65Relay[]> {
	const events = await queryPrimaryFirst([
		{ kinds: [NOSTR_KINDS.RELAY_LIST], authors: [pubkey], limit: 1 }
	]);
	const latest = events
		.filter((event) => event.kind === NOSTR_KINDS.RELAY_LIST && event.pubkey === pubkey)
		.sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))[0];
	return latest ? parseNip65RelayList(latest) : [];
}

export interface Nip65Lookup {
	/** True when a kind 10002 event was actually found somewhere on the network. */
	found: boolean;
	/** Read relay URLs from that event (empty when not found). */
	readRelays: string[];
}

/**
 * Robust network-wide lookup of a pubkey's NIP-65 relay list — the input to
 * the zap-receipt `relays` tag. Unlike {@link queryNip65RelayList}, this:
 *
 *  • queries ALL read relays (not just the primary), each with its own
 *    `maxWait`, so one slow/dead primary can't starve the result;
 *  • distinguishes "no list exists" (found=false) from "couldn't fetch"
 *    (found=true + non-empty, or found=false + we tried), letting the zap
 *    flow pick a fallback instead of silently degrading to a sender-only tag.
 *
 * Returns as soon as any relay returns a list; otherwise after all settle or
 * `timeoutMs` elapses.
 */
export async function lookupNip65RelayList(
	pubkey: string,
	options: { timeoutMs?: number } = {}
): Promise<Nip65Lookup> {
	const { timeoutMs = 2500 } = options;
	if (!browser) return { found: false, readRelays: [] };
	const urls = relays.urls;
	if (!urls.length) return { found: false, readRelays: [] };

	const filter = { kinds: [NOSTR_KINDS.RELAY_LIST], authors: [pubkey], limit: 1 };
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	const readUrlsOf = (event: Event | undefined) =>
		event ? parseNip65RelayList(event).filter((relay) => relay.read).map((relay) => relay.url) : [];

	try {
		return await new Promise<Nip65Lookup>((resolve) => {
			let done = false;
			const finish = (result: Nip65Lookup) => {
				if (done) return;
				done = true;
				clearTimeout(timeout);
				closers.forEach((close) => {
					try {
						close();
					} catch {
						/* already closed */
					}
				});
				resolve(result);
			};

			const closers: Array<() => void> = [];
			let pending = urls.length;

			const sub = subscribeUrls(urls, [filter], {
				onevent: (event) => {
					// First relay to deliver the list wins — a kind 10002 is a
					// full snapshot, there is nothing to merge across relays.
					const readRelays = readUrlsOf(event);
					if (readRelays.length) finish({ found: true, readRelays });
				},
				oneose: () => {
					// EOSE from every relay without a single event → no list exists.
					if (--pending <= 0) finish({ found: false, readRelays: [] });
				}
			});
			closers.push(sub);

			controller.signal.addEventListener('abort', () => finish({ found: false, readRelays: [] }));
		});
	} catch {
		return { found: false, readRelays: [] };
	}
}

/**
 * Add NIP-65 results to the curated recommendations. Curated metadata wins
 * for duplicate URLs, and the static list remains available when no event is
 * found or a relay fails validation.
 */
export function mergeNip65Recommendations(
	defaults: RecommendedRelay[],
	nip65Relays: Nip65Relay[]
): RecommendedRelay[] {
	const merged = new Map(defaults.map((relay) => [normalizeRelayUrl(relay.url), relay]));
	for (const relay of nip65Relays) {
		if (merged.has(relay.url)) continue;
		const access = relay.read && relay.write ? 'read/write' : relay.read ? 'read' : 'write';
		merged.set(relay.url, {
			url: relay.url,
			name: new URL(relay.url).host,
			description: `From your NIP-65 relay list · ${access}`
		});
	}
	return [...merged.values()];
}

/* ------------------------------- publishing ------------------------------ */

import { activeSigner } from '$lib/auth/signer';
import { publish } from './pool';
import { clientTag } from './client-tag';
import type { RelayRecord } from './types';

/**
 * Stable signature of a relay configuration — used to detect changes that
 * should be re-published (and to skip publishing when nothing changed).
 */
export function relayListSignature(
	relays: Array<Pick<RelayRecord, 'url' | 'read' | 'write'>>
): string {
	return [...relays]
		.map((r) => `${normalizeRelayUrl(r.url)}:${r.read ? 'r' : ''}${r.write ? 'w' : ''}`)
		.sort()
		.join('|');
}

/** Build the `r` tags for a kind 10002 event from relay records. */
export function buildNip65Tags(
	relays: Array<Pick<RelayRecord, 'url' | 'read' | 'write'>>
): string[][] {
	const tags: string[][] = [];
	for (const relay of relays) {
		const url = normalizeRelayUrl(relay.url);
		if (!RELAY_URL_RE.test(url)) continue;
		if (relay.read && relay.write) tags.push(['r', url]);
		else if (relay.read) tags.push(['r', url, 'read']);
		else if (relay.write) tags.push(['r', url, 'write']);
	}
	return tags;
}

/**
 * Publish the user's relay list as a kind 10002 NIP-65 event so other clients
 * can discover where to find them. No-op when not signed in or when the list
 * is unchanged since the last publish (signature persisted locally).
 */
export async function publishNip65List(
	relays: Array<Pick<RelayRecord, 'url' | 'read' | 'write'>>
): Promise<boolean> {
	const signer = activeSigner();
	if (!(await signer.isAvailable())) return false;
	const tags = buildNip65Tags(relays);
	if (!tags.length) return false;
	const event = await signer.sign({
		kind: NOSTR_KINDS.RELAY_LIST,
		content: '',
		created_at: Math.floor(Date.now() / 1000),
		tags: [...tags, ...clientTag()]
	});
	await publish(event);
	return true;
}
