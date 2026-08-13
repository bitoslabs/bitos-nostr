/**
 * Feed store — subscribes to NIP-01 kind-1 text notes (a global timeline),
 * aggregates reactions (kind 7), and publishes new notes. Reactions and reposts
 * are folded into each note so the UI can render counts. Notes are kept
 * newest-first and capped to a sane window.
 */
import { browser } from '$app/environment';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { getPow, minePow } from 'nostr-tools/nip13';
import type { UnsignedEvent } from 'nostr-tools/pure';
import { subscribe, publish, queryPrimaryFirst } from './pool';
import { identity } from './identity.svelte';
import { profiles } from './profiles.svelte';
import { blocks } from '$lib/stores/blocks.svelte';
import { mutes } from '$lib/stores/mutes.svelte';
import { hexToBytes } from './hex';
import { NOSTR_KINDS, type FeedNote, parsePoll, pollClosedAt } from './types';
import { toFeedNote } from './feed-note';
import { applyActivityToNotes, zapSats, zapTarget } from './zaps';
import { extractMentionEntities } from '$lib/utils/nip27';
import type { UploadedMedia } from '$lib/media/uploaders';
import { clientTag } from './client-tag';
import { extractHashtagTags } from '$lib/utils/note-content';

const INITIAL_LIMIT = 150;
const PAGE_LIMIT = 80;
const MAX_NOTES = 1000;
const MAX_PENDING_NOTES = 100;
const MAX_TEXT_NOTE_CHARS = 16_000;
const MAX_BUFFERED_REACTIONS = 2_000;

type PostMediaAttachment = Pick<UploadedMedia, 'url' | 'kind' | 'mimeType' | 'bytes'>;

function minePowAsync(unsigned: UnsignedEvent, difficulty: number) {
	return new Promise<ReturnType<typeof minePow>>((resolve, reject) => {
		const worker = new Worker(new URL('./pow.worker.ts', import.meta.url), { type: 'module' });
		worker.onmessage = (message: MessageEvent<{ ok: boolean; event?: ReturnType<typeof minePow>; error?: string }>) => {
			worker.terminate();
			if (message.data.ok && message.data.event) resolve(message.data.event);
			else reject(new Error(message.data.error || 'Proof of Work failed'));
		};
		worker.onerror = () => {
			worker.terminate();
			reject(new Error('Proof of Work worker failed'));
		};
		worker.postMessage({ unsigned, difficulty });
	});
}

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
					kinds: [NOSTR_KINDS.TEXT_NOTE, NOSTR_KINDS.REACTION, NOSTR_KINDS.ZAP],
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
					if (ev.kind === NOSTR_KINDS.TEXT_NOTE)
						this.ingestNote(ev, { queueIfLive: this.connected });
					else if (ev.kind === NOSTR_KINDS.REACTION) this.ingestReaction(ev);
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
						kinds: [NOSTR_KINDS.TEXT_NOTE],
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
		const replyTag = ev.tags.find((t) => t[0] === 'e' && t[3] === 'reply');
		const nonceTag = ev.tags.find((t) => t[0] === 'nonce');
		const powTarget = Number(nonceTag?.[2]);
		const pollOptions = parsePoll(ev.tags);
		const note: FeedNote = {
			id: ev.id,
			pubkey: ev.pubkey,
			content: ev.content,
			createdAt: ev.created_at,
			pow: nonceTag && Number.isFinite(powTarget) && powTarget > 0 ? getPow(ev.id) : undefined,
			tags: ev.tags,
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
		const byPubkey = this.pollVotes.get(pollId) ?? new Map<string, { optionId: string }>();
		const votes: Record<string, number> = {};
		let total = 0;
		const me = identity.current?.pk?.toLowerCase();
		let myVote: string | undefined;
		for (const [pubkey, v] of byPubkey) {
			votes[v.optionId] = (votes[v.optionId] ?? 0) + 1;
			total += 1;
			if (pubkey === me) myVote = v.optionId;
		}
		this.updateNote(pollId, (n) =>
			n.poll ? { ...n, poll: { ...n.poll, votes, totalVotes: total, myVote } } : n
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
		this.notes.forEach((n, i) => this.byId.set(n.id, i));
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
						kinds: [NOSTR_KINDS.REACTION, NOSTR_KINDS.ZAP],
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
			? await queryPrimaryFirst([{ kinds: [NOSTR_KINDS.REACTION], '#e': replyIds, limit: 1000 }])
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
		const event = finalizeEvent(
			{
				kind: NOSTR_KINDS.DELETE,
				content: 'Deleted from BitOS',
				created_at: Math.floor(Date.now() / 1000),
				tags: [['e', note.id]]
			},
			hexToBytes(id.sk)
		);
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
		options: { sensitive?: boolean; attachments?: PostMediaAttachment[]; pow?: number } = {}
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
		for (const attachment of attachments) {
			if (attachment.kind === 'image' || attachment.kind === 'video') {
				const imeta = [`url ${attachment.url}`];
				if (attachment.mimeType) imeta.push(`m ${attachment.mimeType}`);
				if (attachment.bytes > 0) imeta.push(`size ${attachment.bytes}`);
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
			pubkey: getPublicKey(hexToBytes(id.sk)),
			kind: NOSTR_KINDS.TEXT_NOTE,
			content: body,
			created_at: Math.floor(Date.now() / 1000),
			tags
		};
		// NIP-13 mining is opt-in so ordinary posts remain immediate.
		const mined = options.pow && options.pow > 0 ? await minePowAsync(unsigned, options.pow) : unsigned;
		const event = finalizeEvent(mined, hexToBytes(id.sk));
		await publish(event);
		// show immediately (the subscription will also re-deliver it, dedup by id)
		this.ingestNote(event, { queueIfLive: false, preferNewestOnEqual: true });
		return event.id;
	}

	/**
	 * Publish a kind-1 poll note. The question is the note content; each option
	 * becomes a `["poll_option", "<id>", "<label>"]` tag. Votes arrive later as
	 * kind-7 reactions whose content is the option id.
	 */
	async postPoll(question: string, options: string[]): Promise<string> {
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
		const event = finalizeEvent(
			{
				kind: NOSTR_KINDS.TEXT_NOTE,
				content: prompt,
				created_at: Math.floor(Date.now() / 1000),
				tags: [
					...clientTag(),
					...extractHashtagTags(prompt),
					...cleanOptions.map((label, i) => ['poll_option', String(i), label])
				]
			},
			hexToBytes(id.sk)
		);
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
		const event = finalizeEvent(
			{
				kind: NOSTR_KINDS.REACTION,
				content: optionId,
				created_at: Math.floor(Date.now() / 1000),
				tags: [...clientTag(), ['e', note.id], ['p', note.pubkey]]
			},
			hexToBytes(id.sk)
		);
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
		return {
			...note,
			poll: {
				...note.poll,
				votes,
				totalVotes: Object.values(votes).reduce((sum, count) => sum + count, 0),
				myVote: optionId
			}
		};
	}

	/** Publish a kind-1 reply to an existing note using NIP-10 style tags. */
	async reply(
		note: FeedNote,
		content: string,
		options: { attachments?: PostMediaAttachment[]; extraPubkeys?: string[] } = {}
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

		const event = finalizeEvent(
			{
				kind: NOSTR_KINDS.TEXT_NOTE,
				content: body,
				created_at: Math.floor(Date.now() / 1000),
				tags
			},
			hexToBytes(id.sk)
		);
		await publish(event);
		this.ingestNote(event, { queueIfLive: false, preferNewestOnEqual: true });
		return toFeedNote(event);
	}

	/** React to a note with a ❤️ (kind 7). */
	async react(note: FeedNote, emoji = '❤️') {
		if (!browser) return;
		const id = identity.current;
		if (!id) throw new Error('No identity');
		const existing = note.reactions.find((reaction) => reaction.emoji === emoji && reaction.byMe);
		if (existing?.myEventId) {
			const deleteEvent = finalizeEvent(
				{
					kind: NOSTR_KINDS.DELETE,
					content: 'Deleted reaction from BitOS',
					created_at: Math.floor(Date.now() / 1000),
					tags: [
						['e', existing.myEventId],
						['e', note.id],
						['p', note.pubkey]
					]
				},
				hexToBytes(id.sk)
			);
			await publish(deleteEvent);
			this.removeMyReaction(note.id, emoji);
			return;
		}
		if (existing) {
			this.removeMyReaction(note.id, emoji);
			return;
		}
		const event = finalizeEvent(
			{
				kind: NOSTR_KINDS.REACTION,
				content: emoji,
				created_at: Math.floor(Date.now() / 1000),
				tags: [...clientTag(), ['e', note.id, '', note.replyTo ? 'reply' : ''], ['p', note.pubkey]]
			},
			hexToBytes(id.sk)
		);
		await publish(event);
		this.ingestReaction(event);
	}
}

export const feed = new FeedStore();
