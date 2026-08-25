<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import MenuDivider from '$lib/components/ui/MenuDivider.svelte';
	import MenuItem from '$lib/components/ui/MenuItem.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import type { SharedSound } from '$lib/meme/shared-sounds';

	let {
		sounds,
		loading,
		importingId,
		currentPubkey,
		onRefresh,
		onImport
	}: {
		sounds: SharedSound[];
		loading: boolean;
		importingId: string | null;
		currentPubkey?: string;
		onRefresh: () => void;
		onImport: (sound: SharedSound) => void;
	} = $props();

	const menuId = `meme-shared-${Math.random().toString(36).slice(2, 8)}`;
</script>

<Popover
	id={menuId}
	float
	placement="top-start"
	width="auto"
	label="Shared sounds"
	triggerClass="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold text-primary-600 transition hover:bg-primary-500/10"
	triggerActiveClass="bg-primary-500/15"
>
	{#snippet trigger()}
		<Icon name="i-lucide-globe-2" class="size-3.5" />
		Shared
	{/snippet}
	<button
		type="button"
		class="flex w-full items-center justify-center gap-1 rounded-lg px-3 py-1.5 text-[11.5px] font-semibold text-primary-600 transition hover:bg-primary-500/10"
		disabled={loading}
		onclick={onRefresh}
	>
		<Icon name="i-lucide-refresh-cw" class="size-3.5 {loading ? 'animate-spin' : ''}" />
		{loading ? 'Searching relays…' : 'Refresh'}
	</button>
	{#if sounds.length}
		<MenuDivider />
		{#each sounds as sound (sound.eventId)}
			<MenuItem onclick={() => onImport(sound)}>
				<span class="flex min-w-0 items-center gap-2">
					<Icon name="i-lucide-download" class="size-3.5 shrink-0 text-[var(--ui-text-dimmed)]" />
					<span class="min-w-0">
						<span class="block truncate">{sound.label}</span>
						<span class="block text-[10.5px] text-[var(--ui-text-dimmed)]">
							{sound.durationSec.toFixed(1)}s · {sound.license}
							{#if sound.creatorPubkey === currentPubkey}· yours{/if}
						</span>
					</span>
				</span>
				{#snippet trailing()}
					{#if importingId === sound.eventId}
						<Icon name="i-lucide-loader-circle" class="size-3.5 animate-spin text-primary-600" />
					{:else if sound.sha256}
						<span
							class="text-[10px] font-bold tracking-wide text-[var(--ui-text-dimmed)] uppercase"
						>
							+ add
						</span>
					{:else}
						<Icon
							name="i-lucide-shield-off"
							class="size-3.5 text-[var(--ui-text-dimmed)]"
							title="No content hash — cannot verify"
						/>
					{/if}
				{/snippet}
			</MenuItem>
		{/each}
	{/if}
</Popover>
