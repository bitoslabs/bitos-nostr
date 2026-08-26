import { describe, expect, it, vi } from 'vitest';
import { fetchSourceFile, MAX_SOURCE_BYTES, type SourceFileResult } from './source-fetch';

/** Stub the fetch layer inside fetchRemoteMedia with a plain Response-like. */
function mockFetch(mime: string, size: number, ok = true): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => ({
			ok,
			status: ok ? 200 : 404,
			headers: new Headers({ 'content-type': mime }),
			blob: async () => new Blob([new Uint8Array(size)], { type: mime })
		}))
	);
}

describe('fetchSourceFile', () => {
	it('accepts an image URL and returns a stage-ready File', async () => {
		mockFetch('image/gif', 1024);
		const res = await fetchSourceFile('https://x.test/a.gif', { label: 'GIF' });
		expect(res.ok).toBe(true);
		expect(res.file).toBeInstanceOf(File);
		expect(res.file?.name).toMatch(/^GIF-\d+\.gif$/);
		expect(res.mime).toBe('image/gif');
	});

	it('reports byte progress for a streamed remix source', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				new Response(new Uint8Array([1, 2, 3, 4]), {
					headers: { 'content-type': 'image/png', 'content-length': '4' }
				})
			)
		);
		const progress: number[] = [];
		const res = await fetchSourceFile('https://x.test/remix.png', {
			onProgress: (percent) => progress.push(percent)
		});
		expect(res.ok).toBe(true);
		expect(progress.at(-1)).toBe(100);
		expect(progress.some((percent) => percent > 0 && percent < 100)).toBe(true);
	});

	it('rejects non-media mime with actionable copy', async () => {
		mockFetch('text/html', 10);
		const res = await fetchSourceFile('https://x.test/page');
		expect(res.ok).toBe(false);
		expect(res.error).toBe('That link is not a picture or video');
	});

	it('enforces the video/image type gate', async () => {
		mockFetch('video/mp4', 512);
		const img = await fetchSourceFile('https://x.test/a.mp4', { accept: 'image' });
		expect(img.ok).toBe(false);
		const vid = await fetchSourceFile('https://x.test/a.mp4', { accept: 'video' });
		expect(vid.ok).toBe(true);
	});

	it('enforces per-kind byte caps with human copy', async () => {
		mockFetch('image/png', 60 * 1024 * 1024);
		const res = await fetchSourceFile('https://x.test/big.png', {
			maxBytes: { image: 50 * 1024 * 1024, video: MAX_SOURCE_BYTES }
		});
		expect(res.ok).toBe(false);
		expect(res.error).toContain('50.0 MB');
	});

	it('turns fetch failure into ok:false instead of throwing', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('network down');
			})
		);
		const res = await fetchSourceFile('https://x.test/x.gif');
		expect(res.ok).toBe(false);
		// fetchRemoteMedia swallows network errors into a null response →
		// the studio surfaces the generic CORS/host copy.
		expect(res.error).toBe('CORS-blocked host');
	});

	it('refuses empty URLs', async () => {
		const res: SourceFileResult = await fetchSourceFile('   ');
		expect(res.ok).toBe(false);
	});

	it('names files from the sanitized label', async () => {
		mockFetch('video/quicktime', 64);
		const res = await fetchSourceFile('https://x.test/v', { label: 'My Clip!!' });
		expect(res.file?.name).toMatch(/^My-Clip-\d+\.mov$/);
	});
});
