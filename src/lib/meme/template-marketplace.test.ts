import { describe, expect, it } from 'vitest';
import {
	TEMPLATE_CATEGORIES,
	TEMPLATE_PRICE_TIERS,
	normalizePriceSats,
	forCategory,
	marketplaceFromContent
} from './template-marketplace';
import { parseSharedTemplate } from './shared-templates';
import type { SharedTemplate } from './shared-templates';

function template(over: Partial<SharedTemplate> = {}): SharedTemplate {
	return {
		eventId: 'ev1',
		templateId: 't1',
		label: 'Meme',
		icon: 'i-lucide-bookmark',
		overlays: [
			{
				id: 'o1',
				text: 'HI',
				x: 0.5,
				y: 0.2,
				size: 0.08,
				color: '#fff',
				font: 'impact',
				caps: true,
				stroke: true,
				bar: false
			}
		],
		creatorPubkey: 'aaa',
		createdAt: 1000,
		...over
	};
}

function contentEvent(over: Record<string, unknown> = {}) {
	return {
		id: 'ev' + Math.random().toString(36).slice(2, 8),
		pubkey: 'pk-creator',
		created_at: 1700000000,
		kind: 30078,
		content: JSON.stringify({
			schema: 'com.bitos.bitz.template',
			version: 2,
			label: 'Paid layout',
			icon: 'i-lucide-clapperboard',
			overlays: [
				{
					id: 'a',
					text: 'YOLO',
					x: 0.5,
					y: 0.3,
					size: 0.1,
					color: '#fff',
					font: 'impact',
					caps: true,
					stroke: true,
					bar: false
				}
			],
			...over
		}),
		tags: [['d', 'com.bitos.bitz:template:paid-1']]
	};
}

describe('template marketplace wire', () => {
	it('parses price and category from a v3 event', () => {
		const t = parseSharedTemplate(contentEvent({ price_sats: 100, category: 'thai' }));
		expect(t?.priceSats).toBe(100);
		expect(t?.category).toBe('thai');
	});

	it('keeps v1/v2 events free-shaped (no price/category attached)', () => {
		const t = parseSharedTemplate(contentEvent());
		expect(t?.priceSats).toBeUndefined();
		expect(t?.category).toBeUndefined();
	});

	it('sanitizes junk prices to free', () => {
		for (const junk of ['free', -5, 0, 1e12, null]) {
			const t = parseSharedTemplate(contentEvent({ price_sats: junk }));
			expect(t?.priceSats).toBe(0);
		}
	});
});

describe('normalizePriceSats', () => {
	it('accepts the spec tiers', () => {
		expect(TEMPLATE_PRICE_TIERS).toEqual([0, 21, 100, 500]);
		expect(normalizePriceSats(21)).toBe(21);
		expect(normalizePriceSats('500')).toBe(500);
	});

	it('rejects junk and absurd values', () => {
		expect(normalizePriceSats(undefined)).toBe(0);
		expect(normalizePriceSats('21 sats')).toBe(0);
		expect(normalizePriceSats(-1)).toBe(0);
		expect(normalizePriceSats(2_000_000)).toBe(0);
	});
});

describe('marketplaceFromContent', () => {
	it('defaults to free + meme category', () => {
		expect(marketplaceFromContent({})).toEqual({ priceSats: 0, category: 'meme' });
	});

	it('keeps valid categories and floors custom prices', () => {
		expect(marketplaceFromContent({ category: 'bitcoin', price_sats: 33 })).toEqual({
			priceSats: 33,
			category: 'bitcoin'
		});
		expect(marketplaceFromContent({ category: 'nope' })).toEqual({
			priceSats: 0,
			category: 'meme'
		});
	});
});

describe('forCategory', () => {
	const me = 'me';
	const isUnlocked = (id: string) => id === 'unlocked-ev';

	const rows = [
		template({ eventId: 'thai-1', category: 'thai', createdAt: 100, creatorPubkey: 'a' }),
		template({ eventId: 'meme-1', category: 'meme', createdAt: 200, creatorPubkey: me }),
		template({
			eventId: 'btc-1',
			category: 'bitcoin',
			priceSats: 21,
			createdAt: 300,
			creatorPubkey: 'b'
		}),
		template({
			eventId: 'unlocked-ev',
			category: 'thai',
			priceSats: 100,
			createdAt: 250,
			creatorPubkey: 'c'
		})
	];

	it('filters to one category and sinks own templates', () => {
		const thai = forCategory(rows, me, isUnlocked, 'thai');
		expect(thai.every((r) => r.template.category === 'thai')).toBe(true);
		expect(thai.length).toBe(2);
	});

	it('marks own and zap-unlocked rows, not others', () => {
		const all = forCategory(rows, me, isUnlocked, 'new');
		expect(all.find((r) => r.template.eventId === 'meme-1')?.unlocked).toBe(true); // own
		expect(all.find((r) => r.template.eventId === 'unlocked-ev')?.unlocked).toBe(true); // paid
		expect(all.find((r) => r.template.eventId === 'btc-1')?.unlocked).toBe(false);
	});

	it('sorts newest first in category views', () => {
		const all = forCategory(rows, me, isUnlocked, 'new');
		const times = all.filter((r) => !r.own).map((r) => r.template.createdAt);
		expect([...times].sort((a, b) => b - a)).toEqual(times);
	});

	it('trending ranks by score margin and caps at 12', () => {
		const trending = forCategory(rows, me, isUnlocked, 'trending', { 'btc-1': 5 });
		expect(trending[0]?.template.eventId).toBe('btc-1');
		expect(trending.length).toBeLessThanOrEqual(12);
	});
});

describe('TEMPLATE_CATEGORIES', () => {
	it('covers the spec category rail', () => {
		const ids = TEMPLATE_CATEGORIES.map((c) => c.id);
		for (const id of [
			'trending',
			'meme',
			'lao',
			'thai',
			'developer',
			'bitcoin',
			'gaming',
			'reaction',
			'cinematic',
			'new'
		]) {
			expect(ids).toContain(id);
		}
	});
});
