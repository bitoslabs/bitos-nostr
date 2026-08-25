import { describe, expect, it } from 'vitest';
import {
	MAX_OVERLAYS,
	MAX_OVERLAY_CHARS,
	MEME_SCHEMA,
	MEME_SCHEMA_VERSION,
	makeClassicPair,
	makeOverlay,
	normalizeOverlay,
	normalizeProject,
	overlayVisibleAt,
	type MemeTextOverlay
} from './schema';
import { wrapLines } from './render';

describe('normalizeOverlay', () => {
	it('fills sane defaults for a minimal overlay', () => {
		const o = normalizeOverlay({ text: 'gm nostr' })!;
		expect(o.x).toBe(0.5);
		expect(o.y).toBe(0.5);
		expect(o.size).toBe(0.09);
		expect(o.font).toBe('impact');
		expect(o.caps).toBe(true);
		expect(o.stroke).toBe(true);
		expect(o.bar).toBe(false);
		expect(o.id).toBeTruthy();
	});

	it('rejects empty / non-object input', () => {
		expect(normalizeOverlay(null)).toBeNull();
		expect(normalizeOverlay(undefined)).toBeNull();
		expect(normalizeOverlay('text')).toBeNull();
		expect(normalizeOverlay({ text: '   ' })).toBeNull();
		expect(normalizeOverlay({})).toBeNull();
	});

	it('clamps position and size into legal ranges', () => {
		const o = normalizeOverlay({ text: 'x', x: -3, y: 42, size: 5 })!;
		expect(o.x).toBe(0);
		expect(o.y).toBe(1);
		expect(o.size).toBe(0.22);
		const tiny = normalizeOverlay({ text: 'x', size: 0.0001 })!;
		expect(tiny.size).toBe(0.03);
	});

	it('truncates marathon captions to the cap', () => {
		const o = normalizeOverlay({ text: 'a'.repeat(MAX_OVERLAY_CHARS + 50) })!;
		expect(o.text.length).toBe(MAX_OVERLAY_CHARS);
	});

	it('falls back to a default color for garbage colors but keeps valid hex', () => {
		expect(normalizeOverlay({ text: 'x', color: 'javascript' })!.color).toBe('#ffffff');
		expect(normalizeOverlay({ text: 'x', color: '#FDE047' })!.color).toBe('#FDE047');
	});

	it('coerces unknown fonts back to impact and unknown flags to defaults', () => {
		const o = normalizeOverlay({ text: 'x', font: 'comic-sans', caps: 'nope' })!;
		expect(o.font).toBe('impact');
		expect(o.caps).toBe(true);
	});

	it('drops negative or non-finite timing windows', () => {
		expect(normalizeOverlay({ text: 'x', startMs: -100 })!.startMs).toBeUndefined();
		expect(normalizeOverlay({ text: 'x', startMs: 'soon' })!.startMs).toBeUndefined();
		expect(normalizeOverlay({ text: 'x', endMs: Number.NaN })!.endMs).toBeUndefined();
	});

	it('clears an inverted window (end ≤ start) to "always visible"', () => {
		const o = normalizeOverlay({ text: 'x', startMs: 2000, endMs: 1000 })!;
		expect(o.startMs).toBeUndefined();
		expect(o.endMs).toBeUndefined();
	});

	it('ignores unknown fields', () => {
		const o = normalizeOverlay({ text: 'x', hacked: true, emoji: '🚀' })!;
		expect('hacked' in o).toBe(false);
		expect('emoji' in o).toBe(false);
	});
});

describe('normalizeProject', () => {
	it('rejects foreign schemas and non-objects', () => {
		expect(normalizeProject(null)).toBeNull();
		expect(normalizeProject('nope')).toBeNull();
		expect(normalizeProject({ schema: 'com.other.meme', version: 1 })).toBeNull();
	});

	it('rejects too-new major versions (old client stays safe)', () => {
		expect(normalizeProject({ schema: MEME_SCHEMA, version: MEME_SCHEMA_VERSION + 1 })).toBeNull();
		expect(normalizeProject({ schema: MEME_SCHEMA, version: 0 })).toBeNull();
	});

	it('normalizes overlays and caps the count', () => {
		const overlays = Array.from({ length: MAX_OVERLAYS + 5 }, (_, i) => ({ text: `m${i}` }));
		const p = normalizeProject({ schema: MEME_SCHEMA, version: 1, overlays })!;
		expect(p.overlays.length).toBe(MAX_OVERLAYS);
		expect(p.schema).toBe(MEME_SCHEMA);
		expect(p.version).toBe(MEME_SCHEMA_VERSION);
	});

	it('drops blank overlays instead of crashing', () => {
		const p = normalizeProject({ schema: MEME_SCHEMA, overlays: [{ text: '' }, null, 7] })!;
		expect(p.overlays).toEqual([]);
	});
});

describe('overlayVisibleAt', () => {
	const always = makeOverlay({ text: 'always' });
	const windowed = makeOverlay({ text: 'mid', startMs: 1000, endMs: 2000 });

	it('always-visible overlays stay visible at any time', () => {
		expect(overlayVisibleAt(always, 0)).toBe(true);
		expect(overlayVisibleAt(always, 123_456)).toBe(true);
	});

	it('honors [start, end) semantics on boundaries', () => {
		expect(overlayVisibleAt(windowed, 0)).toBe(false);
		expect(overlayVisibleAt(windowed, 999)).toBe(false);
		expect(overlayVisibleAt(windowed, 1000)).toBe(true); // inclusive start
		expect(overlayVisibleAt(windowed, 1999)).toBe(true);
		expect(overlayVisibleAt(windowed, 2000)).toBe(false); // exclusive end
	});

	it('open-ended windows run forever', () => {
		const late = makeOverlay({ text: 'late', startMs: 1500 });
		expect(overlayVisibleAt(late, 1499)).toBe(false);
		expect(overlayVisibleAt(late, 1500)).toBe(true);
		expect(overlayVisibleAt(late, 10 ** 9)).toBe(true);
	});
});

describe('makeClassicPair', () => {
	it('places the canonical top/bottom Impact pair', () => {
		const [top, bottom] = makeClassicPair();
		expect(top.y).toBeLessThan(bottom.y);
		expect(top.text).toBe('TOP TEXT');
		expect(bottom.text).toBe('BOTTOM TEXT');
		expect(top.font).toBe('impact');
	});
});

describe('wrapLines', () => {
	const monoMeasure = (text: string) => text.length * 10;

	it('keeps short text on one line', () => {
		expect(wrapLines('gm', monoMeasure, 1000)).toEqual(['gm']);
	});

	it('greedily wraps words-free text at the width', () => {
		// mono: 10px/char — 'aaaa bbbb' measures 90px, so a 90px box fits two words.
		expect(wrapLines('aaaa bbbb cccc', monoMeasure, 90)).toEqual(['aaaa bbbb', 'cccc']);
		expect(wrapLines('aaaa bbbb cccc', monoMeasure, 45)).toEqual(['aaaa', 'bbbb', 'cccc']);
	});

	it('keeps an over-wide single word intact (the painter shrinks instead)', () => {
		// A word wider than the box is never split — renderImageMeme shrinks
		// the font until it fits, so wrapping stays purely word-boundary based.
		expect(wrapLines('AAAAAAAAAA', monoMeasure, 45)).toEqual(['AAAAAAAAAA']);
	});

	it('returns an empty list for empty input', () => {
		expect(wrapLines('', monoMeasure, 100)).toEqual([]);
	});
});

describe('overlay round-trip', () => {
	it('makeOverlay → normalizeOverlay is lossless for legal values', () => {
		const original: MemeTextOverlay = makeOverlay({
			text: 'wen laser eyes',
			x: 0.31,
			y: 0.77,
			size: 0.11,
			color: '#22d3ee',
			font: 'mono',
			bar: true,
			startMs: 250,
			endMs: 9000
		});
		expect(normalizeOverlay(original)).toEqual(original);
	});

	it('makeOverlay tolerates BLANK text (fresh captions start editable-empty)', () => {
		// Creation path: the wire parser drops empty text, but the editor's
		// “+ Caption” button must get a real (empty) overlay back, not null.
		const blank = makeOverlay({ y: 0.5 });
		expect(blank).not.toBeNull();
		expect(blank.text).toBe('');
		expect(blank.y).toBe(0.5);
		expect(blank.size).toBe(0.09);
		expect(blank.caps).toBe(true);
		// A seeded-timing blank (timeline insert) keeps its window.
		const timed = makeOverlay({ y: 0.5, startMs: 800, endMs: 2800 });
		expect(timed.text).toBe('');
		expect(timed.startMs).toBe(800);
		expect(timed.endMs).toBe(2800);
	});
});
