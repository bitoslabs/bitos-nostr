import { browser } from '$app/environment';
import { nip04 } from 'nostr-tools';
import { finalizeEvent } from 'nostr-tools/pure';
import { identity } from '$lib/nostr/identity.svelte';
import { publish, queryOnce } from '$lib/nostr/pool';
import { relays, STORAGE_KEY as RELAYS_KEY } from '$lib/nostr/relays.svelte';
import type { RelayRecord } from '$lib/nostr/types';
import { hexToBytes } from '$lib/nostr/hex';
import {
	preferences,
	STORAGE_KEY as PREFS_KEY,
	type Preferences
} from '$lib/theme/preferences.svelte';
import { media, STORAGE_KEY as MEDIA_KEY } from '$lib/stores/media.svelte';
import type { MediaSettings } from '$lib/media/uploaders';
import {
	privacyNotificationSettings,
	STORAGE_KEY as PRIVACY_NOTIFICATIONS_KEY,
	type PrivacyNotificationSettingsState
} from '$lib/stores/privacy-notification-settings.svelte';
import { blocks, STORAGE_KEY as BLOCKS_KEY } from '$lib/stores/blocks.svelte';

const APP_DATA_KIND = 30078;
const SETTINGS_D_TAG = 'bitos-settings-v1';

function plainClone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

export interface SettingsBackup {
	version: 1;
	updatedAt: number;
	appearance: Preferences;
	privacyNotifications: PrivacyNotificationSettingsState;
	media: MediaSettings;
	relays: RelayRecord[];
	blockedPubkeys: string[];
}

class SettingsSyncStore {
	syncing = $state(false);
	restoring = $state(false);
	lastSyncedAt = $state<number | null>(null);
	lastRemoteAt = $state<number | null>(null);

	private buildBackup(): SettingsBackup {
		return {
			version: 1,
			updatedAt: Math.floor(Date.now() / 1000),
			appearance: plainClone(preferences.state),
			privacyNotifications: plainClone(privacyNotificationSettings.state),
			media: plainClone(media.state),
			relays: plainClone(relays.list),
			blockedPubkeys: [...blocks.blocked]
		};
	}

	private async encryptForSelf(plaintext: string) {
		const me = identity.current;
		if (!me) throw new Error('Log in before syncing settings');
		return nip04.encrypt(me.sk, me.pk, plaintext);
	}

	private async decryptFromSelf(ciphertext: string) {
		const me = identity.current;
		if (!me) throw new Error('Log in before restoring settings');
		return nip04.decrypt(me.sk, me.pk, ciphertext);
	}

	async publishBackup() {
		if (!browser) return;
		const me = identity.current;
		if (!me) throw new Error('Log in before syncing settings');
		this.syncing = true;
		try {
			const backup = this.buildBackup();
			const encrypted = await this.encryptForSelf(JSON.stringify(backup));
			const event = finalizeEvent(
				{
					kind: APP_DATA_KIND,
					content: encrypted,
					created_at: backup.updatedAt,
					tags: [
						['d', SETTINGS_D_TAG],
						['client', 'BitOS'],
						['encrypted', 'nip04']
					]
				},
				hexToBytes(me.sk)
			);
			await publish(event);
			this.lastSyncedAt = backup.updatedAt;
			this.lastRemoteAt = backup.updatedAt;
		} finally {
			this.syncing = false;
		}
	}

	async fetchLatestBackup(): Promise<SettingsBackup | null> {
		if (!browser) return null;
		const me = identity.current;
		if (!me) throw new Error('Log in before restoring settings');
		const events = await queryOnce([
			{
				kinds: [APP_DATA_KIND],
				authors: [me.pk],
				'#d': [SETTINGS_D_TAG],
				limit: 10
			}
		]);
		const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
		if (!latest) return null;
		const plaintext = await this.decryptFromSelf(latest.content);
		const parsed = JSON.parse(plaintext) as SettingsBackup;
		if (parsed.version !== 1) throw new Error('Unsupported settings backup version');
		this.lastRemoteAt = parsed.updatedAt || latest.created_at;
		return parsed;
	}

	async restoreLatestBackup() {
		if (!browser) return null;
		this.restoring = true;
		try {
			const backup = await this.fetchLatestBackup();
			if (!backup) return null;
			localStorage.setItem(PREFS_KEY, JSON.stringify(backup.appearance));
			localStorage.setItem(PRIVACY_NOTIFICATIONS_KEY, JSON.stringify(backup.privacyNotifications));
			localStorage.setItem(MEDIA_KEY, JSON.stringify(backup.media));
			localStorage.setItem(RELAYS_KEY, JSON.stringify(backup.relays));
			localStorage.setItem(BLOCKS_KEY, JSON.stringify(backup.blockedPubkeys));
			preferences.load();
			preferences.apply();
			privacyNotificationSettings.load();
			media.load();
			relays.load();
			blocks.load();
			this.lastRemoteAt = backup.updatedAt;
			return backup;
		} finally {
			this.restoring = false;
		}
	}
}

export const settingsSync = new SettingsSyncStore();
