<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import StatTile from '$lib/components/ui/StatTile.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import LivePill from '$lib/components/ui/LivePill.svelte';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import QrCode from '$lib/components/ui/QrCode.svelte';
	import ZapLedgerRow from '$lib/components/zaps/ZapLedgerRow.svelte';
	import { wallet } from '$lib/nostr/wallet.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { walletPrefs } from '$lib/stores/wallet-prefs.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import {
		hasWebLN,
		makeWebLNInvoice,
		payWithWebLN,
		checkWebLNInvoicePaid,
		watchWalletPayments
	} from '$lib/nostr/webln';
	import { bolt11Expiry } from '$lib/nostr/zaps';
	import { formatCompact, shortKey } from '$lib/utils/format';
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
	// --- Deposit settlement detection ---
	let depositPaid = $state(false);
	let depositBaseline = $state<number | null>(null);
	let nowSec = $state(Math.floor(Date.now() / 1000));
	let depositTimer: ReturnType<typeof setInterval> | undefined;
	let tickTimer: ReturnType<typeof setInterval> | undefined;
	/** Auto-close after settlement so the success state cannot linger forever. */
	let depositCloseTimer: ReturnType<typeof setTimeout> | undefined;
	/** NIP-47 7375 push watcher — fires the moment the wallet sees the payment. */
	let stopDepositWatch: (() => void) | undefined;
	/** Manual check button state. */
	let checking = $state(false);
	let lastCheckedAt = $state<number | null>(null);
	const DEPOSIT_POLL_MS = 4_000;
	const DEPOSIT_CLOSE_MS = 3_000;

	const me = $derived(identity.current?.pk ?? '');
	const activityLedger = $derived(wallet.ledger);
	const receivedEntries = $derived(
		activityLedger.filter((entry) => entry.direction === 'received')
	);
	const sentEntries = $derived(activityLedger.filter((entry) => entry.direction === 'sent'));
	const totalReceived = $derived(receivedEntries.reduce((sum, entry) => sum + entry.amountSats, 0));
	const totalSent = $derived(sentEntries.reduce((sum, entry) => sum + entry.amountSats, 0));
	const avgZap = $derived(
		receivedEntries.length ? Math.round(totalReceived / receivedEntries.length) : 0
	);
	const displayBalance = $derived(wallet.balance);
	const displayNet = $derived(wallet.net);
	const showingWalletBalance = $derived(wallet.balanceSource === 'wallet');
	const tabOptions = $derived([
		{ key: 'all', label: 'All Activity', count: activityLedger.length },
		{ key: 'received', label: 'Received', count: receivedEntries.length },
		{ key: 'sent', label: 'Sent', count: sentEntries.length }
	]);
	const displayedEntries = $derived(
		activeTab === 'all'
			? activityLedger
			: activityLedger.filter((entry) => entry.direction === activeTab)
	);
	const walletAvailable = $derived(hasWebLN());
	/** Invoice lifetime countdown (unix seconds); 0 while none pending. */
	const depositExpiryAt = $derived(
		invoiceModalMode === 'deposit' && invoiceBolt11 && !depositPaid
			? (bolt11Expiry(invoiceBolt11) ?? 0)
			: 0
	);
	const depositSecondsLeft = $derived(
		depositExpiryAt > 0 ? Math.max(0, depositExpiryAt - nowSec) : 0
	);
	const depositExpired = $derived(
		!!invoiceBolt11 && !depositPaid && depositExpiryAt > 0 && depositSecondsLeft === 0
	);

	onMount(() => {
		walletPrefs.load();
		if (me) wallet.start();
		else wallet.detectWebLN();
	});
	onDestroy(() => {
		wallet.stop();
		stopDepositPolling();
		stopDepositCloseTimer();
	});

	function openInvoice(mode: 'deposit' | 'withdraw') {
		invoiceModalMode = mode;
		invoiceAmount = '';
		invoiceMemo = '';
		invoiceBolt11 = '';
		invoiceError = '';
		stopDepositPolling();
		stopDepositCloseTimer();
		depositPaid = false;
		depositBaseline = null;
		invoiceModalOpen = true;
	}

	function stopDepositPolling() {
		if (depositTimer) clearInterval(depositTimer);
		if (tickTimer) clearInterval(tickTimer);
		depositTimer = undefined;
		tickTimer = undefined;
		stopDepositWatch?.();
		stopDepositWatch = undefined;
	}

	function stopDepositCloseTimer() {
		if (depositCloseTimer) clearTimeout(depositCloseTimer);
		depositCloseTimer = undefined;
	}

	function closeDepositDialog() {
		invoiceModalOpen = false;
		stopDepositPolling();
		stopDepositCloseTimer();
	}

	function onDepositPaid() {
		if (depositPaid) return;
		depositPaid = true;
		stopDepositPolling();
		toasts.success(`Deposit of ${Number(invoiceAmount).toLocaleString()} sats received`);
		void wallet.refreshBalance();
		// Success confirmation, then return the user to their updated balance.
		stopDepositCloseTimer();
		depositCloseTimer = setTimeout(closeDepositDialog, DEPOSIT_CLOSE_MS);
	}

	/** One settlement probe. NWC answers `lookup_invoice`; injected WebLN
	 * wallets get a best-effort balance-delta fallback (baseline + amount). */
	async function pollDepositOnce() {
		if (!invoiceBolt11 || depositPaid) return;
		// An expired invoice can no longer settle — stop wasting probes.
		if (depositExpiryAt > 0 && depositSecondsLeft === 0) {
			stopDepositPolling();
			return;
		}
		const sats = Number(invoiceAmount);
		try {
			const settled = await checkWebLNInvoicePaid(invoiceBolt11);
			if (settled === true) {
				onDepositPaid();
				return;
			}
			if (settled === null && wallet.weblnEnabled) {
				const balance = await wallet.refreshBalance();
				if (
					depositBaseline !== null &&
					balance !== null &&
					Number.isFinite(sats) &&
					sats >= 1 &&
					balance >= depositBaseline + sats
				) {
					onDepositPaid();
				}
			}
		} catch {
			/* keep polling — relay/wallet hiccups must not kill the watcher */
		}
		lastCheckedAt = Date.now();
	}

	/** Manual “Check payment” — same probe, plus honest “not yet” feedback. */
	async function manualCheck() {
		if (!invoiceBolt11 || depositPaid || checking) return;
		checking = true;
		try {
			await pollDepositOnce();
			if (!depositPaid) toasts.info('No payment seen yet — still watching');
		} finally {
			checking = false;
		}
	}

	function startDepositPolling() {
		stopDepositPolling();
		depositTimer = setInterval(() => void pollDepositOnce(), DEPOSIT_POLL_MS);
		tickTimer = setInterval(() => (nowSec = Math.floor(Date.now() / 1000)), 1_000);
		// Push channel (NWC): the wallet notifies us the instant sats land —
		// the same event-driven model the zap dialog uses for 9735 receipts.
		stopDepositWatch = watchWalletPayments((notification) => {
			const settled = notification.invoice?.toLowerCase();
			// Match our invoice when the wallet includes it; otherwise any
			// incoming payment while this dialog is open is the deposit.
			if (!settled || settled === invoiceBolt11.toLowerCase()) onDepositPaid();
		});
	}

	async function generateDeposit() {
		const sats = Number(invoiceAmount);
		if (!Number.isFinite(sats) || sats < 1) {
			invoiceError = 'Enter a valid amount in sats.';
			return;
		}
		invoiceBusy = true;
		invoiceError = '';
		stopDepositPolling();
		stopDepositCloseTimer();
		depositPaid = false;
		try {
			const bolt11 = await makeWebLNInvoice(sats, invoiceMemo.trim());
			if (!bolt11) throw new Error('Your wallet could not generate an invoice.');
			invoiceBolt11 = bolt11;
			// Baseline for the balance-delta fallback (injected WebLN wallets). Fetch
			// it when missing — a null baseline would silently disable detection.
			if (wallet.weblnEnabled) {
				depositBaseline = wallet.weblnBalance ?? (await wallet.refreshBalance());
			} else {
				depositBaseline = null;
			}
			toasts.success('Deposit invoice generated');
			startDepositPolling();
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

	async function exportActivity() {
		try {
			await navigator.clipboard.writeText(
				JSON.stringify(
					activityLedger.map((entry) => ({
						direction: entry.direction,
						amountSats: entry.amountSats,
						counterparty:
							entry.direction === 'received' ? entry.senderPubkey : entry.recipientPubkey,
						memo: entry.memo ?? '',
						createdAt: new Date(entry.createdAt * 1000).toISOString(),
						id: entry.id
					})),
					null,
					2
				)
			);
			toasts.success('Zap activity copied to clipboard');
		} catch {
			toasts.error('Could not copy zap activity');
		}
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
					· {receivedEntries.length} received · {sentEntries.length} sent
				</span>
			{/snippet}
			{#snippet actions()}
				<button
					type="button"
					onclick={exportActivity}
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
							class="relative shrink-0 px-3 py-2.5 text-[12px] font-bold transition {activeTab ===
							tab.key
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
				class="premium-card mb-4 overflow-hidden border-[color-mix(in_oklab,var(--ui-color-primary-500)_22%,transparent)] bg-[linear-gradient(135deg,color-mix(in_oklab,var(--ui-color-primary-500)_12%,transparent),color-mix(in_oklab,var(--color-warm-500)_6%,transparent))] p-5"
			>
				<div class="mb-5 flex items-start justify-between gap-3">
					<div class="min-w-0">
						<div
							class="text-[11px] font-semibold tracking-wider text-[var(--ui-text-muted)] uppercase"
						>
							{showingWalletBalance ? 'Wallet Balance' : 'Total Received'}
						</div>
						<div class="mt-1 font-mono text-4xl font-bold tracking-tight">
							{formatCompact(displayBalance)}
							<span class="text-lg text-[var(--ui-color-primary-500)]">sats</span>
						</div>
						<div class="mt-1 text-xs text-[var(--ui-text-muted)]">
							{#if showingWalletBalance && wallet.weblnInfo?.node?.alias}
								Connected · {wallet.weblnInfo.node.alias}
							{:else}
								Net {formatCompact(displayNet)} sats · received minus sent
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
				{#if wallet.weblnEnabled}
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
							class="icon-btn w-22"
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
					<a
						href="/settings/lightning"
						class="mt-2 block text-center text-[11px] font-semibold text-primary-500 hover:underline"
						>Use a custom NWC connection</a
					>
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
						No wallet detected. Earnings below are tracked on Nostr — connect a wallet to spend
						them.
					</p>
					<a
						href="/settings/lightning"
						class="mt-2 block text-center text-[11px] font-semibold text-primary-500 hover:underline"
						>Connect a custom NWC wallet</a
					>
				{/if}
			</div>

			<!-- ============ STATS ============ -->
			<div class="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
				<StatTile
					label="Received"
					value={formatCompact(totalReceived)}
					caption="sats · all time"
					tone="accent"
					center
				/>
				<StatTile
					label="Sent"
					value={formatCompact(totalSent)}
					caption="sats · tracked"
					tone="warm"
					center
				/>
				<StatTile label="Zaps" value={receivedEntries.length} caption="received" center />
				<StatTile
					label="Avg Zap"
					value={avgZap ? formatCompact(avgZap) : '—'}
					caption="sats"
					center
				/>
			</div>

			<!-- ============ LEDGER ============ -->
			{#if wallet.loading && !wallet.ledger.length}
				<section aria-label="Zap activity">
					<div class="mb-2 flex items-center justify-between px-1">
						<h2 class="text-[15px] font-bold">Zap Activity</h2>
						<LivePill label="Live" tone="success" />
					</div>
					<div class="-mx-[clamp(1rem,3vw,1.5rem)] space-y-2.5 px-[clamp(1rem,3vw,1.5rem)] py-3.5">
						{#each [0, 1, 2] as i (i)}
							<div class="flex items-center gap-3">
								<div
									class="size-9 shrink-0 animate-pulse rounded-full bg-[var(--ui-bg-muted)]"
								></div>
								<div class="h-3 w-1/3 animate-pulse rounded bg-[var(--ui-bg-muted)]"></div>
								<div class="ml-auto h-3 w-14 animate-pulse rounded bg-[var(--ui-bg-muted)]"></div>
							</div>
						{/each}
					</div>
				</section>
			{:else if !wallet.connected && !wallet.ledger.length}
				<div
					class="flex flex-col items-center gap-3 rounded-[var(--ui-radius)] border border-[var(--ui-border-muted)] bg-[color-mix(in_oklab,var(--surface-bg)_65%,transparent)] p-8 py-16 text-center"
				>
					<span
						class="grid size-14 place-items-center rounded-2xl bg-[var(--tone-error-bg)] text-[var(--tone-error-text)]"
					>
						<Icon name="i-lucide-wifi-off" class="size-7" />
					</span>
					<div>
						<p class="text-[15px] font-semibold">Couldn't reach relays</p>
						<p class="mt-1 text-[13px] text-[var(--ui-text-muted)]">
							We'll keep retrying. Tap below to try again.
						</p>
					</div>
					<button
						type="button"
						onclick={() => wallet.start()}
						class="inline-flex items-center gap-2 rounded-full bg-primary-500 px-4 py-2 text-[12.5px] font-bold text-white"
					>
						<Icon name="i-lucide-refresh-ccw" class="size-4" /> Reconnect
					</button>
				</div>
			{:else if !displayedEntries.length}
				<div
					class="flex flex-col items-center gap-3 rounded-[var(--ui-radius)] border border-[var(--ui-border-muted)] bg-[color-mix(in_oklab,var(--surface-bg)_65%,transparent)] p-8 py-16 text-center"
				>
					<span
						class="grid size-14 place-items-center rounded-2xl bg-[var(--ui-bg-muted)] text-[var(--ui-text-dimmed)]"
					>
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
						<a
							href="/"
							class="rounded-full bg-primary-500 px-4 py-2 text-[12px] font-bold text-white"
							>Browse the feed</a
						>
					{/if}
				</div>
			{:else}
				<section aria-label="Zap activity">
					<div class="mb-2 flex items-center justify-between px-1">
						<h2 class="text-[15px] font-bold">Zap Activity</h2>
						<LivePill label="Live" tone="success" />
					</div>
					<div class="-mx-[clamp(1rem,3vw,1.5rem)] divide-y divide-[var(--ui-border-muted)]">
						{#each displayedEntries as entry (entry.id)}
							<ZapLedgerRow {entry} onCopy={copyEntry} />
						{/each}
					</div>
				</section>
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
<Dialog
	bind:open={invoiceModalOpen}
	title={invoiceModalMode === 'deposit' ? 'Deposit sats' : 'Withdraw sats'}
	onClose={() => {
		stopDepositPolling();
		stopDepositCloseTimer();
	}}
>
	<div class="space-y-4">
		<p class="text-[13px] leading-relaxed text-[var(--ui-text-muted)]">
			{#if invoiceModalMode === 'deposit'}
				Generate an invoice from your connected wallet and pay it (or share it) to top up your
				balance.
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
				<Button
					color="primary"
					icon="i-lucide-file-plus"
					onclick={generateDeposit}
					disabled={invoiceBusy}>Generate</Button
				>
			</div>
			<label class="block">
				<span
					class="mb-1.5 block text-[11px] font-bold tracking-wide text-[var(--ui-text-muted)] uppercase"
					>Memo (optional)</span
				>
				<Input bind:value={invoiceMemo} class="w-full" placeholder="BitOS deposit" />
			</label>
			{#if depositPaid}
				<!-- Settlement confirmed by the wallet — closes itself shortly. -->
				<div
					class="flex flex-col items-center gap-2 rounded-xl bg-[var(--tone-success-bg)] p-4 text-center"
					role="status"
				>
					<span
						class="grid size-12 place-items-center rounded-full bg-[var(--tone-success-text)] text-white"
					>
						<Icon name="i-lucide-check" class="size-6" />
					</span>
					<div>
						<p class="text-[14px] font-bold text-[var(--tone-success-text)]">Deposit received</p>
						<p class="mt-0.5 text-[12px] text-[var(--ui-text-muted)]">
							{Number(invoiceAmount).toLocaleString()} sats added to your wallet balance.
						</p>
					</div>
					<div class="deposit-countdown-bar w-full max-w-[240px]"></div>
					<p class="text-[10.5px] text-[var(--ui-text-dimmed)]">Closing…</p>
				</div>
			{:else if invoiceBolt11}
				<div class="rounded-xl bg-[var(--ui-bg-muted)] p-3">
					{#if depositExpired}
						<div
							class="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--tone-warning-bg)] px-3 py-2.5 text-[12px] font-semibold text-[var(--tone-warning-text)]"
						>
							<span class="inline-flex items-center gap-1.5">
								<Icon name="i-lucide-timer-off" class="size-4 shrink-0" />
								Invoice expired unpaid — get a fresh one.
							</span>
							<button
								type="button"
								onclick={generateDeposit}
								disabled={invoiceBusy}
								class="rounded-lg bg-[var(--tone-warning-text)] px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-60"
							>
								{invoiceBusy ? 'Making…' : 'New invoice'}
							</button>
						</div>
						<div class="mx-auto mt-3 w-fit opacity-40 grayscale">
							<QrCode value={invoiceBolt11.toUpperCase()} label="Expired deposit invoice QR code" />
						</div>
					{:else}
						<!-- QR first: the scannable code is the hero, details secondary. -->
						<div class="mx-auto w-fit">
							<QrCode
								value={invoiceBolt11.toUpperCase()}
								label="Lightning deposit invoice QR code for {invoiceAmount} sats"
							/>
							<div class="relative -mt-4 flex justify-center">
								<span
									class="inline-flex items-center gap-1 rounded-full bg-warm-500 px-3 py-1 text-[12.5px] font-extrabold text-white shadow-lg shadow-black/20"
								>
									<Icon name="i-lucide-zap" class="size-3.5 fill-current" />
									{Number(invoiceAmount).toLocaleString()} sats
								</span>
							</div>
						</div>
						<div class="mt-4 flex flex-wrap items-center justify-center gap-2">
							<span class="text-[12px] font-bold">Invoice ready</span>
							{#if depositExpiryAt > 0}
								<span
									class="inline-flex items-center gap-1 font-mono text-[11px] font-bold {depositSecondsLeft <
									120
										? 'text-[var(--tone-warning-text)]'
										: 'text-[var(--ui-text-muted)]'}"
								>
									<Icon name="i-lucide-timer" class="size-3.5" />
									{Math.floor(depositSecondsLeft / 60)}:{String(depositSecondsLeft % 60).padStart(
										2,
										'0'
									)}
								</span>
							{/if}
						</div>
						<p class="mt-1 text-center text-[11px] text-[var(--ui-text-muted)]">
							Scan with any Lightning wallet to top up your balance.
						</p>
						<div class="mt-3 flex flex-wrap gap-2">
							<a
								href={`lightning:${invoiceBolt11}`}
								class="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-warm-500 px-3 py-2 text-[12px] font-bold text-white hover:bg-warm-600"
							>
								<Icon name="i-lucide-wallet-cards" class="size-3.5" /> Open wallet
							</a>
							<button
								type="button"
								onclick={() =>
									navigator.clipboard
										.writeText(invoiceBolt11)
										.then(() => toasts.success('Invoice copied'))}
								class="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--ui-border-muted)] px-3 py-2 text-[12px] font-bold"
							>
								<Icon name="i-lucide-copy" class="size-3.5" /> Copy
							</button>
						</div>
						<button
							type="button"
							onclick={() =>
								navigator.clipboard
									.writeText(invoiceBolt11)
									.then(() => toasts.success('Full invoice copied'))}
							class="mt-2 block w-full truncate rounded-lg bg-[var(--ui-bg)] px-2.5 py-1.5 text-center font-mono text-[10.5px] text-[var(--ui-text-dimmed)] transition hover:text-[var(--ui-text-muted)]"
							title="Copy full invoice"
						>
							{shortKey(invoiceBolt11, 18, 12)}
						</button>
						<div
							class="mt-1 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[10.5px] font-semibold text-[var(--ui-text-dimmed)]"
						>
							<span class="inline-flex items-center gap-1.5">
								<Icon name="i-lucide-radar" class="size-3 animate-pulse" />
								Watching for payment…
							</span>
							{#if lastCheckedAt}
								<span>Last checked {new Date(lastCheckedAt).toLocaleTimeString()}</span>
							{/if}
						</div>
						<button
							type="button"
							onclick={manualCheck}
							disabled={checking || depositPaid}
							class="mx-auto mt-2 inline-flex items-center gap-1.5 rounded-lg border border-[var(--ui-border-muted)] px-3 py-1.5 text-[11.5px] font-bold text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)] disabled:cursor-not-allowed disabled:opacity-60"
						>
							<Icon
								name={checking ? 'i-lucide-loader-circle' : 'i-lucide-refresh-cw'}
								class="size-3.5 {checking ? 'animate-spin' : ''}"
							/>
							{checking ? 'Checking…' : 'Check payment'}
						</button>
					{/if}
				</div>
			{/if}
		{:else}
			<label class="block">
				<span
					class="mb-1.5 block text-[11px] font-bold tracking-wide text-[var(--ui-text-muted)] uppercase"
					>Lightning invoice</span
				>
				<Input bind:value={invoiceMemo} placeholder="lnbc1…" class="w-full font-mono text-[12px]" />
			</label>
		{/if}

		{#if invoiceError}
			<p
				role="alert"
				class="rounded-xl bg-[var(--tone-warning-bg)] px-3 py-2 text-[12px] font-semibold text-[var(--tone-warning-text)]"
			>
				{invoiceError}
			</p>
		{/if}
	</div>
	{#snippet footer()}
		<button
			type="button"
			onclick={closeDepositDialog}
			class="rounded-lg px-3 py-2 text-[12px] font-bold text-[var(--ui-text-muted)] hover:bg-[var(--interactive-hover-bg)]"
			>{depositPaid ? 'Done' : 'Close'}</button
		>
		{#if invoiceModalMode === 'withdraw'}
			<button
				type="button"
				onclick={submitWithdraw}
				disabled={invoiceBusy}
				class="inline-flex items-center gap-1.5 rounded-lg bg-warm-500 px-3 py-2 text-[12px] font-bold text-white disabled:opacity-60"
			>
				<Icon
					name={invoiceBusy ? 'i-lucide-loader-circle' : 'i-lucide-zap'}
					class="size-3.5 {invoiceBusy ? 'animate-spin' : ''}"
				/> Pay invoice
			</button>
		{/if}
	{/snippet}
</Dialog>

<style>
	/* Draining bar shown during the auto-close success window. */
	.deposit-countdown-bar {
		height: 3px;
		border-radius: 9999px;
		background: color-mix(in oklab, var(--tone-success-text) 22%, transparent);
		overflow: hidden;
		position: relative;
	}
	.deposit-countdown-bar::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: 9999px;
		background: var(--tone-success-text);
		transform-origin: left;
		animation: deposit-countdown var(--deposit-close-ms, 3000ms) linear forwards;
	}
	@keyframes deposit-countdown {
		from {
			transform: scaleX(1);
		}
		to {
			transform: scaleX(0);
		}
	}
</style>
