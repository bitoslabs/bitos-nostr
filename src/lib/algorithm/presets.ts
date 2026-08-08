import type { PresetId, SurfaceConfig, SurfaceId } from './types';
import { DEFAULT_SURFACE_CONFIG } from './preferences.svelte';
import { signals } from './presets-helpers';

/**
 * Named presets — one-tap recipes that apply a whole SurfaceConfig. "custom" is
 * not a config itself; it's the label the UI shows once the user has strayed
 * from any preset.
 */

const LATEST: Record<SurfaceId, SurfaceConfig> = {
	feed: {
		enabled: true,
		diversityEnabled: false,
		signals: signals({ recency: { weight: 1 } })
	},
	reels: {
		enabled: true,
		diversityEnabled: false,
		signals: signals({ recency: { weight: 1 } })
	},
	discover: {
		enabled: true,
		diversityEnabled: false,
		signals: signals({ recency: { weight: 1 } })
	}
};

const BALANCED: Record<SurfaceId, SurfaceConfig> = DEFAULT_SURFACE_CONFIG;

const ENGAGEMENT: Record<SurfaceId, SurfaceConfig> = {
	feed: {
		enabled: true,
		diversityEnabled: true,
		signals: signals({
			engagement: { weight: 0.4 },
			zaps: { weight: 0.28 },
			topics: { weight: 0.17 },
			recency: { weight: 0.15 }
		})
	},
	reels: {
		enabled: true,
		diversityEnabled: true,
		signals: signals({
			engagement: { weight: 0.52 },
			zaps: { weight: 0.28 },
			topics: { weight: 0.05 },
			recency: { weight: 0.15 }
		})
	},
	discover: {
		enabled: true,
		diversityEnabled: true,
		signals: signals({
			engagement: { weight: 0.46 },
			zaps: { weight: 0.32 },
			topics: { weight: 0.07 },
			recency: { weight: 0.15 }
		})
	}
};

const TRUST: Record<SurfaceId, SurfaceConfig> = {
	feed: {
		enabled: true,
		diversityEnabled: true,
		signals: signals({
			affinity: { weight: 0.34 },
			wot: { weight: 0.26 },
			topics: { weight: 0.2 },
			recency: { weight: 0.2 }
		})
	},
	reels: {
		enabled: true,
		diversityEnabled: true,
		signals: signals({
			affinity: { weight: 0.36 },
			wot: { weight: 0.28 },
			topics: { weight: 0.16 },
			engagement: { weight: 0.2 }
		})
	},
	discover: {
		enabled: true,
		diversityEnabled: true,
		signals: signals({
			wot: { weight: 0.44 },
			affinity: { weight: 0.22 },
			topics: { weight: 0.14 },
			zaps: { weight: 0.12 },
			recency: { weight: 0.08 }
		})
	}
};

const PRESET_CONFIGS: Record<Exclude<PresetId, 'custom'>, Record<SurfaceId, SurfaceConfig>> = {
	latest: LATEST,
	balanced: BALANCED,
	engagement: ENGAGEMENT,
	trust: TRUST
};

export const PRESET_META: { id: Exclude<PresetId, 'custom'>; label: string; icon: string; blurb: string }[] = [
	{ id: 'latest', label: 'Latest', icon: 'i-lucide-clock', blurb: 'Pure reverse-chronological' },
	{ id: 'balanced', label: 'Balanced', icon: 'i-lucide-scale', blurb: 'The recommended default' },
	{
		id: 'engagement',
		label: 'Trending',
		icon: 'i-lucide-flame',
		blurb: 'Maximize reactions & zaps'
	},
	{
		id: 'trust',
		label: 'Trusted',
		icon: 'i-lucide-shield-check',
		blurb: 'Follow graph & affinity first'
	}
];

export function presetConfigFor(id: Exclude<PresetId, 'custom'>, surface: SurfaceId): SurfaceConfig {
	return structuredClone(PRESET_CONFIGS[id][surface]);
}

/** Deep-equality used to detect which preset (if any) a surface currently matches. */
export function matchPreset(surface: SurfaceConfig, current: SurfaceConfig): boolean {
	if (surface.enabled !== current.enabled) return false;
	if (surface.diversityEnabled !== current.diversityEnabled) return false;
	const aKeys = Object.keys(surface.signals);
	const bKeys = Object.keys(current.signals);
	if (aKeys.length !== bKeys.length) return false;
	for (const key of aKeys) {
		const a = surface.signals[key];
		const b = current.signals[key];
		if (!b) return false;
		if (a.enabled !== b.enabled) return false;
		if (Math.abs(a.weight - b.weight) > 0.001) return false;
	}
	return true;
}

export function detectPreset(current: SurfaceConfig): PresetId {
	for (const preset of PRESET_META) {
		if (matchPreset(presetConfigFor(preset.id, 'feed'), current)) return preset.id;
	}
	return 'custom';
}
