/**
 * Appearance preferences — runes-based singleton persisted to localStorage.
 * Color *mode* (light/dark/system) is owned here and reflected onto <html>
 * with a `.dark` class (mode-watcher is kept for its auto-tracking of the
 * `prefers-color-scheme` media query). Accent rewrites `--color-primary-*`;
 * neutral rewrites `--color-neutral-*`; rounded sets shape tokens.
 */
import { browser } from '$app/environment';
import {
	accentScale,
	accentOptions,
	neutralScale,
	neutralOptions,
	type AccentKey,
	type NeutralKey
} from './colors';

export type ColorMode = 'light' | 'dark' | 'system';
export type RoundedMode = 'sharp' | 'soft' | 'round' | 'pillowy';
export type DensityMode = 'normal' | 'compact';

export interface Preferences {
	mode: ColorMode;
	accent: AccentKey;
	neutral: NeutralKey;
	rounded: RoundedMode;
	density: DensityMode;
	/** Global font-size multiplier for accessibility. */
	fontSize: 'sm' | 'md' | 'lg';
	reducedMotion: boolean;
	highContrast: boolean;
}

export const STORAGE_KEY = 'bitos:prefs';
export const DEFAULTS: Preferences = {
	// The showcase design (docs/ui.html) is the dark premium skin, so first
	// run opens in dark. The Appearance picker still switches light/dark/system.
	mode: 'dark',
	accent: 'blue',
	neutral: 'slate',
	rounded: 'round',
	density: 'normal',
	fontSize: 'md',
	reducedMotion: false,
	highContrast: false
};

const FONT_PX: Record<Preferences['fontSize'], string> = { sm: '15px', md: '16px', lg: '17px' };
const RADIUS: Record<RoundedMode, Record<'sm' | 'md' | 'lg' | 'xl', string>> = {
	sharp: { sm: '0.25rem', md: '0.375rem', lg: '0.5rem', xl: '0.625rem' },
	soft: { sm: '0.5rem', md: '0.625rem', lg: '0.75rem', xl: '0.875rem' },
	round: { sm: '0.625rem', md: '0.75rem', lg: '0.875rem', xl: '1.125rem' },
	pillowy: { sm: '0.875rem', md: '1rem', lg: '1.25rem', xl: '1.75rem' }
};

function prefersDark(): boolean {
	return browser && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyAccent(accent: AccentKey) {
	if (!browser) return;
	const scale = accentScale[accent] ?? accentScale.blue;
	const root = document.documentElement;
	(Object.keys(scale) as (keyof typeof scale)[]).forEach((shade) => {
		root.style.setProperty(`--color-primary-${shade}`, scale[shade]);
	});
}

function applyNeutral(neutral: NeutralKey) {
	if (!browser) return;
	const scale = neutralScale[neutral] ?? neutralScale.slate;
	const root = document.documentElement;
	(Object.keys(scale) as (keyof typeof scale)[]).forEach((shade) => {
		root.style.setProperty(`--color-neutral-${shade}`, scale[shade]);
	});
}

function applyRounded(rounded: RoundedMode) {
	if (!browser) return;
	const radii = RADIUS[rounded] ?? RADIUS.round;
	const root = document.documentElement;
	root.dataset.rounded = rounded;
	root.style.setProperty('--ui-radius-sm', radii.sm);
	root.style.setProperty('--ui-radius-md', radii.md);
	root.style.setProperty('--ui-radius-lg', radii.lg);
	root.style.setProperty('--ui-radius-xl', radii.xl);
	root.style.setProperty('--ui-radius', radii.lg);
}

function applyDensity(density: DensityMode) {
	if (!browser) return;
	document.documentElement.dataset.density = density;
}

class PrefsStore {
	state = $state<Preferences>({ ...DEFAULTS });

	/** Is dark actually rendered right now (resolves `system`)? */
	resolvedDark = $state(false);

	apply = () => {
		if (!browser) return;
		const html = document.documentElement;
		this.resolvedDark =
			this.state.mode === 'dark' || (this.state.mode === 'system' && prefersDark());
		html.classList.toggle('dark', this.resolvedDark);
		html.dataset.reducedMotion = String(this.state.reducedMotion);
		html.dataset.highContrast = String(this.state.highContrast);
		html.style.fontSize = FONT_PX[this.state.fontSize] ?? '16px';
		applyAccent(this.state.accent);
		applyNeutral(this.state.neutral);
		applyRounded(this.state.rounded);
		applyDensity(this.state.density);
	};

	persist = () => {
		if (!browser) return;
		localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
	};

	load = () => {
		if (!browser) return;
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) this.state = { ...DEFAULTS, ...JSON.parse(raw) };
		} catch {
			/* ignore malformed storage */
		}
		// Migrate legacy accents (e.g. the old "yellow") onto the current palette.
		const known = accentOptions.map((a) => a.key);
		if (!known.includes(this.state.accent)) this.state.accent = DEFAULTS.accent;
		const knownNeutrals = neutralOptions.map((a) => a.key);
		if (!knownNeutrals.includes(this.state.neutral)) this.state.neutral = DEFAULTS.neutral;
		if (!Object.keys(RADIUS).includes(this.state.rounded)) this.state.rounded = DEFAULTS.rounded;
		if (!['normal', 'compact'].includes(this.state.density)) this.state.density = DEFAULTS.density;
		if (!['sm', 'md', 'lg'].includes(this.state.fontSize)) this.state.fontSize = DEFAULTS.fontSize;
		this.state.reducedMotion = Boolean(this.state.reducedMotion);
		this.state.highContrast = Boolean(this.state.highContrast);
	};

	reload = () => {
		this.state = { ...DEFAULTS };
		this.load();
		this.apply();
	};

	/** Track OS color-scheme changes while in `system` mode. */
	startSystemWatcher = () => {
		if (!browser) return;
		window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
			if (this.state.mode === 'system') this.apply();
		});
	};

	private set<K extends keyof Preferences>(key: K, value: Preferences[K]) {
		this.state[key] = value;
		this.persist();
		this.apply();
	}

	setMode = (v: ColorMode) => this.set('mode', v);
	setAccent = (v: AccentKey) => this.set('accent', v);
	setNeutral = (v: NeutralKey) => this.set('neutral', v);
	setRounded = (v: RoundedMode) => this.set('rounded', v);
	setDensity = (v: DensityMode) => this.set('density', v);
	setFontSize = (v: Preferences['fontSize']) => this.set('fontSize', v);
	setReducedMotion = (v: boolean) => this.set('reducedMotion', v);
	setHighContrast = (v: boolean) => this.set('highContrast', v);
}

export const preferences = new PrefsStore();
export { accentOptions, neutralOptions };
