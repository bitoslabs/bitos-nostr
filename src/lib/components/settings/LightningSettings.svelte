<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import SectionCard from '$lib/components/settings/SectionCard.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Toggle from '$lib/components/ui/Toggle.svelte';
	import { wallet } from '$lib/nostr/wallet.svelte';
	import { walletPrefs } from '$lib/stores/wallet-prefs.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { hasWebLN } from '$lib/nostr/webln';
	import { isNwcConnected } from '$lib/nostr/nwc';
	import { formatCompact } from '$lib/utils/format';

	const walletAvailable = $derived(hasWebLN());
	let customNwcUri = $state('');

	onMount(() => {
		walletPrefs.load();
		wallet.detectWebLN();
	});

	async function connect() {
		const ok = await wallet.connectWallet();
		if (ok) toasts.success(`Connected to ${wallet.weblnInfo?.node.alias ?? 'wallet'}`);
		else if (wallet.error) toasts.error(wallet.error);
	}

	async function connectCustomNwc() {
		if (!customNwcUri.trim()) {
			toasts.error('Paste your Nostr Wallet Connect URI first.');
			return;
		}
		const ok = await wallet.connectCustomNwc(customNwcUri);
		if (ok) {
			customNwcUri = '';
			toasts.success(`Connected to ${wallet.weblnInfo?.node.alias ?? 'custom NWC wallet'}`);
		} else if (wallet.error) toasts.error(wallet.error);
	}

	async function selectProvider(provider: 'webln' | 'nwc') {
		const ok = await wallet.selectProvider(provider);
		if (ok)
			toasts.success(`Using ${provider === 'nwc' ? 'custom NWC' : 'WebLN'} for payments and zaps.`);
		else if (wallet.error) toasts.error(wallet.error);
	}

	function setAmount(index: number, raw: string) {
		const value = Number(raw);
		if (Number.isFinite(value)) walletPrefs.setAmount(index, value);
	}
</script>

<h2 class="mb-1 font-display text-[24px] font-extrabold">Lightning</h2>
<p class="mb-6 text-[13px] text-[var(--ui-text-muted)]">
	Connect a wallet, tune your zap amounts, and control how you send sats.
</p>

<!-- ============ WALLET CONNECTION ============ -->
<SectionCard title="Wallet connection" class="mb-5">
	{#if wallet.weblnEnabled}
		{#if walletAvailable && isNwcConnected()}
			<div
				class="mb-3 flex items-center justify-between gap-3 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] p-3"
			>
				<div>
					<div class="text-[13px] font-bold">Pay with</div>
					<div class="text-[11px] text-[var(--ui-text-muted)]">
						This wallet is used for zaps, deposits, and withdrawals.
					</div>
				</div>
				<div
					class="flex rounded-lg border border-[var(--ui-border-muted)] p-0.5 text-[11px] font-bold"
				>
					<button
						type="button"
						onclick={() => selectProvider('webln')}
						class="rounded-md px-2.5 py-1 {wallet.provider === 'webln'
							? 'bg-primary-500 text-white'
							: 'text-[var(--ui-text-muted)]'}">WebLN</button
					>
					<button
						type="button"
						onclick={() => selectProvider('nwc')}
						class="rounded-md px-2.5 py-1 {wallet.provider === 'nwc'
							? 'bg-primary-500 text-white'
							: 'text-[var(--ui-text-muted)]'}">Custom NWC</button
					>
				</div>
			</div>
		{/if}
		<div
			class="flex items-center gap-3.5 rounded-xl border border-[color-mix(in_oklab,var(--ui-color-primary-500)_22%,transparent)] bg-[color-mix(in_oklab,var(--ui-color-primary-500)_6%,transparent)] p-3.5"
		>
			<span
				class="hex-clip grid size-10 shrink-0 place-items-center bg-[linear-gradient(135deg,var(--ui-color-primary-500),var(--color-warm-500))] text-black"
			>
				<Icon name="i-lucide-wallet" class="size-5" />
			</span>
			<div class="min-w-0 flex-1">
				<div class="truncate text-[14px] font-bold">
					{wallet.weblnInfo?.node.alias ?? 'Lightning wallet'}
				</div>
				<div class="truncate font-mono text-[12px] text-[var(--ui-text-muted)]">
					connected · {formatCompact(wallet.weblnBalance ?? 0)} sats
				</div>
			</div>
			<Button color="neutral" variant="subtle" size="sm" onclick={() => wallet.disconnectWallet()}
				>Disconnect</Button
			>
		</div>
		<button
			type="button"
			onclick={() => wallet.refreshBalance()}
			class="mt-3 inline-flex items-center gap-1.5 text-[12px] font-bold text-primary-500 transition hover:opacity-80"
		>
			<Icon name="i-lucide-refresh-ccw" class="size-3.5" /> Refresh balance
		</button>
	{:else}
		{#if walletAvailable}
			<p class="mb-4 text-[13px] leading-relaxed text-[var(--ui-text-muted)]">
				A Lightning wallet was detected. Connect it to deposit, withdraw, and pay zaps in one tap
				without leaving BitOS.
			</p>
			<Button color="primary" icon="i-lucide-plug" onclick={connect} disabled={wallet.weblnBusy}>
				{wallet.weblnBusy ? 'Connecting…' : 'Connect wallet'}
			</Button>
		{:else}
			<div
				class="flex items-start gap-3 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] p-3.5"
			>
				<Icon name="i-lucide-info" class="mt-0.5 size-4 shrink-0 text-[var(--ui-text-dimmed)]" />
				<div class="text-[13px] leading-relaxed text-[var(--ui-text-muted)]">
					No Lightning wallet detected. Install
					<a
						class="font-semibold text-primary-500 hover:underline"
						href="https://getalby.com"
						target="_blank"
						rel="noreferrer">Alby</a
					>
					or another
					<a
						class="font-semibold text-primary-500 hover:underline"
						href="https://www.webln.guide/ressources/wallet-providers"
						target="_blank"
						rel="noreferrer">WebLN wallet</a
					>
					to connect. Earnings you receive are still tracked on Nostr and visible on the Zaps page.
				</div>
			</div>
		{/if}
		<div class="mt-4 border-t border-[var(--ui-border-muted)] pt-4">
			<div class="mb-1 text-[13px] font-bold">Custom Nostr Wallet Connect</div>
			<p class="mb-3 text-[12px] leading-relaxed text-[var(--ui-text-muted)]">
				Paste a <code>nostr+walletconnect://</code> URI from your wallet. It is saved locally on this
				device so your wallet reconnects after refresh.
			</p>
			<div class="flex flex-col gap-2 sm:flex-row">
				<Input
					bind:value={customNwcUri}
					placeholder="nostr+walletconnect://…"
					class="min-w-0 flex-1 font-mono text-[12px]"
				/>
				<Button
					color="primary"
					icon="i-lucide-link"
					onclick={connectCustomNwc}
					disabled={wallet.weblnBusy}
				>
					{wallet.weblnBusy ? 'Connecting…' : 'Connect NWC'}
				</Button>
			</div>
		</div>
	{/if}
</SectionCard>

<!-- ============ DEFAULT ZAP AMOUNTS ============ -->
<SectionCard title="Default zap amounts" class="mb-5">
	{#snippet actions()}
		<button
			type="button"
			onclick={() => walletPrefs.resetAmounts()}
			class="text-[11px] font-bold text-[var(--ui-text-muted)] transition hover:text-primary-500"
			>Reset</button
		>
	{/snippet}
	<p class="mb-4 text-[12px] text-[var(--ui-text-muted)]">
		The quick-pick buttons shown on the zap dialog.
	</p>
	<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
		{#each walletPrefs.state.amounts as amount, i (i)}
			<div class="relative">
				<Input
					value={amount}
					icon="i-lucide-zap"
					type="number"
					inputmode="numeric"
					min="1"
					class="w-full text-center font-mono"
					oninput={(e) => setAmount(i, e.currentTarget.value)}
				/>
				{#if walletPrefs.state.amounts.length > 2}
					<button
						type="button"
						onclick={() => walletPrefs.removeAmount(i)}
						class="absolute -top-1.5 -right-1.5 grid size-4 place-items-center rounded-full bg-[var(--tone-warning-text)] text-[8px] text-white"
						aria-label="Remove amount"
					>
						<Icon name="i-lucide-x" class="size-2.5" />
					</button>
				{/if}
			</div>
		{/each}
		{#if walletPrefs.state.amounts.length < 6}
			<button
				type="button"
				onclick={() => walletPrefs.addAmount()}
				class="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--ui-border-muted)] text-[12px] font-semibold text-[var(--ui-text-muted)] transition hover:border-primary-500 hover:text-primary-500"
			>
				<Icon name="i-lucide-plus" class="size-4" /> Add
			</button>
		{/if}
	</div>

	<div class="mt-5 border-t border-[var(--ui-border-muted)] pt-4">
		<p
			class="mb-1.5 block text-[12px] font-bold tracking-wide text-[var(--ui-text-muted)] uppercase"
		>
			Default amount
		</p>
		<div class="flex flex-wrap gap-2">
			{#each walletPrefs.state.amounts as amount, i (i)}
				<button
					type="button"
					onclick={() => walletPrefs.setDefaultAmount(amount)}
					class="rounded-full border px-3.5 py-1.5 text-[12px] font-bold transition {walletPrefs
						.state.defaultAmount === amount
						? 'border-primary-500 bg-primary-500/10 text-primary-500'
						: 'border-[var(--ui-border-muted)] text-[var(--ui-text-muted)] hover:bg-[var(--interactive-hover-bg)]'}"
				>
					{amount} sats
				</button>
			{/each}
		</div>
		<p class="mt-2 text-[11px] text-[var(--ui-text-dimmed)]">
			This amount is pre-selected when you open the zap dialog.
		</p>
	</div>
</SectionCard>

<!-- ============ ZAP PREFERENCES ============ -->
<SectionCard
	title="Zap preferences"
	description="Control how BitOS handles zaps and other reactions."
>
	<div class="space-y-3">
		<div class="flex items-center justify-between gap-3">
			<div class="min-w-0">
				<p class="text-[13.5px] font-semibold">Non-zap reactions</p>
				<p class="text-[11px] text-[var(--ui-text-muted)]">Allow likes & reposts alongside zaps</p>
			</div>
			<Toggle
				checked={walletPrefs.state.nonZapReactions}
				onToggle={(v) => walletPrefs.toggle('nonZapReactions', v)}
				label="Non-zap reactions"
			/>
		</div>
		<div
			class="flex items-center justify-between gap-3 border-t border-[var(--ui-border-muted)] pt-3"
		>
			<div class="min-w-0">
				<p class="text-[13.5px] font-semibold">Anonymous zaps</p>
				<p class="text-[11px] text-[var(--ui-text-muted)]">Send zaps without revealing your npub</p>
			</div>
			<Toggle
				checked={walletPrefs.state.anonymousZaps}
				onToggle={(v) => walletPrefs.toggle('anonymousZaps', v)}
				label="Anonymous zaps"
			/>
		</div>
		<div
			class="flex items-center justify-between gap-3 border-t border-[var(--ui-border-muted)] pt-3"
		>
			<div class="min-w-0">
				<p class="text-[13.5px] font-semibold">Auto-zap on follow</p>
				<p class="text-[11px] text-[var(--ui-text-muted)]">
					Send a small zap when you follow someone
				</p>
			</div>
			<Toggle
				checked={walletPrefs.state.autoZapOnFollow}
				onToggle={(v) => walletPrefs.toggle('autoZapOnFollow', v)}
				label="Auto-zap on follow"
			/>
		</div>
		{#if walletPrefs.state.autoZapOnFollow}
			<div
				class="flex items-center justify-between gap-3 border-t border-[var(--ui-border-muted)] pt-3"
			>
				<label for="autozap-amount" class="min-w-0">
					<p class="text-[13.5px] font-semibold">Auto-zap amount</p>
					<p class="text-[11px] text-[var(--ui-text-muted)]">Sats sent per new follow</p>
				</label>
				<Input
					id="autozap-amount"
					value={walletPrefs.state.autoZapAmount}
					icon="i-lucide-zap"
					type="number"
					inputmode="numeric"
					min="1"
					size="sm"
					class="w-24 text-center font-mono"
					oninput={(e) => {
						const v = Number(e.currentTarget.value);
						if (Number.isFinite(v)) walletPrefs.setAutoZapAmount(v);
					}}
				/>
			</div>
		{/if}
	</div>
</SectionCard>
