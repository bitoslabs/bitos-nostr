/**
 * Meme draft persistence tests — plan Phase-1 F-010 "draft recovery".
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: true }));

import {
	MEME_DRAFT_KEY,
	MEME_DRAFT_VERSION,
	createMemeDraftWriter,
	draftDrawingGroups,
	draftOverlays,
	draftMediaFile,
	mediaToDraftDataUrl,
	readMemeDraft
} from './meme-drafts';

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
	getItem: (k: string) => memory.get(k) ?? null,
	setItem: (k: string, v: string) => void memory.set(k, v),
	removeItem: (k: string) => void memory.delete(k),
	clear: () => void memory.clear()
});

function overlay(text: string, y = 0.5) {
	return {
		id: `o-${text}`,
		text,
		x: 0.5,
		y,
		size: 1,
		color: '#ffffff',
		stroke: '#000000',
		font: 'impact' as const,
		startMs: 0,
		endMs: null
	};
}

afterEach(() => {
	memory.clear();
	vi.useRealTimers();
});

describe('readMemeDraft', () => {
	it('returns null for absent storage', () => {
		expect(readMemeDraft()).toBeNull();
	});

	it('round-trips a written draft', () => {
		memory.set(
			MEME_DRAFT_KEY,
			JSON.stringify({
				version: MEME_DRAFT_VERSION,
				savedAt: 1,
				media: null,
				overlays: [overlay('TOP', 0.12), overlay('BOTTOM', 0.86)],
				caption: 'hello',
				sensitive: false,
				destination: 'note',
				selectedId: 'o-TOP'
			})
		);
		const draft = readMemeDraft();
		expect(draft?.caption).toBe('hello');
		expect(draft?.destination).toBe('note');
		expect(draftOverlays(draft!)).toHaveLength(2);
	});

	it('rejects foreign versions and blank drafts', () => {
		memory.set(MEME_DRAFT_KEY, JSON.stringify({ version: 99, caption: 'x', savedAt: 1 }));
		expect(readMemeDraft()).toBeNull();
		memory.set(
			MEME_DRAFT_KEY,
			JSON.stringify({
				version: MEME_DRAFT_VERSION,
				savedAt: 1,
				media: null,
				overlays: [],
				caption: '   ',
				sensitive: false,
				destination: 'bitz',
				selectedId: null
			})
		);
		expect(readMemeDraft()).toBeNull();
	});

	it('drops corrupted overlay rows instead of failing', () => {
		const draft = {
			version: MEME_DRAFT_VERSION,
			savedAt: 1,
			media: null,
			overlays: [{ nonsense: true }, overlay('ok'), 42],
			caption: 'c',
			sensitive: false,
			destination: 'bitz',
			selectedId: null
		};
		memory.set(MEME_DRAFT_KEY, JSON.stringify(draft));
		const restored = draftOverlays(readMemeDraft()!);
		expect(restored).toHaveLength(1);
		expect(restored[0].text).toBe('ok');
	});

	it('restores valid drawing strokes and drops corrupted rows', () => {
		const draft = {
			version: MEME_DRAFT_VERSION,
			savedAt: 1,
			media: null,
			overlays: [],
			drawingGroups: [
				{
					id: 'drawing-1',
					label: 'Ink',
					playback: 'static',
					startMs: 0,
					visibleFromMs: 0,
					strokes: [
						{
							id: 'stroke-1',
							tool: 'pen',
							color: '#ffffff',
							width: 0.01,
							opacity: 1,
							points: [{ x: 0.1, y: 0.2, atMs: 0 }]
						}
					]
				},
				{ strokes: [{ nonsense: true }] }
			],
			caption: '',
			sensitive: false,
			destination: 'bitz' as const,
			selectedId: null
		};
		memory.set(MEME_DRAFT_KEY, JSON.stringify(draft));
		const restored = draftDrawingGroups(readMemeDraft()!);
		expect(restored).toHaveLength(1);
		expect(restored[0].strokes[0].points).toHaveLength(1);
	});
});

describe('createMemeDraftWriter', () => {
	it('debounces writes and flushes on demand', () => {
		vi.useFakeTimers();
		const writer = createMemeDraftWriter();
		writer.write({
			media: null,
			overlays: [overlay('a')],
			caption: 'first',
			sensitive: false,
			destination: 'story',
			selectedId: null
		});
		writer.write({
			media: null,
			overlays: [overlay('b')],
			caption: 'second',
			sensitive: false,
			destination: 'story',
			selectedId: null
		});
		expect(memory.has(MEME_DRAFT_KEY)).toBe(false); // still debouncing
		vi.advanceTimersByTime(600);
		const draft = readMemeDraft();
		expect(draft?.caption).toBe('second'); // last write wins
		expect(draft?.overlays).toHaveLength(1);

		writer.write({
			media: null,
			overlays: [],
			caption: 'flushed',
			sensitive: true,
			destination: 'note',
			selectedId: null
		});
		writer.flush();
		expect(readMemeDraft()?.caption).toBe('flushed');
		expect(readMemeDraft()?.sensitive).toBe(true);
	});

	it('clear removes stored draft and pending write', () => {
		vi.useFakeTimers();
		const writer = createMemeDraftWriter();
		writer.write({
			media: null,
			overlays: [],
			caption: 'bye',
			sensitive: false,
			destination: 'bitz',
			selectedId: null
		});
		writer.clear();
		vi.advanceTimersByTime(600);
		expect(readMemeDraft()).toBeNull(); // cleared pending never lands
	});
});

describe('media serialization', () => {
	it('serializes and restores a small file', async () => {
		const file = new File([new Uint8Array([1, 2, 3, 4])], 'pic.png', { type: 'image/png' });
		const media = await mediaToDraftDataUrl(file);
		expect(media).not.toBeNull();
		expect(media!.mimeType).toBe('image/png');

		const draft = {
			version: MEME_DRAFT_VERSION,
			savedAt: 1,
			media: media!,
			overlays: [],
			caption: 'c',
			sensitive: false,
			destination: 'bitz' as const,
			selectedId: null
		};
		const restored = await draftMediaFile(draft);
		expect(restored).not.toBeNull();
		expect(restored!.file.name).toBe('pic.png');
		expect(restored!.file.type).toBe('image/png');
		expect(restored!.file.size).toBe(4);
	});

	it('skips files over the localStorage-safe cap', async () => {
		const big = new File([new Uint8Array(4 * 1024 * 1024)], 'huge.mp4', { type: 'video/mp4' });
		expect(await mediaToDraftDataUrl(big)).toBeNull();
	});
});
