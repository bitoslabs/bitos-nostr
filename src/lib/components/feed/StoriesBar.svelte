<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { stories } from '$lib/data/mock';

	const me = $derived(identity.current);
	const myName = $derived(me ? profiles.get(me.pk)?.display_name || 'You' : 'You');

	const colorBg: Record<string, string> = {
		primary: 'bg-primary-500',
		accent: 'bg-accent-500',
		warm: 'bg-warm-500',
		ink: 'bg-ink'
	};
</script>

<div class="post-card p-4">
	<div class="flex [scrollbar-width:none] gap-4 overflow-x-auto [&::-webkit-scrollbar]:hidden">
		<!-- Your story / add -->
		<button
			type="button"
			onclick={() => toasts.info('Story composer')}
			class="flex shrink-0 cursor-pointer flex-col items-center gap-1.5"
		>
			<div class="relative">
				<div
					class="grid size-16 place-items-center rounded-full bg-warm-500 font-bold text-white ring-[3px] ring-[var(--surface-bg)]"
				>
					{me ? (myName?.slice(0, 2)?.toUpperCase() ?? 'YO') : 'YO'}
				</div>
				<div
					class="absolute -right-0.5 -bottom-0.5 grid size-6 place-items-center rounded-full bg-ink ring-2 ring-[var(--surface-bg)]"
				>
					<Icon name="i-lucide-plus" class="size-3.5 text-white" />
				</div>
			</div>
			<span class="text-[11px] font-medium text-[var(--ui-text-muted)]">Your story</span>
		</button>

		<!-- People stories -->
		{#each stories as s (s.id)}
			<button
				type="button"
				onclick={() => toasts.info(`Viewing ${s.person.name}'s story`)}
				class="flex shrink-0 cursor-pointer flex-col items-center gap-1.5"
			>
				<div class={s.viewed ? 'story-ring-viewed' : 'story-ring'}>
					<div
						class="grid size-[58px] place-items-center rounded-full text-sm font-bold text-white ring-[3px] ring-[var(--surface-bg)] {colorBg[
							s.person.color
						]}"
					>
						{s.person.initials}
					</div>
				</div>
				<span
					class="text-[11px] font-medium {s.viewed
						? 'text-[var(--ui-text-dimmed)]'
						: 'text-[var(--ui-text-muted)]'}">{s.person.name}</span
				>
			</button>
		{/each}
	</div>
</div>
