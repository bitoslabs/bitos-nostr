<script lang="ts">
	import { onMount } from 'svelte';
	import QRCode from 'qrcode';

	type LogoShape = 'hex' | 'rounded' | 'circle';
	type Theme = 'bolt' | 'nostr' | 'matrix';

	let {
		value,
		label = 'QR code',
		size = 260,
		theme = 'bolt',
		// Dynamic accent: any CSS color, including var(...) from the app theme.
		// Resolved at runtime; auto-darkened until scannable against white.
		accent = 'var(--ui-color-primary-600)',
		logo = '/bitos-lightning-bolt.svg',
		logoWhite = true,
		logoShape = 'hex',
		coverColor,
		class: cls = ''
	}: {
		value: string;
		label?: string;
		size?: number;
		theme?: Theme;
		accent?: string | null;
		logo?: string | null;
		logoWhite?: boolean;
		logoShape?: LogoShape;
		coverColor?: string;
		class?: string;
	} = $props();

	// ---------- theme presets (colors used when accent is null) ----------
	const THEMES: Record<
		Theme,
		{
			modules: string;
			gradient?: [string, string];
			moduleShape: 'square' | 'rounded' | 'dot';
			eye: string;
			eyeRx: number;
			scanline: boolean;
			cover: string;
		}
	> = {
		bolt: {
			modules: '#111827',
			moduleShape: 'square',
			eye: '#111827',
			eyeRx: 1,
			scanline: false,
			cover: '#F7931A'
		},
		nostr: {
			modules: '#7C3AED',
			gradient: ['#7C3AED', '#C026D3'],
			moduleShape: 'dot',
			eye: '#7C3AED',
			eyeRx: 1.8,
			scanline: false,
			cover: '#7C3AED'
		},
		matrix: {
			modules: '#0A2A12',
			moduleShape: 'rounded',
			eye: '#15803D',
			eyeRx: 0.4,
			scanline: true,
			cover: '#15803D'
		}
	};

	// Regular pointy-top hexagon: width = height × √3/2
	const HEX_CLIP = 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)';

	// unique gradient id per instance (several QRs can share a page)
	const uid = Math.random().toString(36).slice(2, 7);

	let svg = $state('');
	let preset = $derived(THEMES[theme]);
	let logoBox = $derived(Math.round(size * 0.2));

	// ---------- runtime accent resolution ----------
	// Colors actually drawn; start from the preset, override once accent resolves.
	let palette = $state<{
		module: string;
		eye: string;
		cover: string;
		gradient: [string, string] | null;
	}>({
		module: THEMES.bolt.modules,
		eye: THEMES.bolt.eye,
		cover: THEMES.bolt.cover,
		gradient: null
	});

	// Resolve any CSS color (var(), oklch, color-mix…) to sRGB via a probe element,
	// then measure it with a 1px canvas — works in every modern engine.
	function toRgb(css: string): [number, number, number] | null {
		if (typeof document === 'undefined') return null;
		const probe = document.createElement('span');
		probe.style.display = 'none';
		probe.style.color = css;
		document.body.appendChild(probe);
		const computed = getComputedStyle(probe).color;
		probe.remove();
		const m = computed.match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
		if (m) return [+m[1], +m[2], +m[3]];
		// oklch/color(): round-trip through canvas to get sRGB bytes
		try {
			const c = document.createElement('canvas');
			c.width = c.height = 1;
			const ctx = c.getContext('2d', { willReadFrequently: true });
			if (!ctx) return null;
			ctx.fillStyle = computed;
			ctx.fillRect(0, 0, 1, 1);
			const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
			return [r, g, b];
		} catch {
			return null;
		}
	}

	// WCAG relative luminance + contrast against the white QR card
	function luminance([r, g, b]: [number, number, number]) {
		const f = (v: number) => {
			v /= 255;
			return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
		};
		return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
	}
	function contrastVsWhite(rgb: [number, number, number]) {
		return 1.05 / (luminance(rgb) + 0.05);
	}
	function mix(
		rgb: [number, number, number],
		target: [number, number, number],
		t: number
	): [number, number, number] {
		return [
			Math.round(rgb[0] + (target[0] - rgb[0]) * t),
			Math.round(rgb[1] + (target[1] - rgb[1]) * t),
			Math.round(rgb[2] + (target[2] - rgb[2]) * t)
		];
	}
	const hex = ([r, g, b]: [number, number, number]) =>
		'#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

	// QR scanners need ≥4.5:1 dark/light contrast; we aim for 5:1 margin.
	function scanSafe(rgb: [number, number, number]): [number, number, number] {
		let out = rgb;
		for (let t = 0; t <= 0.9; t += 0.1) {
			out = mix(rgb, [0, 0, 0], t);
			if (contrastVsWhite(out) >= 5) break;
		}
		return out;
	}

	function resolvePalette() {
		if (!accent) {
			palette = {
				module: preset.modules,
				eye: preset.eye,
				cover: preset.cover,
				gradient: preset.gradient ?? null
			};
			return;
		}
		const rgb = toRgb(accent);
		if (!rgb) return;
		const dark = scanSafe(rgb); // modules + eyes: guaranteed scannable
		palette = {
			module: hex(dark),
			eye: hex(dark),
			// cover only hosts the white logo — raw accent keeps its vibrancy
			cover: hex(rgb),
			gradient: [hex(dark), hex(scanSafe(mix(rgb, [255, 255, 255], 0.12)))]
		};
	}

	// ---------- custom SVG renderer ----------
	function buildSvg(input: string): string {
		const qr = QRCode.create(input, { errorCorrectionLevel: 'H' });
		const n = qr.modules.size;
		const bits = qr.modules.data;
		const q = 2; // quiet zone in modules
		const dim = n + q * 2;

		const inEye = (r: number, c: number) =>
			(r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);

		let body = '';
		for (let r = 0; r < n; r++) {
			for (let c = 0; c < n; c++) {
				if (!bits[r * n + c] || inEye(r, c)) continue;
				const x = c + q + 0.5;
				const y = r + q + 0.5;
				if (preset.moduleShape === 'dot') {
					body += `<circle cx="${x}" cy="${y}" r="0.43"/>`;
				} else if (preset.moduleShape === 'rounded') {
					// 1.04 width so neighbours touch → connected "liquid" modules
					body += `<rect x="${x - 0.52}" y="${y - 0.52}" width="1.04" height="1.04" rx="0.3"/>`;
				} else {
					body += `<rect x="${x - 0.5}" y="${y - 0.5}" width="1" height="1"/>`;
				}
			}
		}

		// finder "eyes": outer ring + inner pupil, rounding themed via eyeRx
		const eye = (ox: number, oy: number) =>
			`<rect x="${ox + q + 0.5}" y="${oy + q + 0.5}" width="6" height="6" rx="${preset.eyeRx}" fill="none" stroke="${palette.eye}" stroke-width="1"/>` +
			`<rect x="${ox + q + 2}" y="${oy + q + 2}" width="3" height="3" rx="${Math.min(preset.eyeRx, 0.9)}" fill="${palette.eye}"/>`;
		const eyes = eye(0, 0) + eye(n - 7, 0) + eye(0, n - 7);

		const fill = palette.gradient ? `url(#g-${uid})` : palette.module;
		const defs = palette.gradient
			? `<defs><linearGradient id="g-${uid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${palette.gradient[0]}"/><stop offset="1" stop-color="${palette.gradient[1]}"/></linearGradient></defs>`
			: '';

		return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${size - 20}" fill="${fill}" shape-rendering="geometricPrecision" role="img">${defs}<g>${body}</g><g>${eyes}</g></svg>`;
	}

	let observer: MutationObserver | undefined;

	onMount(() => {
		resolvePalette();

		// Live-update when the app theme/accent changes at runtime (class, style
		// or data-theme on <html> rewrite the --color-primary-* variables).
		observer = new MutationObserver(() => resolvePalette());
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['class', 'style', 'data-theme']
		});

		return () => observer?.disconnect();
	});

	$effect(() => {
		value;
		size;
		theme;
		palette;
		svg = buildSvg(value);
	});
</script>

<div
	style={`width:${size}px;height:${size}px`}
	class="relative mx-auto grid place-items-center overflow-hidden rounded-2xl border border-[var(--ui-border-muted)] bg-white p-3 {cls}"
	aria-label={label}
>
	{#if svg}
		{@html svg}

		{#if preset.scanline}
			<!-- matrix fx: CRT lines + neon sweep (pure decoration) -->
			<div
				class="pointer-events-none absolute inset-3 overflow-hidden rounded-xl"
				aria-hidden="true"
			>
				<div
					class="absolute inset-0 opacity-[0.08]"
					style="background-image:repeating-linear-gradient(0deg,#4ade80 0 1px,transparent 1px 3px)"
				></div>
				<div
					class="qr-scan absolute inset-x-0 h-8 bg-gradient-to-b from-transparent via-green-400/40 to-transparent"
				></div>
			</div>
		{/if}

		{#if logo}
			<!-- Centered logo cover: ~20% of QR area (level H keeps it scannable) -->
			<div class="absolute inset-0 grid place-items-center">
				{#if logoShape === 'hex'}
					<!-- Colored hexagon cover; drop-shadow follows the clip-path shape -->
					<div
						class="grid place-items-center"
						style={`width:${Math.round(logoBox * 0.866)}px;height:${logoBox}px;background:${coverColor ?? palette.cover};clip-path:${HEX_CLIP};filter:drop-shadow(0 1px 2px rgb(0 0 0 / 0.18))`}
					>
						{#if logoWhite}
							<!-- White silhouette: SVG painted via mask, so its own gradient is ignored -->
							<div
								class="size-[80%]"
								style={`background:#ffffff;-webkit-mask:url('${logo}') center / contain no-repeat;mask:url('${logo}') center / contain no-repeat`}
							></div>
						{:else}
							<img src={logo} alt="" draggable="false" class="w-[80%] object-contain" />
						{/if}
					</div>
				{:else}
					<div
						class="grid place-items-center bg-white p-1.5 {logoShape === 'circle'
							? 'rounded-full'
							: 'rounded-xl'} ring-1 ring-black/10"
						style={`width:${logoBox}px;height:${logoBox}px`}
					>
						<img src={logo} alt="" class="size-full object-contain" draggable="false" />
					</div>
				{/if}
			</div>
		{/if}
	{:else}
		<div class="size-6 animate-spin rounded-full border-2 border-gray-200 border-t-gray-900"></div>
	{/if}
</div>

<style>
	.qr-scan {
		animation: qr-scan 2.6s linear infinite;
	}

	@keyframes qr-scan {
		0% {
			transform: translateY(-100%);
		}
		100% {
			transform: translateY(900%);
		}
	}
</style>
