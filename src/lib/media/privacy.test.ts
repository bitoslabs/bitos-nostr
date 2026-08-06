import { describe, expect, it, vi } from 'vitest';
import { buildNeutralUploadName, canStripImageMetadata } from './privacy';

describe('media privacy helpers', () => {
	it('marks supported image types for metadata stripping', () => {
		expect(canStripImageMetadata(new File(['x'], 'photo.jpg', { type: 'image/jpeg' }))).toBe(true);
		expect(canStripImageMetadata(new File(['x'], 'clip.mp4', { type: 'video/mp4' }))).toBe(false);
		expect(canStripImageMetadata(new File(['x'], 'anim.gif', { type: 'image/gif' }))).toBe(false);
	});

	it('builds neutral upload names without preserving the original filename', () => {
		vi.spyOn(Date, 'now').mockReturnValue(1_725_000_000_000);
		vi.spyOn(Math, 'random').mockReturnValue(0.123456);
		const name = buildNeutralUploadName(
			new File(['x'], 'Vacation in Paris.mov', { type: 'video/quicktime' })
		);
		expect(name).toBe('bitos-video-1725000000000-4fzyo8.mov');
		expect(name).not.toContain('Vacation');
	});
});
