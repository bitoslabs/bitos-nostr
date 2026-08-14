<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import HashViz from '$lib/components/ui/HashViz.svelte';
	import type { PowProgress } from '$lib/nostr/feed.svelte';
	import { cn } from '$lib/utils/cn';

	/**
	 * Shared NIP-13 Proof-of-Work panel used by every composer (post, reply).
	 *
	 * Owns only the presentation: difficulty slider + effort label, hash-viz,
	 * live mining telemetry (hashrate, best bits, ETA, real nonce, progress
	 * bar) and a cancel affordance. The mining itself runs in the PoW worker
	 * via feed.post/feed.reply; the parent feeds `progress` + `mining` back in.
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
		compact ? 'mt-2 p-2.5' : 'mt-3 p-3'
	)}
>
	<div class="flex items-center justify-between gap-3">
		<div class="min-w-0">
			<p class="text-[11px] font-bold tracking-wider text-[var(--ui-text-muted)] uppercase">
				Proof of Work
			</p>
			<p class="mt-0.5 text-[11px] text-[var(--ui-text-dimmed)]">
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

	<input
		type="range"
		min="0"
		{max}
		bind:value={pow}
		disabled={mining}
		class="pow-slider mt-2.5 w-full"
		aria-label="Proof of Work difficulty"
	/>

	<HashViz bits={hashvizBits} {mining} class="mt-2.5" />

	{#if mining && progress}
		<div class="mt-2.5">
			<div
				class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 font-mono text-[10px] text-[var(--ui-text-dimmed)]"
			>
				<span>
					Best <span class="font-semibold text-primary-500">{progress.best}/{pow}</span>
					bits · {formatHashrate(progress.hashrate)} · {formatDuration(progress.elapsedMs)} elapsed
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
				class="mt-2 flex flex-wrap items-baseline gap-1 font-mono text-[10px] text-[var(--ui-text-dimmed)]"
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
