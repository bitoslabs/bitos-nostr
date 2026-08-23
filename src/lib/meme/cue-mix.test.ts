import { describe, expect, it } from 'vitest';
import { buildCueMixBuffer } from './cue-mix';
import { CUSTOM_SOUND_KEY, type MemeSfxCue } from './schema';

// A minimal fake OfflineAudioContext: records createBuffer/start calls so we
// can assert the custom PCM got scheduled; startRendering resolves a stub.
let fakeBuffers: { length: number; sampleRate: number; data: Float32Array }[] = [];
let fakeStarts: number[] = [];

const fakeOffline = {
	createBuffer(_channels: number, length: number, sampleRate: number) {
		const entry = { length, sampleRate, data: new Float32Array(length) };
		fakeBuffers.push(entry);
		return {
			length,
			sampleRate,
			getChannelData: () => entry.data
		};
	},
	createBufferSource() {
		return {
			buffer: null as unknown,
			connect() {
				return { connect() {} };
			},
			start(when: number) {
				fakeStarts.push(when);
			}
		};
	},
	createGain() {
		return {
			gain: {
				value: 0,
				setValueAtTime() {},
				linearRampToValueAtTime() {},
				exponentialRampToValueAtTime() {}
			},
			connect() {
				return { connect() {} };
			}
		};
	},
	createOscillator() {
		return {
			type: 'sine' as OscillatorType,
			frequency: { setValueAtTime() {}, linearRampToValueAtTime() {} },
			connect() {
				return { connect() {} };
			},
			start(when: number) {
				fakeStarts.push(when);
			},
			stop() {}
		};
	},
	get destination() {
		return {};
	},
	startRendering() {
		return Promise.resolve({} as AudioBuffer);
	}
};

// `renderSfxTrack` news its ctor — wrap the shared fake instance in a
// constructible shell so every `new` reuses the same recording object.
const offlineCtor = class {
	constructor() {
		return fakeOffline;
	}
} as unknown as typeof OfflineAudioContext;

function resetFake() {
	fakeBuffers = [];
	fakeStarts = [];
}

describe('buildCueMixBuffer', () => {
	const pcm = new Float32Array(44100);
	pcm[100] = 0.75;

	const cues: MemeSfxCue[] = [
		{ id: 'a', sfx: 'custom', soundId: 'snd-1', atMs: 500, gain: 1 },
		{ id: 'b', sfx: 'boom', atMs: 1000, gain: 1 }
	];

	it('renders a mixed buffer for synth + custom cues', async () => {
		resetFake();
		const buffer = await buildCueMixBuffer(cues, 2, {
			offlineCtor,
			decodeSound: async (id) => (id === 'snd-1' ? { pcm, sampleRate: 44100 } : null)
		});
		expect(buffer).toBeDefined();
		// One PCM buffer (custom) + boom's three oscillator notes were scheduled.
		expect(fakeBuffers).toHaveLength(1);
		expect(fakeStarts.length).toBeGreaterThanOrEqual(4);
	});

	it('returns null for empty cues or zero duration', async () => {
		resetFake();
		expect(
			await buildCueMixBuffer([], 2, { offlineCtor, decodeSound: async () => null })
		).toBeNull();
		expect(
			await buildCueMixBuffer(cues, 0, { offlineCtor, decodeSound: async () => null })
		).toBeNull();
	});

	it('skips custom cues whose sound cannot be decoded', async () => {
		resetFake();
		await buildCueMixBuffer(
			[
				{ id: 'x', sfx: CUSTOM_SOUND_KEY, soundId: 'gone', atMs: 0, gain: 1 },
				{ id: 'y', sfx: 'pop', atMs: 100, gain: 1 }
			],
			1,
			{ offlineCtor, decodeSound: async () => null }
		);
		// Only the synthesized pop rendered — no PCM buffer was created.
		expect(fakeBuffers).toHaveLength(0);
		expect(fakeStarts.length).toBeGreaterThanOrEqual(2);
	});
});
