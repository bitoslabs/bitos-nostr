import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (key: string) => memory.get(key) ?? null,
	setItem: (key: string, value: string) => void memory.set(key, value),
	removeItem: (key: string) => void memory.delete(key)
});

const { powPrefs, POW_PREFS_KEY } = await import('./pow-prefs.svelte');

describe('powPrefs hashrate calibration', () => {
	beforeEach(() => {
		memory.clear();
		localStorage.removeItem(POW_PREFS_KEY);
		powPrefs.load();
	});

	it('starts uncalibrated with no stored hashrate', () => {
		expect(powPrefs.state.lastHashrate).toBe(0);
		expect(powPrefs.state.lastDifficulty).toBe(0);
	});

	it('noteHashrate updates state in memory without persisting', () => {
		powPrefs.noteHashrate(600_000);
		expect(powPrefs.state.lastHashrate).toBe(600_000);
		expect(memory.get(POW_PREFS_KEY)).toBeUndefined();

		// Jitter (<5% drift) is ignored.
		powPrefs.noteHashrate(605_000);
		expect(powPrefs.state.lastHashrate).toBe(600_000);

		// Invalid rates are ignored.
		powPrefs.noteHashrate(0);
		powPrefs.noteHashrate(Number.NaN);
		expect(powPrefs.state.lastHashrate).toBe(600_000);
	});

	it('rememberHashrate persists and survives reload', () => {
		powPrefs.rememberHashrate(750_000);
		expect(JSON.parse(memory.get(POW_PREFS_KEY)!).lastHashrate).toBe(750_000);

		powPrefs.load();
		expect(powPrefs.state.lastHashrate).toBe(750_000);

		// Invalid rates never clobber a good calibration.
		powPrefs.rememberHashrate(0);
		expect(powPrefs.state.lastHashrate).toBe(750_000);
	});

	it('keeps panel opt-in (showPanelByDefault false) even with legacy storage', () => {
		memory.set(
			POW_PREFS_KEY,
			JSON.stringify({ lastDifficulty: 20, showPanelByDefault: true, lastHashrate: 123 })
		);
		powPrefs.load();
		expect(powPrefs.state.showPanelByDefault).toBe(false);
		expect(powPrefs.state.lastDifficulty).toBe(20);
		expect(powPrefs.state.lastHashrate).toBe(123);
	});
});
