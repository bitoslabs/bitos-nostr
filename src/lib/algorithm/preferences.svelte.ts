/**
 * Algorithm preferences — a runes-based singleton persisted to localStorage,
 * mirroring the pattern used by `theme/preferences.svelte.ts` and
 * `nostr/identity.svelte.ts`.
 *
 * Ship defaults are tuned per surface (see docs/algorithm-plan.md §4):
 *  - Feed:     light touch, recency-led, trusted circle
 *  - Reels:    engagement + zaps dominate, discovery-oriented
 *  - Discover: engagement velocity + WoT quality gate
 */
import { browser } from '$app/environment';
import type {
	AlgorithmPreferences,
	PresetId,
	SignalDefinition,
	SurfaceConfig,
	SurfaceId
} from './types';
import { SIGNAL_DEFINITIONS } from './definitions';
import { signals, clamp01 } from './presets-helpers';

export const ALGORITHM_STORAGE_KEY = 'bitos:algorithm-preferences';

/** Global freshness control: tunable recency half-life, in seconds. */
export const DEFAULT_RECENCY_HALF_LIFE_SECONDS = 6 * 3600; // 6h

/** Default SurfaceConfig per surface (a.k.a. the "balanced" preset). */
export const DEFAULT_SURFACE_CONFIG: Record<SurfaceId, SurfaceConfig> = {
	feed: {
		enabled: true,
		diversityEnabled: true,
		signals: signals({
			recency: { enabled: true, weight: 0.35 },
			affinity: { enabled: true, weight: 0.25 },
			engagement: { enabled: true, weight: 0.25 },
			zaps: { enabled: true, weight: 0.15 }
		})
	},
	reels: {
		enabled: true,
		diversityEnabled: true,
		signals: signals({
			engagement: { enabled: true, weight: 0.45 },
			zaps: { enabled: true, weight: 0.3 },
			recency: { enabled: true, weight: 0.15 },
			affinity: { enabled: false, weight: 0.1 }
		})
	},
	discover: {
		enabled: true,
		diversityEnabled: true,
		signals: signals({
			engagement: { enabled: true, weight: 0.4 },
			wot: { enabled: true, weight: 0.3 },
			zaps: { enabled: true, weight: 0.2 },
			recency: { enabled: true, weight: 0.1 }
		})
	}
};

export const DEFAULTS: AlgorithmPreferences = {
	feed: structuredClone(DEFAULT_SURFACE_CONFIG.feed),
	reels: structuredClone(DEFAULT_SURFACE_CONFIG.reels),
	discover: structuredClone(DEFAULT_SURFACE_CONFIG.discover)
};

class AlgorithmPreferencesStore {
	config = $state<AlgorithmPreferences>(structuredClone(DEFAULTS));
	recencyHalfLifeSeconds = $state(DEFAULT_RECENCY_HALF_LIFE_SECONDS);
	loaded = $state(false);
	/** Bumps whenever the WoT second-hop cache refreshes, so ranked surfaces that
	 *  depend on it re-run. See `algorithm/context.ts`. */
	wotVersion = $state(0);
	bumpWotVersion = () => {
		this.wotVersion++;
	};

	load = () => {
		if (!browser || this.loaded) return;
		this.loaded = true;
		try {
			const raw = localStorage.getItem(ALGORITHM_STORAGE_KEY);
			if (raw) {
				const parsed = JSON.parse(raw) as Partial<AlgorithmPreferences> & {
					recencyHalfLifeSeconds?: number;
				};
				this.config = {
					feed: this.mergeSurface('feed', parsed.feed),
					reels: this.mergeSurface('reels', parsed.reels),
					discover: this.mergeSurface('discover', parsed.discover)
				};
				if (
					Number.isFinite(parsed.recencyHalfLifeSeconds) &&
					(parsed.recencyHalfLifeSeconds as number) > 0
				) {
					this.recencyHalfLifeSeconds = parsed.recencyHalfLifeSeconds as number;
				}
			}
		} catch {
			/* ignore malformed storage */
		}
	};

	/** Backfill missing signals onto the default config so old installs upgrade. */
	private mergeSurface(surface: SurfaceId, saved?: Partial<SurfaceConfig>): SurfaceConfig {
		const base = structuredClone(DEFAULT_SURFACE_CONFIG[surface]);
		if (!saved) return base;
		return {
			enabled: saved.enabled ?? base.enabled,
			diversityEnabled: saved.diversityEnabled ?? base.diversityEnabled,
			signals: { ...base.signals, ...(saved.signals ?? {}) }
		};
	}

	private persist = () => {
		if (!browser) return;
		localStorage.setItem(
			ALGORITHM_STORAGE_KEY,
			JSON.stringify({
				...this.config,
				recencyHalfLifeSeconds: this.recencyHalfLifeSeconds
			})
		);
	};

	configFor = (surface: SurfaceId): SurfaceConfig => this.config[surface];

	isEnabled = (surface: SurfaceId): boolean => this.config[surface].enabled;

	toggleSurface = (surface: SurfaceId, enabled: boolean) => {
		this.config[surface].enabled = enabled;
		this.persist();
	};

	toggleSignal = (surface: SurfaceId, signalId: string, enabled: boolean) => {
		const state = this.config[surface].signals[signalId];
		if (state) state.enabled = enabled;
		else this.config[surface].signals[signalId] = { enabled, weight: 0.1 };
		this.persist();
	};

	setWeight = (surface: SurfaceId, signalId: string, weight: number) => {
		const state = this.config[surface].signals[signalId];
		if (state) state.weight = clamp01(weight);
		else this.config[surface].signals[signalId] = { enabled: true, weight: clamp01(weight) };
		this.persist();
	};

	toggleDiversity = (surface: SurfaceId, enabled: boolean) => {
		this.config[surface].diversityEnabled = enabled;
		this.persist();
	};

	setRecencyHalfLife = (seconds: number) => {
		this.recencyHalfLifeSeconds = Math.max(600, Math.round(seconds));
		this.persist();
	};

	/** Apply a full surface config (used by presets + restore defaults). */
	applySurfaceConfig = (surface: SurfaceId, next: SurfaceConfig) => {
		this.config[surface] = structuredClone(next);
		this.persist();
	};

	/** Restore one surface to its shipped defaults. */
	resetSurface = (surface: SurfaceId) => {
		this.applySurfaceConfig(surface, structuredClone(DEFAULT_SURFACE_CONFIG[surface]));
	};

	/** Restore everything (all three surfaces + freshness). */
	resetAll = () => {
		this.config = structuredClone(DEFAULTS);
		this.recencyHalfLifeSeconds = DEFAULT_RECENCY_HALF_LIFE_SECONDS;
		this.persist();
	};

	/** Total active weight in a surface (for normalization display in the UI). */
	activeWeightTotal = (surface: SurfaceId): number => {
		let total = 0;
		for (const state of Object.values(this.config[surface].signals)) {
			if (state.enabled) total += state.weight;
		}
		return total;
	};
}

export const algorithmPreferences = new AlgorithmPreferencesStore();

/** Signal catalog shown in the UI (kept separate from the runtime registry). */
export const signalDefinitions: SignalDefinition[] = SIGNAL_DEFINITIONS;

/** Surface display metadata. */
export const SURFACE_META: Record<
	SurfaceId,
	{ label: string; icon: string; tagline: string; candidatePool: string }
> = {
	feed: {
		label: 'Feed',
		icon: 'i-lucide-newspaper',
		tagline: 'Your trusted circle, lightly re-ranked.',
		candidatePool: 'Notes from people you follow'
	},
	reels: {
		label: 'Reels',
		icon: 'i-lucide-clapperboard',
		tagline: 'Discovery-first — engagement & zaps lead.',
		candidatePool: 'Video notes across your relays'
	},
	discover: {
		label: 'Discover',
		icon: 'i-lucide-compass',
		tagline: 'Beyond your circle, with a quality gate.',
		candidatePool: 'Global notes, excluding your follows'
	}
};

export type { PresetId };
