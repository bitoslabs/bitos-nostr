<script module lang="ts">
	const activeFeedVideos = new Set<HTMLVideoElement>();

	function pauseOtherFeedVideos(activeVideo: HTMLVideoElement) {
		for (const video of activeFeedVideos) {
			if (video !== activeVideo) video.pause();
		}
	}
</script>

<script lang="ts">
	import { browser } from '$app/environment';
	import { noteEncode, npubEncode } from 'nostr-tools/nip19';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import StoryRing from './StoryRing.svelte';
	import ReplyComposer from './ReplyComposer.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import MediaPlayer from '$lib/components/media/MediaPlayer.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import MenuItem from '$lib/components/ui/MenuItem.svelte';
	import MenuDivider from '$lib/components/ui/MenuDivider.svelte';
	import ReportDialog from '$lib/components/ui/ReportDialog.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { feed } from '$lib/nostr/feed.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { shortKey, timeAgo, timeFull } from '$lib/utils/format';
	import { hasNip05, hasLightning } from '$lib/utils/verification';
	import { makeParticles, type Particle } from '$lib/utils/burst';
	import { popovers } from '$lib/stores/popovers.svelte';
	import { hashtagFollows } from '$lib/stores/hashtag-follows.svelte';
	import { bookmarks } from '$lib/stores/bookmarks.svelte';
	import { interactionProfile, extractTags } from '$lib/algorithm';
	import { privacyNotificationSettings } from '$lib/stores/privacy-notification-settings.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import type { FeedNote } from '$lib/nostr/types';
	import { sensitiveMediaReason as getSensitiveMediaReason } from '$lib/utils/sensitive-media';
	import { extractNotificationMedia, stripMediaUrls } from '$lib/utils/imeta';
	import {
		isEventReference,
		parseContent,
		splitTrailingPunctuation,
		hostFromUrl
	} from '$lib/utils/note-content';
	import CommentBody from './CommentBody.svelte';
	import MentionLink from './MentionLink.svelte';
	import NostrEventPreview from './NostrEventPreview.svelte';
	import Poll from './Poll.svelte';
	import NoteZapDialog from './NoteZapDialog.svelte';
	import PowBadge from '$lib/components/ui/PowBadge.svelte';

	type MediaAttachment = {
		type: 'image' | 'video' | 'audio' | 'embed' | 'link';
		url: string;
		host: string;
		/** Ordered mirror URLs — player failover chain (F-017 / READ-003). */
		fallbacks?: string[];
		embedUrl?: string;
		provider?: string;
	};

	let {
		note,
		index = 0,
		onNoteChange,
		onNoteHide,
		rankTag,
		onExplain,
		onInteract,
		flat = false,
		/** Apply the active primary colour as a readable tint over video thumbnails. */
		showVideoCover = true,
		/** Cover strength from 0 (transparent) to 1 (solid primary colour). */
		videoCoverOpacity = 0.52
	}: {
		note: FeedNote;
		index?: number;
		onNoteChange?: (note: FeedNote) => void;
		onNoteHide?: (id: string) => void;
		rankTag?: { label: string; icon: string; color: string };
		onExplain?: () => void;
		onInteract?: (note: FeedNote, kind: 'react' | 'save', active: boolean) => void;
		/** Use the surrounding list's dividers instead of an individual card surface. */
		flat?: boolean;
		showVideoCover?: boolean;
		videoCoverOpacity?: number;
	} = $props();

	const imagePattern = /\.(?:apng|avif|gif|jpe?g|png|webp)$/i;
	const videoPattern = /\.(?:m3u8|m4v|mov|mp4|webm)$/i;
	const audioPattern = /\.(?:aac|flac|m4a|mp3|ogg|opus|wav)$/i;
	const imageFormatPattern = /(?:[?&](?:ext|fm|format)=)(?:apng|avif|gif|jpe?g|png|webp)\b/i;
	const imagePathPattern =
		/(?:^|\/)(?:avatar|avatars|cdn-cgi\/image|image|images|img|media|photo|photos|picture|resize|thumbnail|thumb|upload|uploads)(?:\/|$|:|-|_)/i;
	const urlPattern = /https?:\/\/[^\s<>()]+/giu;
	const longTextLimit = 420;
	const MAX_VISIBLE_MEDIA = 6;
	let optimisticZapSats = $state(0);
	let optimisticZapBase = $state(0);

	const profile = $derived(profiles.get(note.pubkey));
	const displayName = $derived(profile?.display_name || profile?.name || shortKey(note.pubkey));
	const lightningAddress = $derived(profile?.lud16 || profile?.lud06 || '');
	const isMe = $derived(identity.current?.pk === note.pubkey);
	const liked = $derived(note.reactions.some((r) => r.byMe));
	const reactionCount = $derived(note.reactions.reduce((s, r) => s + r.count, 0));
	const visibleZapSats = $derived(note.zapTotalSats + optimisticZapSats);
	const visibleZapCount = $derived(note.zapCount + (optimisticZapSats ? 1 : 0));
	const zapLabel = $derived(
		visibleZapSats
			? `${compactSats(visibleZapSats)} sats`
			: visibleZapCount
				? `${visibleZapCount} zaps`
				: 'Zap'
	);
	const menuId = $derived(`post-menu:${note.id}`);
	/** Which of the user's followed hashtags matched this note (max 2 for the label). */
	const followedTagMatches = $derived.by(() => {
		if (note.source !== 'followed-tag') return [];
		const followed = hashtagFollows.tags;
		const matches: string[] = [];
		for (const tag of note.tags) {
			const name = tag[0] === 't' ? (tag[1] ?? '').toLowerCase() : '';
			if (name && followed.includes(name) && !matches.includes(name)) matches.push(name);
		}
		return matches.slice(0, 2);
	});
	const followedTagLabel = $derived(
		followedTagMatches.length
			? followedTagMatches.length === 1
				? `following #${followedTagMatches[0]}`
				: `following #${followedTagMatches[0]} +${followedTagMatches.length - 1}`
			: 'following a hashtag'
	);
	let reportOpen = $state(false);
	const noteLink = $derived(`nostr:${noteEncode(note.id)}`);
	const authorNpub = $derived(npubEncode(note.pubkey));
	const rawNote = $derived(
		JSON.stringify(
			{
				id: note.id,
				author: note.pubkey,
				authorNpub,
				createdAt: note.createdAt,
				content: note.content,
				tags: note.tags,
				replyTo: note.replyTo,
				reactions: note.reactions,
				repostCount: note.repostCount,
				zapCount: note.zapCount,
				zapTotalSats: note.zapTotalSats
			},
			null,
			2
		)
	);
	const mediaAttachments = $derived(extractMedia(note.content, note.tags));
	// Attachment URLs do not add useful context once their media/link card is
	// rendered below. Removing them here keeps the body to the author's caption
	// and prevents attachment-only notes from incorrectly needing “Show more”.
	const captionContent = $derived(
		stripMediaUrls(
			note.content,
			mediaAttachments.map((media) => media.url)
		)
			.replace(/[ \t]+\n/g, '\n')
			.replace(/\n{3,}/g, '\n\n')
			.trim()
	);
	let expanded = $state(false);
	const isLong = $derived(
		captionContent.length > longTextLimit || captionContent.split('\n').length > 8
	);
	const visibleContent = $derived(
		isLong && !expanded ? `${captionContent.slice(0, longTextLimit).trimEnd()}…` : captionContent
	);
	const contentTokens = $derived(parseContent(visibleContent));
	const previewableMedia = $derived(
		mediaAttachments.filter((media) => media.type === 'image' || media.type === 'video')
	);
	// A note whose single attachment is a video plays inline in the card
	// (X-style) instead of opening the focused viewer. Multi-media notes keep
	// the viewer so dense grids stay quick to scan.
	const singleVideoMedia = $derived(
		mediaAttachments.length === 1 && mediaAttachments[0].type === 'video'
			? mediaAttachments[0]
			: null
	);
	let inlineVideoActive = $state(false);
	const firstAttachment = $derived(mediaAttachments[0]);
	const visibleMediaAttachments = $derived(mediaAttachments.slice(0, MAX_VISIBLE_MEDIA));
	const hiddenMediaCount = $derived(
		Math.max(0, mediaAttachments.length - visibleMediaAttachments.length)
	);
	let burst = $state(false);
	let articleEl = $state<HTMLElement | undefined>(undefined);
	let likeBursts = $state<{ id: number; x: number; y: number; particles: Particle[] }[]>([]);
	let likeBurstSeq = 0;
	let rawOpen = $state(false);
	let zapOpen = $state(false);
	let deleteOpen = $state(false);
	let pendingDelete = $state<FeedNote | null>(null);
	let deleting = $state(false);
	// Feed tiles should be quick to scan, especially in a two-column mobile
	// grid. Keep the full player in a focused viewer instead of putting a
	// complete control bar inside every tile.
	let mediaViewerOpen = $state(false);
	let mediaViewerIndex = $state(0);
	const selectedViewerMedia = $derived(
		mediaViewerOpen ? (previewableMedia[mediaViewerIndex] ?? null) : null
	);
	let replyOpen = $state(false);
	let replyFocusTick = $state(0);
	let showAllReplies = $state(false);
	let refreshingComments = $state(false);
	let commentsLoaded = $state(false);
	let replyingToCommentId = $state('');
	let optimisticReplies = $state<FeedNote[]>([]);
	let failedMedia = $state<Record<string, boolean>>({});
	let revealedSensitiveMedia = $state<Record<string, boolean>>({});
	const sensitiveReason = $derived(sensitiveMediaReason());
	const shouldCoverMedia = $derived(
		privacyNotificationSettings.state.hideSensitiveMedia && !!sensitiveReason
	);
	const allReplies = $derived.by(() => {
		const byId = new Map(feed.notes.map((reply) => [reply.id, reply]));
		for (const reply of optimisticReplies) byId.set(reply.id, reply);
		return [...byId.values()];
	});
	const directReplies = $derived(
		allReplies
			.filter((reply) => reply.replyTo === note.id && reply.id !== note.id)
			.sort((a, b) => a.createdAt - b.createdAt)
	);
	// Keep chronological order, but show the newest comments while collapsed so
	// a freshly submitted reply is visible immediately under the note.
	const visibleReplies = $derived(showAllReplies ? directReplies : directReplies.slice(-2));
	const hiddenReplyCount = $derived(Math.max(0, directReplies.length - visibleReplies.length));
	const saved = $derived(bookmarks.has(note.id));
	const deleteTargetLabel = $derived(pendingDelete?.id === note.id ? 'note' : 'comment');
	const canCommentOnNote = $derived(privacyNotificationSettings.canCommentOn(note.pubkey));

	function sensitiveMediaReason() {
		return getSensitiveMediaReason(note.tags, note.content);
	}

	function isMediaRevealed(url: string) {
		return !!revealedSensitiveMedia[url];
	}

	function revealMedia(url: string) {
		revealedSensitiveMedia = { ...revealedSensitiveMedia, [url]: true };
	}

	function shouldHideImage(url: string) {
		return shouldCoverMedia && !isMediaRevealed(url);
	}

	function shouldHideVideo(url: string) {
		return shouldCoverMedia && !isMediaRevealed(url);
	}

	function mediaGridClass(count: number) {
		if (count <= 1) return 'grid-cols-1';
		if (count === 2) return 'grid-cols-2';
		if (count <= 5) return 'grid-cols-2';
		return 'grid-cols-2 sm:grid-cols-3';
	}

	function mediaGridStyle(count: number) {
		if (count <= 1) return '';
		if (count === 2) return 'grid-auto-rows: minmax(0, 220px);';
		if (count === 3)
			return 'grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr); grid-auto-rows: minmax(0, 160px);';
		if (count === 4) return 'grid-auto-rows: minmax(0, 150px);';
		if (count === 5)
			return 'grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr); grid-auto-rows: minmax(0, 125px);';
		return 'grid-auto-rows: minmax(0, 120px);';
	}

	function mediaTileClass(index: number, count: number) {
		if (count <= 2) return 'aspect-video';
		if ((count === 3 || count === 5) && index === 0) return 'row-span-2';
		return '';
	}

	function mediaContentClass(count: number) {
		return count <= 2 ? 'aspect-video' : 'size-full';
	}

	function videoCoverStyle() {
		const opacity = Math.min(1, Math.max(0, videoCoverOpacity));
		return `--video-cover-opacity: ${opacity};`;
	}

	function singleVideoStyle() {
		// Keep the post-player stage consistently sized; the contained video still
		// preserves its source proportions within this 500px default surface.
		return 'width: 100%; height: 500px;';
	}

	function compactSats(count: number) {
		if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
		if (count >= 1000) return `${(count / 1000).toFixed(count >= 10_000 ? 0 : 1)}K`;
		return `${count}`;
	}

	function commentLiked(reply: FeedNote) {
		return reply.reactions.some((reaction) => reaction.byMe);
	}

	function commentReactionCount(reply: FeedNote) {
		return reply.reactions.reduce((sum, reaction) => sum + reaction.count, 0);
	}

	/** Zap-a-comment state: one shared dialog, optimistic sats per comment id. */
	let zapCommentTarget = $state<FeedNote | null>(null);
	let zapCommentOpen = $state(false);
	let optimisticCommentZaps = $state<Record<string, number>>({});

	const zapCommentProfile = $derived(
		zapCommentTarget ? profiles.get(zapCommentTarget.pubkey) : undefined
	);
	const zapCommentAddress = $derived(zapCommentProfile?.lud16 || zapCommentProfile?.lud06 || '');

	function commentZapSats(reply: FeedNote) {
		return reply.zapTotalSats + (optimisticCommentZaps[reply.id] ?? 0);
	}

	function zapComment(reply: FeedNote) {
		const profile = profiles.get(reply.pubkey);
		if (!profile?.lud16 && !profile?.lud06) {
			toasts.info('This author has no Lightning address');
			return;
		}
		zapCommentTarget = reply;
		zapCommentOpen = true;
	}

	function handleCommentZapPaid(sats: number) {
		if (!zapCommentTarget) return;
		optimisticCommentZaps = {
			...optimisticCommentZaps,
			[zapCommentTarget.id]: (optimisticCommentZaps[zapCommentTarget.id] ?? 0) + sats
		};
	}

	/** All replies under a top-level comment, flattened to a single level
	 * (X-style threading): a reply to a sub-reply still renders directly under
	 * the original comment — the thread never nests deeper than two levels. */
	function descendantReplies(commentId: string, seen: string[] = []): FeedNote[] {
		if (seen.includes(commentId)) return [];
		const out: FeedNote[] = [];
		for (const reply of allReplies) {
			if (reply.replyTo !== commentId) continue;
			out.push(reply, ...descendantReplies(reply.id, [...seen, commentId]));
		}
		return out.sort((a, b) => a.createdAt - b.createdAt);
	}

	function addOptimisticReply(reply: FeedNote) {
		optimisticReplies = [
			...optimisticReplies.filter((existing) => existing.id !== reply.id),
			reply
		];
	}

	async function copyText(value: string, label: string) {
		try {
			await navigator.clipboard.writeText(value);
			toasts.success(`${label} copied`);
		} catch {
			toasts.error(`Could not copy ${label.toLowerCase()}`);
		} finally {
			popovers.close();
		}
	}

	function openAttachment() {
		if (!browser || !firstAttachment) return;
		window.open(firstAttachment.url, '_blank', 'noopener,noreferrer');
		popovers.close();
	}

	function openMediaViewer(media: MediaAttachment) {
		const index = previewableMedia.findIndex((candidate) => candidate.url === media.url);
		mediaViewerIndex = index >= 0 ? index : 0;
		mediaViewerOpen = true;
	}

	function previousViewerMedia() {
		if (mediaViewerIndex > 0) mediaViewerIndex -= 1;
	}

	function nextViewerMedia() {
		if (mediaViewerIndex < previewableMedia.length - 1) mediaViewerIndex += 1;
	}

	function onMediaViewerKey(event: KeyboardEvent) {
		if (!mediaViewerOpen) return;
		if (event.key === 'Escape') mediaViewerOpen = false;
		else if (event.key === 'ArrowLeft') previousViewerMedia();
		else if (event.key === 'ArrowRight') nextViewerMedia();
	}

	function trackFeedVideo(node: HTMLVideoElement) {
		activeFeedVideos.add(node);

		const handlePlay = () => {
			pauseOtherFeedVideos(node);
		};

		node.addEventListener('play', handlePlay);

		return {
			destroy() {
				node.removeEventListener('play', handlePlay);
				activeFeedVideos.delete(node);
			}
		};
	}

	async function startReply() {
		if (!identity.current) {
			toasts.error('Create or import a key first');
			return;
		}
		replyOpen = true;
		replyFocusTick++;
		if (!commentsLoaded && !refreshingComments) {
			refreshingComments = true;
			try {
				await feed.refreshReplies(note.id);
				commentsLoaded = true;
			} catch (e) {
				toasts.error((e as Error).message || 'Could not load comments');
			} finally {
				refreshingComments = false;
			}
		}
	}

	function startCommentReply(reply: FeedNote) {
		if (!identity.current) {
			toasts.error('Create or import a key first');
			return;
		}
		replyingToCommentId = replyingToCommentId === reply.id ? '' : reply.id;
	}

	function embedForUrl(url: string): Pick<MediaAttachment, 'embedUrl' | 'provider'> | null {
		try {
			const parsed = new URL(url);
			const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
			if (host === 'youtu.be') {
				const id = parsed.pathname.split('/').filter(Boolean)[0];
				return id
					? { embedUrl: `https://www.youtube-nocookie.com/embed/${id}`, provider: 'YouTube' }
					: null;
			}
			if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
				const id =
					parsed.searchParams.get('v') ||
					(parsed.pathname.startsWith('/shorts/')
						? parsed.pathname.split('/').filter(Boolean)[1]
						: '') ||
					(parsed.pathname.startsWith('/embed/')
						? parsed.pathname.split('/').filter(Boolean)[1]
						: '');
				return id
					? { embedUrl: `https://www.youtube-nocookie.com/embed/${id}`, provider: 'YouTube' }
					: null;
			}
			if (host === 'vimeo.com' || host.endsWith('.vimeo.com')) {
				const id = parsed.pathname
					.split('/')
					.filter(Boolean)
					.find((part) => /^\d+$/.test(part));
				return id ? { embedUrl: `https://player.vimeo.com/video/${id}`, provider: 'Vimeo' } : null;
			}
		} catch {
			return null;
		}
		return null;
	}

	function mediaType(url: string): MediaAttachment['type'] {
		if (embedForUrl(url)) return 'embed';
		try {
			const parsed = new URL(url);
			const pathname = decodeURIComponent(parsed.pathname);
			if (videoPattern.test(pathname)) return 'video';
			if (audioPattern.test(pathname)) return 'audio';
			if (
				imagePattern.test(pathname) ||
				imageFormatPattern.test(parsed.search) ||
				imagePathPattern.test(pathname)
			)
				return 'image';
		} catch {
			if (/\.(?:m3u8|m4v|mov|mp4|webm)(?:[?#].*)?$/i.test(url)) return 'video';
			if (/\.(?:aac|flac|m4a|mp3|ogg|opus|wav)(?:[?#].*)?$/i.test(url)) return 'audio';
			if (/\.(?:apng|avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(url)) return 'image';
		}
		return 'link';
	}

	function markMediaFailed(url: string) {
		failedMedia = { ...failedMedia, [url]: true };
	}

	function extractMedia(content: string, tags: string[][] = []) {
		const seen: string[] = [];
		const attachments: MediaAttachment[] = [];

		// NIP-92 imeta tags can describe media even when the URL has no
		// recognizable file extension. Keep the main card in sync with the
		// richer notification/comment media renderer.
		for (const item of extractNotificationMedia({ content, tags })) {
			if (item.kind !== 'image' && item.kind !== 'gif' && item.kind !== 'video') continue;
			seen.push(item.url);
			attachments.push({
				type: item.kind === 'video' ? 'video' : 'image',
				url: item.url,
				host: hostFromUrl(item.url),
				fallbacks: item.fallbacks
			});
		}

		for (const match of content.matchAll(urlPattern)) {
			const { core } = splitTrailingPunctuation(match[0]);
			if (seen.includes(core)) continue;
			seen.push(core);
			const type = mediaType(core);
			const embed = type === 'embed' ? embedForUrl(core) : null;
			if (type === 'link' && attachments.some((item) => item.type !== 'link')) continue;
			attachments.push({ type, url: core, host: hostFromUrl(core), ...embed });
		}
		return attachments.slice(0, 9);
	}

	function toggleSaved() {
		const nextSaved = bookmarks.toggle(note);
		onInteract?.(note, 'save', nextSaved);
		if (nextSaved) {
			toasts.success('Saved');
		} else {
			toasts.info('Removed from saved');
		}
		popovers.close();
	}

	function hideNote() {
		feed.hideNote(note.id);
		onNoteHide?.(note.id);
		toasts.info('Note hidden');
		popovers.close();
	}

	/** "Not interested" — hide + record a soft negative signal so similar notes
	 *  rank lower. The single most important trust action in any feed. */
	function notInterested() {
		interactionProfile.dismissNote(note.id);
		feed.hideNote(note.id);
		onNoteHide?.(note.id);
		toasts.success("Got it — we'll show less like this");
		popovers.close();
	}

	function toggleMuteAuthor() {
		const muted = interactionProfile.toggleMutedAuthor(note.pubkey);
		toasts.info(muted ? `Showing less from ${displayName}` : `Showing more from ${displayName}`);
		popovers.close();
	}

	function toggleMuteTag(tag: string) {
		const muted = interactionProfile.toggleMutedTag(tag);
		toasts.info(muted ? `Showing less about #${tag}` : `Showing more about #${tag}`);
		popovers.close();
	}

	function muteAuthor() {
		feed.muteAuthor(note.pubkey);
		toasts.info(`Muted ${displayName}`);
		popovers.close();
	}

	function blockAuthor() {
		if (feed.blockAuthor(note.pubkey)) toasts.success(`Blocked ${displayName}`);
		else toasts.info(`${displayName} is already blocked`);
		popovers.close();
	}

	function askDeleteNote() {
		popovers.close();
		pendingDelete = note;
		deleteOpen = true;
	}

	function cancelDelete() {
		if (deleting) return;
		pendingDelete = null;
		deleteOpen = false;
	}

	async function confirmDelete() {
		const target = pendingDelete;
		if (!target || deleting) return;
		deleting = true;
		try {
			await feed.deleteNote(target);
			pendingDelete = null;
			deleteOpen = false;
			toasts.success('Deletion request published');
		} catch (e) {
			toasts.error((e as Error).message || 'Could not publish deletion request');
		} finally {
			deleting = false;
		}
	}

	function showRaw() {
		rawOpen = true;
		popovers.close();
	}

	async function react(e?: MouseEvent) {
		// Capture the click target synchronously — `e.currentTarget` is nulled
		// once the event finishes dispatching (i.e. after the first `await`).
		const targetEl = (e?.currentTarget as HTMLElement | null) ?? null;
		try {
			const wasLiked = liked;
			await feed.react(note, '❤️');
			// feed.react applies the optimistic event to the authoritative store.
			// Read it back instead of rebuilding from a potentially stale card prop;
			// this matters for notes rendered in the New posts section.
			if (onNoteChange) onNoteChange(feed.getNote(note.id) ?? nextLocalReaction(note, wasLiked));
			if (!wasLiked) {
				onInteract?.(note, 'react', true);
				burst = true;
				setTimeout(() => (burst = false), 600);
				if (targetEl && articleEl) {
					const a = articleEl.getBoundingClientRect();
					const t = targetEl.getBoundingClientRect();
					triggerLikeBurst(t.left + t.width / 2 - a.left, t.top + t.height / 2 - a.top);
				}
			}
		} catch (err) {
			toasts.error((err as Error).message);
		}
	}

	async function repost() {
		try {
			await feed.repost(note);
			toasts.success('Reposted');
		} catch (err) {
			toasts.error((err as Error).message || 'Could not repost');
		}
	}

	function triggerLikeBurst(x: number, y: number) {
		const id = ++likeBurstSeq;
		likeBursts = [...likeBursts, { id, x, y, particles: makeParticles(12) }];
		setTimeout(() => {
			likeBursts = likeBursts.filter((b) => b.id !== id);
		}, 1100);
	}

	function nextLocalReaction(current: FeedNote, wasLiked: boolean): FeedNote {
		if (wasLiked) {
			return {
				...current,
				reactions: current.reactions
					.map((reaction) =>
						reaction.byMe
							? {
									...reaction,
									count: Math.max(0, reaction.count - 1),
									byMe: false,
									myEventId: undefined
								}
							: reaction
					)
					.filter((reaction) => reaction.count > 0)
			};
		}

		const reactions = current.reactions.map((reaction) => ({ ...reaction }));
		const existing = reactions.find((reaction) => reaction.emoji === '❤️');
		if (existing) {
			existing.count += 1;
			existing.byMe = true;
		} else {
			reactions.push({ emoji: '❤️', count: 1, byMe: true });
		}
		return { ...current, reactions };
	}

	function zapNote() {
		if (!lightningAddress) {
			toasts.info('This author has no Lightning address');
			return;
		}
		zapOpen = true;
	}

	function handleZapPaid(sats: number) {
		optimisticZapBase = note.zapTotalSats;
		optimisticZapSats = sats;
	}

	$effect(() => {
		if (optimisticZapSats > 0 && note.zapTotalSats > optimisticZapBase) {
			optimisticZapSats = 0;
			optimisticZapBase = 0;
		}
	});

	async function reactToComment(reply: FeedNote) {
		try {
			await feed.react(reply, '❤️');
		} catch (e) {
			toasts.error((e as Error).message);
		}
	}

	async function refreshComments() {
		if (refreshingComments) return;
		refreshingComments = true;
		try {
			await feed.refreshReplies(note.id);
			commentsLoaded = true;
			toasts.success('Comments refreshed');
		} catch (e) {
			toasts.error((e as Error).message || 'Could not refresh comments');
		} finally {
			refreshingComments = false;
		}
	}

	function hideComment(reply: FeedNote) {
		feed.hideNote(reply.id);
		toasts.info('Comment hidden');
	}

	function askDeleteComment(reply: FeedNote) {
		pendingDelete = reply;
		deleteOpen = true;
	}

	$effect(() => {
		if (identity.current) profiles.ensure([identity.current.pk]);
	});
</script>

<!-- Level-2 replies under a top-level comment (reply to a comment). Every
	reply gets the same action row — like, zap, reply, hide, delete. Replying
	here posts a NIP-10 reply to this comment, but the result renders flat at
	level 2 under the same top-level comment: the thread stays 2 levels max. -->
{#snippet subReply(comment: FeedNote)}
	{@const commentProfile = profiles.get(comment.pubkey)}
	{@const commentName =
		commentProfile?.display_name || commentProfile?.name || shortKey(comment.pubkey)}
	<div class="flex gap-2">
		<a href={`/profile/${comment.pubkey}`} class="shrink-0">
			<Avatar
				pubkey={comment.pubkey}
				name={commentName}
				picture={commentProfile?.picture}
				lightning={hasLightning(commentProfile)}
				size={22}
			/>
		</a>
		<div class="min-w-0 flex-1">
			<div class="flex min-w-0 items-center gap-1.5">
				<a
					href={`/profile/${comment.pubkey}`}
					class="truncate text-[12px] font-bold hover:text-primary-500"
				>
					{commentName}
				</a>
				{#if hasNip05(commentProfile)}
					<Icon
						name="i-lucide-badge-check"
						class="size-3 shrink-0 text-primary-500"
						title="NIP-05 verified: {commentProfile?.nip05}"
					/>
				{/if}
				{#if identity.current?.pk === comment.pubkey}
					<span
						class="rounded-full bg-primary-500/15 px-1 py-px text-[9px] font-bold text-primary-600 uppercase"
						>you</span
					>
				{/if}
				{#if comment.pow}
					<PowBadge bits={comment.pow} micro id={comment.id} />
				{/if}
				<time
					class="shrink-0 text-[10.5px] text-[var(--ui-text-dimmed)]"
					title={timeFull(comment.createdAt)}>{timeAgo(comment.createdAt)}</time
				>
			</div>
			<CommentBody content={comment.content} tags={comment.tags} compact />
			<div class="mt-1 flex items-center gap-3 text-[11px] font-bold">
				<button
					type="button"
					onclick={() => reactToComment(comment)}
					class="inline-flex items-center gap-1 {commentLiked(comment)
						? 'text-[var(--tone-error-text)]'
						: 'text-[var(--ui-text-dimmed)] hover:text-[var(--tone-error-text)]'}"
				>
					<Icon
						name={commentLiked(comment) ? 'i-solar-heart-bold' : 'i-solar-heart-linear'}
						class="size-3"
					/>
					{commentLiked(comment) ? 'Unlike' : 'Like'}
					{#if commentReactionCount(comment)}
						<span class="font-semibold"> · {commentReactionCount(comment)}</span>
					{/if}
				</button>
				<button
					type="button"
					onclick={() => zapComment(comment)}
					class="inline-flex items-center gap-1 text-[var(--ui-text-dimmed)] transition hover:text-warm-500"
					aria-label="Zap sats to this reply"
				>
					<Icon name="i-lucide-zap" class="size-3" />
					Zap{#if commentZapSats(comment)}
						<span class="font-semibold"> · {compactSats(commentZapSats(comment))}</span>
					{/if}
				</button>
				<button
					type="button"
					onclick={() => startCommentReply(comment)}
					disabled={!privacyNotificationSettings.canCommentOn(comment.pubkey)}
					class="text-[var(--ui-text-dimmed)] hover:text-primary-500 disabled:pointer-events-none disabled:opacity-40"
				>
					Reply
				</button>
				<button
					type="button"
					onclick={() => hideComment(comment)}
					class="text-[var(--ui-text-dimmed)] hover:text-primary-500"
				>
					Hide
				</button>
				{#if identity.current?.pk === comment.pubkey}
					<button
						type="button"
						onclick={() => askDeleteComment(comment)}
						class="text-[var(--ui-text-dimmed)] hover:text-[var(--ui-text)]"
					>
						Delete
					</button>
				{/if}
			</div>

			{#if replyingToCommentId === comment.id}
				<div class="mt-3">
					<ReplyComposer
						parent={comment}
						placeholder={`Reply to ${commentName}…`}
						autofocus
						initialMention={{ pubkey: comment.pubkey, name: commentName }}
						onSubmitted={(reply) => {
							addOptimisticReply(reply);
							replyingToCommentId = '';
						}}
						onCancel={() => (replyingToCommentId = '')}
					/>
				</div>
			{/if}
		</div>
	</div>
{/snippet}

<article
	bind:this={articleEl}
	class="{flat ? '' : 'post-card'} fade-up relative flex gap-3 overflow-visible px-4 pt-4"
	style="animation-delay:{index * 0.05}s"
>
	<!-- Avatar rail: X-style layout keeps body + media aligned under the name,
		not under the avatar. -->
	<a href={`/profile/${note.pubkey}`} class="shrink-0" aria-label={displayName}>
		<StoryRing pubkey={note.pubkey} interactive={false}>
			<Avatar
				pubkey={note.pubkey}
				name={displayName}
				picture={profile?.picture}
				lightning={hasLightning(profile)}
				size={44}
			/>
		</StoryRing>
	</a>
	<!-- Content column: name, body, media and actions all share one left edge. -->
	<div class="min-w-0 flex-1">
		<!-- Author header -->
		<header class="flex items-start justify-between gap-2">
			<a href={`/profile/${note.pubkey}`} class="min-w-0 flex-1 leading-tight">
				<p class="flex min-w-0 items-center gap-1.5 text-[14px] font-bold">
					<span class="truncate">{displayName}</span>
					{#if hasNip05(profile)}<Icon
							name="i-lucide-badge-check"
							class="size-4 shrink-0 text-primary-500"
							title="NIP-05 verified: {profile?.nip05}"
						/>{/if}
					{#if isMe}
						<span
							class="rounded-full bg-primary-500/15 px-1.5 py-px text-[9px] font-bold text-primary-600 uppercase"
							>you</span
						>
					{/if}
				</p>
				<p class="flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--ui-text-dimmed)]">
					<span class="truncate font-mono">{shortKey(note.pubkey, 8, 6)}</span>
					<span>·</span>
					<time class="shrink-0" title={timeFull(note.createdAt)}>{timeAgo(note.createdAt)}</time>
					{#if note.source === 'discovery'}
						<span>·</span>
						<span
							class="shrink-0 text-primary-500"
							title="Found through an optional discovery relay">discovery</span
						>
					{/if}
					{#if followedTagMatches.length || note.source === 'followed-tag'}
						<span>·</span>
						<span
							class="shrink-0 text-primary-500"
							title="In your feed because you follow this hashtag">{followedTagLabel}</span
						>
					{/if}
				</p>
			</a>

			<div class="flex shrink-0 items-center gap-1">
				{#if rankTag}
					<button
						type="button"
						onclick={(e) => {
							e.preventDefault();
							e.stopPropagation();
							onExplain?.();
						}}
						class="hidden shrink-0 items-center gap-1 rounded-full border border-[var(--ui-border-muted)] px-2 py-0.5 text-[10px] font-bold transition hover:border-primary-500/40 hover:bg-primary-500/5 sm:inline-flex"
						style="color:{rankTag.color}"
						title="Why am I seeing this?"
					>
						<Icon name={rankTag.icon} class="size-3" />
						{rankTag.label}
					</button>
				{/if}
				<span
					class="hidden rounded-full border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-2 py-1 font-mono text-[10px] text-[var(--ui-text-muted)] sm:inline"
					title="Nostr event kind">kind:1</span
				>
				<button
					type="button"
					onclick={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void copyText(note.id, 'Note ID');
					}}
					class="grid size-8 place-items-center rounded-lg text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
					aria-label="Copy event fingerprint"
					title="Copy event fingerprint"
				>
					<Icon name="i-lucide-fingerprint" class="size-4" />
				</button>
				<Popover
					id={menuId}
					placement="bottom-end"
					width="auto"
					class="w-60"
					label="Post actions"
					triggerClass="grid size-9 place-items-center rounded-lg text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)]"
					triggerActiveClass="bg-[var(--interactive-hover-bg)] text-[var(--ui-text)]"
				>
					{#snippet trigger()}
						<Icon name="i-lucide-ellipsis" class="size-5" />
					{/snippet}

					<MenuItem href={`/messages?to=${note.pubkey}`} icon="i-lucide-message-circle">
						Message author
					</MenuItem>
					<MenuItem
						icon={saved ? 'i-lucide-bookmark-x' : 'i-lucide-bookmark'}
						onclick={toggleSaved}
					>
						{saved ? 'Unsave note' : 'Save note'}
					</MenuItem>
					<MenuItem icon="i-lucide-link" onclick={() => copyText(noteLink, 'Note link')}>
						Copy note link
					</MenuItem>
					<MenuItem icon="i-lucide-fingerprint" onclick={() => copyText(note.id, 'Note ID')}>
						Copy note ID
					</MenuItem>
					<MenuItem icon="i-lucide-text" onclick={() => copyText(note.content, 'Note text')}>
						Copy note text
					</MenuItem>
					{#if firstAttachment}
						<MenuItem icon="i-lucide-external-link" onclick={openAttachment}>
							Open attachment
						</MenuItem>
						<MenuItem
							icon="i-lucide-image"
							onclick={() => copyText(firstAttachment.url, 'Attachment URL')}
						>
							Copy attachment URL
						</MenuItem>
					{/if}
					<MenuItem icon="i-lucide-user-round" onclick={() => copyText(authorNpub, 'Author npub')}>
						Copy author npub
					</MenuItem>
					<MenuItem icon="i-lucide-braces" onclick={showRaw}>View raw note</MenuItem>

					<MenuDivider />

					<MenuItem icon="i-lucide-thumbs-down" onclick={notInterested}>Not interested</MenuItem>
					{#if !isMe}
						<MenuItem
							icon={interactionProfile.isAuthorMuted(note.pubkey)
								? 'i-lucide-eye'
								: 'i-lucide-eye-off'}
							onclick={toggleMuteAuthor}
						>
							{interactionProfile.isAuthorMuted(note.pubkey)
								? `Show more from ${displayName}`
								: `Show less from ${displayName}`}
						</MenuItem>
					{/if}
					{#each extractTags(note).slice(0, 3) as tag (tag)}
						{#if interactionProfile.isTagMuted(tag)}
							<MenuItem icon="i-lucide-eye" onclick={() => toggleMuteTag(tag)}>
								Show more about #{tag}
							</MenuItem>
						{:else}
							<MenuItem icon="i-lucide-hash" onclick={() => toggleMuteTag(tag)}>
								Show less about #{tag}
							</MenuItem>
						{/if}
					{/each}

					<MenuDivider />

					<MenuItem icon="i-lucide-eye-off" onclick={hideNote}>Hide note</MenuItem>
					{#if !isMe}
						<MenuItem icon="i-lucide-volume-x" onclick={muteAuthor}>Mute author</MenuItem>
						<MenuItem tone="danger" icon="i-lucide-ban" onclick={blockAuthor}>Block author</MenuItem
						>
						<MenuItem
							tone="danger"
							icon="i-lucide-flag"
							onclick={() => {
								popovers.close();
								reportOpen = true;
							}}
						>
							Report note
						</MenuItem>
					{:else}
						<MenuItem tone="danger" icon="i-lucide-trash-2" onclick={askDeleteNote}>
							Delete note
						</MenuItem>
					{/if}
				</Popover>
			</div>
		</header>

		<!-- Body -->
		{#if captionContent || note.poll || note.pow}
			<div class="pt-1.5 pb-3">
				<div class="text-[14.5px] leading-relaxed break-words whitespace-pre-wrap">
					{#each contentTokens as token, tokenIndex (`${token.type}:${tokenIndex}:${token.value}`)}
						{#if token.type === 'text'}
							{token.value}
						{:else if token.type === 'hashtag'}
							<a
								href={`/?tag=${encodeURIComponent(token.tag)}`}
								class="font-bold text-primary-500 transition hover:text-primary-600 hover:underline"
							>
								{token.value}
							</a>
						{:else if token.type === 'nostr'}
							{#if isEventReference(token.value)}
								<NostrEventPreview value={token.value} />
							{:else}
								<MentionLink value={token.value} />
							{/if}
						{:else}
							<a
								href={token.value}
								target="_blank"
								rel="noreferrer"
								class="font-semibold text-accent-500 transition hover:text-accent-600 hover:underline"
							>
								{token.host}
							</a>
						{/if}
					{/each}
				</div>
				{#if isLong}
					<button
						type="button"
						onclick={() => (expanded = !expanded)}
						class="mt-2 text-[13px] font-bold text-primary-500 transition hover:text-primary-600"
					>
						{expanded ? 'Show less' : 'Show more'}
					</button>
				{/if}

				{#if note.poll}
					<Poll {note} onVoted={onNoteChange} />
				{/if}
				{#if note.pow}
					<div class="mt-2">
						<PowBadge bits={note.pow} id={note.id} />
					</div>
				{/if}
			</div>
		{/if}

		{#if mediaAttachments.length}
			<div
				class="mb-3 grid gap-0.5 overflow-hidden rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] {mediaGridClass(
					visibleMediaAttachments.length
				)}"
				style={mediaGridStyle(visibleMediaAttachments.length)}
			>
				{#each visibleMediaAttachments as media, mediaIndex (media.url)}
					{@const tileClass = mediaTileClass(mediaIndex, visibleMediaAttachments.length)}
					{@const contentClass = mediaContentClass(visibleMediaAttachments.length)}
					{@const showMoreOverlay =
						hiddenMediaCount > 0 && mediaIndex === visibleMediaAttachments.length - 1}
					{#if media.type === 'image'}
						{#if failedMedia[media.url]}
							<a
								href={media.url}
								target="_blank"
								rel="noreferrer"
								class="{tileClass} flex min-h-32 items-center gap-3 p-4 transition hover:bg-[var(--interactive-hover-bg)]"
							>
								<span
									class="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-500/15 text-primary-500"
								>
									<Icon name="i-lucide-image-off" class="size-5" />
								</span>
								<span class="min-w-0">
									<span class="block truncate text-[13px] font-bold text-[var(--ui-text)]">
										Open image
									</span>
									<span class="block truncate text-[12px] text-[var(--ui-text-muted)]"
										>{media.url}</span
									>
								</span>
							</a>
						{:else if shouldHideImage(media.url)}
							<div class="{tileClass} relative block bg-black">
								<img
									src={media.url}
									alt="Blurred sensitive attachment"
									loading="lazy"
									referrerpolicy="no-referrer"
									onerror={() => markMediaFailed(media.url)}
									class="{contentClass} scale-105 object-cover blur-2xl saturate-50 transition"
								/>
								<button
									type="button"
									class="absolute inset-0 z-5 grid place-items-center bg-black/16 p-2 text-center text-white"
									onclick={() => revealMedia(media.url)}
									aria-label="Show sensitive media"
								>
									<span
										class="w-full max-w-[11rem] rounded-[18px] border border-white/15 bg-white/10 px-3 py-2 shadow-lg backdrop-blur-sm sm:max-w-48"
									>
										<span
											class="flex items-center justify-center gap-2 text-[11px] font-bold text-white"
										>
											<Icon name="i-lucide-eye-off" class="size-4" />
											<span>View</span>
										</span>
									</span>
								</button>
							</div>
						{:else}
							<button
								type="button"
								class="{tileClass} group relative block w-full bg-black"
								onclick={() => openMediaViewer(media)}
							>
								<img
									src={media.url}
									alt="Note attachment"
									loading="lazy"
									referrerpolicy="no-referrer"
									onerror={() => markMediaFailed(media.url)}
									class="{contentClass} object-cover transition group-hover:scale-[1.02]"
								/>
								<span
									class="absolute right-3 bottom-3 rounded-full bg-black/55 px-3 py-1 text-[11px] font-bold text-white opacity-0 transition group-hover:opacity-100"
								>
									Preview
								</span>
								{#if showMoreOverlay}
									<span
										class="absolute inset-0 grid place-items-center bg-black/55 text-3xl font-extrabold text-white"
									>
										+{hiddenMediaCount}
									</span>
								{/if}
							</button>
						{/if}
					{:else if media.type === 'video'}
						<div
							class="{tileClass} relative overflow-hidden bg-black"
							style={singleVideoMedia ? singleVideoStyle() : undefined}
						>
							{#if singleVideoMedia && inlineVideoActive && !shouldHideVideo(media.url)}
								<!-- Single-video note: the full player lives inline in the card
									(X-style). Mounted on first tap so the feed stays light to scan. -->
								<MediaPlayer
									src={media.url}
									label={`Video from ${media.host}`}
									fallbackSrcs={media.fallbacks}
									variant="reel"
									autoplay
									class="absolute inset-0"
									mediaClass="size-full object-contain"
									onMediaElement={(node) => {
										const registration = trackFeedVideo(node as HTMLVideoElement);
										return () => registration.destroy();
									}}
								/>
								<button
									type="button"
									onclick={() => openMediaViewer(media)}
									class="absolute top-2 right-2 z-20 grid size-9 place-items-center rounded-full bg-black/55 text-white shadow-lg backdrop-blur-sm transition hover:bg-black/75"
									aria-label="Open video in full viewer"
									title="Open in viewer"
								>
									<Icon name="i-lucide-maximize-2" class="size-4" />
								</button>
							{:else}
								<!-- A silent poster-like preview keeps dense mobile grids calm.
									Tapping plays a single video inline; gallery tiles open the
									focused viewer. -->
								<!-- svelte-ignore a11y_media_has_caption -->
								<video
									src={media.url}
									muted
									playsinline
									preload="metadata"
									class="size-full {singleVideoMedia
										? 'object-contain'
										: 'object-cover'} transition {!shouldHideVideo(media.url)
										? ''
										: 'scale-105 blur-2xl saturate-50'}"
								></video>
								{#if !shouldHideVideo(media.url)}
									{#if showVideoCover}
										<!-- The primary token is rewritten by the active theme, so this
											cover follows both the colour and requested opacity. -->
										<span
											class="video-cover pointer-events-none absolute inset-0 z-5"
											style={videoCoverStyle()}
										></span>
									{/if}
									<button
										type="button"
										onclick={() => {
											// One video in the note: play it right here in the card.
											// Galleries keep the focused viewer for prev/next browsing.
											if (singleVideoMedia) inlineVideoActive = true;
											else openMediaViewer(media);
										}}
										class="absolute inset-0 z-10 grid place-items-center bg-black/5 text-white transition hover:bg-black/20"
										aria-label={`Play video from ${media.host}`}
									>
										<span
											class="grid size-11 place-items-center rounded-full bg-black/55 shadow-lg backdrop-blur-sm"
										>
											<Icon name="i-lucide-play" class="ml-0.5 size-5 fill-current" />
										</span>
									</button>
								{/if}
							{/if}
							{#if showMoreOverlay}
								<div
									class="absolute inset-0 grid place-items-center bg-black/55 text-3xl font-extrabold text-white"
								>
									+{hiddenMediaCount}
								</div>
							{/if}
							{#if shouldHideVideo(media.url)}
								<button
									type="button"
									class="absolute inset-0 z-5 grid place-items-center bg-black/18 p-3 text-center text-white"
									onclick={() => revealMedia(media.url)}
									aria-label="Show sensitive video"
								>
									<span
										class="max-w-56 rounded-[22px] border border-white/25 bg-white/14 px-4 py-3 shadow-lg backdrop-blur-md backdrop-saturate-150"
									>
										<Icon name="i-lucide-eye-off" class="mx-auto mb-2 size-5 text-white/90" />
										<span class="block text-[13px] font-bold">Sensitive video</span>
										{#if privacyNotificationSettings.state.sensitiveReason}
											<span class="mt-1 block text-[11px] text-white/80">{sensitiveReason}</span>
										{/if}
										<span
											class="mt-2 inline-flex rounded-full border border-white/25 bg-white/90 px-3 py-1 text-[11px] font-bold text-black"
										>
											View
										</span>
									</span>
								</button>
							{/if}
						</div>
					{:else if media.type === 'audio'}
						<div class="{tileClass} flex min-h-28 flex-col justify-center gap-3 p-4">
							<div class="flex items-center gap-2 text-[13px] font-bold text-[var(--ui-text)]">
								<Icon name="i-lucide-audio-lines" class="size-4 text-primary-500" />
								<span class="truncate">{media.host}</span>
							</div>
							<MediaPlayer src={media.url} kind="audio" label={`Audio from ${media.host}`} />
						</div>
					{:else}
						<a
							href={media.url}
							target="_blank"
							rel="noreferrer"
							class="{tileClass} flex min-h-28 items-center gap-3 p-4 transition hover:bg-[var(--interactive-hover-bg)]"
						>
							<span
								class="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-500/15 text-primary-500"
							>
								<Icon name="i-lucide-external-link" class="size-5" />
							</span>
							<span class="min-w-0">
								<span class="block truncate text-[13px] font-bold text-[var(--ui-text)]">
									{media.host}
								</span>
								<span class="block truncate text-[12px] text-[var(--ui-text-muted)]"
									>{media.url}</span
								>
							</span>
						</a>
					{/if}
				{/each}
			</div>
		{/if}

		<!-- Reactions summary -->
		{#if reactionCount > 0 || visibleZapCount > 0 || note.repostCount > 0}
			<div
				class="flex items-center justify-between gap-2 pt-1 pb-1.5 text-[12px] text-[var(--ui-text-dimmed)]"
			>
				<div class="flex min-w-0 items-center gap-1.5">
					{#if reactionCount > 0}
						<span class="flex -space-x-1.5">
							{#each note.reactions.slice(0, 3) as r (r.emoji)}
								<span
									class="grid size-[18px] place-items-center rounded-full bg-[var(--ui-bg-muted)] text-[9px] ring-2 ring-[var(--surface-bg)]"
									>{r.emoji || '❤️'}</span
								>
							{/each}
						</span>
						<span class="font-semibold text-[var(--ui-text-muted)]">{reactionCount}</span>
					{/if}
				</div>
				<div class="flex shrink-0 items-center gap-3">
					{#if note.repostCount > 0}<span>{note.repostCount} reposts</span>{/if}
					{#if visibleZapCount > 0}
						<span class="inline-flex items-center gap-0.5">
							{compactSats(visibleZapSats)} sats
						</span>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Action bar -->
		<div class="mb-2 flex items-center justify-between gap-1 py-2">
			<button
				type="button"
				onclick={react}
				class="group relative flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-[12.5px] font-bold transition active:scale-90 md:flex-none md:px-3 {liked
					? 'text-[var(--tone-error-text)]'
					: 'text-[var(--ui-text-muted)] hover:bg-[var(--tone-error-bg)] hover:text-[var(--tone-error-text)]'}"
				aria-label={liked ? 'Unlike' : 'Like'}
				title={liked ? 'Unlike' : 'Like'}
			>
				<span class="relative grid place-items-center">
					<Icon
						name={liked ? 'i-solar-heart-bold' : 'i-solar-heart-linear'}
						class="size-[18px] transition group-active:scale-90"
					/>
					{#if burst}
						<span
							class="heart-burst pointer-events-none absolute inset-0 text-[var(--tone-error-text)]"
						>
							<Icon name="i-solar-heart-bold" class="size-[18px]" />
						</span>
					{/if}
				</span>
				{#if reactionCount > 0}
					<span class="tabular-nums">{reactionCount}</span>
				{:else}
					<span class="hidden md:inline">Like</span>
				{/if}
			</button>
			<button
				type="button"
				onclick={startReply}
				disabled={!canCommentOnNote}
				class="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-[12.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-primary-500/10 hover:text-primary-500 active:scale-90 disabled:pointer-events-none disabled:opacity-40 md:flex-none md:px-3"
				aria-label={directReplies.length
					? `${directReplies.length} ${directReplies.length === 1 ? 'comment' : 'comments'}`
					: 'Comment'}
				title="Comment"
			>
				<Icon name="i-lucide-message-circle" class="size-[18px]" />
				{#if directReplies.length > 0}
					<span class="tabular-nums">{directReplies.length}</span>
				{:else}
					<span class="hidden md:inline">Comment</span>
				{/if}
			</button>
			<button
				type="button"
				onclick={repost}
				disabled={!note.raw}
				class="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-[12.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-accent-500/10 hover:text-accent-600 active:scale-90 disabled:pointer-events-none disabled:opacity-40 md:flex-none md:px-3"
				aria-label="Repost"
				title={note.raw ? 'Repost' : 'Repost unavailable'}
			>
				<Icon name="i-lucide-repeat-2" class="size-[18px]" />
				<span class="hidden md:inline">Repost</span>
				{#if note.repostCount > 0}<span class="tabular-nums">{note.repostCount}</span>{/if}
			</button>
			<button
				type="button"
				onclick={zapNote}
				disabled={!lightningAddress}
				class="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-[12.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-warm-500/10 hover:text-warm-500 active:scale-90 disabled:pointer-events-none disabled:opacity-40 md:flex-none md:px-3"
				aria-label={zapLabel}
				title={lightningAddress ? zapLabel : 'Lightning address unavailable'}
			>
				<Icon name="i-lucide-zap" class="size-[18px]" />
				<span class="hidden md:inline">{zapLabel}</span>
			</button>
			<button
				type="button"
				onclick={toggleSaved}
				class="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-[12.5px] font-bold transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)] active:scale-90 md:flex-none md:px-3 {saved
					? 'text-primary-500'
					: 'text-[var(--ui-text-muted)]'}"
				aria-label={saved ? 'Unsave note' : 'Save note'}
				title={saved ? 'Unsave note' : 'Save note'}
			>
				<Icon name={saved ? 'i-lucide-bookmark-check' : 'i-lucide-bookmark'} class="size-[18px]" />
			</button>
		</div>

		{#if directReplies.length}
			<div class="mb-3 space-y-3 rounded-xl bg-[var(--ui-bg-muted)] p-3">
				<div class="flex items-center justify-between">
					<span class="text-[11px] font-bold text-[var(--ui-text-dimmed)] uppercase">Comments</span>
					<button
						type="button"
						onclick={refreshComments}
						disabled={refreshingComments}
						class="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)] disabled:cursor-not-allowed disabled:opacity-60"
						aria-label="Refresh comments"
					>
						<Icon
							name="i-lucide-refresh-cw"
							class="size-3.5 {refreshingComments ? 'animate-spin' : ''}"
						/>
						Refresh
					</button>
				</div>
				{#each visibleReplies as reply (reply.id)}
					{@const replyProfile = profiles.get(reply.pubkey)}
					{@const replyName =
						replyProfile?.display_name || replyProfile?.name || shortKey(reply.pubkey)}
					{@const children = descendantReplies(reply.id)}
					<div class="flex gap-2.5">
						<a href={`/profile/${reply.pubkey}`} class="shrink-0">
							<Avatar
								pubkey={reply.pubkey}
								name={replyName}
								picture={replyProfile?.picture}
								lightning={hasLightning(replyProfile)}
								size={28}
							/>
						</a>
						<div class="min-w-0 flex-1">
							<div class="flex min-w-0 items-center gap-1.5">
								<a
									href={`/profile/${reply.pubkey}`}
									class="truncate text-[12.5px] font-bold hover:text-primary-500"
								>
									{replyName}
								</a>
								{#if hasNip05(replyProfile)}
									<Icon
										name="i-lucide-badge-check"
										class="size-3.5 shrink-0 text-primary-500"
										title="NIP-05 verified: {replyProfile?.nip05}"
									/>
								{/if}
								{#if identity.current?.pk === reply.pubkey}
									<span
										class="rounded-full bg-primary-500/15 px-1.5 py-px text-[9px] font-bold text-primary-600 uppercase"
										>you</span
									>
								{/if}
								{#if reply.pow}
									<PowBadge bits={reply.pow} micro id={reply.id} />
								{/if}
								<time
									class="shrink-0 text-[11px] text-[var(--ui-text-dimmed)]"
									title={timeFull(reply.createdAt)}>{timeAgo(reply.createdAt)}</time
								>
							</div>
							<CommentBody content={reply.content} tags={reply.tags} />
							<div class="mt-1.5 flex items-center gap-3 text-[11.5px] font-bold">
								<button
									type="button"
									onclick={() => reactToComment(reply)}
									class="inline-flex items-center gap-1 {commentLiked(reply)
										? 'text-[var(--tone-error-text)]'
										: 'text-[var(--ui-text-dimmed)] hover:text-[var(--tone-error-text)]'}"
								>
									<Icon
										name={commentLiked(reply) ? 'i-solar-heart-bold' : 'i-solar-heart-linear'}
										class="size-3.5"
									/>
									{commentLiked(reply) ? 'Unlike' : 'Like'}
									{#if commentReactionCount(reply)}
										<span class="font-semibold"> · {commentReactionCount(reply)}</span>
									{/if}
								</button>
								<button
									type="button"
									onclick={() => zapComment(reply)}
									class="inline-flex items-center gap-1 text-[var(--ui-text-dimmed)] transition hover:text-warm-500"
									aria-label="Zap sats to this comment"
								>
									<Icon name="i-lucide-zap" class="size-3.5" />
									Zap{#if commentZapSats(reply)}
										<span class="font-semibold"> · {compactSats(commentZapSats(reply))}</span>
									{/if}
								</button>
								<button
									type="button"
									onclick={() => startCommentReply(reply)}
									disabled={!privacyNotificationSettings.canCommentOn(reply.pubkey)}
									class="text-[var(--ui-text-dimmed)] hover:text-primary-500 disabled:pointer-events-none disabled:opacity-40"
								>
									Reply
								</button>
								<button
									type="button"
									onclick={() => hideComment(reply)}
									class="text-[var(--ui-text-dimmed)] hover:text-primary-500"
								>
									Hide
								</button>
								{#if identity.current?.pk === reply.pubkey}
									<button
										type="button"
										onclick={() => askDeleteComment(reply)}
										class="text-[var(--ui-text-dimmed)] hover:text-[var(--ui-text)]"
									>
										Delete
									</button>
								{/if}
							</div>

							{#if children.length}
								<div class="mt-3 space-y-2 border-l border-[var(--ui-border-muted)] pl-3">
									{#each children as child (child.id)}
										{@render subReply(child)}
									{/each}
								</div>
							{/if}

							{#if replyingToCommentId === reply.id}
								<div class="mt-3">
									<ReplyComposer
										parent={reply}
										placeholder={`Reply to ${replyName}…`}
										autofocus
										initialMention={{ pubkey: reply.pubkey, name: replyName }}
										onSubmitted={(reply) => {
											addOptimisticReply(reply);
											replyingToCommentId = '';
										}}
										onCancel={() => (replyingToCommentId = '')}
									/>
								</div>
							{/if}
						</div>
					</div>
				{/each}
				{#if hiddenReplyCount}
					<button
						type="button"
						onclick={() => (showAllReplies = true)}
						class="text-[12.5px] font-bold text-primary-500 transition hover:text-primary-600"
					>
						View {hiddenReplyCount} more {hiddenReplyCount === 1 ? 'comment' : 'comments'}
					</button>
				{:else if showAllReplies && directReplies.length > 2}
					<button
						type="button"
						onclick={() => (showAllReplies = false)}
						class="text-[12.5px] font-bold text-primary-500 transition hover:text-primary-600"
					>
						Show fewer comments
					</button>
				{/if}
			</div>
			<div class="h-2"></div>
		{/if}
		{#if replyOpen && refreshingComments}
			<div
				class="mb-3 flex items-center gap-2 rounded-xl bg-[var(--ui-bg-muted)] px-3 py-2 text-[11px] font-semibold text-[var(--ui-text-muted)]"
			>
				<Icon name="i-lucide-loader-circle" class="size-3.5 animate-spin text-primary-500" />
				Loading comments…
			</div>
		{/if}

		<!-- Reply input -->
		<div class="pt-1 pb-4 {replyOpen ? '' : 'hidden'}">
			<ReplyComposer
				parent={note}
				placeholder="Reply to this note…"
				autofocus={replyOpen}
				focusTick={replyFocusTick}
				onSubmitted={(reply) => {
					addOptimisticReply(reply);
					replyOpen = false;
				}}
				onCancel={() => (replyOpen = false)}
			/>
		</div>
	</div>
	<!-- Like confetti burst overlay -->
	<div class="pointer-events-none absolute inset-0 z-30 overflow-hidden">
		{#each likeBursts as b (b.id)}
			{#each b.particles as p (p.id)}
				<span
					class="like-particle"
					style="left:{b.x}px; top:{b.y}px; --tx:{p.tx}px; --ty:{p.ty}px; --rot:{p.rot}deg; font-size:{p.size}px; animation-duration:{p.duration}s; animation-delay:{p.delay}s"
					>{p.emoji}</span
				>
			{/each}
			<div
				class="absolute grid size-16 place-items-center"
				style="left:calc({b.x}px - 32px); top:calc({b.y}px - 32px)"
			>
				<Icon
					name="i-solar-heart-bold"
					class="like-burst-heart relative size-16 text-[var(--tone-error-text)] drop-shadow-[0_4px_12px_rgba(0,0,0,0.4)]"
				/>
			</div>
		{/each}
	</div>
</article>

<NoteZapDialog
	bind:open={zapOpen}
	recipientPubkey={note.pubkey}
	{lightningAddress}
	eventId={note.id}
	onPaid={handleZapPaid}
/>

{#if zapCommentTarget}
	<NoteZapDialog
		bind:open={zapCommentOpen}
		recipientPubkey={zapCommentTarget.pubkey}
		lightningAddress={zapCommentAddress}
		eventId={zapCommentTarget.id}
		onPaid={handleCommentZapPaid}
		onClose={() => (zapCommentTarget = null)}
	/>
{/if}

<Dialog bind:open={deleteOpen} title={`Delete ${deleteTargetLabel}`}>
	<div class="space-y-4">
		<div
			class="flex size-10 items-center justify-center rounded-full bg-[var(--tone-error-bg)] text-[var(--tone-error-text)]"
		>
			<Icon name="i-lucide-triangle-alert" class="size-5" />
		</div>
		<div class="space-y-1.5">
			<p class="text-[15px] font-bold text-[var(--ui-text)]">
				Delete this {deleteTargetLabel}?
			</p>
			<p class="text-[13px] leading-relaxed text-[var(--ui-text-muted)]">
				This publishes a deletion request to your relays and removes it from your feed. Other
				clients may take time to reflect the change.
			</p>
		</div>
	</div>
	{#snippet footer()}
		<button
			type="button"
			onclick={cancelDelete}
			disabled={deleting}
			class="inline-flex h-9 items-center justify-center rounded-full border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-4 text-[13px] font-bold text-[var(--ui-text)] transition hover:border-primary-500 hover:text-primary-500 disabled:cursor-not-allowed disabled:opacity-60"
		>
			Cancel
		</button>
		<button
			type="button"
			onclick={confirmDelete}
			disabled={deleting || !pendingDelete}
			class="inline-flex h-9 items-center gap-2 rounded-full bg-[var(--tone-error-text)] px-4 text-[13px] font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
		>
			<Icon
				name={deleting ? 'i-lucide-loader-circle' : 'i-lucide-trash-2'}
				class="size-4 {deleting ? 'animate-spin' : ''}"
			/>
			{deleting ? 'Deleting…' : `Delete ${deleteTargetLabel}`}
		</button>
	{/snippet}
</Dialog>

<Dialog bind:open={rawOpen} title="Raw note">
	<div class="space-y-3">
		<div class="flex items-center gap-2">
			<button
				type="button"
				onclick={() => copyText(rawNote, 'Raw note')}
				class="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-3 py-2 text-[12px] font-bold text-white transition hover:bg-primary-600"
			>
				<Icon name="i-lucide-copy" class="size-4" />
				Copy JSON
			</button>
		</div>
		<pre
			class="max-h-[52vh] overflow-auto rounded-xl bg-[var(--ui-bg-muted)] p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-[var(--ui-text-muted)]">{rawNote}</pre>
	</div>
</Dialog>

<svelte:window onkeydown={onMediaViewerKey} />

{#if mediaViewerOpen && selectedViewerMedia}
	<!-- Shared image/video viewer, matching Discover's focused media experience. -->
	<div
		class="animate-fade fixed inset-0 z-[60] flex flex-col bg-black/95 text-white backdrop-blur-sm"
	>
		<header class="flex items-center gap-3 p-3 sm:p-4">
			<div class="min-w-0 flex-1">
				<p class="truncate text-[14px] font-bold">{displayName}</p>
				<p class="text-[11px] text-white/65">{selectedViewerMedia.host}</p>
			</div>
			{#if previewableMedia.length > 1}
				<span class="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold tabular-nums">
					{mediaViewerIndex + 1} / {previewableMedia.length}
				</span>
			{/if}
			<a
				href={selectedViewerMedia.url}
				target="_blank"
				rel="noreferrer"
				class="hidden h-9 items-center rounded-full border border-white/20 px-4 text-[12px] font-bold transition hover:bg-white/10 sm:inline-flex"
			>
				Open source
			</a>
			<button
				type="button"
				onclick={() => (mediaViewerOpen = false)}
				class="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 transition hover:bg-white/20"
				aria-label="Close media viewer"
			>
				<Icon name="i-lucide-x" class="size-5" />
			</button>
		</header>

		<div class="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-3 sm:px-5">
			{#if previewableMedia.length > 1}
				<button
					type="button"
					onclick={previousViewerMedia}
					disabled={mediaViewerIndex === 0}
					class="absolute top-1/2 left-2 z-10 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 backdrop-blur transition hover:bg-white/20 disabled:pointer-events-none disabled:opacity-30 sm:left-5"
					aria-label="Previous media"
				>
					<Icon name="i-lucide-chevron-left" class="size-6" />
				</button>
			{/if}

			{#if selectedViewerMedia.type === 'video'}
				<MediaPlayer
					src={selectedViewerMedia.url}
					label={`Video from ${selectedViewerMedia.host}`}
					fallbackSrcs={selectedViewerMedia.fallbacks}
					class="relative mx-auto w-full max-w-5xl"
					mediaClass="mx-auto max-h-[76vh] max-w-full bg-black object-contain"
					overlayControls
					onMediaElement={(node) => {
						const registration = trackFeedVideo(node as HTMLVideoElement);
						return () => registration.destroy();
					}}
				/>
			{:else}
				<img
					src={selectedViewerMedia.url}
					alt="Note attachment"
					class="mx-auto max-h-[76vh] max-w-full rounded-xl object-contain"
				/>
			{/if}

			{#if previewableMedia.length > 1}
				<button
					type="button"
					onclick={nextViewerMedia}
					disabled={mediaViewerIndex === previewableMedia.length - 1}
					class="absolute top-1/2 right-2 z-10 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 backdrop-blur transition hover:bg-white/20 disabled:pointer-events-none disabled:opacity-30 sm:right-5"
					aria-label="Next media"
				>
					<Icon name="i-lucide-chevron-right" class="size-6" />
				</button>
			{/if}
		</div>

		<a
			href={selectedViewerMedia.url}
			target="_blank"
			rel="noreferrer"
			class="mx-auto mb-4 inline-flex h-9 items-center rounded-full border border-white/20 px-4 text-[12px] font-bold sm:hidden"
		>
			Open source
		</a>
	</div>
{/if}

<ReportDialog
	bind:open={reportOpen}
	pubkey={note.pubkey}
	noteId={note.id}
	targetLabel={`Note by ${displayName} · ${timeAgo(note.createdAt)}`}
/>

<style>
	.video-cover {
		background: linear-gradient(
			155deg,
			color-mix(in oklab, var(--ui-color-primary-500) 72%, transparent),
			var(--ui-color-primary-500)
		);
		opacity: var(--video-cover-opacity, 0.52);
		transition: opacity 180ms ease;
	}
</style>
