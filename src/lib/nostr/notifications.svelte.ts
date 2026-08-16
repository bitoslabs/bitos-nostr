/**
 * Notifications store — subscribes to public events that address the active
 * pubkey via `p` tags. This catches reactions, reply/comment notes, reposts,
 * follows, standalone mentions, and NIP-57 zap receipts so users see activity
 * around their posts.
 */
import { browser } from '$app/environment';
import { SvelteSet } from 'svelte/reactivity';
import { queryPrimaryFirst, subscribe } from './pool';
import { identity } from './identity.svelte';
import { profiles } from './profiles.svelte';
import { blocks } from '$lib/stores/blocks.svelte';
import { extractMentionEntities } from '$lib/utils/nip27';
import { NOSTR_KINDS, type Event, type NotificationItem } from './types';

const PAGE_LIMIT = 60;
const MAX_ITEMS = 600;
const MAX_READ_IDS = 200;
const CACHE_WRITE_DEBOUNCE_MS = 200;
const CACHE_DB = 'bitos-notifications';
const CACHE_STORE = 'accounts';
const READ_STATE_KEY_PREFIX = 'bitos:notification-read-state';
const LEGACY_READ_KEY = 'bitos:read-notifications';
const LEGACY_MUTE_KEY = 'bitos:muted-notifications';

type ReadCursor = { createdAt: number; idsAtCreatedAt: string[] };
type NotificationCache = {
	version: 1;
	account: string;
	events: NotificationItem[];
	readCursor: ReadCursor;
	/** Events individually opened after the read cursor. Kept bounded. */
	readIds: string[];
	muted: NotificationItem['type'][];
};
type NotificationReadState = Pick<NotificationCache, 'readCursor' | 'readIds'>;

const EMPTY_CURSOR: ReadCursor = { createdAt: 0, idsAtCreatedAt: [] };

function eventTarget(
	tags: string[][],
	options: { preferSecondEvent?: boolean } = {}
): string | undefined {
	const eventTags = tags.filter((tag) => tag[0] === 'e' && tag[1]);
	return options.preferSecondEvent ? (eventTags[1]?.[1] ?? eventTags[0]?.[1]) : eventTags[0]?.[1];
}

function isReply(tags: string[][]): boolean {
	return tags.some((tag) => tag[0] === 'e' && (tag[3] === 'reply' || tag[3] === 'root'));
}

function isPositiveReaction(content: string): boolean {
	return content !== '-';
}

function replyTarget(tags: string[][]): { id: string | undefined; kind: 'note' | 'comment' } {
	const eventTags = tags.filter((tag) => tag[0] === 'e' && tag[1]);
	const rootTag = eventTags.find((tag) => tag[3] === 'root');
	const root = rootTag?.[1] ?? eventTags[0]?.[1];
	const reply = eventTags.find((tag) => tag[3] === 'reply')?.[1];
	return reply && (!rootTag || reply !== root)
		? { id: reply, kind: 'comment' }
		: { id: root, kind: 'note' };
}

export function parseNotificationContent(content: string): string {
	const text = content.trim();
	if (!text) return '';

	try {
		const parsed: unknown = JSON.parse(text);
		if (typeof parsed === 'string') return parseNotificationContent(parsed);
		if (parsed && typeof parsed === 'object') {
			const obj = parsed as Record<string, unknown>;
			if (typeof obj.content === 'string') return parseNotificationContent(obj.content);
			if (typeof obj.text === 'string') return parseNotificationContent(obj.text);
			if (typeof obj.body === 'string') return parseNotificationContent(obj.body);
		}
	} catch {
		// Ignore parse failures and use raw content.
	}

	return content;
}

/** A note #p-tags the active user without being a reply (standalone mention). */
function mentionsMe(tags: string[][], me?: string): boolean {
	if (!me) return false;
	const target = me.toLowerCase();
	return tags.some((tag) => tag[0] === 'p' && tag[1]?.toLowerCase() === target);
}

/** NIP-57 zap receipt amount in sats, from the `amount` (msat) tag. */
function parseZapAmount(tags: string[][]): number {
	const amount = tags.find((tag) => tag[0] === 'amount')?.[1];
	const msat = amount ? Number(amount) : 0;
	return Number.isFinite(msat) ? Math.round(msat / 1000) : 0;
}

class NotificationsStore {
	items = $state<NotificationItem[]>([]);
	loading = $state(false);
	loadingMore = $state(false);
	hasMore = $state(true);
	connected = $state(false);
	/** Set when the relay subscription drops so the UI can offer retry. */
	error = $state<string | null>(null);
	/** Muted notification types (likes, follows, …) hidden from the list. */
	muted = $state<Set<NotificationItem['type']>>(new SvelteSet());
	private readCursor: ReadCursor = { ...EMPTY_CURSOR };
	private readIds = new Set<string>();
	private loadedFor = '';
	private cacheTimer: ReturnType<typeof setTimeout> | null = null;
	private unsub: (() => void) | null = null;

	/** Visible items after per-type mute filtering (drives UI + badge). */
	visible = $derived(
		this.items.filter((item) => !this.muted.has(item.type) && !blocks.has(item.pubkey))
	);

	/** Unread badge uses the visible (un-muted) set so muted types don't ping. */
	unreadCount = $derived(this.visible.filter((item) => !item.read).length);

	countByType = $derived.by(() => {
		const counts: Record<string, number> = {};
		for (const item of this.items) {
			if (this.muted.has(item.type)) continue;
			if (blocks.has(item.pubkey)) continue;
			counts[item.type] = (counts[item.type] ?? 0) + 1;
		}
		return counts;
	});

	start = () => {
		if (!browser) return;
		const me = identity.current?.pk;
		if (!me) return;
		this.stop();
		this.items = [];
		this.readCursor = { ...EMPTY_CURSOR };
		this.readIds.clear();
		this.muted = new SvelteSet();
		this.loadedFor = me;
		this.loadReadState(me);
		void this.loadCached(me);
		this.loading = true;
		this.loadingMore = false;
		this.hasMore = true;
		this.connected = false;
		this.error = null;
		this.unsub = subscribe([this.notificationFilter(me)], {
			oneose: () => {
				this.loading = false;
				this.connected = true;
				this.error = null;
			},
			onclose: () => {
				this.loading = false;
				this.connected = false;
			},
			onevent: (ev) => this.ingest(ev)
		});
	};

	stop = () => {
		if (this.unsub) {
			this.unsub();
			this.unsub = null;
		}
		this.flushPersist();
		this.connected = false;
	};

	clear = () => {
		this.items = [];
		this.loading = false;
		this.loadingMore = false;
		this.hasMore = true;
		this.connected = false;
		this.error = null;
		this.readCursor = { ...EMPTY_CURSOR };
		this.readIds.clear();
		this.loadedFor = '';
	};

	private notificationFilter(me: string, until?: number) {
		return {
			kinds: [
				NOSTR_KINDS.TEXT_NOTE,
				NOSTR_KINDS.CONTACT_LIST,
				NOSTR_KINDS.REACTION,
				NOSTR_KINDS.REPOST,
				NOSTR_KINDS.ZAP
			],
			'#p': [me],
			limit: PAGE_LIMIT,
			...(until ? { until } : {})
		};
	}

	async loadMore() {
		if (!browser || this.loadingMore || !this.hasMore) return 0;
		const me = identity.current?.pk;
		if (!me) return 0;
		const oldest = this.items.at(-1);
		if (!oldest) return 0;

		this.loadingMore = true;
		try {
			const applyEvents = (events: Awaited<ReturnType<typeof queryPrimaryFirst>>) => {
				const before = this.items.length;
				for (const ev of events.sort((a, b) => b.created_at - a.created_at)) this.ingest(ev);
				const added = this.items.length - before;
				if (!events.length || added === 0 || this.items.length >= MAX_ITEMS) this.hasMore = false;
				return added;
			};
			const events = await queryPrimaryFirst([this.notificationFilter(me, oldest.createdAt - 1)], {
				onSecondary: (mergedEvents) => {
					applyEvents(mergedEvents);
				}
			});
			const added = applyEvents(events);
			return added;
		} finally {
			this.loadingMore = false;
		}
	}

	private ingest(ev: Event) {
		const me = identity.current?.pk;
		if (!me || ev.pubkey === me || this.items.some((item) => item.id === ev.id)) return;
		if (blocks.has(ev.pubkey)) return;

		const item = this.toNotification(ev);
		if (!item) return;
		if (
			item.type === 'follow' &&
			this.items.some((existing) => existing.type === 'follow' && existing.pubkey === item.pubkey)
		) {
			return;
		}
		this.items = [item, ...this.items]
			.sort((a, b) => b.createdAt - a.createdAt)
			.slice(0, MAX_ITEMS);
		this.schedulePersist();
		// Fetch the actor's profile plus anyone they mention inline so preview
		// @names resolve.
		profiles.ensure([item.pubkey, ...extractMentionEntities(ev.content).pubkeys]);
	}

	private toNotification(ev: Event): NotificationItem | null {
		if (ev.kind === NOSTR_KINDS.ZAP) {
			return this.makeItem(
				ev,
				'zap',
				eventTarget(ev.tags, { preferSecondEvent: true }),
				ev.content,
				{
					amountSats: parseZapAmount(ev.tags)
				}
			);
		}
		if (ev.kind === NOSTR_KINDS.REACTION && isPositiveReaction(ev.content)) {
			const target = replyTarget(ev.tags);
			return this.makeItem(ev, 'like', target.id, ev.content || '❤️', {
				targetKind: target.kind
			});
		}
		if (ev.kind === NOSTR_KINDS.TEXT_NOTE && isReply(ev.tags)) {
			const target = replyTarget(ev.tags);
			return this.makeItem(ev, 'comment', target.id, parseNotificationContent(ev.content), {
				targetKind: target.kind
			});
		}
		// A note that mentions you via #p but isn't part of a reply thread.
		if (ev.kind === NOSTR_KINDS.TEXT_NOTE && mentionsMe(ev.tags, identity.current?.pk)) {
			// NIP-27 quote/mention notes commonly carry the referenced note in an
			// `e` tag. Open that origin from the notification instead of opening
			// the notification event itself.
			return this.makeItem(
				ev,
				'mention',
				eventTarget(ev.tags),
				parseNotificationContent(ev.content)
			);
		}
		if (ev.kind === NOSTR_KINDS.CONTACT_LIST) {
			return this.makeItem(ev, 'follow', undefined, ev.content);
		}
		if (ev.kind === NOSTR_KINDS.REPOST) {
			const targetId = eventTarget(ev.tags);
			return this.makeItem(ev, 'repost', targetId, parseNotificationContent(ev.content));
		}
		return null;
	}

	private makeItem(
		ev: Event,
		type: NotificationItem['type'],
		targetId: string | undefined,
		content: string,
		extra: Partial<Pick<NotificationItem, 'amountSats' | 'targetKind'>> = {}
	): NotificationItem {
		return {
			id: ev.id,
			type,
			pubkey: ev.pubkey,
			targetId,
			content,
			createdAt: ev.created_at,
			read: this.isRead(ev.id, ev.created_at),
			raw: ev,
			...extra
		};
	}

	markRead(id: string) {
		const item = this.items.find((entry) => entry.id === id);
		if (!item || item.read) return;
		this.readIds.add(id);
		this.trimReadIds();
		this.items = this.items.map((item) => (item.id === id ? { ...item, read: true } : item));
		this.persistReadState();
		// A deliberate read action must survive an immediate refresh; event
		// ingestion remains debounced, but read state is written straight away.
		void this.persistCached();
	}

	/** Mark every item currently in view as read (used when the list is opened). */
	markVisibleRead(ids: string[]) {
		const visible = this.items.filter((item) => ids.includes(item.id));
		if (!visible.some((item) => !item.read)) return;
		this.advanceReadCursor(visible);
		this.items = this.items.map((item) => (ids.includes(item.id) ? { ...item, read: true } : item));
		this.persistReadState();
		void this.persistCached();
	}

	markAllRead() {
		if (!this.items.some((item) => !item.read)) return;
		this.advanceReadCursor(this.items);
		this.items = this.items.map((item) => ({ ...item, read: true }));
		this.persistReadState();
		void this.persistCached();
	}

	toggleMute(type: NotificationItem['type']) {
		const next = new SvelteSet(this.muted);
		if (next.has(type)) next.delete(type);
		else next.add(type);
		this.muted = next;
		this.schedulePersist();
	}

	setMuted(type: NotificationItem['type'], muted: boolean) {
		const next = new SvelteSet(this.muted);
		if (muted) next.add(type);
		else next.delete(type);
		this.muted = next;
		this.schedulePersist();
	}

	private isRead(id: string, createdAt: number) {
		if (createdAt < this.readCursor.createdAt) return true;
		if (createdAt === this.readCursor.createdAt && this.readCursor.idsAtCreatedAt.includes(id))
			return true;
		return this.readIds.has(id);
	}

	/** Move the cursor to the newest event actually seen by the user. */
	private advanceReadCursor(items: NotificationItem[]) {
		const newestAt = Math.max(...items.map((item) => item.createdAt));
		if (!Number.isFinite(newestAt) || newestAt < this.readCursor.createdAt) return;
		const idsAtCreatedAt = items
			.filter((item) => item.createdAt === newestAt)
			.map((item) => item.id);
		if (newestAt > this.readCursor.createdAt) {
			this.readCursor = { createdAt: newestAt, idsAtCreatedAt };
			this.readIds = new Set([...this.readIds].filter((id) => !idsAtCreatedAt.includes(id)));
		} else {
			this.readCursor = {
				createdAt: newestAt,
				idsAtCreatedAt: [...new Set([...this.readCursor.idsAtCreatedAt, ...idsAtCreatedAt])]
			};
		}
	}

	private trimReadIds() {
		if (this.readIds.size <= MAX_READ_IDS) return;
		this.readIds = new Set([...this.readIds].slice(-MAX_READ_IDS));
	}

	private cacheRecord(account = this.loadedFor): NotificationCache | null {
		if (!account) return null;
		return {
			version: 1,
			account,
			events: this.items.slice(0, MAX_ITEMS),
			readCursor: this.readCursor,
			readIds: [...this.readIds],
			muted: [...this.muted]
		};
	}

	private readStateKey(account = this.loadedFor) {
		return account ? `${READ_STATE_KEY_PREFIX}:${account}` : '';
	}

	/** A tiny synchronous write-through guard for read actions during page unload. */
	private persistReadState() {
		const key = this.readStateKey();
		if (!browser || !key) return;
		try {
			const state: NotificationReadState = {
				readCursor: this.readCursor,
				readIds: [...this.readIds]
			};
			localStorage.setItem(key, JSON.stringify(state));
		} catch {
			/* IndexedDB remains the primary cache when localStorage is unavailable. */
		}
	}

	private loadReadState(account: string) {
		try {
			const raw = localStorage.getItem(this.readStateKey(account));
			if (!raw) return;
			const state = JSON.parse(raw) as Partial<NotificationReadState>;
			if (!state.readCursor || !Array.isArray(state.readIds)) return;
			this.readCursor = state.readCursor;
			this.readIds = new Set(state.readIds.slice(-MAX_READ_IDS));
		} catch {
			/* Ignore a malformed or unavailable backup. */
		}
	}

	private schedulePersist() {
		if (!browser || this.cacheTimer) return;
		this.cacheTimer = setTimeout(() => {
			this.cacheTimer = null;
			void this.persistCached();
		}, CACHE_WRITE_DEBOUNCE_MS);
	}

	private flushPersist() {
		if (!this.cacheTimer) return;
		clearTimeout(this.cacheTimer);
		this.cacheTimer = null;
		void this.persistCached();
	}

	private async loadCached(account: string) {
		const cache = await this.readCache(account);
		if (!cache || this.loadedFor !== account || identity.current?.pk !== account) return;
		this.mergeReadState(cache.readCursor, cache.readIds);
		this.muted = new SvelteSet(cache.muted);
		for (const item of cache.events) {
			if (this.items.some((current) => current.id === item.id)) continue;
			this.items.push({ ...item, read: this.isRead(item.id, item.createdAt) });
		}
		this.items = this.items
			.map((item) => ({ ...item, read: this.isRead(item.id, item.createdAt) }))
			.sort((a, b) => b.createdAt - a.createdAt)
			.slice(0, MAX_ITEMS);
		profiles.ensure(this.items.map((item) => item.pubkey));
		this.schedulePersist();
	}

	private mergeReadState(cursor: ReadCursor, readIds: string[]) {
		if (cursor.createdAt > this.readCursor.createdAt) {
			this.readCursor = cursor;
		} else if (cursor.createdAt === this.readCursor.createdAt) {
			this.readCursor = {
				createdAt: cursor.createdAt,
				idsAtCreatedAt: [...new Set([...this.readCursor.idsAtCreatedAt, ...cursor.idsAtCreatedAt])]
			};
		}
		this.readIds = new Set([...this.readIds, ...readIds].slice(-MAX_READ_IDS));
	}

	private async readCache(account: string): Promise<NotificationCache | null> {
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
			if (!this.isCache(value, account)) return this.readLegacyCache(account);
			return value;
		} catch {
			return this.readLegacyCache(account);
		}
	}

	private async persistCached() {
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
			// IndexedDB can be disabled (private browsing); UI remains functional.
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

	private isCache(value: unknown, account: string): value is NotificationCache {
		if (!value || typeof value !== 'object') return false;
		const cache = value as Partial<NotificationCache>;
		return (
			cache.version === 1 &&
			cache.account === account &&
			Array.isArray(cache.events) &&
			!!cache.readCursor &&
			Array.isArray(cache.readIds) &&
			Array.isArray(cache.muted)
		);
	}

	/** One-time migration from the former global localStorage settings. */
	private readLegacyCache(account: string): NotificationCache {
		let readIds: string[] = [];
		let muted: NotificationItem['type'][] = [];
		try {
			readIds = JSON.parse(localStorage.getItem(LEGACY_READ_KEY) ?? '[]') as string[];
			muted = JSON.parse(
				localStorage.getItem(LEGACY_MUTE_KEY) ?? '[]'
			) as NotificationItem['type'][];
			localStorage.removeItem(LEGACY_READ_KEY);
			localStorage.removeItem(LEGACY_MUTE_KEY);
		} catch {
			/* ignore malformed legacy values */
		}
		return { version: 1, account, events: [], readCursor: { ...EMPTY_CURSOR }, readIds, muted };
	}
}

export const notifications = new NotificationsStore();
