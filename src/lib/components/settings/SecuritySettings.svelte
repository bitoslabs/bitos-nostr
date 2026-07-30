<script lang="ts">
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { relays } from '$lib/nostr/relays.svelte';
	import type { Identity } from '$lib/nostr/types';
	import { settingsSync } from '$lib/stores/settings-sync.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';

	type Props = {
		me: Identity;
	};

	let { me }: Props = $props();

	let newRelay = $state('');
	let testingRelays = $state<Record<string, boolean>>({});
	let revealKey = $state(false);

	function addRelay() {
		const res = relays.add(newRelay);
		if (!res.ok) toasts.error(res.error ?? 'Invalid relay');
		else {
			toasts.success('Relay added');
			newRelay = '';
		}
	}

	function formatRelayTime(unixSeconds: number | undefined) {
		if (!unixSeconds) return 'not tested';
		return new Date(unixSeconds * 1000).toLocaleTimeString(undefined, {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	}

	async function testRelay(url: string) {
		if (testingRelays[url]) return;
		testingRelays = { ...testingRelays, [url]: true };
		relays.setStatus(url, 'connecting');
		const started = performance.now();
		try {
			const latency = await new Promise<number>((resolve, reject) => {
				const ws = new WebSocket(url);
				const timeout = window.setTimeout(() => {
					ws.close();
					reject(new Error('Connection timed out'));
				}, 6000);
				ws.onopen = () => {
					window.clearTimeout(timeout);
					const ms = Math.round(performance.now() - started);
					ws.close();
					resolve(ms);
				};
				ws.onerror = () => {
					window.clearTimeout(timeout);
					reject(new Error('Connection failed'));
				};
			});
			relays.setStatus(url, 'ok', latency);
			toasts.success(`${url} connected in ${latency}ms`);
		} catch {
			relays.setStatus(url, 'fail', null);
			toasts.error(`${url} failed`);
		} finally {
			testingRelays = { ...testingRelays, [url]: false };
		}
	}

	function testAllRelays() {
		for (const relay of relays.list) void testRelay(relay.url);
	}

	async function copy(text: string, label: string) {
		await navigator.clipboard.writeText(text);
		toasts.success(`${label} copied`);
	}

	function formatSyncTime(unixSeconds: number | null) {
		if (!unixSeconds) return 'Never';
		return new Date(unixSeconds * 1000).toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	async function syncSettings() {
		try {
			await settingsSync.publishBackup();
			toasts.success('Encrypted settings synced to Nostr');
		} catch (e) {
			toasts.error((e as Error).message || 'Could not sync settings');
		}
	}

	async function restoreSettings() {
		if (
			!confirm(
				'Restore encrypted BitOS settings from Nostr? This will overwrite local appearance, privacy, notification, media, relay and block settings.'
			)
		) {
			return;
		}
		try {
			const backup = await settingsSync.restoreLatestBackup();
			if (!backup) {
				toasts.info('No synced settings found');
				return;
			}
			toasts.success('Settings restored from Nostr');
		} catch (e) {
			toasts.error((e as Error).message || 'Could not restore settings');
		}
	}
</script>

<h2 class="mb-1 font-display text-[24px] font-extrabold">Security</h2>
<p class="mb-6 text-[13px] text-[var(--ui-text-muted)]">Your local keys and relay connections</p>

<div class="post-card mb-5 p-5">
	<div class="mb-4 flex items-center gap-2">
		<Icon name="i-lucide-key-round" class="size-[18px] text-primary-500" />
		<h3 class="text-[15px] font-bold">Keys</h3>
		<Badge tone="primary" class="ml-auto">local-first</Badge>
	</div>
	<div class="space-y-4">
		<div>
			<p class="mb-1.5 text-[12px] font-semibold text-[var(--ui-text-muted)]">Public key (npub)</p>
			<div class="flex gap-2">
				<Input value={me.npub} readonly class="flex-1 font-mono text-[11.5px]" />
				<Button
					square
					color="neutral"
					variant="subtle"
					onclick={() => copy(me.npub, 'npub')}
					icon="i-lucide-copy"
				/>
			</div>
		</div>
		<div>
			<p
				class="mb-1.5 flex items-center justify-between text-[12px] font-semibold text-[var(--ui-text-muted)]"
			>
				<span>Private key (nsec)</span>
				<button
					type="button"
					onclick={() => (revealKey = !revealKey)}
					class="flex items-center gap-1 text-[11px] font-medium text-primary-500"
				>
					<Icon name={revealKey ? 'i-lucide-eye-off' : 'i-lucide-eye'} class="size-3.5" />{revealKey
						? 'Hide'
						: 'Reveal'}
				</button>
			</p>
			<div class="flex gap-2">
				<Input
					value={revealKey ? me.nsec : '•'.repeat(32)}
					readonly
					class="flex-1 font-mono text-[11.5px]"
				/>
				<Button
					square
					color="neutral"
					variant="subtle"
					onclick={() => copy(me.nsec, 'nsec')}
					icon="i-lucide-copy"
				/>
			</div>
			<p class="mt-1.5 flex items-start gap-1.5 text-[11px] text-[var(--tone-warning-text)]">
				<Icon name="i-lucide-triangle-alert" class="mt-px size-3.5 shrink-0" />Never share your
				nsec. Anyone with it controls your identity.
			</p>
		</div>
	</div>
</div>

<div class="post-card mb-5 p-5">
	<div class="mb-4 flex items-center gap-2">
		<Icon name="i-lucide-cloud-lock" class="size-[18px] text-primary-500" />
		<h3 class="text-[15px] font-bold">Encrypted settings sync</h3>
		<Badge tone="primary" class="ml-auto">NIP-04</Badge>
	</div>
	<p class="mb-4 text-[12.5px] leading-relaxed text-[var(--ui-text-muted)]">
		Syncs BitOS preferences, privacy, notifications, blocked users, relays, and media provider
		settings as an encrypted app-data event. Your identity key is never included.
	</p>
	<div class="grid gap-2 sm:grid-cols-2">
		<Button
			color="primary"
			variant="solid"
			icon={settingsSync.syncing ? 'i-lucide-loader-circle' : 'i-lucide-upload-cloud'}
			onclick={syncSettings}
			disabled={settingsSync.syncing || settingsSync.restoring}
			class={settingsSync.syncing ? '[&_.iconify]:animate-spin' : ''}
		>
			{settingsSync.syncing ? 'Syncing' : 'Sync encrypted backup'}
		</Button>
		<Button
			color="neutral"
			variant="subtle"
			icon={settingsSync.restoring ? 'i-lucide-loader-circle' : 'i-lucide-download-cloud'}
			onclick={restoreSettings}
			disabled={settingsSync.syncing || settingsSync.restoring}
			class={settingsSync.restoring ? '[&_.iconify]:animate-spin' : ''}
		>
			{settingsSync.restoring ? 'Restoring' : 'Restore from Nostr'}
		</Button>
	</div>
	<div class="mt-3 grid gap-1 text-[11px] text-[var(--ui-text-dimmed)] sm:grid-cols-2">
		<p>Last synced: {formatSyncTime(settingsSync.lastSyncedAt)}</p>
		<p>Last remote: {formatSyncTime(settingsSync.lastRemoteAt)}</p>
	</div>
</div>

<div class="post-card mb-5 p-5">
	<div class="mb-4 flex items-center gap-2">
		<Icon name="i-lucide-radio" class="size-[18px] text-primary-500" />
		<h3 class="text-[15px] font-bold">Relays</h3>
		<span class="ml-auto text-[11px] text-[var(--ui-text-dimmed)]"
			>{relays.list.length} configured</span
		>
	</div>
	<div class="mb-3 flex gap-2">
		<Input
			bind:value={newRelay}
			icon="i-lucide-globe"
			placeholder="wss://relay.example.com"
			class="flex-1 font-mono text-[12.5px]"
		/>
		<Button
			color="primary"
			variant="subtle"
			icon="i-lucide-plus"
			onclick={addRelay}
			disabled={!newRelay.trim()}>Add</Button
		>
		<Button
			color="neutral"
			variant="subtle"
			icon="i-lucide-wifi"
			onclick={testAllRelays}
			disabled={!relays.list.length}>Test all</Button
		>
	</div>
	<ul
		class="divide-y divide-[var(--ui-border-muted)] overflow-hidden rounded-lg border border-[var(--ui-border)]"
	>
		{#each relays.list as r (r.url)}
			<li class="flex items-center gap-2.5 px-3 py-2.5">
				<span
					class="size-2 shrink-0 rounded-full {r.status === 'ok'
						? 'bg-[var(--tone-success-text)]'
						: r.status === 'fail'
							? 'bg-[var(--tone-error-text)]'
							: r.status === 'connecting'
								? 'animate-pulse bg-primary-500'
								: 'bg-[var(--ui-text-dimmed)]'}"
				></span>
				<div class="min-w-0 flex-1 leading-tight">
					<div class="truncate font-mono text-[12px]">{r.url}</div>
					<div class="text-[10.5px] text-[var(--ui-text-dimmed)]">
						{r.read ? 'read' : '—'} · {r.write ? 'write' : '—'}{#if r.latency != null}
							· {r.latency}ms{/if}
						· {formatRelayTime(r.checkedAt)}
					</div>
				</div>
				<div class="flex shrink-0 items-center gap-0.5">
					<button
						type="button"
						onclick={() => testRelay(r.url)}
						disabled={!!testingRelays[r.url]}
						class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] font-semibold text-primary-500 transition hover:bg-primary-500/10 disabled:opacity-60"
					>
						<Icon
							name={testingRelays[r.url] ? 'i-lucide-loader-circle' : 'i-lucide-wifi'}
							class="size-3 {testingRelays[r.url] ? 'animate-spin' : ''}"
						/>
					</button>
					<button
						type="button"
						onclick={() => relays.toggle(r.url, 'read')}
						class="rounded-md px-1.5 py-1 text-[10.5px] font-semibold transition {r.read
							? 'text-primary-500'
							: 'text-[var(--ui-text-dimmed)] hover:bg-[var(--interactive-hover-bg)]'}">R</button
					>
					<button
						type="button"
						onclick={() => relays.toggle(r.url, 'write')}
						class="rounded-md px-1.5 py-1 text-[10.5px] font-semibold transition {r.write
							? 'text-primary-500'
							: 'text-[var(--ui-text-dimmed)] hover:bg-[var(--interactive-hover-bg)]'}">W</button
					>
					<button
						type="button"
						onclick={() => relays.remove(r.url)}
						class="grid size-7 place-items-center rounded-md text-[var(--ui-text-dimmed)] transition hover:bg-[var(--tone-error-bg)] hover:text-[var(--tone-error-text)]"
					>
						<Icon name="i-lucide-trash-2" class="size-4" />
					</button>
				</div>
			</li>
		{/each}
	</ul>
</div>
