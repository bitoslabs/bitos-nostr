/**
 * NIP-51 list sync — keeps local lists synchronized across devices.
 * Currently powers the mute (kind 10000), block (kind 30000, d=block), and
 * followed-hashtag interest (kind 30015, d=interest) lists.
 *
 * Merge policy is additive (union): entries found on relays are merged into
 * the local set, and local changes are republished as replaceable events.
 * Unknown tags the store does not own (e.g. NIP-01 `e`/`word` mutes, or `p`
 * tags inside a hashtag interest set) are preserved verbatim so BitOS never
 * destroys data it does not understand.
 *
 * Publishes are debounced: rapid changes collapse into one event.
 */
import { browser } from '$app/environment';
import { activeSigner } from '$lib/auth/signer';
import type { Event } from 'nostr-tools/pure';
import { queryPrimaryFirst, publish } from './pool';
import { identity } from './identity.svelte';
import { clientTag } from './client-tag';
import { NOSTR_KINDS } from './types';

const PUBLISH_DEBOUNCE_MS = 3_000;
const SYNCED_AT_KEY = 'bitos:moderation-synced-at';
const PUBKEY_PATTERN = /^[0-9a-f]{64}$/;
/** NIP-01 hashtag charset (see $lib/utils/note-content hashtagPattern). */
const HASHTAG_PATTERN = /^[\p{L}\p{N}_-]{2,60}$/u;

export interface ListDefinition {
	/** NIP-51 kind: 10000 = mute list, 30000 = block list, 30015 = interest set. */
	kind: number;
	/** `d` tag for parameterized-replaceable kinds (e.g. 'block', 'interest'). */
	d?: string;
	/** Which tag carries the entries: 'p' pubkeys (default) or 't' hashtags. */
	tagType?: 'p' | 't';
}

export const MUTE_LIST: ListDefinition = { kind: 10_000 };
export const BLOCK_LIST: ListDefinition = { kind: 30_000, d: 'block' };
/** NIP-51 interest set — hashtags the user follows (kind 30015, d=interest). */
export const INTEREST_SET_LIST: ListDefinition = {
	kind: NOSTR_KINDS.INTEREST_SET,
	d: 'interest',
	tagType: 't'
};

/** Extract + normalize the entry values from a list event (deduped). */
export function valuesFromListEvent(ev: Event, tagType: ListDefinition['tagType'] = 'p'): string[] {
	const seen = new Set<string>();
	for (const tag of ev.tags) {
		if (tag[0] !== (tagType ?? 'p') || !tag[1]) continue;
		const value =
			tagType === 't' ? tag[1].trim().replace(/^#/, '').toLowerCase() : tag[1].toLowerCase();
		const valid = tagType === 't' ? HASHTAG_PATTERN.test(value) : PUBKEY_PATTERN.test(value);
		if (valid) seen.add(value);
	}
	return [...seen];
}

/** Extract the `p`-tag pubkeys from a list event (lowercased, deduped). */
export function pubkeysFromListEvent(ev: Event): string[] {
	return valuesFromListEvent(ev, 'p');
}

/** Build the full tag set for a list event, preserving unknown tags. */
export function buildListTags(
	values: string[],
	/** Tags from the remote event that this store does not own (kept verbatim). */
	preserveTags: string[][] = [],
	definition: ListDefinition
): string[][] {
	const entryTag = definition.tagType ?? 'p';
	const tags: string[][] = [];
	if (definition.d) tags.push(['d', definition.d]);
	for (const value of values) tags.push([entryTag, value]);
	for (const tag of preserveTags) {
		// Own-entry tags are regenerated from the store; `t` mutes on a `p` list
		// (NIP-01) and other unknown tags are preserved verbatim.
		if ([entryTag, 'd', 'client', 'alt', 'expiration'].includes(tag[0])) continue;
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
	values: string[],
	preserveTags: string[][] = []
): Promise<void> {
	const signer = activeSigner();
	if (!(await signer.isAvailable())) throw new Error('No identity');
	const event = await signer.sign({
		kind: definition.kind,
		content: '',
		created_at: Math.floor(Date.now() / 1000),
		tags: buildListTags(values, preserveTags, definition)
	});
	await publish(event);
}

/**
 * Sync one definition: fetch remote → merge into `apply` (store), then
 * schedule a republish if the union differs from the remote set (local-only
 * entries exist). Returns the merged entry list.
 */
export async function syncList(
	definition: ListDefinition,
	/** Current local entries (source of truth for the union). */
	localValues: string[],
	/** Merge callback — receives the union to store locally. */
	apply: (merged: string[]) => void
): Promise<string[]> {
	if (!browser) return localValues;
	const me = identity.current?.pk?.toLowerCase();
	if (!me) return localValues;

	const remote = await fetchList(definition, me).catch(() => null);
	const remoteValues = remote ? valuesFromListEvent(remote, definition.tagType) : [];
	const union = [...new Set([...remoteValues, ...localValues])];

	if (union.length !== localValues.length) apply(union);

	// Local has entries relays have never seen → push the union up.
	if (union.length !== remoteValues.length) {
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
	getValues: () => string[]
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
				await publishList(definition, getValues());
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
