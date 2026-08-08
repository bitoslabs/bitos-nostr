import { browser } from '$app/environment';
import { SvelteSet } from 'svelte/reactivity';
import { identity } from '$lib/nostr/identity.svelte';

const STORAGE_KEY = 'bitos:muted-pubkeys';

function normalized(pubkey: string) {
	return pubkey.trim().toLowerCase();
}

class MutesStore {
	muted = $state<Set<string>>(new SvelteSet());

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
		return true;
	}

	unmute(pubkey: string) {
		const key = normalized(pubkey);
		if (!this.has(key)) return false;
		const next = new SvelteSet(this.muted);
		next.delete(key);
		this.muted = next;
		this.persist();
		return true;
	}
}

export const mutes = new MutesStore();
