import { describe, expect, it } from 'vitest';

import { BUDDY_FIGURES, isBuddySrc } from './bitz-buddy';
import { BITZVERSE_PROPS, bitzverseProp, isBitzverseSrc } from './bitzverse';
import { LAYER_MOTION_IDS, layerMotionOf } from './layer-motion';
import { layerSrcOk, normalizeImageOverlay } from './image-overlay';

describe('BITZVERSE_PROPS (§14 world)', () => {
	it('ships the eight spec props with unique bundled ids', () => {
		expect(BITZVERSE_PROPS.length).toBe(8);
		const ids = new Set(BITZVERSE_PROPS.map((p) => p.id));
		expect(ids.size).toBe(8);
		for (const p of BITZVERSE_PROPS) {
			expect(p.src).toBe(`/bitzverse/${p.id}.svg`);
			expect(p.label.length).toBeGreaterThan(2);
			expect(p.emoji).toBeTruthy();
		}
		expect(ids).toContain('lightning-cloud');
		expect(ids).toContain('sat-sparks');
		expect(ids).toContain('nostr-portal');
		expect(ids).toContain('relay-road');
		expect(ids).toContain('meme-lab');
		expect(ids).toContain('fiat-monster');
		expect(ids).toContain('bug-monster');
		expect(ids).toContain('moon-elevator');
	});

	it('defaults every prop motion to a legal layer motion', () => {
		for (const p of BITZVERSE_PROPS) {
			if (p.motion === 'none') continue;
			expect(LAYER_MOTION_IDS).toContain(p.motion);
			expect(layerMotionOf(p.motion)).toBe(p.motion);
		}
	});

	it('looks props up by id and rejects strangers', () => {
		expect(bitzverseProp('moon-elevator')?.src).toBe('/bitzverse/moon-elevator.svg');
		expect(bitzverseProp('nope')).toBeNull();
	});

	it('does not collide with the buddy pack', () => {
		const buddyIds = new Set(BUDDY_FIGURES.map((f) => f.id));
		for (const p of BITZVERSE_PROPS) {
			expect(buddyIds.has(p.id)).toBe(false);
		}
	});
});

describe('isBitzverseSrc', () => {
	it('accepts only bundled bitzverse sticker paths', () => {
		expect(isBitzverseSrc('/bitzverse/moon-elevator.svg')).toBe(true);
		expect(isBitzverseSrc('  /bitzverse/fiat-monster.svg  ')).toBe(true);
		expect(isBitzverseSrc('/static/bitzverse/nope.svg')).toBe(false);
		expect(isBitzverseSrc('/bitzverse/BAD.svg')).toBe(false);
		expect(isBitzverseSrc('/bitzverse/bug.png')).toBe(false);
		expect(isBitzverseSrc('../bitzverse/relay-road.svg')).toBe(false);
		expect(isBitzverseSrc('https://bitz.app/bitzverse/sat-sparks.svg')).toBe(false);
		expect(isBitzverseSrc('/bitz-buddy/buddy.svg')).toBe(false);
	});

	it('feeds layerSrcOk and the overlay pipeline', () => {
		expect(layerSrcOk('/bitzverse/meme-lab.svg')).toBe(true);
		expect(layerSrcOk('/bitzverse/nope/injection.svg')).toBe(false);
		const normalized = normalizeImageOverlay({
			id: 'world1',
			src: '/bitzverse/nostr-portal.svg',
			x: 0.5,
			y: 0.4,
			size: 0.3
		});
		expect(normalized?.src).toBe('/bitzverse/nostr-portal.svg');
	});
});
