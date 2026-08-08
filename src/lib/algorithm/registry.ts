import type { SignalFn } from './types';
import { recencyScore } from './signals/recency';
import { engagementScore } from './signals/engagement';
import { zapScore } from './signals/zaps';
import { affinityScore } from './signals/affinity';
import { wotScore } from './signals/wot';
import { noveltyScore } from './signals/novelty';
import { topicsScore } from './signals/topics';

/**
 * Signal registry — id → scoring function. New signals are added here; the
 * preferences store backfills them onto existing configs automatically.
 */
export const signalRegistry: Record<string, SignalFn> = {
	recency: recencyScore,
	engagement: engagementScore,
	zaps: zapScore,
	affinity: affinityScore,
	wot: wotScore,
	novelty: noveltyScore,
	topics: topicsScore
};

/** Safe lookup — unknown signal ids score 0 instead of throwing. */
export function resolveSignal(id: string): SignalFn | undefined {
	return signalRegistry[id];
}
