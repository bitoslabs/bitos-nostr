import { NOSTR_KINDS, type Event, type FeedNote } from './types';

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

/** Seconds from invoice creation until expiry when the `x` field is absent. */
const BOLT11_DEFAULT_EXPIRY = 3600;

/** Signature tail of a BOLT11 data part (104 chars: 512-bit sig + recovery). */
const BOLT11_SIGNATURE_CHARS = 104;

/**
 * Absolute expiry of a BOLT11 invoice, as a unix timestamp in seconds.
 *
 * Minimal parser per BOLT #11: reads the 35-bit timestamp from the first 7
 * bech32 chars after the separator, then scans the tagged fields for `x`
 * (expiry in seconds, relative to the timestamp). Returns `null` when the
 * string is not shaped like an invoice. Used to surface a live countdown
 * and to know when a shown invoice has gone stale.
 */
export function bolt11Expiry(bolt11: string): number | null {
	const match = bolt11
		.toLowerCase()
		.match(/^lnbc[0-9]*[munp]?1([qpzry9x8gf2tvdw0s3jn54khce6mua7l]+)$/);
	if (!match) return null;
	const data = match[1];
	const idx = (ch: string) => BECH32_CHARSET.indexOf(ch);
	if (data.length < 7 + BOLT11_SIGNATURE_CHARS) return null;

	let timestamp = 0;
	for (let i = 0; i < 7; i++) timestamp = timestamp * 32 + idx(data[i]);

	// Tagged fields live between the timestamp and the fixed-width signature.
	const fieldsEnd = data.length - BOLT11_SIGNATURE_CHARS;
	let i = 7;
	while (i + 1 < fieldsEnd) {
		const type = data[i];
		// BOLT11 varint length: values < 31 are the length; 31 adds another
		// 5-bit word multiplied by 32 each round (mirrors the reference impl).
		let length = 0;
		let multiplier = 1;
		let j = i + 1;
		while (j < fieldsEnd) {
			const value = idx(data[j]);
			if (value < 0) return null;
			length += (value & 31) * multiplier;
			multiplier *= 32;
			j++;
			if (value < 31) break;
		}
		if (type === 'x') {
			let expiry = 0;
			for (let k = j; k < j + length && k < fieldsEnd; k++) expiry = expiry * 32 + idx(data[k]);
			return timestamp + expiry;
		}
		i = j + length;
	}
	return timestamp + BOLT11_DEFAULT_EXPIRY;
}

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
			poll:
				note.poll && pollVotesByNote.has(note.id)
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
