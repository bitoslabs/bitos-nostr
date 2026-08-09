import { browser } from '$app/environment';

/**
 * Lightweight WebAudio ringtone — no audio assets required, works offline and
 * SSR-safe (all Web Audio access is guarded behind `browser`).
 *
 * The tone mimics a classic two-frequency telephone ring (440Hz + 480Hz) with
 * a 2-second cadence, gently ramped to avoid clicks.
 */

let ctx: AudioContext | null = null;
let interval: ReturnType<typeof setInterval> | null = null;

function ensureContext() {
	if (!browser) return null;
	if (!ctx) {
		const Ctor =
			window.AudioContext ||
			(window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
		if (!Ctor) return null;
		ctx = new Ctor();
	}
	if (ctx.state === 'suspended') void ctx.resume();
	return ctx;
}

function ringBurst() {
	const audio = ensureContext();
	if (!audio) return;
	const now = audio.currentTime;
	// Two short tones spaced 0.4s apart form one "ring".
	[0, 0.4].forEach((offset, index) => {
		const osc = audio.createOscillator();
		const gain = audio.createGain();
		osc.type = 'sine';
		osc.frequency.value = index === 0 ? 440 : 480;
		gain.gain.setValueAtTime(0, now + offset);
		gain.gain.linearRampToValueAtTime(0.14, now + offset + 0.03);
		gain.gain.setValueAtTime(0.14, now + offset + 0.16);
		gain.gain.linearRampToValueAtTime(0, now + offset + 0.2);
		osc.connect(gain).connect(audio.destination);
		osc.start(now + offset);
		osc.stop(now + offset + 0.22);
	});
}

/** A short ascending blip used when placing an outgoing call. */
export function playOutgoingTone() {
	const audio = ensureContext();
	if (!audio) return;
	const now = audio.currentTime;
	const osc = audio.createOscillator();
	const gain = audio.createGain();
	osc.type = 'sine';
	osc.frequency.setValueAtTime(540, now);
	osc.frequency.linearRampToValueAtTime(720, now + 0.12);
	gain.gain.setValueAtTime(0, now);
	gain.gain.linearRampToValueAtTime(0.1, now + 0.02);
	gain.gain.setValueAtTime(0.1, now + 0.12);
	gain.gain.linearRampToValueAtTime(0, now + 0.16);
	osc.connect(gain).connect(audio.destination);
	osc.start(now);
	osc.stop(now + 0.18);
}

/** A soft connected chime played once when a call connects. */
export function playConnectedTone() {
	const audio = ensureContext();
	if (!audio) return;
	const now = audio.currentTime;
	[660, 880].forEach((freq, index) => {
		const osc = audio.createOscillator();
		const gain = audio.createGain();
		osc.type = 'sine';
		osc.frequency.value = freq;
		const offset = index * 0.09;
		gain.gain.setValueAtTime(0, now + offset);
		gain.gain.linearRampToValueAtTime(0.09, now + offset + 0.02);
		gain.gain.linearRampToValueAtTime(0, now + offset + 0.16);
		osc.connect(gain).connect(audio.destination);
		osc.start(now + offset);
		osc.stop(now + offset + 0.18);
	});
}

/** Begin the looping ringtone. Safe to call repeatedly; restarts cleanly. */
export function playRingtone() {
	if (!browser) return;
	stopRingtone();
	ringBurst();
	interval = setInterval(ringBurst, 2000);
}

/** Stop the looping ringtone. No-op if not playing. */
export function stopRingtone() {
	if (interval) {
		clearInterval(interval);
		interval = null;
	}
}
