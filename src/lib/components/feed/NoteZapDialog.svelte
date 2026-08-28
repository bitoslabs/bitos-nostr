<script lang="ts">
	import { onDestroy } from 'svelte';
	import { npubEncode } from 'nostr-tools/nip19';
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import QrCode from '$lib/components/ui/QrCode.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Toggle from '$lib/components/ui/Toggle.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { relays } from '$lib/nostr/relays.svelte';
	import { subscribe } from '$lib/nostr/pool';
	import { wallet } from '$lib/nostr/wallet.svelte';
	import { walletPrefs } from '$lib/stores/wallet-prefs.svelte';
	import { pendingZaps } from '$lib/stores/pending-zaps.svelte';
	import { hasConnectedWallet, hasWebLN, enableWebLN, payWithWebLN } from '$lib/nostr/webln';
	import { isNwcConnected } from '$lib/nostr/nwc';
	import { bolt11Expiry } from '$lib/nostr/zaps';
	import { createZapInvoice, ZapInvoiceError } from '$lib/nostr/zap-invoice';
	import { shortKey } from '$lib/utils/format';

	type Props = {
		open?: boolean;
		recipientPubkey: string;
		lightningAddress: string;
		eventId: string;
		/** Kind of the zapped event for the NIP-57 `k` tag (notes/comments 1, stories 30315). */
		eventKind?: number;
		dialogZIndex?: number;
		onPaid?: (sats: number) => void;
		/** Fired when the dialog closes (any path) so hosts can resume playback. */
		onClose?: () => void;
	};

	let {
		open = $bindable(false),
		recipientPubkey,
		lightningAddress,
		eventId,
		eventKind = 1,
		dialogZIndex = 110,
		onPaid,
		onClose
	}: Props = $props();

	const AUTO_CLOSE_MS = 2400;
	const MAX_COMMENT = 200;
	/** Slack when re-querying for a receipt: covers provider publish delay. */
	const RECEIPT_QUERY_SLACK_SEC = 120;

	const amounts = $derived(walletPrefs.state.amounts);
	let selectedAmount = $state(walletPrefs.state.defaultAmount);
	let customAmount = $state('');
	let comment = $state('');
	let invoice = $state('');
	let error = $state('');
	let loading = $state(false);
	let paid = $state(false);
	let receiptConfirmed = $state(false);
	let isZap = $state(false);
	let copied = $state<string | null>(null);
	let paying = $state(false);
	let sentRecordId = $state('');
	let zapRequestEvent = $state<import('nostr-tools/pure').Event | null>(null);
	let invoiceCreatedAt = 0;
	let zapContext: { sats: number; recipient: string; targetEventId: string; comment: string } | null =
		null;
	let nowSec = $state(Math.floor(Date.now() / 1000));
	let dialogActive = true;
	let stopReceipt: (() => void) | undefined;
	let closeTimer: ReturnType<typeof setTimeout> | undefined;

	const amount = $derived(Math.max(1, Math.round(Number(customAmount) || selectedAmount)));
	const recipientProfile = $derived(profiles.byPubkey[recipientPubkey]);
	const recipientName = $derived(
		recipientProfile?.display_name || recipientProfile?.name || shortKey(recipientPubkey)
	);
	const hasAddress = $derived(!!lightningAddress && !lightningAddress.includes('://'));
	const walletBalance = $derived(wallet.weblnEnabled ? wallet.weblnBalance : null);
	const recipientNpub = $derived(
		(() => {
			try {
				return npubEncode(recipientPubkey);
			} catch {
				return recipientPubkey;
			}
		})()
	);
	/** Invoice lifetime countdown (unix seconds), 0 while no invoice is pending. */
	const expiryAt = $derived(invoice && !paid ? (bolt11Expiry(invoice) ?? 0) : 0);
	const secondsLeft = $derived(expiryAt > 0 ? Math.max(0, expiryAt - nowSec) : 0);
	const expired = $derived(!!invoice && !paid && expiryAt > 0 && secondsLeft === 0);
	const expiryLabel = $derived(
		`${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`
	);

	/** Fetch the recipient's profile (avatar/name) whenever the dialog opens. */
	$effect(() => {
		if (open && recipientPubkey) void profiles.ensure([recipientPubkey]);
	});

	$effect(() => {
		if (!invoice || paid) return;
		const tick = setInterval(() => (nowSec = Math.floor(Date.now() / 1000)), 1000);
		return () => clearInterval(tick);
	});

	/** YakiHonne-style amount tiers: each preset gets its own zap emoji. */
	function zapEmoji(sats: number): string {
		if (sats <= 50) return '⚡';
		if (sats <= 250) return '💜';
		if (sats <= 750) return '🔥';
		return '🚀';
	}

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
		copied = null;
		sentRecordId = '';
		comment = '';
		zapRequestEvent = null;
		invoiceCreatedAt = 0;
		zapContext = null;
	}

	function close() {
		open = false;
		reset();
		onClose?.();
	}

	/** Leave a short success confirmation, then return the reader to the post. */
	function closeAfterPayment() {
		if (closeTimer) return;
		closeTimer = setTimeout(() => close(), AUTO_CLOSE_MS);
	}

	/** Drop the current invoice so the next changes regenerate a fresh one. */
	function invalidateInvoice() {
		invoice = '';
		error = '';
		paid = false;
		cleanupReceipt();
	}

	function selectAmount(sats: number) {
		selectedAmount = sats;
		customAmount = '';
		invalidateInvoice();
	}

	function setCustomAmount(value: string) {
		customAmount = value.replace(/[^\d]/g, '').slice(0, 8);
		invalidateInvoice();
	}

	function setComment(value: string) {
		comment = value.slice(0, MAX_COMMENT);
		invalidateInvoice();
	}

	function toggleAnonymous(next: boolean) {
		walletPrefs.toggle('anonymousZaps', next);
		invalidateInvoice();
	}

	/** Back to the amount step from the invoice step. */
	function backToAmounts() {
		invalidateInvoice();
		paying = false;
	}

	/** Receipt matched → mark paid, record, close. Shared by listener paths. */
	function handleReceiptEvent(event: { tags: string[][] }) {
		if (!zapRequestEvent) return;
		const description = event.tags.find((tag) => tag[0] === 'description')?.[1];
		if (!description) return;
		try {
			const receipt = JSON.parse(description) as { id?: string };
			if (receipt.id !== zapRequestEvent.id) return;
			if (!dialogActive) return;
			paid = true;
			receiptConfirmed = true;
			if (zapContext) {
				wallet.recordSent({
					id: sentRecordId,
					amountSats: zapContext.sats,
					recipientPubkey: zapContext.recipient,
					targetNoteId: zapContext.targetEventId,
					memo: zapContext.comment || undefined
				});
			}
			pendingZaps.forget(zapRequestEvent.id);
			onPaid?.(zapContext?.sats ?? amount);
			cleanupReceipt();
			closeAfterPayment();
		} catch {
			/* Ignore malformed receipts. */
		}
	}

	/**
	 * (Re)open the receipt subscription. Called after invoice creation and
	 * again whenever this tab becomes visible: the `lightning:` deeplink
	 * backgrounds the page and the OS kills its WebSockets, so the listener
	 * armed at creation time is usually gone by the time the wallet pays.
	 * Re-subscribing with `since` rooted at invoice creation re-fetches any
	 * receipt the provider published while we were frozen.
	 */
	function relistenForReceipt() {
		if (!zapRequestEvent || paid || !dialogActive) return;
		cleanupReceipt();
		stopReceipt = subscribe(
			[
				{
					kinds: [9735],
					'#p': [recipientPubkey],
					since: Math.max(0, invoiceCreatedAt - RECEIPT_QUERY_SLACK_SEC)
				}
			],
			{ onevent: handleReceiptEvent }
		);
	}

	function onVisibleRelisten() {
		if (document.visibilityState === 'visible') relistenForReceipt();
	}

	async function createInvoice() {
		// Snapshot every component-owned input before the first await so no
		// continuation reads an inert `$derived` value when the dialog's parent
		// chain closes mid-flight.
		const sats = Math.max(1, Math.round(Number(customAmount) || selectedAmount));
		const selectedSats = selectedAmount;
		const zapComment = comment.trim();
		const signingSecret = identity.current?.sk;
		const anonymous = walletPrefs.state.anonymousZaps || !signingSecret;

		if (!hasAddress) {
			error = 'This author has no Lightning address.';
			return;
		}
		loading = true;
		error = '';
		invoice = '';
		paid = false;
		cleanupReceipt();
		try {
			// Remember the chosen amount as the user's new default (YakiHonne-style).
			walletPrefs.setDefaultAmount(selectedSats);
			const outcome = await createZapInvoice(
				{
					recipientPubkey,
					lightningAddress,
					sats,
					comment: zapComment,
					eventId,
					eventKind,
					anonymous
				},
				{
					signingSecretHex: signingSecret,
					ownWritableUrls: relays.writeUrls.slice(0, 3)
				}
			);
			if (!dialogActive) return;
			sentRecordId = outcome.recordId;
			invoice = outcome.invoice;
			isZap = !!outcome.zapRequest;
			zapRequestEvent = outcome.zapRequest;
			invoiceCreatedAt = Math.floor(Date.now() / 1000);
			zapContext = { sats, recipient: recipientPubkey, targetEventId: eventId, comment: zapComment };
			if (zapRequestEvent) {
				pendingZaps.track({
					requestId: zapRequestEvent.id,
					recordId: outcome.recordId,
					recipientPubkey,
					recipientName,
					targetNoteId: eventId,
					sats,
					memo: zapComment || undefined,
					invoice: outcome.invoice
				});
				relistenForReceipt();
			}
			// Keep payment explicit: the user can choose NWC/WebLN or use the QR
			// invoice with another Lightning wallet.
		} catch (e) {
			if (dialogActive)
				error = e instanceof ZapInvoiceError ? e.message : 'Could not prepare the zap.';
		} finally {
			if (dialogActive) loading = false;
		}
	}

	async function copy(text: string, kind: string) {
		if (!text) return;
		await navigator.clipboard.writeText(text);
		copied = kind;
		setTimeout(() => (copied = null), 1800);
	}

	/** Record a successfully-sent zap into the local wallet ledger. */
	function recordSent() {
		wallet.recordSent({
			id: sentRecordId || `${eventId}:${amount}:${Date.now()}`,
			amountSats: amount,
			recipientPubkey,
			targetNoteId: eventId,
			memo: comment.trim() || undefined
		});
	}

	/** Pay the current invoice via the connected wallet (WebLN or NWC). */
	async function payWithWallet() {
		if (!invoice || paid || !hasConnectedWallet()) return;
		try {
			// Do not wake an injected wallet (such as Alby) when the user chose
			// their saved Custom NWC wallet in Lightning settings.
			if (wallet.provider === 'webln' && hasWebLN()) await enableWebLN();
		} catch {
			return; // user declined to enable the wallet — fall back to QR
		}
		paying = true;
		error = '';
		try {
			await payWithWebLN(invoice);
			// A successful WebLN payment is definitive for the local sent history.
			// The receipt listener remains useful for the public NIP-57 confirmation,
			// but relay delays must not hide a completed payment from this ledger.
			paid = true;
			recordSent();
			if (zapRequestEvent) pendingZaps.forget(zapRequestEvent.id);
			onPaid?.(amount);
			void wallet.refreshBalance();
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

	function submitFromInput(e: KeyboardEvent) {
		if (e.key === 'Enter' && !invoice && !loading && hasAddress) {
			e.preventDefault();
			void createInvoice();
		}
	}

	onDestroy(() => {
		dialogActive = false;
		cleanupReceipt();
		document.removeEventListener('visibilitychange', onVisibleRelisten);
	});

	// Re-arm the receipt listener when the user returns from an external
	// wallet. The `lightning:` deeplink freezes this tab and the OS kills its
	// WebSockets — without re-subscribing, the dialog would sit on
	// "Confirming the zap on relays…" forever even though Wall of Satoshi (or
	// any wallet) already paid the invoice while we were backgrounded.
	document.addEventListener('visibilitychange', onVisibleRelisten);
</script>

<Dialog bind:open title={paid ? 'Zap sent' : 'Zap this note'} zIndex={dialogZIndex} onClose={close}>
	<div class="space-y-4">
		<!-- Recipient header -->
		<div class="flex items-center gap-3 rounded-2xl bg-[var(--ui-bg-muted)] p-3">
			<Avatar
				pubkey={recipientPubkey}
				name={recipientName}
				picture={recipientProfile?.picture}
				size={44}
			/>
			<div class="min-w-0 flex-1">
				<p class="truncate text-[14px] font-bold">Zapping {recipientName}</p>
				<p class="truncate font-mono text-[11px] text-[var(--ui-text-muted)]">
					{lightningAddress || shortKey(recipientPubkey)}
				</p>
			</div>
			{#if hasAddress}
				<button
					type="button"
					onclick={() => copy(lightningAddress, 'address')}
					title="Copy Lightning address"
					class="grid size-8 shrink-0 place-items-center rounded-lg text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
				>
					<Icon
						name={copied === 'address' ? 'i-lucide-check' : 'i-lucide-copy'}
						class="size-4 {copied === 'address' ? 'text-accent-600' : ''}"
					/>
				</button>
			{/if}
		</div>

		{#if !hasAddress}
			<!-- No Lightning address: explain instead of failing on submit -->
			<div class="flex flex-col items-center gap-2 py-6 text-center">
				<span
					class="grid size-12 place-items-center rounded-full bg-[var(--tone-warning-bg)] text-[var(--tone-warning-text)]"
				>
					<Icon name="i-lucide-zap-off" class="size-6" />
				</span>
				<p class="text-[14px] font-bold">This author can't receive zaps yet</p>
				<p class="text-[13px] leading-relaxed text-[var(--ui-text-muted)]">
					{recipientName} hasn't set a Lightning address on their Nostr profile.
				</p>
			</div>
		{:else if paid}
			<!-- Success step -->
			<div class="flex flex-col items-center gap-3 py-4 text-center" role="status">
				<span
					class="grid size-14 place-items-center rounded-full bg-[var(--tone-success-bg)] text-[var(--tone-success-text)]"
				>
					<Icon name="i-lucide-check" class="size-8" />
				</span>
				<div>
					<p class="text-[15px] font-bold">
						{amount.toLocaleString()} sats {isZap ? 'zapped' : 'sent'} to {recipientName}
					</p>
					<p class="mt-1 text-[12px] font-semibold text-[var(--ui-text-muted)]">
						{#if isZap && !receiptConfirmed}
							Confirming the zap on relays…
						{:else if isZap}
							Zap confirmed on Nostr
						{:else}
							Invoice paid
						{/if}
					</p>
				</div>
				{#if comment.trim()}
					<p class="max-w-full rounded-xl bg-[var(--ui-bg-muted)] px-3 py-1.5 text-[13px] italic">
						“{comment.trim()}”
					</p>
				{/if}
				<div class="zap-countdown-bar w-full max-w-[260px]"></div>
				<p class="text-[10.5px] text-[var(--ui-text-dimmed)]">Closing…</p>
			</div>
		{:else if invoice}
			<!-- Invoice step -->
			<div class="rounded-2xl bg-[var(--ui-bg-muted)] p-3">
				<p class="mb-2 flex flex-wrap items-center justify-between gap-2 text-[13px] font-bold">
					<span>
						{isZap ? 'Zap invoice ready' : 'Invoice ready'} · {amount.toLocaleString()} sats
					</span>
					<span class="flex items-center gap-2">
						{#if expiryAt > 0 && !expired}
							<span
								class="font-mono text-[11px] font-bold {secondsLeft < 120
									? 'text-[var(--tone-warning-text)]'
									: 'text-[var(--ui-text-muted)]'}"
								><Icon name="i-lucide-timer" class="size-3" />{expiryLabel}</span
							>
						{/if}
						<button
							type="button"
							onclick={backToAmounts}
							class="text-[11px] font-bold text-primary-500 hover:underline"
						>
							Change amount
						</button>
					</span>
				</p>
				{#if expired}
					<div
						class="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--tone-warning-bg)] px-3 py-2 text-[12px] font-semibold text-[var(--tone-warning-text)]"
					>
						<span class="inline-flex items-center gap-1.5">
							<Icon name="i-lucide-timer-off" class="size-4" />Invoice expired — get a fresh one
						</span>
						<button
							type="button"
							onclick={() => void createInvoice()}
							disabled={loading}
							class="rounded-lg bg-[var(--tone-warning-text)] px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-60"
						>
							{loading ? 'Making…' : 'New invoice'}
						</button>
					</div>
				{/if}
				<div class={expired ? 'opacity-40 grayscale' : ''}>
					<QrCode
						value={invoice.toUpperCase()}
						label="Zap invoice QR code for {amount} sats to {recipientName}"
					/>
				</div>
				{#if hasWebLN() && isNwcConnected()}
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
				<div
					class="mt-3 grid gap-2 {hasConnectedWallet()
						? 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)_44px]'
						: 'grid-cols-[minmax(0,1fr)_44px]'}"
				>
					{#if hasConnectedWallet()}
						<button
							type="button"
							onclick={payWithWallet}
							disabled={paying || expired}
							class="inline-flex h-12 min-w-0 items-center justify-center gap-1.5 rounded-lg bg-primary-500 px-2 text-[11px] font-bold whitespace-nowrap text-white transition hover:bg-primary-600 disabled:opacity-60"
						>
							<Icon
								name={paying ? 'i-lucide-loader-circle' : 'i-lucide-wallet'}
								class="size-3.5 {paying ? 'animate-spin' : ''}"
							/>{paying ? 'Paying…' : `Pay with ${wallet.provider === 'nwc' ? 'NWC' : 'browser'}`}
						</button>
					{/if}
					<a
						href={`lightning:${invoice}`}
						title="Open this invoice in another Lightning wallet"
						class="inline-flex h-12 min-w-0 items-center justify-center gap-1.5 rounded-lg bg-warm-500 px-2 text-[11px] font-bold whitespace-nowrap text-white transition hover:bg-warm-600"
					>
						<Icon name="i-lucide-scan-line" class="size-3.5" />Open wallet
					</a>
					<button
						type="button"
						onclick={() => copy(invoice, 'invoice')}
						aria-label={copied === 'invoice' ? 'Invoice copied' : 'Copy invoice'}
						title={copied === 'invoice' ? 'Invoice copied' : 'Copy invoice'}
						class="inline-flex size-11 items-center justify-center self-center rounded-lg border border-[var(--ui-border-muted)] text-[var(--ui-text-muted)] transition hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
					>
						<Icon
							name={copied === 'invoice' ? 'i-lucide-check' : 'i-lucide-copy'}
							class="size-4 {copied === 'invoice' ? 'text-accent-600' : ''}"
						/>
					</button>
				</div>
				{#if walletBalance !== null}
					<p
						class="mt-2 flex items-center justify-center gap-1 text-[10.5px] font-semibold text-[var(--ui-text-dimmed)]"
					>
						<Icon name="i-lucide-wallet" class="size-3" />
						Wallet balance: {walletBalance.toLocaleString()} sats
					</p>
				{/if}
				{#if isZap}
					<p class="mt-2 text-center text-[10.5px] text-[var(--ui-text-dimmed)]">
						Listening for the zap receipt on Nostr…
					</p>
				{:else}
					<p class="mt-2 text-center text-[10.5px] text-[var(--ui-text-dimmed)]">
						This payment will not appear in the public zap total because the recipient does not
						support zap receipts.
					</p>
				{/if}

				<!-- Protocol transparency: verify exactly what is signed and paid. -->
				<details class="group mt-3 rounded-xl border border-[var(--ui-border-muted)]">
					<summary
						class="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-[11.5px] font-bold text-[var(--ui-text-muted)] select-none hover:text-[var(--ui-text)]"
					>
						<Icon name="i-lucide-shield-check" class="size-3.5" />
						Verify this zap
						<Icon name="i-lucide-chevron-down" class="size-3.5 transition group-open:rotate-180" />
					</summary>
					<dl class="space-y-1 border-t border-[var(--ui-border-muted)] px-3 py-2.5">
						{#snippet row(label: string, value: string, key: string)}
							<div class="flex items-baseline justify-between gap-3">
								<dt
									class="shrink-0 font-mono text-[10px] tracking-wide text-[var(--ui-text-dimmed)] uppercase"
								>
									{label}
								</dt>
								<dd class="flex min-w-0 items-center gap-1.5">
									<span class="truncate font-mono text-[10.5px] text-[var(--ui-text-muted)]"
										>{value}</span
									>
									{#if key}
										<button
											type="button"
											onclick={() => copy(value, key)}
											title="Copy {label}"
											class="shrink-0 text-[var(--ui-text-dimmed)] transition hover:text-[var(--ui-text)]"
										>
											<Icon
												name={copied === key ? 'i-lucide-check' : 'i-lucide-copy'}
												class="size-3 {copied === key ? 'text-accent-600' : ''}"
											/>
										</button>
									{/if}
								</dd>
							</div>
						{/snippet}
						{@render row('recipient', shortKey(recipientNpub, 10, 8), recipientNpub)}
						{@render row('note', shortKey(eventId, 10, 8), eventId)}
						{@render row(
							'amount',
							`${amount.toLocaleString()} sats · ${(amount * 1000).toLocaleString()} msat`,
							''
						)}
						{@render row(
							'sender',
							zapRequestEvent && zapRequestEvent.pubkey === identity.current?.pk
								? shortKey(identity.current?.npub ?? '', 10, 8)
								: 'anonymous (ephemeral key)',
							''
						)}
						{#if comment.trim()}{@render row('message', comment.trim(), '')}{/if}
						{#if zapRequestEvent}
							{@render row(
								'relays',
								`${relays.urls.length} relays · receipt published as kind 9735`,
								''
							)}
						{/if}
						{@render row('invoice', `${invoice.slice(0, 24)}…`, invoice)}
					</dl>
					<p
						class="border-t border-[var(--ui-border-muted)] px-3 py-2 text-[10px] leading-relaxed text-[var(--ui-text-dimmed)]"
					>
						Self-custodial: sats move peer-to-peer over Lightning. BitOS never holds your funds or
						your keys.
					</p>
				</details>
			</div>
		{:else}
			<!-- Amount step -->
			<div class="grid grid-cols-4 gap-2">
				{#each amounts as sats, index (index)}
					<button
						type="button"
						aria-pressed={selectedAmount === sats && !customAmount}
						onclick={() => selectAmount(sats)}
						class="flex flex-col items-center gap-0.5 rounded-xl border px-1 py-2.5 transition {selectedAmount ===
							sats && !customAmount
							? 'border-warm-500 bg-warm-500/10 text-warm-600'
							: 'border-[var(--ui-border-muted)] hover:border-warm-500/40'}"
					>
						<span class="text-base leading-none">{zapEmoji(sats)}</span>
						<span class="text-[13px] leading-tight font-bold">{sats.toLocaleString()}</span>
						<span class="text-[9.5px] font-semibold tracking-wide uppercase opacity-60">sats</span>
					</button>
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
					onkeydown={submitFromInput}
					placeholder="Custom sats amount"
					class="min-w-0 flex-1 bg-transparent text-[13px] font-semibold outline-none placeholder:text-[var(--ui-text-dimmed)]"
				/>
				{#if customAmount}<span class="text-base">{zapEmoji(amount)}</span>{/if}
			</label>
			<label
				class="flex items-start gap-2 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3 py-2"
			>
				<Icon name="i-lucide-message-circle" class="mt-0.5 size-4 text-[var(--ui-text-dimmed)]" />
				<div class="min-w-0 flex-1">
					<input
						aria-label="Zap message"
						type="text"
						maxlength={MAX_COMMENT}
						value={comment}
						oninput={(e) => setComment(e.currentTarget.value)}
						onkeydown={submitFromInput}
						placeholder="Say something nice (optional)"
						class="w-full bg-transparent text-[13px] font-semibold outline-none placeholder:text-[var(--ui-text-dimmed)]"
					/>
					{#if comment}
						<p class="mt-0.5 text-right text-[10px] text-[var(--ui-text-dimmed)]">
							{comment.length}/{MAX_COMMENT}
						</p>
					{/if}
				</div>
			</label>
			{#if identity.current}
				<div
					class="flex items-center justify-between gap-3 rounded-xl border border-[var(--ui-border-muted)] px-3 py-2"
				>
					<div class="flex items-center gap-2">
						<Icon
							name={walletPrefs.state.anonymousZaps ? 'i-lucide-eye-off' : 'i-lucide-user-round'}
							class="size-4 text-[var(--ui-text-dimmed)]"
						/>
						<div>
							<p class="text-[12.5px] font-bold">Anonymous zap</p>
							<p class="text-[10.5px] text-[var(--ui-text-muted)]">
								Hide your profile on the public receipt
							</p>
						</div>
					</div>
					<Toggle
						checked={walletPrefs.state.anonymousZaps}
						onToggle={toggleAnonymous}
						label="Send this zap anonymously"
					/>
				</div>
			{:else}
				<p class="flex items-center gap-1.5 px-1 text-[10.5px] text-[var(--ui-text-dimmed)]">
					<Icon name="i-lucide-eye-off" class="size-3" />Zaps sent while signed out are anonymous.
				</p>
			{/if}
		{/if}

		{#if error}<p
				role="alert"
				class="rounded-xl bg-[var(--tone-warning-bg)] px-3 py-2 text-[12px] font-semibold text-[var(--tone-warning-text)]"
			>
				{error}
			</p>{/if}
	</div>
	{#snippet footer()}
		<button
			type="button"
			onclick={close}
			class="rounded-lg px-3 py-2 text-[12px] font-bold text-[var(--ui-text-muted)] hover:bg-[var(--interactive-hover-bg)]"
		>
			{paid ? 'Done' : 'Close'}
		</button>
		{#if !invoice && !paid && hasAddress}
			<button
				type="button"
				onclick={createInvoice}
				disabled={loading}
				class="inline-flex items-center gap-1.5 rounded-lg bg-warm-500 px-4 py-2 text-[12px] font-bold text-white transition hover:bg-warm-600 disabled:opacity-60"
			>
				<Icon
					name={loading ? 'i-lucide-loader-circle' : 'i-lucide-zap'}
					class="size-3.5 {loading ? 'animate-spin' : ''}"
				/>{loading
					? 'Preparing…'
					: `Zap ${zapEmoji(amount)} ${amount.toLocaleString()} sats`}</button
			>
		{/if}
	{/snippet}
</Dialog>

<style>
	/* Thin countdown bar shown during the auto-close success window. */
	.zap-countdown-bar {
		height: 3px;
		border-radius: 9999px;
		background: color-mix(in oklab, var(--tone-success-text) 22%, transparent);
		overflow: hidden;
		position: relative;
	}
	.zap-countdown-bar::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: 9999px;
		background: var(--tone-success-text);
		transform-origin: left;
		animation: zap-countdown var(--zap-close-ms, 2400ms) linear forwards;
	}
	@keyframes zap-countdown {
		from {
			transform: scaleX(1);
		}
		to {
			transform: scaleX(0);
		}
	}
</style>
