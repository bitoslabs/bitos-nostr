import { describe, expect, it } from 'vitest';
import { IMAGE_LAYOUTS, type MemeImageLayout } from '$lib/components/bitz/meme-studio-config';
import { normalizeOverlay } from '$lib/meme/schema';

describe('IMAGE_LAYOUTS (tp-2 p.784)', () => {
	it('ships the spec layout list', () => {
		const ids = IMAGE_LAYOUTS.map((l) => l.id);
		// Spec: Two Panel, Four Panel, Drake-style, Quote, Screenshot Meme,
		// Chat Meme, Breaking News (Drake/Expectation/Before-After already live
		// as video-side TIMED templates).
		for (const id of [
			'layout-two-panel',
			'layout-four-panel',
			'layout-quote',
			'layout-screenshot',
			'layout-chat',
			'layout-breaking-news'
		]) {
			expect(ids).toContain(id);
		}
	});

	it('re-validates every layout through the wire normalizer', () => {
		for (const layout of IMAGE_LAYOUTS as readonly MemeImageLayout[]) {
			expect(layout.label, layout.id).toBeTruthy();
			expect(layout.hint, layout.id).toBeTruthy();
			for (const raw of layout.overlays()) {
				const o = normalizeOverlay(raw);
				expect(o, `${layout.id}: overlay must survive normalize`).not.toBeNull();
				expect(o!.text.trim()).not.toBe('');
			}
		}
	});

	it('keeps layouts static — no timed windows ride along', () => {
		for (const layout of IMAGE_LAYOUTS as readonly MemeImageLayout[]) {
			for (const o of layout.overlays()) {
				expect(o.startMs, `${layout.id}`).toBeUndefined();
				expect(o.endMs, `${layout.id}`).toBeUndefined();
			}
		}
	});

	it('scaffolds the two-panel contrast symmetric about center', () => {
		const panels = IMAGE_LAYOUTS.find((l) => l.id === 'layout-two-panel')!.overlays();
		expect(panels.length).toBe(2);
		const [top, bottom] = panels.map((p) => p.y);
		expect(top!).toBeLessThan(0.5);
		expect(bottom!).toBeGreaterThan(0.5);
	});

	it('scaffolds the four-panel grid as quadrants', () => {
		const quads = IMAGE_LAYOUTS.find((l) => l.id === 'layout-four-panel')!.overlays();
		expect(quads.length).toBe(4);
		const xs = new Set(quads.map((q) => q.x));
		const ys = new Set(quads.map((q) => q.y));
		expect(xs.size).toBe(2); // left/right columns
		expect(ys.size).toBe(2); // top/bottom rows
	});
});
