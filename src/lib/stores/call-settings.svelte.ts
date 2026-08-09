import { browser } from '$app/environment';

/**
 * User preferences for the calling experience. Persisted to localStorage so
 * the ringtone mute / shortcuts hints survive reloads and account switches.
 */
export interface CallSettingsState {
	/** Play an incoming-call ringtone and connection cues. */
	sounds: boolean;
	/** Show the keyboard-shortcut hint the first time a call opens. */
	shortcutsHint: boolean;
}

export const CALL_SETTINGS_KEY = 'bitos:call-settings';

export const CALL_SETTINGS_DEFAULTS: CallSettingsState = {
	sounds: true,
	shortcutsHint: true
};

class CallSettingsStore {
	state = $state<CallSettingsState>({ ...CALL_SETTINGS_DEFAULTS });

	constructor() {
		this.load();
	}

	load = () => {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(CALL_SETTINGS_KEY);
			if (raw) this.state = { ...CALL_SETTINGS_DEFAULTS, ...JSON.parse(raw) };
		} catch {
			/* ignore malformed storage */
		}
	};

	private persist = () => {
		if (!browser) return;
		try {
			localStorage.setItem(CALL_SETTINGS_KEY, JSON.stringify(this.state));
		} catch {
			/* storage may be unavailable in private mode */
		}
	};

	toggleSounds = () => {
		this.state.sounds = !this.state.sounds;
		this.persist();
	};

	dismissShortcutsHint = () => {
		this.state.shortcutsHint = false;
		this.persist();
	};
}

export const callSettings = new CallSettingsStore();
