/**
 * Sound-from-video extraction — the TikTok-style "use this sound" loop:
 * any bitz's video becomes a sound in the personal library. Bytes are
 * fetched through the CORS-safe media seam, decoded with WebAudio, mono-
 * mixed, trimmed to a conservative extraction cap, and encoded as 16-bit PCM WAV (a
 * format every decodeAudioData path in the studio already handles).
 *
 * Pure DSP (monoMix / trimTo / encodeWav) is node-testable; the fetch +
 * decode orchestration (`extractVideoAudio`) is browser-only and thin.
 */

import { fetchRemoteMedia } from '$lib/meme/remote-media';
/** WAV extraction is intentionally bounded: uncompressed PCM grows quickly. */
export const MAX_VIDEO_SOUND_SECONDS = 15;

/** Average N channels into one mono channel, clamped to [-1, 1]. */
export function monoMix(channels: Float32Array[]): Float32Array {
	if (channels.length === 1) return channels[0]!.slice();
	const len = channels[0]!.length;
	const out = new Float32Array(len);
	const n = channels.length;
	for (let i = 0; i < len; i++) {
		let sum = 0;
		for (const ch of channels) sum += ch[i] ?? 0;
		const avg = sum / n;
		out[i] = avg > 1 ? 1 : avg < -1 ? -1 : avg;
	}
	return out;
}

/** Keep at most `maxSec` of audio starting at sample 0. */
export function trimTo(pcm: Float32Array, sampleRate: number, maxSec: number): Float32Array {
	const cap = Math.max(0, Math.floor(sampleRate * Math.max(0, maxSec)));
	if (pcm.length <= cap) return pcm.slice();
	return pcm.subarray(0, cap).slice();
}

/** Encode mono float PCM as a canonical 16-bit PCM WAV file (44-byte header). */
export function encodeWav(pcm: Float32Array, sampleRate: number): Uint8Array {
	const dataBytes = pcm.length * 2;
	const bytes = new Uint8Array(44 + dataBytes);
	const view = new DataView(bytes.buffer);
	const ascii = (offset: number, text: string) => {
		for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
	};
	ascii(0, 'RIFF');
	view.setUint32(4, 36 + dataBytes, true); // rest-of-file size
	ascii(8, 'WAVE');
	ascii(12, 'fmt ');
	view.setUint32(16, 16, true); // fmt chunk size
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, 1, true); // mono
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true); // byte rate = rate × channels × 2
	view.setUint16(32, 16, true); // bits per sample
	view.setUint16(34, 2, true); // block align = channels × 2
	ascii(36, 'data');
	view.setUint32(40, dataBytes, true);
	for (let i = 0; i < pcm.length; i++) {
		const s = pcm[i]! > 1 ? 1 : pcm[i]! < -1 ? -1 : pcm[i]!;
		view.setInt16(44 + i * 2, Math.round(s * 32767), true);
	}
	return bytes;
}

export interface ExtractedSound {
	/** WAV file ready for `soundIO.importBlob` / library add. */
	file: File;
	/** Duration of the extracted (possibly trimmed) audio, seconds. */
	durationSec: number;
	/** True when the source ran past the cap and was cut. */
	trimmed: boolean;
}

/** Friendly failures surfaced straight into toasts. */
export class SoundFromVideoError extends Error {}

/**
 * Pull the audio track out of a remote video URL and hand it back as a
 * library-ready WAV File. `onProgress` reports the byte fetch (0–100);
 * decode itself is offline (fast, no realtime playback).
 */
export async function extractVideoAudio(
	url: string,
	options: { maxSeconds?: number; onProgress?: (percent: number) => void; label?: string } = {}
): Promise<ExtractedSound> {
	const maxSec = Math.min(
		Math.max(options.maxSeconds ?? MAX_VIDEO_SOUND_SECONDS, 1),
		MAX_VIDEO_SOUND_SECONDS
	);

	const response = await fetchRemoteMedia(url);
	if (!response) throw new SoundFromVideoError('Could not fetch that video — try another source');
	const total = Number(response.headers.get('content-length') ?? '');
	const reader = response.body?.getReader();
	let blob: Blob;
	if (!reader) {
		blob = await response.blob();
		options.onProgress?.(100);
	} else {
		const chunks: BlobPart[] = [];
		let loaded = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value as unknown as BlobPart);
			loaded += value.byteLength;
			if (Number.isFinite(total) && total > 0) {
				options.onProgress?.(Math.min(99, Math.round((loaded / total) * 100)));
			}
		}
		blob = new Blob(chunks, { type: response.headers.get('content-type') ?? 'video/mp4' });
		options.onProgress?.(100);
	}
	if (!blob.size) throw new SoundFromVideoError('That video came back empty — try another source');

	const AudioCtx = typeof window !== 'undefined' ? window.AudioContext : undefined;
	if (!AudioCtx) throw new SoundFromVideoError('This browser cannot decode audio');
	const ctx = new AudioCtx();
	let buffer: AudioBuffer;
	try {
		buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
	} catch {
		throw new SoundFromVideoError('No decodable audio track in that video');
	} finally {
		void ctx.close().catch(() => undefined);
	}
	if (!buffer.length) throw new SoundFromVideoError('That video has no audio track');

	const channels: Float32Array[] = [];
	for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c).slice());
	const mono = trimTo(monoMix(channels), buffer.sampleRate, maxSec);
	const pcm = encodeWav(mono, buffer.sampleRate);
	const durationSec = Math.round((mono.length / buffer.sampleRate) * 1000) / 1000;
	if (durationSec < 0.05) throw new SoundFromVideoError('That video has no audio track');
	const base = (options.label ?? 'video-sound').replace(/[^a-z0-9-_]+/gi, '-').slice(0, 32);
	return {
		file: new File([pcm as BlobPart], `${base || 'video-sound'}.wav`, { type: 'audio/wav' }),
		durationSec,
		trimmed: buffer.duration > maxSec + 0.05
	};
}
