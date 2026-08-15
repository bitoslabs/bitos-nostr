<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import HashViz from '$lib/components/ui/HashViz.svelte';
	import type { PowProgress } from '$lib/nostr/feed.svelte';
	import { cn } from '$lib/utils/cn';

	/**
	 * Shared NIP-13 Proof-of-Work panel used by every composer (post, reply).
	 *
	 * Owns only the presentation: semantic effort presets (one tap, no math),
	 * an advanced fine-tune slider behind a disclosure, hash-viz, live mining
	 * telemetry (growing zero prefix, hashrate, ETA, progress bar, nonce) and
	 * a cancel affordance. The mining itself runs in the PoW worker via
	 * feed.post/feed.reply; the parent feeds `progress` + `mining` back in.
	 */
	let {
		pow = $bindable(0),
		mining = false,
		progress = null,
		max = 30,
		compact = false,
		oncancel
	}: {
		pow?: number;
		mining?: boolean;
		/** Live worker stats; null while idle. */
		progress?: PowProgress | null;
		max?: number;
		/** Tighter paddings for inline contexts (replies). */
		compact?: boolean;
		oncancel?: () => void;
	} = $props();

	/** Semantic effort presets — the default path. The slider is for power users. */
	const PRESETS = [
		{
			id: 'instant',
			label: 'Instant',
			icon: 'i-lucide-zap',
			bits: 0,
			hint: 'No extra work — publish immediately.'
		},
		{
			id: 'shielded',
			label: 'Shielded',
			icon: 'i-lucide-shield-check',
			bits: 20,
			hint: 'Hard to spam — about a second of mining.'
		},
		{
			id: 'forged',
			label: 'Forged',
			icon: 'i-lucide-pickaxe',
			bits: 24,
			hint: 'Heavy work — for posts that matter.'
		}
	] as const;

	// Start expanded when the remembered difficulty is not a preset value.
	let advanced = $state(pow > 0 && !PRESETS.some((preset) => preset.bits === pow));

	const activePresetId = $derived(PRESETS.find((preset) => preset.bits === pow)?.id ?? null);

	function applyPreset(bits: number) {
		if (!mining) pow = bits;
	}

	const powEffort = $derived(
		pow === 0
			? 'No extra work'
			: pow <= 16
				? 'Light work'
				: pow <= 20
					? 'Balanced work'
					: pow <= 24
						? 'Higher work'
						: 'Heavy work'
	);

	// Mining telemetry: expected work, progress odds, ETA and a live nonce.
	const expectedHashes = $derived(Math.pow(2, pow));
	const percent = $derived(
		progress && expectedHashes > 0 ? Math.min(99, (progress.hashes / expectedHashes) * 100) : 0
	);
	const etaMs = $derived.by(() => {
		if (!progress || progress.hashrate <= 0) return 0;
		return (Math.max(0, expectedHashes - progress.hashes) / progress.hashrate) * 1000;
	});
	const nonceHex = $derived(
		progress ? Number.parseInt(progress.nonce, 10).toString(16).padStart(8, '0') : ''
	);
	const hashvizBits = $derived(mining && progress ? progress.best : pow);

	// Live receipt: the best candidate hash, leading zeros glowing. Re-mounts
	// (pops) each time a longer zero prefix lands.
	const liveChars = $derived(progress?.bestHash ? progress.bestHash.slice(0, 14) : '');
	const liveZeroCount = $derived(
		progress ? Math.min(Math.floor(progress.best / 4), liveChars.length) : 0
	);
	const liveZeros = $derived(liveChars.slice(0, liveZeroCount));
	const liveRest = $derived(liveChars.slice(liveZeroCount));

	function formatHashrate(rate: number) {
		return rate >= 1_000_000
			? `${(rate / 1_000_000).toFixed(1)} MH/s`
			: rate >= 1_000
				? `${(rate / 1_000).toFixed(1)} kH/s`
				: `${Math.max(1, Math.round(rate))} H/s`;
	}

	function formatDuration(ms: number) {
		const total = Math.max(0, Math.round(ms / 1000));
		return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
	}
</script>

<div
	class={cn(
		'rounded-xl border border-primary-500/15 bg-primary-500/5',
		compact ? 'mt-2 p-2 sm:p-2.5' : 'mt-2 p-2.5 sm:mt-3 sm:p-3'
	)}
>
	<div class="flex items-center justify-between gap-3">
		<div class="min-w-0">
			<p class="text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase">
				Proof of Work
			</p>
			<p class="mt-0.5 hidden text-[11px] text-[var(--ui-text-dimmed)] sm:block">
				{mining
					? 'Mining your note… keep this tab open.'
					: 'Mine a harder-to-spam note before publishing.'}
			</p>
		</div>
		<div class="flex shrink-0 items-center gap-3">
			<div class="text-right">
				<span class="block font-mono text-sm font-semibold text-primary-500">{pow} bits</span>
				{#if !mining}
					<span class="text-[10px] text-[var(--ui-text-dimmed)]">{powEffort}</span>
				{/if}
			</div>
			{#if mining && oncancel}
				<button
					type="button"
					onclick={oncancel}
					class="flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--ui-border-accented)] px-3 py-1.5 text-[12px] font-bold text-[var(--ui-text-muted)] transition hover:border-[var(--tone-error-text)] hover:text-[var(--tone-error-text)] active:scale-95"
				>
					<Icon name="i-lucide-square" class="size-3" />
					Cancel
				</button>
			{/if}
		</div>
	</div>

	{#if !mining}
		<div
			class="mt-2 grid grid-cols-3 gap-1 sm:mt-2.5 sm:gap-1.5"
			role="radiogroup"
			aria-label="Proof of Work effort"
		>
			{#each PRESETS as preset (preset.id)}
				<button
					type="button"
					role="radio"
					aria-checked={activePresetId === preset.id}
					title={preset.hint}
					onclick={() => applyPreset(preset.bits)}
					class={cn(
						'flex flex-col items-center gap-0.5 rounded-lg border px-1.5 py-1.5 transition active:scale-95 sm:gap-1 sm:px-2 sm:py-2',
						activePresetId === preset.id
							? 'border-[color-mix(in_oklab,var(--ui-color-primary-500)_45%,transparent)] bg-[color-mix(in_oklab,var(--ui-color-primary-500)_12%,transparent)] text-[var(--ui-color-primary-500)]'
							: 'border-[var(--ui-border-muted)] text-[var(--ui-text-muted)] hover:border-[color-mix(in_oklab,var(--ui-color-primary-500)_25%,transparent)] hover:text-[var(--ui-color-primary-500)]'
					)}
				>
					<Icon name={preset.icon} class="size-4" />
					<span class="text-[10px] font-bold sm:text-[11px]">{preset.label}</span>
					<span class="font-mono text-[9.5px] text-[var(--ui-text-dimmed)]"
						>{preset.bits === 0 ? '0 bits' : `${preset.bits} bits`}</span
					>
				</button>
			{/each}
		</div>

		<div class="mt-2">
			<button
				type="button"
				onclick={() => (advanced = !advanced)}
				aria-expanded={advanced}
				class="flex items-center gap-1 text-[10.5px] font-bold text-[var(--ui-text-dimmed)] transition hover:text-[var(--ui-color-primary-500)]"
			>
				<Icon name={advanced ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'} class="size-3" />
				Fine-tune difficulty
				{#if activePresetId === null && pow > 0}
					<span class="font-mono">· custom {pow} bits</span>
				{/if}
			</button>
			{#if advanced}
				<input
					type="range"
					min="0"
					{max}
					bind:value={pow}
					class="pow-slider mt-2 w-full"
					aria-label="Proof of Work difficulty"
				/>
			{/if}
		</div>
	{/if}

	<HashViz bits={hashvizBits} {mining} class="mt-2.5" />

	{#if mining && progress}
		<div class="mt-2.5">
			<!-- Live receipt: the best candidate's zero prefix growing in real time. -->
			<p class="flex items-baseline font-mono text-[11px]" aria-label="Best candidate hash so far">
				{#key liveZeroCount}
					<span class="pow-live-zeros">{liveZeros}</span>
				{/key}
				{#if liveZeroCount > 0}
					<span class="text-[var(--ui-text-dimmed)]" aria-hidden="true">·</span>
				{/if}
				<span class="text-[var(--ui-text-dimmed)]">{liveRest}…</span>
				<span class="ml-1.5 font-sans text-[9.5px] text-[var(--ui-text-dimmed)]">
					best {progress.best}/{pow} bits
				</span>
			</p>
			<div
				class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 font-mono text-[10px] text-[var(--ui-text-dimmed)]"
			>
				<span>
					{formatHashrate(progress.hashrate)} · {formatDuration(progress.elapsedMs)} elapsed
				</span>
				<span>≈ {formatDuration(etaMs)} left</span>
			</div>
			<div
				class="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--ui-bg-muted)]"
				role="progressbar"
				aria-label="Mining progress"
				aria-valuemin="0"
				aria-valuemax="100"
				aria-valuenow={Math.round(percent)}
			>
				<div
					class="h-full rounded-full bg-primary-500 transition-[width] duration-150 ease-out"
					style="width:{percent}%"
				></div>
			</div>
			<div
				class="mt-1.5 flex items-center justify-between font-mono text-[10px] text-[var(--ui-text-dimmed)]"
			>
				<span>{progress.hashes.toLocaleString()} hashes</span>
				<span class="mining-nonce text-primary-500" aria-hidden="true">0x{nonceHex}</span>
			</div>
		</div>
	{:else if !mining}
		{#if pow > 0}
			<p
				class="mt-2 hidden flex-wrap items-baseline gap-1 font-mono text-[10px] text-[var(--ui-text-dimmed)] sm:flex"
			>
				<span class="font-sans">Target ID starts with</span>
				<span
					class="font-bold text-[var(--ui-color-primary-500)] [text-shadow:0_0_5px_color-mix(in_oklab,var(--ui-color-primary-500)_55%,transparent)]"
				>
					{'0'.repeat(Math.min(Math.floor(pow / 4), 8))}</span
				>
				<span aria-hidden="true">·xxxx…</span>
			</p>
		{:else}
			<p class="mt-2 text-[10px] text-[var(--ui-text-dimmed)]">
				Mining starts only after you post.
			</p>
		{/if}
	{/if}

	{#if pow > 20}
		<p class="mt-2 text-[10px] text-warm-500">
			High difficulty may take noticeably longer to mine.
		</p>
	{/if}
</div>
