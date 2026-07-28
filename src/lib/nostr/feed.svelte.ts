/**
 * Feed store — subscribes to NIP-01 kind-1 text notes (a global timeline),
 * aggregates reactions (kind 7), and publishes new notes. Reactions and reposts
 * are folded into each note so the UI can render counts. Notes are kept
 * newest-first and capped to a sane window.
 */
import { browser } from '$app/environment';
import { finalizeEvent } from 'nostr-tools/pure';
import { subscribe, publish, queryOnce } from './pool';
import { identity } from './identity.svelte';
import { profiles } from './profiles.svelte';
import { hexToBytes } from './hex';
import { NOSTR_KINDS, type FeedNote } from './types';

const INITIAL_LIMIT = 150;
const PAGE_LIMIT = 80;
const MAX_NOTES = 1000;

function isReaction(content: string): boolean {
	// kind 7 reactions are either a + / - or an emoji shortcode
	return content === '+' || content === '-' || /\p{Extended_Pictographic}/u.test(content);
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
		this.unsub = subscribe(
			[{ kinds: [NOSTR_KINDS.TEXT_NOTE, NOSTR_KINDS.REACTION], limit: INITIAL_LIMIT }],
			{
				oneose: () => {
					this.loading = false;
					this.connected = true;
				},
				onevent: (ev) => {
					if (ev.kind === NOSTR_KINDS.TEXT_NOTE)
						this.ingestNote(ev, { queueIfLive: this.connected });
					else if (ev.kind === NOSTR_KINDS.REACTION) this.ingestReaction(ev);
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

	/** Query the next older page without changing the live "new notes" queue. */
	async loadMore() {
		if (!browser || this.loadingMore || !this.hasMore) return 0;
		const oldest = this.notes.at(-1);
		if (!oldest) return 0;

		this.loadingMore = true;
		try {
			const events = await queryOnce([
				{
					kinds: [NOSTR_KINDS.TEXT_NOTE],
					limit: PAGE_LIMIT,
					until: oldest.createdAt - 1
				}
			]);
			const before = this.notes.length;
			for (const ev of events.sort((a, b) => b.created_at - a.created_at)) {
				this.ingestNote(ev, { queueIfLive: false });
				profiles.ensure([ev.pubkey]);
			}
			const added = this.notes.length - before;
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
		options: { queueIfLive?: boolean } = {}
	) {
		if (this.byId.has(ev.id) || this.pendingById.has(ev.id)) return;
		const replyTag = ev.tags.find((t) => t[0] === 'e' && t[3] === 'reply');
		const note: FeedNote = {
			id: ev.id,
			pubkey: ev.pubkey,
			content: ev.content,
			createdAt: ev.created_at,
			tags: ev.tags,
			replyTo: replyTag?.[1],
			reactions: [],
			repostCount: 0
		};
		if (options.queueIfLive && this.notes.length > 0 && note.createdAt >= this.notes[0].createdAt) {
			this.insertPending(note);
			return;
		}
		this.insertVisible(note);
	}

	private insertVisible(note: FeedNote) {
		// insert newest-first
		let idx = 0;
		while (idx < this.notes.length && this.notes[idx].createdAt >= note.createdAt) idx++;
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
		this.rebuildPendingIndex();
	}

	private ingestReaction(ev: {
		pubkey: string;
		content: string;
		tags: string[][];
		created_at: number;
	}) {
		// NIP-25: reaction tags the target note/event with `e` (and usually `p`).
		const target = ev.tags.find((t) => t[0] === 'e')?.[1];
		if (!target) return;
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

	private nextReactions(
		note: FeedNote,
		ev: {
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
			existing.count += 1;
			if (byMe) existing.byMe = true;
		} else {
			next.push({ emoji, count: 1, byMe });
		}
		return next;
	}

	private rebuildIndex() {
		this.byId.clear();
		this.notes.forEach((n, i) => this.byId.set(n.id, i));
	}

	private rebuildPendingIndex() {
		this.pendingById.clear();
		this.pendingNotes.forEach((n, i) => this.pendingById.set(n.id, i));
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
	async post(content: string): Promise<string> {
		if (!browser) throw new Error('browser only');
		const id = identity.current;
		if (!id) throw new Error('No identity — create or import a key first');
		const text = content.trim();
		if (!text) throw new Error('Nothing to post');
		const unsigned = {
			kind: NOSTR_KINDS.TEXT_NOTE,
			content: text,
			created_at: Math.floor(Date.now() / 1000),
			tags: []
		};
		const event = finalizeEvent(unsigned, hexToBytes(id.sk));
		await publish(event);
		// show immediately (the subscription will also re-deliver it, dedup by id)
		this.ingestNote(event, { queueIfLive: false });
		return event.id;
	}

	/** React to a note with a ❤️ (kind 7). */
	async react(note: FeedNote, emoji = '❤️') {
		if (!browser) return;
		const id = identity.current;
		if (!id) throw new Error('No identity');
		const event = finalizeEvent(
			{
				kind: NOSTR_KINDS.REACTION,
				content: emoji,
				created_at: Math.floor(Date.now() / 1000),
				tags: [
					['e', note.id],
					['p', note.pubkey]
				]
			},
			hexToBytes(id.sk)
		);
		await publish(event);
		this.ingestReaction(event);
	}
}

export const feed = new FeedStore();
