<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';

	let {
		title = 'This area needs login',
		description = 'Create or import a key to continue.'
	}: {
		title?: string;
		description?: string;
	} = $props();
</script>

<div class="flex h-full overflow-y-auto">
	<div class="mx-auto flex w-full max-w-[640px] items-center px-5 py-10">
		<div class="post-card w-full p-6 text-center sm:p-8">
			<div
				class="mx-auto hex-clip grid size-14 place-items-center rounded-2xl bg-primary-500/10 text-primary-500"
			>
				<Icon name="i-lucide-key-round" class="size-7" />
			</div>
			<h1 class="mt-4 font-display text-[28px] leading-none font-extrabold tracking-tight">
				{title}
			</h1>
			<p class="mt-2 text-[14px] leading-relaxed text-[var(--ui-text-muted)]">
				{description}
			</p>
			<div class="mt-6 flex flex-wrap justify-center gap-3">
				<a
					href="/welcome"
					class="rounded-full bg-primary-500 px-5 py-2.5 text-[13px] font-bold text-white shadow-[var(--glow-primary)] transition hover:bg-primary-600"
				>
					Create or import a key
				</a>
				<a
					href="/discover"
					class="rounded-full border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-5 py-2.5 text-[13px] font-bold text-[var(--ui-text-muted)] transition hover:text-primary-500"
				>
					Browse public content
				</a>
			</div>
		</div>
	</div>
</div>
