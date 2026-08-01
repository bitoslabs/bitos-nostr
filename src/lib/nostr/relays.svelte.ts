/**
 * Relay list store — seeded with the same default relays as BitOS Notes
 * (bitdigo/notes/web). Each record carries read/write flags + health status.
 */
import { browser } from '$app/environment';
import type { RelayRecord } from './types';

export const STORAGE_KEY = 'bitos:relays';

const DEFAULTS: RelayRecord[] = [
	{ url: 'wss://relay.damus.io', read: true, write: true, status: 'unknown', latency: null },
	{ url: 'wss://nos.lol', read: true, write: true, status: 'unknown', latency: null },
	{ url: 'wss://relay.nostr.band', read: true, write: false, status: 'unknown', latency: null }
];

const URL_RE = /^wss?:\/\/[^\s/]+(:\d+)?(\/[^\s]*)?$/i;

class RelayStore {
	list = $state<RelayRecord[]>([...DEFAULTS]);

	load = () => {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) {
				const parsed = JSON.parse(raw) as RelayRecord[];
				if (Array.isArray(parsed) && parsed.length) this.list = parsed;
			}
		} catch {
			/* ignore */
		}
	};

	private persist = () => {
		if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(this.list));
	};

	urls = $derived(this.list.filter((r) => r.read).map((r) => r.url));
	writeUrls = $derived(this.list.filter((r) => r.write).map((r) => r.url));

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
			{ url: this.normalize(url), read: true, write: true, status: 'unknown', latency: null }
		];
		this.persist();
		return { ok: true };
	}

	remove(url: string) {
		this.list = this.list.filter((r) => r.url !== url);
		this.persist();
	}

	toggle(url: string, flag: 'read' | 'write') {
		this.list = this.list.map((r) => (r.url === url ? { ...r, [flag]: !r[flag] } : r));
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
}

export const relays = new RelayStore();
