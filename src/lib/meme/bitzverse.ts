/**
 * Bitzverse props (tp-bitcoin.md §14) — the mascot's world: lightning cloud,
 * sat sparks, nostr portal, relay road, meme lab, fiat monster, bug monster,
 * moon elevator. Scene-setting stickers for the meme lab canvases.
 *
 * Same pipeline as the buddy pack: bundled static SVGs riding the image-LAYER
 * system (`MemeImageOverlay`) — movable, resizable, timed, remix-wired, and
 * now motion-capable (layer-motion.ts).
 */

import type { BuddyFigure } from './bitz-buddy';

const PROP = (id: string, label: string, emoji: string, motion: string): BuddyFigure => ({
	id,
	src: `/bitzverse/${id}.svg`,
	label,
	emoji,
	motion
});

/** World props — one per §14 world idea. */
export const BITZVERSE_PROPS: readonly BuddyFigure[] = [
	PROP('lightning-cloud', 'Lightning cloud', '⛈️', 'wiggle'),
	PROP('sat-sparks', 'Sat sparks', '✨', 'pop'),
	PROP('nostr-portal', 'Nostr portal', '🌀', 'breathe'),
	PROP('relay-road', 'Relay road', '📡', 'none'),
	PROP('meme-lab', 'Meme lab', '🧪', 'none'),
	PROP('fiat-monster', 'Fiat monster', '👹', 'wiggle'),
	PROP('bug-monster', 'Bug monster', '🐛', 'wiggle'),
	PROP('moon-elevator', 'Moon elevator', '🌗', 'breathe')
];

/** Lookup by prop id. */
export function bitzverseProp(id: string): BuddyFigure | null {
	return BITZVERSE_PROPS.find((p) => p.id === id) ?? null;
}

/** Same-origin bundled world-prop path (gate + direct fetch, like buddies). */
export function isBitzverseSrc(src: string): boolean {
	return /^\/bitzverse\/[a-z0-9-]+\.svg$/.test(src.trim());
}
