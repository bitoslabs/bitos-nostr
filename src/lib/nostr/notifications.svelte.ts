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
const STORAGE_KEY = 'bitos:read-notifications';
/** Per-type mutes persisted to localStorage (e.g. user hides likes). */
const MUTE_KEY = 'bitos:muted-notifications';

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
	private readIds = new Set<string>();
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
		this.loadRead();
		this.loadMuted();
		this.items = [];
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
		this.connected = false;
	};

	clear = () => {
		this.items = [];
		this.loading = false;
		this.loadingMore = false;
		this.hasMore = true;
		this.connected = false;
		this.error = null;
		this.readIds.clear();
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
			return this.makeItem(ev, 'mention', undefined, parseNotificationContent(ev.content));
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
			read: this.readIds.has(ev.id),
			raw: ev,
			...extra
		};
	}

	markRead(id: string) {
		if (this.readIds.has(id)) return;
		this.readIds.add(id);
		this.persistRead();
		this.items = this.items.map((item) => (item.id === id ? { ...item, read: true } : item));
	}

	/** Mark every item currently in view as read (used when the list is opened). */
	markVisibleRead(ids: string[]) {
		const toRead = ids.filter((id) => !this.readIds.has(id));
		if (!toRead.length) return;
		for (const id of toRead) this.readIds.add(id);
		this.persistRead();
		const next = new Set(toRead);
		this.items = this.items.map((item) => (next.has(item.id) ? { ...item, read: true } : item));
	}

	markAllRead() {
		if (!this.items.some((item) => !item.read)) return;
		for (const item of this.items) this.readIds.add(item.id);
		this.persistRead();
		this.items = this.items.map((item) => ({ ...item, read: true }));
	}

	toggleMute(type: NotificationItem['type']) {
		const next = new SvelteSet(this.muted);
		if (next.has(type)) next.delete(type);
		else next.add(type);
		this.muted = next;
		this.persistMuted();
	}

	setMuted(type: NotificationItem['type'], muted: boolean) {
		const next = new SvelteSet(this.muted);
		if (muted) next.add(type);
		else next.delete(type);
		this.muted = next;
		this.persistMuted();
	}

	private loadRead() {
		this.readIds.clear();
		if (!browser) return;
		try {
			const value = localStorage.getItem(STORAGE_KEY);
			if (!value) return;
			for (const id of JSON.parse(value) as string[]) this.readIds.add(id);
		} catch {
			this.readIds.clear();
		}
	}

	private persistRead() {
		if (!browser) return;
		localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.readIds].slice(-500)));
	}

	private loadMuted() {
		if (!browser) return;
		try {
			const value = localStorage.getItem(MUTE_KEY);
			if (!value) return;
			this.muted = new SvelteSet(JSON.parse(value) as NotificationItem['type'][]);
		} catch {
			this.muted = new SvelteSet();
		}
	}

	private persistMuted() {
		if (!browser) return;
		localStorage.setItem(MUTE_KEY, JSON.stringify([...this.muted]));
	}
}

export const notifications = new NotificationsStore();
