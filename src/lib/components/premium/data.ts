// Shared types + mock data for the premium UI showcase. Presentation lives in
// the components; this module is the single source of data so views stay thin.

import type { PostAuthor } from '$lib/components/feed/PremiumPostCard.svelte';
import type { NavEntry, AccountChip } from '$lib/components/shell/PremiumSidebar.svelte';
import type { Trend } from '$lib/components/shell/TrendingWidget.svelte';
import type { RelayRow } from '$lib/components/shell/RelayWidget.svelte';

export type { PostAuthor, NavEntry, AccountChip, Trend, RelayRow };

export type PostStats = {
	replies: number;
	reposts: number;
	likes: number;
	zaps: number;
	sats: number;
};

export type PostQuote = { author: string; npub: string; content: string; pow?: number };

export type Post = {
	id: string;
	author: PostAuthor;
	time: string;
	content: string;
	image?: string;
	kind: number;
	pow: number;
	stats: PostStats;
	quote?: PostQuote;
	liked: boolean;
	zapped: boolean;
	reposted: boolean;
};

export type NotifType = 'zap' | 'like' | 'repost' | 'follow' | 'mention';

export type AppNotification = {
	id: string;
	type: NotifType;
	actors: PostAuthor[];
	count: number;
	time: string;
	text: string;
	amount?: number;
	unread: boolean;
	preview?: string;
};

export type Conversation = {
	id: string;
	name: string;
	npub: string;
	picture: string;
	verified?: boolean;
	last: string;
	time: string;
	unread: number;
};

export type ChatMessage = { id: string; mine: boolean; text: string };

export type Zap = {
	id: string;
	type: 'received' | 'sent';
	amount: number;
	name: string;
	npub: string;
	picture: string;
	memo?: string;
	time: string;
	txid: string;
};

export type Person = {
	name: string;
	npub: string;
	picture: string;
	verified?: boolean;
	bio: string;
	followers: string;
	mutuals: number;
};

const pic = (seed: string) => `https://picsum.photos/seed/${seed}/80/80.jpg`;

export const account: AccountChip = {
	name: 'Volt Dorsey',
	npub: 'npub1volt…k7q3',
	picture: pic('me42'),
	pubkey: 'volt42',
	verified: true
};

export const nav: NavEntry[] = [
	{ to: '/', label: 'Home', icon: 'i-lucide-house', page: 'home' },
	{ to: '/discover', label: 'Explore', icon: 'i-lucide-compass', page: 'explore' },
	{ to: '/notifications', label: 'Notifications', icon: 'i-lucide-bell', badge: 12, page: 'notifications' },
	{ to: '/messages', label: 'Messages', icon: 'i-lucide-mail', badge: 3, badgeTone: 'warm', page: 'messages' },
	{ to: '/bookmarks', label: 'Zaps', icon: 'i-lucide-zap', page: 'zaps' },
	{ to: '/settings', label: 'Relays', icon: 'i-lucide-server', trailing: 'relay', page: 'relays' },
	{ to: '/bookmarks', label: 'Bookmarks', icon: 'i-lucide-bookmark', page: 'bookmarks' },
	{ to: '/profile', label: 'Profile', icon: 'i-lucide-user', page: 'profile' },
	{ to: '/settings', label: 'Settings', icon: 'i-lucide-settings-2', page: 'settings' }
];

export const trends: Trend[] = [
	{ tag: '#nip44', category: 'Tech', notes: 2847, sats: 412 },
	{ tag: '#lightning', category: 'Bitcoin', notes: 1920, sats: 8200 },
	{ tag: '#cypherpunk', category: 'Privacy', notes: 1432, sats: 312 },
	{ tag: '#proofofwork', category: 'Dev', notes: 892, sats: 1400 },
	{ tag: '#selfhosting', category: 'Community', notes: 743, sats: 218 },
	{ tag: '#bitcoin', category: 'Bitcoin', notes: 4203, sats: 12400 }
];

export const relays: RelayRow[] = [
	{ url: 'nos.lol', status: 'connected', latency: 42, events: 18432, mode: 'read' },
	{ url: 'relay.damus.io', status: 'connected', latency: 67, events: 31204, mode: 'read' },
	{ url: 'relay.snort.social', status: 'connected', latency: 58, events: 24891, mode: 'write' },
	{ url: 'relay.nostr.band', status: 'connected', latency: 91, events: 12043, mode: 'read' },
	{ url: 'relay.primal.net', status: 'connecting', latency: 0, events: 0, mode: 'both', paid: true },
	{ url: 'nostr.wine', status: 'connected', latency: 38, events: 8920, mode: 'both', paid: true },
	{ url: 'offchain.pub', status: 'down', latency: 0, events: 4221, mode: 'read' }
];

export const posts: Post[] = [
	{
		id: 'ev1',
		author: { name: "Satoshi's Ghost", npub: 'npub1satoshi…m8jx', picture: pic('ghost42'), pubkey: 'ghost', verified: true },
		time: '2h', kind: 1, pow: 24,
		content: "Just shipped a new NIP-44 implementation. End-to-end encrypted DMs are now 40% faster.\n\nThe future of private communication is decentralized, encrypted, and unstoppable. No middlemen. No surveillance. Just math.",
		stats: { replies: 67, reposts: 89, likes: 432, zaps: 247, sats: 12847 },
		liked: false, zapped: false, reposted: false
	},
	{
		id: 'ev2',
		author: { name: 'Lightning Liz', npub: 'npub1liz…k2p9', picture: pic('liz77'), pubkey: 'liz' },
		time: '4h', kind: 1, pow: 18, image: 'https://picsum.photos/seed/coffee-shop/600/360.jpg',
		content: "Morning coffee, paid via Lightning at a local cafe in Berlin.\n\nThe merchant doesn't even know what Bitcoin is — they just see fiat hit their bank account. This is how we win. Quietly. Patiently.",
		stats: { replies: 43, reposts: 156, likes: 1820, zaps: 412, sats: 34200 },
		liked: true, zapped: true, reposted: false
	},
	{
		id: 'ev3',
		author: { name: 'Cypherpunk Revival', npub: 'npub1cypher…p9r2', picture: pic('cyph88'), pubkey: 'cyph', verified: true },
		time: '6h', kind: 6, pow: 16,
		content: 'Quote-reposting this because it deserves more reach. The original note was mined at 28 bits PoW — real commitment to spam resistance.',
		stats: { replies: 22, reposts: 67, likes: 289, zaps: 91, sats: 4200 },
		quote: { author: 'Open Source Dev', npub: 'npub1dev…x4m8', pow: 28, content: "Pro tip: mine your kind-1 notes with at least 20 bits of PoW. It's nearly free for you, expensive for spammers, and helps keep the network clean." },
		liked: false, zapped: false, reposted: true
	},
	{
		id: 'ev4',
		author: { name: 'Relay Runner', npub: 'npub1relay…q7m3', picture: pic('relay55'), pubkey: 'relay', verified: true },
		time: '8h', kind: 1, pow: 12,
		content: "Running my own relay for 6 months now.\n\n2.3GB stored · 18k events · zero downtime · $4/month VPS\n\nSelf-hosting isn't dead — it's the foundation of a free internet.",
		stats: { replies: 89, reposts: 234, likes: 1102, zaps: 178, sats: 8932 },
		liked: true, zapped: false, reposted: false
	},
	{
		id: 'ev5',
		author: { name: 'Decentral Doris', npub: 'npub1doris…m5k9', picture: pic('doris42'), pubkey: 'doris', verified: true },
		time: '18h', kind: 1, pow: 15,
		content: "Three years on Nostr today.\n\nMy follower count is portable. My identity is mine. My DMs are encrypted. My feed is chronological. This is what 'owning your data' actually feels like.",
		stats: { replies: 78, reposts: 312, likes: 2408, zaps: 287, sats: 14200 },
		liked: true, zapped: true, reposted: false
	}
];

export const myPosts: Post[] = [
	{
		id: 'me1',
		author: { ...account, npub: 'npub1volt…k7q3' },
		time: '3h', kind: 1, pow: 22,
		content: "Just upgraded my relay stack to support NIP-44. Encrypted DMs are now flowing smoothly across all 7 of my relays. If you've been holding off on switching from NIP-04, now's the time. ⚡",
		stats: { replies: 28, reposts: 41, likes: 312, zaps: 89, sats: 4180 },
		liked: false, zapped: false, reposted: false
	},
	{
		id: 'me2',
		author: { ...account, npub: 'npub1volt…k7q3' },
		time: '1d', kind: 1, pow: 20,
		content: "Reminder: your npub is yours forever. Your relays are yours to choose. Your follows are yours to curate. No algorithm decides what you see. That's not a bug — it's the entire point.",
		stats: { replies: 67, reposts: 234, likes: 1208, zaps: 178, sats: 8432 },
		liked: true, zapped: true, reposted: false
	}
];

export const notifications: AppNotification[] = [
	{ id: 'n1', type: 'zap', actors: [{ name: "Satoshi's Ghost", npub: 'npub1satoshi…m8jx', picture: pic('ghost42'), verified: true }], count: 1, time: '2m', text: 'zapped you 1,000 sats', amount: 1000, unread: true },
	{ id: 'n2', type: 'like', actors: [{ name: 'Lightning Liz', npub: 'npub1liz…k2p9', picture: pic('liz77') }, { name: 'Relay Runner', npub: 'npub1relay…q7m3', picture: pic('relay55'), verified: true }], count: 24, time: '12m', text: 'and 22 others liked your note', unread: true },
	{ id: 'n3', type: 'repost', actors: [{ name: 'Cypherpunk Revival', npub: 'npub1cypher…p9r2', picture: pic('cyph88'), verified: true }], count: 1, time: '38m', text: 'reposted your note about PoW', unread: true },
	{ id: 'n4', type: 'follow', actors: [{ name: 'Mining Mike', npub: 'npub1mike…r3t6', picture: pic('mike23') }], count: 1, time: '1h', text: 'started following you', unread: true },
	{ id: 'n5', type: 'mention', actors: [{ name: 'Decentral Doris', npub: 'npub1doris…m5k9', picture: pic('doris42'), verified: true }], count: 1, time: '2h', text: 'mentioned you in a note', unread: true, preview: "Couldn't agree more with @volt on the relay decentralization point. Self-hosting…" },
	{ id: 'n6', type: 'zap', actors: [{ name: 'Hash Function Hannah', npub: 'npub1hannah…n8w4', picture: pic('hannah11') }], count: 1, time: '4h', text: 'zapped you 21 sats', amount: 21, unread: false },
	{ id: 'n7', type: 'like', actors: [{ name: 'Open Source Dev', npub: 'npub1dev…x4m8', picture: pic('dev88') }], count: 1, time: '6h', text: 'liked your reply', unread: false },
	{ id: 'n8', type: 'follow', actors: [{ name: "Satoshi's Ghost", npub: 'npub1satoshi…m8jx', picture: pic('ghost42'), verified: true }, { name: 'Lightning Liz', npub: 'npub1liz…k2p9', picture: pic('liz77') }], count: 3, time: '12h', text: 'and 4 others started following you', unread: false }
];

export const conversations: Conversation[] = [
	{ id: 'c1', name: "Satoshi's Ghost", npub: 'npub1satoshi…m8jx', picture: pic('ghost42'), verified: true, last: "Count me in. I'll bring the ledger.", time: '2m', unread: 2 },
	{ id: 'c2', name: 'Lightning Liz', npub: 'npub1liz…k2p9', picture: pic('liz77'), last: 'Sent you the invoice ✅', time: '1h', unread: 0 },
	{ id: 'c3', name: 'Relay Runner', npub: 'npub1relay…q7m3', picture: pic('relay55'), verified: true, last: 'My relay hit 18k events today 🎉', time: '3h', unread: 1 },
	{ id: 'c4', name: 'Cypherpunk Revival', npub: 'npub1cypher…p9r2', picture: pic('cyph88'), verified: true, last: 'Did you see the new NIP-40 draft?', time: '8h', unread: 0 },
	{ id: 'c5', name: 'Decentral Doris', npub: 'npub1doris…m5k9', picture: pic('doris42'), verified: true, last: 'Thanks for the zap! ⚡', time: '1d', unread: 0 },
	{ id: 'c6', name: 'Mining Mike', npub: 'npub1mike…r3t6', picture: pic('mike23'), last: '32 bits took 4 minutes lol', time: '2d', unread: 0 }
];

export const chatMessages: ChatMessage[] = [
	{ id: 'm1', mine: false, text: 'Hey — did you see the new NIP-44 spec? Way faster than 04.' },
	{ id: 'm2', mine: false, text: 'Also, zapping you 1000 sats for the great work on the relay 🫡' },
	{ id: 'm3', mine: true, text: 'Thank you! And yes, the diff is huge. We are seeing 40% throughput improvement on encrypted events.' },
	{ id: 'm4', mine: true, text: 'btw — running a small relay meetup in Berlin next month. You in?' },
	{ id: 'm5', mine: false, text: "Count me in. I'll bring the ledger." }
];

export const zapHistory: Zap[] = [
	{ id: 'z1', type: 'received', amount: 1000, name: "Satoshi's Ghost", npub: 'npub1satoshi…m8jx', picture: pic('ghost42'), memo: 'For the great work on the relay', time: '2m', txid: 'lnbc1…8jx2' },
	{ id: 'z2', type: 'sent', amount: 100, name: 'Lightning Liz', npub: 'npub1liz…k2p9', picture: pic('liz77'), memo: 'Great coffee tip!', time: '1h', txid: 'lnbc1…k2p9' },
	{ id: 'z3', type: 'received', amount: 21, name: 'Hash Function Hannah', npub: 'npub1hannah…n8w4', picture: pic('hannah11'), time: '4h', txid: 'lnbc1…n8w4' },
	{ id: 'z4', type: 'sent', amount: 500, name: 'Relay Runner', npub: 'npub1relay…q7m3', picture: pic('relay55'), memo: 'For the relay hosting guide', time: '8h', txid: 'lnbc1…q7m3' },
	{ id: 'z5', type: 'received', amount: 500, name: 'Mining Mike', npub: 'npub1mike…r3t6', picture: pic('mike23'), memo: 'Inspired by your PoW notes', time: '1d', txid: 'lnbc1…r3t6' },
	{ id: 'z6', type: 'received', amount: 100, name: 'Cypherpunk Revival', npub: 'npub1cypher…p9r2', picture: pic('cyph88'), memo: 'NIP-44 explainer was gold', time: '2d', txid: 'lnbc1…p9r2' }
];

export const people: Person[] = [
	{ name: "Satoshi's Ghost", npub: 'npub1satoshi…m8jx', picture: pic('ghost42'), verified: true, bio: 'Building on Bitcoin since 2009. Encrypted everything.', followers: '12.4k', mutuals: 8 },
	{ name: 'Lightning Liz', npub: 'npub1liz…k2p9', picture: pic('liz77'), bio: 'Lightning network educator. Zapping sats daily.', followers: '8.9k', mutuals: 12 },
	{ name: 'Relay Runner', npub: 'npub1relay…q7m3', picture: pic('relay55'), verified: true, bio: 'Operating relays since 2022. Self-hosting advocate.', followers: '5.2k', mutuals: 4 },
	{ name: 'Cypherpunk Revival', npub: 'npub1cypher…p9r2', picture: pic('cyph88'), verified: true, bio: 'Privacy maximalist. Encrypted by default.', followers: '15.1k', mutuals: 6 }
];

/** Notification type → icon + tone metadata. */
export const notifMeta: Record<NotifType, { icon: string; tone: 'accent' | 'warm' | 'success' | 'info' | 'neutral' }> = {
	zap: { icon: 'i-lucide-zap', tone: 'accent' },
	like: { icon: 'i-lucide-heart', tone: 'warm' },
	repost: { icon: 'i-lucide-repeat-2', tone: 'success' },
	follow: { icon: 'i-lucide-user-plus', tone: 'info' },
	mention: { icon: 'i-lucide-at-sign', tone: 'neutral' }
};
