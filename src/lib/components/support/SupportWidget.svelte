<script lang="ts">
	import { onMount } from 'svelte';
	import { decode, encodeBytes } from 'nostr-tools/nip19';
	import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
	import Icon from '$lib/components/ui/Icon.svelte';
	import QrCode from '$lib/components/ui/QrCode.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { relays } from '$lib/nostr/relays.svelte';
	import { subscribe } from '$lib/nostr/pool';
	import { hexToBytes } from '$lib/nostr/hex';
	import { shortKey } from '$lib/utils/format';

	type Props = { compact?: boolean };
	let { compact = false }: Props = $props();

	const SUPPORT_NPUB = 'npub12l8q8wph9ygk0hv00pf8g558pvftr0hav2r8npfq66nm04sswnwsylp57e';
	const tiers = [
		{ label: 'Coffee', sats: 1000, note: 'A small thank-you' },
		{ label: 'Expert', sats: 5000, note: 'Keep the craft sharp', recommended: true },
		{ label: 'Production', sats: 21000, note: 'Help ship the next release' },
		{ label: 'Premium', sats: 100000, note: 'Back BitOS at scale' }
	];

	let pubkey = $state('');
	let selectedSats = $state(5000);
	let customSats = $state('');
	let invoice = $state('');
	let error = $state('');
	let loadingProfile = $state(true);
	let loadingInvoice = $state(false);
	let copied = $state(false);
	let paid = $state(false);
	let isZap = $state(false);
	let stopReceipt = $state<(() => void) | undefined>(undefined);

	const profile = $derived(pubkey ? profiles.get(pubkey) : undefined);
	const lightningAddress = $derived(profile?.lud16 || profile?.lud06 || '');
	const displayName = $derived(profile?.display_name || profile?.name || 'BitOS supporter');
	const amount = $derived(Math.max(1, Math.round(Number(customSats) || selectedSats)));

	onMount(() => {
		try {
			const decoded = decode(SUPPORT_NPUB);
			if (decoded.type !== 'npub') throw new Error('Invalid support npub');
			pubkey = decoded.data as string;
			void profiles.refresh([pubkey]).finally(() => (loadingProfile = false));
		} catch {
			loadingProfile = false;
			error = 'The support profile could not be decoded.';
		}
		return () => stopReceipt?.();
	});

	function selectTier(sats: number) {
		selectedSats = sats;
		customSats = '';
		invoice = '';
		error = '';
		paid = false;
	}

	function setCustomAmount(value: string) {
		customSats = value.replace(/[^\d]/g, '').slice(0, 8);
		invoice = '';
		error = '';
		paid = false;
	}

	async function requestInvoice() {
		if (!lightningAddress) {
			error = loadingProfile
				? 'Loading the support profile…'
				: 'This Nostr profile has not published a Lightning address yet.';
			return;
		}
		loadingInvoice = true;
		error = '';
		invoice = '';
		paid = false;
		isZap = false;
		stopReceipt?.();
		stopReceipt = undefined;
		try {
			const [user, domain] = lightningAddress.split('@');
			if (!user || !domain || lightningAddress.includes('://')) {
				throw new Error('The published Lightning address is not a valid LN address.');
			}
			const metadataResponse = await fetch(
				`https://${domain}/.well-known/lnurlp/${encodeURIComponent(user)}`
			);
			if (!metadataResponse.ok) throw new Error('Could not reach the Lightning address provider.');
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
				throw new Error(
					`The minimum supported amount is ${Math.ceil(metadata.minSendable / 1000)} sats.`
				);
			}
			if (metadata.maxSendable && millisats > metadata.maxSendable) {
				throw new Error(
					`The maximum supported amount is ${Math.floor(metadata.maxSendable / 1000)} sats.`
				);
			}
			const callback = new URL(metadata.callback);
			callback.searchParams.set('amount', String(millisats));
			const supportsZap = metadata.allowsNostr === true && metadata.nostrPubkey === pubkey;
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
							['p', pubkey]
						]
					},
					identity.current?.sk ? hexToBytes(identity.current.sk) : generateSecretKey()
				);
				callback.searchParams.set('nostr', JSON.stringify(zapRequest));
				callback.searchParams.set(
					'lnurl',
					encodeBytes(
						'lnurl',
						new TextEncoder().encode(
							`https://${domain}/.well-known/lnurlp/${encodeURIComponent(user)}`
						)
					)
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
				throw new Error(payment.reason || 'The provider returned no invoice.');
			invoice = payment.pr;
			isZap = !!zapRequest;
			if (zapRequest) {
				const requestId = zapRequest.id;
				stopReceipt = subscribe(
					[{ kinds: [9735], '#p': [pubkey], since: Math.floor(Date.now() / 1000) - 120 }],
					{
						onevent: (event) => {
							const description = event.tags.find((tag) => tag[0] === 'description')?.[1];
							if (!description) return;
							try {
								const receipt = JSON.parse(description) as { id?: string };
								if (receipt.id !== requestId) return;
								paid = true;
								stopReceipt?.();
								stopReceipt = undefined;
							} catch {
								/* Ignore malformed zap receipts. */
							}
						}
					}
				);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not prepare the donation.';
		} finally {
			loadingInvoice = false;
		}
	}

	async function copyInvoice() {
		if (!invoice) return;
		await navigator.clipboard.writeText(invoice);
		copied = true;
		setTimeout(() => (copied = false), 1800);
	}
</script>

<section
	class="surface-card overflow-hidden rounded-2xl border border-[var(--ui-border-muted)] {compact
		? 'p-4'
		: 'p-5 sm:p-6'}"
>
	<div class="flex items-start gap-3">
		<div class="grid size-11 shrink-0 place-items-center rounded-2xl bg-warm-500/12 text-warm-600">
			<Icon name="i-lucide-coffee" class="size-5" />
		</div>
		<div class="min-w-0 flex-1">
			<div class="flex flex-wrap items-center gap-2">
				<h2 class="font-display text-[18px] font-extrabold tracking-tight">Support BitOS</h2>
				<span class="rounded-full bg-warm-500/10 px-2 py-0.5 text-[10px] font-bold text-warm-600"
					>100% peer-to-peer</span
				>
			</div>
			<p class="mt-1 text-[12.5px] leading-relaxed text-[var(--ui-text-muted)]">
				{#if loadingProfile}Finding the support profile on Nostr…{:else}Send sats directly to {displayName}.
					No account, ads, or middleman.{/if}
			</p>
		</div>
	</div>

	<div class="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
		{#each tiers as tier (tier.label)}
			<button
				type="button"
				onclick={() => selectTier(tier.sats)}
				class="relative rounded-xl border p-3 text-left transition {selectedSats === tier.sats &&
				!customSats
					? 'border-primary-500 bg-primary-500/8 shadow-[var(--glow-primary)]'
					: 'border-[var(--ui-border-muted)] hover:border-primary-500/40'}"
			>
				{#if tier.recommended}<span
						class="absolute -top-2 right-2 rounded-full bg-primary-500 px-1.5 py-0.5 text-[9px] font-bold text-white"
						>Recommended</span
					>{/if}
				<span class="block text-[12px] font-bold">{tier.label}</span>
				<span class="mt-1 block font-mono text-[13px] font-bold text-primary-500"
					>{tier.sats.toLocaleString()} sats</span
				>
				<span class="mt-1 block text-[10px] leading-tight text-[var(--ui-text-dimmed)]"
					>{tier.note}</span
				>
			</button>
		{/each}
	</div>

	<div class="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
		<label
			class="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--ui-bg-muted)] px-3 py-2"
		>
			<Icon name="i-lucide-pencil" class="size-4 text-[var(--ui-text-dimmed)]" />
			<input
				aria-label="Custom sats amount"
				type="text"
				inputmode="numeric"
				value={customSats}
				oninput={(e) => setCustomAmount(e.currentTarget.value)}
				placeholder="Custom amount in sats"
				class="min-w-0 flex-1 bg-transparent text-[13px] font-semibold outline-none placeholder:text-[var(--ui-text-dimmed)]"
			/>
		</label>
		<button
			type="button"
			onclick={requestInvoice}
			disabled={loadingInvoice || loadingProfile}
			class="inline-flex items-center justify-center gap-2 rounded-xl bg-warm-500 px-4 py-2.5 text-[12.5px] font-bold text-white transition hover:bg-warm-600 disabled:cursor-not-allowed disabled:opacity-60"
		>
			<Icon
				name={loadingInvoice ? 'i-lucide-loader-circle' : 'i-lucide-zap'}
				class="size-4 {loadingInvoice ? 'animate-spin' : ''}"
			/>
			{loadingInvoice ? 'Preparing…' : `Support with ${amount.toLocaleString()} sats`}
		</button>
	</div>

	{#if error}<p
			role="alert"
			class="mt-3 rounded-xl bg-[var(--tone-warning-bg)] px-3 py-2 text-[11.5px] font-semibold text-[var(--tone-warning-text)]"
		>
			{error}
		</p>{/if}

	{#if invoice}
		<div
			class="mt-4 grid gap-4 rounded-2xl bg-[var(--ui-bg-muted)] p-4 sm:grid-cols-[auto_1fr] sm:items-center"
		>
			<QrCode value={invoice.toUpperCase()} label="Lightning invoice QR code" />
			<div class="min-w-0">
				<p class="flex items-center gap-2 text-[13px] font-bold">
					{#if paid}
						<span
							class="grid size-5 place-items-center rounded-full bg-accent-500/15 text-accent-600"
							><Icon name="i-lucide-check" class="size-3.5" /></span
						>
						Zap paid · {amount.toLocaleString()} sats
					{:else}
						{isZap ? 'Zap invoice ready' : 'Invoice ready'} · {amount.toLocaleString()} sats
					{/if}
				</p>
				<p class="mt-1 text-[11.5px] text-[var(--ui-text-muted)]">
					{#if paid}Payment confirmed by a Nostr zap receipt.{:else}Scan with any Lightning wallet,
						or open it directly on this device.{/if}
				</p>
				<div class="mt-3 flex flex-wrap gap-2">
					<a
						href={`lightning:${invoice}`}
						class="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-2 text-[11.5px] font-bold text-white hover:bg-primary-600"
						><Icon name="i-lucide-wallet-cards" class="size-3.5" />Open wallet</a
					>
					<button
						type="button"
						onclick={copyInvoice}
						class="inline-flex items-center gap-1.5 rounded-lg border border-[var(--ui-border-muted)] px-3 py-2 text-[11.5px] font-bold"
						><Icon name={copied ? 'i-lucide-check' : 'i-lucide-copy'} class="size-3.5" />{copied
							? 'Copied'
							: 'Copy invoice'}</button
					>
				</div>
				<p class="mt-3 truncate font-mono text-[10px] text-[var(--ui-text-dimmed)]">
					{shortKey(invoice, 18, 12)}
				</p>
				{#if isZap && !paid}<p class="mt-2 text-[10.5px] text-[var(--ui-text-dimmed)]">
						Listening for the payment receipt on Nostr…
					</p>{/if}
			</div>
		</div>
	{/if}

	<p class="mt-4 text-[10.5px] text-[var(--ui-text-dimmed)]">
		Powered by Nostr profile metadata · Lightning payments are final.
	</p>
</section>
