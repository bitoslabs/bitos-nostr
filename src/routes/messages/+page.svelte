<script lang="ts">
	import { browser } from '$app/environment';
	import { env } from '$env/dynamic/public';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import {
		GROUPS_KEY_PREFIX,
		GROUP_CONTROL_PROCESSED_KEY_PREFIX,
		GROUP_PERSIST_DEBOUNCE_MS,
		MAX_CACHED_GROUP_MESSAGES_PER_GROUP,
		MAX_CACHED_GROUPS,
		MAX_PROCESSED_GROUP_CONTROLS,
		callSignalText,
		formatDuration,
		groupControlText,
		groupInviteText,
		groupMessageText,
		initialsFor,
		isExpiredCallOffer,
		mediaFromMessage,
		messagePreview,
		parseCallSignal,
		parseGroupControl,
		parseGroupInvite,
		parseGroupMessage,
		parsePubkey
	} from '$lib/messages/protocol';
	import type {
		CallKind,
		CallOutcome,
		CallSignal,
		ChatFilter,
		ChatKind,
		ChatRow,
		GroupControlPayload,
		GroupControlType,
		GroupInvite,
		GroupMember,
		GroupMessage,
		GroupMessagePayload,
		GroupThread
	} from '$lib/messages/protocol';
	import { dms } from '$lib/nostr/dms.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import type { Conversation, DirectMessage } from '$lib/nostr/types';
	import { humanBytes, type MediaProviderId, type UploadedMedia } from '$lib/media/uploaders';
	import { blocks } from '$lib/stores/blocks.svelte';
	import { media, providerLabel } from '$lib/stores/media.svelte';
	import { privacyNotificationSettings } from '$lib/stores/privacy-notification-settings.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { confirms } from '$lib/stores/confirms.svelte';
	import { callSettings } from '$lib/stores/call-settings.svelte';
	import {
		playConnectedTone,
		playOutgoingTone,
		playRingtone,
		stopRingtone
	} from '$lib/calls/ringtone';
	import { shortKey, timeAgo } from '$lib/utils/format';
	import { canReceiveNewCall, canStartNewCall } from '$lib/messages/call-admission';
	import {
		shouldRemoveGroupPeer,
		shouldStartCallTimeout,
		shouldStartReconnectTimeout
	} from '$lib/messages/call-lifecycle';

	type MessageAttachment = UploadedMedia & {
		name: string;
	};

	type CallState = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'connected' | 'reconnecting';
	type CallQuality = 'unknown' | 'good' | 'fair' | 'poor';
	type OutputMediaElement = HTMLMediaElement & {
		setSinkId?: (sinkId: string) => Promise<void>;
	};
	type AudioDestinationWithSink = AudioDestinationNode & {
		setSinkId?: (sinkId: string) => Promise<void>;
	};
	type PictureInPictureDocument = Document & {
		pictureInPictureEnabled?: boolean;
		pictureInPictureElement?: Element | null;
		exitPictureInPicture?: () => Promise<void>;
	};
	type PictureInPictureVideoElement = HTMLVideoElement & {
		requestPictureInPicture?: () => Promise<unknown>;
	};
	type PeerStatsSnapshot = {
		packetsLost: number;
		packetsReceived: number;
	};
	type PermissionStateValue = 'granted' | 'denied' | 'prompt' | 'unknown';

	const CALL_SETUP_TIMEOUT_MS = 45_000;
	const CALL_RECONNECT_TIMEOUT_MS = 10_000;
	const CALL_DEVICES_KEY_PREFIX = 'messages-call-devices:';

	type RemoteParticipant = {
		peer: string;
		name: string;
		stream: MediaStream;
	};

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
	let preCallKind = $state<CallKind | null>(null);
	let showPreCall = $state(false);
	let callState = $state<CallState>('idle');
	let callPeer = $state('');
	let callGroupId = $state('');
	let callTitle = $state('');
	let callId = $state('');
	let callError = $state('');
	let micLevel = $state(0);
	let speakerTestPlaying = $state(false);
	let microphonePermission = $state<PermissionStateValue>('unknown');
	let cameraPermission = $state<PermissionStateValue>('unknown');
	let incomingCall = $state<CallSignal | null>(null);
	let micEnabled = $state(true);
	let cameraEnabled = $state(true);
	let screenSharing = $state(false);
	let microphones = $state<MediaDeviceInfo[]>([]);
	let cameras = $state<MediaDeviceInfo[]>([]);
	let speakers = $state<MediaDeviceInfo[]>([]);
	let selectedMicrophone = $state('');
	let selectedCamera = $state('');
	let selectedSpeaker = $state('');
	let callQuality = $state<CallQuality>('unknown');
	let callQualityDetail = $state('');
	let callRttMs = $state<number | null>(null);
	let callLossPercent = $state<number | null>(null);
	let callIceState = $state('');
	let callTransport = $state('');
	let showCallDiagnostics = $state(false);
	let iceRestartInFlight = false;
	let lastIceRestartAt = 0;
	let callPictureInPicture = $state(false);
	let showCall = $state(false);
	let callMinimized = $state(false);
	let groupsLoaded = $state(false);
	let processedGroupControlsLoaded = false;
	let lastResolvedTo = $state('');
	let lastResolvedDraftText = $state('');
	let lastAutoAnswerCallId = $state('');
	let uploadingMessage = $state(false);
	let messageAttachments = $state<MessageAttachment[]>([]);
	let messageFileInput = $state<HTMLInputElement | null>(null);
	let messageImageInput = $state<HTMLInputElement | null>(null);
	let callConnectedAt = 0;
	let callElapsedSeconds = $state(0);
	let groupPersistTimer: ReturnType<typeof setTimeout> | null = null;
	let threadEl: HTMLDivElement | undefined = $state();
	let localVideoEl: HTMLVideoElement | undefined = $state();
	let remoteVideoEl: HTMLVideoElement | undefined = $state();
	let remoteAudioEl: HTMLAudioElement | undefined = $state();
	let callMediaPanel: HTMLDivElement | undefined = $state();
	let callFullscreen = $state(false);
	// Self-view (local video) drag-to-reposition state.
	let selfViewPos = $state<{ x: number; y: number } | null>(null);
	let selfViewDrag = $state<{ ox: number; oy: number } | null>(null);
	// Background blur (soft-focus privacy filter) state.
	let backgroundBlurred = $state(false);
	let blurCanvas: HTMLCanvasElement | null = null;
	let blurCtx: CanvasRenderingContext2D | null = null;
	let blurStream: MediaStream | null = null;
	let blurVideo: HTMLVideoElement | null = null;
	let blurAnimFrame: number | null = null;
	// Raise-hand (group calls) state.
	let raisedHands = $state<Set<string>>(new Set());
	let selfHandRaised = $state(false);
	// Pre-call network heads-up.
	let networkWarning = $state('');
	// Push-to-talk (hold Space) + first-time shortcuts hint.
	let pushToTalkActive = false;
	let showShortcutsHint = $state(false);
	const processedGroupMessageIds = new Set<string>();
	const processedGroupControlIds = new Set<string>();
	const processedCallSignalIds = new Set<string>();
	const processedGroupCallLogIds = new Set<string>();
	const closedCallIds = new Set<string>();
	const removedGroupIds = new Set<string>();
	let localStream = $state<MediaStream | null>(null);
	let screenStream: MediaStream | null = null;
	let remoteStream: MediaStream | null = null;
	let remoteParticipants = $state<RemoteParticipant[]>([]);
	let peerConnection: RTCPeerConnection | null = null;
	const peerConnections = new Map<string, RTCPeerConnection>();
	const remoteStreamsByPeer = new Map<string, MediaStream>();
	const pendingIceCandidatesByPeer = new Map<string, RTCIceCandidateInit[]>();
	const previousInboundStats = new Map<string, PeerStatsSnapshot>();
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
			.filter((conversation) => !blocks.has(conversation.peer))
			.map((conversation) => {
				const profile = profiles.get(conversation.peer);
				const selfChat = conversation.peer === identity.current?.pk;
				const name = selfChat
					? 'Saved notes'
					: profile?.display_name || profile?.name || shortKey(conversation.peer);
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
					previewPrefix: selfChat ? '' : visibleLastMessage?.mine ? 'You:' : '',
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
		(privacyNotificationSettings.state.dms
			? dms.conversations
					.filter((conversation) => !blocks.has(conversation.peer))
					.reduce((total, conversation) => total + visibleDmUnread(conversation), 0)
			: 0) + groupThreads.reduce((total, group) => total + group.unread, 0)
	);
	const ownActivityStatus = $derived(
		privacyNotificationSettings.state.activity ? 'Online' : 'Offline'
	);

	const groupsStorageKey = $derived(`${GROUPS_KEY_PREFIX}:${identity.current?.pk ?? 'anonymous'}`);
	const processedGroupControlsStorageKey = $derived(
		`${GROUP_CONTROL_PROCESSED_KEY_PREFIX}:${identity.current?.pk ?? 'anonymous'}`
	);

	function markCallClosed(id?: string) {
		if (id) closedCallIds.add(id);
	}

	function isSecureDm(message: DirectMessage | undefined | null) {
		return message?.protocol === 'nip17';
	}

	function displayNameForPubkey(pubkey: string) {
		const profile = profiles.get(pubkey);
		return profile?.display_name || profile?.name || shortKey(pubkey);
	}

	function profileHref(pubkey?: string) {
		return pubkey ? `/profile/${pubkey}` : '';
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
		uploadingMessage = true;
		let ok = 0;
		try {
			for (const file of Array.from(files)) {
				try {
					const uploaded = await media.upload(file, provider === 'none' ? undefined : provider, {
						pubkey: identity.current?.pk,
						purpose: 'message'
					});
					messageAttachments = [...messageAttachments, { ...uploaded, name: file.name }];
					ok++;
				} catch (e) {
					toasts.error(`${file.name}: ${(e as Error).message}`);
				}
			}
			if (ok) {
				toasts.success(
					`Uploaded ${ok} ${ok === 1 ? 'file' : 'files'} via ${providerLabel(provider === 'none' ? 'server' : provider)}`
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

	function attachCallMedia() {
		if (localVideoEl) localVideoEl.srcObject = screenStream ?? localStream;
		if (remoteVideoEl) remoteVideoEl.srcObject = remoteStream;
		if (remoteAudioEl) remoteAudioEl.srcObject = remoteStream;
		void applySpeakerOutput();
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

	function pictureInPictureEvents(node: HTMLVideoElement) {
		node.addEventListener('enterpictureinpicture', onPictureInPictureChange);
		node.addEventListener('leavepictureinpicture', onPictureInPictureChange);
		return {
			destroy() {
				node.removeEventListener('enterpictureinpicture', onPictureInPictureChange);
				node.removeEventListener('leavepictureinpicture', onPictureInPictureChange);
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

	function callIceServers(): RTCIceServer[] {
		const turnUrls = (env.PUBLIC_CALL_TURN_URLS ?? '')
			.split(',')
			.map((url) => url.trim())
			.filter(Boolean);
		return [
			{ urls: 'stun:stun.l.google.com:19302' },
			...(turnUrls.length
				? [
						{
							urls: turnUrls,
							username: env.PUBLIC_CALL_TURN_USERNAME,
							credential: env.PUBLIC_CALL_TURN_CREDENTIAL
						}
					]
				: [])
		];
	}

	function markCallConnected() {
		if (!callConnectedAt) {
			callConnectedAt = Date.now();
			callElapsedSeconds = 0;
		}
		callState = 'connected';
		void loadCallDevices();
	}

	function closePeerConnection() {
		peerConnection?.close();
		peerConnection = null;
		for (const pc of peerConnections.values()) pc.close();
		peerConnections.clear();
		remoteStreamsByPeer.clear();
		pendingIceCandidatesByPeer.clear();
		previousInboundStats.clear();
		remoteParticipants = [];
	}

	function removeFailedGroupPeer(peer: string) {
		peerConnections.get(peer)?.close();
		peerConnections.delete(peer);
		remoteStreamsByPeer.delete(peer);
		pendingIceCandidatesByPeer.delete(peer);
		remoteParticipants = remoteParticipants.filter((participant) => participant.peer !== peer);
		if (raisedHands.has(peer)) {
			const next = new Set(raisedHands);
			next.delete(peer);
			raisedHands = next;
		}
		if (!peerConnections.size) {
			callState = 'reconnecting';
			callError = 'All group participants disconnected';
		} else {
			callState = 'connected';
			callError = `${displayNameForPubkey(peer)} disconnected`;
		}
	}

	function stopLocalMedia() {
		localStream?.getTracks().forEach((track) => track.stop());
		localStream = null;
	}

	function stopScreenStream() {
		if (screenStream) {
			for (const track of screenStream.getTracks()) track.onended = null;
			screenStream.getTracks().forEach((track) => track.stop());
		}
		screenStream = null;
		screenSharing = false;
	}

	function resetCallState() {
		if (browser && document.fullscreenElement === callMediaPanel) void document.exitFullscreen();
		callFullscreen = false;
		closePeerConnection();
		stopLocalMedia();
		stopScreenStream();
		stopBlur();
		stopRingtone();
		remoteStream = null;
		pendingIceCandidates = [];
		activeCall = null;
		preCallKind = null;
		showPreCall = false;
		callState = 'idle';
		callPeer = '';
		callGroupId = '';
		callTitle = '';
		callId = '';
		callError = '';
		micLevel = 0;
		callConnectedAt = 0;
		callElapsedSeconds = 0;
		callQuality = 'unknown';
		callQualityDetail = '';
		callRttMs = null;
		callLossPercent = null;
		callIceState = '';
		callTransport = '';
		showCallDiagnostics = false;
		callPictureInPicture = false;
		incomingCall = null;
		micEnabled = true;
		cameraEnabled = true;
		showCall = false;
		callMinimized = false;
		backgroundBlurred = false;
		raisedHands = new Set();
		selfHandRaised = false;
		resetSelfView();
		networkWarning = '';
		pushToTalkActive = false;
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

	function supportsSpeakerOutput() {
		return (
			browser && typeof (HTMLMediaElement.prototype as OutputMediaElement).setSinkId === 'function'
		);
	}

	function supportsPictureInPicture() {
		if (!browser) return false;
		const pipDocument = document as PictureInPictureDocument;
		return (
			activeCall === 'video' &&
			!!pipDocument.pictureInPictureEnabled &&
			typeof (remoteVideoEl as PictureInPictureVideoElement | undefined)
				?.requestPictureInPicture === 'function'
		);
	}

	function deviceLabel(device: MediaDeviceInfo, fallback: string, index: number) {
		return device.label || `${fallback} ${index + 1}`;
	}

	async function refreshMediaPermissions() {
		if (!browser || !navigator.permissions?.query) return;
		const read = async (name: 'microphone' | 'camera') => {
			try {
				const status = await navigator.permissions.query({ name } as PermissionDescriptor);
				return status.state as PermissionStateValue;
			} catch {
				return 'unknown' as PermissionStateValue;
			}
		};
		[microphonePermission, cameraPermission] = await Promise.all([
			read('microphone'),
			read('camera')
		]);
	}

	function callDevicesStorageKey() {
		return `${CALL_DEVICES_KEY_PREFIX}${identity.current?.pk ?? 'anonymous'}`;
	}

	function loadSavedCallDevices() {
		if (!browser) return;
		try {
			const saved = JSON.parse(localStorage.getItem(callDevicesStorageKey()) ?? '{}') as {
				microphone?: string;
				camera?: string;
				speaker?: string;
			};
			if (saved.microphone) selectedMicrophone = saved.microphone;
			if (saved.camera) selectedCamera = saved.camera;
			if (saved.speaker) selectedSpeaker = saved.speaker;
		} catch {
			/* Ignore unavailable or invalid browser storage. */
		}
	}

	function saveCallDevices() {
		if (!browser) return;
		try {
			localStorage.setItem(
				callDevicesStorageKey(),
				JSON.stringify({
					microphone: selectedMicrophone,
					camera: selectedCamera,
					speaker: selectedSpeaker
				})
			);
		} catch {
			/* Storage may be disabled in private browsing. */
		}
	}

	async function loadCallDevices() {
		if (!browser || !navigator.mediaDevices?.enumerateDevices) return;
		try {
			const devices = await navigator.mediaDevices.enumerateDevices();
			microphones = devices.filter((device) => device.kind === 'audioinput');
			cameras = devices.filter((device) => device.kind === 'videoinput');
			speakers = supportsSpeakerOutput()
				? devices.filter((device) => device.kind === 'audiooutput')
				: [];
			const currentMicrophone = localStream?.getAudioTracks()[0]?.getSettings().deviceId;
			const currentCamera = localStream?.getVideoTracks()[0]?.getSettings().deviceId;
			selectedMicrophone =
				currentMicrophone ||
				(microphones.some((device) => device.deviceId === selectedMicrophone)
					? selectedMicrophone
					: '') ||
				microphones[0]?.deviceId ||
				'';
			selectedCamera =
				currentCamera ||
				(cameras.some((device) => device.deviceId === selectedCamera) ? selectedCamera : '') ||
				cameras[0]?.deviceId ||
				'';
			selectedSpeaker =
				(speakers.some((device) => device.deviceId === selectedSpeaker) ? selectedSpeaker : '') ||
				speakers[0]?.deviceId ||
				'';
			await applySpeakerOutput();
		} catch {
			/* Device labels may be unavailable until the browser grants media permission. */
		}
	}

	async function applySpeakerOutput(sinkId = selectedSpeaker) {
		if (!browser || !sinkId || !supportsSpeakerOutput()) return;
		const mediaElements = [
			remoteVideoEl,
			remoteAudioEl,
			...document.querySelectorAll<HTMLMediaElement>('[data-call-output]')
		].filter((element): element is OutputMediaElement => !!element);
		await Promise.allSettled(
			[...new Set(mediaElements)].map((element) => element.setSinkId?.(sinkId))
		);
	}

	async function changeSpeaker(deviceId: string) {
		selectedSpeaker = deviceId;
		saveCallDevices();
		await applySpeakerOutput(deviceId);
	}

	async function testSpeakerOutput() {
		if (!browser || !supportsSpeakerOutput() || speakerTestPlaying) return;
		const context = new AudioContext();
		try {
			const destination = context.destination as AudioDestinationWithSink;
			if (selectedSpeaker && destination.setSinkId) await destination.setSinkId(selectedSpeaker);
			await context.resume();
			const gain = context.createGain();
			gain.gain.value = 0.06;
			gain.connect(destination);
			speakerTestPlaying = true;
			const startedAt = context.currentTime;
			[0, 0.22, 0.44].forEach((offset, index) => {
				const oscillator = context.createOscillator();
				oscillator.type = 'sine';
				oscillator.frequency.value = index === 1 ? 880 : 660;
				oscillator.connect(gain);
				oscillator.start(startedAt + offset);
				oscillator.stop(startedAt + offset + 0.14);
			});
			setTimeout(() => {
				speakerTestPlaying = false;
				void context.close();
			}, 750);
		} catch {
			speakerTestPlaying = false;
			await context.close();
			toasts.info('Speaker testing is not available in this browser');
		}
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
				audio: selectedMicrophone ? { deviceId: { exact: selectedMicrophone } } : true,
				video:
					kind === 'video'
						? selectedCamera
							? { deviceId: { exact: selectedCamera } }
							: true
						: false
			});
		} else if (kind === 'video' && !localStream.getVideoTracks().length) {
			const videoStream = await navigator.mediaDevices.getUserMedia({
				video: selectedCamera ? { deviceId: { exact: selectedCamera } } : true
			});
			const [videoTrack] = videoStream.getVideoTracks();
			if (videoTrack) localStream.addTrack(videoTrack);
		}
		localStream.getAudioTracks().forEach((track) => (track.enabled = micEnabled));
		localStream.getVideoTracks().forEach((track) => (track.enabled = cameraEnabled));
		attachCallMedia();
		void loadCallDevices();
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
			iceServers: callIceServers()
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
			markCallConnected();
			attachCallMedia();
		};
		pc.onconnectionstatechange = () => {
			if (pc.connectionState === 'connected') markCallConnected();
			if (shouldRemoveGroupPeer(!!options.multi, pc.connectionState)) {
				removeFailedGroupPeer(peer);
				return;
			}
			if (
				!options.multi &&
				(pc.connectionState === 'failed' || pc.connectionState === 'disconnected')
			) {
				callState = 'reconnecting';
				callError = 'Reconnecting...';
				void restartCallIce();
			}
		};
		const stream = await ensureLocalMedia(kind);
		for (const track of stream.getTracks()) pc.addTrack(track, stream);
		attachCallMedia();
		return pc;
	}

	async function restartCallIce() {
		if (
			iceRestartInFlight ||
			!identity.current ||
			!callId ||
			!activeCall ||
			(!callPeer && !peerConnections.size) ||
			Date.now() - lastIceRestartAt < 3_000
		)
			return;
		const targets = peerConnections.size
			? [...peerConnections.entries()]
			: callPeer && peerConnection
				? [[callPeer, peerConnection] as [string, RTCPeerConnection]]
				: [];
		if (!targets.length) return;
		iceRestartInFlight = true;
		lastIceRestartAt = Date.now();
		try {
			await Promise.all(
				targets.map(async ([peer, pc]) => {
					const offer = await pc.createOffer({ iceRestart: true });
					await pc.setLocalDescription(offer);
					await sendCallSignal(peer, {
						callId,
						type: 'offer',
						kind: activeCall as CallKind,
						from: identity.current?.pk ?? '',
						groupId: callGroupId || undefined,
						sdp: offer.sdp
					});
				})
			);
			callError = 'Reconnecting...';
		} catch {
			callError = 'Could not refresh the call connection';
		} finally {
			iceRestartInFlight = false;
		}
	}

	function toggleMic() {
		micEnabled = !micEnabled;
		localStream?.getAudioTracks().forEach((track) => (track.enabled = micEnabled));
	}

	async function replaceLocalTrack(kind: 'audio' | 'video', deviceId: string) {
		if (!browser || !navigator.mediaDevices?.getUserMedia || !localStream) return;
		const nextStream = await navigator.mediaDevices.getUserMedia({
			audio: kind === 'audio' ? { deviceId: { exact: deviceId } } : false,
			video: kind === 'video' ? { deviceId: { exact: deviceId } } : false
		});
		const [nextTrack] =
			kind === 'audio' ? nextStream.getAudioTracks() : nextStream.getVideoTracks();
		if (!nextTrack) return;
		nextTrack.enabled = kind === 'audio' ? micEnabled : cameraEnabled;
		const oldTracks =
			kind === 'audio' ? localStream.getAudioTracks() : localStream.getVideoTracks();
		for (const oldTrack of oldTracks) {
			localStream.removeTrack(oldTrack);
			oldTrack.stop();
		}
		localStream.addTrack(nextTrack);
		if (kind === 'audio' || !screenSharing) {
			await Promise.all(
				callPeerConnections().map(async (pc) => {
					const sender = pc.getSenders().find((item) => item.track?.kind === kind);
					if (sender) await sender.replaceTrack(nextTrack);
					else pc.addTrack(nextTrack, localStream as MediaStream);
				})
			);
		}
		attachCallMedia();
	}

	async function changeMicrophone(deviceId: string) {
		if (!deviceId || deviceId === selectedMicrophone) return;
		selectedMicrophone = deviceId;
		saveCallDevices();
		try {
			if (localStream) await replaceLocalTrack('audio', deviceId);
		} catch (e) {
			callError = mediaErrorMessage(e, activeCall ?? 'voice');
			toasts.error(callError);
		}
	}

	async function changeCamera(deviceId: string) {
		if (!deviceId || deviceId === selectedCamera) return;
		selectedCamera = deviceId;
		saveCallDevices();
		try {
			if (localStream && activeCall === 'video') await replaceLocalTrack('video', deviceId);
		} catch (e) {
			callError = mediaErrorMessage(e, 'video');
			toasts.error(callError);
		}
	}

	async function toggleCallFullscreen() {
		if (!browser || !callMediaPanel) return;
		try {
			if (document.fullscreenElement) await document.exitFullscreen();
			else await callMediaPanel.requestFullscreen();
		} catch {
			toasts.info('Fullscreen is not available in this browser');
		}
	}

	function onFullscreenChange() {
		callFullscreen = document.fullscreenElement === callMediaPanel;
	}

	async function togglePictureInPicture() {
		if (!remoteVideoEl || !supportsPictureInPicture()) return;
		const pipDocument = document as PictureInPictureDocument;
		try {
			if (pipDocument.pictureInPictureElement && pipDocument.exitPictureInPicture) {
				await pipDocument.exitPictureInPicture();
				callPictureInPicture = false;
				return;
			}
			await (remoteVideoEl as PictureInPictureVideoElement).requestPictureInPicture?.();
			callPictureInPicture = true;
		} catch {
			toasts.info('Picture-in-picture is not available for this video yet');
		}
	}

	function onPictureInPictureChange() {
		const pipDocument = document as PictureInPictureDocument;
		callPictureInPicture = pipDocument.pictureInPictureElement === remoteVideoEl;
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

	function callPeerConnections() {
		return peerConnections.size
			? [...peerConnections.values()]
			: peerConnection
				? [peerConnection]
				: [];
	}

	async function updateCallQuality() {
		const connections = callPeerConnections();
		if (!connections.length) {
			callQuality = 'unknown';
			callQualityDetail = '';
			callRttMs = null;
			callLossPercent = null;
			callIceState = '';
			callTransport = '';
			return;
		}
		let highestRtt = 0;
		let highestLoss = 0;
		let selectedIceState = '';
		let selectedTransport = '';
		for (const [index, pc] of connections.entries()) {
			selectedIceState = pc.iceConnectionState;
			const stats = await pc.getStats();
			stats.forEach((report) => {
				const stat = report as RTCStats & {
					type: string;
					roundTripTime?: number;
					currentRoundTripTime?: number;
					state?: string;
					nominated?: boolean;
					protocol?: string;
					networkType?: string;
					packetsLost?: number;
					packetsReceived?: number;
				};
				if (stat.type === 'candidate-pair' && stat.state === 'succeeded' && stat.nominated) {
					highestRtt = Math.max(highestRtt, stat.currentRoundTripTime ?? stat.roundTripTime ?? 0);
				}
				if (stat.type === 'candidate-pair' && stat.state === 'succeeded' && stat.nominated) {
					selectedTransport = stat.protocol ?? stat.networkType ?? '';
				}
				if (stat.type === 'inbound-rtp' && typeof stat.packetsReceived === 'number') {
					const key = `${index}:${report.id}`;
					const previous = previousInboundStats.get(key);
					const currentLost = stat.packetsLost ?? 0;
					const currentReceived = stat.packetsReceived;
					if (previous) {
						const lostDelta = Math.max(0, currentLost - previous.packetsLost);
						const receivedDelta = Math.max(0, currentReceived - previous.packetsReceived);
						const totalDelta = lostDelta + receivedDelta;
						if (totalDelta > 0) highestLoss = Math.max(highestLoss, lostDelta / totalDelta);
					}
					previousInboundStats.set(key, {
						packetsLost: currentLost,
						packetsReceived: currentReceived
					});
				}
			});
		}
		if (!highestRtt && !highestLoss) {
			callQuality = 'unknown';
			callQualityDetail = 'Collecting network data';
			callRttMs = null;
			callLossPercent = null;
			callIceState = selectedIceState;
			callTransport = selectedTransport;
			return;
		}
		if (highestRtt > 0.5 || highestLoss > 0.08) callQuality = 'poor';
		else if (highestRtt > 0.25 || highestLoss > 0.03) callQuality = 'fair';
		else callQuality = 'good';
		const parts = [];
		if (highestRtt) parts.push(`${Math.round(highestRtt * 1000)} ms`);
		if (highestLoss) parts.push(`${Math.round(highestLoss * 100)}% loss`);
		callQualityDetail = parts.join(' - ');
		callRttMs = highestRtt ? Math.round(highestRtt * 1000) : null;
		callLossPercent = highestLoss ? Math.round(highestLoss * 100) : 0;
		callIceState = selectedIceState;
		callTransport = selectedTransport;
	}

	function callQualityLabel() {
		if (callQuality === 'good') return 'Good connection';
		if (callQuality === 'fair') return 'Fair connection';
		if (callQuality === 'poor') return 'Poor connection';
		return 'Checking connection';
	}

	function callQualityClass() {
		if (callQuality === 'good') return 'text-emerald-600 dark:text-emerald-300';
		if (callQuality === 'fair') return 'text-amber-600 dark:text-amber-300';
		if (callQuality === 'poor') return 'text-[var(--tone-error-text)]';
		return 'text-[var(--ui-text-muted)]';
	}

	async function copyCallDiagnostics() {
		if (!browser || !navigator.clipboard?.writeText) {
			toasts.info('Copying diagnostics is not available in this browser');
			return;
		}
		const report = [
			'BitOS call diagnostics',
			`Time: ${new Date().toISOString()}`,
			`Browser: ${navigator.userAgent}`,
			`Call type: ${activeCall ?? 'unknown'}${callGroupId ? ' (group)' : ''}`,
			`Quality: ${callQualityLabel()}`,
			`Round trip: ${callRttMs === null ? 'unknown' : `${callRttMs} ms`}`,
			`Packet loss: ${callLossPercent === null ? 'unknown' : `${callLossPercent}%`}`,
			`ICE state: ${callIceState || 'unknown'}`,
			`Transport: ${callTransport || 'unknown'}`,
			`Online: ${navigator.onLine ? 'yes' : 'no'}`
		].join('\n');
		try {
			await navigator.clipboard.writeText(report);
			toasts.success('Call diagnostics copied');
		} catch {
			toasts.info('Could not copy call diagnostics');
		}
	}

	function permissionLabel(state: PermissionStateValue) {
		if (state === 'granted') return 'Allowed';
		if (state === 'denied') return 'Blocked';
		if (state === 'prompt') return 'Needs permission';
		return 'Unavailable';
	}

	function permissionClass(state: PermissionStateValue) {
		if (state === 'granted') return 'text-emerald-600 dark:text-emerald-300';
		if (state === 'denied') return 'text-[var(--tone-error-text)]';
		return 'text-amber-600 dark:text-amber-300';
	}

	async function toggleScreenShare() {
		if (activeCall !== 'video' || callState !== 'connected' || !browser) return;
		if (screenSharing) {
			const camera = localStream?.getVideoTracks()[0];
			if (!camera) return;
			for (const pc of callPeerConnections()) {
				const sender = pc.getSenders().find((item) => item.track?.kind === 'video');
				if (sender) await sender.replaceTrack(camera);
			}
			stopScreenStream();
			attachCallMedia();
			return;
		}
		try {
			const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
			const screenTrack = stream.getVideoTracks()[0];
			if (!screenTrack) return;
			screenStream = stream;
			screenSharing = true;
			screenTrack.onended = () => {
				void toggleScreenShare();
			};
			for (const pc of callPeerConnections()) {
				const sender = pc.getSenders().find((item) => item.track?.kind === 'video');
				if (sender) await sender.replaceTrack(screenTrack);
			}
			attachCallMedia();
		} catch (error) {
			if ((error as DOMException)?.name !== 'AbortError') {
				callError = 'Could not start screen sharing';
				toasts.error(callError);
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

	/* ---------- Self-view drag-to-reposition ---------- */
	function selfViewDown(e: PointerEvent) {
		const panel = callMediaPanel?.getBoundingClientRect();
		if (!panel) return;
		const target = e.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		selfViewDrag = { ox: e.clientX - rect.left, oy: e.clientY - rect.top };
		try {
			target.setPointerCapture(e.pointerId);
		} catch {
			/* pointer capture may be unavailable */
		}
	}

	function selfViewMove(e: PointerEvent) {
		if (!selfViewDrag || !callMediaPanel) return;
		const panel = callMediaPanel.getBoundingClientRect();
		const target = e.currentTarget as HTMLElement;
		const w = target.offsetWidth;
		const h = target.offsetHeight;
		const margin = 8;
		let x = e.clientX - panel.left - selfViewDrag.ox;
		let y = e.clientY - panel.top - selfViewDrag.oy;
		x = Math.max(margin, Math.min(x, panel.width - w - margin));
		y = Math.max(margin, Math.min(y, panel.height - h - margin));
		selfViewPos = { x, y };
	}

	function selfViewUp(e: PointerEvent) {
		selfViewDrag = null;
		try {
			(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
		} catch {
			/* noop */
		}
	}

	function resetSelfView() {
		selfViewPos = null;
		selfViewDrag = null;
	}

	/* ---------- Background blur (soft-focus privacy filter) ---------- */
	function stopBlur() {
		if (blurAnimFrame) cancelAnimationFrame(blurAnimFrame);
		blurAnimFrame = null;
		blurStream?.getTracks().forEach((track) => track.stop());
		blurStream = null;
		blurCanvas = null;
		blurCtx = null;
		if (blurVideo) blurVideo.srcObject = null;
	}

	async function toggleBackgroundBlur() {
		if (activeCall !== 'video' || !browser) return;
		const camera = localStream?.getVideoTracks()[0];
		if (!camera) return;
		if (backgroundBlurred) {
			stopBlur();
			for (const pc of callPeerConnections()) {
				const sender = pc.getSenders().find((item) => item.track?.kind === 'video');
				if (sender) await sender.replaceTrack(camera);
			}
			backgroundBlurred = false;
			return;
		}
		try {
			if (!blurVideo) {
				blurVideo = document.createElement('video');
				blurVideo.muted = true;
				blurVideo.playsInline = true;
			}
			blurVideo.srcObject = new MediaStream([camera]);
			await blurVideo.play();
			blurCanvas = document.createElement('canvas');
			blurCanvas.width = 640;
			blurCanvas.height = 360;
			const ctx = blurCanvas.getContext('2d');
			if (!ctx || typeof blurCanvas.captureStream !== 'function') {
				stopBlur();
				toasts.info('Background blur is not supported in this browser');
				return;
			}
			blurCtx = ctx;
			const draw = () => {
				if (!blurCtx || !blurVideo || !blurCanvas) return;
				blurCtx.save();
				blurCtx.filter = 'blur(10px)';
				blurCtx.drawImage(blurVideo, 0, 0, blurCanvas.width, blurCanvas.height);
				blurCtx.restore();
				blurAnimFrame = requestAnimationFrame(draw);
			};
			draw();
			blurStream = blurCanvas.captureStream(24);
			const blurTrack = blurStream.getVideoTracks()[0];
			if (!blurTrack) {
				stopBlur();
				return;
			}
			for (const pc of callPeerConnections()) {
				const sender = pc.getSenders().find((item) => item.track?.kind === 'video');
				if (sender) await sender.replaceTrack(blurTrack);
			}
			backgroundBlurred = true;
		} catch {
			stopBlur();
			callError = 'Could not enable background blur';
			toasts.error(callError);
		}
	}

	/* ---------- Raise hand (group calls) ---------- */
	async function broadcastCallState(state: 'hand-up' | 'hand-down') {
		const me = identity.current;
		const group = groupThreads.find((thread) => thread.id === callGroupId);
		if (!me || !group || !callId || !activeCall) return;
		const recipients = groupCallRecipients(group);
		await Promise.allSettled(
			recipients.map((peer) =>
				sendCallSignal(peer, {
					callId,
					type: 'state',
					kind: activeCall as CallKind,
					from: me.pk,
					groupId: callGroupId || undefined,
					state
				})
			)
		);
	}

	async function toggleRaiseHand() {
		if (!callGroupId || callState !== 'connected') return;
		selfHandRaised = !selfHandRaised;
		const next = new Set(raisedHands);
		const me = identity.current?.pk;
		if (selfHandRaised && me) next.add(me);
		else if (me) next.delete(me);
		raisedHands = next;
		await broadcastCallState(selfHandRaised ? 'hand-up' : 'hand-down');
		toasts.info(selfHandRaised ? 'You raised your hand' : 'Hand lowered');
	}

	function applyCallStateSignal(from: string, state: 'hand-up' | 'hand-down' | undefined) {
		const next = new Set(raisedHands);
		if (state === 'hand-up') {
			if (!next.has(from)) {
				next.add(from);
				toasts.info(`${displayNameForPubkey(from)} raised their hand`);
			}
		} else if (state === 'hand-down') {
			next.delete(from);
		}
		raisedHands = next;
	}

	/* ---------- Pre-call network heads-up ---------- */
	type NetworkInfo = {
		effectiveType?: string;
		downlink?: number;
		rtt?: number;
	};

	function refreshNetworkWarning() {
		if (!browser) {
			networkWarning = '';
			return;
		}
		const conn = (navigator as unknown as { connection?: NetworkInfo }).connection;
		if (!conn) {
			networkWarning = '';
			return;
		}
		const slowTypes = ['slow-2g', '2g'];
		if (conn.effectiveType && slowTypes.includes(conn.effectiveType)) {
			networkWarning = `Slow network (${conn.effectiveType}) — call quality may be poor.`;
			return;
		}
		const rtt = typeof conn.rtt === 'number' ? conn.rtt : 0;
		const downlink = typeof conn.downlink === 'number' ? conn.downlink : 0;
		if (rtt > 0 && rtt > 600) {
			networkWarning = `High latency (~${Math.round(rtt)} ms) detected — call may lag.`;
			return;
		}
		if (downlink > 0 && downlink < 0.5) {
			networkWarning = 'Low bandwidth detected — video may be choppy.';
			return;
		}
		networkWarning = '';
	}

	/* ---------- Keyboard shortcuts ---------- */
	function isTypingTarget() {
		if (!browser) return false;
		const el = document.activeElement as HTMLElement | null;
		if (!el) return false;
		const tag = el.tagName;
		return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
	}

	function onCallKeydown(e: KeyboardEvent) {
		if (!showCall || !activeCall) return;
		if (e.key === 'Escape') {
			if (callFullscreen) {
				void toggleCallFullscreen();
				return;
			}
			if (!callMinimized) callMinimized = true;
			return;
		}
		if (isTypingTarget() || e.repeat) return;
		const key = e.key.toLowerCase();
		if (key === 'm') {
			e.preventDefault();
			toggleMic();
		} else if (key === 'v') {
			e.preventDefault();
			if (activeCall === 'video') toggleCamera();
			else void switchToVideo();
		} else if (key === 'h' && callGroupId) {
			e.preventDefault();
			void toggleRaiseHand();
		} else if (key === 'b' && activeCall === 'video') {
			e.preventDefault();
			void toggleBackgroundBlur();
		} else if (e.code === 'Space') {
			e.preventDefault();
			if (!micEnabled) {
				toggleMic();
				pushToTalkActive = true;
			}
		}
	}

	function onCallKeyup(e: KeyboardEvent) {
		if (e.code === 'Space' && pushToTalkActive) {
			pushToTalkActive = false;
			if (micEnabled) toggleMic();
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
		const peer = parsePubkey(param ?? '');
		if (!peer || peer === lastResolvedTo) return;
		lastResolvedTo = peer;
		dms.forPeer(peer);
		profiles.ensure([peer]);
		if (selected !== peer) selectChat(peer);
	}

	function resolveDraftText(param: string | null) {
		const text = param ?? '';
		if (!text.trim() || text === lastResolvedDraftText) return;
		lastResolvedDraftText = text;
		draft = text;
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
		await dms.send(member.pubkey, groupInviteText(group, identity.current?.pk ?? ''));
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
		const content = groupMessageText(group, identity.current?.pk ?? '', body);
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
		const content = groupControlText(group, identity.current?.pk ?? '', type, member);
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
		if (
			!(await confirms.danger({
				title: `Leave “${group.name}”?`,
				message: 'You will stop receiving messages from this group.',
				confirmLabel: 'Leave',
				icon: 'i-lucide-log-out'
			}))
		)
			return;
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
						? { ...member, name: 'You', initials: 'YO', status: ownActivityStatus }
						: member
				);
				if (!members.some((member) => member.pubkey === me)) {
					members.unshift({ name: 'You', initials: 'YO', status: ownActivityStatus });
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

	async function deleteGroup(groupId: string) {
		if (
			!(await confirms.danger({
				title: 'Delete this group?',
				message: 'This local group and its messages will be removed from this device.',
				confirmLabel: 'Delete'
			}))
		)
			return;
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
		const label =
			signal.outcome === 'missed'
				? `${signal.kind === 'video' ? 'Video' : 'Voice'} call missed`
				: signal.outcome === 'declined'
					? `${signal.kind === 'video' ? 'Video' : 'Voice'} call declined`
					: `${signal.kind === 'video' ? 'Video' : 'Voice'} call ended`;
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

	function onCallVisibilityChange() {
		if (document.visibilityState !== 'visible' || !showCall || !activeCall) return;
		if (callState === 'connected' || callState === 'reconnecting') {
			callState = 'reconnecting';
			callError = 'Refreshing connection...';
			lastIceRestartAt = 0;
			void restartCallIce();
		}
	}

	function onCallPageHide() {
		if (!showCall || !activeCall || callState === 'idle') return;
		void endCall(true, callState === 'incoming' ? 'declined' : 'ended');
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
			callError = '';
			showCall = true;
			callMinimized = false;
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
		if (!canStartNewCall(showCall, callState)) {
			toasts.info('Finish the current call before starting another one.');
			return;
		}
		if (active?.kind === 'group' && activeGroup) {
			preCallKind = kind;
			activeCall = kind;
			callGroupId = activeGroup.id;
			callTitle = activeGroup.name;
			callError = '';
			showPreCall = true;
			refreshNetworkWarning();
			try {
				await ensureLocalMedia(kind);
				await refreshMediaPermissions();
			} catch (e) {
				callError = mediaErrorMessage(e, kind);
				toasts.error(callError);
			}
			return;
		}
		if (!active || active.kind !== 'dm') {
			toasts.info('Select a chat before starting a call.');
			return;
		}
		preCallKind = kind;
		activeCall = kind;
		callPeer = active.id;
		callTitle = '';
		callError = '';
		showPreCall = true;
		refreshNetworkWarning();
		try {
			await ensureLocalMedia(kind);
			await refreshMediaPermissions();
		} catch (e) {
			callError = mediaErrorMessage(e, kind);
			toasts.error(callError);
		}
	}

	function cancelPreCall() {
		if (!showPreCall) return;
		stopLocalMedia();
		activeCall = null;
		preCallKind = null;
		callPeer = '';
		callGroupId = '';
		callTitle = '';
		callError = '';
		showPreCall = false;
	}

	async function retryPreCallMedia() {
		const kind = preCallKind;
		if (!kind) return;
		stopLocalMedia();
		callError = '';
		try {
			await ensureLocalMedia(kind);
			await refreshMediaPermissions();
		} catch (e) {
			callError = mediaErrorMessage(e, kind);
			toasts.error(callError);
		}
	}

	async function confirmPreCall() {
		const kind = preCallKind;
		if (!kind) return;
		showPreCall = false;
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
			callError = '';
			showCall = true;
			callMinimized = false;
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
			callError = '';
			showCall = true;
			callMinimized = false;
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

	async function endCall(notify = true, outcome: CallOutcome = 'ended') {
		const peers = [
			...new Set([...peerConnections.keys(), callPeer].filter((peer): peer is string => !!peer))
		];
		const kind = activeCall;
		const id = callId;
		const groupId = callGroupId || undefined;
		const me = identity.current;
		const duration = callConnectedAt
			? Math.max(0, Math.floor((Date.now() - callConnectedAt) / 1000))
			: 0;
		markCallClosed(id);
		if (notify && groupId && kind) {
			addGroupCallMessage(groupId, kind, outcome === 'missed' ? 'missed' : 'ended', duration);
		}
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
							duration,
							outcome
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
			const sameCall =
				signal.callId === callId &&
				(signal.from === callPeer ||
					(!!signal.groupId && !!callGroupId && signal.groupId === callGroupId));
			if (!canReceiveNewCall(showCall, callState, sameCall)) {
				if (identity.current) {
					void sendCallSignal(signal.from, {
						callId: signal.callId,
						type: 'end',
						kind: signal.kind,
						from: identity.current.pk,
						groupId: signal.groupId,
						outcome: 'declined'
					});
				}
				return;
			}
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
		if (signal.type === 'state') {
			applyCallStateSignal(signal.from, signal.state);
			return;
		}
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
			let candidate: RTCIceCandidateInit;
			try {
				candidate = JSON.parse(signal.candidate) as RTCIceCandidateInit;
			} catch {
				callError = 'Received an invalid network candidate';
				return;
			}
			if (pc?.remoteDescription) {
				try {
					await pc.addIceCandidate(candidate);
				} catch {
					callError = 'Could not apply a network candidate';
				}
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
				members: [
					{ name: 'You', initials: 'YO', status: ownActivityStatus, admin: true },
					...members
				],
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

		const peer = parsePubkey(newPeerInput);
		if (!newPeerInput.trim()) return;
		if (!peer) {
			toasts.error('Enter a valid npub or 64-char hex pubkey');
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
		loadSavedCallDevices();
		void refreshMediaPermissions();
		resolveTo(page.url.searchParams.get('to'));
		resolveDraftText(page.url.searchParams.get('text'));
		resolveAutoAnswer(page.url.searchParams.get('answer'));
		void loadCallDevices();
		const onDeviceChange = () => void loadCallDevices();
		const onOffline = () => {
			if (showCall) {
				callState = 'reconnecting';
				callError = 'Network offline';
			}
		};
		const onOnline = () => {
			if (showCall && activeCall) {
				callState = 'reconnecting';
				callError = 'Refreshing connection...';
				lastIceRestartAt = 0;
				void restartCallIce();
			}
		};
		navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);
		window.addEventListener('offline', onOffline);
		window.addEventListener('online', onOnline);
		document.addEventListener('visibilitychange', onCallVisibilityChange);
		window.addEventListener('pagehide', onCallPageHide);
		return () => {
			navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
			window.removeEventListener('offline', onOffline);
			window.removeEventListener('online', onOnline);
			document.removeEventListener('visibilitychange', onCallVisibilityChange);
			window.removeEventListener('pagehide', onCallPageHide);
		};
	});
	let loadedMessageAccount = $state(identity.current?.pk ?? '');
	$effect(() => {
		const pk = identity.current?.pk ?? '';
		if (pk === loadedMessageAccount) return;
		loadedMessageAccount = pk;
		selectedMicrophone = '';
		selectedCamera = '';
		selectedSpeaker = '';
		loadSavedCallDevices();
		void loadCallDevices();
		selected = '';
		groupThreads = [];
		processedGroupMessageIds.clear();
		processedGroupControlIds.clear();
		processedCallSignalIds.clear();
		processedGroupCallLogIds.clear();
		closedCallIds.clear();
		removedGroupIds.clear();
		loadGroups();
		resolveTo(page.url.searchParams.get('to'));
		resolveDraftText(page.url.searchParams.get('text'));
	});
	$effect(() => resolveTo(page.url.searchParams.get('to')));
	$effect(() => resolveDraftText(page.url.searchParams.get('text')));
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
	$effect(() => {
		if (!showCall) return;
		void loadCallDevices();
	});
	$effect(() => {
		if (callState !== 'connected' || !callConnectedAt) return;

		const updateElapsed = () => {
			callElapsedSeconds = Math.max(0, Math.floor((Date.now() - callConnectedAt) / 1000));
		};
		updateElapsed();
		const timer = setInterval(updateElapsed, 1000);
		return () => clearInterval(timer);
	});
	$effect(() => {
		if (callState !== 'connected') {
			callQuality = 'unknown';
			callQualityDetail = '';
			callRttMs = null;
			callLossPercent = null;
			callIceState = '';
			callTransport = '';
			previousInboundStats.clear();
			return;
		}
		void updateCallQuality();
		const timer = setInterval(() => void updateCallQuality(), 3000);
		return () => clearInterval(timer);
	});
	$effect(() => {
		if (!showPreCall || !localStream?.getAudioTracks().length || !browser) {
			micLevel = 0;
			return;
		}
		const AudioContextConstructor = window.AudioContext;
		if (!AudioContextConstructor) return;
		const context = new AudioContextConstructor();
		const analyser = context.createAnalyser();
		analyser.fftSize = 256;
		const source = context.createMediaStreamSource(localStream);
		source.connect(analyser);
		const samples = new Uint8Array(analyser.fftSize);
		let frame = 0;
		const updateLevel = () => {
			analyser.getByteTimeDomainData(samples);
			let sum = 0;
			for (const sample of samples) {
				const normalized = (sample - 128) / 128;
				sum += normalized * normalized;
			}
			micLevel = Math.min(100, Math.round(Math.sqrt(sum / samples.length) * 180));
			frame = requestAnimationFrame(updateLevel);
		};
		void context.resume();
		updateLevel();
		return () => {
			cancelAnimationFrame(frame);
			source.disconnect();
			void context.close();
			micLevel = 0;
		};
	});
	$effect(() => {
		if (!shouldStartCallTimeout(showCall, callState)) return;

		const timer = setTimeout(() => {
			callError = 'No answer';
			toasts.info('Call timed out');
			void endCall(true, 'missed');
		}, CALL_SETUP_TIMEOUT_MS);
		return () => clearTimeout(timer);
	});
	$effect(() => {
		if (!shouldStartReconnectTimeout(showCall, callState)) return;

		const timer = setTimeout(() => {
			callError = 'Call connection was lost';
			toasts.info('Call ended because the connection was lost');
			void endCall(true);
		}, CALL_RECONNECT_TIMEOUT_MS);
		return () => clearTimeout(timer);
	});
	// Ringtone / connection cues — driven entirely by call state + the sound setting.
	$effect(() => {
		const sounds = callSettings.state.sounds;
		const state = callState;
		if (!sounds) {
			stopRingtone();
			return;
		}
		if (state === 'incoming') {
			playRingtone();
		} else {
			stopRingtone();
			if (state === 'outgoing') playOutgoingTone();
			else if (state === 'connected') playConnectedTone();
		}
	});
	// First-run keyboard-shortcut hint.
	$effect(() => {
		if (showCall && activeCall && callSettings.state.shortcutsHint) {
			showShortcutsHint = true;
			const timer = setTimeout(() => {
				showShortcutsHint = false;
				callSettings.dismissShortcutsHint();
			}, 6500);
			return () => clearTimeout(timer);
		}
	});
</script>

<svelte:head><title>Messages · BitOS</title></svelte:head>

<svelte:window
	onfullscreenchange={onFullscreenChange}
	onkeydown={onCallKeydown}
	onkeyup={onCallKeyup}
/>

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
								class="grid size-12 place-items-center mask-squircle bg-primary-500 text-sm font-bold text-white shadow-[var(--glow-primary)]"
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
							class="mask-squircle"
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
								{#if conversation.kind === 'dm' && isSecureDm(dms.conversations.find((dm) => dm.peer === conversation.id)?.lastMessage)}
									<span
										class="mr-1 inline-flex items-center align-middle text-emerald-600 dark:text-emerald-300"
										title="Last message used Secure DM (NIP-17)"
									>
										<Icon name="i-lucide-shield-check" class="size-3.5" />
									</span>
								{/if}
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
									class="grid size-11 place-items-center mask-squircle bg-primary-500 font-bold text-white shadow-[var(--glow-primary)]"
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
								class="shrink-0 mask-squircle transition hover:ring-2 hover:ring-primary-500/30"
								aria-label={`Open ${active.name} profile`}
							>
								<Avatar
									pubkey={active.id}
									name={active.name}
									picture={profiles.get(active.id)?.picture}
									size={44}
									class="mask-squircle"
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
									Encrypted - Secure DMs + legacy fallback
								{/if}
							</p>
						</div>
					</div>
					<div
						class="flex shrink-0 items-center gap-1 rounded-2xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)]/60 p-1"
					>
						<button
							type="button"
							onclick={() => startCall('voice')}
							title="Voice call"
							class="group grid size-9 place-items-center rounded-xl text-[var(--ui-text-muted)] transition hover:bg-[var(--surface-bg)] hover:text-primary-500 hover:shadow-sm"
							aria-label="Start voice call"
						>
							<Icon name="i-lucide-phone" class="size-4 transition group-active:scale-90" />
						</button>
						<button
							type="button"
							onclick={() => startCall('video')}
							title="Video call"
							class="group grid size-9 place-items-center rounded-xl text-[var(--ui-text-muted)] transition hover:bg-[var(--surface-bg)] hover:text-primary-500 hover:shadow-sm"
							aria-label="Start video call"
						>
							<Icon name="i-lucide-video" class="size-4 transition group-active:scale-90" />
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
									<div class="max-w-[78%]">
										<div
											class="{msg.mine
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
																		? callSignal.outcome === 'missed'
																			? 'Missed call'
																			: callSignal.outcome === 'declined'
																				? 'Call declined'
																				: 'Call ended'
																		: 'Outgoing call'
																	: callSignal.type === 'offer'
																		? 'Incoming call'
																		: callSignal.outcome === 'missed'
																			? 'Missed call'
																			: callSignal.outcome === 'declined'
																				? 'Call declined'
																				: 'Call ended'}
															</p>
														</div>
													</div>
													{#if callSignal.type === 'log'}
														{@const isMissed = callSignal.outcome === 'missed'}
														{@const isDeclined = callSignal.outcome === 'declined'}
														<div class="flex items-center gap-2">
															<span
																class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold {isMissed
																	? 'bg-[var(--tone-error-bg)] text-[var(--tone-error-text)]'
																	: isDeclined
																		? 'bg-amber-500/15 text-amber-600 dark:text-amber-300'
																		: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'}"
															>
																<Icon
																	name={isMissed
																		? 'i-lucide-phone-missed'
																		: isDeclined
																			? 'i-lucide-phone-off'
																			: 'i-lucide-phone'}
																	class="size-3"
																/>
																{isMissed ? 'Missed' : isDeclined ? 'Declined' : 'Ended'}
															</span>
															{#if !isMissed && !isDeclined && callSignal.duration}
																<span
																	class="text-[12px] font-semibold {msg.mine
																		? 'text-white/75'
																		: 'text-[var(--ui-text-muted)]'}"
																	>{formatDuration(callSignal.duration)}</span
																>
															{/if}
														</div>
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
												class="mt-0.5 flex items-center justify-end gap-1.5 text-[10px] {msg.mine
													? 'text-white/60'
													: 'text-[var(--ui-text-dimmed)]'}"
											>
												{#if isSecureDm(msg)}
													<span
														class="inline-flex items-center text-emerald-200 dark:text-emerald-300"
														title="Secure DM"
													>
														<Icon name="i-lucide-shield-check" class="size-3" />
													</span>
												{/if}
												{new Date(msg.createdAt * 1000).toLocaleTimeString(undefined, {
													hour: '2-digit',
													minute: '2-digit'
												})}
											</div>
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
							Uploading via {providerLabel(
								activeUploadProvider === 'none' ? 'server' : activeUploadProvider
							)}…
						</p>
					{/if}
					<div class="flex items-end gap-2">
						<button
							type="button"
							onclick={() => attachFile('file')}
							disabled={uploadingMessage || activeUploadProvider === 'none'}
							title={`Upload via ${providerLabel(activeUploadProvider === 'none' ? 'server' : activeUploadProvider)}`}
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
							title={`Upload via ${providerLabel(activeUploadProvider === 'none' ? 'server' : activeUploadProvider)}`}
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
							class="mx-auto mb-3 block w-fit mask-squircle transition hover:ring-2 hover:ring-primary-500/30"
							aria-label={`Open ${active.name} profile`}
						>
							<Avatar
								pubkey={active.id}
								name={active.name}
								picture={profiles.get(active.id)?.picture}
								size={80}
								class="mask-squircle"
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
												class="mask-squircle"
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
												class="block mask-squircle transition hover:ring-2 hover:ring-primary-500/30"
												aria-label={`Open ${member.name} profile`}
											>
												<Avatar
													pubkey={member.pubkey}
													name={member.name}
													picture={profiles.get(member.pubkey)?.picture}
													size={36}
													class="mask-squircle"
												/>
											</a>
										{:else}
											<div
												class="grid size-9 place-items-center mask-squircle bg-primary-500 text-xs font-bold text-white"
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
							Messages in this conversation support Secure DMs (NIP-17) with legacy NIP-04 fallback.
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
					class="grid size-[52px] place-items-center mask-squircle bg-primary-500 font-bold text-white"
				>
					{active.initials}
				</div>
			{:else}
				<a
					href={profileHref(active.id)}
					class="shrink-0 mask-squircle transition hover:ring-2 hover:ring-primary-500/30"
					aria-label={`Open ${active.name} profile`}
				>
					<Avatar
						pubkey={active.id}
						name={active.name}
						picture={profiles.get(active.id)?.picture}
						size={52}
						class="mask-squircle"
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
				: 'Messages prefer Secure DMs (NIP-17) and can still read legacy NIP-04 chats. Calls and file uploads require additional Nostr-compatible services.'}
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
										class="mask-squircle"
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
									class="shrink-0 mask-squircle transition hover:ring-2 hover:ring-primary-500/30"
									aria-label={`Open ${member.name} profile`}
								>
									<Avatar
										pubkey={member.pubkey}
										name={member.name}
										picture={profiles.get(member.pubkey)?.picture}
										size={32}
										class="mask-squircle"
									/>
								</a>
							{:else}
								<div
									class="grid size-8 shrink-0 place-items-center mask-squircle bg-primary-500 text-[11px] font-bold text-white"
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

{#if showPreCall && preCallKind}
	<Dialog
		bind:open={showPreCall}
		closeOnOverlay={false}
		title={`Prepare ${preCallKind === 'video' ? 'video' : 'voice'} call`}
	>
		<div class="space-y-4">
			{#if preCallKind === 'video'}
				<div
					class="relative aspect-video overflow-hidden rounded-2xl bg-neutral-950 ring-1 ring-[var(--ui-border)]"
				>
					<video
						use:streamSource={localStream}
						autoplay
						muted
						playsinline
						class="size-full object-cover"
					></video>
					<span
						class="pointer-events-none absolute top-2 left-2 flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur"
					>
						<span
							class="size-1.5 rounded-full {cameraEnabled ? 'bg-emerald-400' : 'bg-neutral-400'}"
						></span>
						Preview
					</span>
					{#if !cameraEnabled}
						<div
							class="absolute inset-0 grid place-items-center bg-neutral-950/85 text-white backdrop-blur-sm"
						>
							<div class="flex flex-col items-center gap-2">
								<Icon name="i-lucide-camera-off" class="size-10 text-white/70" />
								<span class="text-[11px] font-semibold text-white/70">Camera off</span>
							</div>
						</div>
					{/if}
				</div>
			{:else}
				<div
					class="call-stage-voice relative grid place-items-center overflow-hidden rounded-2xl py-10 ring-1 ring-[var(--ui-border)]"
				>
					<div class="relative">
						<span class="call-ring"></span>
						<span class="call-ring call-ring--2"></span>
						<span class="call-ring call-ring--3"></span>
						<div
							class="grid size-14 place-items-center rounded-full bg-primary-500 text-white shadow-[var(--glow-primary)]"
						>
							<Icon name="i-lucide-mic" class="size-6" />
						</div>
					</div>
					<div class="absolute bottom-3 flex h-4 items-end gap-[3px]" aria-hidden="true">
						{#each Array(24) as _, i (i)}
							<span
								class="wave-bar w-[3px] rounded-full bg-primary-300/70"
								style={`height: ${25 + ((i * 47) % 60)}%; animation-delay: ${(i % 6) * 0.1}s`}
							></span>
						{/each}
					</div>
				</div>
			{/if}
			<p class="text-center text-[12px] text-[var(--ui-text-muted)]">
				Check your devices before calling {callTitle || (active?.name ?? 'this contact')}.
			</p>
			{#if networkWarning}
				<div
					class="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-left text-[11px] font-semibold text-amber-700 dark:text-amber-300"
					role="status"
				>
					<Icon name="i-lucide-wifi" class="mt-0.5 size-3.5 shrink-0" />
					<span>{networkWarning}</span>
				</div>
			{/if}
			{#if callError}
				<p class="text-center text-[12px] text-[var(--tone-error-text)]">{callError}</p>
				<Button color="neutral" variant="soft" block onclick={() => void retryPreCallMedia()}>
					Try permission again
				</Button>
			{/if}
			{#if microphones.length}
				<div class="space-y-1.5 text-left">
					<div
						class="flex items-center justify-between text-[10px] font-bold tracking-wide text-[var(--ui-text-muted)] uppercase"
					>
						<span class="flex items-center gap-1"
							><Icon name="i-lucide-mic" class="size-3" /> Microphone test</span
						>
						<span
							class="rounded-full px-1.5 py-0.5 font-semibold {micLevel > 3
								? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
								: 'bg-[var(--ui-bg-accented)] text-[var(--ui-text-muted)]'}"
							>{micLevel > 3 ? 'Signal detected' : 'Speak to test'}</span
						>
					</div>
					<div class="h-2.5 overflow-hidden rounded-full bg-[var(--ui-border-muted)]">
						<div
							class="h-full rounded-full bg-gradient-to-r from-emerald-400 via-emerald-500 to-primary-500 transition-[width] duration-75"
							style={`width: ${Math.min(100, micLevel)}%`}
						></div>
					</div>
				</div>
			{/if}
			<div class="flex flex-wrap items-center justify-center gap-2 text-[10px] font-bold">
				<span
					class="flex items-center gap-1 rounded-full bg-[var(--ui-bg-accented)] px-2 py-1 text-[var(--ui-text-muted)]"
				>
					<Icon name="i-lucide-mic" class="size-3" /> Mic:
					<span class={permissionClass(microphonePermission)}
						>{permissionLabel(microphonePermission)}</span
					>
				</span>
				{#if preCallKind === 'video'}
					<span
						class="flex items-center gap-1 rounded-full bg-[var(--ui-bg-accented)] px-2 py-1 text-[var(--ui-text-muted)]"
					>
						<Icon name="i-lucide-camera" class="size-3" /> Camera:
						<span class={permissionClass(cameraPermission)}
							>{permissionLabel(cameraPermission)}</span
						>
					</span>
				{/if}
			</div>
			<div class="grid gap-2 text-left sm:grid-cols-3">
				{#if microphones.length}
					<label class="space-y-1"
						><span class="text-[10px] font-bold text-[var(--ui-text-muted)] uppercase"
							>Microphone</span
						>
						<select
							class="w-full rounded-lg border border-[var(--ui-border)] bg-[var(--surface-bg)] px-2 py-2 text-[12px] text-[var(--ui-text)]"
							value={selectedMicrophone}
							onchange={(event) =>
								void changeMicrophone((event.currentTarget as HTMLSelectElement).value)}
						>
							{#each microphones as device, index (device.deviceId)}<option value={device.deviceId}
									>{deviceLabel(device, 'Microphone', index)}</option
								>{/each}
						</select>
					</label>
				{/if}
				{#if preCallKind === 'video' && cameras.length}
					<label class="space-y-1"
						><span class="text-[10px] font-bold text-[var(--ui-text-muted)] uppercase">Camera</span>
						<select
							class="w-full rounded-lg border border-[var(--ui-border)] bg-[var(--surface-bg)] px-2 py-2 text-[12px] text-[var(--ui-text)]"
							value={selectedCamera}
							onchange={(event) =>
								void changeCamera((event.currentTarget as HTMLSelectElement).value)}
						>
							{#each cameras as device, index (device.deviceId)}<option value={device.deviceId}
									>{deviceLabel(device, 'Camera', index)}</option
								>{/each}
						</select>
					</label>
				{/if}
				{#if speakers.length}
					<label class="space-y-1"
						><span class="text-[10px] font-bold text-[var(--ui-text-muted)] uppercase">Speaker</span
						>
						<select
							class="w-full rounded-lg border border-[var(--ui-border)] bg-[var(--surface-bg)] px-2 py-2 text-[12px] text-[var(--ui-text)]"
							value={selectedSpeaker}
							onchange={(event) =>
								void changeSpeaker((event.currentTarget as HTMLSelectElement).value)}
						>
							{#each speakers as device, index (device.deviceId)}<option value={device.deviceId}
									>{deviceLabel(device, 'Speaker', index)}</option
								>{/each}
						</select>
					</label>
				{/if}
			</div>
			{#if speakers.length && supportsSpeakerOutput()}
				<Button
					color="neutral"
					variant="soft"
					block
					icon={speakerTestPlaying ? 'i-lucide-volume-2' : 'i-lucide-volume'}
					onclick={() => void testSpeakerOutput()}
				>
					{speakerTestPlaying ? 'Playing test sound...' : 'Test speaker output'}
				</Button>
			{/if}
			<div class="flex justify-center gap-2.5">
				<button
					type="button"
					title={micEnabled ? 'Mute microphone' : 'Unmute microphone'}
					aria-label="Toggle microphone"
					onclick={toggleMic}
					class="call-orb size-11 {micEnabled
						? 'bg-[var(--ui-bg-accented)] text-[var(--ui-text)] hover:bg-[var(--interactive-hover-bg)]'
						: 'bg-[var(--tone-error-bg)] text-[var(--tone-error-text)] hover:opacity-90'}"
				>
					<Icon name={micEnabled ? 'i-lucide-mic' : 'i-lucide-mic-off'} class="size-5" />
				</button>
				{#if preCallKind === 'video'}
					<button
						type="button"
						title={cameraEnabled ? 'Turn off camera' : 'Turn on camera'}
						aria-label="Toggle camera"
						onclick={toggleCamera}
						class="call-orb size-11 {cameraEnabled
							? 'bg-[var(--ui-bg-accented)] text-[var(--ui-text)] hover:bg-[var(--interactive-hover-bg)]'
							: 'bg-[var(--tone-error-bg)] text-[var(--tone-error-text)] hover:opacity-90'}"
					>
						<Icon name={cameraEnabled ? 'i-lucide-camera' : 'i-lucide-camera-off'} class="size-5" />
					</button>
				{/if}
			</div>
		</div>
		{#snippet footer()}
			<Button color="neutral" variant="subtle" onclick={cancelPreCall}>Cancel</Button>
			<Button
				color="primary"
				icon={preCallKind === 'video' ? 'i-lucide-video' : 'i-lucide-phone'}
				onclick={() => void confirmPreCall()}>Start call</Button
			>
		{/snippet}
	</Dialog>
{/if}

{#if showCall && !callMinimized}
	<Dialog
		bind:open={showCall}
		closeOnOverlay={false}
		title={`${callGroupId ? 'Group ' : ''}${activeCall === 'video' ? 'Video call' : 'Voice call'}`}
	>
		{#if activeCall}
			{#if showShortcutsHint}
				<div
					class="flex items-center justify-center gap-2 rounded-xl bg-primary-500/10 px-3 py-2 text-[11px] font-semibold text-primary-700 dark:text-primary-300"
					role="status"
				>
					<Icon name="i-lucide-keyboard" class="size-3.5 shrink-0" />
					<span class="hidden sm:inline"
						><kbd class="rounded bg-white/60 px-1 dark:bg-black/30">M</kbd> mic ·
						<kbd class="rounded bg-white/60 px-1 dark:bg-black/30">V</kbd>
						camera · <kbd class="rounded bg-white/60 px-1 dark:bg-black/30">Space</kbd> push-to-talk
						· <kbd class="rounded bg-white/60 px-1 dark:bg-black/30">Esc</kbd> minimize</span
					>
					<span class="sm:hidden">Mic · Camera · Hold Space to talk</span>
					<button
						type="button"
						class="ml-1 shrink-0 text-[var(--ui-text-muted)] transition hover:text-[var(--ui-text)]"
						aria-label="Dismiss shortcut hint"
						onclick={() => {
							showShortcutsHint = false;
							callSettings.dismissShortcutsHint();
						}}
					>
						<Icon name="i-lucide-x" class="size-3.5" />
					</button>
				</div>
			{/if}
			<div class="space-y-4 text-center">
				<div
					bind:this={callMediaPanel}
					class="{callFullscreen
						? 'h-full w-full rounded-none'
						: activeCall === 'video'
							? 'aspect-video'
							: 'aspect-square max-w-72'} relative mx-auto grid w-full overflow-hidden {activeCall ===
					'voice'
						? 'call-stage-voice'
						: 'bg-neutral-950'} text-white shadow-lg shadow-black/20 {callFullscreen
						? ''
						: 'rounded-2xl'}"
				>
					{#if activeCall === 'video'}
						{#if remoteParticipants.length}
							<div
								class="grid size-full gap-1 {remoteParticipants.length === 1
									? 'grid-cols-1'
									: 'grid-cols-2'}"
							>
								{#each remoteParticipants as participant (participant.peer)}
									<div class="relative overflow-hidden bg-black ring-1 ring-white/10 ring-inset">
										<video
											use:streamSource={participant.stream}
											data-call-output
											autoplay
											playsinline
											class="size-full object-cover"
										></video>
										<div
											class="absolute right-2 bottom-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur"
										>
											<span class="size-1.5 rounded-full bg-emerald-400"></span>
											{participant.name}
										</div>
										{#if raisedHands.has(participant.peer)}
											<div
												class="absolute top-2 left-2 grid size-7 place-items-center rounded-full bg-amber-400 text-[13px] text-white shadow-lg ring-2 ring-black/30"
												aria-label="{participant.name} raised their hand"
												title="{participant.name} raised their hand"
											>
												✋
											</div>
										{/if}
									</div>
								{/each}
							</div>
						{:else}
							<video
								bind:this={remoteVideoEl}
								use:pictureInPictureEvents
								data-call-output
								autoplay
								playsinline
								class="size-full object-cover"
							></video>
						{/if}
						<div
							class="absolute z-10 overflow-hidden rounded-2xl border-2 border-white/25 bg-black shadow-xl shadow-black/40 {selfViewPos
								? 'cursor-grab touch-none'
								: 'right-3 bottom-3 cursor-grab touch-none'} {selfViewDrag
								? 'cursor-grabbing'
								: ''}"
							style={selfViewPos ? `left:${selfViewPos.x}px; top:${selfViewPos.y}px` : ''}
							role="region"
							aria-label="Your video preview — drag to reposition"
							onpointerdown={selfViewDown}
							onpointermove={selfViewMove}
							onpointerup={selfViewUp}
						>
							<video
								bind:this={localVideoEl}
								autoplay
								muted
								playsinline
								class="aspect-video w-28 object-cover"
							></video>
							<span
								class="pointer-events-none absolute bottom-1 left-1.5 flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[9px] font-semibold text-white"
								>{selfHandRaised ? '✋ ' : ''}You</span
							>
						</div>
					{:else}
						<div class="grid h-full place-items-center px-4 py-6">
							<div class="flex flex-col items-center gap-5">
								<div class="relative grid size-28 place-items-center">
									<span class="call-ring"></span>
									<span class="call-ring call-ring--2"></span>
									<span class="call-ring call-ring--3"></span>
									<div class="relative">
										{#if callPeer}
											<Avatar
												pubkey={callPeer}
												name={callDisplayTitle()}
												picture={profiles.get(callPeer)?.picture}
												size={96}
												class="relative mask-squircle ring-4 ring-white/10"
											/>
										{:else}
											<div
												class="relative grid size-24 place-items-center mask-squircle bg-primary-500 text-3xl font-bold text-white shadow-[var(--glow-primary)]"
											>
												{active?.initials ?? 'GC'}
											</div>
										{/if}
										<span
											class="absolute -bottom-1 left-1/2 grid size-7 -translate-x-1/2 place-items-center rounded-full bg-primary-500 text-white ring-4 ring-black/30"
										>
											<Icon name="i-lucide-phone" class="size-3.5" />
										</span>
									</div>
								</div>
								<div class="flex h-6 items-end gap-[3px]" aria-hidden="true">
									{#each Array(32) as _, i (i)}
										<span
											class="wave-bar w-[3px] rounded-full bg-primary-300/80"
											style={`height: ${20 + ((i * 53) % 80)}%; animation-delay: ${(i % 8) * 0.08}s`}
										></span>
									{/each}
								</div>
								{#if callGroupId}
									<p class="text-[12px] font-semibold text-white/70">
										{Math.max(1, remoteParticipants.length + 1)} participants connected
									</p>
								{/if}
							</div>
						</div>
					{/if}
					<audio bind:this={remoteAudioEl} data-call-output autoplay></audio>
					{#if activeCall === 'voice'}
						{#each remoteParticipants as participant (participant.peer)}
							<audio use:streamSource={participant.stream} data-call-output autoplay></audio>
						{/each}
					{/if}
				</div>
				<div>
					<p class="text-[15px] font-bold">{callDisplayTitle()}</p>
					<p
						class="mt-1 flex items-center justify-center gap-1.5 text-[12px] text-[var(--ui-text-muted)]"
					>
						<span
							class="inline-block size-1.5 shrink-0 rounded-full {callState === 'connected'
								? 'bg-emerald-500'
								: callState === 'reconnecting'
									? 'live-pulse bg-amber-500'
									: 'live-pulse bg-primary-500'}"
						></span>
						{callState === 'incoming'
							? 'Incoming encrypted call request'
							: callState === 'outgoing'
								? 'Calling...'
								: callState === 'connected'
									? 'Connected'
									: callState === 'reconnecting'
										? 'Reconnecting...'
										: 'Connecting...'}
						{#if callGroupId && callState !== 'incoming'}
							- {Math.max(1, remoteParticipants.length + 1)} joined
						{/if}
					</p>
					{#if callState === 'connected'}
						<p
							class="mt-1 font-mono text-[13px] font-semibold text-primary-600 dark:text-primary-300"
							aria-live="polite"
						>
							{formatDuration(callElapsedSeconds)}
						</p>
						<p class="mt-1 text-[11px] font-semibold {callQualityClass()}" aria-live="polite">
							{callQualityLabel()}{callQualityDetail ? ` - ${callQualityDetail}` : ''}
						</p>
						<Button
							color="neutral"
							variant="ghost"
							class="mt-1 h-auto px-1 py-0 text-[10px]"
							onclick={() => (showCallDiagnostics = !showCallDiagnostics)}
						>
							{showCallDiagnostics ? 'Hide diagnostics' : 'Connection details'}
						</Button>
						<button
							type="button"
							title={callSettings.state.sounds ? 'Mute call sounds' : 'Enable call sounds'}
							aria-label={callSettings.state.sounds ? 'Mute call sounds' : 'Enable call sounds'}
							onclick={callSettings.toggleSounds}
							class="mt-1 inline-flex h-auto items-center gap-1 rounded-md px-1 py-0 text-[10px] font-semibold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-accented)] hover:text-[var(--ui-text)]"
						>
							<Icon
								name={callSettings.state.sounds ? 'i-lucide-volume-2' : 'i-lucide-volume-x'}
								class="size-3.5"
							/>
							{callSettings.state.sounds ? 'Sound on' : 'Muted'}
						</button>
						{#if showCallDiagnostics}
							<div
								class="mx-auto mt-2 grid max-w-sm grid-cols-2 gap-x-4 gap-y-1 rounded-xl bg-[var(--surface-muted)] px-3 py-2 text-left text-[10px]"
							>
								<span class="text-[var(--ui-text-muted)]">Round trip</span>
								<span class="font-mono font-semibold"
									>{callRttMs === null ? '—' : `${callRttMs} ms`}</span
								>
								<span class="text-[var(--ui-text-muted)]">Packet loss</span>
								<span class="font-mono font-semibold"
									>{callLossPercent === null ? '—' : `${callLossPercent}%`}</span
								>
								<span class="text-[var(--ui-text-muted)]">ICE state</span>
								<span class="font-mono font-semibold">{callIceState || 'checking'}</span>
								<span class="text-[var(--ui-text-muted)]">Transport</span>
								<span class="font-mono font-semibold">{callTransport || '—'}</span>
								<Button
									color="neutral"
									variant="soft"
									class="col-span-2 mt-1"
									icon="i-lucide-copy"
									onclick={() => void copyCallDiagnostics()}
								>
									Copy diagnostics
								</Button>
							</div>
						{/if}
					{/if}
					{#if callError}
						<p class="mt-2 text-[12px] text-[var(--tone-error-text)]">{callError}</p>
					{/if}
					{#if callState === 'reconnecting'}
						<button
							type="button"
							onclick={() => void restartCallIce()}
							class="mt-2 inline-flex items-center gap-1.5 rounded-full bg-primary-500/15 px-3 py-1.5 text-[11px] font-semibold text-primary-700 transition hover:bg-primary-500/25 dark:text-primary-300"
						>
							<Icon name="i-lucide-refresh-cw" class="size-3.5" /> Retry connection
						</button>
					{/if}
				</div>
				<div class="flex flex-wrap items-center justify-center gap-2.5">
					{#if callState === 'incoming'}
						<button
							type="button"
							title="Answer call"
							aria-label="Answer call"
							onclick={() => acceptIncomingCall()}
							class="call-orb size-16 bg-[var(--tone-success-text)] text-white shadow-[0_8px_24px_-4px_rgba(26,138,94,0.55)]"
						>
							<Icon
								name={activeCall === 'video' ? 'i-lucide-video' : 'i-lucide-phone'}
								class="size-6"
							/>
						</button>
					{:else}
						<button
							type="button"
							title={micEnabled ? 'Mute microphone' : 'Unmute microphone'}
							aria-label={micEnabled ? 'Mute microphone' : 'Unmute microphone'}
							onclick={toggleMic}
							class="call-orb size-12 {micEnabled
								? 'bg-[var(--ui-bg-accented)] text-[var(--ui-text)] hover:bg-[var(--interactive-hover-bg)]'
								: 'bg-[var(--tone-error-bg)] text-[var(--tone-error-text)] hover:opacity-90'}"
						>
							<Icon name={micEnabled ? 'i-lucide-mic' : 'i-lucide-mic-off'} class="size-5" />
						</button>
						{#if activeCall === 'video'}
							<button
								type="button"
								title={cameraEnabled ? 'Turn off camera' : 'Turn on camera'}
								aria-label={cameraEnabled ? 'Turn off camera' : 'Turn on camera'}
								onclick={toggleCamera}
								class="call-orb size-12 {cameraEnabled
									? 'bg-[var(--ui-bg-accented)] text-[var(--ui-text)] hover:bg-[var(--interactive-hover-bg)]'
									: 'bg-[var(--tone-error-bg)] text-[var(--tone-error-text)] hover:opacity-90'}"
							>
								<Icon
									name={cameraEnabled ? 'i-lucide-camera' : 'i-lucide-camera-off'}
									class="size-5"
								/>
							</button>
							<button
								type="button"
								title={screenSharing ? 'Stop screen sharing' : 'Share screen'}
								aria-label={screenSharing ? 'Stop screen sharing' : 'Share screen'}
								onclick={toggleScreenShare}
								class="call-orb size-12 {screenSharing
									? 'bg-primary-500 text-white shadow-[var(--glow-primary)]'
									: 'bg-[var(--ui-bg-accented)] text-[var(--ui-text)] hover:bg-[var(--interactive-hover-bg)]'}"
							>
								<Icon
									name={screenSharing ? 'i-lucide-monitor-off' : 'i-lucide-monitor-up'}
									class="size-5"
								/>
							</button>
							<button
								type="button"
								title={backgroundBlurred ? 'Disable background blur' : 'Blur background'}
								aria-label={backgroundBlurred ? 'Disable background blur' : 'Blur background'}
								onclick={toggleBackgroundBlur}
								class="call-orb size-12 {backgroundBlurred
									? 'bg-primary-500 text-white shadow-[var(--glow-primary)]'
									: 'bg-[var(--ui-bg-accented)] text-[var(--ui-text)] hover:bg-[var(--interactive-hover-bg)]'}"
							>
								<Icon
									name={backgroundBlurred ? 'i-lucide-aperture' : 'i-lucide-sparkles'}
									class="size-5"
								/>
							</button>
							<button
								type="button"
								title={callFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
								aria-label={callFullscreen ? 'Exit fullscreen video' : 'Fullscreen video'}
								onclick={toggleCallFullscreen}
								class="call-orb size-12 bg-[var(--ui-bg-accented)] text-[var(--ui-text)] hover:bg-[var(--interactive-hover-bg)]"
							>
								<Icon
									name={callFullscreen ? 'i-lucide-minimize-2' : 'i-lucide-maximize-2'}
									class="size-5"
								/>
							</button>
							{#if supportsPictureInPicture()}
								<button
									type="button"
									title={callPictureInPicture ? 'Close picture-in-picture' : 'Picture-in-picture'}
									aria-label={callPictureInPicture
										? 'Close picture-in-picture'
										: 'Picture-in-picture'}
									onclick={togglePictureInPicture}
									class="call-orb size-12 {callPictureInPicture
										? 'bg-primary-500 text-white shadow-[var(--glow-primary)]'
										: 'bg-[var(--ui-bg-accented)] text-[var(--ui-text)] hover:bg-[var(--interactive-hover-bg)]'}"
								>
									<Icon name="i-lucide-picture-in-picture-2" class="size-5" />
								</button>
							{/if}
						{:else}
							<button
								type="button"
								title="Switch to video call"
								aria-label="Switch to video"
								onclick={switchToVideo}
								class="call-orb size-12 bg-[var(--ui-bg-accented)] text-[var(--ui-text)] hover:bg-[var(--interactive-hover-bg)]"
							>
								<Icon name="i-lucide-video" class="size-5" />
							</button>
						{/if}
						{#if callGroupId && callState === 'connected'}
							<button
								type="button"
								title={selfHandRaised ? 'Lower hand' : 'Raise hand'}
								aria-label={selfHandRaised ? 'Lower hand' : 'Raise hand'}
								onclick={toggleRaiseHand}
								class="call-orb size-12 {selfHandRaised
									? 'bg-amber-400 text-white shadow-[0_4px_16px_-4px_rgba(245,158,11,0.6)]'
									: 'bg-[var(--ui-bg-accented)] text-[var(--ui-text)] hover:bg-[var(--interactive-hover-bg)]'}"
							>
								<span class="text-base leading-none">✋</span>
							</button>
						{/if}
						{#if callGroupId}
							<button
								type="button"
								onclick={inviteGroupMembersToActiveCall}
								class="inline-flex h-12 items-center gap-1.5 rounded-full bg-primary-500/15 px-4 text-[12px] font-semibold text-primary-700 transition hover:-translate-y-0.5 hover:bg-primary-500/20 dark:text-primary-300"
							>
								<Icon name="i-lucide-user-plus" class="size-4" /> Invite again
							</button>
						{/if}
					{/if}
				</div>
				{#if callState !== 'incoming' && (microphones.length > 1 || cameras.length > 1 || speakers.length > 1)}
					<div class="grid gap-2 text-left sm:grid-cols-3">
						{#if microphones.length > 1}
							<label class="space-y-1">
								<span class="text-[10px] font-bold text-[var(--ui-text-muted)] uppercase">Mic</span>
								<select
									class="w-full rounded-lg border border-[var(--ui-border)] bg-[var(--surface-bg)] px-2 py-2 text-[12px] text-[var(--ui-text)]"
									value={selectedMicrophone}
									onchange={(event) =>
										void changeMicrophone((event.currentTarget as HTMLSelectElement).value)}
								>
									{#each microphones as device, index (device.deviceId)}
										<option value={device.deviceId}
											>{deviceLabel(device, 'Microphone', index)}</option
										>
									{/each}
								</select>
							</label>
						{/if}
						{#if activeCall === 'video' && cameras.length > 1}
							<label class="space-y-1">
								<span class="text-[10px] font-bold text-[var(--ui-text-muted)] uppercase"
									>Camera</span
								>
								<select
									class="w-full rounded-lg border border-[var(--ui-border)] bg-[var(--surface-bg)] px-2 py-2 text-[12px] text-[var(--ui-text)]"
									value={selectedCamera}
									onchange={(event) =>
										void changeCamera((event.currentTarget as HTMLSelectElement).value)}
								>
									{#each cameras as device, index (device.deviceId)}
										<option value={device.deviceId}>{deviceLabel(device, 'Camera', index)}</option>
									{/each}
								</select>
							</label>
						{/if}
						{#if speakers.length > 1}
							<label class="space-y-1">
								<span class="text-[10px] font-bold text-[var(--ui-text-muted)] uppercase"
									>Speaker</span
								>
								<select
									class="w-full rounded-lg border border-[var(--ui-border)] bg-[var(--surface-bg)] px-2 py-2 text-[12px] text-[var(--ui-text)]"
									value={selectedSpeaker}
									onchange={(event) =>
										void changeSpeaker((event.currentTarget as HTMLSelectElement).value)}
								>
									{#each speakers as device, index (device.deviceId)}
										<option value={device.deviceId}>{deviceLabel(device, 'Speaker', index)}</option>
									{/each}
								</select>
							</label>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
		{#snippet footer()}
			{#if callState !== 'incoming'}
				<Button
					color="neutral"
					variant="subtle"
					icon="i-lucide-minus"
					onclick={() => (callMinimized = true)}
				>
					Minimize
				</Button>
			{/if}
			<Button
				color="error"
				icon="i-lucide-phone-off"
				class="shadow-[0_4px_16px_-4px_rgba(226,59,59,0.5)]"
				onclick={() => endCall()}>End call</Button
			>
		{/snippet}
	</Dialog>
{/if}

{#if showCall && callMinimized && activeCall}
	<div
		class="call-slide-up fixed right-4 bottom-4 z-50 flex items-center gap-3 rounded-2xl border border-[var(--ui-border)] bg-[var(--surface-bg)] px-4 py-3 shadow-[var(--shadow-pop)] transition hover:-translate-y-0.5"
		role="status"
	>
		<div class="relative grid size-9 place-items-center rounded-xl bg-primary-500 text-white">
			<Icon name={activeCall === 'video' ? 'i-lucide-video' : 'i-lucide-phone'} class="size-4" />
			<span
				class="absolute -top-1 -right-1 size-2.5 rounded-full bg-emerald-400 ring-2 ring-[var(--surface-bg)] {callState ===
				'reconnecting'
					? 'live-pulse'
					: ''}"
			></span>
		</div>
		<button type="button" class="min-w-0 text-left" onclick={() => (callMinimized = false)}>
			<p class="max-w-40 truncate text-[12px] font-bold">{callDisplayTitle()}</p>
			<p class="text-[11px] text-[var(--ui-text-muted)]">
				{callState === 'connected'
					? formatDuration(callElapsedSeconds)
					: callState === 'reconnecting'
						? 'Reconnecting...'
						: 'Connecting...'}
			</p>
		</button>
		<Button
			color="neutral"
			variant="soft"
			square
			icon="i-lucide-maximize-2"
			aria-label="Restore call"
			onclick={() => (callMinimized = false)}
		/>
		<Button
			color="error"
			variant="soft"
			square
			icon="i-lucide-phone-off"
			aria-label="End call"
			onclick={() => endCall()}
		/>
	</div>
{/if}
