<script lang="ts">
	import { fly } from 'svelte/transition';
	import { toasts } from '$lib/stores/toasts.svelte';
	import Icon from './Icon.svelte';

	const tone: Record<string, { cls: string; icon: string }> = {
		info: { cls: 'tone-info', icon: 'i-lucide-info' },
		success: { cls: 'tone-success', icon: 'i-lucide-circle-check' },
		warning: { cls: 'tone-warning', icon: 'i-lucide-triangle-alert' },
		error: { cls: 'tone-error', icon: 'i-lucide-circle-x' }
	};
</script>

<div
	class="pointer-events-none fixed inset-x-0 top-3 z-[100] flex flex-col items-center gap-2 px-3"
>
	{#each toasts.items as t (t.id)}
		<div
			in:fly={{ y: -16, duration: 220 }}
			out:fly={{ y: -16, duration: 160 }}
			class="glass pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-xl border border-[var(--glass-border)] px-3.5 py-2.5 shadow-lg shadow-black/10"
		>
			<div class="grid size-6 shrink-0 place-items-center rounded-md {tone[t.tone].cls}">
				<Icon name={tone[t.tone].icon} class="size-4" />
			</div>
			<p class="min-w-0 flex-1 pt-0.5 text-[13px] leading-snug font-medium text-[var(--ui-text)]">
				{t.message}
			</p>
			{#if t.action}
				<button
					type="button"
					onclick={() => {
						t.action?.run();
						toasts.dismiss(t.id);
					}}
					class="shrink-0 self-center rounded-full bg-primary-500 px-3 py-1 text-[12px] font-bold text-white transition hover:bg-primary-600 active:scale-95"
				>
					{t.action.label}
				</button>
			{/if}
			<button
				type="button"
				onclick={() => toasts.dismiss(t.id)}
				class="shrink-0 rounded-md p-0.5 text-[var(--ui-text-dimmed)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
				aria-label="Dismiss"
			>
				<Icon name="i-lucide-x" class="size-4" />
			</button>
		</div>
	{/each}
</div>
