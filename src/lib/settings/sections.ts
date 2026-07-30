export const settingsSections = [
	{ key: 'account', label: 'Account', icon: 'i-lucide-user' },
	{ key: 'privacy', label: 'Privacy', icon: 'i-lucide-lock' },
	{ key: 'notifications', label: 'Notifications', icon: 'i-lucide-bell' },
	{ key: 'appearance', label: 'Appearance', icon: 'i-lucide-palette' },
	{ key: 'security', label: 'Security', icon: 'i-lucide-shield-check' },
	{ key: 'media', label: 'Media & Uploads', icon: 'i-lucide-cloud-upload' },
	{ key: 'language', label: 'Language & Region', icon: 'i-lucide-languages' },
	{ key: 'help', label: 'Help & Support', icon: 'i-lucide-circle-help' },
	{ key: 'about', label: 'About', icon: 'i-lucide-info' }
] as const;

export type SettingsSectionKey = (typeof settingsSections)[number]['key'];

export function isSettingsSectionKey(value: string | undefined): value is SettingsSectionKey {
	return settingsSections.some((section) => section.key === value);
}
