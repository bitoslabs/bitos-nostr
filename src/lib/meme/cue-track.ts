/**
 * Cue-track timeline for image/GIF memes (AI-002 extension, rec #3).
 *
 * Sound-on-static and animated-GIF exports have no source audio to analyze —
 * their audible timeline IS the cue sheet (synth recipes + library sounds
 * rendered by the same mix the export ships). This module owns the shared
 * duration helper so the suggestion path and the export path (MemeStudio's
 * MediaRecorder window) can never disagree.
 */

/** Duration a static/GIF meme's audio runs: last cue + tail, at least 1s. */
export function cueTrackDurationSec(cues: { atMs: number }[]): number {
	const lastEnd = cues.reduce((t, c) => Math.max(t, c.atMs), 0);
	return Math.max(1, (lastEnd + 500) / 1000);
}
