/**
 * Relay list store — seeded with the same default relays as BitOS Notes
 * (bitdigo/notes/web). Each record carries read/write flags + health status.
 */
import { browser } from '$app/environment';
import type { RelayRecord, RecommendedRelay } from './types';

export const STORAGE_KEY = 'bitos:relays';

/** Bump when DEFAULTS change so the new relays are seeded once for existing users. */
const SCHEMA_VERSION = 4;

const DEFAULTS: RelayRecord[] = [
	{ url: 'wss://relay.damus.io', read: true, write: true, primary: true, writePrimary: true, status: 'unknown', latency: null },
	{ url: 'wss://nos.lol', read: true, write: true, primary: false, writePrimary: false, status: 'unknown', latency: null },
	{ url: 'wss://relay.nostr.band', read: true, write: false, primary: false, writePrimary: false, status: 'unknown', latency: null },
	{ url: 'wss://nostr-pub.wellorder.net', read: true, write: true, primary: false, writePrimary: false, status: 'unknown', latency: null },
	{ url: 'wss://relay.0xchat.com', read: true, write: true, primary: false, writePrimary: false, status: 'unknown', latency: null }
];

/**
 * Curated, community-popular relays surfaced in Settings → Recommended.
 * Metadata here is static (NIP-11 fetches are CORS-blocked for most relays);
 * reachability is checked live via `ping()` (WebSocket handshake).
 */
export const RECOMMENDED: RecommendedRelay[] = [
	{ url: 'wss://relay.damus.io', name: 'Damus', description: 'Official Damus relay' },
	{ url: 'wss://nos.lol', name: 'nos.lol', description: 'Open relay run by nos.social' },
	{ url: 'wss://relay.nostr.band', name: 'Nostr Band', description: 'Global feed indexer' },
	{ url: 'wss://nostr-pub.wellorder.net', name: 'Wellorder', description: 'Stable public relay' },
	{ url: 'wss://relay.0xchat.com', name: '0xChat', description: '0xChat secure messaging relay' },
	{ url: 'wss://relay.primal.net', name: 'Primal', description: 'Fast cache relay by Primal' },
	{ url: 'wss://relay.snort.social', name: 'Snort', description: 'Snort.social public relay' },
	{ url: 'wss://offchain.pub', name: 'Offchain', description: 'Community public relay' },
	{ url: 'wss://relay.current.fyi', name: 'Current', description: 'Current.fyi relay' },
	{ url: 'wss://nostr.mom', name: 'nostr.mom', description: 'Open community relay' }
];

const URL_RE = /^wss?:\/\/[^\s/]+(:\d+)?(\/[^\s]*)?$/i;

class RelayStore {
	list = $state<RelayRecord[]>([...DEFAULTS]);

	private normalizeRecord(record: RelayRecord): RelayRecord {
		return {
			...record,
			primary: !!record.primary,
			writePrimary: !!record.writePrimary
		};
	}

	private ensureReadPrimary(list: RelayRecord[]): RelayRecord[] {
		const normalized = list.map((record) => this.normalizeRecord(record));
		const chosenPrimaryUrl =
			normalized.find((record) => record.read && record.primary)?.url ??
			normalized.find((record) => record.read)?.url;
		return normalized.map((record) => ({
			...record,
			primary: !!(record.read && chosenPrimaryUrl && record.url === chosenPrimaryUrl)
		}));
	}

	private ensureWritePrimary(list: RelayRecord[]): RelayRecord[] {
		const normalized = list.map((record) => this.normalizeRecord(record));
		const chosenPrimaryUrl =
			normalized.find((record) => record.write && record.writePrimary)?.url ??
			normalized.find((record) => record.write)?.url;
		return normalized.map((record) => ({
			...record,
			writePrimary: !!(record.write && chosenPrimaryUrl && record.url === chosenPrimaryUrl)
		}));
	}

	private normalizePrimaries(list: RelayRecord[]): RelayRecord[] {
		return this.ensureWritePrimary(this.ensureReadPrimary(list));
	}

	load = () => {
		if (!browser) return;
		let storedList: RelayRecord[] | null = null;
		let storedVersion = 0;
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) {
				const parsed = JSON.parse(raw);
				// Backward compat: the original format was a bare array.
				if (Array.isArray(parsed)) {
					storedList = parsed;
				} else if (parsed && Array.isArray(parsed.list)) {
					storedList = parsed.list;
					storedVersion = parsed.version ?? 0;
				}
			}
		} catch {
			/* ignore corrupt storage */
		}

		if (storedList && storedList.length) {
			let list = storedList;
			if (storedVersion < SCHEMA_VERSION) {
				// One-time seed: append any new DEFAULT relays the user doesn't have yet.
				const have = new Set(list.map((r) => r.url));
				list = [...list, ...DEFAULTS.filter((d) => !have.has(d.url))];
			}
			this.list = this.normalizePrimaries(list);
			this.persist();
		} else {
			this.list = this.normalizePrimaries([...DEFAULTS]);
			this.persist();
		}
	};

	private persist = () => {
		if (browser)
			localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify({ version: SCHEMA_VERSION, list: this.list })
			);
	};

	urls = $derived(this.list.filter((r) => r.read).map((r) => r.url));
	primaryUrls = $derived(this.list.filter((r) => r.read && r.primary).map((r) => r.url));
	secondaryUrls = $derived(this.list.filter((r) => r.read && !r.primary).map((r) => r.url));
	orderedReadUrls = $derived([
		...this.list.filter((r) => r.read && r.primary).map((r) => r.url),
		...this.list.filter((r) => r.read && !r.primary).map((r) => r.url)
	]);
	writeUrls = $derived(this.list.filter((r) => r.write).map((r) => r.url));
	primaryWriteUrls = $derived(this.list.filter((r) => r.write && r.writePrimary).map((r) => r.url));
	secondaryWriteUrls = $derived(this.list.filter((r) => r.write && !r.writePrimary).map((r) => r.url));
	orderedWriteUrls = $derived([
		...this.list.filter((r) => r.write && r.writePrimary).map((r) => r.url),
		...this.list.filter((r) => r.write && !r.writePrimary).map((r) => r.url)
	]);

	validate(url: string): string | null {
		if (!URL_RE.test(url.trim())) return 'Must be a ws:// or wss:// URL';
		const normalized = this.normalize(url);
		if (this.list.some((r) => r.url === normalized)) return 'Relay already added';
		return null;
	}

	private normalize(url: string): string {
		return url.trim().replace(/\/+$/, '');
	}

	add(url: string): { ok: boolean; error?: string } {
		const err = this.validate(url);
		if (err) return { ok: false, error: err };
		this.list = [
			...this.list,
			{
				url: this.normalize(url),
				read: true,
				write: true,
				primary: !this.list.some((record) => record.read && record.primary),
				writePrimary: !this.list.some((record) => record.write && record.writePrimary),
				status: 'unknown',
				latency: null
			}
		];
		this.list = this.normalizePrimaries(this.list);
		this.persist();
		return { ok: true };
	}

	remove(url: string) {
		this.list = this.normalizePrimaries(this.list.filter((r) => r.url !== url));
		this.persist();
	}

	toggle(url: string, flag: 'read' | 'write') {
		this.list = this.normalizePrimaries(
			this.list.map((r) => {
				if (r.url !== url) return r;
				const next = { ...r, [flag]: !r[flag] };
				if (flag === 'read' && !next.read) next.primary = false;
				if (flag === 'write' && !next.write) next.writePrimary = false;
				return next;
			})
		);
		this.persist();
	}

	setPrimary(url: string) {
		this.list = this.normalizePrimaries(
			this.list.map((record) =>
				record.url === url ? { ...record, read: true, primary: true } : { ...record, primary: false }
			)
		);
		this.persist();
	}

	setWritePrimary(url: string) {
		this.list = this.normalizePrimaries(
			this.list.map((record) =>
				record.url === url
					? { ...record, write: true, writePrimary: true }
					: { ...record, writePrimary: false }
			)
		);
		this.persist();
	}

	setStatus(url: string, status: RelayRecord['status'], latency: number | null = null) {
		this.list = this.list.map((r) =>
			r.url === url
				? { ...r, status, latency: latency ?? r.latency, checkedAt: Math.floor(Date.now() / 1000) }
				: r
		);
		this.persist();
	}

	/**
	 * Query a relay's reachability by opening a WebSocket and measuring the
	 * time until the handshake opens. Does NOT mutate `list` — callers decide
	 * whether to persist the result (e.g. `setStatus`). Safe for the
	 * Recommended panel where we check relays that aren't configured yet.
	 */
	async ping(
		url: string,
		timeoutMs = 6000
	): Promise<{ status: 'ok' | 'fail'; latency: number | null }> {
		if (!browser || typeof WebSocket === 'undefined') {
			return { status: 'fail', latency: null };
		}
		const started = performance.now();
		try {
			const latency = await new Promise<number>((resolve, reject) => {
				const ws = new WebSocket(url);
				const t = window.setTimeout(() => {
					ws.close();
					reject(new Error('timeout'));
				}, timeoutMs);
				ws.onopen = () => {
					window.clearTimeout(t);
					ws.close();
					resolve(Math.round(performance.now() - started));
				};
				ws.onerror = () => {
					window.clearTimeout(t);
					reject(new Error('error'));
				};
			});
			return { status: 'ok', latency };
		} catch {
			return { status: 'fail', latency: null };
		}
	}
}

export const relays = new RelayStore();
