import { browser } from '$app/environment';
import { SvelteSet } from 'svelte/reactivity';
import { identity } from '$lib/nostr/identity.svelte';

export const STORAGE_KEY = 'bitos:blocked-pubkeys';

function normalized(pubkey: string) {
	return pubkey.trim().toLowerCase();
}

class BlocksStore {
	blocked = $state<Set<string>>(new SvelteSet());

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

	private persist() {
		if (!browser) return;
		localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.blocked]));
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
		return true;
	}

	unblock(pubkey: string) {
		const key = normalized(pubkey);
		if (!this.blocked.has(key)) return false;
		const next = new SvelteSet(this.blocked);
		next.delete(key);
		this.blocked = next;
		this.persist();
		return true;
	}
}

export const blocks = new BlocksStore();
