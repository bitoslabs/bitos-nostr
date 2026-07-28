/**
 * Contact list store — owns the active user's NIP-02 follow list (kind 3).
 * It loads the latest contact list, keeps a local set for UI checks, and
 * publishes follow/unfollow updates back to relays.
 */
import { browser } from '$app/environment';
import { finalizeEvent } from 'nostr-tools/pure';
import { identity } from './identity.svelte';
import { hexToBytes } from './hex';
import { publish, queryOnce, subscribe } from './pool';
import { NOSTR_KINDS } from './types';

class ContactsStore {
	following = $state<string[]>([]);
	loading = $state(false);
	private latestCreatedAt = 0;
	private unsub: (() => void) | null = null;

	followingSet = $derived(new Set(this.following));

	start = () => {
		if (!browser) return;
		const me = identity.current?.pk;
		if (!me) return;
		this.stop();
		this.loading = true;
		void this.load(me);
		this.unsub = subscribe([{ kinds: [NOSTR_KINDS.CONTACT_LIST], authors: [me], limit: 1 }], {
			onevent: (ev) => this.ingest(ev)
		});
	};

	stop = () => {
		if (this.unsub) {
			this.unsub();
			this.unsub = null;
		}
	};

	isFollowing(pubkey: string) {
		return this.followingSet.has(pubkey);
	}

	async follow(pubkey: string) {
		const me = identity.current;
		if (!me) throw new Error('No identity');
		if (pubkey === me.pk) throw new Error("You can't follow yourself");
		if (this.isFollowing(pubkey)) return;
		await this.publishList([pubkey, ...this.following]);
	}

	async unfollow(pubkey: string) {
		const me = identity.current;
		if (!me) throw new Error('No identity');
		if (pubkey === me.pk) throw new Error("You can't unfollow yourself");
		if (!this.isFollowing(pubkey)) return;
		await this.publishList(this.following.filter((item) => item !== pubkey));
	}

	private async load(me: string) {
		try {
			const [event] = (
				await queryOnce([{ kinds: [NOSTR_KINDS.CONTACT_LIST], authors: [me], limit: 1 }])
			).sort((a, b) => b.created_at - a.created_at);
			if (event) this.ingest(event);
		} finally {
			this.loading = false;
		}
	}

	private ingest(ev: { created_at: number; tags: string[][] }) {
		if (ev.created_at < this.latestCreatedAt) return;
		this.latestCreatedAt = ev.created_at;
		this.following = ev.tags
			.filter((tag) => tag[0] === 'p' && /^[0-9a-fA-F]{64}$/.test(tag[1] ?? ''))
			.map((tag) => tag[1].toLowerCase())
			.filter((pubkey, index, all) => all.indexOf(pubkey) === index);
	}

	private async publishList(pubkeys: string[]) {
		const me = identity.current;
		if (!browser || !me) return;
		const clean = pubkeys
			.filter((pubkey) => pubkey !== me.pk && /^[0-9a-fA-F]{64}$/.test(pubkey))
			.map((pubkey) => pubkey.toLowerCase())
			.filter((pubkey, index, all) => all.indexOf(pubkey) === index);
		const event = finalizeEvent(
			{
				kind: NOSTR_KINDS.CONTACT_LIST,
				content: '',
				created_at: Math.floor(Date.now() / 1000),
				tags: clean.map((pubkey) => ['p', pubkey])
			},
			hexToBytes(me.sk)
		);
		await publish(event);
		this.ingest(event);
	}
}

export const contacts = new ContactsStore();
