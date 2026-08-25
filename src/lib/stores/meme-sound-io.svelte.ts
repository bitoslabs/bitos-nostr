import { toasts } from '$lib/stores/toasts.svelte';
import { MAX_SOUND_SECONDS, soundLibrary, type LibrarySound } from '$lib/stores/meme-sounds.svelte';
import {
	CUSTOM_SOUND_KEY,
	type MemeSfxCue,
	type MemeSfxId,
	normalizeSfxCue
} from '$lib/meme/schema';
import { SFX_RECIPES, monoNormalize } from '$lib/meme/sfx';

/**
 * Browser-facing sound plumbing for the Meme Studio — everything that touches
 * AudioContext / MediaRecorder lives here so the studio component stays a
 * pure orchestrator: decode-for-preview, audition (library + synth), device
 * import, mic recording and library removal (with cue pruning).
 *
 * The studio component keeps cue STATE (the `sfxCues` array) — this store
 * only produces sounds and reports import results via toasts.
 */

export interface DecodedSound {
	pcm: Float32Array;
	sampleRate: number;
}

function audioContext(): typeof AudioContext | null {
	return typeof window === 'undefined' ? null : window.AudioContext;
}

class MemeSoundIOStore {
	/** Mic recording in progress (drives the record button state). */
	recording = $state(false);
	/** Live duration for the recorder UI; kept in the store so dialogs can
	 * close/reopen without losing an in-progress recording indicator. */
	recordingElapsedSec = $state(0);
	/** Recorder pause state, distinct from a stopped recording. */
	recordingPaused = $state(false);
	/** Set when getUserMedia refused — the UI offers the device import hint. */
	micDenied = $state(false);
	#recorder: MediaRecorder | null = null;
	#stream: MediaStream | null = null;
	#startedAt = 0;
	#recordingLabel = '';
	#timer: ReturnType<typeof setInterval> | null = null;
	#previewRun = 0;
	#previewSource: AudioBufferSourceNode | null = null;
	#previewCtx: AudioContext | null = null;
	#previewAudio: HTMLAudioElement | null = null;
	#previewUrl: string | null = null;

	#stopTimer() {
		if (this.#timer) clearInterval(this.#timer);
		this.#timer = null;
	}

	/** Stop the current library-sound audition, if any. */
	stopPreview(): void {
		this.#previewRun += 1;
		try {
			this.#previewSource?.stop();
		} catch {
			/* source may already have ended */
		}
		this.#previewSource = null;
		void this.#previewCtx?.close().catch(() => undefined);
		this.#previewCtx = null;
		this.#previewAudio?.pause();
		this.#previewAudio = null;
		if (this.#previewUrl) URL.revokeObjectURL(this.#previewUrl);
		this.#previewUrl = null;
	}

	micSupported = $derived(
		typeof navigator !== 'undefined' &&
			!!navigator.mediaDevices?.getUserMedia &&
			typeof MediaRecorder !== 'undefined'
	);

	/** Decode a library sound to normalized mono PCM (preview + export mix). */
	async decode(sound: LibrarySound): Promise<DecodedSound | null> {
		const blob = await soundLibrary.getBlob(sound.id);
		if (!blob) return null;
		const AudioCtx = audioContext();
		if (!AudioCtx) return null;
		const ctx = new AudioCtx();
		try {
			const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
			return monoNormalize(decoded);
		} catch {
			return null;
		} finally {
			void ctx.close().catch(() => undefined);
		}
	}

	/** Decode a media file's audio track to normalized mono PCM (null = none). */
	async decodeFile(file: File): Promise<DecodedSound | null> {
		const AudioCtx = audioContext();
		const supported = file.type.startsWith('video/') || file.type.startsWith('audio/');
		if (!AudioCtx || !supported) return null;
		const ctx = new AudioCtx();
		try {
			const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
			return monoNormalize(decoded);
		} catch {
			return null;
		} finally {
			void ctx.close().catch(() => undefined);
		}
	}

	/** Audition a library sound immediately. */
	async preview(sound: LibrarySound): Promise<void> {
		this.stopPreview();
		const run = this.#previewRun;
		// Create and unlock the context while this function is still running from
		// the click. Creating it after IndexedDB/decode awaits loses Safari's
		// user-gesture activation and turns a valid sound into a misleading
		// “can't be played” error.
		const AudioCtx = audioContext();
		const ctx = AudioCtx ? new AudioCtx() : null;
		if (ctx) await ctx.resume().catch(() => undefined);
		const blob = await soundLibrary.getBlob(sound.id);
		if (run !== this.#previewRun) {
			void ctx?.close().catch(() => undefined);
			return;
		}
		if (!blob) {
			void ctx?.close().catch(() => undefined);
			toasts.error('This sound file is missing from this device — delete it or import it again');
			return;
		}
		let decoded: AudioBuffer | null = null;
		if (ctx) {
			try {
				decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
			} catch {
				decoded = null;
			}
		}
		if (!decoded) {
			// decodeAudioData is stricter than the browser's native media player
			// (notably for some MediaRecorder WebM/MP4 outputs). Fall back to it.
			void ctx?.close().catch(() => undefined);
			if (typeof Audio === 'undefined') {
				toasts.error("That sound can't be played in this browser");
				return;
			}
			const url = URL.createObjectURL(blob);
			const audio = new Audio(url);
			this.#previewAudio = audio;
			this.#previewUrl = url;
			audio.onended = () => this.stopPreview();
			audio.onerror = () => {
				URL.revokeObjectURL(url);
				toasts.error("That sound can't be played in this browser");
			};
			void audio.play().catch(() => {
				URL.revokeObjectURL(url);
				toasts.error("That sound can't be played in this browser");
			});
			return;
		}
		// copyToChannel needs a Float32Array backed by a plain ArrayBuffer.
		if (!ctx) return;
		const pcm = new Float32Array(decoded.length);
		decoded.copyFromChannel(pcm, 0);
		const buffer = ctx.createBuffer(1, pcm.length, decoded.sampleRate);
		buffer.copyToChannel(pcm, 0);
		const source = ctx.createBufferSource();
		this.#previewCtx = ctx;
		this.#previewSource = source;
		source.buffer = buffer;
		source.connect(ctx.destination);
		source.start();
		source.onended = () => this.stopPreview();
	}

	/** Audition one synth recipe immediately so placement isn't guesswork. */
	previewSynth(sfx: MemeSfxId): void {
		void (async () => {
			const { renderSfxTrack, scheduleSfx } = await import('$lib/meme/sfx');
			const duration = SFX_RECIPES[sfx].duration + 0.25;
			const track = scheduleSfx([{ id: 'preview', sfx, atMs: 0, gain: 1 }], duration);
			const OfflineCtx = typeof window === 'undefined' ? null : window.OfflineAudioContext;
			if (!OfflineCtx) return;
			const buffer = await renderSfxTrack(track, duration, OfflineCtx);
			const AudioCtx = audioContext();
			if (!AudioCtx) return;
			const ctx = new AudioCtx();
			const source = ctx.createBufferSource();
			source.buffer = buffer;
			source.connect(ctx.destination);
			source.start();
			source.onended = () => void ctx.close().catch(() => undefined);
		})();
	}

	/** Measure a candidate audio blob by decoding it. */
	async durationSec(blob: Blob): Promise<number> {
		const AudioCtx = audioContext();
		if (!AudioCtx) return 0;
		const ctx = new AudioCtx();
		try {
			const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
			return decoded.duration;
		} catch {
			return 0;
		} finally {
			void ctx.close().catch(() => undefined);
		}
	}

	/** Validate + persist one sound into the library (device or mic source). */
	async importBlob(
		blob: Blob,
		durationSec: number,
		source: 'device' | 'mic',
		label?: string
	): Promise<LibrarySound | null> {
		if (!(durationSec > 0)) {
			toasts.error('Could not read that audio — try WAV/MP3/M4A/OGG/WebM');
			return null;
		}
		if (durationSec > MAX_SOUND_SECONDS) {
			toasts.error(`Sounds top out at ${MAX_SOUND_SECONDS}s — trim it first`);
			return null;
		}
		try {
			const saved = await soundLibrary.add({ label, source, blob, durationSec, mime: blob.type });
			toasts.success(`Added “${saved.label}” to your sounds`);
			return saved;
		} catch (e) {
			toasts.error((e as Error).message);
			return null;
		}
	}

	/** Device import path: size gate → duration probe → library add. */
	async importFile(next: File | null): Promise<void> {
		if (!next) return;
		if (next.size > 8 * 1024 * 1024) {
			toasts.error('That sound file is over 8 MB — trim it first');
			return;
		}
		const durationSec = await this.durationSec(next);
		await this.importBlob(
			next,
			durationSec,
			'device',
			next.name.replace(/\.[^.]+$/, '').slice(0, 40)
		);
	}

	/** Remove a sound and return the pruned cue sheet (orphaned rows dropped). */
	async removeSound(id: string, cues: MemeSfxCue[]): Promise<MemeSfxCue[]> {
		await soundLibrary.remove(id);
		return soundLibrary.pruneOrphanCues(cues);
	}

	/** Build a custom cue for a library sound at a playhead (ms-integer). */
	cueFor(sound: LibrarySound, atMs: number): MemeSfxCue | null {
		return normalizeSfxCue({
			sfx: CUSTOM_SOUND_KEY,
			soundId: sound.id,
			atMs: Math.max(0, Math.round(atMs)),
			gain: 1
		});
	}

	async toggleMic(label?: string): Promise<void> {
		if (this.recording) {
			this.stopMic();
			return;
		}
		if (!this.micSupported) {
			toasts.error('Mic recording needs a Chromium browser');
			return;
		}
		try {
			this.#stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch {
			this.micDenied = true;
			toasts.error('Microphone access was blocked');
			return;
		}
		const pick = (): string => {
			for (const type of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
				if (MediaRecorder.isTypeSupported(type)) return type;
			}
			return '';
		};
		const mimeType = pick();
		this.#recorder = mimeType
			? new MediaRecorder(this.#stream, { mimeType })
			: new MediaRecorder(this.#stream);
		const chunks: Blob[] = [];
		this.#recorder.ondataavailable = (e) => {
			if (e.data.size) chunks.push(e.data);
		};
		this.#recorder.onstop = () => {
			this.#stopTimer();
			const elapsed = this.recordingElapsedSec;
			this.recordingElapsedSec = 0;
			this.recordingPaused = false;
			const blob = new Blob(chunks, { type: this.#recorder?.mimeType || 'audio/webm' });
			this.#stream?.getTracks().forEach((t) => t.stop());
			this.#stream = null;
			if (!blob.size) {
				toasts.warning('Nothing was recorded — try again');
				return;
			}
			void this.importBlob(
				blob,
				elapsed,
				'mic',
				this.#recordingLabel || 'Mic ' + new Date().toLocaleTimeString()
			);
		};
		this.#startedAt = performance.now();
		this.#recordingLabel = label?.trim().slice(0, 40) ?? '';
		this.recordingElapsedSec = 0;
		this.recording = true;
		this.recordingPaused = false;
		this.#timer = setInterval(() => {
			this.recordingElapsedSec = Math.max(0, (performance.now() - this.#startedAt) / 1000);
		}, 100);
		this.#recorder.start(250);
	}

	stopMic(): void {
		if (this.#recorder && this.#recorder.state !== 'inactive') this.#recorder.stop();
		this.recording = false;
		this.#stopTimer();
	}

	/** Pause/resume without finalizing the recording. */
	pauseResumeMic(): void {
		const recorder = this.#recorder;
		if (!this.recording || !recorder) return;
		if (this.recordingPaused) {
			if (recorder.state === 'paused') recorder.resume();
			this.#startedAt = performance.now() - this.recordingElapsedSec * 1000;
			this.recordingPaused = false;
			this.#timer = setInterval(() => {
				this.recordingElapsedSec = Math.max(0, (performance.now() - this.#startedAt) / 1000);
			}, 100);
		} else {
			if (recorder.state === 'recording') recorder.pause();
			this.recordingElapsedSec = Math.max(0, (performance.now() - this.#startedAt) / 1000);
			this.#stopTimer();
			this.recordingPaused = true;
		}
	}

	dispose(): void {
		this.stopMic();
		this.recordingElapsedSec = 0;
		this.recordingPaused = false;
		this.#stream?.getTracks().forEach((t) => t.stop());
		this.#stream = null;
		this.#recorder = null;
	}
}

export const soundIO = new MemeSoundIOStore();
