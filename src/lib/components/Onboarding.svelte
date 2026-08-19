<script lang="ts">
	import { goto } from '$app/navigation';
	import { generateSecretKey } from 'nostr-tools/pure';
	import { nsecEncode } from 'nostr-tools/nip19';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { relays } from '$lib/nostr/relays.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import HexMark from '$lib/components/ui/HexMark.svelte';
	import { bytesToHex, hexToBytes } from '$lib/nostr/hex';

	let mode = $state<'intro' | 'create' | 'import'>('intro');
	let secret = $state('');
	let busy = $state(false);
	let createdNsec = $state<string | null>(null);
	let createdSkHex = $state<string | null>(null);
	let copied = $state(false);

	function create() {
		busy = true;
		try {
			const skHex = bytesToHex(generateSecretKey());
			createdSkHex = skHex;
			createdNsec = nsecEncode(hexToBytes(skHex));
			toasts.success('New Nostr identity generated');
		} catch (e) {
			toasts.error((e as Error).message);
		} finally {
			busy = false;
		}
	}

	async function finishCreate() {
		if (!createdSkHex) return;
		identity.importSecret(createdSkHex);
		relays.load();
		await goto('/');
	}

	async function doImport() {
		busy = true;
		try {
			identity.importSecret(secret);
			relays.load();
			toasts.success('Identity imported');
			await goto('/');
		} catch (e) {
			toasts.error((e as Error).message);
		} finally {
			busy = false;
		}
	}

	async function copyNsec() {
		if (!createdNsec) return;
		await navigator.clipboard.writeText(createdNsec);
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}

	$effect(() => {
		if (!identity.ready || !identity.current) return;
		if (mode === 'create' && createdNsec) return;
		void goto('/');
	});
</script>

<div class="grid min-h-screen place-items-center p-5">
	<div class="w-full max-w-md">
		<!-- Brand -->
		<div class="mb-7 flex flex-col items-center text-center">
		    <HexMark size={64} class="rounded-[22%]" />
			<h1 class="font-display text-[26px] font-bold tracking-tight">Welcome to BitOS</h1>
			<p class="mt-1.5 text-[13.5px] text-[var(--ui-text-muted)]">
				A local-first Nostr client. Your keys never leave this device.
			</p>
		</div>

		<div class="surface-card p-5">
			{#if mode === 'intro'}
				<div class="space-y-2.5">
					<Button
						block
						size="md"
						color="primary"
						icon="i-lucide-sparkles"
						onclick={() => {
							create();
							mode = 'create';
						}}
						disabled={busy}
					>
						Create a new identity
					</Button>
					<Button
						block
						size="md"
						color="neutral"
						variant="subtle"
						icon="i-lucide-key-round"
						onclick={() => (mode = 'import')}
					>
						I already have a key
					</Button>
				</div>
				<p
					class="mt-4 flex items-start gap-2 rounded-lg bg-[var(--ui-bg-muted)] p-3 text-[12px] leading-relaxed text-[var(--ui-text-muted)]"
				>
					<Icon
						name="i-lucide-shield-check"
						class="mt-0.5 size-4 shrink-0 text-primary-600 dark:text-primary-400"
					/>
					BitOS is decentralized. There's no signup — your
					<span class="font-semibold">private key</span> <em>is</em> your account. Back it up somewhere
					safe; we can't recover it.
				</p>
			{:else if mode === 'create' && createdNsec}
				<div class="space-y-4">
					<div>
						<p class="mb-1.5 block text-[12px] font-semibold text-[var(--ui-text-muted)]">
							Your private key (nsec) — back this up
						</p>
						<div class="flex gap-2">
							<Input bind:value={createdNsec} readonly class="w-full font-mono text-[12px]" />
							<Button
								square
								size="md"
								color="neutral"
								variant="subtle"
								onclick={copyNsec}
								icon={copied ? 'i-lucide-check' : 'i-lucide-copy'}
							/>
						</div>
						<p class="mt-2 text-[11.5px] text-[var(--tone-warning-text)]">
							Treat this like a password. Anyone with it can post and message as you.
						</p>
					</div>
					<Button
						block
						size="md"
						color="primary"
						icon="i-lucide-arrow-right"
						onclick={finishCreate}
					>
						Continue to BitOS
					</Button>
					<button
						type="button"
						class="w-full text-center text-[12px] text-[var(--ui-text-dimmed)] hover:text-[var(--ui-text-muted)]"
						onclick={() => {
							mode = 'intro';
							createdNsec = null;
							createdSkHex = null;
						}}
					>
						← Back
					</button>
				</div>
			{:else if mode === 'import'}
				<div class="space-y-3">
					<Input
						bind:value={secret}
						icon="i-lucide-key-round"
						placeholder="nsec1… or 64-char hex"
						class="font-mono text-[12.5px] w-full"
					/>
					<Button
						block
						size="md"
						color="primary"
						icon="i-lucide-log-in"
						onclick={doImport}
						disabled={busy || !secret.trim()}
					>
						Import key
					</Button>
					<button
						type="button"
						class="w-full text-center text-[12px] text-[var(--ui-text-dimmed)] hover:text-[var(--ui-text-muted)]"
						onclick={() => (mode = 'intro')}
					>
						← Back
					</button>
				</div>
			{/if}
		</div>

		<p class="mt-5 text-center text-[11px] text-[var(--ui-text-dimmed)]">
			Powered by the Nostr protocol · NIP-01 · NIP-04 · NIP-19
		</p>
		<nav class="mt-2 flex items-center justify-center gap-3 text-[11px] font-semibold text-[var(--ui-text-dimmed)]">
			<a href="/about" class="transition hover:text-primary-500">About</a>
			<span aria-hidden="true">·</span>
			<a href="/privacy" class="transition hover:text-primary-500">Privacy</a>
			<span aria-hidden="true">·</span>
			<a href="/terms" class="transition hover:text-primary-500">Terms</a>
		</nav>
	</div>
</div>
