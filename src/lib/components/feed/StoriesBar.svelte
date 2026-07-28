<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';

	const me = $derived(identity.current);
	const myProfile = $derived(me ? profiles.get(me.pk) : undefined);
	const myName = $derived(myProfile?.display_name || myProfile?.name || 'You');
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
				{#if me}
					<Avatar
						pubkey={me.pk}
						name={myName}
						picture={myProfile?.picture}
						size={64}
						class="ring-[3px] ring-[var(--surface-bg)]"
					/>
				{:else}
					<div
						class="grid size-16 place-items-center rounded-full bg-warm-500 font-bold text-white ring-[3px] ring-[var(--surface-bg)]"
					>
						YO
					</div>
				{/if}
				<div
					class="absolute -right-0.5 -bottom-0.5 grid size-6 place-items-center rounded-full bg-ink ring-2 ring-[var(--surface-bg)]"
				>
					<Icon name="i-lucide-plus" class="size-3.5 text-white" />
				</div>
			</div>
			<span class="text-[11px] font-medium text-[var(--ui-text-muted)]">Your story</span>
		</button>
	</div>
</div>
