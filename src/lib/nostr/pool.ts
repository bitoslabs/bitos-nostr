/**
 * Relay pool — a thin singleton over nostr-tools' SimplePool. The typed
 * `subscribeMany` accepts a single Filter, so when callers pass several OR'd
 * filters we open one subscription per filter and return a combined closer.
 * The pool is only meaningful in the browser; importing this module on the
 * server is safe (the singleton is lazily constructed).
 */
import { browser } from '$app/environment';
import { SimplePool } from 'nostr-tools/pool';
import type { Filter } from 'nostr-tools/filter';
import type { Event } from 'nostr-tools/pure';
import { relays } from './relays.svelte';

let pool: SimplePool | null = null;

function getPool(): SimplePool {
	if (!browser) throw new Error('Pool is only available in the browser');
	if (!pool) pool = new SimplePool();
	return pool;
}

export interface SubscriptionHandlers {
	onevent?: (ev: Event) => void;
	oneose?: () => void;
	onclose?: (reasons: { url: string; reason: string }[]) => void;
}

/** Subscribe to one or more filters across all *read* relays. */
export function subscribe(filters: Filter[], handlers: SubscriptionHandlers): () => void {
	if (!browser) return () => {};
	const urls = relays.urls;
	if (!urls.length || !filters.length) return () => {};
	const p = getPool();

	const closers: Array<() => void> = [];
	for (const filter of filters) {
		const sub = p.subscribeMany(urls, filter, {
			onevent: handlers.onevent,
			oneose: handlers.oneose,
			onclose: handlers.onclose
		});
		closers.push(() => {
			try {
				sub.close();
			} catch {
				/* ignore */
			}
		});
	}
	return () => closers.forEach((c) => c());
}

/** Fetch stored events once (REQ then auto-close after EOSE). */
export function queryOnce(filters: Filter[]): Promise<Event[]> {
	if (!browser) return Promise.resolve([]);
	const urls = relays.urls;
	if (!urls.length) return Promise.resolve([]);
	const p = getPool();
	// querySync takes a single filter; run one query per filter and flatten.
	return Promise.all(filters.map((f) => p.querySync(urls, f))).then((batches) => batches.flat());
}

/** Publish a signed event to all *write* relays. */
export async function publish(event: Event): Promise<string[]> {
	if (!browser) throw new Error('publish() is only available in the browser');
	const urls = relays.writeUrls;
	if (!urls.length) throw new Error('No write-enabled relays configured');
	// pool.publish() returns one Promise per relay (Promise<string>[]).
	return await Promise.all(getPool().publish(urls, event));
}

/** Open the WS to every relay so the pool pre-connects (warm-up). */
export function ensureConnected() {
	if (!browser) return;
	for (const url of relays.urls) {
		try {
			getPool().ensureRelay(url);
		} catch {
			/* connection issues surface as failed subscriptions */
		}
	}
}
