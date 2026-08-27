import { describe, expect, it } from 'vitest';
import {
	TEMPLATE_D_PREFIX,
	TEMPLATE_ICONS,
	TEMPLATE_SCHEMA_VERSION,
	parseSharedTemplate,
	rankSharedTemplates,
	sharedTemplateEventParts
} from './shared-templates';
import { makeImageOverlay } from './image-overlay';
import { makeOverlay, normalizeSfxCue } from './schema';
import type { MemeTextOverlay } from '$lib/meme/schema';

const CLIENT = () => [['client', 'bitz']];

const OVERLAYS = [
	{
		id: 'a',
		text: 'Top line',
		x: 0.5,
		y: 0.15,
		size: 0.09,
		color: '#ffffff',
		font: 'impact',
		caps: true,
		stroke: true,
		bar: false as const
	},
	{
		id: 'b',
		text: 'Bottom punchline',
		x: 0.5,
		y: 0.82,
		size: 0.07,
		color: '#ffffff',
		font: 'impact',
		caps: true,
		stroke: true,
		bar: false as const
	}
] as unknown as MemeTextOverlay[];

function makeEvent(overrides: Partial<Parameters<typeof parseSharedTemplate>[0]> = {}) {
	const parts = sharedTemplateEventParts({
		templateId: 'tpl1',
		label: 'Two-liner',
		icon: 'i-lucide-message-square-text',
		overlays: OVERLAYS,
		clientTag: CLIENT()
	});
	return {
		id: 'ee'.repeat(32),
		pubkey: 'aa'.repeat(32),
		created_at: 1_800_000_000,
		kind: 30078,
		content: parts.content,
		tags: parts.tags,
		...overrides
	};
}

describe('sharedTemplateEventParts', () => {
	it('emits namespaced d, envelope, and client/label tags', () => {
		const parts = sharedTemplateEventParts({
			templateId: 'x9',
			label: 'Bonk layout',
			icon: 'i-lucide-zap',
			overlays: OVERLAYS,
			clientTag: CLIENT()
		});
		expect(parts.d).toBe(`${TEMPLATE_D_PREFIX}x9`);
		const content = JSON.parse(parts.content);
		expect(content.schema).toBe('com.bitos.bitz.template');
		expect(content.version).toBe(TEMPLATE_SCHEMA_VERSION);
		expect(content.label).toBe('Bonk layout');
		expect(content.icon).toBe('i-lucide-zap');
		expect(content.overlays).toHaveLength(2);
		expect(parts.tags).toContainEqual(['d', `${TEMPLATE_D_PREFIX}x9`]);
		expect(parts.tags).toContainEqual(['label', 'Bonk layout']);
		expect(parts.tags).toContainEqual(['client', 'bitz']);
	});

	it('normalizes overlays and clamps to the caption cap', () => {
		const many = Array.from({ length: 20 }, (_, i) => ({
			id: `o${i}`,
			text: `line ${i}`,
			x: 0.5,
			y: 0.1 + i * 0.04,
			size: 0.08,
			color: '#ffffff',
			font: 'impact' as const,
			caps: true,
			stroke: true,
			bar: false
		}));
		const parts = sharedTemplateEventParts({
			templateId: 'big',
			label: 'Wall of text',
			icon: 'i-lucide-bookmark',
			overlays: many,
			clientTag: CLIENT()
		});
		expect(JSON.parse(parts.content).overlays).toHaveLength(12); // MAX_OVERLAYS
	});

	it('rejects empty layouts', () => {
		expect(() =>
			sharedTemplateEventParts({
				templateId: 'empty',
				label: 'Nope',
				icon: 'i-lucide-bookmark',
				overlays: [
					{
						id: 'x',
						text: '   ',
						x: 0.5,
						y: 0.5,
						size: 0.09,
						color: '#ffffff',
						font: 'impact' as const,
						caps: true,
						stroke: true,
						bar: false
					}
				],
				clientTag: CLIENT()
			})
		).toThrow();
	});

	it('sanitizes unknown icons to the default bookmark', () => {
		const parts = sharedTemplateEventParts({
			templateId: 'icon-test',
			label: 'Weird icon',
			icon: 'i-lucide-not-a-real-icon',
			overlays: OVERLAYS,
			clientTag: CLIENT()
		});
		expect(JSON.parse(parts.content).icon).toBe('i-lucide-bookmark');
	});
});

describe('parseSharedTemplate', () => {
	it('round-trips a published event', () => {
		const tpl = parseSharedTemplate(makeEvent());
		expect(tpl).not.toBeNull();
		expect(tpl!.templateId).toBe('tpl1');
		expect(tpl!.label).toBe('Two-liner');
		expect(tpl!.overlays.map((o) => o.text)).toEqual(['Top line', 'Bottom punchline']);
	});

	it('rejects wrong kind, wrong namespace, and malformed json', () => {
		expect(parseSharedTemplate(makeEvent({ kind: 1 }))).toBeNull();
		expect(
			parseSharedTemplate(makeEvent({ tags: [['d', 'somewhere:else'], ...CLIENT()] }))
		).toBeNull();
		expect(parseSharedTemplate(makeEvent({ content: '{not json' }))).toBeNull();
	});

	it('rejects layouts that normalize to nothing', () => {
		const junk = JSON.stringify({
			schema: 'com.bitos.bitz.template',
			version: 1,
			label: 'Empty',
			icon: 'i-lucide-bookmark',
			overlays: [null, 7, 'text']
		});
		expect(parseSharedTemplate(makeEvent({ content: junk }))).toBeNull();
	});

	it('coerces a foreign icon back onto the allowlist', () => {
		const sneaky = JSON.stringify({
			schema: 'com.bitos.bitz.template',
			version: 1,
			label: 'Sneaky',
			icon: 'overlapping-style-attack',
			overlays: OVERLAYS
		});
		const tpl = parseSharedTemplate(makeEvent({ content: sneaky }));
		expect(tpl).not.toBeNull();
		expect(TEMPLATE_ICONS).toContain(tpl!.icon);
	});
});

describe('shared templates wire v2 (timed payload)', () => {
	const mini = () => [makeOverlay({ text: 'BOOM', y: 0.5 })!];

	it('carries sound+zoom+fx+speed+stickers end to end', () => {
		const cue = normalizeSfxCue({ sfx: 'boom', atMs: 1200, gain: 0.9 })!;
		const layer = makeImageOverlay('/bitz-buddy/laugh.svg', 1)!;
		const parts = sharedTemplateEventParts({
			templateId: 'full',
			label: 'Full rig',
			icon: 'i-lucide-zap',
			overlays: mini(),
			sfxCues: [cue],
			zoomWindows: [{ startMs: 1000, endMs: 2000, factor: 1.8, cx: 0.5, cy: 0.45 }],
			fxWindows: [{ startMs: 1000, endMs: 1600, fx: 'flash', intensity: 0.6 }],
			speedWindows: [{ startMs: 1200, endMs: 2200, rate: 2 }],
			imageLayers: [{ ...layer, x: 0.7, y: 0.7, size: 0.4, motionId: 'bounce' }],
			clientTag: CLIENT()
		});
		const back = parseSharedTemplate(makeEvent({ content: parts.content }))!;
		expect(back.sfxCues).toHaveLength(1);
		expect(back.sfxCues![0]!.sfx).toBe('boom');
		expect(back.zoomWindows![0]!.factor).toBe(1.8);
		expect(back.fxWindows![0]!.fx).toBe('flash');
		expect(back.speedWindows![0]!.rate).toBe(2);
		expect(back.imageLayers![0]!.src).toBe('/bitz-buddy/laugh.svg');
		expect(back.imageLayers![0]!.motionId).toBe('bounce');
	});

	it('omits empty tracks — v1-shaped events stay v1-shaped', () => {
		const parts = sharedTemplateEventParts({
			templateId: 'plain',
			label: 'Text only',
			icon: 'i-lucide-bookmark',
			overlays: mini(),
			clientTag: CLIENT()
		});
		const parsed = JSON.parse(parts.content) as Record<string, unknown>;
		expect(parsed.sfxCues).toBeUndefined();
		expect(parsed.imageLayers).toBeUndefined();
		const back = parseSharedTemplate(makeEvent({ content: parts.content }))!;
		expect(back.sfxCues).toBeUndefined();
		expect(back.overlays).toHaveLength(1);
	});

	it('sanitizes junk extras on parse — readers never trust remote JSON', () => {
		const content = JSON.stringify({
			schema: 'com.bitos.bitz.template',
			version: 2,
			label: 'Evil',
			icon: 'i-lucide-bookmark',
			overlays: [{ text: 'ok', x: 0.5, y: 0.5, size: 0.1 }],
			sfxCues: [{ sfx: 'not-a-sfx' }, { sfx: 'ding', atMs: -5 }],
			zoomWindows: [{ startMs: 900, endMs: 100, factor: 2 }],
			imageLayers: [{ id: 'x', src: 'javascript:alert(1)', x: 0.5, y: 0.5, size: 0.3 }]
		});
		const back = parseSharedTemplate(makeEvent({ content }))!;
		expect(back.sfxCues?.every((c) => c.atMs >= 0)).toBe(true);
		expect(back.sfxCues?.length).toBeLessThanOrEqual(1);
		expect(back.zoomWindows).toBeUndefined();
		expect(back.imageLayers).toBeUndefined();
	});
});

describe('rankSharedTemplates', () => {
	it('newest first, own templates sink below others', () => {
		const mine = 'aa'.repeat(32);
		const other = 'bb'.repeat(32);
		const ranked = rankSharedTemplates(
			[
				{
					eventId: 'e1',
					templateId: 't1',
					label: 'mine older',
					icon: 'i-lucide-bookmark',
					overlays: OVERLAYS,
					creatorPubkey: mine,
					createdAt: 100
				},
				{
					eventId: 'e2',
					templateId: 't2',
					label: 'theirs newer',
					icon: 'i-lucide-bookmark',
					overlays: OVERLAYS,
					creatorPubkey: other,
					createdAt: 200
				},
				{
					eventId: 'e3',
					templateId: 't3',
					label: 'theirs older',
					icon: 'i-lucide-bookmark',
					overlays: OVERLAYS,
					creatorPubkey: other,
					createdAt: 150
				}
			],
			mine
		);
		expect(ranked.map((t) => t.templateId)).toEqual(['t2', 't3', 't1']);
	});
});
