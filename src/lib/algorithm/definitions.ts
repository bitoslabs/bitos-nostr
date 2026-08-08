import type { SignalDefinition } from './types';

/**
 * Canonical signal catalog. Order matters — it's the order shown in the UI.
 */
export const SIGNAL_DEFINITIONS: SignalDefinition[] = [
	{
		id: 'recency',
		label: 'Recency',
		description: 'Favor newer notes. Time-decays so fresh posts win at first.',
		icon: 'i-lucide-clock'
	},
	{
		id: 'engagement',
		label: 'Engagement',
		description: 'Reactions, reposts & replies — how much a note is catching on.',
		icon: 'i-lucide-flame'
	},
	{
		id: 'zaps',
		label: 'Zaps',
		description: 'Weight by sats received. Real money is a strong quality signal.',
		icon: 'i-lucide-zap'
	},
	{
		id: 'affinity',
		label: 'Affinity',
		description: 'How often you usually interact with this author.',
		icon: 'i-lucide-heart-handshake'
	},
	{
		id: 'topics',
		label: 'Topics',
		description: 'Boost #hashtags you engage with most.',
		icon: 'i-lucide-hash'
	},
	{
		id: 'wot',
		label: 'Web of trust',
		description: 'Distance from your follow graph. A quality gate, not popularity.',
		icon: 'i-lucide-shield-check'
	}
];

export const SIGNAL_BY_ID: Record<string, SignalDefinition> = Object.fromEntries(
	SIGNAL_DEFINITIONS.map((definition) => [definition.id, definition])
);
