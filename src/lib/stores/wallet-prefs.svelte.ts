/**
 * Wallet / zap preferences — runes-based singleton persisted to localStorage.
 *
 * Owns the default zap amount presets surfaced as quick buttons, plus the zap
 * behaviour toggles (non-zap reactions, anonymous zaps, auto-zap on follow).
 * Shared by the Lightning settings screen, the zap dialog, and the follow
 * flow so the same numbers live in one place.
 */
import { browser } from '$app/environment';

export const STORAGE_KEY = 'bitos:wallet-prefs';

export interface WalletPrefs {
	/** Quick-pick amounts shown on the zap dialog, in sats. */
	amounts: number[];
	/** Selected preset when the dialog opens. */
	defaultAmount: number;
	/** Allow likes/reposts as separate interactions (not only zaps). */
	nonZapReactions: boolean;
	/** Send zaps without revealing your npub. */
	anonymousZaps: boolean;
	/** Send a small zap when you follow someone. */
	autoZapOnFollow: boolean;
	/** Auto-zap amount when following someone (sats). */
	autoZapAmount: number;
}

export const DEFAULTS: WalletPrefs = {
	amounts: [21, 100, 500, 1000],
	defaultAmount: 21,
	nonZapReactions: true,
	anonymousZaps: false,
	autoZapOnFollow: false,
	autoZapAmount: 21
};

/** Keep quick-pick amounts valid and unique for keyed UI lists. */
function normalizeAmounts(value: unknown): number[] {
	if (!Array.isArray(value)) return [...DEFAULTS.amounts];

	const amounts = [
		...new Set(
			value
				.filter((amount): amount is number => typeof amount === 'number' && Number.isFinite(amount))
				.map((amount) => Math.max(1, Math.floor(amount)))
		)
	].slice(0, 6);

	return amounts.length >= 2 ? amounts : [...DEFAULTS.amounts];
}

class WalletPrefsStore {
	state = $state<WalletPrefs>(structuredClone(DEFAULTS));

	load = () => {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) {
				const parsed = JSON.parse(raw) as Partial<WalletPrefs>;
				this.state = { ...structuredClone(DEFAULTS), ...parsed };
				this.state.amounts = normalizeAmounts(this.state.amounts);
				this.persist();
			}
		} catch {
			/* ignore malformed storage */
		}
	};

	private persist = () => {
		if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
	};

	setAmount = (index: number, value: number) => {
		const next = [...this.state.amounts];
		next[index] = Math.max(1, Math.floor(value));
		this.state.amounts = normalizeAmounts(next);
		this.persist();
	};

	addAmount = () => {
		const candidates = [50, 250, 750, 2500, 5000];
		const amount = candidates.find((candidate) => !this.state.amounts.includes(candidate));
		if (amount === undefined) return;
		this.state.amounts = [...this.state.amounts, amount];
		this.persist();
	};

	resetAmounts = () => {
		this.state.amounts = [...DEFAULTS.amounts];
		this.persist();
	};

	removeAmount = (index: number) => {
		if (this.state.amounts.length <= 2) return;
		this.state.amounts = this.state.amounts.filter((_, i) => i !== index);
		this.persist();
	};

	setDefaultAmount = (value: number) => {
		this.state.defaultAmount = Math.max(1, Math.floor(value));
		this.persist();
	};

	toggle = (key: 'nonZapReactions' | 'anonymousZaps' | 'autoZapOnFollow', value?: boolean) => {
		this.state[key] = value ?? !this.state[key];
		this.persist();
	};

	setAutoZapAmount = (value: number) => {
		this.state.autoZapAmount = Math.max(1, Math.floor(value));
		this.persist();
	};

	reset = () => {
		this.state = structuredClone(DEFAULTS);
		this.persist();
	};
}

export const walletPrefs = new WalletPrefsStore();
