/**
 * Cue-track timeline for image/GIF memes (AI-002 extension, rec #3).
 *
 * Sound-on-static and animated-GIF exports have no source audio to analyze —
 * their audible timeline IS the cue sheet (synth recipes + library sounds
 * rendered by the same mix the export ships). This module owns the shared
 * duration constant + helper so the suggestion path and the export path
 * (MemeStudio's MediaRecorder window) can never disagree.
 */

/** Longest exported (recorded) meme — MediaRecorder window cap. */
export const MAX_VIDEO_MEME_SECONDS = 90;

/** Duration a static/GIF meme's audio runs: last cue + tail, ≥1s, ≤ export cap. */
export function cueTrackDurationSec(cues: { atMs: number }[]): number {
	const lastEnd = cues.reduce((t, c) => Math.max(t, c.atMs), 0);
	return Math.min(MAX_VIDEO_MEME_SECONDS, Math.max(1, (lastEnd + 500) / 1000));
}
