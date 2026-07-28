/** Demo chat content mirroring docs/ex-ui.html (Design Chat group). Real
 *  Nostr DMs are merged into the list at runtime. */

export interface ChatListItem {
	id: string;
	name: string;
	initials: string;
	color: 'primary' | 'accent' | 'warm' | 'ink';
	group?: boolean;
	preview: string;
	previewPrefix?: string; // e.g. "Sarah:" or "You:"
	time: string;
	unread?: number;
	online?: boolean;
	away?: boolean;
	voice?: string; // "0:14"
	photo?: boolean;
	demo?: boolean;
}

export const demoChats: ChatListItem[] = [
	{
		id: 'demo-design',
		name: 'Design Chat',
		initials: 'DC',
		color: 'primary',
		group: true,
		preview: 'Ready for review?',
		previewPrefix: 'Sarah:',
		time: '9:42',
		unread: 3,
		online: true,
		demo: true
	},
	{
		id: 'demo-alex',
		name: 'Alex Morgan',
		initials: 'AM',
		color: 'accent',
		preview: 'Voice · 0:14',
		voice: '0:14',
		time: '9:30',
		unread: 1,
		online: true,
		demo: true
	},
	{
		id: 'demo-product',
		name: 'Product Team',
		initials: 'PT',
		color: 'warm',
		group: true,
		preview: 'can you review the PR?',
		previewPrefix: '@John',
		time: '9:15',
		demo: true
	},
	{
		id: 'demo-emma',
		name: 'Emma Wilson',
		initials: 'EW',
		color: 'warm',
		preview: 'Photo',
		photo: true,
		time: '8:50',
		online: true,
		demo: true
	},
	{
		id: 'demo-frontend',
		name: 'Frontend Squad',
		initials: 'FS',
		color: 'ink',
		group: true,
		preview: 'Deploying to staging 🚀',
		previewPrefix: 'Mark:',
		time: '8:42',
		demo: true
	},
	{
		id: 'demo-olivia',
		name: 'Olivia Chen',
		initials: 'OC',
		color: 'accent',
		preview: "Let's catch up tomorrow!",
		time: 'Yesterday',
		unread: 2,
		away: true,
		demo: true
	}
];

export type ChatMessage =
	| {
			id: string;
			mine?: boolean;
			author?: string;
			initials?: string;
			color?: 'primary' | 'accent' | 'warm' | 'ink';
			time: string;
			text: string;
			reaction?: string;
	  }
	| {
			id: string;
			mine?: boolean;
			author?: string;
			initials?: string;
			color?: 'primary' | 'accent' | 'warm' | 'ink';
			time: string;
			image: string;
			caption?: string;
			reaction?: string;
	  }
	| {
			id: string;
			mine?: boolean;
			author?: string;
			initials?: string;
			color?: 'primary' | 'accent' | 'warm' | 'ink';
			time: string;
			voice: string;
	  };

/** Wave bar heights for the voice message (matching ex-ui). */
export const voiceBars = [40, 70, 90, 50, 80, 60, 100, 45, 75, 55, 85, 65, 40, 70, 95, 50].map(
	(h, i) => ({ height: h, delay: `${(i * 0.1).toFixed(1)}s` })
);

export const demoDesignThread: ChatMessage[] = [
	{
		id: 'm1',
		author: 'Sarah Chen',
		initials: 'SC',
		color: 'primary',
		time: '9:42 AM',
		text: 'Morning team! ☀️ Ready for the design review at 11?'
	},
	{
		id: 'm2',
		author: 'Mark Davis',
		initials: 'MD',
		color: 'accent',
		time: '9:43 AM',
		image: 'https://picsum.photos/seed/design1/480/300.jpg',
		caption: 'Just pushed the new mockups to Figma. Card redesign is ready 🔥',
		reaction: '🔥 3'
	},
	{ id: 'm3', mine: true, time: '9:45 AM', text: 'These look amazing! Love the new color palette' },
	{
		id: 'm4',
		mine: true,
		time: '9:45 AM',
		text: "The color work is **chef's kiss** 👌"
	},
	{
		id: 'm5',
		author: 'Emma Wilson',
		initials: 'EW',
		color: 'warm',
		time: '9:47 AM',
		voice: '0:24'
	}
];

export const chatMembers = [
	{ initials: 'SC', name: 'Sarah Chen', color: 'primary', role: 'ADMIN', status: 'Online' },
	{ initials: 'MD', name: 'Mark Davis', color: 'accent', role: '', status: 'Active now' },
	{ initials: 'EW', name: 'Emma Wilson', color: 'warm', role: '', status: 'Active now' },
	{ initials: 'JC', name: 'John Carter', color: 'primary', role: '', status: 'Last seen 5m ago' }
];

export const chatMedia = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];

export const chatFiles = [
	{
		icon: 'i-lucide-file-image',
		color: 'text-primary-500',
		name: 'Design_System_v2.fig',
		size: '4.2 MB · 2 hours ago'
	},
	{
		icon: 'i-lucide-file-text',
		color: 'text-accent-500',
		name: 'User_Research.pdf',
		size: '1.8 MB · Yesterday'
	}
];

export const colorBg: Record<string, string> = {
	primary: 'bg-primary-500',
	accent: 'bg-accent-500',
	warm: 'bg-warm-500',
	ink: 'bg-ink'
};
