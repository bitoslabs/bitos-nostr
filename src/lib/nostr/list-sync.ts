/**
 * NIP-51 list sync — keeps the local mute (kind 10000) and block
 * (kind 30000, d=block) lists synchronized across devices.
 *
 * Merge policy is additive (union): entries found on relays are merged into
 * the local set, and local changes are republished as replaceable events.
 * Unknown non-`p` tags on the remote event (e.g. NIP-01 `e`/`t`/`word` mutes
 * from other clients) are preserved verbatim so BitOS never destroys data it
 * does not understand.
 *
 * Publishes are debounced: rapid mute/unmute churn collapses into one event.
 */
import { browser } from '$app/environment';
import { finalizeEvent } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/pure';
import { queryPrimaryFirst, publish } from './pool';
import { identity } from './identity.svelte';
import { hexToBytes } from './hex';
import { clientTag } from './client-tag';

const PUBLISH_DEBOUNCE_MS = 3_000;
const SYNCED_AT_KEY = 'bitos:moderation-synced-at';

export interface ListDefinition {
	/** NIP-51 kind: 10000 = mute list, 30000 = block list. */
	kind: number;
	/** `d` tag for parameterized-replaceable kinds (e.g. 'block'). */
	d?: string;
}

export const MUTE_LIST: ListDefinition = { kind: 10_000 };
export const BLOCK_LIST: ListDefinition = { kind: 30_000, d: 'block' };

/** Extract the `p`-tag pubkeys from a list event (lowercased, deduped). */
export function pubkeysFromListEvent(ev: Event): string[] {
	const seen = new Set<string>();
	for (const tag of ev.tags) {
		if (tag[0] === 'p' && tag[1]) {
			const pk = tag[1].toLowerCase();
			if (/^[0-9a-f]{64}$/.test(pk)) seen.add(pk);
		}
	}
	return [...seen];
}

/** Build the full tag set for a list event, preserving unknown tags. */
export function buildListTags(
	pTags: string[],
	/** Tags from the remote event that are not `p` / `d` / `client` (kept verbatim). */
	preserveTags: string[][] = [],
	definition: ListDefinition
): string[][] {
	const tags: string[][] = [];
	if (definition.d) tags.push(['d', definition.d]);
	for (const pk of pTags) tags.push(['p', pk]);
	for (const tag of preserveTags) {
		if (['p', 'd', 'client', 'alt', 'expiration'].includes(tag[0])) continue;
		tags.push(tag);
	}
	tags.push(...clientTag());
	return tags;
}

/** Fetch the freshest copy of a NIP-51 list for `me`. Returns null when absent. */
export async function fetchList(definition: ListDefinition, me: string): Promise<Event | null> {
	const filters = definition.d
		? [{ kinds: [definition.kind], authors: [me], '#d': [definition.d], limit: 1 }]
		: [{ kinds: [definition.kind], authors: [me], limit: 1 }];
	const events = await queryPrimaryFirst(filters);
	if (!events.length) return null;
	// Replaceable lists: newest created_at wins.
	return events.reduce((a, b) => (b.created_at > a.created_at ? b : a));
}

/** Publish the current list contents as a replaceable/parameterized event. */
export async function publishList(
	definition: ListDefinition,
	pTags: string[],
	preserveTags: string[][] = []
): Promise<void> {
	const id = identity.current;
	if (!id) throw new Error('No identity');
	const event = finalizeEvent(
		{
			kind: definition.kind,
			content: '',
			created_at: Math.floor(Date.now() / 1000),
			tags: buildListTags(pTags, preserveTags, definition)
		},
		hexToBytes(id.sk)
	);
	await publish(event);
}

/**
 * Sync one definition: fetch remote → merge into `apply` (store), then
 * schedule a republish if the union differs from the remote set (local-only
 * entries exist). Returns the merged pubkey list.
 */
export async function syncList(
	definition: ListDefinition,
	/** Current local pubkeys (source of truth for the union). */
	localPubkeys: string[],
	/** Merge callback — receives the union to store locally. */
	apply: (merged: string[]) => void
): Promise<string[]> {
	if (!browser) return localPubkeys;
	const me = identity.current?.pk?.toLowerCase();
	if (!me) return localPubkeys;

	const remote = await fetchList(definition, me).catch(() => null);
	const remotePubkeys = remote ? pubkeysFromListEvent(remote) : [];
	const union = [...new Set([...remotePubkeys, ...localPubkeys])];

	if (union.length !== localPubkeys.length) apply(union);

	// Local has entries relays have never seen → push the union up.
	if (union.length !== remotePubkeys.length) {
		await publishList(definition, union, remote?.tags ?? []).catch(() => undefined);
	}
	return union;
}

/**
 * Per-definition debounced publisher so bursts of mutes produce one event.
 *
 * Safety: the owning pubkey is captured when a publish is scheduled; if the
 * active identity changed by the time the debounce fires (fast account
 * switch), the publish is dropped instead of attributing one account's list
 * to another key.
 */
export function createDebouncedPublisher(
	definition: ListDefinition,
	getPubkeys: () => string[]
): { schedule: () => void; flush: () => Promise<void>; cancel: () => void } {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let inflight: Promise<void> | undefined;
	let ownerPk: string | null = null;

	const flush = async () => {
		if (inflight) return inflight;
		const currentPk = identity.current?.pk?.toLowerCase() ?? null;
		if (!currentPk || currentPk !== ownerPk) return; // account switched → drop
		const run = async () => {
			try {
				await publishList(definition, getPubkeys());
			} finally {
				inflight = undefined;
			}
		};
		inflight = run();
		return inflight;
	};

	return {
		schedule: () => {
			const id = identity.current;
			if (!id) return;
			ownerPk = id.pk.toLowerCase();
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				timer = undefined;
				void flush().catch(() => undefined);
			}, PUBLISH_DEBOUNCE_MS);
		},
		flush,
		cancel: () => {
			if (timer) clearTimeout(timer);
			timer = undefined;
		}
	};
}

/** Remember when moderation lists last synced (shown in settings). */
export function markSynced() {
	if (!browser) return;
	try {
		localStorage.setItem(SYNCED_AT_KEY, String(Date.now()));
	} catch {
		/* ignore */
	}
}

export function lastSyncedAt(): number | null {
	if (!browser) return null;
	try {
		const raw = localStorage.getItem(SYNCED_AT_KEY);
		return raw ? Number(raw) : null;
	} catch {
		return null;
	}
}
