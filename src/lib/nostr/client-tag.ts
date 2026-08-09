import { privacyNotificationSettings } from '$lib/stores/privacy-notification-settings.svelte';

/**
 * Optional NIP-89 client attribution for public events.
 *
 * Keep this in one place so every public publishing path uses the same value
 * and the user can opt out before signing an event.
 */
export function clientTag(): string[][] {
	return privacyNotificationSettings.state.includeClientTag ? [['client', 'BitOS']] : [];
}
