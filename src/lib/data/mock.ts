/**
 * Demo content for the Pulse views, mirroring docs/ex-ui.html. Feed posts and
 * DMs are augmented with live Nostr data at runtime; these provide the rich
 * chrome (stories, trending, suggested, reels, discover, profile) that Nostr
 * doesn't natively model yet.
 */

export interface DemoPerson {
	initials: string;
	name: string;
	handle?: string;
	role?: string;
	color: 'primary' | 'accent' | 'warm' | 'ink';
}

export interface Story {
	id: string;
	person: DemoPerson;
	viewed: boolean;
}

export const stories: Story[] = [
	{ id: 's1', person: { initials: 'SC', name: 'Sarah', color: 'primary' }, viewed: false },
	{ id: 's2', person: { initials: 'MD', name: 'Mark', color: 'accent' }, viewed: false },
	{ id: 's3', person: { initials: 'EW', name: 'Emma', color: 'warm' }, viewed: false },
	{ id: 's4', person: { initials: 'JC', name: 'John', color: 'primary' }, viewed: true },
	{ id: 's5', person: { initials: 'OC', name: 'Olivia', color: 'accent' }, viewed: false },
	{ id: 's6', person: { initials: 'SL', name: 'Sophia', color: 'warm' }, viewed: false },
	{ id: 's7', person: { initials: 'AM', name: 'Alex', color: 'accent' }, viewed: true }
];

export interface Trending {
	rank: string;
	category: string;
	tag: string;
	posts: string;
	dir: 'up' | 'hot';
}

export const trending: Trending[] = [
	{ rank: '#1', category: 'Design', tag: '#DesignSystem', posts: '12.4K posts', dir: 'up' },
	{ rank: '#2', category: 'Tech', tag: '#WebDev', posts: '8.9K posts', dir: 'up' },
	{ rank: '#3', category: 'Lifestyle', tag: '#MorningRoutine', posts: '5.2K posts', dir: 'hot' }
];

export interface Suggested {
	initials: string;
	name: string;
	note: string;
	color: 'primary' | 'accent' | 'warm';
}

export const suggested: Suggested[] = [
	{ initials: 'SL', name: 'Sophia Lee', note: 'Followed by Mark + 3', color: 'primary' },
	{ initials: 'RK', name: 'Ryan Kim', note: 'Designer at Figma', color: 'accent' },
	{ initials: 'NB', name: 'Nina Brooks', note: '3.2M followers', color: 'warm' }
];

export interface TrendTag {
	icon?: string;
	tag: string;
	count: string;
}

export const trendTags: TrendTag[] = [
	{ icon: 'i-lucide-flame', tag: '#DesignSystem', count: '12.4K' },
	{ icon: 'i-lucide-trending-up', tag: '#WebDev', count: '8.9K' },
	{ tag: '#MorningRoutine', count: '5.2K' },
	{ tag: '#UIInspo', count: '4.7K' },
	{ tag: '#TravelDiary', count: '3.8K' },
	{ tag: '#Productivity', count: '3.1K' },
	{ tag: '#CoffeeArt', count: '2.4K' },
	{ tag: '#SideProject', count: '1.9K' }
];

export interface TopCreator {
	initials: string;
	name: string;
	role: string;
	followers: string;
	color: 'primary' | 'accent' | 'warm';
}

export const topCreators: TopCreator[] = [
	{ initials: 'SC', name: 'Sarah Chen', role: 'Designer', followers: '124K', color: 'primary' },
	{ initials: 'MD', name: 'Mark Davis', role: 'Engineer', followers: '89K', color: 'accent' },
	{ initials: 'EW', name: 'Emma Wilson', role: 'Traveler', followers: '412K', color: 'warm' },
	{ initials: 'JC', name: 'John Carter', role: 'Creator', followers: '67K', color: 'primary' }
];

/** Masonry explore tiles — seed + kind badge. */
export const exploreTiles = [
	{ seed: 'exp1', badge: null },
	{ seed: 'exp2', badge: 'REEL' },
	{ seed: 'exp3', badge: null },
	{ seed: 'exp4', badge: null },
	{ seed: 'exp5', badge: 'PHOTO' },
	{ seed: 'exp6', badge: null },
	{ seed: 'exp7', badge: null },
	{ seed: 'exp8', badge: 'VIDEO' },
	{ seed: 'exp9', badge: null },
	{ seed: 'exp10', badge: null },
	{ seed: 'exp11', badge: null },
	{ seed: 'exp12', badge: null }
];

export interface Reel {
	id: string;
	seed: string;
	avatarSeed: string;
	initials: string;
	handle: string;
	role: string;
	caption: string;
	audio: string;
	likes: string;
	comments: string;
	color: 'primary' | 'accent' | 'warm';
	liked?: boolean;
}

export const reels: Reel[] = [
	{
		id: 'r1',
		seed: 'reel1',
		avatarSeed: 'reel1',
		initials: 'SC',
		handle: '@sarahchen',
		role: 'Product Designer',
		caption: 'When the design finally clicks after 47 iterations 😂✨ Worth every second',
		audio: 'Original audio · Sarah Chen',
		likes: '12.4K',
		comments: '847',
		color: 'primary'
	},
	{
		id: 'r2',
		seed: 'reel2',
		avatarSeed: 'reel2',
		initials: 'MD',
		handle: '@markbuilds',
		role: 'Engineer · Creator',
		caption: 'POV: shipping to production on a Friday 🚀💀 What could go wrong?',
		audio: 'Trending · "Ocean Drive"',
		likes: '89.2K',
		comments: '2.1K',
		color: 'accent'
	},
	{
		id: 'r3',
		seed: 'reel3',
		avatarSeed: 'reel3',
		initials: 'EW',
		handle: '@emmawanders',
		role: 'Travel · Photography',
		caption: "Sunrise in Bali hits different 🌅 Tag someone you'd bring here",
		audio: '"Golden Hour" · JVKE',
		likes: '5.7K',
		comments: '423',
		color: 'warm'
	}
];

export const profileStats = { posts: '348', followers: '12.4K', following: '892' };

export const highlights = [
	{ emoji: '🎨', label: 'Work' },
	{ emoji: '✈️', label: 'Travel' },
	{ emoji: '☕', label: 'Coffee' },
	{ emoji: '🎵', label: 'Music' }
];

export const profilePosts = [
	{ seed: 'p1', likes: '248', comments: '18', badge: null },
	{ seed: 'p2', likes: null, comments: null, badge: 'REEL' },
	{ seed: 'p3', likes: null, comments: null, badge: null },
	{ seed: 'p4', likes: null, comments: null, badge: null },
	{ seed: 'p5', likes: null, comments: null, badge: 'VIDEO' },
	{ seed: 'p6', likes: null, comments: null, badge: null },
	{ seed: 'p7', likes: null, comments: null, badge: null },
	{ seed: 'p8', likes: null, comments: null, badge: null },
	{ seed: 'p9', likes: null, comments: null, badge: 'REEL' }
];

/** Picsum helper so we never hardcode big URLs. */
export const pic = (seed: string, w = 400, h = 400) =>
	`https://picsum.photos/seed/${seed}/${w}/${h}.jpg`;
