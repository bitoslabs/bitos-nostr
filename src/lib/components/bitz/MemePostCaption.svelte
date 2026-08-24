<script lang="ts">
	let {
		value = $bindable(''),
		busy,
		softLimit = 300,
		hardLimit = 1000
	}: {
		value: string;
		busy: boolean;
		softLimit?: number;
		hardLimit?: number;
	} = $props();

	const overSoftLimit = $derived(value.length > softLimit);
</script>

<div
	class="rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3.5 py-3 transition focus-within:border-warm-500 focus-within:bg-[var(--ui-bg)] focus-within:ring-2 focus-within:ring-warm-500/20"
>
	<textarea
		bind:value
		rows="2"
		maxlength={hardLimit}
		placeholder="Write a caption… #hashtags and @mentions work"
		aria-label="Meme caption"
		readonly={busy}
		class="w-full resize-none bg-transparent text-[15px] leading-relaxed text-[var(--ui-text)] outline-none placeholder:text-[var(--ui-text-dimmed)]"
	></textarea>
	{#if value.length > softLimit - 50}
		<p
			class="text-right text-[10.5px] font-bold tabular-nums {value.length > hardLimit
				? 'text-[var(--tone-error-text)]'
				: overSoftLimit
					? 'text-warm-500'
					: 'text-[var(--ui-text-dimmed)]'}"
		>
			{value.length} / {overSoftLimit ? hardLimit : softLimit}
		</p>
	{/if}
</div>
