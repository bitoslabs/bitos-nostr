<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import MenuDivider from '$lib/components/ui/MenuDivider.svelte';
	import MenuItem from '$lib/components/ui/MenuItem.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import PowCard from '$lib/components/ui/PowCard.svelte';
	import type { PowProgress } from '$lib/nostr/feed.svelte';
	import type { MediaProviderId } from '$lib/media/uploaders';
	import { media, MEDIA_PROVIDERS, providerLabel } from '$lib/stores/media.svelte';
	import { SPLIT_ROLES, TOTAL_BASIS_POINTS, validateSplits, type SplitRow } from '$lib/meme/splits';
	import type { RemixLicense } from '$lib/meme/remix';
	import {
		DESTINATIONS,
		LICENSE_OPTIONS,
		type MemeDestination,
		type MemeStudioPhase
	} from './meme-studio-config';

	let {
		destination = $bindable(),
		sensitive = $bindable(),
		showPow = $bindable(),
		license = $bindable(),
		aiAssisted = $bindable(),
		splitsOpen = $bindable(),
		splitRows = $bindable(),
		selectedProvider = $bindable(),
		pow = $bindable(),
		busy,
		phase,
		powProgress,
		writeRelayCount,
		kindNip,
		onCancelMining
	}: {
		destination: MemeDestination;
		sensitive: boolean;
		showPow: boolean;
		license: RemixLicense;
		aiAssisted: boolean;
		splitsOpen: boolean;
		splitRows: SplitRow[];
		selectedProvider: MediaProviderId | 'none';
		pow: number;
		busy: boolean;
		phase: MemeStudioPhase;
		powProgress: PowProgress | null;
		writeRelayCount: number;
		kindNip?: string;
		onCancelMining: () => void;
	} = $props();

	const destinationMenuId = `meme-dest-${Math.random().toString(36).slice(2, 8)}`;
	const providerMenuId = `meme-provider-${Math.random().toString(36).slice(2, 8)}`;
	const splitCheck = $derived(
		splitRows.length ? validateSplits(splitRows) : ({ ok: true } as const)
	);
	const splitTotal = $derived(splitRows.reduce((sum, row) => sum + row.basisPoints, 0));

	function addSplitRow(): void {
		splitRows = [...splitRows, { role: 'video_creator', basisPoints: 0 }];
	}

	function removeSplitRow(row: SplitRow): void {
		splitRows = splitRows.filter(
			(candidate) =>
				!(candidate.role === row.role && (candidate.beneficiary ?? '') === (row.beneficiary ?? ''))
		);
	}
</script>

<div class="flex flex-wrap items-center gap-1.5">
	<Popover
		id={destinationMenuId}
		float
		placement="top-start"
		width="auto"
		label="Post destination"
		triggerClass="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold transition {destination ===
		'bitz'
			? 'text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]'
			: 'bg-primary-500/10 text-primary-600'}"
		triggerActiveClass="bg-primary-500/10 text-primary-600"
	>
		{#snippet trigger()}
			<Icon
				name={destination === 'story'
					? 'i-lucide-circle-dot-dashed'
					: destination === 'note'
						? 'i-lucide-message-square-text'
						: 'i-lucide-clapperboard'}
				class="size-4"
			/>
			{destination === 'story'
				? 'To story · 24h'
				: destination === 'note'
					? 'To note'
					: 'To Bitz feed'}
		{/snippet}
		{#each DESTINATIONS as option (option.id)}
			<MenuItem
				icon={option.icon}
				tone={destination === option.id ? 'accent' : 'default'}
				onclick={() => (destination = option.id)}
			>
				<div class="min-w-0">
					<div>{option.label}</div>
					<div class="text-[11px] font-medium text-[var(--ui-text-dimmed)]">
						{option.hint}
					</div>
				</div>
				{#snippet trailing()}
					{#if destination === option.id}
						<Icon name="i-lucide-check" class="size-4 shrink-0" />
					{/if}
				{/snippet}
			</MenuItem>
		{/each}
	</Popover>
	<button
		type="button"
		onclick={() => (sensitive = !sensitive)}
		aria-pressed={sensitive}
		title="Mark as sensitive content"
		class="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold transition disabled:opacity-40 {sensitive
			? 'bg-warm-500/15 text-warm-500'
			: 'text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]'}"
	>
		<Icon name="i-lucide-eye-off" class="size-4" />
		Sensitive
	</button>
	<button
		type="button"
		onclick={() => (showPow = !showPow)}
		disabled={busy}
		aria-pressed={showPow}
		title="Mine a rare meme — NIP-13 proof of work"
		class="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold transition disabled:pointer-events-none disabled:opacity-40 {showPow
			? 'bg-primary-500/10 text-primary-600'
			: 'text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]'}"
	>
		<Icon name="i-lucide-gem" class="size-4" />
		Rare meme
	</button>
	<label
		class="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]"
		title="Remix rights — advisory license for this bitz"
	>
		<Icon name="i-lucide-scale" class="size-4" />
		<select
			bind:value={license}
			disabled={busy}
			class="cursor-pointer appearance-none bg-transparent text-[12px] font-bold outline-none"
			aria-label="Remix rights license"
		>
			{#each LICENSE_OPTIONS as option (option.code)}
				<option value={option.code}>{option.label}</option>
			{/each}
		</select>
	</label>
	<button
		type="button"
		onclick={() => (aiAssisted = !aiAssisted)}
		disabled={busy}
		aria-pressed={aiAssisted}
		title="AI-assisted — adds an `ai` provenance tag so clients can badge it"
		class="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold transition disabled:pointer-events-none disabled:opacity-40 {aiAssisted
			? 'bg-primary-500/10 text-primary-600'
			: 'text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]'}"
	>
		<Icon name="i-lucide-sparkles" class="size-4" />
		{aiAssisted ? 'AI-assisted ✓' : 'AI-assisted'}
	</button>
	<button
		type="button"
		onclick={() => (splitsOpen = !splitsOpen)}
		disabled={busy}
		aria-pressed={splitsOpen}
		title="Value splits - who gets paid when this bitz earns"
		class="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold transition disabled:pointer-events-none disabled:opacity-40 {splitsOpen
			? 'bg-primary-500/10 text-primary-600'
			: 'text-[var(--ui-text-muted)] hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]'}"
	>
		<Icon name="i-lucide-git-fork" class="size-4" />
		Splits {splitRows.length ? `(${splitRows.length})` : ''}
	</button>
	{#if splitsOpen}
		<div class="flex w-full flex-col gap-2 rounded-xl bg-[var(--ui-bg-muted)]/60 p-3 text-left">
			{#each splitRows as row, index (index)}
				<div class="flex items-center gap-2">
					<select
						bind:value={row.role}
						disabled={busy}
						aria-label="Split role"
						class="min-w-0 flex-1 cursor-pointer appearance-none rounded-lg bg-[var(--ui-bg)] px-2 py-1 text-[12px] font-semibold outline-none"
					>
						{#each SPLIT_ROLES as role (role)}
							<option value={role}>{role.replace(/_/g, ' ')}</option>
						{/each}
					</select>
					<input
						type="number"
						bind:value={row.basisPoints}
						min="0"
						max="10000"
						step="50"
						disabled={busy}
						aria-label="Share in basis points"
						class="w-24 rounded-lg bg-[var(--ui-bg)] px-2 py-1 text-right text-[12px] font-semibold outline-none"
					/>
					<span class="text-[11px] font-bold text-[var(--ui-text-muted)]">bps</span>
					<button
						type="button"
						onclick={() => removeSplitRow(row)}
						disabled={busy}
						aria-label="Remove split row"
						class="rounded-lg p-1 text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg)] hover:text-[var(--ui-text)]"
					>
						<Icon name="i-lucide-x" class="size-4" />
					</button>
				</div>
			{/each}
			<button
				type="button"
				onclick={addSplitRow}
				disabled={busy}
				class="self-start rounded-full px-3 py-1 text-[12px] font-bold text-primary-600 transition hover:bg-primary-500/10"
			>
				+ Add row
			</button>
			<p
				class="text-[11px] font-bold {splitRows.length === 0 || splitCheck.ok
					? 'text-[var(--ui-text-muted)]'
					: 'text-primary-600'}"
			>
				{splitTotal.toLocaleString()} / {TOTAL_BASIS_POINTS.toLocaleString()} bps
				{#if splitRows.length > 0 && !splitCheck.ok}
					- {splitCheck.error}
				{/if}
			</p>
		</div>
	{/if}
	<Popover
		id={providerMenuId}
		float
		placement="top-start"
		width="lg"
		label="Upload provider"
		triggerClass="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-muted)] hover:text-[var(--ui-text)]"
		triggerActiveClass="bg-primary-500/10 text-primary-600"
	>
		{#snippet trigger()}
			<Icon name="i-lucide-cloud-upload" class="size-4 text-primary-500" />
			<span class="max-w-[110px] truncate">
				{providerLabel(selectedProvider === 'none' ? 'server' : selectedProvider)}
			</span>
		{/snippet}
		<MenuItem
			icon="i-lucide-hard-drive-upload"
			onclick={() => (selectedProvider = 'none')}
			tone={selectedProvider === 'none' ? 'accent' : 'default'}
		>
			BitOS uploads
			{#snippet trailing()}
				{#if selectedProvider === 'none'}
					<Icon name="i-lucide-check" class="size-4 shrink-0" />
				{/if}
			{/snippet}
		</MenuItem>
		<MenuDivider />
		{#each MEDIA_PROVIDERS as provider (provider.id)}
			<MenuItem
				icon={provider.icon}
				disabled={!media.isConfigured(provider.id)}
				tone={selectedProvider === provider.id ? 'accent' : 'default'}
				onclick={() => (selectedProvider = provider.id)}
			>
				<div class="min-w-0">
					<div>{provider.label}</div>
					<div class="text-[11px] font-medium text-[var(--ui-text-dimmed)]">
						{media.isConfigured(provider.id)
							? provider.description
							: 'Configure this provider in Settings first'}
					</div>
				</div>
				{#snippet trailing()}
					{#if selectedProvider === provider.id}
						<Icon name="i-lucide-check" class="size-4 shrink-0" />
					{/if}
				{/snippet}
			</MenuItem>
		{/each}
	</Popover>
</div>

{#if showPow && destination !== 'story'}
	<PowCard bind:pow mining={phase === 'mining'} progress={powProgress} oncancel={onCancelMining} />
{/if}

<p class="flex items-center gap-1.5 text-[11px] text-[var(--ui-text-dimmed)]">
	<Icon name="i-lucide-globe" class="size-3.5 shrink-0 text-primary-500" />
	{#if destination === 'story'}
		Publishes a 24h story (kind 30315) — video memes loop in the story viewer.
	{:else if destination === 'note'}
		Publishes a kind-1 note with the meme attached as standard media — renders in every Nostr
		client.
	{:else}
		Publishes to {writeRelayCount}
		{writeRelayCount === 1 ? 'relay' : 'relays'} — a standard
		{kindNip ?? 'Nostr'} event with captions burned in.
	{/if}
</p>
