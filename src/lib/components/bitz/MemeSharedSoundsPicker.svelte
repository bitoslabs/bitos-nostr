<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import MenuDivider from '$lib/components/ui/MenuDivider.svelte';
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
	let view = $state<'all' | 'mine'>('all');
	const visibleSounds = $derived(
		view === 'mine' && currentPubkey
			? sounds.filter((sound) => sound.creatorPubkey === currentPubkey)
			: sounds
	);

	function setView(next: 'all' | 'mine'): void {
		view = next;
	}

	/** Floated popovers are portaled to body. Native listeners keep working
	 * after that move; delegated Svelte handlers do not. Mirrors Slots. */
	function nativeClick(node: HTMLElement, handler: () => void) {
		node.addEventListener('click', handler);
		return {
			update(next: () => void) {
				node.removeEventListener('click', handler);
				handler = next;
				node.addEventListener('click', handler);
			},
			destroy() {
				node.removeEventListener('click', handler);
			}
		};
	}

	function refresh(): void {
		onRefresh();
	}
</script>

<Popover
	id={menuId}
	float
	keepOpenOnContentClick
	placement="top-start"
	width="auto"
	label="Sound library"
	triggerClass="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold text-primary-600 transition hover:bg-primary-500/10"
	triggerActiveClass="bg-primary-500/15"
>
	{#snippet trigger()}
		<Icon name="i-lucide-globe-2" class="size-3.5" />
		Sound library
	{/snippet}
	<div class="flex gap-1 px-2 pt-2">
		<button
			type="button"
			use:nativeClick={() => setView('all')}
			aria-pressed={view === 'all'}
			class="flex-1 rounded-lg px-2 py-1 text-[10.5px] font-bold transition {view === 'all'
				? 'bg-primary-500/10 text-primary-600'
				: 'text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-muted)]'}">Discover</button
		>
		<button
			type="button"
			use:nativeClick={() => setView('mine')}
			aria-pressed={view === 'mine'}
			class="flex-1 rounded-lg px-2 py-1 text-[10.5px] font-bold transition {view === 'mine'
				? 'bg-primary-500/10 text-primary-600'
				: 'text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-muted)]'}">My shared</button
		>
	</div>
	<button
		type="button"
		class="flex w-full items-center justify-center gap-1 rounded-lg px-3 py-1.5 text-[11.5px] font-semibold text-primary-600 transition hover:bg-primary-500/10"
		disabled={loading}
		use:nativeClick={refresh}
	>
		<Icon name="i-lucide-refresh-cw" class="size-3.5 {loading ? 'animate-spin' : ''}" />
		{loading ? 'Searching relays…' : 'Refresh'}
	</button>
	{#if visibleSounds.length}
		<MenuDivider />
		{#each visibleSounds as sound (sound.eventId)}
			<button
				type="button"
				use:nativeClick={() => onImport(sound)}
				class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)] disabled:pointer-events-none disabled:opacity-50"
			>
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
				<span class="ml-auto shrink-0">
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
				</span>
			</button>
		{/each}
	{:else if view === 'mine'}
		<p class="px-3 py-3 text-center text-[11.5px] font-medium text-[var(--ui-text-muted)]">
			You have not shared a sound yet.
		</p>
	{/if}
</Popover>
