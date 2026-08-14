<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils/cn';

	/**
	 * System-settings group: a small label (optional description) above a
	 * rounded `.surface-card` whose children are `SettingsRow`s separated by
	 * hairline dividers. Mirrors the iOS/macOS settings list look that the
	 * mobile settings index already uses.
	 */
	let {
		label,
		description,
		class: cls,
		children
	}: {
		label?: string;
		description?: string;
		class?: string;
		children: Snippet;
	} = $props();
</script>

<section class={cls}>
	{#if label || description}
		<div class="mb-2 px-1">
			{#if label}
				<p class="text-[13px] font-semibold tracking-[-0.01em] text-[var(--ui-text-muted)]">
					{label}
				</p>
			{/if}
			{#if description}
				<p class="mt-0.5 text-[12px] text-[var(--ui-text-dimmed)]">{description}</p>
			{/if}
		</div>
	{/if}
	<div class={cn('surface-card divide-y divide-[var(--ui-border-muted)] overflow-hidden')}>
		{@render children()}
	</div>
</section>
