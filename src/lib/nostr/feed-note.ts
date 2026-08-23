import { parsePoll, pollClosedAt, type Event, type FeedNote } from './types';
import { getPow } from 'nostr-tools/nip13';

type FeedNoteEvent = Pick<
	{
		id: string;
		pubkey: string;
		content: string;
		created_at: number;
		tags: string[][];
		sig?: string;
	},
	'id' | 'pubkey' | 'content' | 'created_at' | 'tags' | 'sig'
>;

/** Convert a kind-1 (or NIP-22 kind-1111 comment) event into the complete
 * shape expected by feed cards. */
export function toFeedNote(ev: FeedNoteEvent): FeedNote {
	const replyTag = ev.tags.find((tag) => tag[0] === 'e' && tag[3] === 'reply');
	// NIP-22 comments carry `e/E` lowercase reply + uppercase root tags without
	// NIP-10 marker strings; resolve the parent from either convention.
	const nip22Parent =
		ev.tags.find((tag) => tag[0] === 'e')?.[1] ?? ev.tags.find((tag) => tag[0] === 'E')?.[1];
	const nonceTag = ev.tags.find((tag) => tag[0] === 'nonce');
	const powTarget = Number(nonceTag?.[2]);
	const options = parsePoll(ev.tags);

	return {
		id: ev.id,
		pubkey: ev.pubkey,
		content: ev.content,
		createdAt: ev.created_at,
		pow: nonceTag && Number.isFinite(powTarget) && powTarget > 0 ? getPow(ev.id) : undefined,
		tags: ev.tags,
		raw: ev.sig ? (ev as Event) : undefined,
		replyTo: replyTag?.[1] ?? nip22Parent,
		reactions: [],
		repostCount: 0,
		zapCount: 0,
		zapTotalSats: 0,
		poll: options
			? { options, votes: {}, totalVotes: 0, closedAt: pollClosedAt(ev.tags) }
			: undefined
	};
}
