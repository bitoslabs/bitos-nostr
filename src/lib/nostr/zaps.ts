import { NOSTR_KINDS, type Event, type FeedNote } from './types';

export function zapTarget(ev: Pick<Event, 'tags' | 'content'>): string | undefined {
	const direct = ev.tags.find((tag) => tag[0] === 'e' && tag[1])?.[1];
	if (direct) return direct;
	const description = ev.tags.find((tag) => tag[0] === 'description' && tag[1])?.[1];
	if (!description) return undefined;
	try {
		const request = JSON.parse(description) as { tags?: string[][] };
		return request.tags?.find((tag) => tag[0] === 'e' && tag[1])?.[1];
	} catch {
		return undefined;
	}
}

export function satsFromBolt11(invoice: string): number {
	const match = invoice.toLowerCase().match(/^lnbc(\d+)([munp]?)[a-z0-9]*1/);
	if (!match) return 0;
	const amount = Number(match[1]);
	const unit = match[2];
	if (!Number.isFinite(amount)) return 0;
	if (unit === 'm') return Math.round(amount * 100_000);
	if (unit === 'u') return Math.round(amount * 100);
	if (unit === 'n') return Math.round(amount / 10);
	if (unit === 'p') return Math.round(amount / 10_000);
	return Math.round(amount * 100_000_000);
}

export function zapSats(ev: Pick<Event, 'tags'>): number {
	const bolt11 = ev.tags.find((tag) => tag[0] === 'bolt11' && tag[1])?.[1];
	return bolt11 ? satsFromBolt11(bolt11) : 0;
}

export function applyActivityToNotes(
	notes: FeedNote[],
	events: Event[],
	myPubkey?: string
): FeedNote[] {
	const noteIds = new Set(notes.map((note) => note.id));
	const reactionIds = new Set<string>();
	const zapIds = new Set<string>();
	const reactionsByNote = new Map<string, FeedNote['reactions']>();
	const zapsByNote = new Map<string, { count: number; sats: number }>();
	const pollVotesByNote = new Map<string, Map<string, { optionId: string; at: number }>>();

	for (const ev of events) {
		if (ev.kind === NOSTR_KINDS.REACTION) {
			const target = ev.tags.find((tag) => tag[0] === 'e' && tag[1])?.[1];
			if (!target || !noteIds.has(target) || ev.content === '-' || reactionIds.has(ev.id)) continue;
			const targetNote = notes.find((note) => note.id === target);
			if (targetNote?.poll?.options.some((option) => option.id === ev.content)) {
				const votes = pollVotesByNote.get(target) ?? new Map();
				const previous = votes.get(ev.pubkey);
				if (!previous || ev.created_at >= previous.at) {
					votes.set(ev.pubkey, { optionId: ev.content, at: ev.created_at });
					pollVotesByNote.set(target, votes);
				}
				continue;
			}
			reactionIds.add(ev.id);
			const current = reactionsByNote.get(target) ?? [];
			const emoji = ev.content || '❤️';
			const existing = current.find((reaction) => reaction.emoji === emoji);
			const byMe = ev.pubkey === myPubkey;
			if (existing) {
				existing.count += 1;
				if (byMe) {
					existing.byMe = true;
					existing.myEventId = ev.id;
				}
			} else {
				current.push({ emoji, count: 1, byMe, myEventId: byMe ? ev.id : undefined });
			}
			reactionsByNote.set(target, current);
		}

		if (ev.kind === NOSTR_KINDS.ZAP) {
			const target = zapTarget(ev);
			if (!target || !noteIds.has(target) || zapIds.has(ev.id)) continue;
			zapIds.add(ev.id);
			const current = zapsByNote.get(target) ?? { count: 0, sats: 0 };
			current.count += 1;
			current.sats += zapSats(ev);
			zapsByNote.set(target, current);
		}
	}

	return notes.map((note) => {
		const pollVotes = pollVotesByNote.get(note.id);
		const votes: Record<string, number> = {};
		let myVote: string | undefined;
		if (pollVotes) {
			for (const [pubkey, vote] of pollVotes) {
				votes[vote.optionId] = (votes[vote.optionId] ?? 0) + 1;
				if (pubkey === myPubkey) myVote = vote.optionId;
			}
		}
		return {
			...note,
			reactions: reactionsByNote.get(note.id) ?? note.reactions,
			zapCount: zapsByNote.get(note.id)?.count ?? note.zapCount,
			zapTotalSats: zapsByNote.get(note.id)?.sats ?? note.zapTotalSats,
			poll: note.poll && pollVotesByNote.has(note.id)
				? {
						...note.poll,
						votes,
						totalVotes: Object.values(votes).reduce((sum, count) => sum + count, 0),
						myVote
					}
				: note.poll
		};
	});
}
