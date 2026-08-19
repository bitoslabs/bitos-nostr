/**
 * BitOS brand primitives shared by the hex mark components — kept in sync
 * with `static/bitos-lightning-bolt.svg` (the lightning bolt extracted
 * from the official logo).
 */

/** Lightning bolt path (viewBox 0 0 664 297, fill-rule evenodd). */
export const BOLT_PATH =
	'M 0,296 C 37,254 69,222 99,195 C 135,163 168,139 199,121 L 313,51 C 317,49 320,52 318,57 L 306,119 C 370,81 429,55 484,36 C 547,14 606,3 664,0 C 619,14 580,29 548,45 C 508,65 472,83 441,99 C 397,122 354,149 312,180 L 231,243 C 227,246 228,241 229,236 L 241,160 C 195,184 148,211 101,241 C 65,264 31,282 0,296 Z';

/** Yellow → Bitcoin-orange gradient stops for the bare bolt. */
export const BOLT_GRADIENT_STOPS = ['#FFD83D', '#FFB51B', '#F7931A'] as const;

/** Badge/cell fill gradient (boot-splash hex language). */
export const BADGE_GRADIENT = 'linear-gradient(135deg,#FFB51B,#F7931A)';
