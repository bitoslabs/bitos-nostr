/**
 * Bitz Buddy — the BitOS mascot system (spec docs/source/templete/tp-bitcoin.md
 * §16–17: "Bitz Buddy", cute bitcoin coin + chaotic meme reactions; signature
 * orange sneakers, lightning sparks, huge expressive eyes).
 *
 * A buddy figure is a sticker-grade IMAGE asset (SVG, bundled) that rides the
 * studio's existing image-LAYER pipeline (`MemeImageOverlay`) — movable,
 * resizable, timed, remix-wired — instead of a new overlay type. Zero schema
 * migration.
 *
 *  - assets are bundled under `static/bitz-buddy/` so the src is a plain
 *    same-origin path (https in production; the layer pipeline's CORS-aware
 *    fetch handles same-origin trivially);
 *  - emotions map to the pack names from the spec's emotion/action list;
 *  - the catalog is pure data — templates and the picker both read it.
 */

/** One buddy variant — an emotion/pose from the spec's asset list. */
export interface BuddyFigure {
	id: string;
	/** Static asset path (same-origin; bundled by Vite). */
	src: string;
	label: string;
	/** Emoji hint shown in compact UIs beside the label. */
	emoji: string;
}

const FIGURE = (id: string, label: string, emoji: string): BuddyFigure => ({
	id,
	src: `/bitz-buddy/${id}.svg`,
	label,
	emoji
});

/** The V1 pack — 10 figures: base + 9 expressions/poses (spec §8 lists 12
 *  emotions; sad/cry/proud/sleepy fold onto the closest shipped face). */
export const BUDDY_FIGURES: readonly BuddyFigure[] = [
	FIGURE('buddy', 'Buddy', '🙂'),
	FIGURE('shock', 'Shock', '😱'),
	FIGURE('laugh', 'Laugh', '😂'),
	FIGURE('panic', 'Panic', '😰'),
	FIGURE('angry', 'Angry', '😤'),
	FIGURE('thinking', 'Thinking', '🤔'),
	FIGURE('dead-inside', 'Dead inside', '💀'),
	FIGURE('hodl-zen', 'HODL zen', '🧘'),
	FIGURE('moon', 'To the moon', '🚀'),
	FIGURE('facepalm', 'Facepalm', '🤦')
];

/** Lookup by figure id (templates reference buddies this way). */
export function buddyFigure(id: string): BuddyFigure | null {
	return BUDDY_FIGURES.find((f) => f.id === id) ?? null;
}

/** Same-origin bundled asset — the layer pipeline allows these alongside
 *  remote https URLs (see image-overlay.ts `layerSrcOk`). */
export function isBuddySrc(src: string): boolean {
	return /^\/bitz-buddy\/[a-z0-9-]+\.svg$/.test(src.trim());
}
