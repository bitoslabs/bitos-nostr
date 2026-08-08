export * from './types';
export * from './definitions';
export {
	algorithmPreferences,
	ALGORITHM_STORAGE_KEY,
	DEFAULT_RECENCY_HALF_LIFE_SECONDS,
	DEFAULT_SURFACE_CONFIG,
	DEFAULTS,
	SURFACE_META,
	signalDefinitions
} from './preferences.svelte';
export type { PresetId } from './preferences.svelte';
export { signalRegistry, resolveSignal } from './registry';
export { applyDiversity } from './diversity';
export {
	PRESET_META,
	presetConfigFor,
	matchPreset,
	detectPreset
} from './presets';
export { signals, clamp01 } from './presets-helpers';
export {
	interactionProfile,
	PROFILE_STORAGE_KEY,
	extractTags
} from './interaction-profile.svelte';
export type { InteractionProfileState } from './interaction-profile.svelte';
export { negativePenalty } from './penalties';
export {
	buildScoringContext,
	buildAffinity,
	getWotSet,
	refreshWot
} from './context';
export { rankNotes, rankNotesWithBreakdown } from './pipeline';
