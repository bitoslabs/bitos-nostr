/**
 * Settings sections.
 * - `tint`: iOS-style saturated color used for the mobile index icon tiles.
 * - `group`: controls how rows are clustered in the iOS mobile index.
 *     • hero        → rendered as the large profile row (Account)
 *     • preferences → Privacy / Notifications / Appearance
 *     • content     → Security / Media / Language
 *     • support     → Help / About
 */
export const settingsSections = [
	{ key: 'account', label: 'Account', icon: 'i-lucide-user', tint: '#2F95F6', group: 'hero' },
	{ key: 'privacy', label: 'Privacy', icon: 'i-lucide-lock', tint: '#5856D6', group: 'preferences' },
	{ key: 'notifications', label: 'Notifications', icon: 'i-lucide-bell', tint: '#FF3B30', group: 'preferences' },
	{ key: 'appearance', label: 'Appearance', icon: 'i-lucide-palette', tint: '#FF2D92', group: 'preferences' },
	{ key: 'algorithm', label: 'Algorithm', icon: 'i-lucide-wand-sparkles', tint: '#BF5AF2', group: 'preferences' },
	{ key: 'security', label: 'Security & Relay', icon: 'i-lucide-shield-check', tint: '#FF9500', group: 'content' },
	{ key: 'media', label: 'Media & Uploads', icon: 'i-lucide-cloud-upload', tint: '#34C759', group: 'content' },
	{ key: 'language', label: 'Language & Region', icon: 'i-lucide-languages', tint: '#5AC8FA', group: 'content' },
	{ key: 'help', label: 'Help & Support', icon: 'i-lucide-circle-help', tint: '#32ADE6', group: 'support' },
	{ key: 'about', label: 'About', icon: 'i-lucide-info', tint: '#8E8E93', group: 'support' }
] as const;

export type SettingsSectionKey = (typeof settingsSections)[number]['key'];

export function isSettingsSectionKey(value: string | undefined): value is SettingsSectionKey {
	return settingsSections.some((section) => section.key === value);
}

/** Ordered group definitions for the iOS mobile settings index. */
export const settingsGroupOrder: { id: string; label: string }[] = [
	{ id: 'preferences', label: '' },
	{ id: 'content', label: '' },
	{ id: 'support', label: 'Support' }
];

/** Build the grouped structure used by the mobile index. */
export function mobileSettingsGroups() {
	return settingsGroupOrder.map((g) => ({
		...g,
		items: settingsSections.filter((s) => s.group === g.id)
	}));
}
