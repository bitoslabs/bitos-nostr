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
	'id' | 'pubkey' | 'content' | 'created_at' | 'tags'
>;

/** Convert a kind-1 event into the complete shape expected by feed cards. */
export function toFeedNote(ev: FeedNoteEvent): FeedNote {
	const replyTag = ev.tags.find((tag) => tag[0] === 'e' && tag[3] === 'reply');
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
		replyTo: replyTag?.[1],
		reactions: [],
		repostCount: 0,
		zapCount: 0,
		zapTotalSats: 0,
		poll: options
			? { options, votes: {}, totalVotes: 0, closedAt: pollClosedAt(ev.tags) }
			: undefined
	};
}
