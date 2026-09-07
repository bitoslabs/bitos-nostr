import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import MemeMediaHubDialog from './MemeMediaHubDialog.svelte';

/**
 * Hub dialog browser tests — sticker/emoji/builder UX only. The Packs tab
 * (relay discovery) and the GIFs tab (Giphy feed) are deliberately not
 * exercised here: they are thin wrappers over surfaces covered elsewhere and
 * would require live network.
 */
describe('MemeMediaHubDialog (browser)', () => {
	it('adds glyph emoji stickers from the Emoji tab', async () => {
		const onAdd = vi.fn();
		const screen = await render(MemeMediaHubDialog, { open: true, onAdd });
		await screen.getByRole('button', { name: 'Add 🚀 sticker' }).click();
		expect(onAdd).toHaveBeenCalledWith('🚀');
	});

	it('collects icons into the pack basket, then builds them in My pack', async () => {
		const screen = await render(MemeMediaHubDialog, { open: true, onAdd: vi.fn() });

		// Arm collect mode from the Icons tab…
		await screen.getByRole('button', { name: /^Icons$/ }).click();
		await screen.getByRole('button', { name: /Build my own pack/ }).click();
		await expect
			.element(screen.getByRole('button', { name: /^Collecting for My pack/ }))
			.toBeVisible();

		// …pick a popular icon tile → it feeds the basket, not the stage.
		await screen
			.getByRole('button', { name: /as an SVG sticker/ })
			.first()
			.click();

		// The basket tray follows across tabs and jumps to the builder.
		const tray = screen.getByRole('button', { name: /collected — build my pack/ });
		await expect.element(tray).toBeVisible();
		await tray.click();

		// Builder: entry present with its auto shortcode, export enabled.
		const code = screen.getByRole('textbox', { name: 'Shortcode for heart' });
		await expect.element(code).toHaveValue('heart');
		await expect.element(screen.getByRole('button', { name: 'Export JSON' })).toBeEnabled();

		// Inline rename updates the :shortcode: preview (mass-production hygiene).
		await code.fill('laser_eyes');
		await expect.element(screen.getByText(':laser_eyes:')).toBeVisible();
	});

	it('guards the builder empty state — export disabled, guided start', async () => {
		const screen = await render(MemeMediaHubDialog, { open: true, onAdd: vi.fn() });
		await screen.getByRole('button', { name: /^My pack$/ }).click();

		// Empty basket: both export actions stay disabled.
		await expect.element(screen.getByRole('button', { name: 'Publish to Nostr' })).toBeDisabled();
		await expect.element(screen.getByRole('button', { name: 'Export JSON' })).toBeDisabled();

		// The empty state offers the fastest path into collecting.
		await expect.element(screen.getByRole('button', { name: /Start collecting/ })).toBeVisible();
	});
});
