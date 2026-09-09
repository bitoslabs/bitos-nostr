import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import MemeSoundDialog from './MemeSoundDialog.svelte';
import { SFX_DURATIONS, SFX_LABELS } from '$lib/meme/sound-catalog';

/**
 * "Use a sound from a video" section: recent bitz show as thumbnail cards
 * and a pasted URL grows a live first-frame preview before extraction.
 * The synth/library cue-sheet UX is exercised through the studio, not here.
 */
const base = {
	labels: SFX_LABELS,
	durations: SFX_DURATIONS,
	libraryLabel: () => undefined,
	libraryDuration: () => undefined,
	onPreviewSynth: vi.fn(),
	onPreviewLibrary: vi.fn(),
	onStopPreview: vi.fn(),
	onAddSynth: vi.fn(),
	onAddLibrary: vi.fn(),
	onRemoveLibrary: vi.fn(),
	onImportAudio: vi.fn(),
	onToggleMic: vi.fn(),
	onPauseResumeMic: vi.fn()
};

describe('MemeSoundDialog — use a sound from a video', () => {
	it('shows recent bitz as thumbnail chips and grabs audio on tap', async () => {
		const onAddFromVideo = vi.fn();
		const screen = await render(MemeSoundDialog, {
			...base,
			open: true,
			videoSources: [
				{
					id: 'r1',
					label: 'gm reel',
					url: 'https://cdn.example.com/gm.mp4',
					thumb: 'https://img.example.com/gm.jpg'
				},
				{ id: 'r2', label: 'no thumb reel', url: 'https://cdn.example.com/nt.mp4' }
			],
			onAddFromVideo
		});
		// The accessible name is the chip's caption; the title only describes it.
		const chip = screen.getByRole('button', { name: 'gm reel' });
		await expect.element(chip).toBeVisible();
		// The imeta thumb rides the chip; the thumbless one shows the placeholder.
		await expect
			.element(chip.getByAltText(''))
			.toHaveAttribute('src', 'https://img.example.com/gm.jpg');
		await chip.click();
		expect(onAddFromVideo).toHaveBeenCalledWith({
			label: 'gm reel',
			url: 'https://cdn.example.com/gm.mp4'
		});
		const bare = screen.getByRole('button', { name: 'no thumb reel' });
		// No <img> on the thumbless chip — the clapperboard placeholder shows.
		expect(bare.getByAltText('').query()).toBeNull();
	});

	it('grows a live preview card once a pasted URL settles', async () => {
		const screen = await render(MemeSoundDialog, {
			...base,
			open: true,
			onAddFromVideo: vi.fn()
		});
		const input = screen.getByRole('textbox', { name: 'Video URL to grab audio from' });
		// Not URL-shaped yet: no preview card at all.
		await input.fill('almost a url');
		expect(screen.getByText('cdn.example.com').query()).toBeNull();
		await input.fill('https://cdn.example.com/clip.mp4');
		// The 450ms debounce keeps the <video> from re-probing per keystroke,
		// then the card names the host so the grab target is unambiguous.
		await expect.element(screen.getByText('cdn.example.com')).toBeVisible();
	});
});
