/**
 * Notifications store — subscribes to public events that address the active
 * pubkey via `p` tags. This catches reactions, reply/comment notes, reposts,
 * follows so users see activity around their posts.
 */
import { browser } from '$app/environment';
import { queryOnce, subscribe } from './pool';
import { identity } from './identity.svelte';
import { profiles } from './profiles.svelte';
import { NOSTR_KINDS, type NotificationItem } from './types';

const PAGE_LIMIT = 60;
const MAX_ITEMS = 600;
const STORAGE_KEY = 'bitos:read-notifications';

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

class NotificationsStore {
	items = $state<NotificationItem[]>([]);
	loading = $state(false);
	loadingMore = $state(false);
	hasMore = $state(true);
	connected = $state(false);
	private readIds = new Set<string>();
	private unsub: (() => void) | null = null;

	unreadCount = $derived(this.items.filter((item) => !item.read).length);

	start = () => {
		if (!browser) return;
		const me = identity.current?.pk;
		if (!me) return;
		this.stop();
		this.loadRead();
		this.items = [];
		this.loading = true;
		this.loadingMore = false;
		this.hasMore = true;
		this.connected = false;
		this.unsub = subscribe([this.notificationFilter(me)], {
			oneose: () => {
				this.loading = false;
				this.connected = true;
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

	private notificationFilter(me: string, until?: number) {
		return {
			kinds: [
				NOSTR_KINDS.TEXT_NOTE,
				NOSTR_KINDS.CONTACT_LIST,
				NOSTR_KINDS.REACTION,
				NOSTR_KINDS.REPOST
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
			const events = await queryOnce([this.notificationFilter(me, oldest.createdAt - 1)]);
			const before = this.items.length;
			for (const ev of events.sort((a, b) => b.created_at - a.created_at)) this.ingest(ev);
			const added = this.items.length - before;
			if (!events.length || added === 0 || this.items.length >= MAX_ITEMS) this.hasMore = false;
			return added;
		} finally {
			this.loadingMore = false;
		}
	}

	private ingest(ev: {
		id: string;
		pubkey: string;
		content: string;
		created_at: number;
		tags: string[][];
		kind: number;
	}) {
		const me = identity.current?.pk;
		if (!me || ev.pubkey === me || this.items.some((item) => item.id === ev.id)) return;

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
		profiles.ensure([item.pubkey]);
	}

	private toNotification(ev: {
		id: string;
		pubkey: string;
		content: string;
		created_at: number;
		tags: string[][];
		kind: number;
	}): NotificationItem | null {
		if (ev.kind === NOSTR_KINDS.REACTION && isPositiveReaction(ev.content)) {
			const targetId = eventTarget(ev.tags);
			return this.makeItem(ev, 'like', targetId, ev.content || '❤️');
		}
		if (ev.kind === NOSTR_KINDS.TEXT_NOTE && isReply(ev.tags)) {
			const targetId = eventTarget(ev.tags);
			return this.makeItem(ev, 'comment', targetId, ev.content);
		}
		if (ev.kind === NOSTR_KINDS.CONTACT_LIST) {
			return this.makeItem(ev, 'follow', undefined, ev.content);
		}
		if (ev.kind === NOSTR_KINDS.REPOST) {
			const targetId = eventTarget(ev.tags);
			return this.makeItem(ev, 'repost', targetId, ev.content);
		}
		return null;
	}

	private makeItem(
		ev: {
			id: string;
			pubkey: string;
			content: string;
			created_at: number;
		},
		type: NotificationItem['type'],
		targetId: string | undefined,
		content: string
	): NotificationItem {
		return {
			id: ev.id,
			type,
			pubkey: ev.pubkey,
			targetId,
			content,
			createdAt: ev.created_at,
			read: this.readIds.has(ev.id)
		};
	}

	markRead(id: string) {
		if (this.readIds.has(id)) return;
		this.readIds.add(id);
		this.persistRead();
		this.items = this.items.map((item) => (item.id === id ? { ...item, read: true } : item));
	}

	markAllRead() {
		if (!this.items.some((item) => !item.read)) return;
		for (const item of this.items) this.readIds.add(item.id);
		this.persistRead();
		this.items = this.items.map((item) => ({ ...item, read: true }));
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
}

export const notifications = new NotificationsStore();
