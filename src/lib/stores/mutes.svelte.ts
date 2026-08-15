import { browser } from '$app/environment';
import { SvelteSet } from 'svelte/reactivity';
import { identity } from '$lib/nostr/identity.svelte';
import { syncList, createDebouncedPublisher, markSynced, MUTE_LIST } from '$lib/nostr/list-sync';

const STORAGE_KEY = 'bitos:muted-pubkeys';

function normalized(pubkey: string) {
	return pubkey.trim().toLowerCase();
}

class MutesStore {
	muted = $state<Set<string>>(new SvelteSet());

	/** Debounced NIP-51 publisher — bursts of mutes collapse into one event. */
	private publisher = createDebouncedPublisher(MUTE_LIST, () => [...this.muted]);

	load = () => {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			const parsed = raw ? (JSON.parse(raw) as string[]) : [];
			this.muted = new SvelteSet(parsed.map(normalized).filter(Boolean));
		} catch {
			this.muted = new SvelteSet();
		}
	};

	/**
	 * NIP-51 sync — merge the kind 10000 mute list from relays into the local
	 * set (union) and republish when local-only entries exist. Called on login.
	 */
	sync = async () => {
		if (!browser || !identity.current) return;
		try {
			await syncList(MUTE_LIST, [...this.muted], (merged) => {
				this.muted = new SvelteSet(merged);
				this.persist();
			});
			markSynced();
		} catch {
			/* offline / relay failure — local list stays authoritative */
		}
	};

	private persist() {
		if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.muted]));
	}

	has(pubkey: string) {
		return this.muted.has(normalized(pubkey));
	}

	mute(pubkey: string) {
		const key = normalized(pubkey);
		if (!key || key === identity.current?.pk || this.has(key)) return false;
		const next = new SvelteSet(this.muted);
		next.add(key);
		this.muted = next;
		this.persist();
		this.publisher.schedule(); // NIP-51
		return true;
	}

	unmute(pubkey: string) {
		const key = normalized(pubkey);
		if (!this.has(key)) return false;
		const next = new SvelteSet(this.muted);
		next.delete(key);
		this.muted = next;
		this.persist();
		this.publisher.schedule(); // NIP-51
		return true;
	}

	/** Publish pending changes immediately (e.g. before logout). */
	flush = () => this.publisher.flush();

	/** Drop remote state (logout) — cancels any pending publish. */
	reset = () => {
		this.publisher.cancel();
		this.muted = new SvelteSet();
	};
}

export const mutes = new MutesStore();
