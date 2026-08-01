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
import { privacyNotificationSettings } from '$lib/stores/privacy-notification-settings.svelte';
import { blocks } from '$lib/stores/blocks.svelte';
import { hexToBytes } from './hex';
import { NOSTR_KINDS, type Conversation, type DirectMessage } from './types';

const STORAGE_KEY_PREFIX = 'bitos:dm-conversations';
const MAX_CACHED_CONVERSATIONS = 80;
const MAX_CACHED_MESSAGES_PER_CONVERSATION = 80;
const PERSIST_DEBOUNCE_MS = 250;

class DMStore {
	conversations = $state<Conversation[]>([]);
	loading = $state(false);
	connected = $state(false);
	private loadedFor = '';
	private unsub: (() => void) | null = null;
	private persistTimer: ReturnType<typeof setTimeout> | null = null;

	/** Total unread messages across all conversations (for the nav badge). */
	get unreadCount(): number {
		return this.conversations
			.filter((conversation) => !blocks.has(conversation.peer))
			.reduce((sum, c) => sum + (c.unread || 0), 0);
	}

	/** Conversation for a given peer (creates an empty placeholder if absent). */
	forPeer = (peer: string): Conversation => {
		const existing = this.conversations.find((c) => c.peer === peer);
		if (existing) return existing;
		const created: Conversation = { peer, unread: 0, messages: [] };
		this.conversations = [created, ...this.conversations];
		this.schedulePersist();
		return created;
	};

	start = () => {
		if (!browser) return;
		const me = identity.current?.pk;
		if (!me) return;
		this.stop();
		this.loadCached(me);
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
		this.flushPersist();
		this.conversations = [];
		this.loadedFor = '';
		this.loading = false;
		this.connected = false;
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
		if (!mine && blocks.has(peer)) return;
		const existingConversation = this.conversations.some(
			(conversation) => conversation.peer === peer
		);
		if (!mine && !existingConversation && !privacyNotificationSettings.canReceiveDmFrom(peer))
			return;
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
		this.schedulePersist();
	}

	/** Mark all messages in a conversation as read. */
	markRead(peer: string) {
		this.conversations = this.conversations.map((c) => (c.peer === peer ? { ...c, unread: 0 } : c));
		this.schedulePersist();
	}

	private storageKey(pk = identity.current?.pk) {
		return pk ? `${STORAGE_KEY_PREFIX}:${pk}` : '';
	}

	private isConversation(value: unknown): value is Conversation {
		if (!value || typeof value !== 'object') return false;
		const conversation = value as Partial<Conversation>;
		return typeof conversation.peer === 'string' && Array.isArray(conversation.messages);
	}

	private loadCached(pk: string) {
		if (!browser || this.loadedFor === pk) return;
		this.loadedFor = pk;
		try {
			const raw = localStorage.getItem(this.storageKey(pk));
			if (!raw) return;
			const parsed = JSON.parse(raw) as unknown;
			if (!Array.isArray(parsed)) return;
			const cached = parsed.filter((item): item is Conversation => this.isConversation(item));
			this.conversations = cached.map((conversation) => {
				const messages = conversation.messages
					.filter((message): message is DirectMessage => !!message?.id && !!message.peer)
					.slice(-MAX_CACHED_MESSAGES_PER_CONVERSATION);
				return {
					peer: conversation.peer,
					unread: conversation.unread || 0,
					messages,
					lastMessage: messages[messages.length - 1]
				};
			});
			profiles.ensure(this.conversations.map((conversation) => conversation.peer));
		} catch {
			/* ignore malformed cache */
		}
	}

	private schedulePersist() {
		if (!browser || this.persistTimer) return;
		this.persistTimer = setTimeout(() => {
			this.persistTimer = null;
			this.persist();
		}, PERSIST_DEBOUNCE_MS);
	}

	private flushPersist() {
		if (!this.persistTimer) return;
		clearTimeout(this.persistTimer);
		this.persistTimer = null;
		this.persist();
	}

	private persist() {
		if (!browser) return;
		const key = this.storageKey();
		if (!key) return;
		const snapshot = this.conversations.slice(0, MAX_CACHED_CONVERSATIONS).map((conversation) => {
			const messages = conversation.messages.slice(-MAX_CACHED_MESSAGES_PER_CONVERSATION);
			return {
				peer: conversation.peer,
				unread: conversation.unread || 0,
				messages,
				lastMessage: messages[messages.length - 1]
			};
		});
		localStorage.setItem(key, JSON.stringify(snapshot));
	}

	/** Encrypt + publish a DM to `peer`. */
	async send(peer: string, text: string): Promise<void> {
		if (!browser) return;
		const me = identity.current;
		if (!me) throw new Error('No identity');
		if (blocks.has(peer)) throw new Error('Unblock this user before messaging them');
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
