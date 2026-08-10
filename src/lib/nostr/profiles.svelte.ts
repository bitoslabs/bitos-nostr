/**
 * Profile cache — fetches and stores NIP-01 kind-0 metadata per pubkey so the
 * feed/chat can render display names + avatars. Profiles are cached in a
 * runes-backed map; the newest metadata per pubkey wins.
 */
import { browser } from '$app/environment';
import { queryPrimaryFirst } from './pool';
import type { Profile } from './types';

const STORAGE_KEY = 'bitos:profiles-cache';
const STALE_MS = 12 * 60 * 60 * 1000;

type CachedProfileRecord = {
	profile: Profile;
	latestAt: number;
	fetchedAt: number;
};

type EnsureOptions = {
	force?: boolean;
};

class ProfileStore {
	byPubkey = $state<Record<string, Profile>>({});
	/** newest created_at seen per pubkey, to keep the freshest metadata. */
	private latestAt = new Map<string, number>();
	private fetchedAt = new Map<string, number>();
	private inflight = new Set<string>();
	private loaded = false;

	load() {
		if (!browser || this.loaded) return;
		this.loaded = true;
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw) as Record<string, CachedProfileRecord>;
			const next: Record<string, Profile> = {};
			for (const [pubkey, record] of Object.entries(parsed)) {
				if (!pubkey || !record?.profile) continue;
				next[pubkey] = record.profile;
				this.latestAt.set(pubkey, record.latestAt ?? -1);
				this.fetchedAt.set(pubkey, record.fetchedAt ?? 0);
			}
			this.byPubkey = next;
		} catch {
			/* ignore malformed cache */
		}
	}

	private persist() {
		if (!browser) return;
		const payload: Record<string, CachedProfileRecord> = {};
		for (const [pubkey, profile] of Object.entries(this.byPubkey)) {
			payload[pubkey] = {
				profile,
				latestAt: this.latestAt.get(pubkey) ?? -1,
				fetchedAt: this.fetchedAt.get(pubkey) ?? 0
			};
		}
		localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
	}

	get(pubkey: string): Profile | undefined {
		this.load();
		return this.byPubkey[pubkey];
	}

	/** A display name for a pubkey, falling back to '' (caller shows npub). */
	displayName(pubkey: string): string {
		this.load();
		const p = this.byPubkey[pubkey];
		return p?.display_name || p?.name || '';
	}

	private isFresh(pubkey: string) {
		const fetchedAt = this.fetchedAt.get(pubkey) ?? 0;
		return fetchedAt > 0 && Date.now() - fetchedAt < STALE_MS;
	}

	private applyProfileEvents(
		events: Array<{ pubkey: string; created_at: number; content: string }>
	) {
		for (const ev of events) {
			try {
				const data = JSON.parse(ev.content) as Partial<Profile>;
				const seen = this.latestAt.get(ev.pubkey) ?? -1;
				if (ev.created_at > seen) {
					this.latestAt.set(ev.pubkey, ev.created_at);
					this.byPubkey = { ...this.byPubkey, [ev.pubkey]: { pubkey: ev.pubkey, ...data } };
				}
				this.fetchedAt.set(ev.pubkey, Date.now());
			} catch {
				/* ignore malformed metadata */
			}
		}
	}

	/** Schedule a fetch for any pubkeys we don't have yet (deduped). */
	ensure(pubkeys: string[], options: EnsureOptions = {}): Promise<void> {
		if (!browser) return Promise.resolve();
		this.load();
		const targets = pubkeys.filter((pk) => {
			if (!pk || this.inflight.has(pk)) return false;
			return options.force || !this.byPubkey[pk] || !this.isFresh(pk);
		});
		if (!targets.length) return Promise.resolve();
		targets.forEach((pk) => this.inflight.add(pk));
		return queryPrimaryFirst(
			targets.map((pubkey) => ({ kinds: [0], authors: [pubkey], limit: 1 })),
			{
				onSecondary: (events) => {
					this.applyProfileEvents(events);
					this.persist();
				}
			}
		)
			.then((events) => {
				this.applyProfileEvents(events);
			})
			.finally(() => {
				targets.forEach((pk) => {
					this.inflight.delete(pk);
					if (!this.fetchedAt.has(pk)) this.fetchedAt.set(pk, Date.now());
				});
				this.persist();
			});
	}

	refresh(pubkeys: string[]): Promise<void> {
		return this.ensure(pubkeys, { force: true });
	}
}

export const profiles = new ProfileStore();
