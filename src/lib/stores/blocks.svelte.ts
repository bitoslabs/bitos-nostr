import { browser } from '$app/environment';
import { SvelteSet } from 'svelte/reactivity';
import { identity } from '$lib/nostr/identity.svelte';
import { syncList, createDebouncedPublisher, markSynced, BLOCK_LIST } from '$lib/nostr/list-sync';

export const STORAGE_KEY = 'bitos:blocked-pubkeys';

function normalized(pubkey: string) {
	return pubkey.trim().toLowerCase();
}

class BlocksStore {
	blocked = $state<Set<string>>(new SvelteSet());

	/** Debounced NIP-51 publisher — blocks go out as kind 30000 (d=block). */
	private publisher = createDebouncedPublisher(BLOCK_LIST, () => [...this.blocked]);

	load = () => {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			const parsed = raw ? (JSON.parse(raw) as string[]) : [];
			this.blocked = new SvelteSet(parsed.map(normalized).filter(Boolean));
		} catch {
			this.blocked = new SvelteSet();
		}
	};

	/**
	 * NIP-51 sync — merge the kind 30000 (d=block) list from relays into the
	 * local set (union) and republish when local-only entries exist.
	 */
	sync = async () => {
		if (!browser || !identity.current) return;
		try {
			await syncList(BLOCK_LIST, [...this.blocked], (merged) => {
				this.blocked = new SvelteSet(merged);
				this.persist();
			});
			markSynced();
		} catch {
			/* offline / relay failure — local list stays authoritative */
		}
	};

	private persist() {
		if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.blocked]));
	}

	has(pubkey: string) {
		return this.blocked.has(normalized(pubkey));
	}

	block(pubkey: string) {
		const key = normalized(pubkey);
		if (!key || key === identity.current?.pk) return false;
		const next = new SvelteSet(this.blocked);
		next.add(key);
		this.blocked = next;
		this.persist();
		this.publisher.schedule(); // NIP-51
		return true;
	}

	unblock(pubkey: string) {
		const key = normalized(pubkey);
		if (!this.has(key)) return false;
		const next = new SvelteSet(this.blocked);
		next.delete(key);
		this.blocked = next;
		this.persist();
		this.publisher.schedule(); // NIP-51
		return true;
	}

	/** Publish pending changes immediately (e.g. before logout). */
	flush = () => this.publisher.flush();

	/** Drop remote state (logout) — cancels any pending publish. */
	reset = () => {
		this.publisher.cancel();
		this.blocked = new SvelteSet();
	};
}

export const blocks = new BlocksStore();
