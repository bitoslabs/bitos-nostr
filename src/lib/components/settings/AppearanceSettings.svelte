<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import { accentOptions, neutralOptions, preferences } from '$lib/theme/preferences.svelte';
	import type { DensityMode, RoundedMode } from '$lib/theme/preferences.svelte';

	const modes = [
		{ key: 'light', label: 'Light', icon: 'i-lucide-sun' },
		{ key: 'dark', label: 'Dark', icon: 'i-lucide-moon' },
		{ key: 'system', label: 'System', icon: 'i-lucide-monitor' }
	] as const;
	const fontSizes = [
		{ key: 'sm', label: 'Small' },
		{ key: 'md', label: 'Default' },
		{ key: 'lg', label: 'Large' }
	] as const;
	const roundedOptions: { key: RoundedMode; label: string; radius: string }[] = [
		{ key: 'sharp', label: 'Sharp', radius: '0.25rem' },
		{ key: 'soft', label: 'Soft', radius: '0.625rem' },
		{ key: 'round', label: 'Round', radius: '0.875rem' },
		{ key: 'pillowy', label: 'Pillowy', radius: '1.5rem' }
	];
	const densityOptions: { key: DensityMode; label: string; description: string }[] = [
		{ key: 'normal', label: 'Normal', description: 'Comfortable spacing' },
		{ key: 'compact', label: 'Compact', description: 'More content on screen' }
	];
	const sizeLabels = ['Extra Small', 'Small', 'Medium', 'Large', 'Extra Large'];
	const textSizeIndex = $derived(
		fontSizes.findIndex((item) => item.key === preferences.state.fontSize)
	);
	const activeSizeLabel = $derived(sizeLabels[Math.max(0, textSizeIndex) + 1] ?? 'Default');
</script>

<h2 class="mb-1 font-display text-[24px] font-extrabold">Appearance</h2>
<p class="mb-6 text-[13px] text-[var(--ui-text-muted)]">Customize how BitOS looks for you</p>

<div class="post-card mb-5 p-5">
	<h3 class="mb-4 text-[15px] font-bold">Theme</h3>
	<div class="grid grid-cols-3 gap-3">
		{#each modes as m (m.key)}
			<button
				type="button"
				onclick={() => preferences.setMode(m.key)}
				class="rounded-xl border-2 p-3 transition {preferences.state.mode === m.key
					? 'border-primary-500'
					: 'border-[var(--ui-border-muted)] hover:border-[var(--ui-border-accented)]'}"
			>
				<div
					class="mb-2 grid h-16 place-items-center rounded-lg {m.key === 'light'
						? 'bg-[var(--ui-bg-muted)]'
						: m.key === 'dark'
							? 'bg-ink'
							: 'bg-[var(--ui-bg-accented)]'}"
				>
					<Icon
						name={m.icon}
						class={m.key === 'dark'
							? 'size-5 text-white'
							: m.key === 'light'
								? 'size-5 text-warm-500'
								: 'size-5 text-[var(--ui-text-muted)]'}
					/>
				</div>
				<p class="text-center text-[12px] font-bold">{m.label}</p>
			</button>
		{/each}
	</div>
</div>

<div class="post-card mb-5 p-5">
	<h3 class="mb-4 text-[15px] font-bold">Accent color</h3>
	<div class="flex flex-wrap gap-3">
		{#each accentOptions as a (a.key)}
			<button
				type="button"
				onclick={() => preferences.setAccent(a.key)}
				class="size-10 cursor-pointer rounded-full transition-transform hover:scale-110 {preferences
					.state.accent === a.key
					? 'ring-2 ring-offset-2 ring-offset-[var(--surface-bg)]'
					: ''}"
				style="background:{a.hex}; --tw-ring-color:{a.hex}"
				aria-label={a.label}
			>
				{#if preferences.state.accent === a.key}<Icon
						name="i-lucide-check"
						class="mx-auto size-4 text-white"
					/>{/if}
			</button>
		{/each}
	</div>
</div>

<div class="post-card mb-5 p-5">
	<h3 class="mb-4 text-[15px] font-bold">Neutral color</h3>
	<div class="flex flex-wrap gap-3">
		{#each neutralOptions as n (n.key)}
			<button
				type="button"
				onclick={() => preferences.setNeutral(n.key)}
				class="size-10 cursor-pointer rounded-full transition-transform hover:scale-110 {preferences
					.state.neutral === n.key
					? 'ring-2 ring-offset-2 ring-offset-[var(--surface-bg)]'
					: ''}"
				style="background:{n.hex}; --tw-ring-color:{n.hex}"
				aria-label={n.label}
			>
				{#if preferences.state.neutral === n.key}<Icon
						name="i-lucide-check"
						class="mx-auto size-4 text-white"
					/>{/if}
			</button>
		{/each}
	</div>
</div>

<div class="post-card mb-5 p-5">
	<h3 class="mb-4 text-[15px] font-bold">Rounded</h3>
	<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
		{#each roundedOptions as r (r.key)}
			<button
				type="button"
				onclick={() => preferences.setRounded(r.key)}
				class="border p-3 text-left transition {preferences.state.rounded === r.key
					? 'border-primary-500 bg-primary-500/10 text-primary-500'
					: 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:bg-[var(--interactive-hover-bg)]'}"
				style="border-radius:{r.radius}"
			>
				<div
					class="mx-auto mb-3 h-8 w-full border border-current/25 bg-[var(--ui-bg-muted)]"
					style="border-radius:{r.radius}"
				></div>
				<p class="text-center text-[12px] font-bold">{r.label}</p>
			</button>
		{/each}
	</div>
</div>

<div class="post-card mb-5 p-5">
	<h3 class="mb-4 text-[15px] font-bold">Density</h3>
	<div class="grid grid-cols-2 gap-2">
		{#each densityOptions as d (d.key)}
			<button
				type="button"
				onclick={() => preferences.setDensity(d.key)}
				class="rounded-xl border p-4 text-left transition {preferences.state.density === d.key
					? 'border-primary-500 bg-primary-500/10 text-primary-500'
					: 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:bg-[var(--interactive-hover-bg)]'}"
			>
				<div class="mb-3 space-y-1.5">
					<div class="h-2 rounded-full bg-current/25"></div>
					<div
						class="h-2 rounded-full bg-current/20 {d.key === 'compact' ? 'w-3/4' : 'w-5/6'}"
					></div>
					<div
						class="h-2 rounded-full bg-current/15 {d.key === 'compact' ? 'w-1/2' : 'w-2/3'}"
					></div>
				</div>
				<p class="text-[13px] font-bold text-[var(--ui-text)]">{d.label}</p>
				<p class="mt-0.5 text-[11px] text-[var(--ui-text-muted)]">{d.description}</p>
			</button>
		{/each}
	</div>
</div>

<div class="post-card p-5">
	<h3 class="mb-4 text-[15px] font-bold">Text size</h3>
	<div class="mb-3 flex items-center justify-between text-[12px] text-[var(--ui-text-muted)]">
		<span>A</span><span class="font-bold text-[var(--ui-text)]">{activeSizeLabel}</span><span
			class="text-base">A</span
		>
	</div>
	<div class="mb-4 flex gap-2">
		{#each fontSizes as f (f.key)}
			<button
				type="button"
				onclick={() => preferences.setFontSize(f.key)}
				class="flex-1 rounded-lg border px-3 py-2 text-[13px] font-medium transition {preferences
					.state.fontSize === f.key
					? 'border-primary-500 bg-primary-500/10 text-primary-500'
					: 'border-[var(--ui-border)] text-[var(--ui-text-muted)] hover:bg-[var(--interactive-hover-bg)]'}"
				>{f.label}</button
			>
		{/each}
	</div>
	<div class="mt-5 space-y-3 border-t border-[var(--ui-border-muted)] pt-5">
		<div class="flex items-center justify-between">
			<div>
				<p class="text-[13.5px] font-semibold">Reduced motion</p>
				<p class="text-[11px] text-[var(--ui-text-muted)]">Minimize animations</p>
			</div>
			<button
				type="button"
				class="toggle {preferences.state.reducedMotion ? 'on' : ''}"
				aria-label="Reduced motion"
				aria-pressed={preferences.state.reducedMotion}
				onclick={() => preferences.setReducedMotion(!preferences.state.reducedMotion)}
			></button>
		</div>
		<div class="flex items-center justify-between border-t border-[var(--ui-border-muted)] pt-3">
			<div>
				<p class="text-[13.5px] font-semibold">High contrast</p>
				<p class="text-[11px] text-[var(--ui-text-muted)]">Increase visual contrast</p>
			</div>
			<button
				type="button"
				class="toggle {preferences.state.highContrast ? 'on' : ''}"
				aria-label="High contrast"
				aria-pressed={preferences.state.highContrast}
				onclick={() => preferences.setHighContrast(!preferences.state.highContrast)}
			></button>
		</div>
	</div>
</div>
