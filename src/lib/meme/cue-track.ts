/**
 * Cue-track timeline for image/GIF memes (AI-002 extension, rec #3).
 *
 * Sound-on-static and animated-GIF exports have no source audio to analyze —
 * their audible timeline IS the cue sheet (synth recipes + library sounds
 * rendered by the same mix the export ships). This module owns the shared
 * duration helper so the suggestion path and the export path (MemeStudio's
 * MediaRecorder window) can never disagree.
 */

/** Duration a static/GIF meme's audio runs: the last cue END (start + play
 *  length when a resolver is given — a 10s sound no longer gets chopped at
 *  last-start + 0.5s) + tail, at least 1s. */
export function cueTrackDurationSec<T extends { atMs: number }>(
	cues: T[],
	lengthSecOf?: (cue: T) => number
): number {
	let lastEndMs = 0;
	for (const cue of cues) {
		const lenSec = lengthSecOf?.(cue) ?? 0;
		lastEndMs = Math.max(lastEndMs, cue.atMs + (lenSec > 0 ? lenSec * 1000 : 0));
	}
	return Math.max(1, (lastEndMs + 500) / 1000);
}
