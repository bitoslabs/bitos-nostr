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
const MAX_DM_CACHE_CHARS = 300_000;
const MAX_CACHED_MESSAGE_CHARS = 4_000;
const MAX_REMOVED_PEERS = 500;
const PERSIST_DEBOUNCE_MS = 250;
const CACHE_DB = 'bitos-messages';
const CACHE_STORE = 'direct-messages';
const CACHE_VERSION = 1;

type ReadCursor = NonNullable<Conversation['readCursor']>;
type DMCache = {
	version: 1;
	account: string;
	conversations: Conversation[];
	removedPeers: string[];
};
const EMPTY_CURSOR: ReadCursor = { createdAt: 0, idsAtCreatedAt: [] };

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
		this.loadedFor = me;
		void this.loadCached(me);
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
			conv = { peer: msg.peer, unread: 0, messages: [], readCursor: { ...EMPTY_CURSOR } };
			next.push(conv);
		}
		if (conv.messages.some((m) => m.id === msg.id)) return; // dedupe
		conv.messages.push(msg);
		conv.messages.sort((a, b) => a.createdAt - b.createdAt);
		conv.lastMessage = conv.messages[conv.messages.length - 1];
		conv.unread = this.unreadFor(conv);
		next.sort((a, b) => (b.lastMessage?.createdAt ?? 0) - (a.lastMessage?.createdAt ?? 0));
		this.conversations = next;
		this.schedulePersist();
	}

	/** Mark all messages in a conversation as read. */
	markRead(peer: string) {
		this.conversations = this.conversations.map((c) => {
			if (c.peer !== peer) return c;
			const incoming = c.messages.filter((message) => !message.mine);
			const latest = incoming.at(-1);
			if (!latest) return { ...c, unread: 0 };
			const idsAtCreatedAt = incoming
				.filter((message) => message.createdAt === latest.createdAt)
				.map((message) => message.id);
			return {
				...c,
				readCursor: { createdAt: latest.createdAt, idsAtCreatedAt },
				unread: 0
			};
		});
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

	private async loadCached(pk: string) {
		const cachedDb = await this.readCache(pk);
		if (this.loadedFor !== pk || identity.current?.pk !== pk) return;
		if (cachedDb) {
			this.removedPeers = new Set(cachedDb.removedPeers);
			const cached = this.normalizeConversations(cachedDb.conversations);
			// Relay events can arrive while IndexedDB is opening. Merge rather than
			// replacing them, so a fast live message is never lost from the UI/cache.
			const liveByPeer = new Map(
				this.conversations.map((conversation) => [conversation.peer, conversation])
			);
			const merged: Conversation[] = [
				...cached.map((conversation): Conversation => {
					const live = liveByPeer.get(conversation.peer);
					if (!live) return conversation;
					liveByPeer.delete(conversation.peer);
					const byId = new Map(conversation.messages.map((message) => [message.id, message]));
					for (const message of live.messages) byId.set(message.id, message);
					return { ...conversation, messages: [...byId.values()] };
				}),
				...liveByPeer.values()
			];
			this.conversations = this.normalizeConversations(merged);
			profiles.ensure(this.conversations.map((conversation) => conversation.peer));
			return;
		}
		this.loadLegacyCached(pk);
		this.schedulePersist();
	}

	private loadLegacyCached(pk: string) {
		try {
			const raw = localStorage.getItem(this.storageKey(pk));
			if (!raw) return;
			const parsed = JSON.parse(raw) as unknown;
			if (!Array.isArray(parsed)) return;
			const cached = parsed.filter((item): item is Conversation => this.isConversation(item));
			this.conversations = this.normalizeConversations(cached);
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

	private normalizeConversations(cached: Conversation[]) {
		return cached.slice(0, MAX_CACHED_CONVERSATIONS).map((conversation) => {
			const messages = conversation.messages
				.filter((message): message is DirectMessage => !!message?.id && !!message.peer)
				.sort((a, b) => a.createdAt - b.createdAt)
				.slice(-MAX_CACHED_MESSAGES_PER_CONVERSATION);
			const readCursor =
				conversation.readCursor ?? this.cursorFromLegacyUnread(messages, conversation.unread);
			const normalized = {
				peer: conversation.peer,
				readCursor,
				unread: 0,
				messages,
				lastMessage: messages.at(-1)
			};
			normalized.unread = this.unreadFor(normalized);
			return normalized;
		});
	}

	private cursorFromLegacyUnread(messages: DirectMessage[], unread: number): ReadCursor {
		const incoming = messages.filter((message) => !message.mine);
		const read = incoming.slice(0, Math.max(0, incoming.length - (unread || 0)));
		const last = read.at(-1);
		return last
			? {
					createdAt: last.createdAt,
					idsAtCreatedAt: read.filter((m) => m.createdAt === last.createdAt).map((m) => m.id)
				}
			: { ...EMPTY_CURSOR };
	}

	private unreadFor(conversation: Pick<Conversation, 'messages' | 'readCursor'>) {
		const cursor = conversation.readCursor ?? EMPTY_CURSOR;
		return conversation.messages.filter(
			(message) =>
				!message.mine &&
				(message.createdAt > cursor.createdAt ||
					(message.createdAt === cursor.createdAt && !cursor.idsAtCreatedAt.includes(message.id)))
		).length;
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
		void this.persistCache();
		// Keep the compact legacy cache as a fallback when IndexedDB is disabled.
		const key = this.storageKey(this.loadedFor);
		if (!key) return;
		const compactMessage = (message: DirectMessage): DirectMessage => ({
			id: message.id,
			pubkey: message.pubkey,
			peer: message.peer,
			content: message.content.slice(0, MAX_CACHED_MESSAGE_CHARS),
			createdAt: message.createdAt,
			mine: message.mine,
			protocol: message.protocol
		});

		for (const [conversationLimit, messagesLimit] of [
			[MAX_CACHED_CONVERSATIONS, MAX_CACHED_MESSAGES_PER_CONVERSATION],
			[40, 40],
			[20, 20],
			[10, 10]
		] as const) {
			const snapshot = this.conversations.slice(0, conversationLimit).map((conversation) => {
				const messages = conversation.messages
					.slice(-messagesLimit)
					.map((message) => compactMessage(message));
				return {
					peer: conversation.peer,
					unread: conversation.unread || 0,
					messages,
					lastMessage: messages[messages.length - 1]
				};
			});
			const serialized = JSON.stringify(snapshot);
			if (serialized.length > MAX_DM_CACHE_CHARS) continue;
			try {
				localStorage.setItem(key, serialized);
				return;
			} catch {
				// Retry with a smaller disposable cache snapshot.
			}
		}

		try {
			localStorage.removeItem(key);
		} catch {
			// Storage may be completely unavailable.
		}
	}

	private cacheRecord(): DMCache | null {
		if (!this.loadedFor) return null;
		return {
			version: CACHE_VERSION,
			account: this.loadedFor,
			conversations: this.normalizeConversations(this.conversations),
			removedPeers: [...this.removedPeers].slice(-MAX_REMOVED_PEERS)
		};
	}

	private async persistCache() {
		const cache = this.cacheRecord();
		if (!cache) return;
		try {
			const db = await this.openCacheDb();
			await new Promise<void>((resolve, reject) => {
				const request = db
					.transaction(CACHE_STORE, 'readwrite')
					.objectStore(CACHE_STORE)
					.put(cache);
				request.onsuccess = () => resolve();
				request.onerror = () => reject(request.error);
			});
			db.close();
		} catch {
			/* localStorage fallback above remains available */
		}
	}

	private async readCache(account: string): Promise<DMCache | null> {
		try {
			const db = await this.openCacheDb();
			const value = await new Promise<unknown>((resolve, reject) => {
				const request = db
					.transaction(CACHE_STORE, 'readonly')
					.objectStore(CACHE_STORE)
					.get(account);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			db.close();
			if (!value || typeof value !== 'object') return null;
			const cache = value as Partial<DMCache>;
			return cache.version === CACHE_VERSION &&
				cache.account === account &&
				Array.isArray(cache.conversations) &&
				Array.isArray(cache.removedPeers)
				? (cache as DMCache)
				: null;
		} catch {
			return null;
		}
	}

	private openCacheDb(): Promise<IDBDatabase> {
		return new Promise((resolve, reject) => {
			const request = indexedDB.open(CACHE_DB, 1);
			request.onupgradeneeded = () =>
				request.result.createObjectStore(CACHE_STORE, { keyPath: 'account' });
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}

	private persistRemoved() {
		if (!browser) return;
		const key = this.removedStorageKey();
		if (!key) return;
		try {
			localStorage.setItem(key, JSON.stringify([...this.removedPeers].slice(-MAX_REMOVED_PEERS)));
		} catch {
			// Removed-peer state is a convenience cache, not required state.
		}
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
