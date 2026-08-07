<script lang="ts">
	// Stable per-signal accent colors for the live mix bar.
	const SIGNAL_COLORS: Record<string, string> = {
		recency: '#3b82f6',
		engagement: '#f97316',
		zaps: '#eab308',
		affinity: '#ec4899',
		wot: '#22c55e'
	};

	import Icon from '$lib/components/ui/Icon.svelte';
	import {
		algorithmPreferences,
		DEFAULT_RECENCY_HALF_LIFE_SECONDS,
		SURFACE_META,
		signalDefinitions
	} from '$lib/algorithm';
	import {
		PRESET_META,
		presetConfigFor,
		detectPreset
	} from '$lib/algorithm/presets';
	import { refreshWot } from '$lib/algorithm/context';
	import type { PresetId, SurfaceId } from '$lib/algorithm/types';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { contacts } from '$lib/nostr/contacts.svelte';
	import { identity } from '$lib/nostr/identity.svelte';

	const SURFACES: SurfaceId[] = ['feed', 'reels', 'discover'];

	// --- Freshness presets (global recency half-life) ---
	const freshnessPresets: { label: string; seconds: number; blurb: string }[] = [
		{ label: 'Live', seconds: 1 * 3600, blurb: '1h — only the freshest survive' },
		{ label: 'Balanced', seconds: DEFAULT_RECENCY_HALF_LIFE_SECONDS, blurb: '6h — the default' },
		{ label: 'Relaxed', seconds: 24 * 3600, blurb: '24h — older notes still surface' },
		{ label: 'Chill', seconds: 72 * 3600, blurb: '3d — slow feed, evergreen content' }
	];
	const freshnessLabel = $derived.by(() => {
		const s = algorithmPreferences.recencyHalfLifeSeconds;
		const match = freshnessPresets.find((preset) => preset.seconds === s);
		if (match) return match.label;
		if (s < 3600) return `${Math.round(s / 60)}m`;
		if (s < 86400) return `${Math.round(s / 3600)}h`;
		return `${Math.round(s / 86400)}d`;
	});

	const followingCount = $derived(contacts.following.length);
	const hasIdentity = $derived(!!identity.current);

	function fmtPct(weight: number, total: number): string {
		if (total <= 0) return '0%';
		return `${Math.round((weight / total) * 100)}%`;
	}

	function activeWeightTotal(surface: SurfaceId): number {
		return algorithmPreferences.activeWeightTotal(surface);
	}

	/** Which signals are tunable for a surface (novelty is internal-only). */
	function signalsForSurface(surface: SurfaceId) {
		return signalDefinitions.filter(
			(def) => def.id !== 'novelty' && def.id in algorithmPreferences.config[surface].signals
		);
	}

	function surfacePreset(surface: SurfaceId): PresetId {
		return detectPreset(algorithmPreferences.config[surface]);
	}

	function applyPreset(surface: SurfaceId, id: Exclude<PresetId, 'custom'>) {
		algorithmPreferences.applySurfaceConfig(surface, presetConfigFor(id, surface));
		toasts.success(`${SURFACE_META[surface].label}: ${PRESET_META.find((p) => p.id === id)?.label}`);
	}

	function onWeightInput(surface: SurfaceId, id: string, value: number) {
		algorithmPreferences.setWeight(surface, id, value);
	}

	function refreshWotGraph() {
		refreshWot(identity.current?.pk);
		toasts.info('Refreshing web-of-trust graph in the background…');
	}
</script>

<!-- Hero / explainer -->
<div class="post-card mb-5 p-5">
	<div class="flex items-start gap-3">
		<div
			class="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary-500/10 text-primary-500"
		>
			<Icon name="i-lucide-wand-sparkles" class="size-6" />
		</div>
		<div class="min-w-0 flex-1">
			<h2 class="font-display text-[24px] font-extrabold leading-tight">Algorithm</h2>
			<p class="mt-1 text-[13px] leading-relaxed text-[var(--ui-text-muted)]">
				Tune how BitOS ranks your Feed, Reels, and Discover — fully on your device. Turn a
				surface off for pure reverse-chronological order. Nothing leaves your browser.
			</p>
		</div>
	</div>
	<div class="mt-4 grid grid-cols-3 gap-2 text-center">
		<div class="rounded-xl bg-[var(--ui-bg-muted)] px-2 py-3">
			<p class="text-[18px] font-extrabold text-primary-500">100%</p>
			<p class="text-[10.5px] font-semibold text-[var(--ui-text-muted)]">Local-first</p>
		</div>
		<div class="rounded-xl bg-[var(--ui-bg-muted)] px-2 py-3">
			<p class="text-[18px] font-extrabold text-primary-500">{signalDefinitions.length}</p>
			<p class="text-[10.5px] font-semibold text-[var(--ui-text-muted)]">Signals</p>
		</div>
		<div class="rounded-xl bg-[var(--ui-bg-muted)] px-2 py-3">
			<p class="text-[18px] font-extrabold text-primary-500">{followingCount}</p>
			<p class="text-[10.5px] font-semibold text-[var(--ui-text-muted)]">Following</p>
		</div>
	</div>
</div>

<!-- Global freshness -->
<div class="post-card mb-5 p-5">
	<div class="mb-1 flex items-center gap-2">
		<Icon name="i-lucide-timer" class="size-[18px] text-primary-500" />
		<h3 class="text-[15px] font-bold">Freshness</h3>
		<span
			class="ml-auto rounded-full bg-primary-500/10 px-2.5 py-0.5 text-[11px] font-bold text-primary-600"
		>
			{freshnessLabel}
		</span>
	</div>
	<p class="mb-3 text-[12px] leading-relaxed text-[var(--ui-text-muted)]">
		How fast older notes fade from the top. Applies to the Recency signal across all surfaces.
	</p>
	<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
		{#each freshnessPresets as preset (preset.label)}
			<button
				type="button"
				onclick={() => algorithmPreferences.setRecencyHalfLife(preset.seconds)}
				class="rounded-xl border p-3 text-left transition {algorithmPreferences.recencyHalfLifeSeconds ===
				preset.seconds
					? 'border-primary-500 bg-primary-500/10'
					: 'border-[var(--ui-border-muted)] hover:bg-[var(--interactive-hover-bg)]'}"
			>
				<p class="text-[13px] font-bold text-[var(--ui-text)]">{preset.label}</p>
				<p class="mt-0.5 text-[10.5px] leading-tight text-[var(--ui-text-muted)]">
					{preset.blurb}
				</p>
			</button>
		{/each}
	</div>
</div>

<!-- Per-surface controls -->
{#each SURFACES as surface (surface)}
	{@const cfg = algorithmPreferences.config[surface]}
	{@const meta = SURFACE_META[surface]}
	{@const total = activeWeightTotal(surface)}
	{@const preset = surfacePreset(surface)}
	<div class="post-card mb-5 overflow-hidden">
		<!-- Surface header + master switch -->
		<div class="flex items-center gap-3 p-5 pb-3">
			<div
				class="grid size-11 shrink-0 place-items-center rounded-2xl {cfg.enabled
					? 'bg-primary-500/12 text-primary-500'
					: 'bg-[var(--ui-bg-muted)] text-[var(--ui-text-dimmed)]'}"
			>
				<Icon name={meta.icon} class="size-[22px]" />
			</div>
			<div class="min-w-0 flex-1">
				<div class="flex items-center gap-2">
					<h3 class="text-[17px] font-extrabold tracking-tight">{meta.label}</h3>
					{#if !cfg.enabled}
						<span
							class="rounded-full border border-[var(--ui-border-muted)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--ui-text-dimmed)]"
						>
							Chronological
						</span>
					{/if}
				</div>
				<p class="mt-0.5 truncate text-[12px] text-[var(--ui-text-muted)]">{meta.tagline}</p>
			</div>
			<button
				type="button"
				class="toggle {cfg.enabled ? 'on' : ''}"
				aria-label={`Toggle ${meta.label} algorithm`}
				aria-pressed={cfg.enabled}
				onclick={() => algorithmPreferences.toggleSurface(surface, !cfg.enabled)}
			></button>
		</div>

		<div class="px-5 pb-5 {cfg.enabled ? '' : 'pointer-events-none opacity-45'}">
			<!-- Preset selector -->
			<div class="mb-4">
				<p class="mb-2 text-[11px] font-bold tracking-wide text-[var(--ui-text-muted)] uppercase">
					Preset
				</p>
				<div class="grid grid-cols-2 gap-2 sm:grid-cols-5">
					{#each PRESET_META as p (p.id)}
						<button
							type="button"
							onclick={() => applyPreset(surface, p.id)}
							class="rounded-xl border p-2.5 text-left transition {preset === p.id
								? 'border-primary-500 bg-primary-500/10'
								: 'border-[var(--ui-border-muted)] hover:bg-[var(--interactive-hover-bg)]'}"
						>
							<Icon name={p.icon} class="mb-1 size-4 text-primary-500" />
							<p class="text-[12px] font-bold text-[var(--ui-text)]">{p.label}</p>
						</button>
					{/each}
					<div
						class="rounded-xl border border-dashed border-[var(--ui-border-muted)] p-2.5 text-left {preset ===
						'custom'
							? 'border-primary-500/50 bg-primary-500/5'
							: ''}"
					>
						<Icon name="i-lucide-sliders-horizontal" class="mb-1 size-4 text-[var(--ui-text-muted)]" />
						<p class="text-[12px] font-bold text-[var(--ui-text-muted)]">Custom</p>
					</div>
				</div>
			</div>

			<!-- Signal rows -->
			<div class="space-y-1.5">
				{#each signalsForSurface(surface) as def (def.id)}
					{@const state = cfg.signals[def.id]}
					{@const active = state?.enabled && state.weight > 0}
					<div
						class="rounded-xl border border-[var(--ui-border-muted)] p-3 transition {active
							? ''
							: 'opacity-60'}"
					>
						<div class="flex items-center gap-3">
							<button
								type="button"
								class="grid size-8 shrink-0 place-items-center rounded-lg transition {active
									? 'bg-primary-500/12 text-primary-500'
									: 'bg-[var(--ui-bg-muted)] text-[var(--ui-text-dimmed)] hover:text-[var(--ui-text-muted)]'}"
								aria-label={`Toggle ${def.label}`}
								aria-pressed={state?.enabled}
								onclick={() =>
									algorithmPreferences.toggleSignal(surface, def.id, !state?.enabled)}
							>
								<Icon name={def.icon} class="size-[17px]" />
							</button>
							<div class="min-w-0 flex-1">
								<p class="truncate text-[13.5px] font-bold text-[var(--ui-text)]">{def.label}</p>
								<p class="truncate text-[11px] text-[var(--ui-text-muted)]">{def.description}</p>
							</div>
							<span
								class="shrink-0 rounded-full bg-[var(--ui-bg-muted)] px-2 py-0.5 text-[11px] font-bold tabular-nums text-[var(--ui-text)]"
							>
								{fmtPct(state?.weight ?? 0, total)}
							</span>
						</div>
						{#if state?.enabled}
							<div class="mt-2.5 flex items-center gap-3">
								<input
									type="range"
									min="0"
									max="1"
									step="0.05"
									value={state?.weight ?? 0}
									class="algorithm-range flex-1"
									oninput={(e) => onWeightInput(surface, def.id, Number(e.currentTarget.value))}
								/>
							</div>
						{/if}
					</div>
				{/each}
			</div>

			<!-- Live weight bar -->
			{#if total > 0}
				<div class="mt-3">
					<p
						class="mb-1.5 text-[11px] font-bold tracking-wide text-[var(--ui-text-muted)] uppercase"
					>
						Live mix
					</p>
					<div class="flex h-2.5 overflow-hidden rounded-full bg-[var(--ui-bg-muted)]">
						{#each signalsForSurface(surface) as def (def.id)}
							{@const state = cfg.signals[def.id]}
							{#if state?.enabled && state.weight > 0}
								<div
									style="width:{(state.weight / total) * 100}%; background:{SIGNAL_COLORS[def.id] ?? '#94a3b8'}"
									class="h-full transition-all duration-300"
									title={`${def.label} ${fmtPct(state.weight, total)}`}
								></div>
							{/if}
						{/each}
					</div>
				</div>
			{/if}

			<!-- Diversity + surface actions -->
			<div class="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ui-border-muted)] pt-3">
				<button
					type="button"
					class="flex items-center gap-2.5 text-left"
					onclick={() => algorithmPreferences.toggleDiversity(surface, !cfg.diversityEnabled)}
				>
					<span
						class="grid size-8 shrink-0 place-items-center rounded-lg transition {cfg.diversityEnabled
							? 'bg-primary-500/12 text-primary-500'
							: 'bg-[var(--ui-bg-muted)] text-[var(--ui-text-dimmed)]'}"
					>
						<Icon name="i-lucide-shuffle" class="size-[17px]" />
					</span>
					<span class="min-w-0">
						<span class="block text-[13px] font-bold text-[var(--ui-text)]">Avoid author runs</span>
						<span class="block text-[11px] text-[var(--ui-text-muted)]"
							>Spread one author's posts out</span
						>
					</span>
				</button>
				<button
					type="button"
					class="text-[12px] font-bold text-[var(--ui-text-muted)] transition hover:text-primary-500"
					onclick={() => {
						algorithmPreferences.resetSurface(surface);
						toasts.info(`${meta.label} reset to defaults`);
					}}
				>
					Reset
				</button>
			</div>
		</div>
	</div>
{/each}

<!-- Advanced -->
<div class="post-card mb-5 p-5">
	<div class="mb-3 flex items-center gap-2">
		<Icon name="i-lucide-settings-2" class="size-[18px] text-primary-500" />
		<h3 class="text-[15px] font-bold">Advanced</h3>
	</div>
	<div class="space-y-2">
		<button
			type="button"
			class="flex w-full items-center gap-3 rounded-xl border border-[var(--ui-border-muted)] p-3 text-left transition hover:bg-[var(--interactive-hover-bg)] disabled:cursor-not-allowed disabled:opacity-50"
			onclick={refreshWotGraph}
			disabled={!hasIdentity || followingCount === 0}
		>
			<Icon name="i-lucide-network" class="size-5 text-primary-500" />
			<div class="min-w-0 flex-1">
				<p class="text-[13px] font-bold text-[var(--ui-text)]">Refresh web-of-trust graph</p>
				<p class="text-[11px] text-[var(--ui-text-muted)]">
					Re-fetch follow-of-follows used by the trust signal.
				</p>
			</div>
			<Icon name="i-lucide-chevron-right" class="size-4 text-[var(--ui-text-dimmed)]" />
		</button>
		<button
			type="button"
			class="flex w-full items-center gap-3 rounded-xl border border-[var(--tone-error-text)]/20 p-3 text-left transition hover:bg-[var(--tone-error-bg)]"
			onclick={() => {
				algorithmPreferences.resetAll();
				toasts.success('All algorithm settings reset to defaults');
			}}
		>
			<Icon name="i-lucide-rotate-ccw" class="size-5 text-[var(--tone-error-text)]" />
			<div class="min-w-0 flex-1">
				<p class="text-[13px] font-bold text-[var(--tone-error-text)]">Reset everything</p>
				<p class="text-[11px] text-[var(--ui-text-muted)]">
					Restore all surfaces + freshness to their shipped defaults.
				</p>
			</div>
		</button>
	</div>
</div>

<style>
	/* Range input — themed to match the primary accent. */
	.algorithm-range {
		-webkit-appearance: none;
		appearance: none;
		height: 6px;
		border-radius: 9999px;
		background: var(--ui-border-accented);
		outline: none;
	}
	.algorithm-range::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 18px;
		height: 18px;
		border-radius: 9999px;
		background: var(--ui-color-primary-500);
		border: 3px solid var(--surface-bg);
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
		cursor: pointer;
		transition: transform 0.1s;
	}
	.algorithm-range::-webkit-slider-thumb:hover {
		transform: scale(1.12);
	}
	.algorithm-range::-moz-range-thumb {
		width: 18px;
		height: 18px;
		border-radius: 9999px;
		background: var(--ui-color-primary-500);
		border: 3px solid var(--surface-bg);
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
		cursor: pointer;
	}
</style>
