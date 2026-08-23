/**
 * Synthesized meme SFX — pure recipe data + a WebAudio renderer.
 *
 * Recipes are DATA (oscillator/note tables), not code, so they are
 * node-testable and deterministic. The renderer paints each recipe into an
 * OfflineAudioContext at export time and the result is mixed into the exported
 * video's audio track (plan §6.3 "audio track" / SFX timeline).
 *
 * Fully synthesized = zero audio assets = no §17.2 license surface: these are
 * our own recordings-by-synthesis (CC0-equivalent), unlike Freesound-style
 * third-party clips which stay gated behind the Phase-6 curated pack.
 */
import { CUSTOM_SOUND_KEY, type MemeSfxCue, type MemeSfxId } from './schema';

/** One oscillator voice in a recipe (times relative to cue start, seconds). */
export interface SfxNote {
	/** Waveform. */
	type: OscillatorType;
	/** Start delay (s). */
	t: number;
	/** Duration (s). */
	d: number;
	/** Constant frequency (Hz) — used when `to` is absent. */
	f: number;
	/** Optional linear ramp target frequency (Hz). */
	to?: number;
	/** Peak gain 0–1 (recipe-relative; absolute level applied by renderer). */
	g: number;
}

export interface SfxRecipe {
	id: MemeSfxId;
	/** Total recipe length (s) — cues near the render end are trimmed. */
	duration: number;
	/** Base loudness 0–1 (relative to the 0.5 master). */
	level: number;
	notes: SfxNote[];
}

const recip = (id: MemeSfxId, duration: number, level: number, notes: SfxNote[]): SfxRecipe => ({
	id,
	duration,
	level,
	notes
});

/** The comedy SFX pack — vine boom, bruh, laugh, whoosh, pop, boing, … */
export const SFX_RECIPES: Record<MemeSfxId, SfxRecipe> = {
	// Deep sine drop + sub thump: the "vine boom".
	boom: recip('boom', 0.9, 0.9, [
		{ type: 'sine', t: 0, d: 0.55, f: 180, to: 38, g: 1 },
		{ type: 'sine', t: 0.02, d: 0.5, f: 90, to: 30, g: 0.8 },
		{ type: 'triangle', t: 0, d: 0.12, f: 220, to: 60, g: 0.35 }
	]),
	// Flat descending formant-ish growl: "bruh".
	bruh: recip('bruh', 0.5, 0.7, [
		{ type: 'sawtooth', t: 0, d: 0.42, f: 165, to: 82, g: 0.5 },
		{ type: 'sine', t: 0, d: 0.42, f: 82, to: 55, g: 0.55 },
		{ type: 'sine', t: 0.05, d: 0.1, f: 240, to: 180, g: 0.18 }
	]),
	// Rising two-voice chuckle bursts: canned laughter feel.
	laugh: recip('laugh', 1.1, 0.55, [
		{ type: 'triangle', t: 0, d: 0.09, f: 420, to: 300, g: 0.5 },
		{ type: 'triangle', t: 0.14, d: 0.09, f: 400, to: 290, g: 0.48 },
		{ type: 'triangle', t: 0.28, d: 0.09, f: 430, to: 310, g: 0.5 },
		{ type: 'triangle', t: 0.42, d: 0.09, f: 380, to: 270, g: 0.45 },
		{ type: 'triangle', t: 0.56, d: 0.12, f: 360, to: 250, g: 0.42 },
		{ type: 'sine', t: 0.7, d: 0.35, f: 300, to: 180, g: 0.2 }
	]),
	// Band-sweep riser: whoosh.
	whoosh: recip('whoosh', 0.7, 0.6, [
		{ type: 'sine', t: 0, d: 0.62, f: 200, to: 1600, g: 0.5 },
		{ type: 'triangle', t: 0.05, d: 0.5, f: 140, to: 900, g: 0.3 },
		{ type: 'sine', t: 0.5, d: 0.2, f: 1500, to: 300, g: 0.25 }
	]),
	// Short bubbly pop.
	pop: recip('pop', 0.18, 0.8, [
		{ type: 'sine', t: 0, d: 0.09, f: 520, to: 240, g: 1 },
		{ type: 'sine', t: 0.04, d: 0.05, f: 900, to: 1400, g: 0.3 }
	]),
	// Wobbling rising boing.
	boing: recip('boing', 0.75, 0.7, [
		{ type: 'sine', t: 0, d: 0.6, f: 110, to: 320, g: 0.7 },
		{ type: 'sine', t: 0.03, d: 0.55, f: 330, to: 110, g: 0.4 },
		{ type: 'sine', t: 0.08, d: 0.45, f: 220, to: 430, g: 0.3 }
	]),
	// Ticking roll → hit.
	drumroll: recip('drumroll', 1.2, 0.65, [
		{ type: 'square', t: 0, d: 0.05, f: 190, g: 0.25 },
		{ type: 'square', t: 0.09, d: 0.05, f: 200, g: 0.25 },
		{ type: 'square', t: 0.18, d: 0.05, f: 210, g: 0.28 },
		{ type: 'square', t: 0.26, d: 0.05, f: 220, g: 0.28 },
		{ type: 'square', t: 0.33, d: 0.05, f: 230, g: 0.3 },
		{ type: 'square', t: 0.4, d: 0.05, f: 240, g: 0.32 },
		{ type: 'square', t: 0.46, d: 0.05, f: 255, g: 0.35 },
		{ type: 'square', t: 0.51, d: 0.05, f: 270, g: 0.38 },
		{ type: 'sine', t: 0.58, d: 0.5, f: 160, to: 45, g: 0.9 }
	]),
	// Bright ding.
	ding: recip('ding', 0.8, 0.7, [
		{ type: 'sine', t: 0, d: 0.7, f: 1244, g: 0.7 },
		{ type: 'sine', t: 0, d: 0.5, f: 1867, g: 0.25 },
		{ type: 'sine', t: 0.01, d: 0.3, f: 2489, g: 0.12 }
	]),
	// Descending minor wipes: sad trombone.
	'sad-trombone': recip('sad-trombone', 1.4, 0.65, [
		{ type: 'sawtooth', t: 0, d: 0.36, f: 233, g: 0.4 },
		{ type: 'sawtooth', t: 0.4, d: 0.36, f: 220, g: 0.42 },
		{ type: 'sawtooth', t: 0.8, d: 0.55, f: 207, to: 180, g: 0.45 },
		{ type: 'sawtooth', t: 0.8, d: 0.55, f: 104, to: 92, g: 0.3 }
	])
};

/** Smallest master headroom gain applied to every cue render. */
export const SFX_MASTER_GAIN = 0.5;

export interface SfxScheduleEntry {
	cue: MemeSfxCue;
	/** Synthesized recipe — absent for custom library sounds. */
	recipe?: SfxRecipe;
	/** Decoded PCM (mono-summed) for custom sounds, normalized to peak 1. */
	pcm?: Float32Array;
	/** Sample rate the PCM was decoded at. */
	sampleRate?: number;
	startSec: number;
}

/** Build the timeline of cue entries for a render window, dropping cues that
 *  start after the window ends (they would be trimmed inaudibly). Synthesized
 *  cues get their recipe inline; custom cues need PCM attached separately
 *  (`attachCustomPcm`) or they are skipped. */
export function scheduleSfx(cues: MemeSfxCue[], durationMs: number): SfxScheduleEntry[] {
	const out: SfxScheduleEntry[] = [];
	const durationSec = durationMs / 1000;
	for (const cue of cues) {
		const startSec = cue.atMs / 1000;
		if (startSec >= durationSec) continue;
		if (cue.sfx === CUSTOM_SOUND_KEY) {
			out.push({ cue, startSec });
		} else {
			const recipe = SFX_RECIPES[cue.sfx as MemeSfxId];
			if (recipe) out.push({ cue, recipe, startSec });
		}
	}
	return out.sort((a, b) => a.startSec - b.startSec);
}

/** Merge decoded custom sounds into a schedule in place (per unique soundId).
 *  Returns the ids that were actually found (missing ones stay skipped). */
export function attachCustomPcm(
	schedule: SfxScheduleEntry[],
	decoders: Map<string, { pcm: Float32Array; sampleRate: number }>
): Set<string> {
	const used = new Set<string>();
	for (const entry of schedule) {
		if (entry.cue.sfx !== CUSTOM_SOUND_KEY || !entry.cue.soundId) continue;
		const decoded = decoders.get(entry.cue.soundId);
		if (!decoded) continue;
		entry.pcm = decoded.pcm;
		entry.sampleRate = decoded.sampleRate;
		used.add(entry.cue.soundId);
	}
	return used;
}

/** Mono-sum + peak-normalize a decoded AudioBuffer for offline mixing. */
export function monoNormalize(buffer: AudioBuffer): { pcm: Float32Array; sampleRate: number } {
	const channels = buffer.numberOfChannels;
	const length = buffer.length;
	const pcm = new Float32Array(length);
	for (let ch = 0; ch < channels; ch++) {
		const data = buffer.getChannelData(ch);
		for (let i = 0; i < length; i++) pcm[i] += data[i] / channels;
	}
	let peak = 0;
	for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
	if (peak > 1) {
		for (let i = 0; i < length; i++) pcm[i] /= peak;
	}
	return { pcm, sampleRate: buffer.sampleRate };
}

/** Total loudness of a schedule (peak sum of cue levels × gains; custom
 *  sounds count at full level 1). */
export function scheduleGainSum(schedule: SfxScheduleEntry[]): number {
	return schedule.reduce((sum, { cue, recipe }) => sum + (recipe?.level ?? 1) * cue.gain, 0);
}

/** Render the cue schedule (synthesized recipes AND custom PCM) into an
 *  AudioBuffer via OfflineAudioContext. */
export async function renderSfxTrack(
	schedule: SfxScheduleEntry[],
	durationSec: number,
	ctor: typeof OfflineAudioContext
): Promise<AudioBuffer> {
	const tailMs = 250; // let tails ring past the window edge
	const total = Math.max(0.1, durationSec + tailMs / 1000);
	const renderRate = 44100;
	const offline = new ctor(2, Math.ceil(total * renderRate), renderRate);
	for (const { cue, recipe, startSec, pcm, sampleRate } of schedule) {
		// Custom library sound: resample-on-write (nearest-sample is fine for
		// one-shot comedy cues) at the cue's gain, full band.
		if (pcm && sampleRate) {
			// Output length: the remaining window at render rate, capped by
			// however many source samples exist.
			const maxOut = Math.floor((pcm.length * renderRate) / sampleRate);
			const target = Math.max(1, Math.min(Math.round((total - startSec) * renderRate), maxOut));
			const buffer = offline.createBuffer(1, target, renderRate);
			const channel = buffer.getChannelData(0);
			const ratio = sampleRate / renderRate;
			for (let i = 0; i < target; i++) {
				const source = Math.min(pcm.length - 1, Math.round(i * ratio));
				const decay = i / target; // gentle fade over the window edge
				channel[i] = pcm[source] * cue.gain * (1 - decay * 0.15);
			}
			const src = offline.createBufferSource();
			src.buffer = buffer;
			const gain = offline.createGain();
			gain.gain.value = SFX_MASTER_GAIN;
			src.connect(gain).connect(offline.destination);
			src.start(startSec);
			continue;
		}
		if (!recipe) continue;
		for (const note of recipe.notes) {
			const osc = offline.createOscillator();
			const gain = offline.createGain();
			osc.type = note.type;
			const start = startSec + note.t;
			const end = start + note.d;
			osc.frequency.setValueAtTime(note.f, start);
			if (note.to !== undefined) osc.frequency.linearRampToValueAtTime(note.to, end);
			// Percussive envelope: quick attack, exponential-ish decay.
			const peak = SFX_MASTER_GAIN * recipe.level * cue.gain * note.g;
			gain.gain.setValueAtTime(0.0001, start);
			gain.gain.linearRampToValueAtTime(Math.max(0.0002, peak), start + 0.012);
			gain.gain.exponentialRampToValueAtTime(0.0001, end);
			osc.connect(gain).connect(offline.destination);
			osc.start(start);
			osc.stop(end + 0.02);
			osc.onended = null;
		}
	}
	return offline.startRendering();
}

/**
 * Mix a rendered SFX AudioBuffer into a MediaStream (as an extra audio track)
 * alongside any source audio — used by the video meme renderer.
 */
export function createSfxAudioTrack(
	buffer: AudioBuffer,
	ctor: typeof AudioContext
): MediaStreamTrack {
	const ctx = new ctor();
	const destination = ctx.createMediaStreamDestination();
	const source = ctx.createBufferSource();
	source.buffer = buffer;
	source.connect(destination);
	source.start();
	const track = destination.stream.getAudioTracks()[0];
	if (!track) {
		void ctx.close().catch(() => undefined);
		throw new Error('No audio track could be created for the SFX mix');
	}
	// Keep the context alive until the track ends; close() tears it down.
	track.addEventListener('ended', () => void ctx.close().catch(() => undefined));
	return track;
}
