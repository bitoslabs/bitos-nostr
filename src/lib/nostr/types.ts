/** Shared Nostr domain types. */
import type { Event } from 'nostr-tools/pure';

export type { Event };

/** NIP-01 kind 0 metadata (profile). */
export interface Profile {
	pubkey: string;
	name?: string;
	display_name?: string;
	about?: string;
	picture?: string;
	banner?: string;
	website?: string;
	nip05?: string;
	lud16?: string;
	lud06?: string;
}

/** A single option in a NIP-style poll. */
export interface PollOption {
	/** Stable id used by votes (e.g. "0", "1"). */
	id: string;
	label: string;
}

/** Aggregated poll data attached to a kind-1 note. */
export interface PollData {
	options: PollOption[];
	/** optionId → vote count. */
	votes: Record<string, number>;
	totalVotes: number;
	/** The option id the current user voted for, if any. */
	myVote?: string;
	/** Unix seconds at which the poll closed (optional). */
	closedAt?: number;
}

/** A kind 1 text note ready for the feed UI. */
export interface FeedNote {
	id: string;
	pubkey: string;
	content: string;
	createdAt: number;
	/** NIP-13 leading zero-bit difficulty, when the note was mined. */
	pow?: number;
	tags: string[][];
	replyTo?: string;
	/** Reactions aggregated by emoji. */
	reactions: { emoji: string; count: number; byMe: boolean; myEventId?: string }[];
	repostCount: number;
	zapCount: number;
	zapTotalSats: number;
	/** Where this note entered the current view. Discovery notes are read-only
	 * candidates from curated relays outside the user's configured relay list. */
	source?: 'configured' | 'discovery';
	/** Original signed event, when available for protocol actions such as repost. */
	raw?: Event;
	/** Present when this note is a poll (kind 1 with `poll_option` tags). */
	poll?: PollData;
}

/**
 * Parse NIP-style poll options from a note's tags. Returns the option list or
 * `null` when the note is not a poll. Format: `["poll_option", "<id>", "<label>"]`.
 */
export function parsePoll(tags: string[][]): PollOption[] | null {
	const options: PollOption[] = [];
	for (const tag of tags) {
		if (tag[0] !== 'option' && tag[0] !== 'poll_option') continue;
		const id = tag[1];
		const label = tag.slice(2).join(' ').trim();
		if (!id) continue;
		options.push({ id, label: label || `Option ${options.length + 1}` });
	}
	return options.length >= 2 ? options : null;
}

/** Extract a poll's optional close timestamp from a `closed` tag, if any. */
export function pollClosedAt(tags: string[][]): number | undefined {
	const closed = tags.find((t) => t[0] === 'endsAt' || t[0] === 'closed' || t[0] === 'closed_at');
	if (!closed?.[1]) return undefined;
	const ts = Number(closed[1]);
	return Number.isFinite(ts) && ts > 0 ? ts : undefined;
}

/** Activity addressed to the current user's pubkey. */
export interface NotificationItem {
	id: string;
	/** `mention` = a note that #p-tags you but isn't a reply; `zap` = a NIP-57 receipt. */
	type: 'like' | 'comment' | 'repost' | 'follow' | 'mention' | 'zap';
	pubkey: string;
	targetId?: string;
	/** Whether the activity targets an original note or a comment/reply. */
	targetKind?: 'note' | 'comment';
	content: string;
	createdAt: number;
	read: boolean;
	/** Sats received, for `zap` notifications. */
	amountSats?: number;
	/** Original Nostr event for inspection/debugging. */
	raw?: Event;
}

/** Logical notification category used for filtering + per-type mute. */
export type NotificationType = NotificationItem['type'];

/** A direct message decrypted from either legacy or secure DM envelopes. */
export interface DirectMessage {
	id: string;
	pubkey: string; // sender pubkey
	peer: string; // the *other* party (counterparty of the conversation)
	content: string; // decrypted plaintext
	createdAt: number;
	mine: boolean;
	protocol?: 'nip04' | 'nip17';
}

/** A conversation row. */
export interface Conversation {
	peer: string;
	lastMessage?: DirectMessage;
	/** Last incoming-message position the user has seen. IDs handle same-second events. */
	readCursor?: { createdAt: number; idsAtCreatedAt: string[] };
	unread: number;
	messages: DirectMessage[];
}

/** Relay record mirroring bitdigo's relays feature. */
export interface RelayRecord {
	url: string;
	read: boolean;
	write: boolean;
	primary: boolean;
	writePrimary: boolean;
	status: 'unknown' | 'connecting' | 'ok' | 'fail';
	latency: number | null;
	checkedAt?: number;
}

/** A curated, community-popular relay surfaced under Settings → Recommended. */
export interface RecommendedRelay {
	url: string;
	name: string;
	description: string;
}

/** Identity material held in memory + localStorage. */
export interface Identity {
	/** hex 32-byte private key */
	sk: string;
	/** hex 32-byte public key */
	pk: string;
	npub: string;
	nsec: string;
	profile?: Profile;
}

export const NOSTR_KINDS = {
	METADATA: 0,
	TEXT_NOTE: 1,
	/** NIP-68 picture-first post. */
	PICTURE: 20,
	/** NIP-71 normal (typically landscape) video. */
	VIDEO: 21,
	/** NIP-71 short-form portrait video. */
	SHORT_VIDEO: 22,
	DELETE: 5,
	REACTION: 7,
	POLL_RESPONSE: 1018,
	POLL: 1068,
	DIRECT_MESSAGE: 4,
	DM_SEAL: 13,
	PRIVATE_DIRECT_MESSAGE: 14,
	REPOST: 6,
	CONTACT_LIST: 3,
	/** NIP-51 pinned notes list. */
	PINNED_NOTES: 10001,
	/** NIP-65 relay list metadata. */
	RELAY_LIST: 10002,
	/** NIP-29 relay-based group chat message. */
	GROUP_CHAT_MESSAGE: 9,
	/** NIP-29 reply inside a group chat thread. */
	GROUP_CHAT_REPLY: 10,
	/** NIP-29 admin: create a group. */
	GROUP_CREATE: 9007,
	/** NIP-29 admin: add a user to a group. */
	GROUP_ADD_USER: 9000,
	/** NIP-29 admin: remove (kick) a user. */
	GROUP_REMOVE_USER: 9001,
	/** NIP-29 admin: edit group metadata (name/about/picture). */
	GROUP_EDIT_METADATA: 9002,
	/** NIP-29 admin: grant a permission (e.g. 'admin'). */
	GROUP_ADD_PERMISSION: 9003,
	/** NIP-29 admin: revoke a permission. */
	GROUP_REMOVE_PERMISSION: 9004,
	/** NIP-29 member: join a group. */
	GROUP_JOIN: 9021,
	/** NIP-29 member: leave a group. */
	GROUP_LEAVE: 9022,
	/** NIP-29 relay-published group metadata (addressable). */
	GROUP_METADATA: 39000,
	/** NIP-29 relay-published member list. */
	GROUP_MEMBERS: 39001,
	/** NIP-29 relay-published admin list. */
	GROUP_ADMINS: 39002,
	/** NIP-56 report event. */
	REPORT: 1984,
	ZAP: 9735,
	/** NIP-53 live streaming activity (used by zap.stream and other clients). */
	LIVE_ACTIVITY: 30311,
	GIFT_WRAP: 1059,
	/** NIP-38 user statuses — used for 24h stories + messenger-style notes. */
	STORY_STATUS: 30315,
	/** NIP-71 addressable short-form portrait video. */
	ADDRESSABLE_SHORT_VIDEO: 34236,
	/** NIP-71 addressable normal video. */
	ADDRESSABLE_VIDEO: 34235
} as const;
