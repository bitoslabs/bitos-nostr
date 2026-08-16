/**
 * NIP-29 relay-based group chats.
 *
 * Groups live on a dedicated group relay (e.g. wss://groups.0x.chat): every
 * group has an id, and members publish kind 9 chat messages tagged
 * `["h", <id>]` to *that relay*. The relay enforces membership/permissions
 * (kinds 9000–9007 are admin controls; 9021/9022 are join/leave) and
 * republishes group metadata as addressable kind 39000 events.
 *
 * This store keeps a joined-groups registry (id + relay + metadata cache) in
 * localStorage, subscribes per relay to kinds 9/10 for the groups hosted
 * there, and exposes send/join/leave/discover. It deliberately does NOT
 * touch the user's global relay list — group traffic stays on group relays.
 *
 * Legacy BitOS local groups (group-sync.svelte.ts) remain untouched; NIP-29
 * groups are surfaced separately and interop with other NIP-29 clients.
 */
import { browser } from '$app/environment';
import { finalizeEvent } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/pure';
import { subscribeUrls, publishUrls, queryUrls } from './pool';
import { identity } from './identity.svelte';
import { profiles } from './profiles.svelte';
import { hexToBytes } from './hex';
import { clientTag } from './client-tag';
import { NOSTR_KINDS } from './types';

const GROUPS_KEY_PREFIX = 'bitos:nip29-groups';
const MESSAGES_KEY_PREFIX = 'bitos:nip29-messages';
const MAX_MESSAGES_PER_GROUP = 300;
const MAX_GROUPS = 50;
const HISTORY_LIMIT = 200;

/** A joined NIP-29 group. */
export interface Nip29Group {
	/** Group id — the `h` tag value (NIP-29 hex32 or name-style id). */
	id: string;
	/** The relay this group lives on (wss://…). */
	relay: string;
	/** Cached metadata (from kind 39000). */
	name?: string;
	about?: string;
	picture?: string;
	/** True when this account created the group (NIP-29: creator = owner/admin). */
	owned?: boolean;
	joinedAt: number;
	unread: number;
}

/** Attachment carried in a group message (imeta or a bare file URL). */
export interface GroupAttachment {
	url: string;
	kind: 'image' | 'video' | 'file';
	/** File name for download chips (non-media). */
	name?: string;
}

/** A parsed NIP-29 chat message. */
export interface Nip29Message {
	id: string;
	groupId: string;
	pubkey: string;
	/** Raw event content (caption + attachment URLs). */
	content: string;
	/** Display text: content with attachment URLs stripped. */
	text: string;
	/** Immediate parent message id (kind 10 `e` … `reply`), if any. */
	replyTo?: string;
	/** Thread root id (kind 10 `e` … `root`), when replying to a reply. */
	rootId?: string;
	/** Attachments parsed from imeta tags / bare URLs. */
	media: GroupAttachment[];
	createdAt: number;
	mine: boolean;
}

const MEDIA_URL_RE =
	/https?:\/\/[^\s<>()]+?\.(?:apng|avif|gif|jpe?g|png|webp|m3u8|m4v|mov|mp4|webm|pdf|zip|mp3|wav|ogg)(?:[?#][^\s<>()]*)?/gi;
const IMAGE_EXT_RE = /\.(?:apng|avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i;
const VIDEO_EXT_RE = /\.(?:m3u8|m4v|mov|mp4|webm)(?:[?#].*)?$/i;

/** Classify a URL as image / video / generic file. */
export function attachmentKind(url: string): GroupAttachment['kind'] {
	if (IMAGE_EXT_RE.test(url)) return 'image';
	if (VIDEO_EXT_RE.test(url)) return 'video';
	return 'file';
}

function fileNameFrom(url: string): string {
	try {
		return decodeURIComponent(new URL(url).pathname.split('/').pop() || 'file');
	} catch {
		return 'file';
	}
}

/**
 * Extract attachments + display text from a message's content + tags.
 * imeta (NIP-92) entries win; bare media URLs in the content are also picked
 * up (matching how feed.post / stories publish). URLs are stripped from the
 * returned text so bubbles render clean prose.
 */
export function parseMessageMedia(
	content: string,
	tags: string[][] = []
): { text: string; media: GroupAttachment[] } {
	const media: GroupAttachment[] = [];
	const urls: string[] = [];
	for (const tag of tags) {
		if (tag[0] !== 'imeta') continue;
		const urlLine = tag.find((seg) => seg.startsWith('url '));
		if (!urlLine) continue;
		const url = urlLine.slice(4).trim();
		if (!url || urls.includes(url)) continue;
		urls.push(url);
		media.push({ url, kind: attachmentKind(url), name: fileNameFrom(url) });
	}
	let text = content;
	for (const match of content.matchAll(MEDIA_URL_RE)) {
		const url = match[0];
		if (urls.includes(url)) continue;
		urls.push(url);
		media.push({ url, kind: attachmentKind(url), name: fileNameFrom(url) });
	}
	for (const url of urls) text = text.split(url).join(' ');
	text = text.replace(/\s+/g, ' ').trim();
	return { text, media };
}

/** Member + admin rosters relayed via kinds 39001/39002. */
export interface GroupRoster {
	members: string[];
	admins: string[];
	fetchedAt: number;
}

/** Extract deduped, lowercased p-tag pubkeys from a state event. */
export function rosterFromEvent(ev: Pick<Event, 'tags'>): string[] {
	const seen: string[] = [];
	for (const tag of ev.tags) {
		if (tag[0] !== 'p' || typeof tag[1] !== 'string') continue;
		const pk = tag[1].toLowerCase();
		if (/^[0-9a-f]{64}$/.test(pk) && !seen.includes(pk)) seen.push(pk);
	}
	return seen;
}

/**
 * Merge the newest member (39001) + admin (39002) state events into a roster.
 * Pure + exported for unit tests.
 */
export function mergeRosterEvents(
	events: Array<Pick<Event, 'kind' | 'tags' | 'created_at'>>
): GroupRoster {
	const latest = (kind: number) =>
		events.filter((ev) => ev.kind === kind).sort((a, b) => b.created_at - a.created_at)[0];
	const membersEv = latest(NOSTR_KINDS.GROUP_MEMBERS);
	const adminsEv = latest(NOSTR_KINDS.GROUP_ADMINS);
	return {
		members: membersEv ? rosterFromEvent(membersEv) : [],
		admins: adminsEv ? rosterFromEvent(adminsEv) : [],
		fetchedAt: Math.floor(Date.now() / 1000)
	};
}

/** Tags for a NIP-09 delete targeting a group chat message. */
export function buildGroupDeleteTags(messageId: string, groupId: string): string[][] {
	return [
		['e', messageId],
		['h', groupId]
	];
}

/** Tags for a NIP-29 admin action (kinds 9000–9004 target one user). */
export function buildAdminActionTags(
	groupId: string,
	action: 'add-user' | 'remove-user' | 'add-permission' | 'remove-permission',
	options: { pubkey?: string; permission?: string } = {}
): string[][] {
	const tags: string[][] = [['h', groupId]];
	if (options.pubkey) tags.push(['p', options.pubkey]);
	if ((action === 'add-permission' || action === 'remove-permission') && options.permission) {
		tags.push(['P', options.permission]);
	}
	return tags;
}

/**
 * Build the tag set for an outgoing group chat event (kind 9 or 10).
 * Pure + exported for unit tests.
 *
 * NIP-10 threading: a top-level reply carries `["e", <id>, "", "reply"]`;
 * a reply-to-a-reply also carries `["e", <root>, "", "root"]` so clients can
 * reconstruct the thread.
 */
export function buildGroupMessageTags(
	groupId: string,
	options: { replyTo?: string; rootId?: string } = {}
): string[][] {
	const tags: string[][] = [['h', groupId]];
	if (options.replyTo) {
		if (options.rootId && options.rootId !== options.replyTo) {
			tags.push(['e', options.rootId, '', 'root']);
		}
		tags.push(['e', options.replyTo, '', 'reply']);
	}
	return tags;
}

/** A discovered group from a relay's kind 39000 list. */
export interface Nip29GroupListing {
	id: string;
	relay: string;
	name: string;
	about?: string;
	picture?: string;
	members?: string[];
}

/** Known public NIP-29 group relays. Extend as the ecosystem grows. */
export const DEFAULT_GROUP_RELAYS = ['wss://groups.0x.chat'] as const;

const GROUP_ID_RE = /^[0-9a-f]{64}$/;
const RELAY_RE = /^wss?:\/\/[^\s/]+(:\d+)?(\/[^\s]*)?$/i;

/** Parse + validate a group id (accepts hex32; name-style ids allowed as-is). */
export function normalizeGroupId(id: string): string | null {
	const trimmed = id.trim().toLowerCase();
	if (!trimmed || trimmed.length > 100) return null;
	if (GROUP_ID_RE.test(trimmed)) return trimmed;
	// NIP-29 permits non-hex ids (e.g. `cheerful-straw-lotus`); be permissive
	// but reject whitespace/control characters.
	if (/^[\w.-]+$/.test(trimmed)) return trimmed;
	return null;
}

/** Normalize a relay URL (lowercase scheme/host, strip trailing slashes). */
export function normalizeGroupRelay(url: string): string | null {
	const trimmed = url.trim().replace(/\/+$/, '');
	if (!RELAY_RE.test(trimmed)) return null;
	try {
		// Non-reactive parse of a user-supplied string — plain URL is correct here.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const parsed = new URL(trimmed);
		return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, '')}`;
	} catch {
		return null;
	}
}

/** Parse a `39000:<relay-pubkey>:<group-id>` address into its group id. */
export function groupIdFromAddress(address: string): string | null {
	const parts = address.split(':');
	if (parts.length < 3 || parts[0] !== String(NOSTR_KINDS.GROUP_METADATA)) return null;
	const id = parts.slice(2).join(':');
	return normalizeGroupId(id);
}

/** Extract metadata fields from a kind 39000 event (content is JSON). */
export function parseGroupMetadata(ev: Pick<Event, 'content' | 'tags'>): {
	id: string;
	name: string;
	about?: string;
	picture?: string;
} | null {
	const hTag = ev.tags.find((t) => t[0] === 'h' && t[1]);
	const dTag = ev.tags.find((t) => t[0] === 'd' && t[1]);
	const id = hTag ? normalizeGroupId(hTag[1]) : dTag ? groupIdFromAddress(dTag[1]) : null;
	if (!id) return null;
	let name = id;
	let about: string | undefined;
	let picture: string | undefined;
	try {
		const json = JSON.parse(ev.content) as Record<string, unknown>;
		if (typeof json.name === 'string' && json.name.trim()) name = json.name.trim();
		if (typeof json.about === 'string') about = json.about;
		if (typeof json.picture === 'string') picture = json.picture;
	} catch {
		/* non-JSON content — fall back to the id */
	}
	return { id, name, about, picture };
}

/** Parse a kind 9/10 event into a message. Returns null when untagged. */
export function parseGroupMessage(ev: Event): Nip29Message | null {
	if (ev.kind !== NOSTR_KINDS.GROUP_CHAT_MESSAGE && ev.kind !== NOSTR_KINDS.GROUP_CHAT_REPLY) {
		return null;
	}
	const hTag = ev.tags.find((t) => t[0] === 'h' && t[1])?.[1];
	if (!hTag) return null;
	const rootId =
		ev.tags.find((t) => t[0] === 'e' && t[3] === 'root')?.[1] ??
		(ev.kind === NOSTR_KINDS.GROUP_CHAT_MESSAGE
			? ev.tags.find((t) => t[0] === 'e' && t[1])?.[1]
			: undefined);
	const replyTo =
		ev.kind === NOSTR_KINDS.GROUP_CHAT_REPLY
			? (ev.tags.find((t) => t[0] === 'e' && t[3] === 'reply')?.[1] ??
				ev.tags.find((t) => t[0] === 'e')?.[1])
			: undefined;
	const { text, media } = parseMessageMedia(ev.content, ev.tags);
	return {
		id: ev.id,
		groupId: normalizeGroupId(hTag) ?? hTag,
		pubkey: ev.pubkey.toLowerCase(),
		content: ev.content,
		text,
		replyTo,
		rootId,
		media,
		createdAt: ev.created_at,
		mine: false
	};
}

function nowSec() {
	return Math.floor(Date.now() / 1000);
}

class Nip29Store {
	groups = $state<Nip29Group[]>([]);
	/** `${relay}|${groupId}` → messages, newest last. */
	messages = $state<Record<string, Nip29Message[]>>({});
	loading = $state(false);
	connected = $state(false);
	/** `${relay}|${groupId}` → member/admin rosters from kinds 39001/39002. */
	rosters = $state<Record<string, GroupRoster>>({});

	private unsub: (() => void)[] = [];
	private startedFor = '';
	private loadedFor = '';

	static key(groupId: string, relay: string) {
		return `${relay}|${groupId}`;
	}

	key = (groupId: string, relay: string) => Nip29Store.key(groupId, relay);

	start = () => {
		if (!browser) return;
		const me = identity.current?.pk;
		if (!me) return;
		this.stop();
		if (this.loadedFor !== me) {
			this.loadCached(me);
			this.loadedFor = me;
		}
		this.startedFor = me;
		this.loading = true;
		const byRelay: Record<string, string[]> = {};
		for (const group of this.groups) {
			(byRelay[group.relay] ??= []).push(group.id);
		}
		const relayEntries = Object.entries(byRelay);
		if (!relayEntries.length) {
			this.loading = false;
			this.connected = true;
			return;
		}
		let pending = relayEntries.length;
		for (const [relay, ids] of relayEntries) {
			// Backfill history once, then keep the live subscription open.
			void queryUrls([relay], [{ kinds: [9, 10], '#h': ids, limit: HISTORY_LIMIT }])
				.then((events) => {
					for (const ev of events) this.ingest(ev);
				})
				.catch(() => undefined);
			this.unsub.push(
				subscribeUrls([relay], [{ kinds: [9, 10], '#h': ids, limit: 50 }], {
					oneose: () => {
						pending -= 1;
						if (pending <= 0) {
							this.loading = false;
							this.connected = true;
						}
					},
					onevent: (ev) => this.ingest(ev)
				})
			);
		}
	};

	stop = () => {
		for (const close of this.unsub) close();
		this.unsub = [];
		this.loading = false;
		this.connected = false;
		this.startedFor = '';
	};

	clear = () => {
		this.stop();
		this.groups = [];
		this.messages = {};
		this.rosters = {};
		this.loadedFor = '';
	};

	private groupsKey() {
		return `${GROUPS_KEY_PREFIX}:${identity.current?.pk ?? 'anonymous'}`;
	}

	private messagesKey() {
		return `${MESSAGES_KEY_PREFIX}:${identity.current?.pk ?? 'anonymous'}`;
	}

	private loadCached(me: string) {
		try {
			const raw = localStorage.getItem(this.groupsKey());
			if (raw) {
				const parsed = JSON.parse(raw) as Nip29Group[];
				if (Array.isArray(parsed)) this.groups = parsed.slice(0, MAX_GROUPS);
			}
		} catch {
			this.groups = [];
		}
		void me;
		try {
			const raw = localStorage.getItem(this.messagesKey());
			if (raw) {
				const parsed = JSON.parse(raw) as Record<string, Nip29Message[]>;
				this.messages = parsed && typeof parsed === 'object' ? parsed : {};
			}
		} catch {
			this.messages = {};
		}
	}

	private persistGroups() {
		if (!browser) return;
		try {
			localStorage.setItem(this.groupsKey(), JSON.stringify(this.groups));
		} catch {
			/* ignore */
		}
	}

	private persistMessages() {
		if (!browser) return;
		try {
			const compact: Record<string, Nip29Message[]> = {};
			for (const [key, list] of Object.entries(this.messages)) {
				compact[key] = list.slice(-MAX_MESSAGES_PER_GROUP);
			}
			localStorage.setItem(this.messagesKey(), JSON.stringify(compact));
		} catch {
			/* ignore */
		}
	}

	private ingest(ev: Event) {
		const msg = parseGroupMessage(ev);
		if (!msg) return;
		const group = this.groups.find((g) => g.id === msg.groupId);
		if (!group) return; // not joined — ignore
		const me = identity.current?.pk?.toLowerCase();
		msg.mine = !!me && msg.pubkey === me;
		const key = this.key(msg.groupId, group.relay);
		const list = this.messages[key] ?? [];
		if (list.some((m) => m.id === msg.id)) return;
		this.messages = { ...this.messages, [key]: [...list, msg].slice(-MAX_MESSAGES_PER_GROUP) };
		if (!msg.mine && this.startedFor) {
			group.unread += 1;
			this.groups = [...this.groups];
		}
		this.persistMessages();
		this.persistGroups();
		profiles.ensure([msg.pubkey]);
	}

	messagesFor = (groupId: string, relay: string): Nip29Message[] =>
		this.messages[this.key(groupId, relay)] ?? [];

	markRead = (groupId: string) => {
		const group = this.groups.find((g) => g.id === groupId);
		if (!group || !group.unread) return;
		group.unread = 0;
		this.groups = [...this.groups];
		this.persistGroups();
	};

	/**
	 * Join a group: publish kind 9021 to the group relay (required for closed
	 * groups; open groups accept it silently) and start tracking it locally.
	 */
	join = async (rawId: string, rawRelay: string): Promise<Nip29Group> => {
		if (!browser) throw new Error('browser only');
		const id = identity.current;
		if (!id) throw new Error('No identity — create or import a key first');
		const groupId = normalizeGroupId(rawId);
		const relay = normalizeGroupRelay(rawRelay);
		if (!groupId) throw new Error('Invalid group id');
		if (!relay) throw new Error('Invalid relay URL (must be wss://…)');
		const existing = this.groups.find((g) => g.id === groupId && g.relay === relay);
		if (existing) return existing;
		if (this.groups.length >= MAX_GROUPS) throw new Error('Too many joined groups');

		const group: Nip29Group = { id: groupId, relay, joinedAt: nowSec(), unread: 0 };
		// Best-effort join event — open groups often don't require it.
		const joinEvent = finalizeEvent(
			{
				kind: NOSTR_KINDS.GROUP_JOIN,
				content: '',
				created_at: nowSec(),
				tags: [['h', groupId], ...clientTag()]
			},
			hexToBytes(id.sk)
		);
		await publishUrls([relay], joinEvent).catch(() => undefined);
		this.groups = [...this.groups, group];
		this.persistGroups();
		// Fetch metadata + recent history for immediate content.
		void this.refreshGroup(group);
		if (this.startedFor) this.start(); // re-subscribe with the new group
		return group;
	};

	/** Leave: publish 9022 and drop local state. */
	leave = async (groupId: string) => {
		if (!browser) return;
		const id = identity.current;
		const group = this.groups.find((g) => g.id === groupId);
		if (!group) return;
		if (id) {
			const leaveEvent = finalizeEvent(
				{
					kind: NOSTR_KINDS.GROUP_LEAVE,
					content: '',
					created_at: nowSec(),
					tags: [['h', group.id], ...clientTag()]
				},
				hexToBytes(id.sk)
			);
			await publishUrls([group.relay], leaveEvent).catch(() => undefined);
		}
		this.groups = this.groups.filter((g) => g.id !== groupId);
		const key = this.key(group.id, group.relay);
		const next = { ...this.messages };
		delete next[key];
		this.messages = next;
		this.persistGroups();
		this.persistMessages();
		if (this.startedFor) this.start();
	};

	/**
	 * Send a chat message to the group's relay. Top-level messages are kind 9;
	 * replies (options.replyTo) are kind 10 with NIP-10 root/reply tags.
	 * Attachments are appended as URLs (feed.post convention) + NIP-92 imeta.
	 * Returns the event id.
	 */
	send = async (
		groupId: string,
		content: string,
		options: {
			/** Parent message id — publishes a threaded kind 10 reply. */
			replyTo?: string;
			/** Thread root (parent's rootId) when replying to a reply. */
			rootId?: string;
			/** Uploaded attachments to include. */
			attachments?: GroupAttachment[];
		} = {}
	): Promise<string> => {
		if (!browser) throw new Error('browser only');
		const id = identity.current;
		if (!id) throw new Error('No identity');
		const group = this.groups.find((g) => g.id === groupId);
		if (!group) throw new Error('Not a member of that group');
		const text = content.trim();
		const attachments = options.attachments ?? [];
		if (!text && !attachments.length) throw new Error('Nothing to send');
		const body = [text, attachments.map((a) => a.url).join('\n')].filter(Boolean).join('\n\n');
		const tags = [...buildGroupMessageTags(group.id, options), ...clientTag()];
		for (const attachment of attachments) {
			tags.push(['imeta', `url ${attachment.url}`]);
		}
		const event = finalizeEvent(
			{
				kind: options.replyTo ? NOSTR_KINDS.GROUP_CHAT_REPLY : NOSTR_KINDS.GROUP_CHAT_MESSAGE,
				content: body,
				created_at: nowSec(),
				tags
			},
			hexToBytes(id.sk)
		);
		await publishUrls([group.relay], event);
		this.ingest(event);
		return event.id;
	};

	/** Create a group (kind 9007) — requires admin permission on the relay. */
	createGroup = async (name: string, relay: string): Promise<string> => {
		if (!browser) throw new Error('browser only');
		const id = identity.current;
		if (!id) throw new Error('No identity');
		const cleanRelay = normalizeGroupRelay(relay);
		if (!cleanRelay) throw new Error('Invalid relay URL');
		const cleanName = name.trim().slice(0, 80);
		if (!cleanName) throw new Error('Group needs a name');
		const groupId = crypto.randomUUID().replace(/-/g, ''); // hex32 id
		const event = finalizeEvent(
			{
				kind: NOSTR_KINDS.GROUP_CREATE,
				content: '',
				created_at: nowSec(),
				tags: [['h', groupId], ['name', cleanName], ...clientTag()]
			},
			hexToBytes(id.sk)
		);
		await publishUrls([cleanRelay], event);
		// Join so the group lands in the local list + subscriptions…
		await this.join(groupId, cleanRelay).catch(() => undefined);
		// …then mark ownership: NIP-29 relays make the kind-9007 author the
		// group owner/admin. The local flag makes admin tools (rename, kick,
		// promote) available immediately, before the relay republishes its
		// kind 39002 admin roster.
		this.groups = this.groups.map((g) => (g.id === groupId ? { ...g, owned: true } : g));
		this.persistGroups();
		const created = this.groups.find((g) => g.id === groupId);
		if (created) void this.fetchRoster(created);
		return groupId;
	};

	/** Fetch + cache the member/admin roster (kinds 39001/39002). */
	fetchRoster = async (group: Nip29Group): Promise<GroupRoster | undefined> => {
		try {
			const events = await queryUrls(
				[group.relay],
				[
					{
						kinds: [NOSTR_KINDS.GROUP_MEMBERS, NOSTR_KINDS.GROUP_ADMINS],
						'#h': [group.id],
						limit: 20
					}
				]
			);
			const roster = mergeRosterEvents(events);
			this.rosters = { ...this.rosters, [this.key(group.id, group.relay)]: roster };
			if (roster.members.length) profiles.ensure(roster.members);
			return roster;
		} catch {
			return undefined;
		}
	};

	rosterOf = (groupId: string, relay: string): GroupRoster | undefined =>
		this.rosters[this.key(groupId, relay)];

	/**
	 * True when the active user may use admin tools. Two sources, OR'd:
	 *  - locally `owned` (this account created the group via kind 9007) —
	 *    covers the window before the relay republishes kind 39002;
	 *  - the relay's admin roster (kind 39002) — the authoritative list,
	 *    which also covers admins promoted later via kind 9003.
	 */
	isAdmin = (groupId: string, relay?: string): boolean => {
		const group = this.groups.find((g) => g.id === groupId && (!relay || g.relay === relay));
		if (!group) return false;
		if (group.owned) return true;
		const roster = this.rosters[this.key(group.id, group.relay)];
		const me = identity.current?.pk?.toLowerCase();
		return !!me && !!roster?.admins.includes(me);
	};

	/** Publish an admin action (kinds 9000–9004) to the group relay. */
	private async adminAction(groupId: string, kind: number, tags: string[][]): Promise<void> {
		const id = identity.current;
		const group = this.groups.find((g) => g.id === groupId);
		if (!id) throw new Error('No identity');
		if (!group) throw new Error('Not a member of that group');
		const event = finalizeEvent(
			{
				kind,
				content: '',
				created_at: nowSec(),
				tags: [...tags, ...clientTag()]
			},
			hexToBytes(id.sk)
		);
		await publishUrls([group.relay], event);
	}

	/**
	 * Rename / update a group's metadata (kind 9002). Admin-only — the relay
	 * rejects it otherwise. Only provided fields are changed on the relay.
	 */
	editGroupMetadata = async (
		groupId: string,
		metadata: { name?: string; about?: string; picture?: string }
	): Promise<void> => {
		const clean: Record<string, string> = {};
		if (metadata.name?.trim()) clean.name = metadata.name.trim().slice(0, 80);
		if (metadata.about?.trim()) clean.about = metadata.about.trim().slice(0, 500);
		if (metadata.picture?.trim()) clean.picture = metadata.picture.trim();
		if (!Object.keys(clean).length) throw new Error('Nothing to change');
		const id = identity.current;
		const group = this.groups.find((g) => g.id === groupId);
		if (!id) throw new Error('No identity');
		if (!group) throw new Error('Not a member of that group');
		const event = finalizeEvent(
			{
				kind: NOSTR_KINDS.GROUP_EDIT_METADATA,
				content: JSON.stringify(clean),
				created_at: nowSec(),
				tags: [['h', group.id], ...clientTag()]
			},
			hexToBytes(id.sk)
		);
		await publishUrls([group.relay], event);
		// Optimistically update the local cache; the relay will republish 39000.
		this.groups = this.groups.map((g) =>
			g.id === group.id
				? {
						...g,
						name: clean.name ?? g.name,
						about: clean.about ?? g.about,
						picture: clean.picture ?? g.picture
					}
				: g
		);
		this.persistGroups();
	};

	/** Invite a user (kind 9000, admin-only). */
	addMember = async (groupId: string, pubkey: string): Promise<void> => {
		await this.adminAction(
			groupId,
			NOSTR_KINDS.GROUP_ADD_USER,
			buildAdminActionTags(groupId, 'add-user', { pubkey })
		);
	};

	/** Kick a user (kind 9001, admin-only). */
	removeMember = async (groupId: string, pubkey: string): Promise<void> => {
		await this.adminAction(
			groupId,
			NOSTR_KINDS.GROUP_REMOVE_USER,
			buildAdminActionTags(groupId, 'remove-user', { pubkey })
		);
	};

	/** Grant the 'admin' permission (kind 9003, admin-only). */
	promoteToAdmin = async (groupId: string, pubkey: string): Promise<void> => {
		await this.adminAction(
			groupId,
			NOSTR_KINDS.GROUP_ADD_PERMISSION,
			buildAdminActionTags(groupId, 'add-permission', { pubkey, permission: 'admin' })
		);
	};

	/** Revoke the 'admin' permission (kind 9004, admin-only). */
	demoteAdmin = async (groupId: string, pubkey: string): Promise<void> => {
		await this.adminAction(
			groupId,
			NOSTR_KINDS.GROUP_REMOVE_PERMISSION,
			buildAdminActionTags(groupId, 'remove-permission', { pubkey, permission: 'admin' })
		);
	};

	/**
	 * Unsend one of your own messages: publish a NIP-09 kind 5 delete to the
	 * group relay (relay hides it for everyone when it honors deletes) and
	 * hide it locally immediately.
	 */
	deleteMessage = async (groupId: string, messageId: string): Promise<void> => {
		if (!browser) throw new Error('browser only');
		const id = identity.current;
		const group = this.groups.find((g) => g.id === groupId);
		if (!id) throw new Error('No identity');
		if (!group) throw new Error('Not a member of that group');
		const event = finalizeEvent(
			{
				kind: NOSTR_KINDS.DELETE,
				content: 'Deleted a group message from BitOS',
				created_at: nowSec(),
				tags: [...buildGroupDeleteTags(messageId, group.id), ...clientTag()]
			},
			hexToBytes(id.sk)
		);
		await publishUrls([group.relay], event).catch(() => undefined); // best-effort
		const key = this.key(group.id, group.relay);
		this.messages = {
			...this.messages,
			[key]: (this.messages[key] ?? []).filter((m) => m.id !== messageId)
		};
		this.persistMessages();
	};

	/**
	 * Page further back in history: fetch events older than the oldest cached
	 * message (until cursor) and prepend them. Returns how many were added —
	 * callers use 0 to disable the "Load earlier" affordance.
	 */
	loadOlder = async (groupId: string, limit = 100): Promise<number> => {
		if (!browser) return 0;
		const group = this.groups.find((g) => g.id === groupId);
		if (!group) return 0;
		const key = this.key(group.id, group.relay);
		const cached = this.messages[key] ?? [];
		const oldest = cached[0];
		if (!oldest) return 0;
		try {
			const events = await queryUrls(
				[group.relay],
				[
					{
						kinds: [NOSTR_KINDS.GROUP_CHAT_MESSAGE, NOSTR_KINDS.GROUP_CHAT_REPLY],
						'#h': [group.id],
						until: oldest.createdAt - 1,
						limit
					}
				]
			);
			const byId: Record<string, (typeof cached)[number]> = {};
			for (const m of cached) byId[m.id] = m;
			for (const ev of events) {
				const msg = parseGroupMessage(ev);
				if (!msg || msg.groupId !== group.id || byId[msg.id]) continue;
				const me = identity.current?.pk?.toLowerCase();
				msg.mine = !!me && msg.pubkey === me;
				byId[msg.id] = msg;
			}
			const merged = Object.values(byId).sort((a, b) => a.createdAt - b.createdAt);
			this.messages = { ...this.messages, [key]: merged.slice(-MAX_MESSAGES_PER_GROUP) };
			this.persistMessages();
			return merged.length - cached.length;
		} catch {
			return 0;
		}
	};

	/** Refresh a group's metadata (name/about/picture) from kind 39000. */
	refreshGroup = async (group: Nip29Group): Promise<void> => {
		try {
			const events = await queryUrls(
				[group.relay],
				[{ kinds: [NOSTR_KINDS.GROUP_METADATA], '#h': [group.id], limit: 1 }]
			);
			const latest = events.at(-1);
			if (!latest) return;
			const meta = parseGroupMetadata(latest);
			if (!meta) return;
			this.groups = this.groups.map((g) =>
				g.id === group.id && g.relay === group.relay
					? { ...g, name: meta.name, about: meta.about, picture: meta.picture }
					: g
			);
			this.persistGroups();
		} catch {
			/* best-effort */
		}
	};

	/** List groups a relay offers (kind 39000 events). */
	discover = async (relay: string): Promise<Nip29GroupListing[]> => {
		const cleanRelay = normalizeGroupRelay(relay);
		if (!cleanRelay) throw new Error('Invalid relay URL');
		const events = await queryUrls(
			[cleanRelay],
			[{ kinds: [NOSTR_KINDS.GROUP_METADATA], limit: 100 }]
		);
		const byId: Record<string, Nip29GroupListing> = {};
		for (const ev of events) {
			const meta = parseGroupMetadata(ev);
			if (!meta) continue;
			byId[meta.id] = { ...meta, relay: cleanRelay };
		}
		return Object.values(byId);
	};
}

export const nip29 = new Nip29Store();
