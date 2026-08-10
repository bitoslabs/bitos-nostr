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
	const amounts = [21, 100, 1000, 5000];
	let selectedAmount = $state(100);
	let customAmount = $state('');
	let invoice = $state('');
	let error = $state('');
	let loading = $state(false);
	let paid = $state(false);
	let isZap = $state(false);
	let copied = $state(false);
	let stopReceipt: (() => void) | undefined;

	const amount = $derived(Math.max(1, Math.round(Number(customAmount) || selectedAmount)));

	function cleanupReceipt() {
		stopReceipt?.();
		stopReceipt = undefined;
	}

	function reset() {
		cleanupReceipt();
		invoice = '';
		error = '';
		paid = false;
		isZap = false;
		copied = false;
	}

	function close() {
		open = false;
		reset();
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
			}
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
								onPaid?.(amount);
								cleanupReceipt();
							} catch {
								/* Ignore malformed receipts. */
							}
						}
					}
				);
			}
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

	onDestroy(cleanupReceipt);
</script>

<Dialog bind:open title="Zap this note" onClose={close}>
	<div class="space-y-4">
		<p class="text-[13px] leading-relaxed text-[var(--ui-text-muted)]">
			Send sats directly to the author. When supported, this creates a NIP-57 zap linked to this
			note.
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
						<Icon name="i-lucide-check" class="size-4" /> Zap paid · {amount.toLocaleString()} sats
					</p>{:else}<p class="mb-2 text-[13px] font-bold">
						{isZap ? 'Zap invoice ready' : 'Invoice ready'} · {amount.toLocaleString()} sats
					</p>{/if}
				<QrCode value={invoice.toUpperCase()} label="Zap invoice QR code" />
				<div class="mt-3 flex gap-2">
					<a
						href={`lightning:${invoice}`}
						class="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-warm-500 px-3 py-2 text-[12px] font-bold text-white hover:bg-warm-600"
						><Icon name="i-lucide-wallet-cards" class="size-3.5" />Open wallet</a
					>
					<button
						type="button"
						onclick={copyInvoice}
						class="inline-flex items-center gap-1.5 rounded-lg border border-[var(--ui-border-muted)] px-3 py-2 text-[12px] font-bold"
						><Icon name={copied ? 'i-lucide-check' : 'i-lucide-copy'} class="size-3.5" />{copied
							? 'Copied'
							: 'Copy'}</button
					>
				</div>
				{#if isZap && !paid}<p class="mt-2 text-[10.5px] text-[var(--ui-text-dimmed)]">
						Listening for the zap receipt on Nostr…
					</p>{/if}
				{#if !isZap}<p class="mt-2 text-[10.5px] text-[var(--ui-text-dimmed)]">
						This provider does not support Nostr zap receipts, so this payment will not appear in
						the public zap total.
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
				/>{loading ? 'Preparing…' : paid ? 'Paid' : `Zap ${amount.toLocaleString()} sats`}</button
			>{/if}
	{/snippet}
</Dialog>
