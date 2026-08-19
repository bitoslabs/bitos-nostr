<script lang="ts">
	import { cn } from '$lib/utils/cn';

	/**
	 * Branded boot/splash screen — logo lockup: hexagon gradient badge with
	 * the "B" + lightning mark (BitOS hex language) above the official logo
	 * wordmark (dark artwork in light mode, white variant in dark mode), with
	 * sweeping PoW segments in orange to match the top header progress bar.
	 * Used for the brief `identity.ready` window while local state hydrates;
	 * the static twin in `app.html` covers the pre-JS gap before this mounts.
	 */
	let {
		status = 'Booting BitOS…',
		class: cls
	}: {
		status?: string;
		class?: string;
	} = $props();
</script>

<div
	class={cn('grid h-screen w-full place-items-center bg-[var(--ui-bg)]', cls)}
	role="status"
	aria-label="Loading BitOS"
>
	<div class="flex flex-col items-center gap-4">
		<!-- Hex badge (regular flat-top hexagon, warm/orange gradient). -->
		<div
			class="hex-clip bs-pulse-soft grid size-[60px] place-items-center bg-[linear-gradient(135deg,#FFB51B,#F7931A)] shadow-[0_4px_18px_rgb(247_147_26_/_0.5)]"
			aria-hidden="true"
		>
			<!-- A single perimeter trace gives the mark a compact "system online" moment. -->
			<svg class="bs-boot-orbit" viewBox="0 0 100 100" aria-hidden="true">
				<polygon points="25,6.7 75,6.7 100,50 75,93.3 25,93.3 0,50" />
			</svg>
			<svg viewBox="0 0 128 128" class="bs-symbol size-[34px]">
				<path
					class="bs-letter"
					d="M40 30h34c14 0 24 8 24 21 0 9-5 15-12 17 9 2 16 8 16 19 0 14-11 23-26 23H40V30zm16 31h17c6 0 10-3 10-8s-4-8-10-8H56v16zm0 31h19c6 0 11-3 11-9s-5-9-11-9H56v18z"
					fill="#fff"
				/>
				<path class="bs-bolt" d="M88 64l-22 26h13l-5 22 22-30H84l4-18z" fill="#fff" />
				<path class="bs-bolt-trace" pathLength="1" d="M88 64l-22 26h13l-5 22 22-30H84l4-18z" />
				<!-- Spark comet riding the stroke tip while the bolt draws. -->
				<circle class="bs-spark" r="5" fill="#fff" />
			</svg>
		</div>
		<!-- Official logo wordmark: swaps with the color mode. -->
		<img
			src="/icons/logo.png"
			alt="BitOS"
			width="156"
			height="62"
			class="h-[26px] w-auto dark:hidden"
		/>
		<img
			src="/icons/logo-white.png"
			alt="BitOS"
			width="640"
			height="219"
			class="hidden h-[26px] w-auto dark:block"
		/>
		<div class="mt-1 flex flex-col items-center gap-2.5">
			<!-- Proof-of-Work segments sweeping while the app initializes. -->
			<div class="pow-bar" aria-hidden="true">
				{#each Array(9) as _, i (i)}
					<span class="pow-boot-seg" style="animation-delay:{i * 0.12}s"></span>
				{/each}
			</div>
			<p class="font-mono text-[11px] text-[var(--ui-text-dimmed)]">{status}</p>
		</div>
	</div>
</div>
