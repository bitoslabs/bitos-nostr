import { browser } from '$app/environment';

const EXACT_KEYS = [
	'bitos:bookmarked-notes',
	'bitos:saved-notes',
	'bitos:discover-cache:v8',
	'bitos:discover-search-cache:v8',
	'bitos:discover-cache:v7',
	'bitos:discover-search-cache:v7',
	'bitos:discover-cache:v1',
	'bitos:reels-cache:v1',
	'bitos:trending-rail-cache',
	'bitos:trending-tags:v1',
	'bitos:trending-tags:v2',
	'bitos:trending-tags:v3',
	'bitos:seen-stories',
	'bitos:algorithm-preferences',
	'bitos:algorithm-interaction-profile',
	'bitos:prefs',
	'bitos:privacy-notification-settings',
	'bitos:media-settings',
	'bitos:blocked-pubkeys',
	'bitos:relays',
	'bitos:feed-preferences',
	'bitos:call-settings'
];

const PREFIXES = [
	'bitos:dm-conversations:',
	'bitos:message-groups:',
	'bitos:groups:',
	'bitos:group-controls:',
	'bitos:processed-group-controls:'
];

export function clearAccountCaches() {
	if (!browser) return;
	for (const key of EXACT_KEYS) localStorage.removeItem(key);
	for (const key of Object.keys(localStorage)) {
		if (PREFIXES.some((prefix) => key.startsWith(prefix))) localStorage.removeItem(key);
	}
}
