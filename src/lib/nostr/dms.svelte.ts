/**
 * Direct messages. Subscribes to legacy NIP-04 kind-4 events plus secure
 * gift-wrapped NIP-17 events, decrypts them on-device, and groups them into
 * conversations. New outbound messages prefer NIP-17 and fall back to NIP-04
 * only if secure delivery fails at the relay layer.
 */
import { browser } from '$app/environment';
import { finalizeEvent } from 'nostr-tools/pure';
import { nip04 } from 'nostr-tools';
import { unwrapEvent, wrapManyEvents } from 'nostr-tools/nip17';
import { subscribe, publish } from './pool';
import { identity } from './identity.svelte';
import { profiles } from './profiles.svelte';
import { privacyNotificationSettings } from '$lib/stores/privacy-notification-settings.svelte';
import { blocks } from '$lib/stores/blocks.svelte';
import { hexToBytes } from './hex';
import { NOSTR_KINDS, type Conversation, type DirectMessage, type Event } from './types';

const STORAGE_KEY_PREFIX = 'bitos:dm-conversations';
const REMOVED_KEY_PREFIX = 'bitos:dm-removed';
const MAX_CACHED_CONVERSATIONS = 80;
const MAX_CACHED_MESSAGES_PER_CONVERSATION = 80;
const PERSIST_DEBOUNCE_MS = 250;

class DMStore {
	conversations = $state<Conversation[]>([]);
	loading = $state(false);
	connected = $state(false);
	private loadedFor = '';
	private removedPeers = new Set<string>();
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
		if (this.removedPeers.delete(peer)) this.persistRemoved();
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
		// Legacy kind-4 DMs plus secure gift-wrapped DMs addressed to me.
		this.unsub = subscribe(
			[
				{ kinds: [NOSTR_KINDS.DIRECT_MESSAGE], authors: [me] },
				{ kinds: [NOSTR_KINDS.DIRECT_MESSAGE], '#p': [me] },
				{ kinds: [NOSTR_KINDS.GIFT_WRAP], '#p': [me] }
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
		this.removedPeers.clear();
		this.loadedFor = '';
		this.loading = false;
		this.connected = false;
	};

	private async ingest(ev: Event) {
		const me = identity.current;
		if (!me) return;
		const msg =
			ev.kind === NOSTR_KINDS.GIFT_WRAP
				? this.ingestGiftWrap(ev, me)
				: await this.ingestLegacyDm(ev, me);
		if (!msg) return;
		this.attach(msg);
		profiles.ensure([msg.peer]);
	}

	private canAcceptPeer(peer: string, mine: boolean) {
		if (!peer) return false;
		if (!mine && blocks.has(peer)) return false;
		const existingConversation = this.conversations.some(
			(conversation) => conversation.peer === peer
		);
		return mine || existingConversation || privacyNotificationSettings.canReceiveDmFrom(peer);
	}

	private async ingestLegacyDm(
		ev: Event,
		me: NonNullable<typeof identity.current>
	): Promise<DirectMessage | null> {
		const mine = ev.pubkey === me.pk;
		const peer = mine ? (ev.tags.find((tag) => tag[0] === 'p')?.[1] ?? '') : ev.pubkey;
		if (!peer || !this.canAcceptPeer(peer, mine)) return null;

		let plaintext: string;
		try {
			plaintext = await nip04.decrypt(me.sk, peer, ev.content);
		} catch {
			plaintext = 'Unable to decrypt this legacy DM.';
		}

		return {
			id: ev.id,
			pubkey: ev.pubkey,
			peer,
			content: plaintext,
			createdAt: ev.created_at,
			mine,
			protocol: 'nip04'
		};
	}

	private ingestGiftWrap(
		ev: Event,
		me: NonNullable<typeof identity.current>
	): DirectMessage | null {
		try {
			const inner = unwrapEvent(ev, hexToBytes(me.sk));
			if (inner.kind !== NOSTR_KINDS.PRIVATE_DIRECT_MESSAGE) return null;
			const mine = inner.pubkey === me.pk;
			const peer = mine
				? (inner.tags.find((tag) => tag[0] === 'p' && tag[1] !== me.pk)?.[1] ?? '')
				: inner.pubkey;
			if (!peer || !this.canAcceptPeer(peer, mine)) return null;
			return {
				id: ev.id,
				pubkey: inner.pubkey,
				peer,
				content: inner.content,
				createdAt: inner.created_at,
				mine,
				protocol: 'nip17'
			};
		} catch {
			return null;
		}
	}

	private attach(msg: DirectMessage) {
		if (this.removedPeers.has(msg.peer) && !msg.mine) return;
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

	/** Remove a conversation from the local chat list and cache. */
	remove(peer: string) {
		this.conversations = this.conversations.filter((conversation) => conversation.peer !== peer);
		this.removedPeers.add(peer);
		this.schedulePersist();
		this.persistRemoved();
	}

	private storageKey(pk = identity.current?.pk) {
		return pk ? `${STORAGE_KEY_PREFIX}:${pk}` : '';
	}

	private removedStorageKey(pk = identity.current?.pk) {
		return pk ? `${REMOVED_KEY_PREFIX}:${pk}` : '';
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
		try {
			const rawRemoved = localStorage.getItem(this.removedStorageKey(pk));
			const parsedRemoved = rawRemoved ? (JSON.parse(rawRemoved) as unknown) : [];
			if (Array.isArray(parsedRemoved)) {
				this.removedPeers = new Set(
					parsedRemoved.filter((peer): peer is string => typeof peer === 'string')
				);
				this.conversations = this.conversations.filter(
					(conversation) => !this.removedPeers.has(conversation.peer)
				);
			}
		} catch {
			/* ignore malformed removed-chat cache */
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

	private persistRemoved() {
		if (!browser) return;
		const key = this.removedStorageKey();
		if (!key) return;
		localStorage.setItem(key, JSON.stringify([...this.removedPeers]));
	}

	/** Encrypt + publish a DM to `peer`. */
	async send(peer: string, text: string): Promise<void> {
		if (!browser) return;
		const me = identity.current;
		if (!me) throw new Error('No identity');
		if (blocks.has(peer)) throw new Error('Unblock this user before messaging them');
		const body = text.trim();
		if (!body) return;
		const createdAt = Math.floor(Date.now() / 1000);
		const secureEvents = wrapManyEvents(hexToBytes(me.sk), [{ publicKey: peer }], body);
		try {
			await Promise.all(secureEvents.map((event) => publish(event)));
			this.attach({
				id: secureEvents[0]?.id ?? `${me.pk}:${peer}:${createdAt}`,
				pubkey: me.pk,
				peer,
				content: body,
				createdAt,
				mine: true,
				protocol: 'nip17'
			});
			return;
		} catch {
			/* secure delivery failed on current relays; fall back to legacy */
		}

		const ciphertext = await nip04.encrypt(me.sk, peer, body);
		const legacyEvent = finalizeEvent(
			{
				kind: NOSTR_KINDS.DIRECT_MESSAGE,
				content: ciphertext,
				created_at: createdAt,
				tags: [['p', peer], ['-']]
			},
			hexToBytes(me.sk)
		);
		await publish(legacyEvent);
		this.attach({
			id: legacyEvent.id,
			pubkey: me.pk,
			peer,
			content: body,
			createdAt,
			mine: true,
			protocol: 'nip04'
		});
	}
}

export const dms = new DMStore();
