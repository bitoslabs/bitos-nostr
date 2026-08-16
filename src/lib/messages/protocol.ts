import { decode } from 'nostr-tools/nip19';

export type ChatKind = 'dm' | 'group';
export type ChatFilter = 'all' | 'unread' | 'groups';
export type CallKind = 'voice' | 'video';

export type ChatRow = {
	key: string;
	id: string;
	kind: ChatKind;
	name: string;
	preview: string;
	previewPrefix: string;
	time: string;
	unread: number;
	initials?: string;
	memberCount?: number;
	onlineCount?: number;
};

export type GroupMember = {
	name: string;
	initials: string;
	status: string;
	pubkey?: string;
	admin?: boolean;
};

export type GroupMessage = {
	id: string;
	author: string;
	initials: string;
	pubkey?: string;
	content: string;
	createdAt: number;
	mine?: boolean;
	type?: 'text' | 'voice' | 'file' | 'image' | 'call';
	meta?: string;
	reaction?: string;
};

export type GroupThread = {
	id: string;
	name: string;
	initials: string;
	description: string;
	pinned: string;
	unread: number;
	members: GroupMember[];
	messages: GroupMessage[];
	files: { name: string; meta: string; icon: string }[];
};

export type GroupInvite = {
	id: string;
	name: string;
	from: string;
};

export type GroupMessagePayload = GroupInvite & {
	body: string;
};

export type MessageMedia = {
	url: string;
	text: string;
	kind: 'image' | 'video' | 'file';
};

export type GroupControlType = 'add-member' | 'remove-member' | 'leave-group' | 'rename-group';
export type GroupControlPayload = GroupInvite & {
	type: GroupControlType;
	member: string;
	members?: string[];
};

export type CallSignalType = 'offer' | 'answer' | 'ice' | 'end' | 'log' | 'state';
export type CallOutcome = 'ended' | 'missed' | 'declined';
export type CallHandState = 'hand-up' | 'hand-down';
export type CallSignal = {
	callId: string;
	type: CallSignalType;
	kind: CallKind;
	from: string;
	groupId?: string;
	sdp?: string;
	candidate?: string;
	duration?: number;
	outcome?: CallOutcome;
	/** Ephemeral in-call state (e.g. raised hand). Only for `type: 'state'`. */
	state?: CallHandState;
};

export const GROUPS_KEY_PREFIX = 'bitos:message-groups';
export const GROUP_INVITE_PREFIX = 'bitos://group-invite?';
export const GROUP_MESSAGE_PREFIX = 'bitos://group-message?';
export const GROUP_CONTROL_PREFIX = 'bitos://group-control?';
export const GROUP_CONTROL_PROCESSED_KEY_PREFIX = 'bitos:processed-group-controls';
export const CALL_SIGNAL_PREFIX = 'bitos://call-signal?';
export const MAX_CACHED_GROUPS = 60;
export const MAX_CACHED_GROUP_MESSAGES_PER_GROUP = 150;
export const MAX_PROCESSED_GROUP_CONTROLS = 1200;
export const GROUP_PERSIST_DEBOUNCE_MS = 250;

const HEX_PUBKEY = /^[0-9a-fA-F]{64}$/;

export function isExpiredCallOffer(createdAt: number) {
	return Math.floor(Date.now() / 1000) - createdAt > 90;
}

export function initialsFor(name: string) {
	return name
		.split(/[\s_-]+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase())
		.join('');
}

export function formatDuration(seconds = 0) {
	const safe = Math.max(0, Math.floor(seconds));
	const hours = Math.floor(safe / 3600);
	const minutes = Math.floor((safe % 3600) / 60);
	const secs = safe % 60;
	if (hours) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
	return `${minutes}:${String(secs).padStart(2, '0')}`;
}

export function parsePubkey(value: string): string | null {
	const trimmed = value.trim();
	if (!trimmed) return null;
	if (trimmed.startsWith('npub1')) {
		try {
			const decoded = decode(trimmed);
			return decoded.type === 'npub' ? (decoded.data as string).toLowerCase() : null;
		} catch {
			return null;
		}
	}
	return HEX_PUBKEY.test(trimmed) ? trimmed.toLowerCase() : null;
}

function nostrUrlLine(content: string, prefix: string) {
	const line = content
		.split(/\s+/)
		.find((part) => part.startsWith(prefix) || part.startsWith(`nostr:${prefix}`));
	if (!line) return null;
	return line.startsWith('nostr:') ? line.slice('nostr:'.length) : line;
}

export function groupInviteText(group: GroupThread, from: string) {
	const params = new URLSearchParams({
		id: group.id,
		name: group.name,
		from
	});
	return [
		`You were invited to "${group.name}" on BitOS.`,
		'Open BitOS Messages to accept this local group invite.',
		`${GROUP_INVITE_PREFIX}${params.toString()}`
	].join('\n\n');
}

export function parseGroupInvite(content: string): GroupInvite | null {
	const raw = nostrUrlLine(content, GROUP_INVITE_PREFIX);
	if (!raw) return null;
	try {
		const params = new URLSearchParams(raw.slice(GROUP_INVITE_PREFIX.length));
		const id = params.get('id')?.trim();
		const name = params.get('name')?.trim();
		const from = params.get('from')?.trim();
		if (!id || !name || !from || !HEX_PUBKEY.test(from)) return null;
		return { id, name, from: from.toLowerCase() };
	} catch {
		return null;
	}
}

export function groupMessageText(group: GroupThread, from: string, body: string) {
	const params = new URLSearchParams({
		id: group.id,
		name: group.name,
		from,
		body
	});
	return [
		`New message in "${group.name}" on BitOS.`,
		'Open BitOS Messages to sync this local group message.',
		`${GROUP_MESSAGE_PREFIX}${params.toString()}`
	].join('\n\n');
}

export function parseGroupMessage(content: string): GroupMessagePayload | null {
	const raw = nostrUrlLine(content, GROUP_MESSAGE_PREFIX);
	if (!raw) return null;
	try {
		const params = new URLSearchParams(raw.slice(GROUP_MESSAGE_PREFIX.length));
		const id = params.get('id')?.trim();
		const name = params.get('name')?.trim();
		const from = params.get('from')?.trim();
		const body = params.get('body')?.trim();
		if (!id || !name || !from || !body || !HEX_PUBKEY.test(from)) return null;
		return { id, name, from: from.toLowerCase(), body };
	} catch {
		return null;
	}
}

export function groupControlText(
	group: GroupThread,
	from: string,
	type: GroupControlType,
	member: string
) {
	const params = new URLSearchParams({
		id: group.id,
		name: group.name,
		from,
		type,
		member
	});
	const memberPubkeys = group.members
		.map((item) => item.pubkey)
		.filter((pubkey): pubkey is string => !!pubkey);
	if (memberPubkeys.length) params.set('members', memberPubkeys.join(','));
	const label =
		type === 'add-member'
			? `A member was added to "${group.name}" on BitOS.`
			: type === 'remove-member'
				? `A member was removed from "${group.name}" on BitOS.`
				: type === 'rename-group'
					? `"${group.name}" was renamed on BitOS.`
					: `A member left "${group.name}" on BitOS.`;
	return [
		label,
		'Open BitOS Messages to sync this local group membership update.',
		`${GROUP_CONTROL_PREFIX}${params.toString()}`
	].join('\n\n');
}

export function parseGroupControl(content: string): GroupControlPayload | null {
	const raw = nostrUrlLine(content, GROUP_CONTROL_PREFIX);
	if (!raw) return null;
	try {
		const params = new URLSearchParams(raw.slice(GROUP_CONTROL_PREFIX.length));
		const id = params.get('id')?.trim();
		const name = params.get('name')?.trim();
		const from = params.get('from')?.trim();
		const type = params.get('type')?.trim() as GroupControlType | undefined;
		const member = params.get('member')?.trim();
		const members =
			params
				.get('members')
				?.split(',')
				.map((item) => item.trim().toLowerCase())
				.filter((item) => HEX_PUBKEY.test(item)) ?? [];
		if (
			!id ||
			!name ||
			!from ||
			!HEX_PUBKEY.test(from) ||
			!type ||
			!['add-member', 'remove-member', 'leave-group', 'rename-group'].includes(type)
		) {
			return null;
		}
		// `member` targets a pubkey for membership actions; for rename-group it
		// is the sender (kept for payload-shape compatibility).
		const targetMember = member && HEX_PUBKEY.test(member) ? member : from;
		return {
			id,
			name,
			from: from.toLowerCase(),
			type,
			member: targetMember.toLowerCase(),
			members
		};
	} catch {
		return null;
	}
}

export function callSignalText(signal: CallSignal) {
	const params = new URLSearchParams({
		callId: signal.callId,
		type: signal.type,
		kind: signal.kind,
		from: signal.from
	});
	if (signal.groupId) params.set('groupId', signal.groupId);
	if (signal.sdp) params.set('sdp', signal.sdp);
	if (signal.candidate) params.set('candidate', signal.candidate);
	if (typeof signal.duration === 'number') params.set('duration', String(signal.duration));
	if (signal.outcome) params.set('outcome', signal.outcome);
	if (signal.state) params.set('state', signal.state);
	return [
		`${signal.kind === 'video' ? 'Video' : 'Voice'} call signal on BitOS.`,
		'Open BitOS Messages to continue the call.',
		`${CALL_SIGNAL_PREFIX}${params.toString()}`
	].join('\n\n');
}

export function parseCallSignal(content: string): CallSignal | null {
	const raw = nostrUrlLine(content, CALL_SIGNAL_PREFIX);
	if (!raw) return null;
	try {
		const params = new URLSearchParams(raw.slice(CALL_SIGNAL_PREFIX.length));
		const callIdValue = params.get('callId')?.trim();
		const type = params.get('type')?.trim() as CallSignalType | undefined;
		const kind = params.get('kind')?.trim() as CallKind | undefined;
		const from = params.get('from')?.trim();
		if (
			!callIdValue ||
			!type ||
			!['offer', 'answer', 'ice', 'end', 'log', 'state'].includes(type) ||
			!kind ||
			!['voice', 'video'].includes(kind) ||
			!from ||
			!HEX_PUBKEY.test(from)
		) {
			return null;
		}
		return {
			callId: callIdValue,
			type,
			kind,
			from: from.toLowerCase(),
			groupId: params.get('groupId')?.trim() || undefined,
			sdp: params.get('sdp') ?? undefined,
			candidate: params.get('candidate') ?? undefined,
			duration: Number(params.get('duration') ?? 0) || undefined,
			outcome: ['ended', 'missed', 'declined'].includes(params.get('outcome') ?? '')
				? (params.get('outcome') as CallOutcome)
				: undefined,
			state: ['hand-up', 'hand-down'].includes(params.get('state') ?? '')
				? (params.get('state') as CallHandState)
				: undefined
		};
	} catch {
		return null;
	}
}

export function firstUrl(content: string) {
	return content.match(/https?:\/\/[^\s<>)"']+/i)?.[0] ?? '';
}

export function mediaKindFromUrl(url: string): MessageMedia['kind'] {
	const clean = url.split(/[?#]/)[0]?.toLowerCase() ?? url.toLowerCase();
	if (/\.(apng|avif|gif|jpe?g|png|svg|webp)$/.test(clean)) return 'image';
	if (/\.(m4v|mov|mp4|ogg|ogv|webm)$/.test(clean)) return 'video';
	return 'file';
}

export function mediaFromMessage(content: string): MessageMedia | null {
	const markdownImage = content.match(/!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/i);
	const url = markdownImage?.[1] ?? firstUrl(content);
	if (!url) return null;
	return {
		url,
		text: content.replace(markdownImage?.[0] ?? url, '').trim(),
		kind: markdownImage ? 'image' : mediaKindFromUrl(url)
	};
}

export function messagePreview(content?: string) {
	if (!content) return 'No messages yet';
	const msgMedia = mediaFromMessage(content);
	if (!msgMedia) return content;
	const label =
		msgMedia.kind === 'image'
			? 'Photo attachment'
			: msgMedia.kind === 'video'
				? 'Video attachment'
				: 'File attachment';
	return msgMedia.text ? `${label}: ${msgMedia.text}` : label;
}
