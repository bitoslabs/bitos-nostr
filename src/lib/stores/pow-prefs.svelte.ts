import { browser } from '$app/environment';

/**
 * Proof-of-Work preferences, persisted to localStorage.
 *
 * The last difficulty the user actually published with becomes the starting
 * point for every composer (post, reply, …) so the slider does not have to be
 * re-set each time. Reactions stay instant (difficulty 0) unless a relay
 * mandates more via NIP-11 `min_pow_difficulty`.
 */
export const POW_PREFS_KEY = 'bitos:pow-prefs';

export interface PowPrefsState {
	/** Difficulty (leading zero bits) of the last successfully published mined event. */
	lastDifficulty: number;
	/** Whether PoW controls are initially visible in composers. Always false on reload. */
	showPanelByDefault: boolean;
	/** Hashrate (H/s) measured while mining on this device — powers the PoW
	 * panel's time estimates. 0 = never mined here (panel falls back to a
	 * typical browser-worker rate). */
	lastHashrate: number;
}

export const POW_PREFS_DEFAULTS: PowPrefsState = {
	lastDifficulty: 0,
	showPanelByDefault: false,
	lastHashrate: 0
};

const clamp = (bits: number) => Math.min(32, Math.max(0, Math.round(bits)));

class PowPrefsStore {
	state = $state<PowPrefsState>({ ...POW_PREFS_DEFAULTS });

	constructor() {
		this.load();
	}

	load = () => {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(POW_PREFS_KEY);
			if (raw) {
				const parsed = JSON.parse(raw) as Partial<PowPrefsState>;
				this.state = {
					lastDifficulty: clamp(Number(parsed.lastDifficulty ?? 0)),
					// PoW is opt-in for each new composer. Ignore an older saved value so
					// a panel left open in a previous post never reopens after refresh.
					showPanelByDefault: false,
					lastHashrate: Math.max(0, Number(parsed.lastHashrate ?? 0)) || 0
				};
			}
		} catch {
			/* ignore malformed storage */
		}
	};

	private persist = () => {
		if (!browser) return;
		try {
			localStorage.setItem(POW_PREFS_KEY, JSON.stringify(this.state));
		} catch {
			/* storage full / private mode — prefs stay in-memory */
		}
	};

	/** Remember the difficulty of a successful publish (0 = PoW off). */
	remember = (difficulty: number) => {
		this.state = { ...this.state, lastDifficulty: clamp(difficulty) };
		this.persist();
	};

	/** Live hashrate during a mining run — updates in-memory state only
	 * (fires ~7×/s from the worker) so localStorage stays quiet. */
	noteHashrate = (rate: number) => {
		if (!Number.isFinite(rate) || rate <= 0) return;
		// Ignore small jitter so dependent UI does not re-render every tick.
		if (Math.abs(rate - this.state.lastHashrate) / rate < 0.05) return;
		this.state = { ...this.state, lastHashrate: rate };
	};

	/** Persist the final measured hashrate once a run settles (published or
	 * cancelled) — calibrates future time estimates for this device. */
	rememberHashrate = (rate: number) => {
		if (!Number.isFinite(rate) || rate <= 0) return;
		this.state = { ...this.state, lastHashrate: rate };
		this.persist();
	};

	rememberPanelVisibility = (_visible: boolean) => {
		void _visible;
		// Keep the persisted value false too, including for existing preferences.
		this.state = { ...this.state, showPanelByDefault: false };
		this.persist();
	};
}

export const powPrefs = new PowPrefsStore();
