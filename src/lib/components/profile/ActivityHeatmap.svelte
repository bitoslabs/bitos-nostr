<script lang="ts">
	/**
	 * GitHub-style posting activity graph for a profile. Renders the last ~22
	 * weeks of notes as a column-major grid (each column = one ISO week,
	 * Sun→Sat) with month labels on top and weekday hints on the left. Fully
	 * token-driven so it flips in dark mode and respects reduced motion.
	 */
	import Icon from '$lib/components/ui/Icon.svelte';
	import {
		buildActivityHeatmap,
		type ActivityHeatmap,
		compactCount
	} from '$lib/utils/profile-stats';
	import type { FeedNote } from '$lib/nostr/types';

	let { notes, weeks = 22 }: { notes: FeedNote[]; weeks?: number } = $props();

	const data = $derived(buildActivityHeatmap(notes, weeks)) as ActivityHeatmap;

	const monthLabels = $derived(buildMonthLabels(data.weeks));
	const cellColor: Record<number, string> = {
		0: 'var(--ui-bg-accented)',
		1: 'color-mix(in oklab, var(--ui-color-primary-500) 30%, var(--surface-bg))',
		2: 'color-mix(in oklab, var(--ui-color-primary-500) 55%, var(--surface-bg))',
		3: 'color-mix(in oklab, var(--ui-color-primary-500) 78%, var(--surface-bg))',
		4: 'var(--ui-color-primary-500)'
	};

	function buildMonthLabels(weeksList: ActivityHeatmap['weeks']) {
		const labels: { index: number; label: string }[] = [];
		let lastMonth = -1;
		weeksList.forEach((week, i) => {
			const mid = week[0]?.date;
			if (!mid) return;
			const month = mid.getMonth();
			if (month !== lastMonth) {
				labels.push({
					index: i,
					label: mid.toLocaleDateString(undefined, { month: 'short' })
				});
				lastMonth = month;
			}
		});
		return labels;
	}

	function titleFor(day: { count: number; date: Date }) {
		const formatted = day.date.toLocaleDateString(undefined, {
			weekday: 'short',
			month: 'short',
			day: 'numeric'
		});
		return `${day.count === 0 ? 'No posts' : `${day.count} post${day.count === 1 ? '' : 's'}`} · ${formatted}`;
	}
</script>

<div class="post-card mb-5 p-4">
	<div class="mb-3 flex items-center justify-between gap-3">
		<div class="flex items-center gap-2">
			<span
				class="grid size-7 place-items-center rounded-lg bg-primary-500/10 text-primary-600 dark:text-primary-400"
			>
				<Icon name="i-lucide-activity" class="size-4" />
			</span>
			<h3 class="font-display text-[15px] font-extrabold">Posting activity</h3>
		</div>
		<span class="text-[11px] font-semibold text-[var(--ui-text-muted)]">
			{compactCount(data.total)} posts · last {weeks} weeks
		</span>
	</div>

	{#if data.total === 0}
		<div
			class="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--ui-border-accented)] bg-[var(--ui-bg-muted)] px-4 py-8 text-center"
		>
			<Icon name="i-lucide-calendar-x" class="size-5 text-[var(--ui-text-dimmed)]" />
			<p class="text-[12.5px] font-semibold">No posts in this window</p>
			<p class="text-[11.5px] text-[var(--ui-text-muted)]">
				Activity will appear here once notes land.
			</p>
		</div>
	{:else}
		<!-- Horizontal-scroll wrapper keeps the graph usable on narrow viewports. -->
		<div class="[scrollbar-width:none] overflow-x-auto [&::-webkit-scrollbar]:hidden">
			<div class="inline-flex flex-col gap-1.5 pr-1">
				<!-- Month labels -->
				<div
					class="relative ml-[18px] h-3.5 text-[9.5px] font-semibold text-[var(--ui-text-dimmed)]"
				>
					{#each monthLabels as m (m.index)}
						<span
							class="absolute -translate-x-1/2 whitespace-nowrap"
							style="left:calc({m.index} * 14px + 5px)">{m.label}</span
						>
					{/each}
				</div>

				<div class="flex gap-[3px]">
					<!-- Weekday gutter (Mon / Wed / Fri) -->
					<div
						class="mr-[3px] flex flex-col gap-[3px] text-[9px] font-medium text-[var(--ui-text-dimmed)]"
					>
						<div class="h-[11px] leading-[11px]">Sun</div>
						<div class="h-[11px] leading-[11px]">Mon</div>
						<div class="h-[11px] leading-[11px]"></div>
						<div class="h-[11px] leading-[11px]">Wed</div>
						<div class="h-[11px] leading-[11px]"></div>
						<div class="h-[11px] leading-[11px]">Fri</div>
						<div class="h-[11px] leading-[11px]"></div>
					</div>
					<!-- Week columns -->
					<div class="flex gap-[3px]">
						{#each data.weeks as week, wi (wi)}
							<div class="flex flex-col gap-[3px]">
								{#each week as day (day.iso)}
									<div
										class="size-[11px] rounded-[2.5px] ring-1 ring-black/5 ring-inset dark:ring-white/5"
										style="background:{cellColor[day.level]}"
										title={titleFor(day)}
									></div>
								{/each}
							</div>
						{/each}
					</div>
				</div>

				<!-- Legend -->
				<div
					class="mt-1 flex items-center justify-between pl-[18px] text-[10px] font-medium text-[var(--ui-text-dimmed)]"
				>
					<div class="flex items-center gap-1.5">
						<span>Less</span>
						{#each [0, 1, 2, 3, 4] as lvl (lvl)}
							<span class="size-[11px] rounded-[2.5px]" style="background:{cellColor[lvl]}"></span>
						{/each}
						<span>More</span>
					</div>
				</div>
			</div>
		</div>

		<!-- Streak chips -->
		<div class="mt-3 grid grid-cols-3 gap-2">
			<div class="rounded-xl bg-[var(--ui-bg-muted)] px-3 py-2 text-center">
				<div class="flex items-center justify-center gap-1 text-[var(--ui-text-dimmed)]">
					<Icon name="i-lucide-flame" class="size-3.5 text-warm-500" />
				</div>
				<div class="mt-0.5 text-[16px] font-extrabold tabular-nums">{data.currentStreak}</div>
				<div class="text-[10px] font-semibold text-[var(--ui-text-muted)]">Day streak</div>
			</div>
			<div class="rounded-xl bg-[var(--ui-bg-muted)] px-3 py-2 text-center">
				<div class="flex items-center justify-center gap-1 text-[var(--ui-text-dimmed)]">
					<Icon name="i-lucide-trophy" class="size-3.5 text-amber-500" />
				</div>
				<div class="mt-0.5 text-[16px] font-extrabold tabular-nums">{data.bestStreak}</div>
				<div class="text-[10px] font-semibold text-[var(--ui-text-muted)]">Best run</div>
			</div>
			<div class="rounded-xl bg-[var(--ui-bg-muted)] px-3 py-2 text-center">
				<div class="flex items-center justify-center gap-1 text-[var(--ui-text-dimmed)]">
					<Icon name="i-lucide-bar-chart-3" class="size-3.5 text-primary-500" />
				</div>
				<div class="mt-0.5 text-[16px] font-extrabold tabular-nums">{data.max}</div>
				<div class="text-[10px] font-semibold text-[var(--ui-text-muted)]">Busiest day</div>
			</div>
		</div>
	{/if}
</div>
