<script lang="ts">
	import { onMount } from 'svelte';
	import QRCode from 'qrcode';

	let {
		value,
		label = 'QR code',
		size = 260,
		class: cls = ''
	}: { value: string; label?: string; size?: number; class?: string } = $props();

	let svg = $state('');

	async function render() {
		svg = await QRCode.toString(value, {
			type: 'svg',
			errorCorrectionLevel: 'M',
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
	class="mx-auto grid place-items-center rounded-2xl border border-[var(--ui-border-muted)] bg-white p-3 {cls}"
	aria-label={label}
>
	{#if svg}
		{@html svg}
	{:else}
		<div class="size-6 animate-spin rounded-full border-2 border-gray-200 border-t-gray-900"></div>
	{/if}
</div>
