import { browser } from '$app/environment';
import { notifications } from '$lib/nostr/notifications.svelte';
import { contacts } from '$lib/nostr/contacts.svelte';
import { identity } from '$lib/nostr/identity.svelte';
import type { NotificationType } from '$lib/nostr/types';

export interface PrivacyNotificationSettingsState {
	privateAcc: boolean;
	includeClientTag: boolean;
	activity: boolean;
	readReceipts: boolean;
	storyShare: boolean;
	messagePermission: 'followers' | 'everyone' | 'none';
	commentPermission: 'everyone' | 'followers' | 'friends';
	likes: boolean;
	comments: boolean;
	followers: boolean;
	dms: boolean;
	mentions: boolean;
}

type BooleanSettingKey = {
	[K in keyof PrivacyNotificationSettingsState]: PrivacyNotificationSettingsState[K] extends boolean
		? K
		: never;
}[keyof PrivacyNotificationSettingsState];

export const STORAGE_KEY = 'bitos:privacy-notification-settings';

export const DEFAULTS: PrivacyNotificationSettingsState = {
	privateAcc: false,
	includeClientTag: true,
	activity: true,
	readReceipts: true,
	storyShare: true,
	messagePermission: 'everyone',
	commentPermission: 'everyone',
	likes: true,
	comments: true,
	followers: true,
	dms: true,
	mentions: true
};

const NOTIFICATION_TYPE_BY_KEY: Partial<
	Record<keyof PrivacyNotificationSettingsState, NotificationType>
> = {
	likes: 'like',
	comments: 'comment',
	followers: 'follow',
	mentions: 'mention'
};

class PrivacyNotificationSettingsStore {
	state = $state<PrivacyNotificationSettingsState>({ ...DEFAULTS });

	load = () => {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) this.state = { ...DEFAULTS, ...JSON.parse(raw) };
		} catch {
			/* ignore malformed storage */
		}
		if (!['followers', 'everyone', 'none'].includes(this.state.messagePermission)) {
			this.state.messagePermission = DEFAULTS.messagePermission;
		}
		if (!['everyone', 'followers', 'friends'].includes(this.state.commentPermission)) {
			this.state.commentPermission = DEFAULTS.commentPermission;
		}
		this.syncNotificationMutes();
	};

	reload = () => {
		this.state = { ...DEFAULTS };
		this.load();
	};

	private persist = () => {
		if (!browser) return;
		localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
	};

	private syncNotificationMutes = () => {
		for (const [key, type] of Object.entries(NOTIFICATION_TYPE_BY_KEY) as [
			keyof PrivacyNotificationSettingsState,
			NotificationType | undefined
		][]) {
			if (!type) continue;
			notifications.setMuted(type, !this.state[key]);
		}
	};

	toggle = (key: BooleanSettingKey) => {
		this.state[key] = !this.state[key];
		this.persist();
		const type = NOTIFICATION_TYPE_BY_KEY[key];
		if (type) notifications.setMuted(type, !this.state[key]);
	};

	setMessagePermission = (value: PrivacyNotificationSettingsState['messagePermission']) => {
		this.state.messagePermission = value;
		this.persist();
	};

	setCommentPermission = (value: PrivacyNotificationSettingsState['commentPermission']) => {
		this.state.commentPermission = value;
		this.persist();
	};

	canReceiveDmFrom(pubkey: string) {
		const me = identity.current?.pk;
		if (!me || pubkey === me) return true;
		if (this.state.messagePermission === 'everyone') return true;
		if (this.state.messagePermission === 'none') return false;
		return contacts.isFollowing(pubkey);
	}

	canCommentOn(pubkey: string) {
		const me = identity.current?.pk;
		if (!me || pubkey === me) return true;
		if (this.state.commentPermission === 'everyone') return true;
		return contacts.isFollowing(pubkey);
	}
}

export const privacyNotificationSettings = new PrivacyNotificationSettingsStore();
