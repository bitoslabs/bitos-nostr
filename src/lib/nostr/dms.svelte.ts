/**
 * Direct messages (NIP-04). Subscribes to encrypted kind-4 events to and from
 * the active pubkey, decrypts them with nostr-tools/nip04, and groups them into
 * conversations. New outbound messages are encrypted + published.
 *
 * NIP-04 uses a shared secret derived via ECDH + an IV in the `content` field
 * formatted as "<ciphertext>?iv=<iv>". This is the most widely-supported DM
 * scheme; NIP-44/NIP-17 can be layered on later behind the same API.
 */
import { browser } from '$app/environment';
import { finalizeEvent } from 'nostr-tools/pure';
import { nip04 } from 'nostr-tools';
import { subscribe, publish } from './pool';
import { identity } from './identity.svelte';
import { profiles } from './profiles.svelte';
import { hexToBytes } from './hex';
import { NOSTR_KINDS, type Conversation, type DirectMessage } from './types';

class DMStore {
	conversations = $state<Conversation[]>([]);
	loading = $state(false);
	connected = $state(false);
	private unsub: (() => void) | null = null;

	/** Total unread messages across all conversations (for the nav badge). */
	get unreadCount(): number {
		return this.conversations.reduce((sum, c) => sum + (c.unread || 0), 0);
	}

	/** Conversation for a given peer (creates an empty placeholder if absent). */
	forPeer = (peer: string): Conversation => {
		const existing = this.conversations.find((c) => c.peer === peer);
		if (existing) return existing;
		const created: Conversation = { peer, unread: 0, messages: [] };
		this.conversations = [created, ...this.conversations];
		return created;
	};

	start = () => {
		if (!browser) return;
		const me = identity.current?.pk;
		if (!me) return;
		this.stop();
		this.loading = true;
		this.connected = false;
		// NIP-04: recipient in `p` tag. Fetch messages I authored OR addressed to me.
		this.unsub = subscribe(
			[
				{ kinds: [NOSTR_KINDS.DIRECT_MESSAGE], authors: [me] },
				{ kinds: [NOSTR_KINDS.DIRECT_MESSAGE], '#p': [me] }
			],
			{
				oneose: () => {
					this.loading = false;
					this.connected = true;
				},
				onevent: (ev) => this.ingest(ev)
			}
		);
	};

	stop = () => {
		if (this.unsub) {
			this.unsub();
			this.unsub = null;
		}
	};

	private async ingest(ev: {
		id: string;
		pubkey: string;
		content: string;
		created_at: number;
		tags: string[][];
	}) {
		const me = identity.current;
		if (!me) return;
		const mine = ev.pubkey === me.pk;
		// Counterparty: if I'm the author, the recipient is in a p-tag; else sender.
		const peer = mine ? (ev.tags.find((t) => t[0] === 'p')?.[1] ?? '') : ev.pubkey;
		if (!peer) return;
		let plaintext: string;
		try {
			// nip04.decrypt needs hex keys
			plaintext = await nip04.decrypt(me.sk, peer, ev.content);
		} catch {
			plaintext = '🔒 Unable to decrypt (different key?)';
		}
		const msg: DirectMessage = {
			id: ev.id,
			pubkey: ev.pubkey,
			peer,
			content: plaintext,
			createdAt: ev.created_at,
			mine
		};
		this.attach(msg);
		profiles.ensure([peer]);
	}

	private attach(msg: DirectMessage) {
		const next = this.conversations.map((c) => ({ ...c, messages: [...c.messages] }));
		let conv = next.find((c) => c.peer === msg.peer);
		if (!conv) {
			conv = { peer: msg.peer, unread: 0, messages: [] };
			next.push(conv);
		}
		if (conv.messages.some((m) => m.id === msg.id)) return; // dedupe
		conv.messages.push(msg);
		conv.messages.sort((a, b) => a.createdAt - b.createdAt);
		conv.lastMessage = conv.messages[conv.messages.length - 1];
		// Incoming (not mine) messages count as unread until the thread is opened.
		if (!msg.mine) conv.unread = (conv.unread || 0) + 1;
		next.sort((a, b) => (b.lastMessage?.createdAt ?? 0) - (a.lastMessage?.createdAt ?? 0));
		this.conversations = next;
	}

	/** Mark all messages in a conversation as read. */
	markRead(peer: string) {
		this.conversations = this.conversations.map((c) => (c.peer === peer ? { ...c, unread: 0 } : c));
	}

	/** Encrypt + publish a DM to `peer`. */
	async send(peer: string, text: string): Promise<void> {
		if (!browser) return;
		const me = identity.current;
		if (!me) throw new Error('No identity');
		const body = text.trim();
		if (!body) return;
		const ciphertext = await nip04.encrypt(me.sk, peer, body);
		const event = finalizeEvent(
			{
				kind: NOSTR_KINDS.DIRECT_MESSAGE,
				content: ciphertext,
				created_at: Math.floor(Date.now() / 1000),
				tags: [
					['p', peer],
					// NIP-04 hint that clients should not index this publicly
					['-']
				]
			},
			hexToBytes(me.sk)
		);
		await publish(event);
		// optimistic local echo
		this.attach({
			id: event.id,
			pubkey: me.pk,
			peer,
			content: body,
			createdAt: event.created_at,
			mine: true
		});
	}
}

export const dms = new DMStore();
