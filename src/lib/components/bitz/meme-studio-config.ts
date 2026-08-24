import { makeClassicPair, makeOverlay, type MemeTextOverlay } from '$lib/meme/schema';
import type { RemixLicense } from '$lib/meme/remix';
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
}

export const STAGE_ZOOM_KEY = 'bitos:meme-stage-zoom';
export const STAGE_ZOOM_STEPS = [0.6, 0.8, 1, 1.25, 1.5] as const;
export const ARTBOARD_KEY = 'bitos:meme-artboard';

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
