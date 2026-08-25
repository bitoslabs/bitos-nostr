/**
 * Cue-mix builder — bridges the cue schedule (synth recipes + custom library
 * sounds) into one rendered AudioBuffer for MediaRecorder exports.
 *
 * Lives outside the component so the plain Map bookkeeping stays away from
 * Svelte's reactivity lint while both export paths (GIF + video) share it.
 */
import { CUSTOM_SOUND_KEY, type MemeSfxCue } from './schema';
import { attachCustomPcm, renderSfxTrack, scheduleSfx } from './sfx';

export interface CueMixDeps {
	/** OfflineAudioContext constructor (browser-provided). */
	offlineCtor: typeof OfflineAudioContext;
	/** Decode one library sound id to normalized mono PCM; null = unusable. */
	decodeSound: (id: string) => Promise<{ pcm: Float32Array; sampleRate: number } | null>;
}

/** Render all cues (synth + custom) into one buffer; null = silent export. */
export async function buildCueMixBuffer(
	cues: MemeSfxCue[],
	durationSec: number,
	deps: CueMixDeps
): Promise<AudioBuffer | null> {
	if (!cues.length || !(durationSec > 0)) return null;
	const schedule = scheduleSfx(cues, durationSec * 1000);
	if (!schedule.length) return null;

	const uniqueIds = new Set(
		schedule
			.filter((s) => s.cue.sfx === CUSTOM_SOUND_KEY && s.cue.soundId)
			.map((s) => s.cue.soundId!)
	);
	if (uniqueIds.size) {
		const decoders = new Map<string, { pcm: Float32Array; sampleRate: number }>();
		await Promise.all(
			[...uniqueIds].map(async (id) => {
				const decoded = await deps.decodeSound(id);
				if (decoded) decoders.set(id, decoded);
			})
		);
		attachCustomPcm(schedule, decoders);
	}
	return renderSfxTrack(schedule, durationSec, deps.offlineCtor);
}
