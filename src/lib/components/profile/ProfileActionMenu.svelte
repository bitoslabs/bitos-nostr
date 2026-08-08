<script lang="ts">
	import Dialog from '$lib/components/ui/Dialog.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import QrCode from '$lib/components/ui/QrCode.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import MenuItem from '$lib/components/ui/MenuItem.svelte';
	import MenuDivider from '$lib/components/ui/MenuDivider.svelte';
	import { feed } from '$lib/nostr/feed.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { blocks } from '$lib/stores/blocks.svelte';
	import { mutes } from '$lib/stores/mutes.svelte';
	import { finalizeEvent } from 'nostr-tools/pure';
	import { hexToBytes } from '$lib/nostr/hex';
	import { publish } from '$lib/nostr/pool';
	import { NOSTR_KINDS } from '$lib/nostr/types';
	import { popovers } from '$lib/stores/popovers.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';

	let {
		pubkey,
		npub,
		lightning = ''
	}: { pubkey: string; npub: string; lightning?: string } = $props();

	const menuId = $derived(`profile-actions:${pubkey}`);
	const profileLink = $derived(`nostr:${npub}`);
	const lightningValue = $derived(lightning ? `lightning:${lightning}` : '');
	const isBlocked = $derived(blocks.has(pubkey));
	const isMuted = $derived(mutes.has(pubkey));
	let qrOpen = $state(false);
	let qrTitle = $state('');
	let qrValue = $state('');
	let qrCopyLabel = $state('');
	let reportOpen = $state(false);
	let reportReason = $state<'spam' | 'impersonation' | 'illegal' | 'profanity' | 'other'>('spam');
	let reportPending = $state(false);

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

	function muteUser() {
		if (mutes.mute(pubkey)) {
			feed.muteAuthor(pubkey);
			toasts.success('User muted locally');
		} else toasts.info('User is already muted');
		popovers.close();
	}

	function unmuteUser() {
		if (mutes.unmute(pubkey)) toasts.success('User unmuted');
		else toasts.info('User is not muted');
		popovers.close();
	}

	async function submitReport() {
		const me = identity.current;
		if (!me || reportPending) return;
		reportPending = true;
		try {
			const event = finalizeEvent(
				{
					kind: NOSTR_KINDS.REPORT,
					content: '',
					created_at: Math.floor(Date.now() / 1000),
					tags: [['p', pubkey, reportReason]]
				},
				hexToBytes(me.sk)
			);
			await publish(event);
			toasts.success('Report submitted');
			reportOpen = false;
		} catch (error) {
			toasts.error((error as Error).message || 'Could not submit report');
		} finally {
			reportPending = false;
		}
	}
</script>

<Popover
	id={menuId}
	placement="bottom-end"
	label="Profile actions"
	triggerClass="grid size-10 place-items-center rounded-full border border-[var(--ui-border-muted)] bg-[var(--surface-bg)] text-[var(--ui-text-muted)] transition hover:text-primary-500"
>
	{#snippet trigger()}
		<Icon name="i-lucide-ellipsis" class="size-5" />
	{/snippet}

	<MenuItem icon="i-lucide-link" onclick={() => copy(profileLink, 'Profile link')}>
		Copy profile link
	</MenuItem>
	<MenuItem icon="i-lucide-fingerprint" onclick={() => copy(npub, 'npub')}>Copy npub</MenuItem>
	<MenuItem
		icon="i-lucide-qr-code"
		onclick={() => showQr('Profile QR', profileLink, 'Profile link')}
	>
		Show profile QR
	</MenuItem>

	{#if lightning}
		<MenuDivider />
		<MenuItem icon="i-lucide-zap" onclick={() => copy(lightning, 'Lightning address')}>
			Copy LN
		</MenuItem>
		<MenuItem
			icon="i-lucide-qr-code"
			onclick={() => showQr('Lightning QR', lightningValue, 'Lightning address')}
		>
			Show LN QR
		</MenuItem>
	{/if}

	{#if pubkey !== identity.current?.pk}
		<MenuDivider />
		{#if isMuted}
			<MenuItem icon="i-lucide-volume-2" onclick={unmuteUser}>Unmute user</MenuItem>
		{:else}
			<MenuItem icon="i-lucide-volume-x" onclick={muteUser}>Mute user</MenuItem>
		{/if}
		<MenuItem
			tone="danger"
			icon="i-lucide-flag"
			onclick={() => {
				reportOpen = true;
				popovers.close();
			}}
		>
			Report user
		</MenuItem>
		{#if isBlocked}
			<MenuItem icon="i-lucide-circle-off" onclick={unblockUser}>Unblock user</MenuItem>
		{:else}
			<MenuItem tone="danger" icon="i-lucide-ban" onclick={blockUser}>Block user</MenuItem>
		{/if}
	{/if}
</Popover>

<Dialog bind:open={reportOpen} title="Report user">
	<div class="space-y-4">
		<p class="text-[13px] leading-relaxed text-[var(--ui-text-muted)]">
			Choose the reason for reporting this profile. Your signed report will be published to your
			configured relays.
		</p>
		<label class="block space-y-1.5 text-[12px] font-semibold">
			<span>Reason</span>
			<select bind:value={reportReason} class="input w-full">
				<option value="spam">Spam</option>
				<option value="impersonation">Impersonation</option>
				<option value="illegal">Illegal content</option>
				<option value="profanity">Profanity</option>
				<option value="other">Other</option>
			</select>
		</label>
	</div>
	{#snippet footer()}
		<Button color="neutral" variant="ghost" onclick={() => (reportOpen = false)}>Cancel</Button>
		<Button
			color="error"
			icon={reportPending ? 'i-lucide-loader-circle' : 'i-lucide-flag'}
			disabled={reportPending}
			onclick={() => void submitReport()}
		>
			{reportPending ? 'Submitting…' : 'Submit report'}
		</Button>
	{/snippet}
</Dialog>

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
