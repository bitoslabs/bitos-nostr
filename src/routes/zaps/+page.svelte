<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import StatTile from '$lib/components/ui/StatTile.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import ZapLedgerRow from '$lib/components/zaps/ZapLedgerRow.svelte';
	import { wallet } from '$lib/nostr/wallet.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { walletPrefs } from '$lib/stores/wallet-prefs.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { hasWebLN, makeWebLNInvoice, payWithWebLN } from '$lib/nostr/webln';
	import { formatCompact } from '$lib/utils/format';
	import type { ZapEntry } from '$lib/nostr/wallet.svelte';

	type Tab = 'all' | 'received' | 'sent';
	let activeTab = $state<Tab>('all');

	// --- WebLN deposit/withdraw modal state ---
	let invoiceModalOpen = $state(false);
	let invoiceModalMode = $state<'deposit' | 'withdraw'>('deposit');
	let invoiceAmount = $state<string>('');
	let invoiceMemo = $state('');
	let invoiceBolt11 = $state('');
	let invoiceBusy = $state(false);
	let invoiceError = $state('');

	const me = $derived(identity.current?.pk ?? '');
	const tabOptions = $derived([
		{ key: 'all', label: 'All Activity', count: wallet.ledger.length },
		{ key: 'received', label: 'Received', count: wallet.countReceived },
		{ key: 'sent', label: 'Sent', count: wallet.countSent }
	]);
	const filtered = $derived(
		activeTab === 'all'
			? wallet.ledger
			: wallet.ledger.filter((entry) => entry.direction === activeTab)
	);
	const avgZap = $derived(wallet.avgReceived);
	const walletAvailable = $derived(hasWebLN());

	onMount(() => {
		walletPrefs.load();
		if (me) wallet.start();
		else wallet.detectWebLN();
	});
	onDestroy(() => wallet.stop());

	function openInvoice(mode: 'deposit' | 'withdraw') {
		invoiceModalMode = mode;
		invoiceAmount = '';
		invoiceMemo = '';
		invoiceBolt11 = '';
		invoiceError = '';
		invoiceModalOpen = true;
	}

	async function generateDeposit() {
		const sats = Number(invoiceAmount);
		if (!Number.isFinite(sats) || sats < 1) {
			invoiceError = 'Enter a valid amount in sats.';
			return;
		}
		invoiceBusy = true;
		invoiceError = '';
		try {
			const bolt11 = await makeWebLNInvoice(sats, invoiceMemo.trim());
			if (!bolt11) throw new Error('Your wallet could not generate an invoice.');
			invoiceBolt11 = bolt11;
			toasts.success('Deposit invoice generated');
		} catch (e) {
			invoiceError = (e as Error).message || 'Could not generate invoice.';
		} finally {
			invoiceBusy = false;
		}
	}

	async function submitWithdraw() {
		const bolt11 = invoiceMemo.trim();
		if (!/^ln[a-z0-9]+$/i.test(bolt11)) {
			invoiceError = 'Paste a valid Lightning invoice (lnbc…).';
			return;
		}
		invoiceBusy = true;
		invoiceError = '';
		try {
			await payWithWebLN(bolt11);
			toasts.success('Withdrawal paid');
			invoiceModalOpen = false;
			await wallet.refreshBalance();
		} catch (e) {
			invoiceError = (e as Error).message || 'Payment failed.';
		} finally {
			invoiceBusy = false;
		}
	}

	async function connectWallet() {
		const ok = await wallet.connectWallet();
		if (ok) toasts.success(`Connected to ${wallet.weblnInfo?.node.alias ?? 'wallet'}`);
		else if (wallet.error) toasts.error(wallet.error);
	}

	async function copyEntry(entry: ZapEntry) {
		const text = entry.bolt11 ?? entry.id;
		try {
			await navigator.clipboard.writeText(text);
			toasts.success('Invoice copied');
		} catch {
			toasts.error('Could not copy');
		}
	}
</script>

<svelte:head><title>Zaps · BitOS</title></svelte:head>

<div class="flex h-full flex-col">
	<div class="min-w-0 flex-1 overflow-y-auto">
		<PageHeader title="Zaps">
			{#snippet subtitle()}
				<span class="inline-flex items-center gap-1">
					{#if wallet.connected}
						<span class="live-dot"></span>
						Live
					{:else if wallet.loading}
						<Icon name="i-lucide-loader-circle" class="size-3 animate-spin" />
						Loading
					{:else}
						<span class="size-1.5 rounded-full bg-[var(--tone-error-text)]"></span>
						Offline
					{/if}
					· {wallet.countReceived} received · {wallet.countSent} sent
				</span>
			{/snippet}
			{#snippet actions()}
				<button
					type="button"
					onclick={() => toasts.info('Exported zap activity to clipboard')}
					class="icon-btn size-9"
					aria-label="Export activity"
				>
					<Icon name="i-lucide-download" class="size-4" />
				</button>
			{/snippet}
			{#snippet tabs()}
				<div
					class="flex gap-1 overflow-x-auto px-[clamp(1rem,3vw,1.5rem)]"
					role="tablist"
					aria-label="Zap activity"
				>
					{#each tabOptions as tab (tab.key)}
						<button
							type="button"
							role="tab"
							aria-selected={activeTab === tab.key}
							onclick={() => (activeTab = tab.key as Tab)}
							class="relative shrink-0 px-3 py-2.5 text-[12px] font-bold transition {activeTab === tab.key
								? 'text-primary-600'
								: 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'}"
						>
							{tab.label}<span class="ml-1.5 font-mono text-[10px] opacity-70">{tab.count}</span>
							{#if activeTab === tab.key}<span
									class="absolute right-2 bottom-0 left-2 h-0.5 rounded-full bg-primary-500"
								></span>{/if}
						</button>
					{/each}
				</div>
			{/snippet}
		</PageHeader>

		<div class="page-container py-6">
			<!-- ============ WALLET HERO ============ -->
			<div
				class="surface-card surface-card-hover mb-4 overflow-hidden p-5"
				style="background:linear-gradient(135deg, color-mix(in oklab, var(--ui-color-primary-500) 10%, var(--surface-bg)), color-mix(in oklab, var(--color-warm-500) 5%, var(--surface-bg)));"
			>
				<div class="mb-5 flex items-start justify-between gap-3">
					<div class="min-w-0">
						<div class="text-[11px] font-semibold tracking-wider text-[var(--ui-text-muted)] uppercase">
							{wallet.balanceSource === 'wallet' ? 'Wallet Balance' : 'Total Received'}
						</div>
						<div class="mt-1 font-mono text-4xl font-bold tracking-tight">
							{formatCompact(wallet.balance)}
							<span class="text-lg text-[var(--ui-color-primary-500)]">sats</span>
						</div>
						<div class="mt-1 text-xs text-[var(--ui-text-muted)]">
							{#if wallet.balanceSource === 'wallet' && wallet.weblnInfo?.node?.alias}
								Connected · {wallet.weblnInfo.node.alias}
							{:else}
								Net {formatCompact(wallet.net)} sats · received minus sent
							{/if}
						</div>
					</div>
					<span
						class="hex-clip grid size-11 shrink-0 place-items-center bg-[linear-gradient(135deg,var(--ui-color-primary-500),var(--color-warm-500))] text-black"
					>
						<Icon name="i-lucide-zap" class="size-5" />
					</span>
				</div>

				<!-- Wallet connect / deposit / withdraw -->
				{#if wallet.balanceSource === 'wallet'}
					<div class="flex gap-2">
						<Button
							color="primary"
							block
							onclick={() => openInvoice('deposit')}
							icon="i-lucide-arrow-down-to-line"
						>
							Deposit
						</Button>
						<Button
							color="neutral"
							variant="subtle"
							block
							onclick={() => openInvoice('withdraw')}
							icon="i-lucide-arrow-up-from-line"
						>
							Withdraw
						</Button>
						<button
							type="button"
							onclick={() => wallet.disconnectWallet()}
							class="icon-btn size-10"
							aria-label="Disconnect wallet"
							title="Disconnect wallet"
						>
							<Icon name="i-lucide-unplug" class="size-4" />
						</button>
					</div>
				{:else if walletAvailable}
					<Button
						color="primary"
						block
						onclick={connectWallet}
						disabled={wallet.weblnBusy}
						icon={wallet.weblnBusy ? 'i-lucide-loader-circle' : 'i-lucide-wallet'}
					>
						{wallet.weblnBusy ? 'Connecting…' : 'Connect Lightning Wallet'}
					</Button>
					<p class="mt-2 text-center text-[11px] text-[var(--ui-text-muted)]">
						Connect Alby, Mutiny, or any WebLN wallet to deposit, withdraw, and pay zaps in one tap.
					</p>
				{:else}
					<a
						href="https://www.webln.guide/ressources/wallet-providers"
						target="_blank"
						rel="noreferrer"
						class="inline-flex h-9.5 w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--ui-border-muted)] px-3.5 text-[13.5px] font-semibold transition hover:bg-[var(--interactive-hover-bg)]"
					>
						<Icon name="i-lucide-download" class="size-4" />
						Install a Lightning wallet
					</a>
					<p class="mt-2 text-center text-[11px] text-[var(--ui-text-muted)]">
						No wallet detected. Earnings below are tracked on Nostr — connect a wallet to spend them.
					</p>
				{/if}
			</div>

			<!-- ============ STATS ============ -->
			<div class="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
				<StatTile
					label="Received"
					value={formatCompact(wallet.totalReceived)}
					caption="sats · all time"
					tone="accent"
					center
				/>
				<StatTile
					label="Sent"
					value={formatCompact(wallet.totalSent)}
					caption="sats · tracked"
					tone="warm"
					center
				/>
				<StatTile label="Zaps" value={wallet.countReceived} caption="received" center />
				<StatTile
					label="Avg Zap"
					value={avgZap ? formatCompact(avgZap) : '—'}
					caption="sats"
					center
				/>
			</div>

			<!-- ============ LEDGER ============ -->
			{#if wallet.loading && !wallet.ledger.length}
				<div class="flex flex-col items-center gap-3 py-16 text-center">
					<div class="size-7 animate-spin rounded-full border-2 border-[var(--ui-border)] border-t-primary-500"></div>
					<p class="text-[13px] text-[var(--ui-text-muted)]">Loading zap activity from relays…</p>
				</div>
			{:else if !wallet.connected && !wallet.ledger.length}
				<div class="surface-card flex flex-col items-center gap-3 p-8 py-16 text-center">
					<span class="grid size-14 place-items-center rounded-2xl bg-[var(--tone-error-bg)] text-[var(--tone-error-text)]">
						<Icon name="i-lucide-wifi-off" class="size-7" />
					</span>
					<div>
						<p class="text-[15px] font-semibold">Couldn't reach relays</p>
						<p class="mt-1 text-[13px] text-[var(--ui-text-muted)]">We'll keep retrying. Tap below to try again.</p>
					</div>
					<button
						type="button"
						onclick={() => wallet.start()}
						class="inline-flex items-center gap-2 rounded-full bg-primary-500 px-4 py-2 text-[12.5px] font-bold text-white"
					>
						<Icon name="i-lucide-refresh-ccw" class="size-4" /> Reconnect
					</button>
				</div>
			{:else if !filtered.length}
				<div class="surface-card flex flex-col items-center gap-3 p-8 py-16 text-center">
					<span class="grid size-14 place-items-center rounded-2xl bg-[var(--ui-bg-muted)] text-[var(--ui-text-dimmed)]">
						<Icon name="i-lucide-zap" class="size-7" />
					</span>
					<div>
						<p class="text-[15px] font-semibold">
							{activeTab === 'sent'
								? 'No sent zaps yet'
								: activeTab === 'received'
									? 'No zaps received'
									: 'No zap activity yet'}
						</p>
						<p class="mt-1 text-[13px] text-[var(--ui-text-muted)]">
							{activeTab === 'sent'
								? 'Zap a note from the feed to start your sent history.'
								: 'Publish great notes and earn zaps from the network.'}
						</p>
					</div>
					{#if activeTab !== 'received'}
						<a href="/" class="rounded-full bg-primary-500 px-4 py-2 text-[12px] font-bold text-white">Browse the feed</a>
					{/if}
				</div>
			{:else}
				<div class="surface-card surface-card-hover divide-y divide-[var(--ui-border-muted)] overflow-hidden">
					{#each filtered as entry (entry.id)}
						<ZapLedgerRow {entry} onCopy={copyEntry} />
					{/each}
				</div>
				{#if activeTab === 'all' && wallet.countReceived >= 50}
					<div class="py-8 text-center">
						<button
							type="button"
							onclick={() => wallet.loadMoreReceived()}
							class="inline-flex items-center justify-center gap-2 rounded-full border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] px-6 py-2.5 text-[13px] font-semibold text-[var(--ui-text-muted)] transition hover:bg-[var(--ui-bg-accented)]"
						>
							Load older activity
						</button>
					</div>
				{/if}
			{/if}
		</div>
	</div>
</div>

<!-- ============ DEPOSIT / WITHDRAW MODAL ============ -->
<Dialog bind:open={invoiceModalOpen} title={invoiceModalMode === 'deposit' ? 'Deposit sats' : 'Withdraw sats'}>
	<div class="space-y-4">
		<p class="text-[13px] leading-relaxed text-[var(--ui-text-muted)]">
			{#if invoiceModalMode === 'deposit'}
				Generate an invoice from your connected wallet and pay it (or share it) to top up your balance.
			{:else}
				Paste a Lightning invoice to pay it from your connected wallet.
			{/if}
		</p>

		{#if invoiceModalMode === 'deposit'}
			<div class="grid gap-2 sm:grid-cols-[1fr_auto]">
				<Input
					bind:value={invoiceAmount}
					icon="i-lucide-zap"
					placeholder="Amount in sats"
					type="number"
					inputmode="numeric"
					min="1"
				/>
				<Button color="primary" icon="i-lucide-file-plus" onclick={generateDeposit} disabled={invoiceBusy}>Generate</Button>
			</div>
			<label class="block">
				<span class="mb-1.5 block text-[11px] font-bold tracking-wide text-[var(--ui-text-muted)] uppercase">Memo (optional)</span>
				<Input bind:value={invoiceMemo} placeholder="BitOS deposit" />
			</label>
			{#if invoiceBolt11}
				<div class="rounded-xl bg-[var(--ui-bg-muted)] p-3">
					<p class="mb-2 text-[12px] font-bold">Invoice ready</p>
					<p class="break-all font-mono text-[11px] text-[var(--ui-text-muted)]">{invoiceBolt11}</p>
					<div class="mt-3 flex gap-2">
						<a href={`lightning:${invoiceBolt11}`} class="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-warm-500 px-3 py-2 text-[12px] font-bold text-white hover:bg-warm-600">
							<Icon name="i-lucide-wallet-cards" class="size-3.5" /> Open wallet
						</a>
						<button type="button" onclick={() => navigator.clipboard.writeText(invoiceBolt11).then(() => toasts.success('Invoice copied'))} class="inline-flex items-center gap-1.5 rounded-lg border border-[var(--ui-border-muted)] px-3 py-2 text-[12px] font-bold">
							<Icon name="i-lucide-copy" class="size-3.5" /> Copy
						</button>
					</div>
				</div>
			{/if}
		{:else}
			<label class="block">
				<span class="mb-1.5 block text-[11px] font-bold tracking-wide text-[var(--ui-text-muted)] uppercase">Lightning invoice</span>
				<Input bind:value={invoiceMemo} placeholder="lnbc1…" class="font-mono text-[12px]" />
			</label>
		{/if}

		{#if invoiceError}
			<p role="alert" class="rounded-xl bg-[var(--tone-warning-bg)] px-3 py-2 text-[12px] font-semibold text-[var(--tone-warning-text)]">{invoiceError}</p>
		{/if}
	</div>
	{#snippet footer()}
		<button type="button" onclick={() => (invoiceModalOpen = false)} class="rounded-lg px-3 py-2 text-[12px] font-bold text-[var(--ui-text-muted)] hover:bg-[var(--interactive-hover-bg)]">Close</button>
		{#if invoiceModalMode === 'withdraw'}
			<button type="button" onclick={submitWithdraw} disabled={invoiceBusy} class="inline-flex items-center gap-1.5 rounded-lg bg-warm-500 px-3 py-2 text-[12px] font-bold text-white disabled:opacity-60">
				<Icon name={invoiceBusy ? 'i-lucide-loader-circle' : 'i-lucide-zap'} class="size-3.5 {invoiceBusy ? 'animate-spin' : ''}" /> Pay invoice
			</button>
		{/if}
	{/snippet}
</Dialog>
