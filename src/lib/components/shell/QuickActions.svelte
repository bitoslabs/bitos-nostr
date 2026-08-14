<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import WidgetCard from '$lib/components/ui/WidgetCard.svelte';

	type Action = { label: string; icon: string; tone: 'accent' | 'warm' | 'success' };

	const toneText = {
		accent: 'var(--ui-color-primary-500)',
		warm: 'var(--tone-warning-text)',
		success: 'var(--tone-success-text)'
	} as const;

	/** Default right-rail "Quick Actions" widget. */
	let {
		actions = [] as Action[],
		onAction
	}: { actions?: Action[]; onAction?: (label: string) => void } = $props();
</script>

<WidgetCard title="Quick Actions">
	<div class="py-2">
		{#each actions as a (a.label)}
			<button
				type="button"
				onclick={() => onAction?.(a.label)}
				class="flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition hover:bg-[var(--interactive-hover-bg)]"
				style="color:{toneText[a.tone]}"
			>
				<Icon name={a.icon} class="size-4 shrink-0" />
				<span class="text-[var(--ui-text)]">{a.label}</span>
			</button>
		{/each}
	</div>
</WidgetCard>
