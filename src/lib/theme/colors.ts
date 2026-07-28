/** Accent palettes available in the appearance switcher. */

export type AccentScale = Record<
	'50' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900' | '950',
	string
>;

export const accentScale: Record<string, AccentScale> = {
	// Pulse electric blue (default)
	blue: {
		'50': '#eff6ff',
		'100': '#dbeafe',
		'200': '#bfdbfe',
		'300': '#93c5fd',
		'400': '#60a5fa',
		'500': '#2f95f6',
		'600': '#1677d2',
		'700': '#135da8',
		'800': '#0f4a82',
		'900': '#0b3863',
		'950': '#072543'
	},
	// Pulse mint
	mint: {
		'50': '#edfcf4',
		'100': '#d3f8e3',
		'200': '#aaefcb',
		'300': '#7ce3b1',
		'400': '#55d69a',
		'500': '#35b97d',
		'600': '#22a068',
		'700': '#1a8054',
		'800': '#176443',
		'900': '#145238',
		'950': '#082e20'
	},
	// Pulse coral / warm
	coral: {
		'50': '#fff3f0',
		'100': '#ffe2db',
		'200': '#ffc6b8',
		'300': '#ffa18c',
		'400': '#ff8770',
		'500': '#ff755f',
		'600': '#f25a42',
		'700': '#c84430',
		'800': '#a23829',
		'900': '#853226',
		'950': '#491710'
	},
	violet: {
		'50': '#f5f3ff',
		'100': '#ede9fe',
		'200': '#ddd6fe',
		'300': '#c4b5fd',
		'400': '#a78bfa',
		'500': '#8b5cf6',
		'600': '#7c3aed',
		'700': '#6d28d9',
		'800': '#5b21b6',
		'900': '#4c1d95',
		'950': '#2e1065'
	},
	amber: {
		'50': '#fffbeb',
		'100': '#fef3c7',
		'200': '#fde68a',
		'300': '#fcd34d',
		'400': '#fbbf24',
		'500': '#f59e0b',
		'600': '#d97706',
		'700': '#b45309',
		'800': '#92400e',
		'900': '#78350f',
		'950': '#451a03'
	},
	rose: {
		'50': '#fff1f2',
		'100': '#ffe4e6',
		'200': '#fecdd3',
		'300': '#fda4af',
		'400': '#fb7185',
		'500': '#f43f5e',
		'600': '#e11d48',
		'700': '#be123c',
		'800': '#9f1239',
		'900': '#881337',
		'950': '#4c0519'
	}
};

export const accentOptions = [
	{ key: 'blue', label: 'Pulse Blue', hex: '#2f95f6' },
	{ key: 'mint', label: 'Mint', hex: '#55d69a' },
	{ key: 'coral', label: 'Coral', hex: '#ff755f' },
	{ key: 'violet', label: 'Violet', hex: '#8b5cf6' },
	{ key: 'amber', label: 'Amber', hex: '#f59e0b' },
	{ key: 'rose', label: 'Rose', hex: '#f43f5e' }
] as const;

export type AccentKey = (typeof accentOptions)[number]['key'];

/** Neutral palettes control surfaces, text, borders, and quiet UI states. */
export const neutralScale: Record<string, AccentScale> = {
	slate: {
		'50': '#f7fafd',
		'100': '#eef2f7',
		'200': '#dde5ee',
		'300': '#c4d0de',
		'400': '#9aa8bc',
		'500': '#6b7888',
		'600': '#4c5867',
		'700': '#353f4d',
		'800': '#202837',
		'900': '#141a26',
		'950': '#0b0f1a'
	},
	gray: {
		'50': '#f9fafb',
		'100': '#f3f4f6',
		'200': '#e5e7eb',
		'300': '#d1d5db',
		'400': '#9ca3af',
		'500': '#6b7280',
		'600': '#4b5563',
		'700': '#374151',
		'800': '#1f2937',
		'900': '#111827',
		'950': '#030712'
	},
	zinc: {
		'50': '#fafafa',
		'100': '#f4f4f5',
		'200': '#e4e4e7',
		'300': '#d4d4d8',
		'400': '#a1a1aa',
		'500': '#71717a',
		'600': '#52525b',
		'700': '#3f3f46',
		'800': '#27272a',
		'900': '#18181b',
		'950': '#09090b'
	},
	stone: {
		'50': '#fafaf9',
		'100': '#f5f5f4',
		'200': '#e7e5e4',
		'300': '#d6d3d1',
		'400': '#a8a29e',
		'500': '#78716c',
		'600': '#57534e',
		'700': '#44403c',
		'800': '#292524',
		'900': '#1c1917',
		'950': '#0c0a09'
	},
	bluegray: {
		'50': '#f6f9fc',
		'100': '#eaf0f7',
		'200': '#d5dfeb',
		'300': '#b8c7d9',
		'400': '#8ea2b9',
		'500': '#677d95',
		'600': '#4d5f74',
		'700': '#394758',
		'800': '#222d3b',
		'900': '#151d29',
		'950': '#0b111c'
	}
};

export const neutralOptions = [
	{ key: 'slate', label: 'Slate', hex: '#6b7888' },
	{ key: 'gray', label: 'Gray', hex: '#6b7280' },
	{ key: 'zinc', label: 'Zinc', hex: '#71717a' },
	{ key: 'stone', label: 'Stone', hex: '#78716c' },
	{ key: 'bluegray', label: 'Blue Gray', hex: '#677d95' }
] as const;

export type NeutralKey = (typeof neutralOptions)[number]['key'];
