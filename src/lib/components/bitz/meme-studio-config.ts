import {
	makeClassicPair,
	makeOverlay,
	type MemeSfxCue,
	type MemeTextOverlay
} from '$lib/meme/schema';
import type { RemixLicense } from '$lib/meme/remix';
import type { FrameFxWindow } from '$lib/meme/fx-track';
import type { SpeedWindow } from '$lib/meme/speed-track';
import { makeImageOverlay, type MemeImageOverlay } from '$lib/meme/image-overlay';
import { buddyFigure } from '$lib/meme/bitz-buddy';
import type { ZoomWindow } from '$lib/ai/suggest';
import type {
	MemeMediaFormat,
	MemeMediaFormatOption
} from '$lib/components/bitz/MemeStudioDropZone.svelte';

export type MemeStudioPhase = 'idle' | 'rendering' | 'uploading' | 'mining' | 'publishing';
export type MemeDestination = 'bitz' | 'story' | 'note';
export type MemeExportFormat = 'auto' | 'image' | 'gif' | 'video';
export type MemeArtboardId = 'source' | '9:16' | '16:9' | '1:1' | '4:5' | 'custom';

export interface MemeStudioTemplate {
	id: string;
	label: string;
	hint: string;
	icon: string;
	overlays: () => MemeTextOverlay[];
	/** Timed template extras (spec Layer 3): sound cues, zoom punches,
	 *  frame-fx windows and speed ramps that ride the template's timing —
	 *  best on video. */
	sfxCues?: () => MemeSfxCue[];
	zoomWindows?: () => ZoomWindow[];
	fxWindows?: () => FrameFxWindow[];
	speedWindows?: () => SpeedWindow[];
	/** Image layers (Bitz Buddy stickers etc.) dropped with the template —
	 *  merged under the MAX_IMAGE_OVERLAYS cap. */
	imageLayers?: () => MemeImageOverlay[];
}

export const STAGE_ZOOM_KEY = 'bitos:meme-stage-zoom';
export const STAGE_ZOOM_STEPS = [0.6, 0.8, 1, 1.25, 1.5] as const;
export const ARTBOARD_KEY = 'bitos:meme-artboard';

/** Buddy sticker layer factory — a catalog figure placed on the stage.
 *  `endMs`/`startMs` optional windows keep the figure timed like any layer. */
function buddyFigureLayer(
	id: string,
	x: number,
	y: number,
	size: number,
	startMs?: number,
	endMs?: number
): MemeImageOverlay {
	const figure = buddyFigure(id);
	const layer =
		makeImageOverlay(figure?.src ?? `/bitz-buddy/buddy.svg`, 1) ??
		({
			id: `img-${id}`,
			src: `/bitz-buddy/buddy.svg`,
			aspect: 1,
			x: 0.5,
			y: 0.5,
			size: 0.3
		} satisfies MemeImageOverlay);
	layer.x = x;
	layer.y = y;
	layer.size = size;
	if (startMs === undefined && endMs === undefined) {
		layer.startMs = undefined;
		layer.endMs = undefined;
	} else {
		if (startMs !== undefined) layer.startMs = startMs;
		if (endMs !== undefined) layer.endMs = endMs;
	}
	return layer;
}

export const ARTBOARDS: ReadonlyArray<{
	id: MemeArtboardId;
	label: string;
	hint: string;
	w: number;
	h: number;
}> = [
	{ id: 'source', label: 'Source', hint: "Keep the media's own frame", w: 0, h: 0 },
	{ id: '9:16', label: '9:16', hint: 'Mobile full-screen · stories / reels', w: 1080, h: 1920 },
	{ id: '16:9', label: '16:9', hint: 'Landscape · YouTube', w: 1920, h: 1080 },
	{ id: '1:1', label: '1:1', hint: 'Square feed post', w: 1080, h: 1080 },
	{ id: '4:5', label: '4:5', hint: 'Portrait feed post', w: 1080, h: 1350 }
];

export const PICK_FORMATS: Array<MemeMediaFormatOption & { id: MemeMediaFormat; accept: string }> =
	[
		{
			id: 'image',
			label: 'Image meme',
			hint: 'JPG · PNG · WebP',
			icon: 'i-lucide-image',
			accept: 'image/png,image/jpeg,image/webp,image/*'
		},
		{
			id: 'gif',
			label: 'GIF meme',
			hint: 'animated, keeps motion',
			icon: 'i-lucide-film',
			accept: 'image/gif'
		},
		{
			id: 'video',
			label: 'Video meme',
			hint: 'MP4 · WebM · MOV',
			icon: 'i-lucide-video',
			accept: 'video/mp4,video/webm,video/quicktime,video/*'
		}
	];

export const DESTINATIONS: ReadonlyArray<{
	id: MemeDestination;
	label: string;
	icon: string;
	hint: string;
}> = [
	{
		id: 'bitz',
		label: 'Bitz feed',
		icon: 'i-lucide-clapperboard',
		hint: 'Permanent media post (kind 20/21/22)'
	},
	{
		id: 'story',
		label: 'Story · 24h',
		icon: 'i-lucide-circle-dot-dashed',
		hint: 'Disappearing story (kind 30315)'
	},
	{
		id: 'note',
		label: 'Note',
		icon: 'i-lucide-message-square-text',
		hint: 'Text note with the meme attached (kind 1)'
	}
];

export const LICENSE_OPTIONS: ReadonlyArray<{ code: RemixLicense; label: string }> = [
	{ code: 'CC0-1.0', label: 'CC0 · anyone can reuse' },
	{ code: 'CC-BY-4.0', label: 'CC BY · reuse with credit' },
	{ code: 'CC-BY-NC-4.0', label: 'CC BY-NC · non-commercial' },
	{ code: 'bitz/source-permission', label: 'Ask me first' },
	{ code: 'bitz/all-reserved', label: 'No remixes' }
];

export const TEMPLATES: ReadonlyArray<MemeStudioTemplate> = [
	{
		id: 'classic',
		label: 'Classic',
		hint: 'Top / bottom Impact caps',
		icon: 'i-lucide-letter-text',
		overlays: () => makeClassicPair()
	},
	{
		id: 'caption',
		label: 'Caption bar',
		hint: 'Single subtitle-bar line',
		icon: 'i-lucide-captions',
		overlays: () => [
			makeOverlay({
				text: 'when the code finally runs',
				y: 0.88,
				size: 0.06,
				bar: true,
				font: 'sans'
			})
		]
	},
	{
		id: 'drake',
		label: 'Drake',
		hint: 'No / Yes panels',
		icon: 'i-lucide-columns-2',
		overlays: () => [
			makeOverlay({ text: 'web2 platforms', x: 0.25, y: 0.24, size: 0.05 }),
			makeOverlay({ text: 'nostr', x: 0.75, y: 0.74, size: 0.05 })
		]
	},
	{
		id: 'punchline',
		label: 'Punchline',
		hint: 'Timed setup → punchline (video)',
		icon: 'i-lucide-zap',
		overlays: () => [
			{ ...makeOverlay({ text: 'setup…', y: 0.2, size: 0.06 }), endMs: 1500 },
			{ ...makeOverlay({ text: 'PUNCHLINE', y: 0.8, size: 0.1 }), startMs: 1500 }
		]
	},
	// ---- Timed template pack (Meme Pack V1 Layer 3 — spec tp-2.md) --------------
	// Each rides the studio's existing tracks: captions (timed overlays),
	// the SFX cue sheet, zoom punches, and frame-fx windows. Video bases get
	// the full effect; images degrade to the caption layout gracefully.
	{
		id: 'bug-found',
		label: 'Production bug',
		hint: 'Glitch + error beep on the reveal',
		icon: 'i-lucide-bug',
		overlays: () => [
			{ ...makeOverlay({ text: 'it works on my machine', y: 0.18, size: 0.05 }), endMs: 1500 },
			{
				...makeOverlay({ text: 'PRODUCTION:', y: 0.42, size: 0.07, bar: true }),
				startMs: 1500,
				endMs: 2600
			},
			{ ...makeOverlay({ text: '😤🔥', x: 0.5, y: 0.62, size: 0.16 }), startMs: 2600 }
		],
		sfxCues: () => [
			{ id: 'tpl-bug-1', sfx: 'error', atMs: 1500, gain: 0.9 },
			{ id: 'tpl-bug-2', sfx: 'game-over', atMs: 2600, gain: 0.7 }
		],
		fxWindows: () => [{ startMs: 1500, endMs: 2400, fx: 'glitch', intensity: 0.8 }]
	},
	{
		id: 'funny-zoom',
		label: 'Funny zoom',
		hint: 'Face punch-in + laugh on the beat',
		icon: 'i-lucide-zoom-in',
		overlays: () => [
			{ ...makeOverlay({ text: 'wait for it…', y: 0.12, size: 0.05 }), endMs: 1800 },
			{ ...makeOverlay({ text: 'LMAO', y: 0.85, size: 0.12 }), startMs: 1800 }
		],
		sfxCues: () => [
			{ id: 'tpl-fz-1', sfx: 'drumroll', atMs: 200, gain: 0.7 },
			{ id: 'tpl-fz-2', sfx: 'laugh', atMs: 1800, gain: 1 }
		],
		zoomWindows: () => [{ startMs: 1800, endMs: 3400, factor: 2.5, cx: 0.5, cy: 0.4 }]
	},
	{
		id: 'npc-mode',
		label: 'NPC mode',
		hint: 'Pixelate + loading beeps',
		icon: 'i-lucide-bot',
		overlays: () => [
			{
				...makeOverlay({
					text: 'NPC BEHAVIOR DETECTED',
					y: 0.86,
					size: 0.05,
					bar: true,
					font: 'mono'
				}),
				startMs: 1200
			}
		],
		sfxCues: () => [
			{ id: 'tpl-npc-1', sfx: 'loading', atMs: 0, gain: 0.6 },
			{ id: 'tpl-npc-2', sfx: 'notification', atMs: 1200, gain: 0.8 }
		],
		fxWindows: () => [{ startMs: 1200, endMs: 3000, fx: 'pixelate', intensity: 0.75 }]
	},
	{
		id: 'big-reveal',
		label: 'Big reveal',
		hint: 'Strobe + drumroll → jackpot',
		icon: 'i-lucide-eye',
		overlays: () => [
			{ ...makeOverlay({ text: 'the reveal…', y: 0.2, size: 0.05 }), endMs: 2000 },
			{ ...makeOverlay({ text: '🤑 JACKPOT', y: 0.5, size: 0.11 }), startMs: 2000 }
		],
		sfxCues: () => [
			{ id: 'tpl-br-1', sfx: 'drumroll', atMs: 400, gain: 0.9 },
			{ id: 'tpl-br-2', sfx: 'jackpot', atMs: 2000, gain: 1 }
		],
		fxWindows: () => [
			{ startMs: 0, endMs: 400, fx: 'spotlight', intensity: 0.6 },
			{ startMs: 2000, endMs: 2800, fx: 'strobe', intensity: 0.5 }
		],
		zoomWindows: () => [{ startMs: 2000, endMs: 3600, factor: 1.8, cx: 0.5, cy: 0.45 }]
	},
	{
		id: 'ninja-appear',
		label: 'Ninja appear',
		hint: 'Spotlight → anime slash',
		icon: 'i-lucide-moon-star',
		overlays: () => [
			{
				...makeOverlay({ text: ' ນິນຈາ', x: 0.5, y: 0.16, size: 0.08 }),
				startMs: 1600,
				endMs: 2600
			},
			{ ...makeOverlay({ text: '⚡ gone ⚡', y: 0.85, size: 0.07, bar: true }), startMs: 2600 }
		],
		sfxCues: () => [
			{ id: 'tpl-na-1', sfx: 'whoosh', atMs: 1600, gain: 0.9 },
			{ id: 'tpl-na-2', sfx: 'anime-slash', atMs: 2000, gain: 0.8 }
		],
		fxWindows: () => [
			{ startMs: 0, endMs: 1600, fx: 'spotlight', intensity: 0.7 },
			{ startMs: 2000, endMs: 2600, fx: 'flash', intensity: 0.9 }
		]
	},
	{
		id: 'money-hit',
		label: 'Money hit',
		hint: 'Coin rain + zoom on the stack',
		icon: 'i-lucide-bitcoin',
		overlays: () => [
			{ ...makeOverlay({ text: 'when the sats stack', y: 0.14, size: 0.05 }), endMs: 1600 },
			{ ...makeOverlay({ text: '₿₿₿ TO THE MOON', y: 0.82, size: 0.09, bar: true }), startMs: 1600 }
		],
		sfxCues: () => [
			{ id: 'tpl-mh-1', sfx: 'coin', atMs: 1200, gain: 0.7 },
			{ id: 'tpl-mh-2', sfx: 'cash', atMs: 1600, gain: 1 },
			{ id: 'tpl-mh-3', sfx: 'jackpot', atMs: 2400, gain: 0.9 }
		],
		zoomWindows: () => [{ startMs: 1600, endMs: 3200, factor: 2, cx: 0.5, cy: 0.5 }]
	},
	{
		id: 'plot-twist',
		label: 'Plot twist',
		hint: 'Record-scratch freeze energy',
		icon: 'i-lucide-corner-down-right',
		overlays: () => [
			{ ...makeOverlay({ text: 'everything is fine', y: 0.2, size: 0.055 }), endMs: 2000 },
			{
				...makeOverlay({ text: 'PLOT TWIST', y: 0.5, size: 0.11, color: '#fde047' }),
				startMs: 2000
			}
		],
		sfxCues: () => [
			{ id: 'tpl-pt-1', sfx: 'record-scratch', atMs: 2000, gain: 1 },
			{ id: 'tpl-pt-2', sfx: 'bruh', atMs: 2600, gain: 0.8 }
		],
		fxWindows: () => [
			{ startMs: 2000, endMs: 3000, fx: 'rgb-split', intensity: 0.6 },
			{ startMs: 3000, endMs: 3600, fx: 'vignette', intensity: 0.5 }
		]
	},
	{
		id: 'chaos-mode',
		label: 'Chaos mode',
		hint: 'Everything, everywhere (all tracks maxed)',
		icon: 'i-lucide-flame',
		overlays: () => [
			makeOverlay({ text: 'CHAAAAOS', x: 0.5, y: 0.5, size: 0.13, color: '#f97316' })
		],
		sfxCues: () => [
			{ id: 'tpl-cm-1', sfx: 'explosion', atMs: 300, gain: 1 },
			{ id: 'tpl-cm-2', sfx: 'crowd-laugh', atMs: 1200, gain: 0.9 },
			{ id: 'tpl-cm-3', sfx: 'lightning-zap', atMs: 2200, gain: 1 }
		],
		fxWindows: () => [
			{ startMs: 0, endMs: 800, fx: 'glitch', intensity: 1 },
			{ startMs: 800, endMs: 1800, fx: 'shake', intensity: 0.9 },
			{ startMs: 2200, endMs: 3000, fx: 'color-flash', intensity: 0.6 }
		],
		zoomWindows: () => [
			{ startMs: 800, endMs: 1800, factor: 2.5, cx: 0.5, cy: 0.5 },
			{ startMs: 2200, endMs: 3200, factor: 1.6, cx: 0.5, cy: 0.45 }
		]
	},
	{
		id: 'thai-nang-lang',
		label: 'นั่งลง 🇹🇭',
		hint: 'นั่งลง! flash + slam (Thai pack)',
		icon: 'i-lucide-languages',
		overlays: () => [
			{ ...makeOverlay({ text: 'นั่งลง!!', y: 0.5, size: 0.12, color: '#fde047' }), startMs: 1400 }
		],
		sfxCues: () => [
			{ id: 'tpl-tn-1', sfx: 'swipe', atMs: 800, gain: 0.7 },
			{ id: 'tpl-tn-2', sfx: 'slam', atMs: 1400, gain: 1 }
		],
		fxWindows: () => [{ startMs: 1400, endMs: 2100, fx: 'flash', intensity: 0.8 }]
	},
	{
		id: 'lao-bor-pen-nyang',
		label: 'ບໍ່ເປັນຫຍັງ 🇱🇦',
		hint: 'Chill vignette + ding (Lao pack)',
		icon: 'i-lucide-leaf',
		overlays: () => [
			{
				...makeOverlay({ text: 'ບໍ່ເປັນຫຍັງ', y: 0.86, size: 0.07, bar: true }),
				startMs: 1000
			}
		],
		sfxCues: () => [
			{ id: 'tpl-lb-1', sfx: 'ding', atMs: 1000, gain: 0.6 },
			{ id: 'tpl-lb-2', sfx: 'pop', atMs: 1600, gain: 0.5 }
		],
		fxWindows: () => [{ startMs: 1000, endMs: 3200, fx: 'vignette', intensity: 0.4 }]
	},
	{
		id: 'developer-deploy',
		label: 'Deploy day 👨💻',
		hint: 'Success beep + zoom-blur (Developer pack)',
		icon: 'i-lucide-terminal',
		overlays: () => [
			{
				...makeOverlay({ text: '$ git push --force', y: 0.18, size: 0.045, font: 'mono' }),
				endMs: 1800
			},
			{
				...makeOverlay({ text: 'deployed on a Friday 🚀', y: 0.82, size: 0.05, bar: true }),
				startMs: 1800
			}
		],
		sfxCues: () => [
			{ id: 'tpl-dd-1', sfx: 'click', atMs: 400, gain: 0.5 },
			{ id: 'tpl-dd-2', sfx: 'success', atMs: 1800, gain: 0.9 }
		],
		fxWindows: () => [{ startMs: 1800, endMs: 2600, fx: 'zoom-blur', intensity: 0.6 }]
	},
	// ---- Spec tp-2.md round-out: templates #4, #5, #7, #8, #9 + #16 ----------
	{
		id: 'wait-for-it',
		label: 'Wait for it…',
		hint: 'Slow zoom → silence → boom punchline',
		icon: 'i-lucide-hourglass',
		overlays: () => [
			{ ...makeOverlay({ text: 'wait for it…', y: 0.12, size: 0.05 }), endMs: 2400 },
			{ ...makeOverlay({ text: 'THERE IT IS', y: 0.84, size: 0.11 }), startMs: 2400 }
		],
		sfxCues: () => [
			{ id: 'tpl-wf-1', sfx: 'drumroll', atMs: 200, gain: 0.5 },
			{ id: 'tpl-wf-2', sfx: 'boom', atMs: 2400, gain: 1 }
		],
		zoomWindows: () => [{ startMs: 0, endMs: 2400, factor: 1.8, cx: 0.5, cy: 0.45 }]
	},
	{
		id: 'brain-loading',
		label: 'Brain loading',
		hint: 'Freeze + beeps → 404 brain',
		icon: 'i-lucide-brain-circuit',
		overlays: () => [
			{
				...makeOverlay({ text: 'thinking…', y: 0.14, size: 0.05, font: 'mono' }),
				endMs: 2000
			},
			{
				...makeOverlay({
					text: '404: BRAIN NOT FOUND',
					y: 0.5,
					size: 0.07,
					bar: true,
					font: 'mono'
				}),
				startMs: 2000
			}
		],
		sfxCues: () => [
			{ id: 'tpl-bl-1', sfx: 'loading', atMs: 0, gain: 0.7 },
			{ id: 'tpl-bl-2', sfx: 'error', atMs: 2000, gain: 1 }
		],
		fxWindows: () => [{ startMs: 2000, endMs: 2800, fx: 'glitch', intensity: 0.5 }]
	},
	{
		id: 'expectation-reality',
		label: 'Expectation vs Reality',
		hint: 'Clean cut → shake → bonk',
		icon: 'i-lucide-git-compare',
		overlays: () => [
			{ ...makeOverlay({ text: 'EXPECTATION ✨', y: 0.12, size: 0.05 }), endMs: 1600 },
			{
				...makeOverlay({ text: 'REALITY 💀', y: 0.5, size: 0.12, color: '#f97316' }),
				startMs: 1600
			}
		],
		sfxCues: () => [
			{ id: 'tpl-er-1', sfx: 'swipe', atMs: 1500, gain: 0.8 },
			{ id: 'tpl-er-2', sfx: 'punch', atMs: 1700, gain: 1 }
		],
		fxWindows: () => [{ startMs: 1600, endMs: 2300, fx: 'shake', intensity: 0.7 }]
	},
	{
		id: 'pov-cam',
		label: 'POV',
		hint: 'Slow zoom + hit on the event',
		icon: 'i-lucide-video',
		overlays: () => [
			{ ...makeOverlay({ text: 'POV:', y: 0.1, size: 0.06 }), endMs: 2200 },
			{
				...makeOverlay({ text: "it's you 🫵", y: 0.84, size: 0.07, bar: true }),
				startMs: 2200
			}
		],
		sfxCues: () => [
			{ id: 'tpl-pv-1', sfx: 'whoosh', atMs: 1800, gain: 0.6 },
			{ id: 'tpl-pv-2', sfx: 'bass-hit', atMs: 2200, gain: 1 }
		],
		zoomWindows: () => [{ startMs: 0, endMs: 2200, factor: 1.7, cx: 0.5, cy: 0.5 }]
	},
	{
		id: 'before-after',
		label: 'Before / After',
		hint: 'Swipe transition + zoom finish',
		icon: 'i-lucide-arrow-right-left',
		overlays: () => [
			{ ...makeOverlay({ text: 'BEFORE', x: 0.5, y: 0.12, size: 0.055 }), endMs: 1500 },
			{ ...makeOverlay({ text: 'AFTER 🔥', x: 0.5, y: 0.12, size: 0.055 }), startMs: 1500 }
		],
		sfxCues: () => [
			{ id: 'tpl-ba-1', sfx: 'swipe', atMs: 1400, gain: 0.9 },
			{ id: 'tpl-ba-2', sfx: 'success', atMs: 1600, gain: 0.7 }
		],
		fxWindows: () => [{ startMs: 1500, endMs: 2000, fx: 'flash', intensity: 0.5 }],
		zoomWindows: () => [{ startMs: 1500, endMs: 3000, factor: 1.9, cx: 0.5, cy: 0.45 }]
	},
	{
		id: 'zero-to-hundred',
		label: '0 → 100',
		hint: 'Speed ramp + shake escalation',
		icon: 'i-lucide-gauge',
		overlays: () => [
			{ ...makeOverlay({ text: 'calm 😐', y: 0.16, size: 0.05 }), endMs: 1400 },
			{
				...makeOverlay({ text: '0→100 REAL QUICK', y: 0.82, size: 0.08, bar: true }),
				startMs: 1400
			}
		],
		sfxCues: () => [
			{ id: 'tpl-zh-1', sfx: 'snap', atMs: 1200, gain: 0.6 },
			{ id: 'tpl-zh-2', sfx: 'explosion', atMs: 1800, gain: 1 }
		],
		fxWindows: () => [{ startMs: 1600, endMs: 2500, fx: 'shake', intensity: 0.9 }],
		// The first speed-ramp template: calm 1× → 2× burst at the hit.
		speedWindows: () => [{ startMs: 1600, endMs: 2600, rate: 2 }]
	},
	// ---- ₿ Pack (spec tp-bitcoin.md §13): Bitz Buddy rides every template --
	{
		id: 'btc-pump',
		label: 'Pump 📈',
		hint: 'Buddy moon-walk in, zoom + jackpot (₿ pack)',
		icon: 'i-lucide-trending-up',
		overlays: () => [
			{ ...makeOverlay({ text: 'me checking the chart', y: 0.14, size: 0.05 }), endMs: 1500 },
			{
				...makeOverlay({ text: 'PUMP 🚀📈', y: 0.82, size: 0.1, bar: true, color: '#f97316' }),
				startMs: 1500
			}
		],
		sfxCues: () => [
			{ id: 'tpl-bp-1', sfx: 'whoosh', atMs: 1200, gain: 0.7 },
			{ id: 'tpl-bp-2', sfx: 'jackpot', atMs: 1500, gain: 1 }
		],
		fxWindows: () => [{ startMs: 1500, endMs: 2400, fx: 'zoom-blur', intensity: 0.7 }],
		zoomWindows: () => [{ startMs: 1500, endMs: 3000, factor: 1.8, cx: 0.5, cy: 0.4 }],
		imageLayers: () => [buddyFigureLayer('moon', 0.72, 0.78, 0.42, 1500)]
	},
	{
		id: 'btc-dump',
		label: 'Dump 📉',
		hint: 'Buddy panic face + red crash (₿ pack)',
		icon: 'i-lucide-trending-down',
		overlays: () => [
			{ ...makeOverlay({ text: 'just a small dip', y: 0.14, size: 0.05 }), endMs: 1400 },
			{
				...makeOverlay({ text: '-37% 💀', y: 0.5, size: 0.12, color: '#ef4444', bar: true }),
				startMs: 1400
			}
		],
		sfxCues: () => [
			{ id: 'tpl-bd-1', sfx: 'record-scratch', atMs: 1300, gain: 0.8 },
			{ id: 'tpl-bd-2', sfx: 'explosion', atMs: 1500, gain: 1 },
			{ id: 'tpl-bd-3', sfx: 'sad-trombone', atMs: 2400, gain: 0.6 }
		],
		fxWindows: () => [
			{ startMs: 1400, endMs: 1700, fx: 'flash', intensity: 0.6 },
			{ startMs: 1700, endMs: 2600, fx: 'shake', intensity: 0.8 }
		],
		imageLayers: () => [buddyFigureLayer('panic', 0.7, 0.74, 0.4, 1400)]
	},
	{
		id: 'btc-hodl',
		label: 'HODL 🧘',
		hint: 'Zen buddy stays calm in chaos (₿ pack)',
		icon: 'i-lucide-lotus',
		overlays: () => [
			{ ...makeOverlay({ text: 'market: -20%', y: 0.12, size: 0.05 }), endMs: 2000 },
			{
				...makeOverlay({ text: 'HODL 🧘', y: 0.84, size: 0.1, bar: true, color: '#22c55e' }),
				startMs: 2000
			}
		],
		sfxCues: () => [
			{ id: 'tpl-bh-1', sfx: 'drumroll', atMs: 200, gain: 0.4 },
			{ id: 'tpl-bh-2', sfx: 'ding', atMs: 2000, gain: 0.7 }
		],
		fxWindows: () => [{ startMs: 0, endMs: 2000, fx: 'shake', intensity: 0.5 }],
		imageLayers: () => [buddyFigureLayer('hodl-zen', 0.5, 0.72, 0.46)]
	},
	{
		id: 'btc-buy-the-dip',
		label: 'Buy the dip 🛒',
		hint: 'Buddy thinking → shopping snap (₿ pack)',
		icon: 'i-lucide-shopping-cart',
		overlays: () => [
			{ ...makeOverlay({ text: 'it dipped again…', y: 0.14, size: 0.05 }), endMs: 1600 },
			{
				...makeOverlay({
					text: 'BUYING THE DIP 🛒',
					y: 0.82,
					size: 0.08,
					bar: true,
					color: '#f97316'
				}),
				startMs: 1600
			}
		],
		sfxCues: () => [
			{ id: 'tpl-bt-1', sfx: 'loading', atMs: 0, gain: 0.5 },
			{ id: 'tpl-bt-2', sfx: 'cash', atMs: 1600, gain: 1 }
		],
		zoomWindows: () => [{ startMs: 1600, endMs: 2800, factor: 1.6, cx: 0.35, cy: 0.7 }],
		imageLayers: () => [
			buddyFigureLayer('thinking', 0.3, 0.3, 0.3, undefined, 1600),
			buddyFigureLayer('moon', 0.7, 0.76, 0.34, 1600)
		]
	},
	{
		id: 'btc-fiat-brrr',
		label: 'Fiat brrr 🖨️',
		hint: 'Money printer + buddy dead inside (₿ pack)',
		icon: 'i-lucide-printer',
		overlays: () => [
			{
				...makeOverlay({ text: 'money printer go brrr', y: 0.12, size: 0.05, font: 'mono' }),
				endMs: 1800
			},
			{
				...makeOverlay({ text: '₿ fixes this 💰', y: 0.84, size: 0.08, bar: true }),
				startMs: 1800
			}
		],
		sfxCues: () => [
			{ id: 'tpl-bf-1', sfx: 'cash', atMs: 200, gain: 0.8 },
			{ id: 'tpl-bf-2', sfx: 'coin', atMs: 700, gain: 0.7 },
			{ id: 'tpl-bf-3', sfx: 'success', atMs: 1800, gain: 0.8 }
		],
		fxWindows: () => [{ startMs: 0, endMs: 1800, fx: 'shake', intensity: 0.4 }],
		imageLayers: () => [buddyFigureLayer('dead-inside', 0.68, 0.7, 0.34)]
	},
	{
		id: 'btc-lightning-zap',
		label: 'Lightning zap ⚡',
		hint: 'Glitch + lightning sfx, buddy shocked (₿ pack)',
		icon: 'i-lucide-zap',
		overlays: () => [
			{ ...makeOverlay({ text: 'when the invoice', y: 0.14, size: 0.05 }), endMs: 1400 },
			{
				...makeOverlay({ text: 'ZAPS IN SECONDS ⚡', y: 0.82, size: 0.08, bar: true }),
				startMs: 1400
			}
		],
		sfxCues: () => [
			{ id: 'tpl-bz-1', sfx: 'lightning-zap', atMs: 1400, gain: 1 },
			{ id: 'tpl-bz-2', sfx: 'ding', atMs: 2000, gain: 0.6 }
		],
		fxWindows: () => [{ startMs: 1400, endMs: 2000, fx: 'glitch', intensity: 0.8 }],
		imageLayers: () => [buddyFigureLayer('shock', 0.72, 0.74, 0.36, 1400)]
	},
	{
		id: 'btc-self-custody',
		label: 'Self custody 🔑',
		hint: 'Not your keys → buddy angry (₿ pack)',
		icon: 'i-lucide-key-round',
		overlays: () => [
			{
				...makeOverlay({
					text: 'not your keys, not your coins',
					y: 0.12,
					size: 0.045
				}),
				endMs: 1800
			},
			{
				...makeOverlay({ text: 'SELF CUSTODY 🔑', y: 0.84, size: 0.08, bar: true }),
				startMs: 1800
			}
		],
		sfxCues: () => [
			{ id: 'tpl-bs-1', sfx: 'record-scratch', atMs: 1700, gain: 0.7 },
			{ id: 'tpl-bs-2', sfx: 'success', atMs: 1900, gain: 0.9 }
		],
		fxWindows: () => [{ startMs: 1800, endMs: 2400, fx: 'flash', intensity: 0.5 }],
		imageLayers: () => [buddyFigureLayer('angry', 0.28, 0.72, 0.36, undefined, 1800)]
	},
	{
		id: 'btc-number-go-up',
		label: 'Number go up 🔢',
		hint: 'Speed-ramp euphoria + buddy laughing (₿ pack)',
		icon: 'i-lucide-bar-chart-3',
		overlays: () => [
			{ ...makeOverlay({ text: 'number go up technology', y: 0.14, size: 0.05 }), endMs: 1400 },
			{
				...makeOverlay({ text: 'NEW ATH 🎉', y: 0.82, size: 0.11, bar: true, color: '#f97316' }),
				startMs: 1400
			}
		],
		sfxCues: () => [
			{ id: 'tpl-bn-1', sfx: 'coin', atMs: 0, gain: 0.6 },
			{ id: 'tpl-bn-2', sfx: 'jackpot', atMs: 1400, gain: 1 },
			{ id: 'tpl-bn-3', sfx: 'laugh', atMs: 2100, gain: 0.8 }
		],
		fxWindows: () => [{ startMs: 1400, endMs: 2200, fx: 'zoom-blur', intensity: 0.6 }],
		// Euphoria ramp: steady build → 2× at the ATH hit.
		speedWindows: () => [{ startMs: 1500, endMs: 2500, rate: 2 }],
		imageLayers: () => [buddyFigureLayer('laugh', 0.74, 0.76, 0.4, 1400)]
	}
];

export const BLANK_CANVAS_COLORS: readonly string[] = [
	'#ffffff',
	'#000000',
	'#fde047',
	'#f97316',
	'#22d3ee',
	'#a3e635'
];

export const OUTPUT_FORMATS: ReadonlyArray<{
	id: MemeExportFormat;
	label: string;
	hint: string;
}> = [
	{ id: 'auto', label: 'Auto', hint: 'Infer from the source media' },
	{ id: 'image', label: 'Image', hint: 'JPEG still of the current frame' },
	{ id: 'gif', label: 'GIF', hint: 'True looping .gif (image or GIF base)' },
	{ id: 'video', label: 'Video', hint: 'Recorded video with sound' }
];
