import { browser } from '$app/environment';
import { dms } from './dms.svelte';
import { identity } from './identity.svelte';
import { profiles } from './profiles.svelte';
import { shortKey } from '../utils/format';

type GroupMember = {
	name: string;
	initials: string;
	status: string;
	pubkey?: string;
	admin?: boolean;
};

type GroupMessage = {
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

type GroupThread = {
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

type GroupControlType = 'add-member' | 'remove-member' | 'leave-group';
type GroupControlPayload = {
	id: string;
	name: string;
	from: string;
	type: GroupControlType;
	member: string;
	members?: string[];
};

const GROUPS_KEY_PREFIX = 'bitos:message-groups';
const GROUP_CONTROL_PREFIX = 'bitos://group-control?';
const GROUP_CONTROL_PROCESSED_KEY_PREFIX = 'bitos:processed-group-controls';
const MAX_CACHED_GROUPS = 60;
const MAX_CACHED_GROUP_MESSAGES_PER_GROUP = 150;
const MAX_PROCESSED_GROUP_CONTROLS = 1200;

class GroupSyncStore {
	private processedGroupControlIds = new Set<string>();
	private processedGroupControlsLoaded = false;

	processDms() {
		if (!browser || !identity.current) return;
		this.loadProcessedGroupControls();
		let groups = loadGroups();
		let changed = false;
		for (const conversation of dms.conversations) {
			for (const message of conversation.messages) {
				if (message.mine || this.processedGroupControlIds.has(message.id)) continue;
				const payload = parseGroupControl(message.content);
				if (!payload) continue;
				const result = applyGroupControl(groups, payload, message.createdAt);
				groups = result.groups;
				changed ||= result.changed;
				if (result.changed) this.rememberProcessedGroupControl(message.id);
			}
		}
		if (changed) saveGroups(groups);
	}

	private loadProcessedGroupControls() {
		if (this.processedGroupControlsLoaded) return;
		this.processedGroupControlsLoaded = true;
		try {
			const raw = localStorage.getItem(processedGroupControlsStorageKey());
			if (!raw) return;
			const ids = JSON.parse(raw) as unknown;
			if (Array.isArray(ids)) {
				for (const id of ids) {
					if (typeof id === 'string') this.processedGroupControlIds.add(id);
				}
			}
		} catch {
			this.processedGroupControlIds.clear();
		}
	}

	private rememberProcessedGroupControl(id: string) {
		this.processedGroupControlIds.add(id);
		localStorage.setItem(
			processedGroupControlsStorageKey(),
			JSON.stringify([...this.processedGroupControlIds].slice(-MAX_PROCESSED_GROUP_CONTROLS))
		);
	}
}

function groupsStorageKey() {
	return `${GROUPS_KEY_PREFIX}:${identity.current?.pk ?? 'anonymous'}`;
}

function processedGroupControlsStorageKey() {
	return `${GROUP_CONTROL_PROCESSED_KEY_PREFIX}:${identity.current?.pk ?? 'anonymous'}`;
}

function loadGroups(): GroupThread[] {
	try {
		const raw = localStorage.getItem(groupsStorageKey());
		if (!raw) return [];
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(isGroupThread);
	} catch {
		return [];
	}
}

function saveGroups(groups: GroupThread[]) {
	const compact = groups.slice(0, MAX_CACHED_GROUPS).map((group) => ({
		...group,
		messages: dedupeMessages(group.messages).slice(-MAX_CACHED_GROUP_MESSAGES_PER_GROUP)
	}));
	localStorage.setItem(groupsStorageKey(), JSON.stringify(compact));
}

function isGroupThread(value: unknown): value is GroupThread {
	if (!value || typeof value !== 'object') return false;
	const group = value as Partial<GroupThread>;
	return (
		typeof group.id === 'string' &&
		typeof group.name === 'string' &&
		Array.isArray(group.members) &&
		Array.isArray(group.messages)
	);
}

function parseGroupControl(content: string): GroupControlPayload | null {
	const line = content
		.split(/\s+/)
		.find(
			(part) =>
				part.startsWith(GROUP_CONTROL_PREFIX) || part.startsWith(`nostr:${GROUP_CONTROL_PREFIX}`)
		);
	if (!line) return null;
	const raw = line.startsWith('nostr:') ? line.slice('nostr:'.length) : line;
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
				.filter((item) => /^[0-9a-fA-F]{64}$/.test(item)) ?? [];
		if (
			!id ||
			!name ||
			!from ||
			!/^[0-9a-fA-F]{64}$/.test(from) ||
			!type ||
			!['add-member', 'remove-member', 'leave-group'].includes(type) ||
			!member ||
			!/^[0-9a-fA-F]{64}$/.test(member)
		) {
			return null;
		}
		return { id, name, from: from.toLowerCase(), type, member: member.toLowerCase(), members };
	} catch {
		return null;
	}
}

function applyGroupControl(
	groups: GroupThread[],
	payload: GroupControlPayload,
	createdAt: number
): { groups: GroupThread[]; changed: boolean } {
	const me = identity.current?.pk;
	const group = groups.find((thread) => thread.id === payload.id);
	if (!group) {
		if (
			payload.type !== 'add-member' ||
			!me ||
			(payload.member !== me && !payload.members?.includes(me))
		) {
			return { groups, changed: false };
		}
		const members: GroupMember[] = membersFromControlSnapshot(payload).map((member) =>
			member.pubkey === me ? { ...member, name: 'You', initials: 'YO', status: 'Online' } : member
		);
		if (!members.some((member) => member.pubkey === me)) {
			members.unshift({ name: 'You', initials: 'YO', status: 'Online' });
		}
		const restoredGroup: GroupThread = {
			id: payload.id,
			name: payload.name,
			initials: initialsFor(payload.name) || 'GC',
			description: 'Re-added from a local group membership update.',
			pinned: 'No pinned message yet',
			unread: 1,
			members,
			messages: [
				systemMessage(
					`control:${payload.type}:${payload.id}:${payload.member}:${createdAt}`,
					`You were added to ${payload.name}`,
					createdAt
				)
			],
			files: []
		};
		return { groups: [restoredGroup, ...groups], changed: true };
	}

	if (payload.type === 'add-member') {
		const alreadyHasMember = group.members.some(
			(member) =>
				member.pubkey === payload.member ||
				(payload.member === me && !member.pubkey && member.name === 'You')
		);
		if (alreadyHasMember) {
			return {
				groups: groups.map((thread) =>
					thread.id === payload.id
						? { ...thread, members: mergeControlMembers(thread, payload) }
						: thread
				),
				changed: true
			};
		}
		const member = memberForPubkey(payload.member);
		return {
			groups: groups.map((thread) =>
				thread.id === payload.id
					? {
							...thread,
							unread: (thread.unread ?? 0) + 1,
							members: mergeControlMembers(
								{ ...thread, members: [...thread.members, member] },
								payload
							),
							messages: appendSystemMessage(
								thread.messages,
								`control:${payload.type}:${payload.id}:${payload.member}:${createdAt}`,
								`${displayNameForPubkey(payload.member)} joined the group`,
								createdAt
							)
						}
					: thread
			),
			changed: true
		};
	}

	if (payload.member === me && payload.type === 'remove-member') {
		return {
			groups: groups.filter((thread) => thread.id !== payload.id),
			changed: true
		};
	}

	const memberName =
		group.members.find((member) => member.pubkey === payload.member)?.name ??
		displayNameForPubkey(payload.member);
	return {
		groups: groups.map((thread) =>
			thread.id === payload.id
				? {
						...thread,
						unread: (thread.unread ?? 0) + 1,
						members: thread.members.filter((member) => member.pubkey !== payload.member),
						messages: appendSystemMessage(
							thread.messages,
							`control:${payload.type}:${payload.id}:${payload.member}:${createdAt}`,
							payload.type === 'leave-group'
								? `${memberName} left the group`
								: `${memberName} was removed from the group`,
							createdAt
						)
					}
				: thread
		),
		changed: true
	};
}

function appendSystemMessage(
	messages: GroupMessage[],
	id: string,
	content: string,
	createdAt: number
) {
	if (messages.some((message) => message.id === id)) return messages;
	return [...messages, systemMessage(id, content, createdAt)];
}

function systemMessage(id: string, content: string, createdAt: number): GroupMessage {
	return {
		id,
		author: 'BitOS',
		initials: 'BI',
		content,
		createdAt,
		type: 'text'
	};
}

function dedupeMessages(messages: GroupMessage[]) {
	const seen = new Set<string>();
	return messages.filter((message) => {
		if (seen.has(message.id)) return false;
		seen.add(message.id);
		return true;
	});
}

function membersFromControlSnapshot(payload: GroupControlPayload) {
	const seen = new Set<string>();
	return [payload.from, ...(payload.members ?? []), payload.member]
		.filter((pubkey) => {
			if (!pubkey || seen.has(pubkey)) return false;
			seen.add(pubkey);
			return true;
		})
		.map((pubkey) => ({
			...memberForPubkey(pubkey),
			admin: pubkey === payload.from
		}));
}

function mergeControlMembers(group: GroupThread, payload: GroupControlPayload) {
	const snapshotMembers = membersFromControlSnapshot(payload);
	const nextMembers = [...group.members];
	const me = identity.current?.pk;
	for (const member of snapshotMembers) {
		const existingIndex = nextMembers.findIndex(
			(item) =>
				(item.pubkey && item.pubkey === member.pubkey) ||
				(member.pubkey === me && !item.pubkey && item.name === 'You')
		);
		if (existingIndex >= 0) {
			nextMembers[existingIndex] = {
				...nextMembers[existingIndex],
				pubkey: nextMembers[existingIndex].pubkey ?? member.pubkey,
				admin: nextMembers[existingIndex].admin || member.admin
			};
		} else {
			nextMembers.push(member);
		}
	}
	return nextMembers;
}

function displayNameForPubkey(pubkey: string) {
	profiles.ensure([pubkey]);
	const profile = profiles.get(pubkey);
	return profile?.display_name || profile?.name || shortKey(pubkey);
}

function memberForPubkey(pubkey: string): GroupMember {
	const name = displayNameForPubkey(pubkey);
	return {
		name,
		initials: initialsFor(name),
		status: 'Invited',
		pubkey
	};
}

function initialsFor(name: string) {
	return name
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase() ?? '')
		.join('');
}

export const groupSync = new GroupSyncStore();
