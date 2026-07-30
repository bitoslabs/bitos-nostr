<script lang="ts">
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import QrCode from '$lib/components/ui/QrCode.svelte';
	import { feed } from '$lib/nostr/feed.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { blocks } from '$lib/stores/blocks.svelte';
	import { popovers } from '$lib/stores/popovers.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';

	let {
		pubkey,
		npub,
		lightning = ''
	}: { pubkey: string; npub: string; lightning?: string } = $props();

	const menuId = $derived(`profile-actions:${pubkey}`);
	const menuOpen = $derived(popovers.isOpen(menuId));
	const profileLink = $derived(`nostr:${npub}`);
	const lightningValue = $derived(lightning ? `lightning:${lightning}` : '');
	const isBlocked = $derived(blocks.has(pubkey));
	let qrOpen = $state(false);
	let qrTitle = $state('');
	let qrValue = $state('');
	let qrCopyLabel = $state('');

	async function copy(value: string, label: string) {
		try {
			await navigator.clipboard.writeText(value);
			toasts.success(`${label} copied`);
		} catch {
			toasts.error(`Could not copy ${label.toLowerCase()}`);
		} finally {
			popovers.close();
		}
	}

	function showQr(title: string, value: string, copyLabel: string) {
		qrTitle = title;
		qrValue = value;
		qrCopyLabel = copyLabel;
		qrOpen = true;
		popovers.close();
	}

	function blockUser() {
		if (pubkey === identity.current?.pk) {
			toasts.warning("You can't block yourself");
			popovers.close();
			return;
		}
		if (feed.blockAuthor(pubkey)) toasts.success('User blocked locally');
		else toasts.info('User already blocked');
		popovers.close();
	}

	function unblockUser() {
		if (blocks.unblock(pubkey)) toasts.success('User unblocked');
		else toasts.info('User is not blocked');
		popovers.close();
	}
</script>

<div class="relative">
	<button
		type="button"
		onclick={(event) => {
			event.stopPropagation();
			popovers.toggle(menuId);
		}}
		class="grid size-10 place-items-center rounded-full border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] text-[var(--ui-text-muted)] transition hover:text-primary-500"
		aria-label="Profile actions"
		aria-expanded={menuOpen}
	>
		<Icon name="i-lucide-ellipsis" class="size-5" />
	</button>

	{#if menuOpen}
		<div
			class="absolute right-0 bottom-12 z-30 w-56 rounded-xl border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] p-1.5 shadow-[var(--shadow-pop)] sm:top-12 sm:bottom-auto"
		>
			<button
				type="button"
				onclick={() => copy(profileLink, 'Profile link')}
				class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
			>
				<Icon name="i-lucide-link" class="size-4 shrink-0" />
				Copy profile link
			</button>
			<button
				type="button"
				onclick={() => copy(npub, 'npub')}
				class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
			>
				<Icon name="i-lucide-fingerprint" class="size-4 shrink-0" />
				Copy npub
			</button>
			<button
				type="button"
				onclick={() => showQr('Profile QR', profileLink, 'Profile link')}
				class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
			>
				<Icon name="i-lucide-qr-code" class="size-4 shrink-0" />
				Show profile QR
			</button>
			{#if lightning}
				<div class="my-1 h-px bg-[var(--ui-border-muted)]"></div>
				<button
					type="button"
					onclick={() => copy(lightning, 'Lightning address')}
					class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
				>
					<Icon name="i-lucide-zap" class="size-4 shrink-0" />
					Copy LN
				</button>
				<button
					type="button"
					onclick={() => showQr('Lightning QR', lightningValue, 'Lightning address')}
					class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
				>
					<Icon name="i-lucide-qr-code" class="size-4 shrink-0" />
					Show LN QR
				</button>
			{/if}
			{#if pubkey !== identity.current?.pk}
				<div class="my-1 h-px bg-[var(--ui-border-muted)]"></div>
				{#if isBlocked}
					<button
						type="button"
						onclick={unblockUser}
						class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[var(--ui-text-muted)] transition-colors hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]"
					>
						<Icon name="i-lucide-circle-off" class="size-4 shrink-0" />
						Unblock user
					</button>
				{:else}
					<button
						type="button"
						onclick={blockUser}
						class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold text-[var(--tone-error-text)] transition-colors hover:bg-[var(--tone-error-bg)]"
					>
						<Icon name="i-lucide-ban" class="size-4 shrink-0" />
						Block user
					</button>
				{/if}
			{/if}
		</div>
	{/if}
</div>

<Dialog bind:open={qrOpen} title={qrTitle}>
	<div class="space-y-3 text-center">
		<QrCode value={qrValue} label={qrTitle} />
		<p class="font-mono text-[12px] break-all text-[var(--ui-text-muted)]">{qrValue}</p>
		<button
			type="button"
			onclick={() => copy(qrTitle === 'Lightning QR' ? lightning : qrValue, qrCopyLabel)}
			class="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-3 py-2 text-[12px] font-bold text-white transition hover:bg-primary-600"
		>
			<Icon name="i-lucide-copy" class="size-4" />
			Copy to clipboard
		</button>
	</div>
</Dialog>
