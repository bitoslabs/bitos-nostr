import { analyzeClip, windowRms } from '$lib/ai/extract';
import { suggestTimelines } from '$lib/ai/suggest';
import { recommendSmartTemplates, type SmartResolution } from '$lib/ai/smart-templates';
import { buildCueMixBuffer, type CueMixDeps } from '$lib/meme/cue-mix';
import { cueTrackDurationSec } from '$lib/meme/cue-track';
import { monoNormalize } from '$lib/meme/sfx';
import type { MemeSfxCue } from '$lib/meme/schema';
import { soundLibrary, type LibrarySound } from '$lib/stores/meme-sounds.svelte';
import { soundIO } from '$lib/stores/meme-sound-io.svelte';

/**
 * Suggestion-ladder audio plumbing (AI-002) — grab the audio a meme will
 * actually ship, decode it to mono PCM and hand it to the local analyzer.
 * Split out of MemeStudio so the component keeps only UI state (busy flags,
 * results) while this module owns the audio-decoding paths:
 *
 *  - video sources analyze their own (trimmed) audio;
 *  - image/GIF sources analyze the rendered cue mix they will export.
 */

export interface MonoPcm {
	pcm: Float32Array;
	sampleRate: number;
}

/** Shape of one local clip analysis (AI-001) — re-exported for consumers. */
export type MemeClipAnalysis = Awaited<ReturnType<typeof analyzeClip>>;

export interface SuggestionAudio {
	analysis: MemeClipAnalysis;
	windows: Float32Array;
	groups: ReturnType<typeof suggestTimelines>;
	/** AI Smart Templates ranked by trigger support (Auto Meme cards). */
	smart: SmartResolution[];
}

/** Decode the stage file's audio to normalized mono PCM (null = no audio). */
export async function sourceMonoPcm(file: File): Promise<MonoPcm | null> {
	return soundIO.decodeFile(file);
}

/** Image/GIF memes ship the cue sheet as their audio — render that exact
 *  mix (the same one the export attaches) and decode it to mono PCM so
 *  analysis reflects what viewers will actually hear (AI-002 rec #3). */
export async function cueTrackMonoPcm(
	sfxCues: MemeSfxCue[],
	decodeSound: CueMixDeps['decodeSound']
): Promise<MonoPcm | null> {
	if (!sfxCues.length) return null;
	const OfflineCtx = typeof window === 'undefined' ? null : window.OfflineAudioContext;
	const AudioCtx = typeof window === 'undefined' ? null : window.AudioContext;
	if (!OfflineCtx || !AudioCtx) return null;
	try {
		// Reuse the export mix builder — identical recipe/custom-sound handling.
		const durationSec = cueTrackDurationSec(sfxCues);
		const mix = await buildCueMixBuffer(sfxCues, durationSec, {
			offlineCtor: OfflineCtx,
			decodeSound
		});
		if (!mix) return null;
		return monoNormalize(mix);
	} catch {
		return null;
	}
}

/** Library-sound decoder adapter for {@link cueTrackMonoPcm} / export mixes. */
export function libraryDecodeSound(id: string): Promise<MonoPcm | null> {
	const sound: LibrarySound | undefined = soundLibrary.list.find((s) => s.id === id);
	return sound ? soundIO.decode(sound) : Promise.resolve(null);
}

/** Run the full ladder: audio in → analysis + timelines back. */
export async function buildSuggestionAudio(
	span: Float32Array,
	sampleRate: number
): Promise<SuggestionAudio> {
	const analysis = await analyzeClip(span, sampleRate);
	// AI Smart Templates (tp-2 p.558): trigger rules resolved against the
	// same anchors — ranked "94% match" style cards for Auto Meme.
	const smart = recommendSmartTemplates(analysis);
	return {
		analysis,
		windows: windowRms(span, sampleRate),
		groups: suggestTimelines(analysis),
		smart
	};
}
