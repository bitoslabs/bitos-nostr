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

/** A kind 1 text note ready for the feed UI. */
export interface FeedNote {
	id: string;
	pubkey: string;
	content: string;
	createdAt: number;
	tags: string[][];
	replyTo?: string;
	/** Reactions aggregated by emoji. */
	reactions: { emoji: string; count: number; byMe: boolean; myEventId?: string }[];
	repostCount: number;
	zapCount: number;
	zapTotalSats: number;
}

/** Activity addressed to the current user's pubkey. */
export interface NotificationItem {
	id: string;
	/** `mention` = a note that #p-tags you but isn't a reply; `zap` = a NIP-57 receipt. */
	type: 'like' | 'comment' | 'repost' | 'follow' | 'mention' | 'zap';
	pubkey: string;
	targetId?: string;
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

/** A NIP-04 direct message. */
export interface DirectMessage {
	id: string;
	pubkey: string; // sender pubkey
	peer: string; // the *other* party (counterparty of the conversation)
	content: string; // decrypted plaintext
	createdAt: number;
	mine: boolean;
}

/** A conversation row. */
export interface Conversation {
	peer: string;
	lastMessage?: DirectMessage;
	unread: number;
	messages: DirectMessage[];
}

/** Relay record mirroring bitdigo's relays feature. */
export interface RelayRecord {
	url: string;
	read: boolean;
	write: boolean;
	status: 'unknown' | 'connecting' | 'ok' | 'fail';
	latency: number | null;
	checkedAt?: number;
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
	DELETE: 5,
	REACTION: 7,
	DIRECT_MESSAGE: 4,
	REPOST: 6,
	CONTACT_LIST: 3,
	ZAP: 9735,
	/** NIP-38 user statuses — used for 24h stories + messenger-style notes. */
	STORY_STATUS: 30315
} as const;
