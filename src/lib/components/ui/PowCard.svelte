<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import HashViz from '$lib/components/ui/HashViz.svelte';
	import type { PowProgress } from '$lib/nostr/feed.svelte';
	import { powPrefs } from '$lib/stores/pow-prefs.svelte';
	import { cn } from '$lib/utils/cn';

	/**
	 * Shared NIP-13 Proof-of-Work panel used by every composer (post, reply,
	 * story, meme, bitz).
	 *
	 * UX contract: one glance, one tap. Three large effort presets carry
	 * plain-language labels and time estimates (calibrated to this device
	 * after the first mined note); the raw bits slider hides behind a
	 * "Fine-tune" disclosure and a short "What is this?" explainer answers
	 * the inevitable question. While publishing, the panel switches to a
	 * calm, bigger telemetry view: the live zero-prefix receipt, an
	 * odds-based progress bar (mining is memoryless, so the honest percent
	 * is the chance a valid hash already landed), hashrate/elapsed/ETA
	 * chips, and a prominent cancel. The mining itself runs in the PoW
	 * worker via feed.post/feed.reply; the parent feeds `progress` +
	 * `mining` back in.
	 *
	 * `mini` renders the collapsed comment/reply variant: one slim bar whose
	 * middle segment track is a drag slider (21 ticks, 1-bit steps, 0–20;
	 * tier bands name every position), while the labeled sides expand the
	 * full panel;
	 * picking a preset collapses it again. While mining it becomes a live
	 * progress pill (odds fill, best/target bits, ✕ cancel).
	 */
	let {
		pow = $bindable(0),
		mining = false,
		progress = null,
		max = 30,
		compact = false,
		/** Collapsed single-bar variant for comment/reply inputs: a slim pill
		 * that expands to this same panel on tap. */
		mini = false,
		oncancel
	}: {
		pow?: number;
		mining?: boolean;
		/** Live worker stats; null while idle. */
		progress?: PowProgress | null;
		max?: number;
		/** Slightly tighter paddings for inline contexts (replies). */
		compact?: boolean;
		/** Collapsed single-bar variant for comment/reply inputs. */
		mini?: boolean;
		oncancel?: () => void;
	} = $props();

	/** Fallback hashrate (H/s) for time estimates before this device has
	 * ever mined — typical for a browser Web Worker on a mid-range laptop. */
	const ASSUMED_HASHRATE = 500_000;

	/** Semantic effort presets — the default path. The slider is for power users. */
	const PRESETS = [
		{
			id: 'instant',
			label: 'Instant',
			icon: 'i-lucide-zap',
			bits: 0,
			hint: 'No mining — publishes right away.'
		},
		{
			id: 'shielded',
			label: 'Shielded',
			icon: 'i-lucide-shield-check',
			bits: 20,
			hint: 'Anti-spam mining — a few seconds.'
		},
		{
			id: 'forged',
			label: 'Forged',
			icon: 'i-lucide-pickaxe',
			bits: 24,
			hint: 'Heavy mining — for posts that matter.'
		}
	] as const;

	// Start expanded when the remembered difficulty is not a preset value.
	let advanced = $state(pow > 0 && !PRESETS.some((preset) => preset.bits === pow));
	let about = $state(false);
	/** Collapsed-pill state for the `mini` variant — tap to reveal the panel. */
	let open = $state(false);

	const activePreset = $derived(PRESETS.find((preset) => preset.bits === pow) ?? null);

	/** Named rank bands covering every difficulty 1–32, so scrubbing the bar
	 * always reads like a rank ladder (Trace → Light → … → Max) — never a
	 * bare "custom". Presets land on their bands (20 = Shielded, 24 = Forged). */
	const TIERS = [
		{ min: 1, max: 5, label: 'Trace', icon: 'i-lucide-shield' },
		{ min: 6, max: 9, label: 'Light', icon: 'i-lucide-shield' },
		{ min: 10, max: 13, label: 'Steady', icon: 'i-lucide-shield' },
		{ min: 14, max: 17, label: 'Solid', icon: 'i-lucide-shield' },
		{ min: 18, max: 19, label: 'Strong', icon: 'i-lucide-shield-check' },
		{ min: 20, max: 23, label: 'Shielded', icon: 'i-lucide-shield-check' },
		{ min: 24, max: 27, label: 'Forged', icon: 'i-lucide-pickaxe' },
		{ min: 28, max: 32, label: 'Max', icon: 'i-lucide-gem' }
	] as const;
	const tier = $derived(pow > 0 ? (TIERS.find((t) => pow >= t.min && pow <= t.max) ?? null) : null);
	const effCompact = $derived(compact || mini);

	// Device-calibrated time estimates (hashrate is measured live while mining).
	const calibrated = $derived(powPrefs.state.lastHashrate > 0);
	const deviceHashrate = $derived(powPrefs.state.lastHashrate || ASSUMED_HASHRATE);

	function estimateMs(bits: number) {
		return bits <= 0 ? 0 : (2 ** bits / deviceHashrate) * 1000;
	}

	/** Human time estimate: 'instant' | 'under 1 s' | '≈ 35 s' | '≈ 3 min' | '≈ 2 h'. */
	function estimateLabel(bits: number) {
		const ms = estimateMs(bits);
		if (ms <= 0) return 'instant';
		const s = ms / 1000;
		if (s < 1) return 'under 1 s';
		if (s < 60) return `≈ ${Math.round(s)} s`;
		if (s < 3600) {
			const m = Math.max(1, Math.round(s / 60));
			return `≈ ${m} min`;
		}
		const h = Math.floor(s / 3600);
		return `≈ ${h} h ${Math.floor((s % 3600) / 60)} min`;
	}

	function applyPreset(bits: number) {
		if (!mining) pow = bits;
		// Mini flow: bar → tap → preset → done. Picking a level collapses
		// straight back to the slim bar so the comment box stays light.
		if (mini) open = false;
	}

	const effortLabel = $derived(pow === 0 ? 'no mining' : (tier?.label ?? 'Custom').toLowerCase());

	// Mining telemetry: odds-based progress, ETA and a live nonce.
	const expectedHashes = $derived(2 ** pow);
	const percent = $derived(
		progress && expectedHashes > 0
			? Math.min(99.5, (1 - Math.exp(-progress.hashes / expectedHashes)) * 100)
			: 0
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

	// ---- Collapsed mini-bar state -------------------------------------------
	/** Drag track: 21 ticks × 1 bit = quick ranks 0–20 (presets land on 0/20;
	 * Forged 24+ stays one tap away in the expanded panel). */
	const MINI_SEGS = 21;
	const RANK_MAX = 20;
	const filledTicks = $derived(
		pow <= 0
			? 0
			: Math.min(
					MINI_SEGS,
					Math.max(1, Math.round((Math.min(pow, RANK_MAX) / RANK_MAX) * MINI_SEGS))
				)
	);
	const miniSegments = $derived(Array.from({ length: MINI_SEGS }, (_, i) => i < filledTicks));
	const miniIcon = $derived(
		pow === 0 ? 'i-lucide-zap' : (tier?.icon ?? 'i-lucide-sliders-horizontal')
	);
	const miniStatus = $derived(
		mining && progress ? `${progress.best}/${pow} bits · ${Math.floor(percent)}%` : null
	);
	/** Rank input position (clamped to the quick range; >20 pins at the end). */
	const rankValue = $derived(Math.min(pow, RANK_MAX));

	/** Scrub handler for the mini bar's drag track — fires continuously while
	 * dragging, so the label/estimate/segments all follow the thumb live. */
	function setRank(event: Event) {
		if (mining) return;
		const value = Number((event.currentTarget as HTMLInputElement).value);
		if (Number.isFinite(value)) pow = value;
	}

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

{#if mini && !open}
	<!-- ================= Mini variant: one slim tappable bar ================= -->
	{#if mining}
		<!-- Mining pill: odds-fill background + live best/target + cancel. -->
		<div class="mt-2 flex items-center gap-1.5">
			<button
				type="button"
				onclick={() => (open = true)}
				aria-label="Show mining details"
				class="relative min-w-0 flex-1 overflow-hidden rounded-full border border-[color-mix(in_oklab,var(--ui-color-primary-500)_25%,transparent)] bg-primary-500/5 px-3 py-2 text-left transition hover:border-[color-mix(in_oklab,var(--ui-color-primary-500)_45%,transparent)]"
			>
				<span
					class="absolute inset-y-0 left-0 bg-[color-mix(in_oklab,var(--ui-color-primary-500)_12%,transparent)] transition-[width] duration-150 ease-out"
					style="width:{percent}%"
					aria-hidden="true"
				></span>
				<span class="relative flex items-center gap-2">
					<Icon
						name="i-lucide-pickaxe"
						class="pow-pick-swing size-3.5 shrink-0 text-[var(--ui-color-primary-500)]"
					/>
					<span class="min-w-0 flex-1 truncate text-[11.5px] font-bold text-[var(--ui-text)]">
						Mining {miniStatus ?? `0/${pow} bits`}
					</span>
					<Icon
						name="i-lucide-chevron-down"
						class="size-3.5 shrink-0 text-[var(--ui-text-dimmed)]"
					/>
				</span>
				<span
					class="sr-only"
					role="progressbar"
					aria-label="Mining progress"
					aria-valuemin="0"
					aria-valuemax="100"
					aria-valuenow={Math.floor(percent)}>{Math.floor(percent)}%</span
				>
			</button>
			{#if oncancel}
				<button
					type="button"
					onclick={oncancel}
					aria-label="Cancel mining"
					title="Cancel mining"
					class="grid size-8 shrink-0 place-items-center rounded-full border border-[var(--ui-border-accented)] text-[var(--ui-text-muted)] transition hover:border-[var(--tone-error-text)] hover:text-[var(--tone-error-text)] active:scale-95"
				>
					<Icon name="i-lucide-x" class="size-3.5" />
				</button>
			{/if}
		</div>
	{:else}
		<!-- Picker pill: drag (or tap) the segment track to slide the effort rank;
		     the labeled sides open the full panel for presets & fine-tune. -->
		<div
			class={cn(
				'mt-2 flex w-full items-center justify-between gap-2 rounded-full border px-2.5 py-2 transition',
				pow > 0
					? 'border-[color-mix(in_oklab,var(--ui-color-primary-500)_25%,transparent)] bg-primary-500/5'
					: 'border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)]/50'
			)}
		>
			<button
				type="button"
				onclick={() => (open = true)}
				aria-expanded={false}
				title="Proof of Work — open details"
				class="flex w-28 min-w-0 shrink-0 items-center gap-1.5 rounded-full px-1 py-0.5 transition hover:text-[var(--ui-color-primary-500)] active:scale-95"
			>
				<Icon
					name={miniIcon}
					class={cn(
						'size-4 shrink-0',
						pow > 0 ? 'text-[var(--ui-color-primary-500)]' : 'text-[var(--ui-text-dimmed)]'
					)}
				/>
				<span
					class={cn(
						'max-w-[110px] truncate text-[11.5px] font-bold sm:max-w-none',
						pow > 0 ? 'text-[var(--ui-text)]' : 'text-[var(--ui-text-muted)]'
					)}
				>
					PoW {pow > 0 ? `· ${tier?.label ?? 'Custom'}` : 'off'}
				</span>
			</button>

			<!-- Rank track: segments are the visual, an invisible native range input
			     overlaid on top gives click / drag / keyboard for free. -->
			<div class="flex-1">
				<div
					class="pow-rank-track relative w-full max-w-52"
					title="Drag to set effort — {tier ? `${tier.label} (${pow} bits)` : `${pow} bits`}"
				>
					{#each miniSegments as on, index (index)}
						<span class={on ? 'is-filled' : ''} aria-hidden="true"></span>
					{/each}
					<input
						type="range"
						class="pow-rank-input"
						min="0"
						max={RANK_MAX}
						step="1"
						value={rankValue}
						oninput={setRank}
						onchange={setRank}
						aria-label="Proof of Work effort — drag to change"
					/>
				</div>
			</div>

			<button
				type="button"
				onclick={() => (open = true)}
				aria-expanded={false}
				title="Proof of Work — open details"
				class="flex min-w-0 shrink-0 items-center gap-1 rounded-full px-1 py-0.5 transition hover:text-[var(--ui-color-primary-500)] active:scale-95"
			>
				<span class="truncate font-mono text-[10.5px] text-[var(--ui-text-dimmed)]">
					{pow > 0 ? `${pow} bits · ${estimateLabel(pow)}` : 'drag to add'}
				</span>
				<Icon name="i-lucide-chevron-down" class="size-3.5 shrink-0 text-[var(--ui-text-dimmed)]" />
			</button>
		</div>
	{/if}
{:else}
	<div
		class={cn(
			'rounded-xl border border-primary-500/15 bg-primary-500/5',
			effCompact ? 'mt-2 p-2.5 sm:p-3' : 'mt-2.5 p-3 sm:mt-3 sm:p-4'
		)}
	>
		<!-- Header: identity + live difficulty readout (+ cancel while mining). -->
		<div class="flex items-start justify-between gap-3">
			<div class="flex min-w-0 items-center gap-2">
				<span
					class="grid size-8 shrink-0 place-items-center rounded-lg bg-[color-mix(in_oklab,var(--ui-color-primary-500)_12%,transparent)] text-[var(--ui-color-primary-500)]"
				>
					<Icon name="i-lucide-pickaxe" class={cn('size-4', mining && 'pow-pick-swing')} />
				</span>
				<div class="min-w-0">
					<p class="text-[13px] leading-tight font-bold text-[var(--ui-text)]">Proof of Work</p>
					<p class="mt-0.5 hidden text-[11px] text-[var(--ui-text-dimmed)] sm:block">
						{mining
							? 'Mining your note — keep this tab open.'
							: 'Add anti-spam effort — free, mined in your browser.'}
					</p>
				</div>
			</div>
			<div class="flex shrink-0 items-center gap-2.5">
				{#if mini}
					<button
						type="button"
						onclick={() => (open = false)}
						aria-label="Hide Proof of Work options"
						title="Hide options"
						class="grid size-8 shrink-0 place-items-center rounded-full text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)] active:scale-95"
					>
						<Icon name="i-lucide-chevron-up" class="size-4" />
					</button>
				{/if}
				<div class="text-right leading-tight">
					<span class="block font-mono text-base font-bold sm:text-lg">
						<span class="text-[var(--ui-color-primary-500)]">{pow}</span>
						<span class="text-[11px] font-semibold text-[var(--ui-text-muted)]"> bits</span>
					</span>
					<span class="text-[10px] text-[var(--ui-text-dimmed)]">{effortLabel}</span>
				</div>
				{#if mining && oncancel}
					<button
						type="button"
						onclick={oncancel}
						class="flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--ui-border-accented)] px-3 py-2 text-[12px] font-bold text-[var(--ui-text-muted)] transition hover:border-[var(--tone-error-text)] hover:text-[var(--tone-error-text)] active:scale-95"
					>
						<Icon name="i-lucide-square" class="size-3.5" />
						Cancel
					</button>
				{/if}
			</div>
		</div>

		{#if mining}
			<!-- ================= Mining: big, calm telemetry ================= -->
			<HashViz bits={hashvizBits} {mining} class="hash-viz-lg mt-3" />
			{#if progress}
				<!-- Live receipt: the best candidate's zero prefix growing in real time. -->
				<p
					class="mt-2 flex items-baseline font-mono text-[12px]"
					aria-label="Best candidate hash so far"
				>
					{#key liveZeroCount}
						<span class="pow-live-zeros">{liveZeros}</span>
					{/key}
					{#if liveZeroCount > 0}
						<span class="text-[var(--ui-text-dimmed)]" aria-hidden="true">·</span>
					{/if}
					<span class="text-[var(--ui-text-dimmed)]">{liveRest}…</span>
					<span class="ml-1.5 font-sans text-[10px] text-[var(--ui-text-dimmed)]">
						best {progress.best}/{pow} bits
					</span>
				</p>

				<!-- Odds-based progress: mining is memoryless, so the percent shown is
			     the chance a valid hash has already landed. -->
				<div class="mt-2.5 flex items-center gap-3">
					<div
						class="h-2 flex-1 overflow-hidden rounded-full bg-[var(--ui-bg-muted)]"
						role="progressbar"
						aria-label="Mining progress"
						aria-valuemin="0"
						aria-valuemax="100"
						aria-valuenow={Math.floor(percent)}
					>
						<div
							class="h-full rounded-full bg-primary-500 transition-[width] duration-150 ease-out"
							style="width:{percent}%"
						></div>
					</div>
					<span
						class="w-11 shrink-0 text-right font-mono text-[15px] font-bold text-[var(--ui-color-primary-500)]"
					>
						{Math.floor(percent)}%
					</span>
				</div>

				<div class="mt-2 flex flex-wrap items-center gap-1.5">
					<span
						class="inline-flex items-center gap-1 rounded-full bg-[var(--ui-bg-muted)] px-2 py-1 font-mono text-[10px] text-[var(--ui-text-muted)]"
						title="Hashing speed of this device"
					>
						<Icon name="i-lucide-gauge" class="size-3 text-[var(--ui-text-dimmed)]" />
						{formatHashrate(progress.hashrate)}
					</span>
					<span
						class="inline-flex items-center gap-1 rounded-full bg-[var(--ui-bg-muted)] px-2 py-1 font-mono text-[10px] text-[var(--ui-text-muted)]"
						title="Time spent mining"
					>
						<Icon name="i-lucide-timer" class="size-3 text-[var(--ui-text-dimmed)]" />
						{formatDuration(progress.elapsedMs)}
					</span>
					<span
						class="inline-flex items-center gap-1 rounded-full bg-[var(--ui-bg-muted)] px-2 py-1 font-mono text-[10px] text-[var(--ui-text-muted)]"
						title="Estimated time remaining"
					>
						<Icon name="i-lucide-hourglass" class="size-3 text-[var(--ui-text-dimmed)]" />
						≈ {formatDuration(etaMs)} left
					</span>
				</div>

				<div
					class="mt-2 flex items-center justify-between font-mono text-[10px] text-[var(--ui-text-dimmed)]"
				>
					<span>{progress.hashes.toLocaleString()} hashes</span>
					<span class="mining-nonce text-primary-500" aria-hidden="true">0x{nonceHex}</span>
				</div>
			{:else}
				<p class="mt-3 flex items-center gap-1.5 text-[11px] text-[var(--ui-text-dimmed)]">
					<Icon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
					Starting the miner…
				</p>
			{/if}
		{:else}
			<!-- ================= Choosing: one tap presets ================= -->
			<div
				class="mt-3 grid grid-cols-3 gap-1.5 sm:gap-2"
				role="radiogroup"
				aria-label="Proof of Work effort"
			>
				{#each PRESETS as preset (preset.id)}
					<button
						type="button"
						role="radio"
						aria-checked={activePreset?.id === preset.id}
						title={preset.hint}
						onclick={() => applyPreset(preset.bits)}
						class={cn(
							'relative flex flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2.5 text-center transition active:scale-[0.97] sm:py-3',
							effCompact ? 'min-h-[76px]' : 'min-h-[84px]',
							activePreset?.id === preset.id
								? 'border-[color-mix(in_oklab,var(--ui-color-primary-500)_50%,transparent)] bg-[color-mix(in_oklab,var(--ui-color-primary-500)_13%,transparent)] text-[var(--ui-color-primary-500)] shadow-[0_0_18px_-6px_color-mix(in_oklab,var(--ui-color-primary-500)_45%,transparent)]'
								: 'border-[var(--ui-border-muted)] text-[var(--ui-text-muted)] hover:border-[color-mix(in_oklab,var(--ui-color-primary-500)_25%,transparent)] hover:bg-[color-mix(in_oklab,var(--ui-color-primary-500)_5%,transparent)] hover:text-[var(--ui-color-primary-500)]'
						)}
					>
						{#if activePreset?.id === preset.id}
							<span class="absolute top-1.5 right-1.5" aria-hidden="true">
								<Icon name="i-lucide-circle-check" class="size-4" />
							</span>
						{/if}
						<Icon name={preset.icon} class="size-5 sm:size-6" />
						<span class="text-[11.5px] font-bold sm:text-[12.5px]">{preset.label}</span>
						<span class="font-mono text-[9.5px] text-[var(--ui-text-dimmed)]"
							>{preset.bits} bits</span
						>
						<span class="text-[9.5px] font-semibold text-[var(--ui-text-dimmed)]">
							{estimateLabel(preset.bits)}
						</span>
					</button>
				{/each}
			</div>

			<!-- Expectation setting: what happens when they hit post. -->
			<p class="mt-2.5 text-[10.5px] leading-snug text-[var(--ui-text-dimmed)]">
				{#if pow > 0}
					Mining starts after you post — <span class="font-semibold text-[var(--ui-text-muted)]"
						>{estimateLabel(pow)}</span
					>
					{calibrated ? 'on this device' : '(rough guess — your first mined note calibrates it)'}.
				{:else}
					Mining starts only after you post — right now it will publish instantly.
				{/if}
			</p>

			<!-- Power users: raw bits slider behind a disclosure. -->
			<div class="mt-2">
				<button
					type="button"
					onclick={() => (advanced = !advanced)}
					aria-expanded={advanced}
					class="flex items-center gap-1 text-[10.5px] font-bold text-[var(--ui-text-dimmed)] transition hover:text-[var(--ui-color-primary-500)]"
				>
					<Icon
						name={advanced ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'}
						class="size-3"
					/>
					Fine-tune difficulty
					{#if tier === null && pow > 0}
						<span class="font-mono">· custom {pow} bits</span>
					{/if}
				</button>
				{#if advanced}
					<div class="mt-1.5 rounded-lg bg-[var(--ui-bg-muted)] p-2.5">
						<div
							class="flex items-baseline justify-between font-mono text-[10.5px] text-[var(--ui-text-dimmed)]"
						>
							<span class="font-bold text-[var(--ui-color-primary-500)]">{pow} bits</span>
							<span>{pow === 0 ? 'instant' : estimateLabel(pow)}</span>
						</div>
						<input
							type="range"
							min="0"
							{max}
							bind:value={pow}
							class="pow-slider mt-2 w-full"
							aria-label="Proof of Work difficulty"
						/>
						<div
							class="mt-1 flex justify-between font-mono text-[9px] text-[var(--ui-text-dimmed)]"
							aria-hidden="true"
						>
							<span>0</span><span>{Math.round(max / 2)}</span><span>{max}</span>
						</div>
					</div>
				{/if}
			</div>

			<!-- The inevitable question, answered in plain words. -->
			<div class="mt-2">
				<button
					type="button"
					onclick={() => (about = !about)}
					aria-expanded={about}
					class="flex items-center gap-1 text-[10.5px] font-bold text-[var(--ui-text-dimmed)] transition hover:text-[var(--ui-color-primary-500)]"
				>
					<Icon name="i-lucide-circle-help" class="size-3" />
					What is this?
				</button>
				{#if about}
					<div
						class="mt-1.5 rounded-lg bg-[var(--ui-bg-muted)] p-2.5 text-[11px] leading-relaxed text-[var(--ui-text-muted)]"
					>
						<p>
							Before publishing, your browser solves a tiny hashing puzzle. The note's ID then
							starts with zeros — <span class="font-semibold text-[var(--ui-text)]"
								>proof that real work went into it</span
							>. Relays use that proof to welcome your note and filter out cheap spam bots — no
							accounts, no fees.
						</p>
						<p class="mt-1.5">
							More bits = stronger proof, longer wait. Mining runs in a background worker — just
							keep this tab open while it finishes.
						</p>
					</div>
				{/if}
			</div>

			<!-- Preview: what the mined ID will look like. -->
			<div
				class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-[var(--ui-bg-muted)] px-2.5 py-2"
			>
				<HashViz bits={hashvizBits} {mining} class="hash-viz-lg" />
				{#if pow > 0}
					<p
						class="min-w-0 flex-1 font-mono text-[10px] text-[var(--ui-text-dimmed)]"
						aria-label="Preview of the mined note ID"
					>
						ID starts with
						<span
							class="font-bold text-[var(--ui-color-primary-500)] [text-shadow:0_0_5px_color-mix(in_oklab,var(--ui-color-primary-500)_55%,transparent)]"
						>
							{'0'.repeat(Math.min(Math.floor(pow / 4), 8))}
						</span>
						<span aria-hidden="true">·xxxx…</span>
					</p>
				{:else}
					<p class="flex-1 text-[10px] text-[var(--ui-text-dimmed)]">
						Pick an effort to see the mined ID preview.
					</p>
				{/if}
			</div>
		{/if}

		{#if !mining && pow > 20}
			<p class="mt-2 flex items-center gap-1.5 text-[10.5px] text-warm-500">
				<Icon name="i-lucide-triangle-alert" class="size-3.5 shrink-0" />
				High difficulty may take noticeably longer to mine — you can cancel anytime.
			</p>
		{/if}
	</div>
{/if}
