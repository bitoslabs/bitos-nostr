<script lang="ts">
	import { onMount } from 'svelte';
	import QRCode from 'qrcode';

	let {
		value,
		label = 'QR code',
		size = 260,
		logo = '/bitos-lightning-bolt.svg',
		logoWhite = true,
		coverColor = '#F7931A',
		logoShape = 'hex',
		class: cls = ''
	}: {
		value: string;
		label?: string;
		size?: number;
		logo?: string | null;
		logoWhite?: boolean;
		coverColor?: string;
		logoShape?: 'hex' | 'rounded' | 'circle';
		class?: string;
	} = $props();

	let svg = $state('');

	// Regular pointy-top hexagon: width = height × √3/2
	const HEX_CLIP = 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)';
	let logoBox = $derived(Math.round(size * 0.2));

	async function render() {
		svg = await QRCode.toString(value, {
			type: 'svg',
			// Level H tolerates ~30% occlusion, required for the centered logo
			errorCorrectionLevel: 'H',
			margin: 2,
			width: size - 20,
			color: {
				dark: '#111827',
				light: '#ffffff'
			}
		});
	}

	onMount(() => {
		void render();
	});

	$effect(() => {
		value;
		size;
		void render();
	});
</script>

<div
	style={`width:${size}px;height:${size}px`}
	class="relative mx-auto grid place-items-center rounded-2xl border border-[var(--ui-border-muted)] bg-white p-3 {cls}"
	aria-label={label}
>
	{#if svg}
		{@html svg}
		{#if logo}
			<!-- Centered logo cover: ~20% of QR area (level H keeps it scannable) -->
			<div class="absolute inset-0 grid place-items-center">
				{#if logoShape === 'hex'}
					<!-- Colored hexagon cover; drop-shadow follows the clip-path shape -->
					<div
						class="grid place-items-center"
						style={`width:${Math.round(logoBox * 0.866)}px;height:${logoBox}px;background:${coverColor};clip-path:${HEX_CLIP};filter:drop-shadow(0 1px 2px rgb(0 0 0 / 0.18))`}
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
