<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { decode } from 'nostr-tools/nip19';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import { dms } from '$lib/nostr/dms.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import type { Conversation, DirectMessage } from '$lib/nostr/types';
	import { humanBytes, type MediaProviderId, type UploadedMedia } from '$lib/media/uploaders';
	import { media, providerLabel } from '$lib/stores/media.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { shortKey, timeAgo } from '$lib/utils/format';

	type ChatKind = 'dm' | 'group';
	type ChatFilter = 'all' | 'unread' | 'groups';
	type CallKind = 'voice' | 'video';

	type ChatRow = {
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

	type GroupInvite = {
		id: string;
		name: string;
		from: string;
	};

	type GroupMessagePayload = GroupInvite & {
		body: string;
	};

	type MessageAttachment = UploadedMedia & {
		name: string;
	};

	type MessageMedia = {
		url: string;
		text: string;
		kind: 'image' | 'video' | 'file';
	};

	type GroupControlType = 'add-member' | 'remove-member' | 'leave-group';
	type GroupControlPayload = GroupInvite & {
		type: GroupControlType;
		member: string;
		members?: string[];
	};

	type CallSignalType = 'offer' | 'answer' | 'ice' | 'end' | 'log';
	type CallState = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'connected';
	type CallSignal = {
		callId: string;
		type: CallSignalType;
		kind: CallKind;
		from: string;
		groupId?: string;
		sdp?: string;
		candidate?: string;
		duration?: number;
	};

	type RemoteParticipant = {
		peer: string;
		name: string;
		stream: MediaStream;
	};

	const GROUPS_KEY_PREFIX = 'bitos:message-groups';
	const GROUP_INVITE_PREFIX = 'bitos://group-invite?';
	const GROUP_MESSAGE_PREFIX = 'bitos://group-message?';
	const GROUP_CONTROL_PREFIX = 'bitos://group-control?';
	const GROUP_CONTROL_PROCESSED_KEY_PREFIX = 'bitos:processed-group-controls';
	const CALL_SIGNAL_PREFIX = 'bitos://call-signal?';
	const MAX_CACHED_GROUPS = 60;
	const MAX_CACHED_GROUP_MESSAGES_PER_GROUP = 150;
	const MAX_PROCESSED_GROUP_CONTROLS = 1200;
	const GROUP_PERSIST_DEBOUNCE_MS = 250;

	let selected = $state('');
	let draft = $state('');
	let filter = $state<ChatFilter>('all');
	let query = $state('');
	let showNew = $state(false);
	let showDetails = $state(false);
	let newMode = $state<ChatKind>('dm');
	let newPeerInput = $state('');
	let newGroupName = $state('');
	let newGroupMembers = $state('');
	let memberInput = $state('');
	let activeCall = $state<CallKind | null>(null);
	let callState = $state<CallState>('idle');
	let callPeer = $state('');
	let callGroupId = $state('');
	let callTitle = $state('');
	let callId = $state('');
	let callError = $state('');
	let incomingCall = $state<CallSignal | null>(null);
	let micEnabled = $state(true);
	let cameraEnabled = $state(true);
	let showCall = $state(false);
	let groupsLoaded = $state(false);
	let processedGroupControlsLoaded = false;
	let lastResolvedTo = $state('');
	let lastAutoAnswerCallId = $state('');
	let uploadingMessage = $state(false);
	let messageAttachments = $state<MessageAttachment[]>([]);
	let messageFileInput = $state<HTMLInputElement | null>(null);
	let messageImageInput = $state<HTMLInputElement | null>(null);
	let callStartedAt = 0;
	let groupPersistTimer: ReturnType<typeof setTimeout> | null = null;
	let threadEl: HTMLDivElement | undefined = $state();
	let localVideoEl: HTMLVideoElement | undefined = $state();
	let remoteVideoEl: HTMLVideoElement | undefined = $state();
	let remoteAudioEl: HTMLAudioElement | undefined = $state();
	const processedGroupMessageIds = new Set<string>();
	const processedGroupControlIds = new Set<string>();
	const processedCallSignalIds = new Set<string>();
	const processedGroupCallLogIds = new Set<string>();
	const closedCallIds = new Set<string>();
	const removedGroupIds = new Set<string>();
	let localStream: MediaStream | null = null;
	let remoteStream: MediaStream | null = null;
	let remoteParticipants = $state<RemoteParticipant[]>([]);
	let peerConnection: RTCPeerConnection | null = null;
	const peerConnections = new Map<string, RTCPeerConnection>();
	const remoteStreamsByPeer = new Map<string, MediaStream>();
	const pendingIceCandidatesByPeer = new Map<string, RTCIceCandidateInit[]>();
	let pendingIceCandidates: RTCIceCandidateInit[] = [];

	let groupThreads = $state<GroupThread[]>([]);

	const groupRows = $derived<ChatRow[]>(
		groupThreads.map((group) => {
			const last = group.messages[group.messages.length - 1];
			return {
				key: `group:${group.id}`,
				id: group.id,
				kind: 'group',
				name: group.name,
				initials: group.initials,
				preview:
					last?.type === 'call'
						? last.meta
							? `${last.content} - ${last.meta}`
							: last.content
						: last?.type === 'voice'
							? 'Voice - 0:24'
							: messagePreview(last?.content),
				previewPrefix: last?.mine ? 'You:' : last ? `${last.author.split(' ')[0]}:` : '',
				time: last ? timeAgo(last.createdAt) : '',
				unread: group.unread,
				memberCount: group.members.length,
				onlineCount: group.members.filter(
					(member) =>
						member.status.toLowerCase().includes('online') ||
						member.status.toLowerCase().includes('active')
				).length
			};
		})
	);

	const dmRows = $derived<ChatRow[]>(
		dms.conversations
			.map((conversation) => {
				const profile = profiles.get(conversation.peer);
				const name = profile?.display_name || profile?.name || shortKey(conversation.peer);
				const visibleLastMessage = [...conversation.messages].reverse().find(isVisibleDmMessage);
				const invite = visibleLastMessage ? parseGroupInvite(visibleLastMessage.content) : null;
				const callSignal = visibleLastMessage ? parseCallSignal(visibleLastMessage.content) : null;
				return {
					key: conversation.peer,
					id: conversation.peer,
					kind: 'dm' as const,
					name,
					preview: invite
						? `Group invite: ${invite.name}`
						: callSignal
							? `${callSignal.kind === 'video' ? 'Video' : 'Voice'} call`
							: messagePreview(visibleLastMessage?.content),
					previewPrefix: visibleLastMessage?.mine ? 'You:' : '',
					time: visibleLastMessage ? timeAgo(visibleLastMessage.createdAt) : '',
					unread: visibleDmUnread(conversation)
				};
			})
			.filter(
				(row) =>
					row.preview !== 'No messages yet' ||
					selected === row.key ||
					dms.conversations.find((conversation) => conversation.peer === row.id)?.messages
						.length === 0
			)
	);

	const conversations = $derived<ChatRow[]>([...groupRows, ...dmRows]);
	const filtered = $derived(
		conversations.filter((conversation) => {
			if (filter === 'unread' && !conversation.unread) return false;
			if (filter === 'groups' && conversation.kind !== 'group') return false;
			if (!query) return true;
			const q = query.toLowerCase();
			return (
				conversation.name.toLowerCase().includes(q) ||
				conversation.preview.toLowerCase().includes(q) ||
				conversation.id.toLowerCase().includes(q)
			);
		})
	);
	const active = $derived(conversations.find((conversation) => conversation.key === selected));
	const activeGroup = $derived(
		active?.kind === 'group' ? groupThreads.find((group) => group.id === active.id) : undefined
	);
	const activeMessages = $derived(
		active?.kind === 'dm'
			? (dms.conversations.find((conversation) => conversation.peer === active.id)?.messages ?? [])
			: []
	);
	const visibleActiveMessages = $derived(activeMessages.filter(isVisibleDmMessage));
	const activeUploadProvider = $derived<MediaProviderId | 'none'>(resolveUploadProvider());
	const canSend = $derived(
		!!selected && !uploadingMessage && (!!draft.trim() || messageAttachments.length > 0)
	);
	const unreadTotal = $derived(
		dms.conversations.reduce((total, conversation) => total + visibleDmUnread(conversation), 0) +
			groupThreads.reduce((total, group) => total + group.unread, 0)
	);

	const groupsStorageKey = $derived(`${GROUPS_KEY_PREFIX}:${identity.current?.pk ?? 'anonymous'}`);
	const processedGroupControlsStorageKey = $derived(
		`${GROUP_CONTROL_PROCESSED_KEY_PREFIX}:${identity.current?.pk ?? 'anonymous'}`
	);

	function isExpiredCallOffer(createdAt: number) {
		return Math.floor(Date.now() / 1000) - createdAt > 90;
	}

	function markCallClosed(id?: string) {
		if (id) closedCallIds.add(id);
	}

	function initialsFor(name: string) {
		return name
			.split(/[\s_-]+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase())
			.join('');
	}

	function displayNameForPubkey(pubkey: string) {
		const profile = profiles.get(pubkey);
		return profile?.display_name || profile?.name || shortKey(pubkey);
	}

	function profileHref(pubkey?: string) {
		return pubkey ? `/profile/${pubkey}` : '';
	}

	function formatDuration(seconds = 0) {
		const safe = Math.max(0, Math.floor(seconds));
		const hours = Math.floor(safe / 3600);
		const minutes = Math.floor((safe % 3600) / 60);
		const secs = safe % 60;
		if (hours)
			return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
		return `${minutes}:${String(secs).padStart(2, '0')}`;
	}

	function parsePubkey(value: string): string | null {
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
		return /^[0-9a-fA-F]{64}$/.test(trimmed) ? trimmed.toLowerCase() : null;
	}

	function memberForPubkey(pubkey: string): GroupMember {
		const name = displayNameForPubkey(pubkey);
		profiles.ensure([pubkey]);
		return {
			name,
			initials: initialsFor(name) || 'NP',
			status: 'Invited',
			pubkey
		};
	}

	function groupInviteText(group: GroupThread) {
		const params = new URLSearchParams({
			id: group.id,
			name: group.name,
			from: identity.current?.pk ?? ''
		});
		return [
			`You were invited to "${group.name}" on BitOS.`,
			'Open BitOS Messages to accept this local group invite.',
			`${GROUP_INVITE_PREFIX}${params.toString()}`
		].join('\n\n');
	}

	function parseGroupInvite(content: string): GroupInvite | null {
		const line = content
			.split(/\s+/)
			.find(
				(part) =>
					part.startsWith(GROUP_INVITE_PREFIX) || part.startsWith(`nostr:${GROUP_INVITE_PREFIX}`)
			);
		if (!line) return null;
		const raw = line.startsWith('nostr:') ? line.slice('nostr:'.length) : line;
		try {
			const params = new URLSearchParams(raw.slice(GROUP_INVITE_PREFIX.length));
			const id = params.get('id')?.trim();
			const name = params.get('name')?.trim();
			const from = params.get('from')?.trim();
			if (!id || !name || !from || !/^[0-9a-fA-F]{64}$/.test(from)) return null;
			return { id, name, from: from.toLowerCase() };
		} catch {
			return null;
		}
	}

	function groupMessageText(group: GroupThread, body: string) {
		const params = new URLSearchParams({
			id: group.id,
			name: group.name,
			from: identity.current?.pk ?? '',
			body
		});
		return [
			`New message in "${group.name}" on BitOS.`,
			'Open BitOS Messages to sync this local group message.',
			`${GROUP_MESSAGE_PREFIX}${params.toString()}`
		].join('\n\n');
	}

	function parseGroupMessage(content: string): GroupMessagePayload | null {
		const line = content
			.split(/\s+/)
			.find(
				(part) =>
					part.startsWith(GROUP_MESSAGE_PREFIX) || part.startsWith(`nostr:${GROUP_MESSAGE_PREFIX}`)
			);
		if (!line) return null;
		const raw = line.startsWith('nostr:') ? line.slice('nostr:'.length) : line;
		try {
			const params = new URLSearchParams(raw.slice(GROUP_MESSAGE_PREFIX.length));
			const id = params.get('id')?.trim();
			const name = params.get('name')?.trim();
			const from = params.get('from')?.trim();
			const body = params.get('body')?.trim();
			if (!id || !name || !from || !body || !/^[0-9a-fA-F]{64}$/.test(from)) return null;
			return { id, name, from: from.toLowerCase(), body };
		} catch {
			return null;
		}
	}

	function groupControlText(group: GroupThread, type: GroupControlType, member: string) {
		const params = new URLSearchParams({
			id: group.id,
			name: group.name,
			from: identity.current?.pk ?? '',
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
					: `A member left "${group.name}" on BitOS.`;
		return [
			label,
			'Open BitOS Messages to sync this local group membership update.',
			`${GROUP_CONTROL_PREFIX}${params.toString()}`
		].join('\n\n');
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

	function isVisibleDmMessage(message: DirectMessage) {
		const groupMessage = parseGroupMessage(message.content);
		const control = parseGroupControl(message.content);
		const signal = parseCallSignal(message.content);
		return (
			!groupMessage && !control && (!signal || signal.type === 'offer' || signal.type === 'log')
		);
	}

	function visibleDmUnread(conversation: Conversation) {
		if (!conversation.unread) return 0;
		return conversation.messages
			.filter((message) => !message.mine)
			.slice(-conversation.unread)
			.filter(isVisibleDmMessage).length;
	}

	function resolveUploadProvider(): MediaProviderId | 'none' {
		const def = media.state.defaultProvider;
		if (def !== 'none' && media.isConfigured(def)) return def;
		return media.configured[0]?.id ?? 'none';
	}

	function firstUrl(content: string) {
		return content.match(/https?:\/\/[^\s<>)"']+/i)?.[0] ?? '';
	}

	function mediaKindFromUrl(url: string): MessageMedia['kind'] {
		const clean = url.split(/[?#]/)[0]?.toLowerCase() ?? url.toLowerCase();
		if (/\.(apng|avif|gif|jpe?g|png|svg|webp)$/.test(clean)) return 'image';
		if (/\.(m4v|mov|mp4|ogg|ogv|webm)$/.test(clean)) return 'video';
		return 'file';
	}

	function mediaFromMessage(content: string): MessageMedia | null {
		const markdownImage = content.match(/!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/i);
		const url = markdownImage?.[1] ?? firstUrl(content);
		if (!url) return null;
		return {
			url,
			text: content.replace(markdownImage?.[0] ?? url, '').trim(),
			kind: markdownImage ? 'image' : mediaKindFromUrl(url)
		};
	}

	function messagePreview(content?: string) {
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

	function attachmentLinks() {
		return messageAttachments
			.map((attachment) =>
				attachment.kind === 'image' ? `![${attachment.name}](${attachment.url})` : attachment.url
			)
			.join('\n');
	}

	function composedMessageBody() {
		const body = draft.trim();
		const links = attachmentLinks();
		return body && links ? `${body}\n\n${links}` : body || links;
	}

	function removeMessageAttachment(index: number) {
		messageAttachments = messageAttachments.filter((_, i) => i !== index);
	}

	async function handleMessageFiles(files: FileList | null) {
		if (!files?.length) return;
		const provider = activeUploadProvider;
		if (provider === 'none') {
			toasts.error('No upload provider. Add Cloudinary or S3 in Settings → Media & Uploads.');
			return;
		}
		uploadingMessage = true;
		let ok = 0;
		try {
			for (const file of Array.from(files)) {
				try {
					const uploaded = await media.upload(file, provider);
					messageAttachments = [...messageAttachments, { ...uploaded, name: file.name }];
					ok++;
				} catch (e) {
					toasts.error(`${file.name}: ${(e as Error).message}`);
				}
			}
			if (ok) {
				toasts.success(
					`Uploaded ${ok} ${ok === 1 ? 'file' : 'files'} via ${providerLabel(provider)}`
				);
			}
		} finally {
			uploadingMessage = false;
		}
	}

	function onMessageFileInput(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		void handleMessageFiles(input.files);
		input.value = '';
	}

	function callSignalText(signal: CallSignal) {
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
		return [
			`${signal.kind === 'video' ? 'Video' : 'Voice'} call signal on BitOS.`,
			'Open BitOS Messages to continue the call.',
			`${CALL_SIGNAL_PREFIX}${params.toString()}`
		].join('\n\n');
	}

	function parseCallSignal(content: string): CallSignal | null {
		const line = content
			.split(/\s+/)
			.find(
				(part) =>
					part.startsWith(CALL_SIGNAL_PREFIX) || part.startsWith(`nostr:${CALL_SIGNAL_PREFIX}`)
			);
		if (!line) return null;
		const raw = line.startsWith('nostr:') ? line.slice('nostr:'.length) : line;
		try {
			const params = new URLSearchParams(raw.slice(CALL_SIGNAL_PREFIX.length));
			const callIdValue = params.get('callId')?.trim();
			const type = params.get('type')?.trim() as CallSignalType | undefined;
			const kind = params.get('kind')?.trim() as CallKind | undefined;
			const from = params.get('from')?.trim();
			if (
				!callIdValue ||
				!type ||
				!['offer', 'answer', 'ice', 'end', 'log'].includes(type) ||
				!kind ||
				!['voice', 'video'].includes(kind) ||
				!from ||
				!/^[0-9a-fA-F]{64}$/.test(from)
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
				duration: Number(params.get('duration') ?? 0) || undefined
			};
		} catch {
			return null;
		}
	}

	function attachCallMedia() {
		if (localVideoEl) localVideoEl.srcObject = localStream;
		if (remoteVideoEl) remoteVideoEl.srcObject = remoteStream;
		if (remoteAudioEl) remoteAudioEl.srcObject = remoteStream;
	}

	function streamSource(node: HTMLMediaElement, stream: MediaStream | null) {
		node.srcObject = stream;
		return {
			update(next: MediaStream | null) {
				node.srcObject = next;
			},
			destroy() {
				node.srcObject = null;
			}
		};
	}

	function upsertRemoteParticipant(peer: string, stream: MediaStream) {
		const name = displayNameForPubkey(peer);
		remoteParticipants = [
			...remoteParticipants.filter((participant) => participant.peer !== peer),
			{ peer, name, stream }
		];
	}

	function callDisplayTitle() {
		if (callTitle) return callTitle;
		if (callGroupId) {
			const group = groupThreads.find((thread) => thread.id === callGroupId);
			return group?.name ?? 'Group call';
		}
		return callPeer ? displayNameForPubkey(callPeer) : active?.name;
	}

	function closePeerConnection() {
		peerConnection?.close();
		peerConnection = null;
		for (const pc of peerConnections.values()) pc.close();
		peerConnections.clear();
		remoteStreamsByPeer.clear();
		pendingIceCandidatesByPeer.clear();
		remoteParticipants = [];
	}

	function stopLocalMedia() {
		localStream?.getTracks().forEach((track) => track.stop());
		localStream = null;
	}

	function resetCallState() {
		closePeerConnection();
		stopLocalMedia();
		remoteStream = null;
		pendingIceCandidates = [];
		activeCall = null;
		callState = 'idle';
		callPeer = '';
		callGroupId = '';
		callTitle = '';
		callId = '';
		callError = '';
		callStartedAt = 0;
		incomingCall = null;
		micEnabled = true;
		cameraEnabled = true;
		showCall = false;
		attachCallMedia();
	}

	async function flushPendingIceCandidates(peer?: string) {
		const pc = peer ? peerConnections.get(peer) : peerConnection;
		if (!pc?.remoteDescription) return;
		const queued = peer ? (pendingIceCandidatesByPeer.get(peer) ?? []) : pendingIceCandidates;
		if (peer) pendingIceCandidatesByPeer.delete(peer);
		else pendingIceCandidates = [];
		for (const candidate of queued) {
			await pc.addIceCandidate(candidate);
		}
	}

	async function sendCallSignal(peer: string, signal: CallSignal) {
		await dms.send(peer, callSignalText(signal));
	}

	function mediaErrorMessage(error: unknown, kind: CallKind) {
		const err = error as DOMException;
		if (browser && window.isSecureContext === false) {
			return 'Calls need HTTPS or localhost before the browser allows microphone/camera access.';
		}
		if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
			return `Browser blocked ${kind === 'video' ? 'camera/microphone' : 'microphone'} access. Allow permission and try again.`;
		}
		if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
			return `No ${kind === 'video' ? 'camera/microphone' : 'microphone'} device was found.`;
		}
		if (err?.name === 'NotReadableError' || err?.name === 'TrackStartError') {
			return `${kind === 'video' ? 'Camera or microphone is' : 'Microphone is'} already in use by another app.`;
		}
		return err?.message || 'Could not start local media for the call.';
	}

	async function ensureLocalMedia(kind: CallKind) {
		if (!browser || !navigator.mediaDevices?.getUserMedia || window.isSecureContext === false) {
			throw new Error('Media devices are not available in this browser');
		}
		if (!localStream) {
			localStream = await navigator.mediaDevices.getUserMedia({
				audio: true,
				video: kind === 'video'
			});
		} else if (kind === 'video' && !localStream.getVideoTracks().length) {
			const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
			const [videoTrack] = videoStream.getVideoTracks();
			if (videoTrack) localStream.addTrack(videoTrack);
		}
		localStream.getAudioTracks().forEach((track) => (track.enabled = micEnabled));
		localStream.getVideoTracks().forEach((track) => (track.enabled = cameraEnabled));
		attachCallMedia();
		return localStream;
	}

	async function createPeerConnection(
		peer: string,
		id: string,
		kind: CallKind,
		options: { groupId?: string; multi?: boolean } = {}
	) {
		if (options.multi) {
			peerConnections.get(peer)?.close();
		} else {
			closePeerConnection();
			remoteStream = new MediaStream();
		}
		const pc = new RTCPeerConnection({
			iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
		});
		if (options.multi) peerConnections.set(peer, pc);
		else peerConnection = pc;
		pc.onicecandidate = (event) => {
			if (!event.candidate || !identity.current) return;
			void sendCallSignal(peer, {
				callId: id,
				type: 'ice',
				kind,
				from: identity.current.pk,
				groupId: options.groupId,
				candidate: JSON.stringify(event.candidate.toJSON())
			});
		};
		pc.ontrack = (event) => {
			const targetStream = options.multi
				? (remoteStreamsByPeer.get(peer) ?? new MediaStream())
				: (remoteStream ?? new MediaStream());
			for (const track of event.streams[0]?.getTracks() ?? [event.track]) {
				if (!targetStream.getTracks().some((existing) => existing.id === track.id)) {
					targetStream.addTrack(track);
				}
			}
			if (options.multi) {
				remoteStreamsByPeer.set(peer, targetStream);
				upsertRemoteParticipant(peer, targetStream);
			} else {
				remoteStream = targetStream;
			}
			callState = 'connected';
			attachCallMedia();
		};
		pc.onconnectionstatechange = () => {
			if (pc.connectionState === 'connected') callState = 'connected';
			if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
				callError = 'Call connection was interrupted';
			}
		};
		const stream = await ensureLocalMedia(kind);
		for (const track of stream.getTracks()) pc.addTrack(track, stream);
		attachCallMedia();
		return pc;
	}

	function toggleMic() {
		micEnabled = !micEnabled;
		localStream?.getAudioTracks().forEach((track) => (track.enabled = micEnabled));
	}

	async function ensureVideoTrackInCall() {
		if (!peerConnection && !peerConnections.size) return;
		const before = new Set(localStream?.getVideoTracks().map((track) => track.id) ?? []);
		const stream = await ensureLocalMedia('video');
		for (const track of stream.getVideoTracks()) {
			if (!before.has(track.id)) {
				peerConnection?.addTrack(track, stream);
				for (const pc of peerConnections.values()) pc.addTrack(track, stream);
			}
		}
	}

	async function switchToVideo() {
		const me = identity.current;
		if (!me || (!peerConnection && !peerConnections.size) || (!callPeer && !callGroupId) || !callId)
			return;
		try {
			await ensureVideoTrackInCall();
			activeCall = 'video';
			cameraEnabled = true;
			localStream?.getVideoTracks().forEach((track) => (track.enabled = true));
			const targets =
				peerConnections.size > 0
					? [...peerConnections.entries()]
					: callPeer && peerConnection
						? [[callPeer, peerConnection] as [string, RTCPeerConnection]]
						: [];
			await Promise.all(
				targets.map(async ([peer, pc]) => {
					const offer = await pc.createOffer();
					await pc.setLocalDescription(offer);
					await sendCallSignal(peer, {
						callId,
						type: 'offer',
						kind: 'video',
						from: me.pk,
						groupId: callGroupId || undefined,
						sdp: offer.sdp
					});
				})
			);
		} catch (e) {
			callError = mediaErrorMessage(e, 'video');
			toasts.error(callError);
		}
	}

	async function toggleCamera() {
		try {
			if (activeCall !== 'video') {
				await switchToVideo();
				return;
			}
			if (!localStream?.getVideoTracks().length) await ensureVideoTrackInCall();
			cameraEnabled = !cameraEnabled;
			localStream?.getVideoTracks().forEach((track) => (track.enabled = cameraEnabled));
		} catch (e) {
			callError = mediaErrorMessage(e, 'video');
			toasts.error(callError);
		}
	}

	function isGroupThread(value: unknown): value is GroupThread {
		if (!value || typeof value !== 'object') return false;
		const group = value as Partial<GroupThread>;
		return (
			typeof group.id === 'string' &&
			typeof group.name === 'string' &&
			typeof group.initials === 'string' &&
			Array.isArray(group.members) &&
			Array.isArray(group.messages) &&
			Array.isArray(group.files)
		);
	}

	function dedupeGroupMessages(messages: GroupMessage[]) {
		const seen = new Set<string>();
		return messages.filter((message) => {
			if (seen.has(message.id)) return false;
			seen.add(message.id);
			return true;
		});
	}

	function trimGroupMessages(messages: GroupMessage[]) {
		return dedupeGroupMessages(messages).slice(-MAX_CACHED_GROUP_MESSAGES_PER_GROUP);
	}

	function groupCacheSnapshot() {
		return groupThreads.slice(0, MAX_CACHED_GROUPS).map((group) => ({
			...group,
			messages: trimGroupMessages(group.messages)
		}));
	}

	function normalizeGroupAdminState(group: GroupThread) {
		if (!group.description.startsWith('Accepted from')) return group;
		const members = group.members.map((member, index) => ({
			...member,
			admin: index === 0 && member.name === 'You' && !member.pubkey ? false : member.admin
		}));
		const inviterIndex = members.findIndex((member) => member.pubkey);
		if (inviterIndex >= 0) members[inviterIndex] = { ...members[inviterIndex], admin: true };
		return { ...group, members };
	}

	function loadGroups() {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(groupsStorageKey);
			if (!raw) return;
			const parsed = JSON.parse(raw) as unknown;
			if (Array.isArray(parsed)) {
				groupThreads = parsed
					.filter(isGroupThread)
					.slice(0, MAX_CACHED_GROUPS)
					.map((group) =>
						normalizeGroupAdminState({ ...group, messages: trimGroupMessages(group.messages) })
					);
			}
		} catch {
			toasts.warning('Saved groups could not be loaded');
		}
	}

	function saveGroups() {
		if (!browser || !groupsLoaded) return;
		if (groupPersistTimer) return;
		groupPersistTimer = setTimeout(() => {
			groupPersistTimer = null;
			localStorage.setItem(groupsStorageKey, JSON.stringify(groupCacheSnapshot()));
		}, GROUP_PERSIST_DEBOUNCE_MS);
	}

	function loadProcessedGroupControls() {
		if (!browser || processedGroupControlsLoaded) return;
		processedGroupControlsLoaded = true;
		try {
			const raw = localStorage.getItem(processedGroupControlsStorageKey);
			if (!raw) return;
			const ids = JSON.parse(raw) as unknown;
			if (Array.isArray(ids)) {
				for (const id of ids) {
					if (typeof id === 'string') processedGroupControlIds.add(id);
				}
			}
		} catch {
			processedGroupControlIds.clear();
		}
	}

	function rememberProcessedGroupControl(id: string) {
		processedGroupControlIds.add(id);
		if (!browser) return;
		localStorage.setItem(
			processedGroupControlsStorageKey,
			JSON.stringify([...processedGroupControlIds].slice(-MAX_PROCESSED_GROUP_CONTROLS))
		);
	}

	function isFreshGroupControl(createdAt: number) {
		return Math.floor(Date.now() / 1000) - createdAt <= 120;
	}

	function resolveTo(param: string | null) {
		const raw = param?.trim() ?? '';
		if (!raw) return;
		let peer = raw;
		if (peer.startsWith('npub1')) {
			try {
				const decoded = decode(peer);
				if (decoded.type === 'npub') peer = decoded.data as string;
			} catch {
				return;
			}
		}
		if (/^[0-9a-fA-F]{64}$/.test(peer)) {
			peer = peer.toLowerCase();
			if (peer === lastResolvedTo) return;
			lastResolvedTo = peer;
			dms.forPeer(peer);
			profiles.ensure([peer]);
			if (selected !== peer) selectChat(peer);
		}
	}

	function resolveAutoAnswer(answerId: string | null) {
		const id = answerId?.trim() ?? '';
		if (!id || id === lastAutoAnswerCallId || closedCallIds.has(id)) return;
		for (const conversation of dms.conversations) {
			for (const message of conversation.messages) {
				if (message.mine || isExpiredCallOffer(message.createdAt)) continue;
				const signal = parseCallSignal(message.content);
				if (!signal || signal.type !== 'offer' || signal.callId !== id || !signal.sdp) continue;
				lastAutoAnswerCallId = id;
				if (selected !== signal.from) selectChat(signal.from);
				void acceptIncomingCall(signal);
				return;
			}
		}
	}

	function selectChat(key: string) {
		if (selected === key) return;
		selected = key;
		if (key.startsWith('group:')) {
			const group = groupThreads.find((thread) => `group:${thread.id}` === key);
			if (group) group.unread = 0;
			return;
		}
		dms.markRead(key);
	}

	function addGroupMessageById(groupId: string, message: Omit<GroupMessage, 'id' | 'createdAt'>) {
		const createdAt = Math.floor(Date.now() / 1000);
		groupThreads = groupThreads.map((group) =>
			group.id === groupId
				? {
						...group,
						messages: [
							...group.messages,
							{ ...message, id: `${group.id}-${Date.now()}`, createdAt }
						]
					}
				: group
		);
	}

	function addGroupSystemMessage(groupId: string, content: string) {
		addGroupMessageById(groupId, {
			author: 'BitOS',
			initials: 'BI',
			content,
			type: 'text'
		});
	}

	function appendIncomingGroupMessage(
		dmId: string,
		payload: GroupMessagePayload,
		createdAt: number
	) {
		const group = groupThreads.find((thread) => thread.id === payload.id);
		if (!group || group.messages.some((message) => message.id === `dm:${dmId}`)) return false;
		const author = displayNameForPubkey(payload.from);
		groupThreads = groupThreads.map((thread) =>
			thread.id === payload.id
				? {
						...thread,
						messages: [
							...thread.messages,
							{
								id: `dm:${dmId}`,
								author,
								initials: initialsFor(author) || 'NP',
								pubkey: payload.from,
								content: payload.body,
								createdAt,
								mine: false
							}
						]
					}
				: thread
		);
		return true;
	}

	function parseMembers(value: string): GroupMember[] {
		return value
			.split(',')
			.map((member) => member.trim())
			.filter(Boolean)
			.map<GroupMember>((member) => {
				const pubkey = parsePubkey(member);
				if (pubkey) return memberForPubkey(pubkey);
				return {
					name: member,
					initials: initialsFor(member) || 'MB',
					status: 'Invited'
				};
			});
	}

	function memberKey(member: GroupMember) {
		return member.pubkey ? `pubkey:${member.pubkey}` : `name:${member.name.toLowerCase()}`;
	}

	function isSameMember(a: GroupMember, b: GroupMember) {
		if (a.pubkey && b.pubkey) return a.pubkey === b.pubkey;
		return a.name.toLowerCase() === b.name.toLowerCase();
	}

	function groupHasPubkey(group: GroupThread, pubkey: string) {
		return group.members.some((member) => member.pubkey === pubkey);
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

	function currentUserIsGroupAdmin(group: GroupThread) {
		const me = identity.current?.pk;
		return group.members.some(
			(member) =>
				member.admin && (member.pubkey === me || (!member.pubkey && member.name === 'You'))
		);
	}

	async function sendGroupInvite(group: GroupThread, member: GroupMember) {
		if (!member.pubkey || member.pubkey === identity.current?.pk) return;
		await dms.send(member.pubkey, groupInviteText(group));
	}

	async function notifyMembers(group: GroupThread, members: GroupMember[]) {
		const pubkeyMembers = members.filter((member) => member.pubkey);
		if (!pubkeyMembers.length) return;
		const results = await Promise.allSettled(
			pubkeyMembers.map((member) => sendGroupInvite(group, member))
		);
		const failed = results.filter((result) => result.status === 'rejected').length;
		if (failed) {
			toasts.warning(`${failed} group invite DM${failed === 1 ? '' : 's'} could not be sent`);
		} else {
			toasts.success(
				`Sent ${pubkeyMembers.length} group invite DM${pubkeyMembers.length === 1 ? '' : 's'}`
			);
		}
	}

	async function broadcastGroupMessage(group: GroupThread, body: string) {
		const recipients = group.members
			.map((member) => member.pubkey)
			.filter((pubkey): pubkey is string => !!pubkey && pubkey !== identity.current?.pk);
		if (!recipients.length) return;
		const content = groupMessageText(group, body);
		const results = await Promise.allSettled(recipients.map((pubkey) => dms.send(pubkey, content)));
		const failed = results.filter((result) => result.status === 'rejected').length;
		if (failed) {
			toasts.warning(`${failed} group message DM${failed === 1 ? '' : 's'} could not be sent`);
		}
	}

	async function broadcastGroupControl(
		group: GroupThread,
		type: GroupControlType,
		member: string,
		extraRecipients: string[] = []
	) {
		const recipients = [
			...new Set([
				...group.members
					.map((item) => item.pubkey)
					.filter((pubkey): pubkey is string => !!pubkey && pubkey !== identity.current?.pk),
				...extraRecipients.filter((pubkey) => pubkey !== identity.current?.pk)
			])
		];
		if (!recipients.length) return;
		const content = groupControlText(group, type, member);
		const results = await Promise.allSettled(recipients.map((pubkey) => dms.send(pubkey, content)));
		const failed = results.filter((result) => result.status === 'rejected').length;
		if (failed) {
			toasts.warning(`${failed} membership update DM${failed === 1 ? '' : 's'} could not be sent`);
		}
	}

	async function addMembersToGroup(groupId: string) {
		const members = parseMembers(memberInput);
		if (!members.length) {
			toasts.error('Enter at least one member name');
			return;
		}
		let added: GroupMember[] = [];
		let updatedGroup: GroupThread | undefined;
		groupThreads = groupThreads.map((group) => {
			if (group.id !== groupId) return group;
			const nextMembers = members.filter(
				(member) => !group.members.some((existing) => isSameMember(existing, member))
			);
			added = nextMembers;
			updatedGroup = { ...group, members: [...group.members, ...nextMembers] };
			return updatedGroup;
		});
		memberInput = '';
		if (!added.length) {
			toasts.info('Those members are already in the group');
			return;
		}
		if (updatedGroup) {
			await notifyMembers(updatedGroup, added);
			const pubkeyMembers = added.filter((member) => member.pubkey);
			for (const member of pubkeyMembers) {
				await broadcastGroupControl(updatedGroup, 'add-member', member.pubkey!, [member.pubkey!]);
			}
		}
	}

	async function addDmPeerToGroup(groupId: string, pubkey: string) {
		const member = memberForPubkey(pubkey);
		let added = false;
		let updatedGroup: GroupThread | undefined;
		groupThreads = groupThreads.map((group) => {
			if (
				group.id !== groupId ||
				group.members.some((existing) => isSameMember(existing, member))
			) {
				return group;
			}
			added = true;
			updatedGroup = { ...group, members: [...group.members, member] };
			return updatedGroup;
		});
		if (!added) {
			toasts.info('That contact is already in the group');
			return;
		}
		if (updatedGroup) {
			await notifyMembers(updatedGroup, [member]);
			if (member.pubkey) {
				await broadcastGroupControl(updatedGroup, 'add-member', member.pubkey, [member.pubkey]);
			}
		}
	}

	async function removeMemberFromGroup(groupId: string, memberName: string) {
		let removed: GroupMember | undefined;
		const originalGroup = groupThreads.find((group) => group.id === groupId);
		if (!originalGroup || !currentUserIsGroupAdmin(originalGroup)) {
			toasts.error('Only group admins can remove members');
			return;
		}
		groupThreads = groupThreads.map((group) =>
			group.id === groupId
				? {
						...group,
						members: group.members.filter((member) => {
							const keep = memberKey(member) !== memberName || member.admin;
							if (!keep) removed = member;
							return keep;
						})
					}
				: group
		);
		if (!removed) return;
		addGroupSystemMessage(groupId, `${removed.name} was removed from the group`);
		if (removed.pubkey && originalGroup) {
			await broadcastGroupControl(originalGroup, 'remove-member', removed.pubkey, [removed.pubkey]);
		}
	}

	async function leaveGroup(groupId: string) {
		const me = identity.current;
		const group = groupThreads.find((thread) => thread.id === groupId);
		if (!me || !group) return;
		if (browser && !window.confirm(`Leave "${group.name}"?`)) return;
		await broadcastGroupControl(group, 'leave-group', me.pk);
		removedGroupIds.add(groupId);
		groupThreads = groupThreads.filter((thread) => thread.id !== groupId);
		if (selected === `group:${groupId}`) selected = '';
		showDetails = false;
		toasts.info(`Left ${group.name}`);
	}

	function applyGroupControl(payload: GroupControlPayload, options: { notify?: boolean } = {}) {
		const notify = options.notify ?? true;
		const me = identity.current?.pk;
		const group = groupThreads.find((thread) => thread.id === payload.id);
		const memberName = displayNameForPubkey(payload.member);
		if (!group) {
			if (
				payload.type === 'add-member' &&
				me &&
				(payload.member === me || payload.members?.includes(me))
			) {
				const members: GroupMember[] = membersFromControlSnapshot(payload).map((member) =>
					member.pubkey === me
						? { ...member, name: 'You', initials: 'YO', status: 'Online' }
						: member
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
					unread: 0,
					members,
					messages: [],
					files: []
				};
				removedGroupIds.delete(payload.id);
				groupThreads = [restoredGroup, ...groupThreads];
				if (notify) toasts.success(`Re-added to ${payload.name}`);
				return true;
			}
			return false;
		}
		if (payload.type === 'add-member') {
			const alreadyHasMember = group.members.some(
				(member) =>
					member.pubkey === payload.member ||
					(payload.member === me && !member.pubkey && member.name === 'You')
			);
			if (alreadyHasMember) {
				groupThreads = groupThreads.map((thread) =>
					thread.id === payload.id
						? { ...thread, members: mergeControlMembers(thread, payload) }
						: thread
				);
				return true;
			}
			const member = memberForPubkey(payload.member);
			groupThreads = groupThreads.map((thread) =>
				thread.id === payload.id
					? {
							...thread,
							members: mergeControlMembers(
								{ ...thread, members: [...thread.members, member] },
								payload
							),
							messages: [
								...thread.messages,
								{
									id: `control:${payload.type}:${payload.id}:${payload.member}:${Date.now()}`,
									author: 'BitOS',
									initials: 'BI',
									content: `${memberName} joined the group`,
									createdAt: Math.floor(Date.now() / 1000),
									type: 'text'
								}
							]
						}
					: thread
			);
			return true;
		}
		if (payload.type === 'remove-member' && payload.member === me) {
			removedGroupIds.add(payload.id);
			groupThreads = groupThreads.filter((thread) => thread.id !== payload.id);
			if (selected === `group:${payload.id}`) selected = '';
			showDetails = false;
			if (notify) toasts.info(`You were removed from ${payload.name}`);
			return true;
		}
		groupThreads = groupThreads.map((thread) =>
			thread.id === payload.id
				? {
						...thread,
						members: thread.members.filter((member) => member.pubkey !== payload.member),
						messages: [
							...thread.messages,
							{
								id: `control:${payload.type}:${payload.id}:${payload.member}:${Date.now()}`,
								author: 'BitOS',
								initials: 'BI',
								content:
									payload.type === 'leave-group'
										? `${memberName} left the group`
										: `${memberName} was removed from the group`,
								createdAt: Math.floor(Date.now() / 1000),
								type: 'text'
							}
						]
					}
				: thread
		);
		return true;
	}

	function deleteGroup(groupId: string) {
		if (browser && !window.confirm('Delete this local group and its messages?')) return;
		removedGroupIds.add(groupId);
		groupThreads = groupThreads.filter((group) => group.id !== groupId);
		if (selected === `group:${groupId}`) selected = '';
		showDetails = false;
	}

	function acceptGroupInvite(invite: GroupInvite) {
		if (groupThreads.some((group) => group.id === invite.id)) {
			toasts.info('Group already added');
			return;
		}
		removedGroupIds.delete(invite.id);
		const inviter = memberForPubkey(invite.from);
		const createdGroup: GroupThread = {
			id: invite.id,
			name: invite.name,
			initials: initialsFor(invite.name) || 'GC',
			description: 'Accepted from a local DM invite. Group relay sync is not enabled yet.',
			pinned: 'No pinned message yet',
			unread: 0,
			members: [
				{ name: 'You', initials: 'YO', status: 'Online' },
				{ ...inviter, admin: true }
			],
			messages: [],
			files: []
		};
		groupThreads = [createdGroup, ...groupThreads];
		selectChat(`group:${invite.id}`);
		toasts.success(`Added ${invite.name}`);
	}

	async function send() {
		const body = composedMessageBody();
		if (!body || !selected || uploadingMessage) return;
		draft = '';
		messageAttachments = [];
		if (selected.startsWith('group:')) {
			const groupId = selected.slice('group:'.length);
			const group = groupThreads.find((thread) => thread.id === groupId);
			addGroupMessageById(groupId, {
				author: 'You',
				initials: 'YO',
				content: body,
				mine: true
			});
			if (group) await broadcastGroupMessage(group, body);
			return;
		}
		try {
			await dms.send(selected, body);
		} catch (e) {
			toasts.error((e as Error).message);
		}
	}

	function groupCallRecipients(group: GroupThread) {
		return [
			...new Set(
				group.members
					.map((member) => member.pubkey)
					.filter((pubkey): pubkey is string => !!pubkey && pubkey !== identity.current?.pk)
			)
		];
	}

	function addGroupCallMessage(
		groupId: string,
		kind: CallKind,
		status: 'started' | 'ended' | 'missed',
		duration?: number
	) {
		const label = `${kind === 'video' ? 'Video' : 'Voice'} call`;
		addGroupMessageById(groupId, {
			author: 'You',
			initials: 'YO',
			content:
				status === 'started'
					? `${label} started`
					: status === 'missed'
						? `${label} missed`
						: `${label} ended`,
			mine: true,
			type: 'call',
			meta: status === 'ended' ? formatDuration(duration) : undefined
		});
	}

	function appendIncomingGroupCallLog(
		signal: CallSignal,
		createdAt = Math.floor(Date.now() / 1000)
	) {
		if (!signal.groupId || signal.type !== 'log') return false;
		const group = groupThreads.find((thread) => thread.id === signal.groupId);
		if (!group) return false;
		const key = `${signal.groupId}:${signal.callId}:${signal.from}`;
		const messageId = `call:${key}`;
		if (
			processedGroupCallLogIds.has(key) ||
			group.messages.some((message) => message.id === messageId)
		) {
			return false;
		}
		processedGroupCallLogIds.add(key);
		const author = displayNameForPubkey(signal.from);
		const label = `${signal.kind === 'video' ? 'Video' : 'Voice'} call ended`;
		groupThreads = groupThreads.map((thread) =>
			thread.id === signal.groupId
				? {
						...thread,
						unread: selected === `group:${thread.id}` ? thread.unread : thread.unread + 1,
						messages: [
							...thread.messages,
							{
								id: messageId,
								author,
								initials: initialsFor(author) || 'NP',
								pubkey: signal.from,
								content: label,
								createdAt,
								mine: false,
								type: 'call',
								meta: formatDuration(signal.duration)
							}
						]
					}
				: thread
		);
		return true;
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			void send();
		}
	}

	async function sendGroupCallOffers(kind: CallKind, group: GroupThread, recipients: string[]) {
		const me = identity.current;
		if (!me) throw new Error('No identity');
		await ensureLocalMedia(kind);
		const results = await Promise.allSettled(
			recipients.map(async (peer) => {
				const pc = await createPeerConnection(peer, callId, kind, {
					groupId: group.id,
					multi: true
				});
				const offer = await pc.createOffer();
				await pc.setLocalDescription(offer);
				await sendCallSignal(peer, {
					callId,
					type: 'offer',
					kind,
					from: me.pk,
					groupId: group.id,
					sdp: offer.sdp
				});
			})
		);
		const failed = results.filter((result) => result.status === 'rejected').length;
		if (failed) {
			toasts.warning(`${failed} group call invite${failed === 1 ? '' : 's'} could not be sent`);
		}
		return recipients.length - failed;
	}

	async function startGroupCall(kind: CallKind, group: GroupThread) {
		const me = identity.current;
		if (!me) {
			toasts.error('No identity');
			return;
		}
		const recipients = groupCallRecipients(group);
		if (!recipients.length) {
			toasts.info('Add group members with npub/pubkey before starting a group call.');
			return;
		}
		try {
			closePeerConnection();
			remoteStream = null;
			pendingIceCandidates = [];
			activeCall = kind;
			callPeer = '';
			callGroupId = group.id;
			callTitle = group.name;
			callId = `${me.pk.slice(0, 10)}-${Date.now()}`;
			callState = 'outgoing';
			callStartedAt = Math.floor(Date.now() / 1000);
			callError = '';
			showCall = true;
			await ensureLocalMedia(kind);
			addGroupCallMessage(group.id, kind, 'started');
			await sendGroupCallOffers(kind, group, recipients);
		} catch (e) {
			callError = mediaErrorMessage(e, kind);
			toasts.error(callError);
		}
	}

	async function inviteGroupMembersToActiveCall() {
		const kind = activeCall;
		const group = groupThreads.find((thread) => thread.id === callGroupId);
		if (!kind || !group || !callId) return;
		const connected = new Set(remoteParticipants.map((participant) => participant.peer));
		const recipients = groupCallRecipients(group).filter((peer) => !connected.has(peer));
		if (!recipients.length) {
			toasts.info('All pubkey members already have an active call invite.');
			return;
		}
		try {
			const sent = await sendGroupCallOffers(kind, group, recipients);
			if (sent) toasts.success(`Sent call invite to ${sent} member${sent === 1 ? '' : 's'}`);
		} catch (e) {
			callError = mediaErrorMessage(e, kind);
			toasts.error(callError);
		}
	}

	async function startCall(kind: CallKind) {
		if (active?.kind === 'group' && activeGroup) {
			await startGroupCall(kind, activeGroup);
			return;
		}
		if (!active || active.kind !== 'dm') {
			toasts.info('Select a chat before starting a call.');
			return;
		}
		const me = identity.current;
		if (!me) {
			toasts.error('No identity');
			return;
		}
		try {
			activeCall = kind;
			callPeer = active.id;
			callGroupId = '';
			callTitle = '';
			callId = `${me.pk.slice(0, 10)}-${Date.now()}`;
			callState = 'outgoing';
			callStartedAt = Math.floor(Date.now() / 1000);
			callError = '';
			showCall = true;
			const pc = await createPeerConnection(callPeer, callId, kind);
			const offer = await pc.createOffer();
			await pc.setLocalDescription(offer);
			await sendCallSignal(callPeer, {
				callId,
				type: 'offer',
				kind,
				from: me.pk,
				sdp: offer.sdp
			});
		} catch (e) {
			callError = mediaErrorMessage(e, kind);
			toasts.error(callError);
		}
	}

	async function acceptIncomingCall(call = incomingCall) {
		const signal = call;
		const me = identity.current;
		if (!signal?.sdp || !me) return;
		try {
			activeCall = signal.kind;
			callPeer = signal.from;
			callGroupId = signal.groupId ?? '';
			callTitle = signal.groupId
				? (groupThreads.find((thread) => thread.id === signal.groupId)?.name ?? 'Group call')
				: '';
			callId = signal.callId;
			callState = 'connecting';
			callStartedAt = Math.floor(Date.now() / 1000);
			callError = '';
			showCall = true;
			const pc = await createPeerConnection(signal.from, signal.callId, signal.kind);
			await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
			await flushPendingIceCandidates();
			const answer = await pc.createAnswer();
			await pc.setLocalDescription(answer);
			await sendCallSignal(signal.from, {
				callId: signal.callId,
				type: 'answer',
				kind: signal.kind,
				from: me.pk,
				groupId: signal.groupId,
				sdp: answer.sdp
			});
			incomingCall = null;
		} catch (e) {
			callError = mediaErrorMessage(e, signal.kind);
			toasts.error(callError);
		}
	}

	async function endCall(notify = true) {
		const peers = [
			...new Set([...peerConnections.keys(), callPeer].filter((peer): peer is string => !!peer))
		];
		const kind = activeCall;
		const id = callId;
		const groupId = callGroupId || undefined;
		const me = identity.current;
		const duration = callStartedAt ? Math.max(0, Math.floor(Date.now() / 1000) - callStartedAt) : 0;
		markCallClosed(id);
		if (notify && groupId && kind) addGroupCallMessage(groupId, kind, 'ended', duration);
		if (notify && peers.length && kind && me) {
			try {
				await Promise.allSettled(
					peers.flatMap((peer) => [
						sendCallSignal(peer, {
							callId: id,
							type: 'end',
							kind,
							from: me.pk,
							groupId
						}),
						sendCallSignal(peer, {
							callId: id,
							type: 'log',
							kind,
							from: me.pk,
							groupId,
							duration
						})
					])
				);
			} catch {
				/* Call teardown should not be blocked by signaling failure. */
			}
		}
		resetCallState();
	}

	async function handleCallSignal(signal: CallSignal, createdAt?: number) {
		if (signal.from === identity.current?.pk) return;
		if (signal.type === 'end' || signal.type === 'log') markCallClosed(signal.callId);
		if (signal.type === 'log' && signal.groupId) {
			appendIncomingGroupCallLog(signal, createdAt);
			if (signal.callId !== callId) return;
		}
		if (signal.type === 'offer') {
			if (closedCallIds.has(signal.callId)) return;
			if (!signal.sdp) return;
			const mappedGroupPc =
				signal.groupId && signal.callId === callId ? peerConnections.get(signal.from) : null;
			if (mappedGroupPc) {
				activeCall = signal.kind;
				callGroupId = signal.groupId ?? '';
				callTitle =
					groupThreads.find((thread) => thread.id === signal.groupId)?.name ??
					callTitle ??
					'Group call';
				await mappedGroupPc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
				await flushPendingIceCandidates(signal.from);
				const answer = await mappedGroupPc.createAnswer();
				await mappedGroupPc.setLocalDescription(answer);
				if (identity.current) {
					await sendCallSignal(signal.from, {
						callId: signal.callId,
						type: 'answer',
						kind: signal.kind,
						from: identity.current.pk,
						groupId: signal.groupId,
						sdp: answer.sdp
					});
				}
				return;
			}
			if (peerConnection && signal.callId === callId && signal.from === callPeer) {
				activeCall = signal.kind;
				callGroupId = signal.groupId ?? '';
				callTitle = signal.groupId
					? (groupThreads.find((thread) => thread.id === signal.groupId)?.name ?? 'Group call')
					: '';
				await peerConnection.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
				await flushPendingIceCandidates();
				const answer = await peerConnection.createAnswer();
				await peerConnection.setLocalDescription(answer);
				if (identity.current) {
					await sendCallSignal(signal.from, {
						callId: signal.callId,
						type: 'answer',
						kind: signal.kind,
						from: identity.current.pk,
						groupId: signal.groupId,
						sdp: answer.sdp
					});
				}
				return;
			}
			incomingCall = signal;
			activeCall = signal.kind;
			callPeer = signal.from;
			callGroupId = signal.groupId ?? '';
			callTitle = signal.groupId
				? (groupThreads.find((thread) => thread.id === signal.groupId)?.name ?? 'Group call')
				: '';
			callId = signal.callId;
			callState = 'incoming';
			callError = '';
			showCall = true;
			return;
		}
		if (signal.callId !== callId) return;
		const groupPeerConnection = signal.groupId
			? (peerConnections.get(signal.from) ?? (signal.from === callPeer ? peerConnection : null))
			: null;
		const pc = signal.groupId ? groupPeerConnection : peerConnection;
		const isMappedGroupPeer = signal.groupId ? peerConnections.has(signal.from) : false;
		const isExpectedPeer = signal.groupId ? !!pc : signal.from === callPeer;
		if (!isExpectedPeer) return;
		if (signal.type === 'answer' && signal.sdp && pc) {
			await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
			await flushPendingIceCandidates(isMappedGroupPeer ? signal.from : undefined);
			callState = 'connecting';
			return;
		}
		if (signal.type === 'ice' && signal.candidate) {
			const candidate = JSON.parse(signal.candidate) as RTCIceCandidateInit;
			if (pc?.remoteDescription) {
				await pc.addIceCandidate(candidate);
			} else if (isMappedGroupPeer) {
				pendingIceCandidatesByPeer.set(signal.from, [
					...(pendingIceCandidatesByPeer.get(signal.from) ?? []),
					candidate
				]);
			} else {
				pendingIceCandidates = [...pendingIceCandidates, candidate];
			}
			return;
		}
		if (signal.type === 'end') {
			toasts.info('Call ended');
			await endCall(false);
			return;
		}
		if (signal.type === 'log') {
			if (signal.callId === callId && signal.from === callPeer) await endCall(false);
		}
	}

	function attachFile(type: 'file' | 'image') {
		if (!selected) {
			toasts.info('Select a chat before attaching a file.');
			return;
		}
		if (activeUploadProvider === 'none') {
			toasts.info('Add Cloudinary or S3 in Settings → Media & Uploads before attaching files.');
			return;
		}
		if (type === 'image') messageImageInput?.click();
		else messageFileInput?.click();
	}

	function addEmoji() {
		draft += ' :)';
	}

	async function startNew() {
		if (newMode === 'group') {
			const name = newGroupName.trim();
			if (!name) {
				toasts.error('Enter a group name');
				return;
			}
			const members = parseMembers(newGroupMembers);
			const id = `${name
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-|-$/g, '')}-${Date.now()}`;
			const createdGroup: GroupThread = {
				id,
				name,
				initials: initialsFor(name) || 'GC',
				description: 'A local group thread ready for a Nostr group protocol integration.',
				pinned: 'No pinned message yet',
				unread: 0,
				members: [{ name: 'You', initials: 'YO', status: 'Online', admin: true }, ...members],
				messages: [],
				files: []
			};
			groupThreads = [createdGroup, ...groupThreads];
			selectChat(`group:${id}`);
			showNew = false;
			newGroupName = '';
			newGroupMembers = '';
			await notifyMembers(createdGroup, members);
			for (const member of members.filter((item) => item.pubkey)) {
				await broadcastGroupControl(createdGroup, 'add-member', member.pubkey!, [member.pubkey!]);
			}
			return;
		}

		const input = newPeerInput.trim();
		if (!input) return;
		let peer = input;
		if (peer.startsWith('npub1')) {
			try {
				const decoded = decode(peer);
				if (decoded.type === 'npub') peer = decoded.data as string;
			} catch {
				toasts.error('Invalid npub');
				return;
			}
		}
		if (!/^[0-9a-fA-F]{64}$/.test(peer)) {
			toasts.error('Enter a valid npub or 64-char hex pubkey');
			return;
		}
		peer = peer.toLowerCase();
		if (peer === identity.current?.pk) {
			toasts.warning("You can't message yourself");
			return;
		}
		dms.forPeer(peer);
		profiles.ensure([peer]);
		selectChat(peer);
		showNew = false;
		newPeerInput = '';
	}

	onMount(() => {
		loadGroups();
		groupsLoaded = true;
		resolveTo(page.url.searchParams.get('to'));
		resolveAutoAnswer(page.url.searchParams.get('answer'));
	});
	$effect(() => resolveTo(page.url.searchParams.get('to')));
	$effect(() => resolveAutoAnswer(page.url.searchParams.get('answer')));
	$effect(() => {
		void activeMessages.length;
		void activeGroup?.messages.length;
		if (threadEl) threadEl.scrollTop = threadEl.scrollHeight;
	});
	$effect(() => {
		if (!showCall && callState !== 'idle') resetCallState();
		if (!showCall) activeCall = null;
	});
	$effect(() => {
		void groupThreads;
		saveGroups();
	});
	$effect(() => {
		void groupThreads.length;
		for (const conversation of dms.conversations) {
			for (const message of conversation.messages) {
				if (message.mine || processedGroupMessageIds.has(message.id)) continue;
				const payload = parseGroupMessage(message.content);
				if (!payload) continue;
				if (appendIncomingGroupMessage(message.id, payload, message.createdAt)) {
					processedGroupMessageIds.add(message.id);
				}
			}
		}
	});
	$effect(() => {
		void groupThreads.length;
		loadProcessedGroupControls();
		for (const conversation of dms.conversations) {
			for (const message of conversation.messages) {
				if (message.mine || processedGroupControlIds.has(message.id)) continue;
				const payload = parseGroupControl(message.content);
				if (!payload) continue;
				const applied = applyGroupControl(payload, {
					notify: isFreshGroupControl(message.createdAt)
				});
				if (applied) rememberProcessedGroupControl(message.id);
			}
		}
	});
	$effect(() => {
		for (const conversation of dms.conversations) {
			for (const message of conversation.messages) {
				const signal = parseCallSignal(message.content);
				if (signal?.type === 'end' || signal?.type === 'log') markCallClosed(signal.callId);
			}
		}
		for (const conversation of dms.conversations) {
			for (const message of conversation.messages) {
				if (message.mine || processedCallSignalIds.has(message.id)) continue;
				const signal = parseCallSignal(message.content);
				if (!signal) continue;
				processedCallSignalIds.add(message.id);
				if (
					signal.type === 'offer' &&
					(isExpiredCallOffer(message.createdAt) || closedCallIds.has(signal.callId))
				) {
					continue;
				}
				void handleCallSignal(signal, message.createdAt);
			}
		}
	});
	$effect(() => {
		void showCall;
		void activeCall;
		attachCallMedia();
	});
</script>

<svelte:head><title>Messages · BitOS</title></svelte:head>

<div class="flex h-full">
	<aside
		class="flex w-full shrink-0 flex-col border-r border-[var(--ui-border-muted)] bg-[var(--surface-bg)] sm:w-[340px] {selected
			? 'hidden sm:flex'
			: 'flex'}"
	>
		<header class="border-b border-[var(--ui-border-muted)] px-5 pt-5 pb-3">
			<div class="mb-4 flex items-center justify-between">
				<div>
					<h1 class="font-display text-[26px] leading-none font-extrabold tracking-tight">
						Messages
					</h1>
					<p
						class="mt-1.5 text-[11px] font-medium tracking-wide text-[var(--ui-text-muted)] uppercase"
					>
						{unreadTotal} unread - {dms.conversations.length} encrypted - {groupThreads.length} groups
					</p>
				</div>
				<button
					type="button"
					onclick={() => (showNew = true)}
					class="grid size-10 place-items-center rounded-xl bg-primary-500 text-white shadow-[var(--glow-primary)] transition-all hover:scale-105 hover:bg-primary-600 active:scale-95"
					aria-label="New chat"
				>
					<Icon name="i-lucide-square-pen" class="size-4" />
				</button>
			</div>
			<Input
				bind:value={query}
				class="w-full"
				icon="i-lucide-search"
				placeholder="Search messages..."
			/>
			<div class="mt-3 flex gap-1">
				{#each [{ k: 'all', l: 'All' }, { k: 'unread', l: 'Unread', n: unreadTotal }, { k: 'groups', l: 'Groups' }] as tab (tab.k)}
					<button
						type="button"
						onclick={() => (filter = tab.k as ChatFilter)}
						class="pill-tab flex items-center gap-1 {filter === tab.k ? 'active' : ''}"
					>
						{tab.l}
						{#if tab.n}
							<span class="rounded-full bg-primary-500 px-1.5 py-0.5 text-[10px] text-white">
								{tab.n}
							</span>
						{/if}
					</button>
				{/each}
			</div>
		</header>

		<div class="min-h-0 flex-1 overflow-y-auto">
			{#each filtered as conversation (conversation.key)}
				<button
					type="button"
					onclick={() => selectChat(conversation.key)}
					class="chat-item flex w-full cursor-pointer items-start gap-3 px-4 py-3.5 text-left {selected ===
					conversation.key
						? 'active'
						: ''}"
				>
					{#if conversation.kind === 'group'}
						<div class="relative shrink-0">
							<div
								class="grid size-12 place-items-center rounded-2xl bg-primary-500 text-sm font-bold text-white shadow-[var(--glow-primary)]"
							>
								{conversation.initials}
							</div>
							<span
								class="online-dot absolute -right-0.5 -bottom-0.5 border-2 border-[var(--surface-bg)]"
							></span>
						</div>
					{:else}
						<Avatar
							pubkey={conversation.id}
							name={conversation.name}
							picture={profiles.get(conversation.id)?.picture}
							size={48}
							class="rounded-2xl"
						/>
					{/if}
					<div class="min-w-0 flex-1">
						<div class="mb-0.5 flex items-center justify-between">
							<h3 class="flex min-w-0 items-center gap-1.5 truncate text-[14.5px] font-bold">
								<span class="truncate">{conversation.name}</span>
								{#if conversation.kind === 'group'}
									<Icon
										name="i-lucide-users"
										class="size-3 shrink-0 text-[var(--ui-text-dimmed)]"
									/>
								{/if}
							</h3>
							<span class="ml-2 shrink-0 text-[11px] text-[var(--ui-text-muted)]">
								{conversation.time}
							</span>
						</div>
						<div class="flex items-center justify-between">
							<p class="truncate text-[13px] text-[var(--ui-text-muted)]">
								{#if conversation.previewPrefix}
									<span class="font-semibold text-[var(--ui-text)]"
										>{conversation.previewPrefix}</span
									>
								{/if}
								{conversation.preview}
							</p>
							{#if conversation.unread}
								<span
									class="ml-2 grid size-5 shrink-0 place-items-center rounded-full bg-primary-500 text-[10px] font-bold text-white"
								>
									{conversation.unread}
								</span>
							{/if}
						</div>
					</div>
				</button>
			{/each}
			{#if !filtered.length}
				<p class="px-4 py-10 text-center text-[12.5px] text-[var(--ui-text-dimmed)]">
					No conversations match this view.
				</p>
			{/if}
		</div>
	</aside>

	<section class="chat-canvas {selected ? 'flex' : 'hidden sm:flex'} min-w-0 flex-1">
		{#if active}
			<div class="flex min-w-0 flex-1 flex-col">
				<header
					class="flex h-[72px] shrink-0 items-center justify-between border-b border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-5"
				>
					<div class="flex min-w-0 items-center gap-3">
						<button
							type="button"
							onclick={() => (selected = '')}
							class="grid size-8 shrink-0 place-items-center rounded-lg text-[var(--ui-text-muted)] hover:bg-[var(--interactive-hover-bg)] sm:hidden"
							aria-label="Back"
						>
							<Icon name="i-lucide-arrow-left" class="size-5" />
						</button>
						{#if active.kind === 'group'}
							<div class="relative shrink-0">
								<div
									class="grid size-11 place-items-center rounded-2xl bg-primary-500 font-bold text-white shadow-[var(--glow-primary)]"
								>
									{active.initials}
								</div>
								<span
									class="online-dot absolute -right-0.5 -bottom-0.5 border-2 border-[var(--surface-bg)]"
								></span>
							</div>
						{:else}
							<a
								href={profileHref(active.id)}
								class="shrink-0 rounded-2xl transition hover:ring-2 hover:ring-primary-500/30"
								aria-label={`Open ${active.name} profile`}
							>
								<Avatar
									pubkey={active.id}
									name={active.name}
									picture={profiles.get(active.id)?.picture}
									size={44}
									class="rounded-2xl"
								/>
							</a>
						{/if}
						<div class="min-w-0">
							<h2 class="flex min-w-0 items-center gap-2 text-[15px] font-bold">
								{#if active.kind === 'dm'}
									<a
										href={profileHref(active.id)}
										class="truncate transition hover:text-primary-600 hover:underline dark:hover:text-primary-300"
									>
										{active.name}
									</a>
								{:else}
									<span class="truncate">{active.name}</span>
								{/if}
								{#if active.kind === 'group'}
									<span
										class="rounded-full bg-primary-500/10 px-2 py-0.5 text-[10px] font-bold text-primary-600 dark:text-primary-300"
										>GROUP</span
									>
								{:else}
									<span class="font-mono text-[11px] text-[var(--ui-text-dimmed)]">
										{shortKey(active.id, 6, 6)}
									</span>
								{/if}
							</h2>
							<p class="flex items-center gap-1.5 text-[12px] text-[var(--ui-text-muted)]">
								{#if active.kind === 'group'}
									<span class="online-dot"></span>
									{active.onlineCount} online - {active.memberCount} members
								{:else}
									<Icon name="i-lucide-lock" class="size-3.5 text-[var(--tone-success-text)]" />
									Encrypted - NIP-04
								{/if}
							</p>
						</div>
					</div>
					<div class="flex shrink-0 items-center gap-1">
						<button
							type="button"
							onclick={() => startCall('voice')}
							class="grid size-10 place-items-center rounded-xl text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-primary-500"
							aria-label="Start voice call"
						>
							<Icon name="i-lucide-phone" class="size-4" />
						</button>
						<button
							type="button"
							onclick={() => startCall('video')}
							class="grid size-10 place-items-center rounded-xl text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-primary-500"
							aria-label="Start video call"
						>
							<Icon name="i-lucide-video" class="size-4" />
						</button>
						<button
							type="button"
							onclick={() => (showDetails = true)}
							class="grid size-10 place-items-center rounded-xl text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-primary-500 xl:hidden"
							aria-label="Conversation details"
						>
							<Icon name="i-lucide-info" class="size-4" />
						</button>
					</div>
				</header>

				{#if activeGroup?.pinned}
					<div
						class="flex shrink-0 items-center gap-3 border-b border-warm-500/20 bg-warm-500/10 px-5 py-2.5"
					>
						<Icon name="i-lucide-pin" class="size-4 text-warm-500" />
						<div class="min-w-0 flex-1">
							<p class="truncate text-[12px] font-semibold">{activeGroup.pinned}</p>
							<p class="truncate text-[11px] text-[var(--ui-text-muted)]">
								Pinned in {active.name}
							</p>
						</div>
						<button
							type="button"
							class="shrink-0 text-[11px] font-semibold text-primary-600 hover:underline dark:text-primary-300"
						>
							View
						</button>
					</div>
				{/if}

				<div bind:this={threadEl} class="min-h-0 flex-1 overflow-y-auto px-6 py-5">
					{#if active.kind === 'group' && activeGroup}
						{#if activeGroup.messages.length}
							<div class="date-divider">
								<span
									class="rounded-full bg-[var(--surface-bg)]/75 px-3 py-1 text-[11px] font-semibold text-[var(--ui-text-muted)] backdrop-blur"
									>Today</span
								>
							</div>
							<div class="space-y-4">
								{#each activeGroup.messages as msg (msg.id)}
									{@const msgMedia = mediaFromMessage(msg.content)}
									<div class="msg-in flex gap-2.5 {msg.mine ? 'justify-end' : 'justify-start'}">
										{#if !msg.mine}
											{#if msg.pubkey}
												<a
													href={profileHref(msg.pubkey)}
													class="mt-auto shrink-0 rounded-xl transition hover:ring-2 hover:ring-primary-500/30"
													aria-label={`Open ${msg.author} profile`}
												>
													<Avatar
														pubkey={msg.pubkey}
														name={msg.author}
														picture={profiles.get(msg.pubkey)?.picture}
														size={32}
														class="rounded-xl"
													/>
												</a>
											{:else}
												<div
													class="mt-auto grid size-8 shrink-0 place-items-center rounded-xl bg-primary-500 text-xs font-bold text-white"
												>
													{msg.initials}
												</div>
											{/if}
										{/if}
										<div class="max-w-[78%] sm:max-w-[70%]">
											<div
												class="mb-1 flex items-baseline gap-2 {msg.mine
													? 'justify-end'
													: 'justify-start'}"
											>
												{#if msg.mine}
													<span class="text-[10px] text-[var(--ui-text-dimmed)]">
														{new Date(msg.createdAt * 1000).toLocaleTimeString(undefined, {
															hour: '2-digit',
															minute: '2-digit'
														})}
													</span>
													<span
														class="text-[12px] font-bold text-primary-600 dark:text-primary-300"
													>
														You
													</span>
												{:else}
													{#if msg.pubkey}
														<a
															href={profileHref(msg.pubkey)}
															class="text-[12px] font-bold transition hover:text-primary-600 hover:underline dark:hover:text-primary-300"
														>
															{msg.author}
														</a>
													{:else}
														<span class="text-[12px] font-bold">{msg.author}</span>
													{/if}
													<span class="text-[10px] text-[var(--ui-text-dimmed)]">
														{new Date(msg.createdAt * 1000).toLocaleTimeString(undefined, {
															hour: '2-digit',
															minute: '2-digit'
														})}
													</span>
												{/if}
											</div>
											<div
												class="{msg.mine
													? 'bubble-out'
													: 'bubble-in'} p-2.5 text-[14px] leading-relaxed"
											>
												{#if msg.type === 'call'}
													<div class="flex min-w-[240px] items-center gap-3">
														<div
															class="grid size-10 shrink-0 place-items-center rounded-xl {msg.mine
																? 'bg-white/20 text-white'
																: 'bg-primary-500 text-white'}"
														>
															<Icon
																name={msg.content.toLowerCase().includes('video')
																	? 'i-lucide-video'
																	: 'i-lucide-phone'}
																class="size-5"
															/>
														</div>
														<div class="min-w-0 flex-1">
															<p class="truncate text-[13px] font-bold">{msg.content}</p>
															<p
																class="truncate text-[11px] {msg.mine
																	? 'text-white/70'
																	: 'text-[var(--ui-text-muted)]'}"
															>
																{msg.meta ? `Duration ${msg.meta}` : 'Group call'}
															</p>
														</div>
													</div>
												{:else if msg.type === 'voice'}
													<div class="flex min-w-[240px] items-center gap-3">
														<button
															type="button"
															class="grid size-9 shrink-0 place-items-center rounded-full bg-primary-500 text-white"
															aria-label="Play voice note"
														>
															<Icon name="i-lucide-play" class="ml-0.5 size-3.5" />
														</button>
														<div class="flex h-8 flex-1 items-center gap-[2px]">
															{#each [40, 70, 90, 50, 80, 60, 100, 45, 75, 55, 85, 65] as height, index}
																<div
																	class="wave-bar w-[3px] rounded-full bg-primary-500"
																	style={`height: ${height}%; animation-delay: ${index / 10}s;`}
																></div>
															{/each}
														</div>
														<span
															class="shrink-0 text-[11px] font-semibold text-[var(--ui-text-muted)]"
														>
															{msg.meta}
														</span>
													</div>
												{:else if msgMedia?.kind === 'image' || msg.type === 'image'}
													{#if msgMedia}
														<a href={msgMedia.url} target="_blank" rel="noreferrer">
															<img
																src={msgMedia.url}
																alt="Message attachment"
																class="mb-2 max-h-72 min-w-[220px] rounded-xl object-cover"
															/>
														</a>
														{#if msgMedia.text}
															<p class="break-words whitespace-pre-wrap">{msgMedia.text}</p>
														{/if}
													{:else}
														<div
															class="mb-2 grid aspect-video w-full min-w-[220px] place-items-center rounded-xl bg-primary-500/10 text-primary-600 dark:text-primary-300"
														>
															<Icon name="i-lucide-image" class="size-8" />
														</div>
														<p class="break-words whitespace-pre-wrap">{msg.content}</p>
													{/if}
												{:else if msgMedia?.kind === 'video'}
													<video
														src={msgMedia.url}
														controls
														class="mb-2 max-h-72 min-w-[220px] rounded-xl"
													>
														<track kind="captions" />
													</video>
													{#if msgMedia.text}
														<p class="break-words whitespace-pre-wrap">{msgMedia.text}</p>
													{/if}
												{:else if msgMedia}
													<a
														href={msgMedia.url}
														target="_blank"
														rel="noreferrer"
														class="flex min-w-[220px] items-center gap-3 rounded-xl bg-primary-500/10 p-2 transition hover:bg-primary-500/15"
													>
														<div
															class="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-500/10 text-primary-600 dark:text-primary-300"
														>
															<Icon name="i-lucide-file-text" class="size-5" />
														</div>
														<div class="min-w-0 flex-1">
															<p class="truncate text-[13px] font-semibold">Open attachment</p>
															<p class="truncate text-[11px] opacity-70">{msgMedia.url}</p>
														</div>
													</a>
													{#if msgMedia.text}
														<p class="mt-2 break-words whitespace-pre-wrap">{msgMedia.text}</p>
													{/if}
												{:else if msg.type === 'file'}
													<div class="flex min-w-[220px] items-center gap-3">
														<div
															class="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-500/10 text-primary-600 dark:text-primary-300"
														>
															<Icon name="i-lucide-file-text" class="size-5" />
														</div>
														<div class="min-w-0 flex-1">
															<p class="truncate text-[13px] font-semibold">{msg.content}</p>
															<p class="text-[11px] opacity-70">{msg.meta}</p>
														</div>
													</div>
												{:else}
													<p class="break-words whitespace-pre-wrap">{msg.content}</p>
												{/if}
											</div>
											{#if msg.reaction}
												<div
													class="relative -mt-2 ml-3 inline-flex rounded-full border border-[var(--ui-border)] bg-[var(--surface-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ui-text-muted)]"
												>
													{msg.reaction}
												</div>
											{/if}
										</div>
									</div>
								{/each}
							</div>
						{:else}
							<div class="flex h-full flex-col items-center justify-center gap-2 text-center">
								<Icon name="i-lucide-users" class="size-8 text-[var(--ui-text-dimmed)]" />
								<p class="text-[13px] text-[var(--ui-text-muted)]">Start the group conversation.</p>
							</div>
						{/if}
					{:else if visibleActiveMessages.length}
						<div class="date-divider">
							<span
								class="rounded-full bg-[var(--surface-bg)]/75 px-3 py-1 text-[11px] font-semibold text-[var(--ui-text-muted)] backdrop-blur"
								>Today</span
							>
						</div>
						<div class="space-y-4">
							{#each visibleActiveMessages as msg (msg.id)}
								{@const invite = parseGroupInvite(msg.content)}
								{@const groupMessage = parseGroupMessage(msg.content)}
								{@const callSignal = parseCallSignal(msg.content)}
								{@const msgMedia = mediaFromMessage(msg.content)}
								<div class="flex {msg.mine ? 'justify-end' : 'justify-start'}">
									<div
										class="max-w-[78%] {msg.mine
											? 'bubble-out rounded-br-md'
											: 'bubble-in rounded-bl-md'} px-4 py-2.5 text-[14px] leading-relaxed"
									>
										{#if invite}
											<div class="min-w-[240px] space-y-3">
												<div class="flex items-center gap-3">
													<div
														class="grid size-10 shrink-0 place-items-center rounded-xl {msg.mine
															? 'bg-white/20 text-white'
															: 'bg-primary-500 text-white'}"
													>
														<Icon name="i-lucide-users" class="size-5" />
													</div>
													<div class="min-w-0 flex-1">
														<p class="truncate text-[13px] font-bold">{invite.name}</p>
														<p
															class="truncate text-[11px] {msg.mine
																? 'text-white/70'
																: 'text-[var(--ui-text-muted)]'}"
														>
															{msg.mine
																? 'Invite sent'
																: `Local group invite from ${shortKey(invite.from)}`}
														</p>
													</div>
												</div>
												{#if msg.mine}
													<p class="text-[12px] text-white/75">
														They can accept this invite from their BitOS messages page.
													</p>
												{:else if groupThreads.some((group) => group.id === invite.id)}
													<Button
														color="neutral"
														variant="soft"
														size="sm"
														icon="i-lucide-check"
														disabled
													>
														Accepted
													</Button>
												{:else}
													<Button
														color="primary"
														variant="solid"
														size="sm"
														icon="i-lucide-check"
														onclick={() => acceptGroupInvite(invite)}
													>
														Accept invite
													</Button>
												{/if}
											</div>
										{:else if groupMessage}
											<div class="min-w-[240px] space-y-3">
												<div class="flex items-center gap-3">
													<div
														class="grid size-10 shrink-0 place-items-center rounded-xl {msg.mine
															? 'bg-white/20 text-white'
															: 'bg-primary-500 text-white'}"
													>
														<Icon name="i-lucide-message-square" class="size-5" />
													</div>
													<div class="min-w-0 flex-1">
														<p class="truncate text-[13px] font-bold">{groupMessage.name}</p>
														<p
															class="truncate text-[11px] {msg.mine
																? 'text-white/70'
																: 'text-[var(--ui-text-muted)]'}"
														>
															{msg.mine ? 'Group message sent' : 'Group message received'}
														</p>
													</div>
												</div>
												<p
													class="line-clamp-2 text-[12px] {msg.mine
														? 'text-white/75'
														: 'text-[var(--ui-text-muted)]'}"
												>
													{groupMessage.body}
												</p>
												{#if groupThreads.some((group) => group.id === groupMessage.id)}
													<Button
														color={msg.mine ? 'neutral' : 'primary'}
														variant={msg.mine ? 'soft' : 'solid'}
														size="sm"
														icon="i-lucide-arrow-right"
														onclick={() => selectChat(`group:${groupMessage.id}`)}
													>
														View group
													</Button>
												{:else}
													<p
														class="text-[12px] {msg.mine
															? 'text-white/75'
															: 'text-[var(--ui-text-muted)]'}"
													>
														Accept the group invite first to sync this message.
													</p>
												{/if}
											</div>
										{:else if callSignal}
											<div class="min-w-[220px] space-y-3">
												<div class="flex items-center gap-3">
													<div
														class="grid size-10 shrink-0 place-items-center rounded-xl {msg.mine
															? 'bg-white/20 text-white'
															: 'bg-primary-500 text-white'}"
													>
														<Icon
															name={callSignal.kind === 'video'
																? 'i-lucide-video'
																: 'i-lucide-phone'}
															class="size-5"
														/>
													</div>
													<div class="min-w-0 flex-1">
														<p class="truncate text-[13px] font-bold">
															{callSignal.groupId ? 'Group ' : ''}{callSignal.kind === 'video'
																? 'video call'
																: 'voice call'}
														</p>
														<p
															class="truncate text-[11px] {msg.mine
																? 'text-white/70'
																: 'text-[var(--ui-text-muted)]'}"
														>
															{msg.mine
																? callSignal.type === 'log'
																	? 'Call ended'
																	: 'Outgoing call'
																: callSignal.type === 'offer'
																	? 'Incoming call'
																	: 'Call ended'}
														</p>
													</div>
												</div>
												{#if callSignal.type === 'log'}
													<p
														class="text-[12px] {msg.mine
															? 'text-white/75'
															: 'text-[var(--ui-text-muted)]'}"
													>
														Duration {formatDuration(callSignal.duration)}
													</p>
												{/if}
												{#if !msg.mine && callSignal.type === 'offer'}
													<Button
														color="primary"
														variant="solid"
														size="sm"
														icon="i-lucide-phone"
														onclick={() => {
															incomingCall = callSignal;
															void acceptIncomingCall();
														}}
													>
														Answer
													</Button>
												{/if}
											</div>
										{:else if msgMedia?.kind === 'image'}
											<a href={msgMedia.url} target="_blank" rel="noreferrer">
												<img
													src={msgMedia.url}
													alt="Message attachment"
													class="mb-2 max-h-72 min-w-[220px] rounded-xl object-cover"
												/>
											</a>
											{#if msgMedia.text}
												<p class="break-words whitespace-pre-wrap">{msgMedia.text}</p>
											{/if}
										{:else if msgMedia?.kind === 'video'}
											<video
												src={msgMedia.url}
												controls
												class="mb-2 max-h-72 min-w-[220px] rounded-xl"
											>
												<track kind="captions" />
											</video>
											{#if msgMedia.text}
												<p class="break-words whitespace-pre-wrap">{msgMedia.text}</p>
											{/if}
										{:else if msgMedia}
											<a
												href={msgMedia.url}
												target="_blank"
												rel="noreferrer"
												class="flex min-w-[220px] items-center gap-3 rounded-xl {msg.mine
													? 'bg-white/15 hover:bg-white/20'
													: 'bg-primary-500/10 hover:bg-primary-500/15'} p-2 transition"
											>
												<div
													class="grid size-10 shrink-0 place-items-center rounded-xl {msg.mine
														? 'bg-white/20 text-white'
														: 'bg-primary-500/10 text-primary-600 dark:text-primary-300'}"
												>
													<Icon name="i-lucide-file-text" class="size-5" />
												</div>
												<div class="min-w-0 flex-1">
													<p class="truncate text-[13px] font-semibold">Open attachment</p>
													<p class="truncate text-[11px] opacity-70">{msgMedia.url}</p>
												</div>
											</a>
											{#if msgMedia.text}
												<p class="mt-2 break-words whitespace-pre-wrap">{msgMedia.text}</p>
											{/if}
										{:else}
											<p class="break-words whitespace-pre-wrap">{msg.content}</p>
										{/if}
										<div
											class="mt-0.5 text-right text-[10px] {msg.mine
												? 'text-white/60'
												: 'text-[var(--ui-text-dimmed)]'}"
										>
											{new Date(msg.createdAt * 1000).toLocaleTimeString(undefined, {
												hour: '2-digit',
												minute: '2-digit'
											})}
										</div>
									</div>
								</div>
							{/each}
						</div>
					{:else}
						<div class="flex h-full flex-col items-center justify-center gap-2 text-center">
							<Icon name="i-lucide-message-circle" class="size-8 text-[var(--ui-text-dimmed)]" />
							<p class="text-[13px] text-[var(--ui-text-muted)]">
								Say hello. It will be encrypted.
							</p>
						</div>
					{/if}
				</div>

				<footer
					class="shrink-0 border-t border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-5 py-3"
				>
					<input
						bind:this={messageFileInput}
						type="file"
						multiple
						class="hidden"
						onchange={onMessageFileInput}
					/>
					<input
						bind:this={messageImageInput}
						type="file"
						accept="image/*"
						multiple
						class="hidden"
						onchange={onMessageFileInput}
					/>
					{#if messageAttachments.length}
						<div class="mb-3 flex flex-wrap gap-2">
							{#each messageAttachments as attachment, i (attachment.url)}
								<div
									class="group relative flex max-w-[220px] items-center gap-2 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] p-2"
								>
									{#if attachment.kind === 'image'}
										<img
											src={attachment.url}
											alt=""
											class="size-10 shrink-0 rounded-lg object-cover"
										/>
									{:else}
										<div
											class="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-500/10 text-primary-600 dark:text-primary-300"
										>
											<Icon
												name={attachment.kind === 'video' ? 'i-lucide-video' : 'i-lucide-file-text'}
												class="size-5"
											/>
										</div>
									{/if}
									<div class="min-w-0 flex-1">
										<p class="truncate text-[12px] font-semibold">{attachment.name}</p>
										<p class="text-[10px] text-[var(--ui-text-muted)]">
											{humanBytes(attachment.bytes)} · {providerLabel(attachment.provider)}
										</p>
									</div>
									<button
										type="button"
										onclick={() => removeMessageAttachment(i)}
										class="grid size-6 shrink-0 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
										aria-label="Remove attachment"
									>
										<Icon name="i-lucide-x" class="size-3.5" />
									</button>
								</div>
							{/each}
						</div>
					{/if}
					{#if uploadingMessage}
						<p class="mb-2 flex items-center gap-1.5 text-[11.5px] text-primary-500">
							<Icon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
							Uploading via {providerLabel(activeUploadProvider)}…
						</p>
					{/if}
					<div class="flex items-end gap-2">
						<button
							type="button"
							onclick={() => attachFile('file')}
							disabled={uploadingMessage || activeUploadProvider === 'none'}
							title={activeUploadProvider === 'none'
								? 'No upload provider configured'
								: `Upload via ${providerLabel(activeUploadProvider)}`}
							class="grid size-10 shrink-0 place-items-center rounded-xl text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)]"
							aria-label="Attach file"
						>
							<Icon
								name={uploadingMessage ? 'i-lucide-loader-circle' : 'i-lucide-paperclip'}
								class="size-4 {uploadingMessage ? 'animate-spin' : ''}"
							/>
						</button>
						<button
							type="button"
							onclick={() => attachFile('image')}
							disabled={uploadingMessage || activeUploadProvider === 'none'}
							title={activeUploadProvider === 'none'
								? 'No upload provider configured'
								: `Upload via ${providerLabel(activeUploadProvider)}`}
							class="grid size-10 shrink-0 place-items-center rounded-xl text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)]"
							aria-label="Attach image"
						>
							<Icon
								name={uploadingMessage ? 'i-lucide-loader-circle' : 'i-lucide-image'}
								class="size-4 {uploadingMessage ? 'animate-spin' : ''}"
							/>
						</button>
						<div
							class="flex flex-1 items-center gap-2 rounded-2xl bg-[var(--ui-bg-muted)] px-4 py-2.5"
						>
							<input
								type="text"
								bind:value={draft}
								onkeydown={onKey}
								placeholder="Type a message..."
								class="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-[var(--ui-text-dimmed)]"
							/>
							<button
								type="button"
								onclick={addEmoji}
								class="text-[var(--ui-text-muted)] transition hover:text-warm-500"
								aria-label="Add emoji"
							>
								<Icon name="i-lucide-smile" class="size-[18px]" />
							</button>
						</div>
						<button
							type="button"
							onclick={send}
							disabled={!canSend}
							class="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-500 text-white shadow-[var(--glow-primary)] transition-all hover:scale-105 active:scale-95 disabled:opacity-50"
							aria-label="Send"
						>
							<Icon name="i-lucide-send" class="size-4" />
						</button>
					</div>
				</footer>
			</div>

			<aside
				class="hidden w-[320px] shrink-0 flex-col overflow-y-auto border-l border-[var(--ui-border-muted)] bg-[var(--surface-bg)] xl:flex"
			>
				<div class="border-b border-[var(--ui-border-muted)] px-6 pt-8 pb-5 text-center">
					{#if active.kind === 'group'}
						<div
							class="mx-auto mb-3 grid size-20 place-items-center rounded-3xl bg-primary-500 font-display text-2xl font-extrabold text-white shadow-[var(--glow-primary)]"
						>
							{active.initials}
						</div>
						<h2 class="font-display text-[22px] font-extrabold tracking-tight">{active.name}</h2>
						<p class="mt-1 text-[12px] text-[var(--ui-text-muted)]">
							Group - {active.memberCount} members - {active.onlineCount} online
						</p>
					{:else}
						<a
							href={profileHref(active.id)}
							class="mx-auto mb-3 block w-fit rounded-3xl transition hover:ring-2 hover:ring-primary-500/30"
							aria-label={`Open ${active.name} profile`}
						>
							<Avatar
								pubkey={active.id}
								name={active.name}
								picture={profiles.get(active.id)?.picture}
								size={80}
								class="rounded-3xl"
							/>
						</a>
						<h2 class="truncate font-display text-[22px] font-extrabold tracking-tight">
							<a
								href={profileHref(active.id)}
								class="transition hover:text-primary-600 hover:underline dark:hover:text-primary-300"
							>
								{active.name}
							</a>
						</h2>
						<p class="mt-1 font-mono text-[11px] text-[var(--ui-text-muted)]">
							{shortKey(active.id, 10, 10)}
						</p>
					{/if}
				</div>

				{#if activeGroup}
					<div class="border-b border-[var(--ui-border-muted)] px-5 py-4">
						<h3
							class="mb-2 text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
						>
							Description
						</h3>
						<p class="text-[13px] leading-relaxed">{activeGroup.description}</p>
					</div>
					<div
						class="flex items-center justify-between border-b border-[var(--ui-border-muted)] px-5 py-4"
					>
						<div class="flex items-center gap-3">
							<div
								class="grid size-9 place-items-center rounded-xl bg-accent-500/10 text-accent-600"
							>
								<Icon name="i-lucide-bell" class="size-4" />
							</div>
							<div>
								<p class="text-[13px] font-semibold">Notifications</p>
								<p class="text-[11px] text-[var(--ui-text-muted)]">All messages</p>
							</div>
						</div>
						<div class="toggle on" aria-hidden="true"></div>
					</div>
					<div class="border-b border-[var(--ui-border-muted)] px-5 py-4">
						<div class="mb-3 flex items-center justify-between">
							<h3
								class="text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
							>
								Members - {activeGroup.members.length}
							</h3>
						</div>
						<div class="mb-3 flex gap-2">
							<Input
								bind:value={memberInput}
								icon="i-lucide-user-plus"
								placeholder="Name, npub, or hex"
								class="flex-1 text-[12px]"
							/>
							<Button
								color="primary"
								variant="soft"
								square
								icon="i-lucide-plus"
								aria-label="Add members"
								onclick={() => addMembersToGroup(activeGroup.id)}
							/>
						</div>
						{#if dmRows.length}
							<div class="mb-3">
								<p
									class="mb-2 text-[10px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
								>
									From chats
								</p>
								<div class="flex gap-2 overflow-x-auto pb-1">
									{#each dmRows
										.filter((row) => !groupHasPubkey(activeGroup, row.id))
										.slice(0, 8) as row (row.id)}
										<button
											type="button"
											class="flex shrink-0 items-center gap-2 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-2.5 py-2 text-left transition hover:border-primary-500/40 hover:bg-primary-500/10"
											onclick={() => addDmPeerToGroup(activeGroup.id, row.id)}
										>
											<Avatar
												pubkey={row.id}
												name={row.name}
												picture={profiles.get(row.id)?.picture}
												size={28}
												class="rounded-lg"
											/>
											<span class="max-w-24 truncate text-[12px] font-semibold">{row.name}</span>
										</button>
									{/each}
								</div>
							</div>
						{/if}
						<div class="space-y-2.5">
							{#each activeGroup.members as member (memberKey(member))}
								<div class="-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-1.5">
									<div class="relative">
										{#if member.pubkey}
											<a
												href={profileHref(member.pubkey)}
												class="block rounded-xl transition hover:ring-2 hover:ring-primary-500/30"
												aria-label={`Open ${member.name} profile`}
											>
												<Avatar
													pubkey={member.pubkey}
													name={member.name}
													picture={profiles.get(member.pubkey)?.picture}
													size={36}
													class="rounded-xl"
												/>
											</a>
										{:else}
											<div
												class="grid size-9 place-items-center rounded-xl bg-primary-500 text-xs font-bold text-white"
											>
												{member.initials}
											</div>
										{/if}
										{#if member.status === 'Online' || member.status === 'Active now'}
											<span
												class="online-dot absolute -right-0.5 -bottom-0.5 border-2 border-[var(--surface-bg)]"
											></span>
										{/if}
									</div>
									<div class="min-w-0 flex-1">
										<p class="flex items-center gap-1.5 truncate text-[13px] font-semibold">
											{#if member.pubkey}
												<a
													href={profileHref(member.pubkey)}
													class="truncate transition hover:text-primary-600 hover:underline dark:hover:text-primary-300"
												>
													{member.name}
												</a>
											{:else}
												<span class="truncate">{member.name}</span>
											{/if}
											{#if member.admin}
												<span
													class="rounded bg-primary-500/10 px-1.5 py-0.5 text-[9px] font-bold text-primary-600 dark:text-primary-300"
													>ADMIN</span
												>
											{/if}
										</p>
										<p class="text-[11px] text-[var(--ui-text-muted)]">{member.status}</p>
									</div>
									{#if currentUserIsGroupAdmin(activeGroup) && !member.admin}
										<button
											type="button"
											class="grid size-8 shrink-0 place-items-center rounded-lg text-[var(--ui-text-dimmed)] transition hover:bg-[var(--tone-error-bg)] hover:text-[var(--tone-error-text)]"
											aria-label={`Remove ${member.name}`}
											onclick={() => void removeMemberFromGroup(activeGroup.id, memberKey(member))}
										>
											<Icon name="i-lucide-user-minus" class="size-4" />
										</button>
									{/if}
								</div>
							{/each}
						</div>
					</div>
					<div class="px-5 py-4">
						<h3
							class="mb-3 text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
						>
							Files - {activeGroup.files.length}
						</h3>
						<div class="space-y-2">
							{#each activeGroup.files as file (file.name)}
								<div
									class="flex items-center gap-3 rounded-lg p-2 hover:bg-[var(--interactive-hover-bg)]"
								>
									<div
										class="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-500/10 text-primary-600 dark:text-primary-300"
									>
										<Icon name={file.icon} class="size-4" />
									</div>
									<div class="min-w-0 flex-1">
										<p class="truncate text-[12px] font-semibold">{file.name}</p>
										<p class="text-[10px] text-[var(--ui-text-muted)]">{file.meta}</p>
									</div>
									<Icon name="i-lucide-download" class="size-3.5 text-[var(--ui-text-dimmed)]" />
								</div>
							{/each}
						</div>
					</div>
					<div class="border-t border-[var(--ui-border-muted)] px-5 py-4">
						<Button
							color="neutral"
							variant="subtle"
							icon="i-lucide-log-out"
							block
							onclick={() => void leaveGroup(activeGroup.id)}
						>
							Leave group
						</Button>
						<Button
							color="error"
							variant="subtle"
							icon="i-lucide-trash-2"
							block
							class="mt-2"
							onclick={() => deleteGroup(activeGroup.id)}
						>
							Delete group
						</Button>
					</div>
				{:else}
					<div class="px-5 py-4">
						<div
							class="rounded-xl bg-[var(--ui-bg-muted)] p-3 text-[12px] text-[var(--ui-text-muted)]"
						>
							<Icon
								name="i-lucide-lock"
								class="mr-1 inline size-3.5 text-[var(--tone-success-text)]"
							/>
							Messages in this conversation are encrypted with NIP-04.
						</div>
					</div>
				{/if}
			</aside>
		{:else}
			<div class="hidden flex-1 flex-col items-center justify-center gap-3 text-center sm:flex">
				<div
					class="grid size-16 place-items-center rounded-2xl bg-[var(--ui-bg-muted)] text-[var(--ui-text-dimmed)]"
				>
					<Icon name="i-lucide-message-circle" class="size-8" />
				</div>
				<div>
					<p class="text-[15px] font-semibold">Your messages</p>
					<p class="mt-1 text-[13px] text-[var(--ui-text-muted)]">
						Select a conversation or start a new one.
					</p>
				</div>
			</div>
		{/if}
	</section>
</div>

<Dialog bind:open={showNew} title="New chat">
	<div class="mb-4 flex gap-1">
		{#each [{ key: 'dm', label: 'Direct' }, { key: 'group', label: 'Group' }] as option (option.key)}
			<button
				type="button"
				onclick={() => (newMode = option.key as ChatKind)}
				class="pill-tab {newMode === option.key ? 'active' : ''}"
			>
				{option.label}
			</button>
		{/each}
	</div>
	{#if newMode === 'dm'}
		<p class="mb-3 text-[13px] text-[var(--ui-text-muted)]">
			Enter the recipient's <span class="font-semibold">npub</span> or hex public key.
		</p>
		<Input
			bind:value={newPeerInput}
			icon="i-lucide-user"
			placeholder="npub1... or 64-char hex"
			class="w-full font-mono text-[12.5px]"
		/>
	{:else}
		<div class="space-y-3">
			<Input
				bind:value={newGroupName}
				class="w-full"
				icon="i-lucide-users"
				placeholder="Group name"
			/>
			<Input
				bind:value={newGroupMembers}
				icon="i-lucide-user-plus"
				placeholder="Members, npubs, or hex keys"
				class="w-full"
			/>
			<p class="text-[12px] text-[var(--ui-text-muted)]">
				Pubkey members receive an encrypted DM invite. Accepted groups are still local until a group
				relay protocol is connected.
			</p>
		</div>
	{/if}
	{#snippet footer()}
		<Button color="neutral" variant="subtle" onclick={() => (showNew = false)}>Cancel</Button>
		<Button color="primary" icon="i-lucide-message-square-plus" onclick={startNew}
			>Start chat</Button
		>
	{/snippet}
</Dialog>

<Dialog bind:open={showDetails} title="Conversation details">
	{#if active}
		<div class="flex items-center gap-3">
			{#if active.kind === 'group'}
				<div
					class="grid size-[52px] place-items-center rounded-2xl bg-primary-500 font-bold text-white"
				>
					{active.initials}
				</div>
			{:else}
				<a
					href={profileHref(active.id)}
					class="shrink-0 rounded-2xl transition hover:ring-2 hover:ring-primary-500/30"
					aria-label={`Open ${active.name} profile`}
				>
					<Avatar
						pubkey={active.id}
						name={active.name}
						picture={profiles.get(active.id)?.picture}
						size={52}
						class="rounded-2xl"
					/>
				</a>
			{/if}
			<div class="min-w-0">
				{#if active.kind === 'dm'}
					<a
						href={profileHref(active.id)}
						class="block truncate text-[15px] font-bold transition hover:text-primary-600 hover:underline dark:hover:text-primary-300"
					>
						{active.name}
					</a>
				{:else}
					<p class="truncate text-[15px] font-bold">{active.name}</p>
				{/if}
				<p class="mt-0.5 text-[11px] text-[var(--ui-text-muted)]">
					{active.kind === 'group'
						? `${active.memberCount} members - ${active.onlineCount} online`
						: active.id}
				</p>
			</div>
		</div>
		<div
			class="mt-5 rounded-xl bg-[var(--ui-bg-muted)] p-3 text-[12px] text-[var(--ui-text-muted)]"
		>
			<Icon name="i-lucide-lock" class="mr-1 inline size-3.5 text-[var(--tone-success-text)]" />
			{active.kind === 'group'
				? 'This group thread is local UI state until a Nostr group protocol is connected.'
				: 'Messages use NIP-04 encryption. Calls and file uploads require additional Nostr-compatible services.'}
		</div>
		{#if activeGroup}
			<div class="mt-5">
				<h3 class="mb-2 text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase">
					Members - {activeGroup.members.length}
				</h3>
				<div class="mb-3 flex gap-2">
					<Input
						bind:value={memberInput}
						icon="i-lucide-user-plus"
						placeholder="Name, npub, or hex"
						class="flex-1 text-[12px]"
					/>
					<Button
						color="primary"
						variant="soft"
						square
						icon="i-lucide-plus"
						aria-label="Add members"
						onclick={() => addMembersToGroup(activeGroup.id)}
					/>
				</div>
				{#if dmRows.length}
					<div class="mb-3">
						<p
							class="mb-2 text-[10px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase"
						>
							From chats
						</p>
						<div class="flex gap-2 overflow-x-auto pb-1">
							{#each dmRows
								.filter((row) => !groupHasPubkey(activeGroup, row.id))
								.slice(0, 8) as row (row.id)}
								<button
									type="button"
									class="flex shrink-0 items-center gap-2 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-2.5 py-2 text-left transition hover:border-primary-500/40 hover:bg-primary-500/10"
									onclick={() => addDmPeerToGroup(activeGroup.id, row.id)}
								>
									<Avatar
										pubkey={row.id}
										name={row.name}
										picture={profiles.get(row.id)?.picture}
										size={28}
										class="rounded-lg"
									/>
									<span class="max-w-24 truncate text-[12px] font-semibold">{row.name}</span>
								</button>
							{/each}
						</div>
					</div>
				{/if}
				<div class="max-h-52 space-y-2 overflow-y-auto">
					{#each activeGroup.members as member (memberKey(member))}
						<div class="flex items-center gap-2 rounded-lg bg-[var(--ui-bg-muted)] px-2 py-2">
							{#if member.pubkey}
								<a
									href={profileHref(member.pubkey)}
									class="shrink-0 rounded-lg transition hover:ring-2 hover:ring-primary-500/30"
									aria-label={`Open ${member.name} profile`}
								>
									<Avatar
										pubkey={member.pubkey}
										name={member.name}
										picture={profiles.get(member.pubkey)?.picture}
										size={32}
										class="rounded-lg"
									/>
								</a>
							{:else}
								<div
									class="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-500 text-[11px] font-bold text-white"
								>
									{member.initials}
								</div>
							{/if}
							<div class="min-w-0 flex-1">
								{#if member.pubkey}
									<a
										href={profileHref(member.pubkey)}
										class="block truncate text-[13px] font-semibold transition hover:text-primary-600 hover:underline dark:hover:text-primary-300"
									>
										{member.name}
									</a>
								{:else}
									<p class="truncate text-[13px] font-semibold">{member.name}</p>
								{/if}
								<p class="truncate text-[11px] text-[var(--ui-text-muted)]">
									{member.pubkey ? shortKey(member.pubkey) : member.status}
								</p>
							</div>
							{#if currentUserIsGroupAdmin(activeGroup) && !member.admin}
								<button
									type="button"
									class="grid size-8 shrink-0 place-items-center rounded-lg text-[var(--ui-text-dimmed)] transition hover:bg-[var(--tone-error-bg)] hover:text-[var(--tone-error-text)]"
									aria-label={`Remove ${member.name}`}
									onclick={() => void removeMemberFromGroup(activeGroup.id, memberKey(member))}
								>
									<Icon name="i-lucide-user-minus" class="size-4" />
								</button>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}
	{/if}
	{#snippet footer()}
		{#if activeGroup}
			<Button
				color="neutral"
				variant="subtle"
				icon="i-lucide-log-out"
				onclick={() => void leaveGroup(activeGroup.id)}
			>
				Leave group
			</Button>
			<Button
				color="error"
				variant="subtle"
				icon="i-lucide-trash-2"
				onclick={() => deleteGroup(activeGroup.id)}
			>
				Delete group
			</Button>
		{/if}
		<Button color="neutral" variant="subtle" onclick={() => (showDetails = false)}>Close</Button>
	{/snippet}
</Dialog>

<Dialog
	bind:open={showCall}
	title={`${callGroupId ? 'Group ' : ''}${activeCall === 'video' ? 'Video call' : 'Voice call'}`}
>
	{#if activeCall}
		<div class="space-y-4 text-center">
			<div
				class="{activeCall === 'video'
					? 'aspect-video'
					: 'aspect-square max-w-52'} relative mx-auto grid w-full overflow-hidden rounded-2xl bg-neutral-950 text-white"
			>
				{#if activeCall === 'video'}
					{#if remoteParticipants.length}
						<div
							class="grid size-full gap-1 {remoteParticipants.length === 1
								? 'grid-cols-1'
								: 'grid-cols-2'}"
						>
							{#each remoteParticipants as participant (participant.peer)}
								<div class="relative overflow-hidden bg-black">
									<video
										use:streamSource={participant.stream}
										autoplay
										playsinline
										class="size-full object-cover"
									></video>
									<div
										class="absolute right-2 bottom-2 rounded-full bg-black/55 px-2 py-1 text-[10px] font-semibold text-white"
									>
										{participant.name}
									</div>
								</div>
							{/each}
						</div>
					{:else}
						<video bind:this={remoteVideoEl} autoplay playsinline class="size-full object-cover"
						></video>
					{/if}
					<video
						bind:this={localVideoEl}
						autoplay
						muted
						playsinline
						class="absolute right-3 bottom-3 aspect-video w-24 rounded-xl border border-white/20 bg-black object-cover"
					></video>
				{:else}
					<div class="grid h-full place-items-center">
						<div class="space-y-3">
							<Icon name="i-lucide-phone" class="mx-auto size-12 text-primary-300" />
							{#if callGroupId}
								<p class="text-[12px] text-white/70">
									{Math.max(1, remoteParticipants.length + 1)} participants connected
								</p>
							{/if}
						</div>
					</div>
				{/if}
				<audio bind:this={remoteAudioEl} autoplay></audio>
				{#if activeCall === 'voice'}
					{#each remoteParticipants as participant (participant.peer)}
						<audio use:streamSource={participant.stream} autoplay></audio>
					{/each}
				{/if}
			</div>
			<div>
				<p class="text-[15px] font-bold">{callDisplayTitle()}</p>
				<p class="mt-1 text-[12px] text-[var(--ui-text-muted)]">
					{callState === 'incoming'
						? 'Incoming encrypted call request'
						: callState === 'outgoing'
							? 'Calling...'
							: callState === 'connected'
								? 'Connected'
								: 'Connecting...'}
					{#if callGroupId && callState !== 'incoming'}
						- {Math.max(1, remoteParticipants.length + 1)} joined
					{/if}
				</p>
				{#if callError}
					<p class="mt-2 text-[12px] text-[var(--tone-error-text)]">{callError}</p>
				{/if}
			</div>
			<div class="flex justify-center gap-2">
				{#if callState === 'incoming'}
					<Button
						color="primary"
						icon={activeCall === 'video' ? 'i-lucide-video' : 'i-lucide-phone'}
						onclick={() => acceptIncomingCall()}
					>
						Answer
					</Button>
				{:else}
					<Button
						color="neutral"
						variant="soft"
						square
						icon={micEnabled ? 'i-lucide-mic' : 'i-lucide-mic-off'}
						aria-label="Microphone"
						onclick={toggleMic}
					/>
					{#if activeCall === 'video'}
						<Button
							color="neutral"
							variant="soft"
							square
							icon={cameraEnabled ? 'i-lucide-camera' : 'i-lucide-camera-off'}
							aria-label="Camera"
							onclick={toggleCamera}
						/>
					{:else}
						<Button
							color="neutral"
							variant="soft"
							square
							icon="i-lucide-video"
							aria-label="Switch to video"
							onclick={switchToVideo}
						/>
					{/if}
					{#if callGroupId}
						<Button
							color="primary"
							variant="soft"
							icon="i-lucide-user-plus"
							onclick={inviteGroupMembersToActiveCall}
						>
							Invite again
						</Button>
					{/if}
				{/if}
			</div>
		</div>
	{/if}
	{#snippet footer()}
		<Button color="error" icon="i-lucide-phone-off" onclick={() => endCall()}>End call</Button>
	{/snippet}
</Dialog>
