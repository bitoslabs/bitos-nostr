/**
 * Feed store — subscribes to NIP-01 kind-1 text notes (a global timeline),
 * aggregates reactions (kind 7), and publishes new notes. Reactions and reposts
 * are folded into each note so the UI can render counts. Notes are kept
 * newest-first and capped to a sane window.
 */
import { browser } from '$app/environment';
import type { UnsignedEvent } from 'nostr-tools/pure';
import { signMined } from '$lib/auth/signer';
import { subscribe, publish, queryPrimaryFirst } from './pool';
import { identity } from './identity.svelte';
import { profiles } from './profiles.svelte';
import { blocks } from '$lib/stores/blocks.svelte';
import { mutes } from '$lib/stores/mutes.svelte';
import {
	NOSTR_KINDS,
	MAX_POLL_VOTERS,
	repostTarget,
	repostTags,
	addressKey,
	type FeedNote,
	type PollVoter,
	parsePoll,
	pollClosedAt
} from './types';
import { toFeedNote } from './feed-note';
import { buildKind22, validateBitzMedia } from './bitz-codec';
import { applyActivityToNotes, zapSats, zapTarget } from './zaps';
import { extractMentionEntities } from '$lib/utils/nip27';
import type { UploadedMedia } from '$lib/media/uploaders';
import { stageEvent, recordFailure as outboxFailure } from '$lib/stores/event-outbox';
import {
	bitzSession,
	optimisticReelFromEvent,
	reconcileOptimisticReel
} from '$lib/stores/bitz-session.svelte';
import { relays } from './relays.svelte';
import { clientTag } from './client-tag';
import { extractHashtagTags } from '$lib/utils/note-content';
import { defaultBitzTags } from '$lib/utils/bitz-links';
import { minePowAsync, eventPow, type PowProgress } from './pow';

export type { PowProgress } from './pow';

const INITIAL_LIMIT = 150;
const PAGE_LIMIT = 80;
const MAX_NOTES = 1000;
const MAX_PENDING_NOTES = 100;
const MAX_TEXT_NOTE_CHARS = 16_000;
const FEED_POST_KINDS = [
	NOSTR_KINDS.TEXT_NOTE,
	NOSTR_KINDS.POLL,
	NOSTR_KINDS.PICTURE,
	NOSTR_KINDS.VIDEO,
	NOSTR_KINDS.SHORT_VIDEO,
	NOSTR_KINDS.ADDRESSABLE_VIDEO,
	NOSTR_KINDS.ADDRESSABLE_SHORT_VIDEO
];
const MAX_BUFFERED_REACTIONS = 2_000;

type PostMediaAttachment = Pick<UploadedMedia, 'url' | 'kind' | 'mimeType' | 'bytes' | 'sha256'>;

type ReactionEvent = {
	id: string;
	pubkey: string;
	content: string;
	tags: string[][];
	created_at: number;
};

function isReaction(content: string): boolean {
	// kind 7 reactions are either a + / - or an emoji shortcode
	return content === '+' || content === '-' || /\p{Extended_Pictographic}/u.test(content);
}

/** A kind-1 note that replies to a story (kind 30315) — kept out of the global feed. */
function isStoryReply(ev: { tags: string[][] }): boolean {
	const hasStoryA = ev.tags.some(
		(t) =>
			t[0] === 'a' && typeof t[1] === 'string' && t[1].startsWith(`${NOSTR_KINDS.STORY_STATUS}:`)
	);
	if (!hasStoryA) return false;
	return ev.tags.some((t) => t[0] === 'e');
}

export function visibleInsertIndex(
	notes: Pick<FeedNote, 'createdAt'>[],
	note: Pick<FeedNote, 'createdAt'>,
	options: { preferNewestOnEqual?: boolean } = {}
) {
	let idx = 0;
	const preferNewestOnEqual = options.preferNewestOnEqual ?? false;
	while (
		idx < notes.length &&
		(preferNewestOnEqual
			? notes[idx].createdAt > note.createdAt
			: notes[idx].createdAt >= note.createdAt)
	) {
		idx++;
	}
	return idx;
}

class FeedStore {
	notes = $state<FeedNote[]>([]);
	pendingNotes = $state<FeedNote[]>([]);
	loading = $state(false);
	loadingMore = $state(false);
	hasMore = $state(true);
	connected = $state(false);
	/** Map note.id → index for O(1) updates when reactions arrive. */
	private byId = new Map<string, number>();
	private pendingById = new Map<string, number>();
	/** Addressable (34235/34236) `kind:pubkey:d` → visible-note index, so a
	 * metadata/URL update event REPLACES its older version in place instead of
	 * appearing as a duplicate reel (ADR-002 addressable semantics). */
	private byAddress = new Map<string, number>();
	private seenZapIds = new Set<string>();
	/** pollNoteId → (pubkey → latest vote) for one-vote-per-user aggregation. */
	private pollVotes = new Map<
		string,
		Map<string, { optionId: string; evId: string; at: number }>
	>();
	/** Reactions can arrive before the note they target during relay replay. */
	private bufferedReactions = new Map<string, ReactionEvent[]>();
	private unsub: (() => void) | null = null;

	pendingCount = $derived(this.pendingNotes.length);

	/** Begin (or restart) the live subscription. */
	start = () => {
		if (!browser) return;
		this.stop();
		this.loading = true;
		this.loadingMore = false;
		this.hasMore = true;
		this.connected = false;
		this.pendingNotes = [];
		this.pendingById.clear();
		this.seenZapIds.clear();
		this.bufferedReactions.clear();
		this.unsub = subscribe(
			[
				{
					kinds: [
						...FEED_POST_KINDS,
						NOSTR_KINDS.REACTION,
						NOSTR_KINDS.POLL_RESPONSE,
						NOSTR_KINDS.REPOST,
						NOSTR_KINDS.GENERIC_REPOST,
						NOSTR_KINDS.ZAP
					],
					limit: INITIAL_LIMIT
				}
			],
			{
				oneose: () => {
					this.loading = false;
					this.connected = true;
					void this.hydrateActivity(this.notes.map((note) => note.id));
				},
				onevent: (ev) => {
					if (FEED_POST_KINDS.includes(ev.kind as (typeof FEED_POST_KINDS)[number]))
						this.ingestNote(ev, { queueIfLive: this.connected });
					else if (ev.kind === NOSTR_KINDS.POLL_RESPONSE) this.ingestPollResponse(ev);
					else if (ev.kind === NOSTR_KINDS.REPOST || ev.kind === NOSTR_KINDS.GENERIC_REPOST) {
						const target = repostTarget(ev).eventId;
						if (target) void this.hydrateActivity([target]);
					} else if (ev.kind === NOSTR_KINDS.REACTION) this.ingestReaction(ev);
					else if (ev.kind === NOSTR_KINDS.ZAP) this.ingestZap(ev);
					// opportunistically load the author's profile
					profiles.ensure([ev.pubkey]);
				}
			}
		);
	};

	stop = () => {
		if (this.unsub) {
			this.unsub();
			this.unsub = null;
		}
	};

	clear = () => {
		this.notes = [];
		this.pendingNotes = [];
		this.loading = false;
		this.loadingMore = false;
		this.hasMore = true;
		this.connected = false;
		this.byId.clear();
		this.byAddress.clear();
		this.pendingById.clear();
		this.seenZapIds.clear();
		this.pollVotes.clear();
		this.bufferedReactions.clear();
	};

	/** Query the next older page without changing the live "new notes" queue. */
	async loadMore() {
		if (!browser || this.loadingMore || !this.hasMore) return 0;
		const oldest = this.notes.at(-1);
		if (!oldest) return 0;

		this.loadingMore = true;
		try {
			const applyPageEvents = (events: Awaited<ReturnType<typeof queryPrimaryFirst>>) => {
				const before = this.notes.length;
				const fetchedIds = events.map((ev) => ev.id);
				for (const ev of events.sort((a, b) => b.created_at - a.created_at)) {
					this.ingestNote(ev, { queueIfLive: false });
					profiles.ensure([ev.pubkey]);
				}
				if (fetchedIds.length) void this.hydrateActivity(fetchedIds);
				return this.notes.length - before;
			};
			const events = await queryPrimaryFirst(
				[
					{
						kinds: FEED_POST_KINDS,
						limit: PAGE_LIMIT,
						until: oldest.createdAt - 1
					}
				],
				{
					onSecondary: (mergedEvents) => {
						applyPageEvents(mergedEvents);
					}
				}
			);
			const added = applyPageEvents(events);
			if (!events.length || added === 0 || this.notes.length >= MAX_NOTES) this.hasMore = false;
			return added;
		} finally {
			this.loadingMore = false;
		}
	}

	private ingestNote(
		ev: {
			id: string;
			pubkey: string;
			content: string;
			created_at: number;
			tags: string[][];
		},
		options: { queueIfLive?: boolean; preferNewestOnEqual?: boolean } = {}
	) {
		if (blocks.has(ev.pubkey) || mutes.has(ev.pubkey)) return;
		if (isStoryReply(ev)) return;
		if (this.byId.has(ev.id) || this.pendingById.has(ev.id)) return;
		// Addressable (34235/34236) update semantics (ADR-002 / F-016): a newer
		// event with the SAME `kind:pubkey:d` coordinate supersedes the stored
		// version in place — same slot, fresh content/'raw'. Older or same-second
		// updates are dropped (relays replay out of order).
		const address =
			'kind' in ev ? addressKey((ev as { kind: number }).kind, ev.pubkey, ev.tags) : '';
		if (address) {
			const existingIdx = this.byAddress.get(address);
			if (existingIdx !== undefined) {
				const current = this.notes[existingIdx];
				const newer =
					ev.created_at > current.createdAt ||
					(ev.created_at === current.createdAt && ev.id !== current.id);
				if (newer && !this.byId.has(ev.id)) {
					const updated: FeedNote = {
						...current,
						id: ev.id,
						content: ev.content,
						createdAt: ev.created_at,
						pow: eventPow(ev),
						tags: ev.tags,
						raw: 'sig' in ev ? (ev as FeedNote['raw']) : undefined
					};
					this.notes = this.notes.map((n, i) => (i === existingIdx ? updated : n));
					this.rebuildIndex();
				}
				return;
			}
		}
		const replyTag = ev.tags.find((t) => t[0] === 'e' && t[3] === 'reply');
		const pollOptions = parsePoll(ev.tags);
		const note: FeedNote = {
			id: ev.id,
			pubkey: ev.pubkey,
			content: ev.content,
			createdAt: ev.created_at,
			pow: eventPow(ev),
			tags: ev.tags,
			raw: 'sig' in ev ? (ev as FeedNote['raw']) : undefined,
			replyTo: replyTag?.[1],
			reactions: [],
			repostCount: 0,
			zapCount: 0,
			zapTotalSats: 0,
			poll: pollOptions
				? {
						options: pollOptions,
						votes: {},
						totalVotes: 0,
						closedAt: pollClosedAt(ev.tags)
					}
				: undefined
		};
		if (options.queueIfLive && this.notes.length > 0 && note.createdAt >= this.notes[0].createdAt) {
			this.insertPending(note);
		} else {
			this.insertVisible(note, { preferNewestOnEqual: options.preferNewestOnEqual });
		}
		// Relay replay is not ordered: process reactions received before this note.
		const buffered = this.bufferedReactions.get(note.id);
		if (buffered) {
			this.bufferedReactions.delete(note.id);
			for (const reaction of buffered) this.ingestReaction(reaction);
		}
		// If votes were already collected for this poll, apply their tally now.
		if (note.poll) this.rebuildPoll(note.id);
	}

	private insertVisible(note: FeedNote, options: { preferNewestOnEqual?: boolean } = {}) {
		// Insert newest-first. For optimistic local posts, equal-second timestamps
		// should still place the freshly posted note ahead of existing entries.
		const idx = visibleInsertIndex(this.notes, note, options);
		this.notes = [...this.notes.slice(0, idx), note, ...this.notes.slice(idx)];
		// rebuild index map (offset by one)
		this.rebuildIndex();
		if (this.notes.length > MAX_NOTES) {
			this.notes = this.notes.slice(0, MAX_NOTES);
			this.rebuildIndex();
		}
	}

	private insertPending(note: FeedNote) {
		let idx = 0;
		while (idx < this.pendingNotes.length && this.pendingNotes[idx].createdAt >= note.createdAt)
			idx++;
		this.pendingNotes = [...this.pendingNotes.slice(0, idx), note, ...this.pendingNotes.slice(idx)];
		// Keep the new-notes banner useful and bounded if the tab stays open for
		// a long time without the user revealing incoming notes.
		if (this.pendingNotes.length > MAX_PENDING_NOTES) {
			this.pendingNotes = this.pendingNotes.slice(0, MAX_PENDING_NOTES);
		}
		this.rebuildPendingIndex();
	}

	private ingestReaction(ev: ReactionEvent) {
		// NIP-25: reaction tags the target note/event with `e` (and usually `p`).
		const target = ev.tags.find((t) => t[0] === 'e')?.[1];
		if (!target) return;

		const targetNote = this.noteById(target);
		if (!targetNote) {
			this.bufferReaction(target, ev);
			return;
		}

		// Poll vote? A kind 7 reaction whose content is one of the poll's option ids.
		if (targetNote?.poll && targetNote.poll.options.some((o) => o.id === ev.content)) {
			this.applyPollVote(target, ev);
			return;
		}

		const idx = this.byId.get(target);
		if (idx === undefined) {
			const pendingIdx = this.pendingById.get(target);
			if (pendingIdx === undefined) return;
			const pending = this.pendingNotes[pendingIdx];
			const next = this.nextReactions(pending, ev);
			if (!next) return;
			this.pendingNotes = this.pendingNotes.map((n, i) =>
				i === pendingIdx ? { ...n, reactions: next } : n
			);
			return;
		}
		const note = this.notes[idx];
		const next = this.nextReactions(note, ev);
		if (!next) return;
		this.notes = this.notes.map((n, i) => (i === idx ? { ...n, reactions: next } : n));
	}

	private ingestPollResponse(ev: ReactionEvent) {
		const target = ev.tags.find((t) => t[0] === 'e')?.[1];
		const optionId = ev.tags.find((t) => t[0] === 'response')?.[1];
		if (!target || !optionId) return;
		const note = this.noteById(target);
		if (note?.poll?.options.some((o) => o.id === optionId))
			this.applyPollVote(target, { ...ev, content: optionId });
	}

	private bufferReaction(target: string, ev: ReactionEvent) {
		if (
			this.bufferedReactions.size >= MAX_BUFFERED_REACTIONS &&
			!this.bufferedReactions.has(target)
		) {
			this.bufferedReactions.delete(this.bufferedReactions.keys().next().value!);
		}
		const buffered = this.bufferedReactions.get(target) ?? [];
		if (!buffered.some((reaction) => reaction.id === ev.id)) buffered.push(ev);
		this.bufferedReactions.set(target, buffered);
	}

	private ingestZap(ev: { id: string; content: string; tags: string[][] }) {
		if (this.seenZapIds.has(ev.id)) return;
		const target = zapTarget(ev);
		if (!target) return;
		const idx = this.byId.get(target);
		const pendingIdx = this.pendingById.get(target);
		if (idx === undefined && pendingIdx === undefined) return;
		const sats = zapSats(ev);
		this.seenZapIds.add(ev.id);
		if (idx !== undefined) {
			this.notes = this.notes.map((note, i) =>
				i === idx
					? {
							...note,
							zapCount: note.zapCount + 1,
							zapTotalSats: note.zapTotalSats + sats
						}
					: note
			);
		}
		if (pendingIdx !== undefined) {
			this.pendingNotes = this.pendingNotes.map((note, i) =>
				i === pendingIdx
					? {
							...note,
							zapCount: note.zapCount + 1,
							zapTotalSats: note.zapTotalSats + sats
						}
					: note
			);
		}
	}

	/** Look up a note in either the visible or pending list. */
	private noteById(id: string): FeedNote | undefined {
		const idx = this.byId.get(id);
		if (idx !== undefined) return this.notes[idx];
		const pendingIdx = this.pendingById.get(id);
		if (pendingIdx !== undefined) return this.pendingNotes[pendingIdx];
		return undefined;
	}

	/** Read the current optimistic note state after a local interaction. */
	getNote(id: string): FeedNote | undefined {
		return this.noteById(id);
	}

	/** Apply a note update to whichever list holds it (visible + pending). */
	private updateNote(id: string, updater: (n: FeedNote) => FeedNote) {
		const idx = this.byId.get(id);
		if (idx !== undefined) {
			this.notes = this.notes.map((n, i) => (i === idx ? updater(n) : n));
		}
		const pendingIdx = this.pendingById.get(id);
		if (pendingIdx !== undefined) {
			this.pendingNotes = this.pendingNotes.map((n, i) => (i === pendingIdx ? updater(n) : n));
		}
	}

	/** Record a poll vote (one per pubkey, latest wins) and recompute counts. */
	private applyPollVote(
		pollId: string,
		ev: { id: string; pubkey: string; content: string; created_at: number }
	) {
		if (!this.pollVotes.has(pollId))
			this.pollVotes.set(pollId, new Map<string, { optionId: string; evId: string; at: number }>());
		const byPubkey = this.pollVotes.get(pollId)!;
		const prev = byPubkey.get(ev.pubkey);
		if (prev && prev.at > ev.created_at) return; // keep the latest vote
		byPubkey.set(ev.pubkey, { optionId: ev.content, evId: ev.id, at: ev.created_at });
		this.rebuildPoll(pollId);
	}

	/** Recompute a poll's vote tally from the per-pubkey vote map. */
	private rebuildPoll(pollId: string) {
		const note = this.noteById(pollId);
		if (!note?.poll) return;
		const byPubkey =
			this.pollVotes.get(pollId) ?? new Map<string, { optionId: string; at?: number }>();
		const votes: Record<string, number> = {};
		let total = 0;
		const me = identity.current?.pk?.toLowerCase();
		let myVote: string | undefined;
		const voters: PollVoter[] = [];
		for (const [pubkey, v] of byPubkey) {
			votes[v.optionId] = (votes[v.optionId] ?? 0) + 1;
			total += 1;
			if (pubkey === me) myVote = v.optionId;
			voters.push({ pubkey, optionId: v.optionId, at: v.at ?? note.createdAt });
		}
		voters.sort((a, b) => b.at - a.at);
		this.updateNote(pollId, (n) =>
			n.poll
				? {
						...n,
						poll: {
							...n.poll,
							votes,
							totalVotes: total,
							myVote,
							voters: voters.slice(0, MAX_POLL_VOTERS)
						}
					}
				: n
		);
	}

	private nextReactions(
		note: FeedNote,
		ev: {
			id: string;
			pubkey: string;
			content: string;
		}
	) {
		if (ev.content === '-') return; // dislike — ignore for the count
		const me = identity.current?.pk;
		const emoji = isReaction(ev.content) ? ev.content || '❤️' : '❤️';
		const byMe = ev.pubkey === me;
		const next = note.reactions.map((r) => ({ ...r }));
		const existing = next.find((r) => r.emoji === emoji);
		if (existing) {
			if (byMe && existing.byMe) {
				existing.myEventId = ev.id;
				return next;
			}
			existing.count += 1;
			if (byMe) {
				existing.byMe = true;
				existing.myEventId = ev.id;
			}
		} else {
			next.push({ emoji, count: 1, byMe, myEventId: byMe ? ev.id : undefined });
		}
		return next;
	}

	private removeMyReaction(noteId: string, emoji: string) {
		const idx = this.byId.get(noteId);
		if (idx === undefined) return;
		const note = this.notes[idx];
		const reactions = note.reactions
			.map((reaction) => {
				if (reaction.emoji !== emoji || !reaction.byMe) return reaction;
				return {
					...reaction,
					count: Math.max(0, reaction.count - 1),
					byMe: false,
					myEventId: undefined
				};
			})
			.filter((reaction) => reaction.count > 0);
		this.notes = this.notes.map((n, i) => (i === idx ? { ...n, reactions } : n));
	}

	private rebuildIndex() {
		this.byId.clear();
		this.byAddress.clear();
		this.notes.forEach((n, i) => {
			this.byId.set(n.id, i);
			const address = addressKey(n.raw?.kind ?? 0, n.pubkey, n.tags);
			if (address) this.byAddress.set(address, i);
		});
	}

	private rebuildPendingIndex() {
		this.pendingById.clear();
		this.pendingNotes.forEach((n, i) => this.pendingById.set(n.id, i));
	}

	private async hydrateActivity(noteIds: string[]) {
		const uniqueIds = [...new Set(noteIds)].filter(Boolean);
		if (!uniqueIds.length) return;
		try {
			const applyActivity = (activity: Awaited<ReturnType<typeof queryPrimaryFirst>>) => {
				if (!activity.length) return;
				const notesById = new Map(
					[...this.notes, ...this.pendingNotes].map((note) => [note.id, note])
				);
				const nonPollActivity = activity.filter((event) => {
					if (event.kind === NOSTR_KINDS.POLL_RESPONSE) {
						const target = event.tags.find((tag) => tag[0] === 'e' && tag[1])?.[1];
						const optionId = event.tags.find((tag) => tag[0] === 'response' && tag[1])?.[1];
						const poll = target ? notesById.get(target)?.poll : undefined;
						if (target && optionId && poll?.options.some((option) => option.id === optionId)) {
							this.applyPollVote(target, { ...event, content: optionId });
							return false;
						}
						return false;
					}
					if (event.kind !== NOSTR_KINDS.REACTION) return true;
					const target = event.tags.find((tag) => tag[0] === 'e' && tag[1])?.[1];
					const poll = target ? notesById.get(target)?.poll : undefined;
					if (!poll?.options.some((option) => option.id === event.content)) return true;
					this.applyPollVote(target!, event);
					return false;
				});
				const visible = this.notes.filter((note) => uniqueIds.includes(note.id));
				if (visible.length) {
					const hydrated = applyActivityToNotes(visible, nonPollActivity, identity.current?.pk);
					const byId = new Map(hydrated.map((note) => [note.id, note]));
					this.notes = this.notes.map((note) => byId.get(note.id) ?? note);
				}
				const pending = this.pendingNotes.filter((note) => uniqueIds.includes(note.id));
				if (pending.length) {
					const hydrated = applyActivityToNotes(pending, nonPollActivity, identity.current?.pk);
					const byId = new Map(hydrated.map((note) => [note.id, note]));
					this.pendingNotes = this.pendingNotes.map((note) => byId.get(note.id) ?? note);
				}
			};
			const activity = await queryPrimaryFirst(
				[
					{
						kinds: [
							NOSTR_KINDS.REACTION,
							NOSTR_KINDS.POLL_RESPONSE,
							NOSTR_KINDS.REPOST,
							NOSTR_KINDS.GENERIC_REPOST,
							NOSTR_KINDS.ZAP
						],
						'#e': uniqueIds,
						limit: 1000
					}
				],
				{
					onSecondary: (mergedActivity) => {
						applyActivity(mergedActivity);
					}
				}
			);
			applyActivity(activity);
		} catch {
			// Activity hydration is best-effort; leave notes visible even if relays do not answer.
		}
	}

	hideNote(id: string) {
		this.notes = this.notes.filter((note) => note.id !== id);
		this.pendingNotes = this.pendingNotes.filter((note) => note.id !== id);
		this.rebuildIndex();
		this.rebuildPendingIndex();
	}

	muteAuthor(pubkey: string) {
		this.notes = this.notes.filter((note) => note.pubkey !== pubkey);
		this.pendingNotes = this.pendingNotes.filter((note) => note.pubkey !== pubkey);
		this.rebuildIndex();
		this.rebuildPendingIndex();
	}

	blockAuthor(pubkey: string) {
		if (!blocks.block(pubkey)) return false;
		this.muteAuthor(pubkey);
		return true;
	}

	upsertNote(note: FeedNote) {
		const existing = this.byId.get(note.id);
		if (existing !== undefined) {
			this.notes = this.notes.map((item, index) =>
				index === existing ? { ...item, ...note } : item
			);
			this.rebuildIndex();
			return;
		}
		// Addressable update path (F-016): hydrating a newer 34235/34236 version
		// (e.g. bitz page building reels from a fresh relay query) replaces the
		// stored version in its slot; a same/stale version is ignored.
		const address = addressKey(note.raw?.kind ?? 0, note.pubkey, note.tags);
		if (address) {
			const existingIdx = this.byAddress.get(address);
			if (existingIdx !== undefined) {
				const current = this.notes[existingIdx];
				if (note.createdAt > current.createdAt) {
					this.notes = this.notes.map((item, index) => (index === existingIdx ? note : item));
					this.rebuildIndex();
				}
				return;
			}
		}
		const pending = this.pendingById.get(note.id);
		if (pending !== undefined) {
			this.pendingNotes = this.pendingNotes.map((item, index) =>
				index === pending ? { ...item, ...note } : item
			);
			this.rebuildPendingIndex();
			return;
		}
		this.insertVisible(note);
	}

	/** Reload a note's threaded replies and their reactions from the relays. */
	async refreshReplies(noteId: string) {
		if (!browser) return;
		const replyEvents = await queryPrimaryFirst([
			{ kinds: [NOSTR_KINDS.TEXT_NOTE], '#e': [noteId], limit: 300 }
		]);
		const replies = replyEvents
			.map(toFeedNote)
			.filter(
				(reply) =>
					reply.replyTo === noteId ||
					reply.tags.some((tag) => tag[0] === 'e' && tag[1] === noteId && tag[3] === 'root')
			);
		const replyIds = replies.map((reply) => reply.id);
		const reactions = replyIds.length
			? await queryPrimaryFirst([
					{ kinds: [NOSTR_KINDS.REACTION, NOSTR_KINDS.POLL_RESPONSE], '#e': replyIds, limit: 1000 }
				])
			: [];
		const hydrated = applyActivityToNotes(replies, reactions, identity.current?.pk);
		for (const reply of hydrated) this.upsertNote(reply);
		profiles.ensure(hydrated.map((reply) => reply.pubkey));
		return hydrated.length;
	}

	async deleteNote(note: FeedNote) {
		if (!browser) return;
		const id = identity.current;
		if (!id) throw new Error('No identity');
		if (id.pk !== note.pubkey) throw new Error('You can only delete your own notes');
		const event = await signMined({
			kind: NOSTR_KINDS.DELETE,
			content: 'Deleted from BitOS',
			created_at: Math.floor(Date.now() / 1000),
			tags: [['e', note.id]]
		});
		await publish(event);
		this.hideNote(note.id);
	}

	/** Move live subscription notes into the visible feed, newest-first. */
	revealPending() {
		if (!this.pendingNotes.length) return 0;
		const count = this.pendingNotes.length;
		const merged = [...this.pendingNotes, ...this.notes];
		const seen: Record<string, true> = {};
		this.notes = merged
			.filter((note) => {
				if (seen[note.id]) return false;
				seen[note.id] = true;
				return true;
			})
			.sort((a, b) => b.createdAt - a.createdAt)
			.slice(0, MAX_NOTES);
		this.pendingNotes = [];
		this.pendingById.clear();
		this.rebuildIndex();
		return count;
	}

	/** Compose + sign + publish a text note. Returns the published event id. */
	async post(
		content: string,
		options: {
			sensitive?: boolean;
			attachments?: PostMediaAttachment[];
			pow?: number;
			/** Live stats while the NIP-13 worker mines. */
			onPowProgress?: (progress: PowProgress) => void;
			/** Coarse phase updates for button / status labels. */
			onPhase?: (phase: 'mining' | 'publishing') => void;
			/** Aborts mining (worker is terminated, nothing is published). */
			signal?: AbortSignal;
		} = {}
	): Promise<string> {
		if (!browser) throw new Error('browser only');
		const id = identity.current;
		if (!id) throw new Error('No identity — create or import a key first');
		const text = content.trim();
		const attachments = (options.attachments ?? []).filter((attachment) => attachment?.url);
		const attachmentLines = attachments.map((attachment) => attachment.url.trim()).filter(Boolean);
		const body = [text, attachmentLines.join('\n')].filter(Boolean).join('\n\n').trim();
		const tags: string[][] = [...clientTag(), ...extractHashtagTags(body)];
		if (options.sensitive) tags.push(['content-warning', 'Sensitive content']);
		// NIP-31 alt (screen readers read this instead of the picture/video).
		const alt = text.trim().slice(0, 200);
		if (alt) tags.push(['alt', alt]);
		for (const attachment of attachments) {
			if (attachment.kind === 'image' || attachment.kind === 'video') {
				const imeta = [`url ${attachment.url}`];
				if (attachment.mimeType) imeta.push(`m ${attachment.mimeType}`);
				if (attachment.bytes > 0) imeta.push(`size ${attachment.bytes}`);
				if (attachment.sha256) imeta.push(`x ${attachment.sha256}`);
				tags.push(['imeta', ...imeta]);
			}
		}
		// NIP-27: back every inline `nostr:` mention with matching p / e tags so
		// the referenced profiles / notes are notified.
		const { pubkeys, noteIds } = extractMentionEntities(body);
		for (const pubkey of pubkeys) tags.push(['p', pubkey]);
		for (const eventId of noteIds) tags.push(['e', eventId]);
		if (!body) throw new Error('Nothing to post');
		if (body.length > MAX_TEXT_NOTE_CHARS) {
			throw new Error(
				`Normal notes are limited to ${MAX_TEXT_NOTE_CHARS.toLocaleString()} characters`
			);
		}
		const unsigned = {
			pubkey: id.pk,
			kind: NOSTR_KINDS.TEXT_NOTE,
			content: body,
			created_at: Math.floor(Date.now() / 1000),
			tags
		};
		// NIP-13 mining is opt-in so ordinary posts remain immediate.
		if (options.pow && options.pow > 0) options.onPhase?.('mining');
		const mined =
			options.pow && options.pow > 0
				? await minePowAsync(unsigned, options.pow, {
						onProgress: options.onPowProgress,
						signal: options.signal
					})
				: unsigned;
		const event = await signMined(mined);
		options.onPhase?.('publishing');
		await publish(event);
		// show immediately (the subscription will also re-deliver it, dedup by id)
		this.ingestNote(event, { queueIfLive: false, preferNewestOnEqual: true });
		return event.id;
	}

	/**
	 * Publish a short-form media bitz for the Bitz feed.
	 *
	 * Pictures go out as NIP-68 kind 20; videos as NIP-71 kind 22 when portrait
	 * (the Bitz/reels shape) or kind 21 when landscape. The media rides in a
	 * NIP-92 `imeta` tag (url / mime / size / dimensions) so every Nostr
	 * short-video client renders it — the content stays a clean caption.
	 */
	async postBitz(
		media: PostMediaAttachment,
		options: {
			caption?: string;
			sensitive?: boolean;
			/** Portrait videos publish as kind 22 (short-form), landscape as 21. */
			portrait?: boolean;
			/** Natural media dimensions `WxH` for the imeta tag. */
			dim?: string;
			/** Optional poster/cover frame URL added to the imeta (`thumb`). */
			thumb?: string;
			/** Duration in seconds for the imeta `duration` segment (§6.4 checked). */
			duration?: number;
			/** Average bitrate in bits/second for the imeta `bitrate` segment. */
			bitrate?: number;
			/** Accessibility text (NIP-31) — defaults to the caption's first 200
			 *  chars so screen readers and picky clients always find an alt. */
			alt?: string;
			pow?: number;
			/** Live stats while the NIP-13 worker mines. */
			onPowProgress?: (progress: PowProgress) => void;
			/** Coarse phase updates for button / status labels. */
			onPhase?: (phase: 'mining' | 'publishing') => void;
			/** Aborts mining (worker is terminated, nothing is published). */
			signal?: AbortSignal;
			/** Extra event tags appended after the defaults — e.g. remix lineage
			 *  ("remix"/"meme" tags) so remixed memes credit the source event. */
			extraTags?: string[][];
		} = {}
	): Promise<string> {
		if (!browser) throw new Error('browser only');
		const id = identity.current;
		if (!id) throw new Error('No identity — create or import a key first');
		const url = media.url?.trim();
		if (!url) throw new Error('Upload the media first');
		const caption = (options.caption ?? '').trim();
		if (caption.length > MAX_TEXT_NOTE_CHARS) {
			throw new Error(`Captions are limited to ${MAX_TEXT_NOTE_CHARS.toLocaleString()} characters`);
		}
		const kind =
			media.kind === 'image'
				? NOSTR_KINDS.PICTURE
				: options.portrait === false
					? NOSTR_KINDS.VIDEO
					: NOSTR_KINDS.SHORT_VIDEO;
		// NIP-71 encoding lives in BitzEventCodec (ADR-002: isolate the draft
		// NIP). Images share the same imeta-first shape; video events embed the
		// primary URL in content for legacy-client compatibility.
		// #bitz community tag (PUB-014): user hashtags stay authoritative —
		// defaultBitzTags only fills in `t bitz` when the caption tagged nothing.
		const prefixTags: string[][] = [
			...defaultBitzTags(extractHashtagTags(caption)),
			...clientTag(),
			...(options.extraTags ?? [])
		];
		// NIP-31 alt: screen readers and preview-deprived clients read this
		// instead of the burned-in caption. Never empty when a caption exists.
		const alt = (options.alt ?? caption).trim().slice(0, 200);
		if (alt) prefixTags.push(['alt', alt]);
		let unsignedBody: {
			pubkey: string;
			kind: number;
			content: string;
			created_at: number;
			tags: string[][];
		};
		if (kind === NOSTR_KINDS.PICTURE) {
			const imeta = [`url ${url}`];
			if (media.mimeType) imeta.push(`m ${media.mimeType}`);
			if (media.bytes > 0) imeta.push(`size ${media.bytes}`);
			if (options.dim) imeta.push(`dim ${options.dim}`);
			if (options.thumb) imeta.push(`thumb ${options.thumb}`);
			const tags = [...prefixTags, ['imeta', ...imeta]];
			if (options.sensitive) tags.push(['content-warning', 'Sensitive content']);
			unsignedBody = {
				pubkey: id.pk,
				kind,
				content: caption,
				created_at: Math.floor(Date.now() / 1000),
				tags
			};
		} else {
			// Plan §6.4 "validation before signing": malformed optional metadata
			// must never reach a signed kind 22. HTTPS is enforced only in
			// production builds where media URLs come from configured CDNs.
			const issues = validateBitzMedia(
				{
					url,
					hash: media.sha256,
					dim: options.dim,
					duration: options.duration
				},
				{ httpsOnly: import.meta.env.PROD }
			);
			if (issues.length) {
				throw new Error(
					`Media failed validation: ${issues.map((i) => `${i.field}: ${i.reason}`).join('; ')}`
				);
			}
			unsignedBody = buildKind22({
				pubkey: id.pk,
				caption,
				media: {
					url,
					mimeType: media.mimeType,
					bytes: media.bytes,
					dim: options.dim,
					thumb: options.thumb,
					hash: media.sha256,
					duration: options.duration,
					bitrate: options.bitrate
				},
				sensitive: options.sensitive,
				// Kinds 21/34235/34236 share the kind-22 event shape; only the
				// kind number differs.
				created_at: Math.floor(Date.now() / 1000)
			});
			unsignedBody.tags = [...prefixTags, ...unsignedBody.tags];
			unsignedBody.kind = kind;
		}
		// NIP-27: back every inline `nostr:` mention with matching p / e tags so
		// the referenced profiles / notes are notified.
		const { pubkeys, noteIds } = extractMentionEntities(caption);
		for (const pubkey of pubkeys) unsignedBody.tags.push(['p', pubkey]);
		for (const eventId of noteIds) unsignedBody.tags.push(['e', eventId]);
		const unsigned = unsignedBody;
		if (options.pow && options.pow > 0) options.onPhase?.('mining');
		const mined =
			options.pow && options.pow > 0
				? await minePowAsync(unsigned, options.pow, {
						onProgress: options.onPowProgress,
						signal: options.signal
					})
				: unsigned;
		const event = await signMined(mined);
		options.onPhase?.('publishing');
		// PUB-012 §12.2: the signed event enters the local outbox before the
		// first relay write, and stays until the durability threshold is met
		// (ACKs are recorded by the pool observer wired in the layout). Retries
		// resend this exact object — it is never rebuilt or re-signed.
		stageEvent(event);
		try {
			await publish(event);
		} catch (e) {
			for (const url of relays.orderedWriteUrls) outboxFailure(event.id, url, (e as Error).message);
			throw e;
		}
		// Media kinds are feed post kinds too, so the bitz shows immediately in
		// the home timeline; the Bitz route picks it up from relays on next load.
		this.ingestNote(event, { queueIfLive: false, preferNewestOnEqual: true });
		// PUB-013: also stage the optimistic reel so the Bitz player (and the
		// #bitz=<id> deep link) renders instantly; the relay echo reconciles
		// into the same id — idempotent by event id, never a duplicate.
		this.stageOptimisticReel(event);
		return event.id;
	}

	/** Place a just-published bitz event into the Bitz session optimistically
	 *  (PUB-013 §21.4). Reconciliation with the relay echo happens where reels
	 *  live: the route merges by event id / addressable coordinate. */
	stageOptimisticReel(event: NonNullable<FeedNote['raw']>) {
		const reel = optimisticReelFromEvent(event);
		if (!reel) return;
		const { reels } = reconcileOptimisticReel(bitzSession.reels, reel);
		bitzSession.reels = reels;
	}

	/** Publish a NIP-18 repost (kind 6) of the original signed event. */
	async repost(note: FeedNote): Promise<string> {
		if (!browser) throw new Error('browser only');
		const id = identity.current;
		if (!id) throw new Error('No identity — create or import a key first');
		if (!note.raw) throw new Error('This note cannot be reposted from the current view');
		const repostKind =
			note.raw.kind === NOSTR_KINDS.TEXT_NOTE ? NOSTR_KINDS.REPOST : NOSTR_KINDS.GENERIC_REPOST;
		const event = await signMined({
			kind: repostKind,
			content: JSON.stringify(note.raw),
			created_at: Math.floor(Date.now() / 1000),
			tags: [...clientTag(), ...repostTags(note.raw)]
		});
		await publish(event);
		return event.id;
	}

	/**
	 * Publish a kind-1 poll note. The question is the note content; each option
	 * becomes a `["poll_option", "<id>", "<label>"]` tag. Votes arrive later as
	 * kind-7 reactions whose content is the option id.
	 */
	async postPoll(
		question: string,
		options: string[],
		publishOptions: { pow?: number; endsAt?: number } = {}
	): Promise<string> {
		if (!browser) throw new Error('browser only');
		const id = identity.current;
		if (!id) throw new Error('No identity — create or import a key first');
		const prompt = question.trim();
		if (!prompt) throw new Error('Add a poll question');
		const cleanOptions = options.map((o) => o.trim()).filter(Boolean);
		if (cleanOptions.length < 2) throw new Error('A poll needs at least 2 options');
		if (cleanOptions.length > 12) throw new Error('A poll can have at most 12 options');
		if (prompt.length > MAX_TEXT_NOTE_CHARS) {
			throw new Error(
				`Questions are limited to ${MAX_TEXT_NOTE_CHARS.toLocaleString()} characters`
			);
		}
		const unsigned = {
			pubkey: id.pk,
			kind: NOSTR_KINDS.TEXT_NOTE,
			content: prompt,
			created_at: Math.floor(Date.now() / 1000),
			tags: [
				...clientTag(),
				...extractHashtagTags(prompt),
				...cleanOptions.map((label, i) => ['option', String(i), label]),
				['polltype', 'singlechoice'],
				...(publishOptions.endsAt && publishOptions.endsAt > 0
					? [['endsAt', String(publishOptions.endsAt)] as string[]]
					: [])
			]
		};
		(unsigned as { kind: number }).kind = NOSTR_KINDS.POLL;
		const mined =
			publishOptions.pow && publishOptions.pow > 0
				? await minePowAsync(unsigned, publishOptions.pow)
				: unsigned;
		const event = await signMined(mined);
		await publish(event);
		this.ingestNote(event, { queueIfLive: false, preferNewestOnEqual: true });
		return event.id;
	}

	/**
	 * Cast a vote on a poll by publishing a kind-7 reaction whose content is the
	 * option id and which references the poll note via an `e` tag. Re-voting is
	 * allowed; the latest vote per pubkey wins.
	 */
	async votePoll(note: FeedNote, optionId: string): Promise<FeedNote> {
		if (!browser) return note;
		const id = identity.current;
		if (!id) throw new Error('No identity');
		if (!note.poll?.options.some((o) => o.id === optionId)) throw new Error('Invalid option');
		if (note.poll.myVote === optionId) return note; // already voted this option
		const event = await signMined({
			kind: NOSTR_KINDS.POLL_RESPONSE,
			content: '',
			created_at: Math.floor(Date.now() / 1000),
			tags: [...clientTag(), ['e', note.id], ['response', optionId]]
		});
		await publish(event);
		// Optimistic local application (subscription will also confirm, idempotent).
		this.applyPollVote(note.id, {
			id: event.id,
			pubkey: id.pk.toLowerCase(),
			content: optionId,
			created_at: event.created_at
		});

		// Search/profile pages render notes outside this store. Return the same
		// optimistic update so those cards can update immediately as well.
		const previousVote = note.poll.myVote;
		const votes = { ...note.poll.votes };
		if (previousVote) votes[previousVote] = Math.max(0, (votes[previousVote] ?? 0) - 1);
		votes[optionId] = (votes[optionId] ?? 0) + 1;
		const voters = [
			{ pubkey: id.pk.toLowerCase(), optionId, at: event.created_at },
			...(note.poll.voters ?? []).filter((voter) => voter.pubkey !== id.pk.toLowerCase())
		].slice(0, MAX_POLL_VOTERS);
		return {
			...note,
			poll: {
				...note.poll,
				votes,
				totalVotes: Object.values(votes).reduce((sum, count) => sum + count, 0),
				myVote: optionId,
				voters
			}
		};
	}

	/** Publish a kind-1 reply to an existing note using NIP-10 style tags. */
	async reply(
		note: FeedNote,
		content: string,
		options: {
			attachments?: PostMediaAttachment[];
			extraPubkeys?: string[];
			/** NIP-13 difficulty (leading zero bitz) to mine before publishing. */
			pow?: number;
			/** Live stats while the NIP-13 worker mines. */
			onPowProgress?: (progress: PowProgress) => void;
			/** Coarse phase updates for button / status labels. */
			onPhase?: (phase: 'mining' | 'publishing') => void;
			/** Aborts mining (worker is terminated, nothing is published). */
			signal?: AbortSignal;
		} = {}
	): Promise<FeedNote> {
		if (!browser) throw new Error('browser only');
		const id = identity.current;
		if (!id) throw new Error('No identity — create or import a key first');
		const text = content.trim();
		const attachments = (options.attachments ?? []).filter((attachment) => attachment?.url);
		const attachmentLines = attachments.map((attachment) => attachment.url.trim()).filter(Boolean);
		const body = [text, attachmentLines.join('\n')].filter(Boolean).join('\n\n').trim();
		if (!body) throw new Error('Nothing to reply');
		if (body.length > MAX_TEXT_NOTE_CHARS) {
			throw new Error(`Replies are limited to ${MAX_TEXT_NOTE_CHARS.toLocaleString()} characters`);
		}

		const rootId =
			note.tags.find((tag) => tag[0] === 'e' && tag[3] === 'root')?.[1] ?? note.replyTo ?? note.id;
		const taggedPubkeys = [
			note.pubkey,
			...note.tags.filter((tag) => tag[0] === 'p' && tag[1]).map((tag) => tag[1]),
			...(options.extraPubkeys ?? [])
		].filter((pubkey, index, all) => pubkey && all.indexOf(pubkey) === index);

		const tags: string[][] = [
			...clientTag(),
			...extractHashtagTags(body),
			['e', rootId, '', 'root'],
			['e', note.id, '', 'reply'],
			...taggedPubkeys.map((pubkey) => ['p', pubkey])
		];
		for (const attachment of attachments) {
			if (attachment.kind === 'image' || attachment.kind === 'video') {
				const imeta = [`url ${attachment.url}`];
				if (attachment.mimeType) imeta.push(`m ${attachment.mimeType}`);
				if (attachment.bytes > 0) imeta.push(`size ${attachment.bytes}`);
				tags.push(['imeta', ...imeta]);
			}
		}
		// NIP-27: tag profiles / notes referenced by inline `nostr:` mentions,
		// skipping the thread's own root / reply ids to avoid duplicate e-tags.
		const { pubkeys, noteIds } = extractMentionEntities(body);
		for (const pubkey of pubkeys) {
			if (!taggedPubkeys.includes(pubkey)) tags.push(['p', pubkey]);
		}
		for (const eventId of noteIds) {
			if (eventId !== rootId && eventId !== note.id) tags.push(['e', eventId]);
		}

		// NIP-13 mining is opt-in; ordinary replies remain immediate.
		let unsigned: UnsignedEvent = {
			pubkey: id.pk,
			kind: NOSTR_KINDS.TEXT_NOTE,
			content: body,
			created_at: Math.floor(Date.now() / 1000),
			tags
		};
		if (options.pow && options.pow > 0) {
			options.onPhase?.('mining');
			unsigned = await minePowAsync(unsigned, options.pow, {
				onProgress: options.onPowProgress,
				signal: options.signal
			});
		}
		options.onPhase?.('publishing');
		const event = await signMined(unsigned);
		await publish(event);
		this.ingestNote(event, { queueIfLive: false, preferNewestOnEqual: true });
		return toFeedNote(event);
	}

	/**
	 * Publish a NIP-22 comment (kind 1111) on a non-kind-1 event — the correct
	 * reply form for bitz/videos (plan ADR-003). Root tags are uppercase
	 * `E/K/P` pointing at the commented event; parent tags are lowercase
	 * `e/k/p` pointing at the comment being replied to (the root itself for
	 * top-level comments), so readers keep precise root/parent semantics.
	 */
	async comment(
		target: { id: string; pubkey: string; kind: number },
		content: string,
		parent: { id: string; pubkey: string; kind?: number } | undefined,
		options: {
			/** Media attached to the comment (URLs folded into content + imeta). */
			attachments?: PostMediaAttachment[];
			/** NIP-13 difficulty to mine before publishing. */
			pow?: number;
			onPowProgress?: (progress: PowProgress) => void;
			onPhase?: (phase: 'mining' | 'publishing') => void;
			signal?: AbortSignal;
		} = {}
	): Promise<FeedNote> {
		if (!browser) throw new Error('browser only');
		const id = identity.current;
		if (!id) throw new Error('No identity — create or import a key first');
		const text = content.trim();
		const attachments = (options.attachments ?? []).filter((attachment) => attachment?.url);
		const attachmentLines = attachments.map((attachment) => attachment.url.trim()).filter(Boolean);
		const body = [text, attachmentLines.join('\n')].filter(Boolean).join('\n\n').trim();
		if (!body) throw new Error('Nothing to comment');
		if (body.length > MAX_TEXT_NOTE_CHARS) {
			throw new Error(`Comments are limited to ${MAX_TEXT_NOTE_CHARS.toLocaleString()} characters`);
		}
		if (target.kind === NOSTR_KINDS.TEXT_NOTE) {
			throw new Error('Use reply() for kind-1 threads (NIP-10)');
		}

		const taggedPubkeys = [target.pubkey, ...(parent ? [parent.pubkey] : [])].filter(
			(pubkey, index, all) => pubkey && all.indexOf(pubkey) === index
		);
		// Relay hints help readers find the referenced events (NIP-22 E tags).
		// A single well-known read relay keeps tags small; empty is legal too.
		const relayHint = 'wss://relay.damus.io';

		const tags: string[][] = [
			...clientTag(),
			...extractHashtagTags(body),
			// NIP-22 root: uppercase E/K/P anchored to the commented event.
			['E', target.id, relayHint, target.pubkey],
			['K', String(target.kind)],
			['P', target.pubkey, relayHint],
			// NIP-22 parent: lowercase e/k/p. Top-level → the target itself;
			// nested → the comment being answered.
			parent
				? (['e', parent.id, relayHint, parent.pubkey] as string[])
				: (['e', target.id, relayHint, target.pubkey] as string[]),
			['k', String(parent?.kind ?? (parent ? NOSTR_KINDS.COMMENT : target.kind))],
			...taggedPubkeys.map((pubkey) => ['p', pubkey, relayHint])
		];

		// NIP-27 inline `nostr:` mentions become extra p/e tags.
		const { pubkeys, noteIds } = extractMentionEntities(text);
		for (const pubkey of pubkeys) {
			if (!taggedPubkeys.includes(pubkey)) tags.push(['p', pubkey]);
		}
		for (const eventId of noteIds) {
			if (eventId !== target.id && eventId !== parent?.id) tags.push(['e', eventId]);
		}

		let unsigned: UnsignedEvent = {
			pubkey: id.pk,
			kind: NOSTR_KINDS.COMMENT,
			content: body,
			created_at: Math.floor(Date.now() / 1000),
			tags
		};
		if (options.pow && options.pow > 0) {
			options.onPhase?.('mining');
			unsigned = await minePowAsync(unsigned, options.pow, {
				onProgress: options.onPowProgress,
				signal: options.signal
			});
		}
		options.onPhase?.('publishing');
		const event = await signMined(unsigned);
		await publish(event);
		this.ingestNote(event, { queueIfLive: false, preferNewestOnEqual: true });
		return toFeedNote(event);
	}

	/** React to a note with a ❤️ (kind 7). */
	async react(
		note: FeedNote,
		emoji = '❤️',
		options: {
			/**
			 * Optional NIP-13 difficulty. Reactions stay instant by default
			 * (pow 0); pass a value only when a relay mandates a minimum
			 * difficulty (NIP-11 `min_pow_difficulty`).
			 */
			pow?: number;
			onPowProgress?: (progress: PowProgress) => void;
			signal?: AbortSignal;
		} = {}
	) {
		if (!browser) return;
		const id = identity.current;
		if (!id) throw new Error('No identity');
		const existing = note.reactions.find((reaction) => reaction.emoji === emoji && reaction.byMe);
		if (existing?.myEventId) {
			const deleteEvent = await signMined({
				kind: NOSTR_KINDS.DELETE,
				content: 'Deleted reaction from BitOS',
				created_at: Math.floor(Date.now() / 1000),
				tags: [
					['e', existing.myEventId],
					['e', note.id],
					['p', note.pubkey]
				]
			});
			await publish(deleteEvent);
			this.removeMyReaction(note.id, emoji);
			return;
		}
		if (existing) {
			this.removeMyReaction(note.id, emoji);
			return;
		}
		let unsigned: UnsignedEvent = {
			pubkey: id.pk,
			kind: NOSTR_KINDS.REACTION,
			content: emoji,
			created_at: Math.floor(Date.now() / 1000),
			tags: [...clientTag(), ['e', note.id, '', note.replyTo ? 'reply' : ''], ['p', note.pubkey]]
		};
		if (options.pow && options.pow > 0) {
			unsigned = await minePowAsync(unsigned, options.pow, {
				onProgress: options.onPowProgress,
				signal: options.signal
			});
		}
		const event = await signMined(unsigned);
		await publish(event);
		this.ingestReaction(event);
	}
}

export const feed = new FeedStore();
