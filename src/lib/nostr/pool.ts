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
const RELAY_KIND_SUPPORT_CACHE_KEY = 'bitos:relay-kind-support:v1';

type RelayKindSupportCache = Record<
	string,
	{
		unsupportedKinds?: Record<string, { reason: string; at: number }>;
	}
>;

function getPool(): SimplePool {
	if (!browser) throw new Error('Pool is only available in the browser');
	if (!pool) pool = new SimplePool();
	return pool;
}

function loadRelayKindSupportCache(): RelayKindSupportCache {
	if (!browser) return {};
	try {
		const raw = localStorage.getItem(RELAY_KIND_SUPPORT_CACHE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw) as RelayKindSupportCache;
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

function saveRelayKindSupportCache(cache: RelayKindSupportCache) {
	if (!browser) return;
	localStorage.setItem(RELAY_KIND_SUPPORT_CACHE_KEY, JSON.stringify(cache));
}

function relayRejectsKind(reason: string, kind: number): boolean {
	const text = reason.toLowerCase();
	const mentionsUnsupported = /(unsupported|not supported|does not support|unsupported kind)/i.test(text);
	const mentionsKindPolicy =
		/(kind|event type|event kind)/i.test(text) &&
		/(blocked|rejected|invalid|denied|forbidden|policy|not allowed|disabled)/i.test(text);
	const mentionsSpecificKind = text.includes(`${kind}`);
	return mentionsUnsupported || (mentionsKindPolicy && mentionsSpecificKind);
}

function isRelayKindUnsupported(url: string, kind: number): boolean {
	const cache = loadRelayKindSupportCache();
	return !!cache[url]?.unsupportedKinds?.[`${kind}`];
}

function markRelayKindUnsupported(url: string, kind: number, reason: string) {
	const cache = loadRelayKindSupportCache();
	cache[url] = cache[url] ?? {};
	cache[url].unsupportedKinds = cache[url].unsupportedKinds ?? {};
	cache[url].unsupportedKinds![`${kind}`] = { reason, at: Math.floor(Date.now() / 1000) };
	saveRelayKindSupportCache(cache);
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

	const candidateUrls = urls.filter((url) => !isRelayKindUnsupported(url, event.kind));
	if (!candidateUrls.length) {
		throw new Error(`All write relays previously rejected kind ${event.kind}; skipping publish`);
	}

	const results = await Promise.allSettled(getPool().publish(candidateUrls, event));
	const accepted: string[] = [];
	const failures: string[] = [];

	for (const [index, result] of results.entries()) {
		const url = candidateUrls[index];
		if (result.status === 'fulfilled') {
			accepted.push(result.value);
			continue;
		}

		const reason =
			result.reason instanceof Error
				? result.reason.message
				: typeof result.reason === 'string'
					? result.reason
					: JSON.stringify(result.reason);
		failures.push(`${url}: ${reason}`);
		if (relayRejectsKind(reason, event.kind)) {
			markRelayKindUnsupported(url, event.kind, reason);
		}
	}

	if (!accepted.length) {
		throw new Error(
			`Failed to publish kind ${event.kind} to write relays: ${failures.join(' | ')}`
		);
	}

	return accepted;
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
