<script lang="ts">
	import { onDestroy } from 'svelte';
	import { encodeBytes } from 'nostr-tools/nip19';
	import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import QrCode from '$lib/components/ui/QrCode.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { relays } from '$lib/nostr/relays.svelte';
	import { subscribe } from '$lib/nostr/pool';
	import { hexToBytes } from '$lib/nostr/hex';
	import { wallet } from '$lib/nostr/wallet.svelte';
	import { walletPrefs } from '$lib/stores/wallet-prefs.svelte';
	import { hasConnectedWallet, hasWebLN, enableWebLN, payWithWebLN } from '$lib/nostr/webln';
	import { isNwcConnected } from '$lib/nostr/nwc';

	type Props = {
		open?: boolean;
		recipientPubkey: string;
		lightningAddress: string;
		eventId: string;
		onPaid?: (sats: number) => void;
	};

	let {
		open = $bindable(false),
		recipientPubkey,
		lightningAddress,
		eventId,
		onPaid
	}: Props = $props();
	const amounts = $derived(walletPrefs.state.amounts);
	let selectedAmount = $state(walletPrefs.state.defaultAmount);
	let customAmount = $state('');
	let invoice = $state('');
	let error = $state('');
	let loading = $state(false);
	let paid = $state(false);
	let receiptConfirmed = $state(false);
	let isZap = $state(false);
	let copied = $state(false);
	let paying = $state(false);
	let sentRecordId = $state('');
	let stopReceipt: (() => void) | undefined;
	let closeTimer: ReturnType<typeof setTimeout> | undefined;

	const amount = $derived(Math.max(1, Math.round(Number(customAmount) || selectedAmount)));
	const walletLabel = $derived(wallet.provider === 'nwc' ? 'custom wallet' : 'browser wallet');

	function cleanupReceipt() {
		stopReceipt?.();
		stopReceipt = undefined;
	}

	function reset() {
		cleanupReceipt();
		if (closeTimer) clearTimeout(closeTimer);
		closeTimer = undefined;
		invoice = '';
		error = '';
		paid = false;
		receiptConfirmed = false;
		isZap = false;
		copied = false;
		sentRecordId = '';
	}

	function close() {
		open = false;
		reset();
	}

	/** Leave a short success confirmation, then return the reader to the post. */
	function closeAfterPayment() {
		if (closeTimer) return;
		closeTimer = setTimeout(() => close(), 1800);
	}

	function selectAmount(sats: number) {
		selectedAmount = sats;
		customAmount = '';
		invoice = '';
		error = '';
	}

	function setCustomAmount(value: string) {
		customAmount = value.replace(/[^\d]/g, '').slice(0, 8);
		invoice = '';
		error = '';
	}

	async function createInvoice() {
		if (!lightningAddress) {
			error = 'This author has no Lightning address.';
			return;
		}
		loading = true;
		error = '';
		invoice = '';
		paid = false;
		cleanupReceipt();
		try {
			const [user, domain] = lightningAddress.split('@');
			if (!user || !domain || lightningAddress.includes('://')) {
				throw new Error('The author Lightning address is invalid.');
			}
			const lnurlEndpoint = `https://${domain}/.well-known/lnurlp/${encodeURIComponent(user)}`;
			const metadataResponse = await fetch(lnurlEndpoint);
			if (!metadataResponse.ok) throw new Error('Could not reach the Lightning provider.');
			const metadata = (await metadataResponse.json()) as {
				status?: string;
				errors?: string;
				callback?: string;
				minSendable?: number;
				maxSendable?: number;
				allowsNostr?: boolean;
				nostrPubkey?: string;
			};
			if (metadata.status === 'ERROR' || !metadata.callback) {
				throw new Error(metadata.errors || 'The Lightning provider rejected the request.');
			}
			const millisats = amount * 1000;
			if (metadata.minSendable && millisats < metadata.minSendable) {
				throw new Error(`Minimum amount is ${Math.ceil(metadata.minSendable / 1000)} sats.`);
			}
			if (metadata.maxSendable && millisats > metadata.maxSendable) {
				throw new Error(`Maximum amount is ${Math.floor(metadata.maxSendable / 1000)} sats.`);
			}
			const callback = new URL(metadata.callback);
			callback.searchParams.set('amount', String(millisats));
			const supportsZap = metadata.allowsNostr === true && metadata.nostrPubkey === recipientPubkey;
			let zapRequest: ReturnType<typeof finalizeEvent> | undefined;
			if (supportsZap) {
				zapRequest = finalizeEvent(
					{
						kind: 9734,
						content: '',
						created_at: Math.floor(Date.now() / 1000),
						tags: [
							['relays', ...relays.urls.slice(0, 8)],
							['amount', String(millisats)],
							['p', recipientPubkey],
							['e', eventId],
							['k', '1']
						]
					},
					identity.current?.sk ? hexToBytes(identity.current.sk) : generateSecretKey()
				);
				callback.searchParams.set('nostr', JSON.stringify(zapRequest));
				callback.searchParams.set(
					'lnurl',
					encodeBytes('lnurl', new TextEncoder().encode(lnurlEndpoint))
				);
				sentRecordId = zapRequest.id;
			}
			if (!sentRecordId) sentRecordId = `${eventId}:${amount}:${Date.now()}`;
			const invoiceResponse = await fetch(callback);
			if (!invoiceResponse.ok) throw new Error('Could not create a Lightning invoice.');
			const payment = (await invoiceResponse.json()) as {
				status?: string;
				pr?: string;
				reason?: string;
			};
			if (payment.status === 'ERROR' || !payment.pr)
				throw new Error(payment.reason || 'No invoice was returned.');
			invoice = payment.pr;
			isZap = !!zapRequest;
			if (zapRequest) {
				const requestId = zapRequest.id;
				stopReceipt = subscribe(
					[{ kinds: [9735], '#p': [recipientPubkey], since: Math.floor(Date.now() / 1000) - 120 }],
					{
						onevent: (event) => {
							const description = event.tags.find((tag) => tag[0] === 'description')?.[1];
							if (!description) return;
							try {
								const receipt = JSON.parse(description) as { id?: string };
								if (receipt.id !== requestId) return;
								paid = true;
								receiptConfirmed = true;
								recordSent();
								onPaid?.(amount);
								cleanupReceipt();
								closeAfterPayment();
							} catch {
								/* Ignore malformed receipts. */
							}
						}
					}
				);
			}
			// Keep payment explicit: the user can choose NWC/WebLN or use the QR
			// invoice with another Lightning wallet.
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not prepare the zap.';
		} finally {
			loading = false;
		}
	}

	async function copyInvoice() {
		if (!invoice) return;
		await navigator.clipboard.writeText(invoice);
		copied = true;
		setTimeout(() => (copied = false), 1800);
	}

	/** Record a successfully-sent zap into the local wallet ledger. */
	function recordSent() {
		wallet.recordSent({
			id: sentRecordId || `${eventId}:${amount}:${Date.now()}`,
			amountSats: amount,
			recipientPubkey,
			targetNoteId: eventId
		});
	}

	/** Pay the current invoice via a connected WebLN wallet (best-effort). */
	async function maybePayWithWebLN() {
		if (!invoice || paid || !hasConnectedWallet()) return;
		try {
			// Do not wake an injected wallet (such as Alby) when the user chose
			// their saved Custom NWC wallet in Lightning settings.
			if (wallet.provider === 'webln' && hasWebLN()) await enableWebLN();
		} catch {
			return; // user declined to enable the wallet — fall back to QR
		}
		paying = true;
		try {
			await payWithWebLN(invoice);
			// A successful WebLN payment is definitive for the local sent history.
			// The receipt listener remains useful for the public NIP-57 confirmation,
			// but relay delays must not hide a completed payment from this ledger.
			paid = true;
			recordSent();
			onPaid?.(amount);
			closeAfterPayment();
			// Keep listening so the UI can distinguish a settled invoice from a
			// publicly confirmed NIP-57 zap receipt.
		} catch (e) {
			error =
				e instanceof Error ? e.message : 'Wallet payment failed. You can still use the invoice.';
		} finally {
			paying = false;
		}
	}

	async function selectZapWallet(provider: 'webln' | 'nwc') {
		const ok = await wallet.selectProvider(provider);
		if (!ok && wallet.error) error = wallet.error;
	}

	onDestroy(cleanupReceipt);
</script>

<Dialog bind:open title="Zap this note" onClose={close}>
	<div class="space-y-4">
		<p class="text-[13px] leading-relaxed text-[var(--ui-text-muted)]">
			Send sats directly to the author. Create an invoice, then pay with your connected wallet or
			any Lightning app.
		</p>
		<div class="grid grid-cols-4 gap-2">
			{#each amounts as sats}
				<button
					type="button"
					onclick={() => selectAmount(sats)}
					class="rounded-xl border px-2 py-2.5 text-center text-[12px] font-bold transition {selectedAmount ===
						sats && !customAmount
						? 'border-warm-500 bg-warm-500/10 text-warm-600'
						: 'border-[var(--ui-border-muted)] hover:border-warm-500/40'}">{sats} sats</button
				>
			{/each}
		</div>
		<label
			class="flex items-center gap-2 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3 py-2"
		>
			<Icon name="i-lucide-pencil" class="size-4 text-[var(--ui-text-dimmed)]" />
			<input
				aria-label="Custom zap amount"
				type="text"
				inputmode="numeric"
				value={customAmount}
				oninput={(e) => setCustomAmount(e.currentTarget.value)}
				placeholder="Custom sats amount"
				class="min-w-0 flex-1 bg-transparent text-[13px] font-semibold outline-none placeholder:text-[var(--ui-text-dimmed)]"
			/>
		</label>
		{#if error}<p
				role="alert"
				class="rounded-xl bg-[var(--tone-warning-bg)] px-3 py-2 text-[12px] font-semibold text-[var(--tone-warning-text)]"
			>
				{error}
			</p>{/if}
		{#if invoice}
			<div class="rounded-2xl bg-[var(--ui-bg-muted)] p-3">
				{#if paid}<p class="mb-2 flex items-center gap-2 text-[13px] font-bold text-accent-600">
						<Icon name="i-lucide-check" class="size-4" />
						{#if isZap && !receiptConfirmed}
							Payment sent · confirming zap…
						{:else if isZap}
							Zap confirmed · {amount.toLocaleString()} sats sent
						{:else}
							Invoice paid · {amount.toLocaleString()} sats
						{/if}
					</p>{:else}<p class="mb-2 text-[13px] font-bold">
						{isZap ? 'Zap invoice ready' : 'Invoice ready'} · {amount.toLocaleString()} sats
					</p>{/if}
				<QrCode value={invoice.toUpperCase()} label="Zap invoice QR code" />
				{#if hasWebLN() && isNwcConnected() && !paid}
					<div
						class="mt-3 flex items-center justify-between gap-2 rounded-lg border border-[var(--ui-border-muted)] bg-[var(--ui-bg)] px-2.5 py-2"
					>
						<span class="text-[11px] font-semibold text-[var(--ui-text-muted)]">Choose wallet</span>
						<div
							class="flex rounded-md border border-[var(--ui-border-muted)] p-0.5 text-[10.5px] font-bold"
						>
							<button
								type="button"
								onclick={() => selectZapWallet('webln')}
								class="rounded px-2 py-1 {wallet.provider === 'webln'
									? 'bg-primary-500 text-white'
									: 'text-[var(--ui-text-muted)]'}">Browser wallet</button
							>
							<button
								type="button"
								onclick={() => selectZapWallet('nwc')}
								class="rounded px-2 py-1 {wallet.provider === 'nwc'
									? 'bg-primary-500 text-white'
									: 'text-[var(--ui-text-muted)]'}">Custom wallet</button
							>
						</div>
					</div>
				{/if}
				<div class="mt-3 flex gap-2">
					{#if hasConnectedWallet() && !paid}
						<button
							type="button"
							onclick={maybePayWithWebLN}
							disabled={paying}
							class="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary-500 px-3 py-2 text-[12px] font-bold text-white transition hover:bg-primary-600 disabled:opacity-60"
							><Icon
								name={paying ? 'i-lucide-loader-circle' : 'i-lucide-wallet'}
								class="size-3.5 {paying ? 'animate-spin' : ''}"
							/>{paying
								? 'Paying…'
								: `Pay ${amount.toLocaleString()} sats with ${walletLabel}`}</button
						>
					{/if}
					<a
						href={`lightning:${invoice}`}
						class="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-warm-500 px-3 py-2 text-[12px] font-bold text-white hover:bg-warm-600"
						><Icon name="i-lucide-wallet-cards" class="size-3.5" />Use another wallet</a
					>
					<button
						type="button"
						onclick={copyInvoice}
						class="inline-flex items-center gap-1.5 rounded-lg border border-[var(--ui-border-muted)] px-3 py-2 text-[12px] font-bold"
						><Icon name={copied ? 'i-lucide-check' : 'i-lucide-copy'} class="size-3.5" />{copied
							? 'Copied'
							: 'Copy invoice'}</button
					>
				</div>
				{#if isZap && !paid}<p class="mt-2 text-[10.5px] text-[var(--ui-text-dimmed)]">
						Listening for the zap receipt on Nostr…
					</p>{/if}
				{#if !isZap}<p class="mt-2 text-[10.5px] text-[var(--ui-text-dimmed)]">
						This payment will not appear in the public zap total because the recipient does not
						support zap receipts.
					</p>{/if}
			</div>
		{/if}
	</div>
	{#snippet footer()}
		<button
			type="button"
			onclick={close}
			class="rounded-lg px-3 py-2 text-[12px] font-bold text-[var(--ui-text-muted)] hover:bg-[var(--interactive-hover-bg)]"
			>Close</button
		>
		{#if !invoice || paid}<button
				type="button"
				onclick={createInvoice}
				disabled={loading || paid}
				class="inline-flex items-center gap-1.5 rounded-lg bg-warm-500 px-3 py-2 text-[12px] font-bold text-white disabled:opacity-60"
				><Icon
					name={loading ? 'i-lucide-loader-circle' : 'i-lucide-zap'}
					class="size-3.5 {loading ? 'animate-spin' : ''}"
				/>{loading
					? 'Preparing…'
					: paid
						? 'Paid'
						: `Create invoice · ${amount.toLocaleString()} sats`}</button
			>{/if}
	{/snippet}
</Dialog>
