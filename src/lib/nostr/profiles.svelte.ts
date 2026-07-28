/**
 * Profile cache — fetches and stores NIP-01 kind-0 metadata per pubkey so the
 * feed/chat can render display names + avatars. Profiles are cached in a
 * runes-backed map; the newest metadata per pubkey wins.
 */
import { browser } from '$app/environment';
import { queryOnce } from './pool';
import type { Profile } from './types';

class ProfileStore {
	byPubkey = $state<Record<string, Profile>>({});
	/** newest created_at seen per pubkey, to keep the freshest metadata. */
	private latestAt = new Map<string, number>();
	private inflight = new Set<string>();
	private fetched = new Set<string>();

	get(pubkey: string): Profile | undefined {
		return this.byPubkey[pubkey];
	}

	/** A display name for a pubkey, falling back to '' (caller shows npub). */
	displayName(pubkey: string): string {
		const p = this.byPubkey[pubkey];
		return p?.display_name || p?.name || '';
	}

	/** Schedule a fetch for any pubkeys we don't have yet (deduped). */
	ensure(pubkeys: string[]) {
		if (!browser) return;
		const missing = pubkeys.filter((pk) => pk && !this.fetched.has(pk) && !this.inflight.has(pk));
		if (!missing.length) return;
		missing.forEach((pk) => this.inflight.add(pk));
		queryOnce([{ kinds: [0], authors: missing }])
			.then((events) => {
				for (const ev of events) {
					try {
						const data = JSON.parse(ev.content) as Partial<Profile>;
						const seen = this.latestAt.get(ev.pubkey) ?? -1;
						if (ev.created_at > seen) {
							this.latestAt.set(ev.pubkey, ev.created_at);
							this.byPubkey = { ...this.byPubkey, [ev.pubkey]: { pubkey: ev.pubkey, ...data } };
						}
					} catch {
						/* ignore malformed metadata */
					}
				}
			})
			.finally(() => {
				missing.forEach((pk) => {
					this.inflight.delete(pk);
					this.fetched.add(pk);
				});
			});
	}
}

export const profiles = new ProfileStore();
