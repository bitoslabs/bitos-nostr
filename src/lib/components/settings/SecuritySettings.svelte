<script lang="ts">
	import Badge from '$lib/components/ui/Badge.svelte';
	import SectionCard from '$lib/components/settings/SectionCard.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import { relays, RECOMMENDED } from '$lib/nostr/relays.svelte';
	import { mergeNip65Recommendations, queryNip65RelayList } from '$lib/nostr/nip65';
	import type { Identity } from '$lib/nostr/types';
	import { settingsSync } from '$lib/stores/settings-sync.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { confirms } from '$lib/stores/confirms.svelte';

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
		const res = await relays.ping(url);
		if (res.status === 'ok') {
			relays.setStatus(url, 'ok', res.latency);
			toasts.success(`${url} connected in ${res.latency}ms`);
		} else {
			relays.setStatus(url, 'fail', null);
			toasts.error(`${url} failed`);
		}
		testingRelays = { ...testingRelays, [url]: false };
	}

	function testAllRelays() {
		for (const relay of relays.list) void testRelay(relay.url);
	}

	type RecHealth = { status: 'unknown' | 'connecting' | 'ok' | 'fail'; latency: number | null };
	let recHealth = $state<Record<string, RecHealth>>({});
	let queryingRec = $state(false);
	let loadingNip65 = $state(false);
	let nip65Relays = $state<Awaited<ReturnType<typeof queryNip65RelayList>>>([]);
	let nip65Queried = $state(false);

	const recommended = $derived(mergeNip65Recommendations(RECOMMENDED, nip65Relays));
	const recommendedNotAdded = $derived(
		recommended.filter((r) => !relays.list.some((x) => x.url === r.url))
	);

	/** limit/offset pagination for the recommended panel. */
	const REC_PAGE_SIZE = 4;
	let recPage = $state(0);
	const recTotalPages = $derived(
		Math.max(1, Math.ceil(recommendedNotAdded.length / REC_PAGE_SIZE))
	);
	const recPageSlice = $derived(
		recommendedNotAdded.slice(recPage * REC_PAGE_SIZE, recPage * REC_PAGE_SIZE + REC_PAGE_SIZE)
	);
	// Clamp the page back into range when the list shrinks (e.g. after adding a relay).
	$effect(() => {
		if (recPage > recTotalPages - 1) recPage = Math.max(0, recTotalPages - 1);
	});

	async function queryRecommended() {
		if (queryingRec) return;
		const targets = recPageSlice; // only the visible page (offset = page * limit)
		if (!targets.length) return;
		queryingRec = true;
		const init: Record<string, RecHealth> = {};
		for (const r of targets) init[r.url] = { status: 'connecting', latency: null };
		recHealth = { ...recHealth, ...init };
		await Promise.all(
			targets.map(async (r) => {
				const res = await relays.ping(r.url);
				recHealth = { ...recHealth, [r.url]: { status: res.status, latency: res.latency } };
			})
		);
		queryingRec = false;
	}

	async function loadNip65Recommendations() {
		if (loadingNip65) return;
		loadingNip65 = true;
		try {
			nip65Relays = await queryNip65RelayList(me.pk);
			nip65Queried = true;
			if (nip65Relays.length) {
				toasts.success(
					`Loaded ${nip65Relays.length} relay${nip65Relays.length === 1 ? '' : 's'} from NIP-65`
				);
			} else {
				toasts.info('No NIP-65 relay list found; showing built-in recommendations');
			}
		} catch {
			toasts.error('Could not query your NIP-65 relay list');
		} finally {
			loadingNip65 = false;
		}
	}

	function addRecommended(url: string) {
		const res = relays.add(url);
		if (res.ok) toasts.success('Relay added');
		else toasts.error(res.error ?? 'Could not add relay');
	}

	function makePrimaryRelay(url: string) {
		relays.setPrimary(url);
		toasts.success('Primary relay updated');
	}

	function makeWritePrimaryRelay(url: string) {
		relays.setWritePrimary(url);
		toasts.success('Preferred write relay updated');
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
			!(await confirms.warning({
				title: 'Restore synced settings?',
				message:
					'This overwrites local appearance, privacy, notification, media, relay and block settings with the encrypted backup from Nostr.',
				confirmLabel: 'Restore'
			}))
		)
			return;
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

<SectionCard
	title="Keys"
	icon="i-lucide-key-round"
	description="Your Nostr identity keys — they never leave this device."
	class="mb-5"
>
	{#snippet actions()}<Badge tone="primary">local-first</Badge>{/snippet}
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
</SectionCard>

<SectionCard
	title="Encrypted settings sync"
	icon="i-lucide-cloud-lock"
	description="Syncs preferences, privacy, blocked users, relays, and media settings as an encrypted app-data event. Your identity key is never included."
	class="mb-5"
>
	{#snippet actions()}<Badge tone="primary">NIP-04</Badge>{/snippet}
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
</SectionCard>

<SectionCard
	title="Relays"
	icon="i-lucide-radio"
	description="Primary relay handles fast first queries; other read relays sync in the background. The preferred write relay gets publishes first, then BitOS fans out to the rest."
	class="mb-5"
>
	{#snippet actions()}
		<span class="text-[11px] text-[var(--ui-text-dimmed)]">{relays.list.length} configured</span>
	{/snippet}
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
		class="divide-y divide-[var(--ui-border-muted)] overflow-hidden rounded-lg border border-[var(--ui-border-muted)]"
	>
		{#each relays.list as r (r.url)}
			<li class="px-3 py-2.5">
				<div class="flex items-start gap-2.5">
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
							{r.read ? 'read' : '—'} · {r.write ? 'write' : '—'} · {r.primary
								? 'primary'
								: 'secondary'} · {r.writePrimary
								? 'preferred write'
								: 'normal write'}{#if r.latency != null}
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
							onclick={() => makePrimaryRelay(r.url)}
							class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] font-semibold transition {r.primary
								? 'bg-primary-500/10 text-primary-600'
								: 'text-[var(--ui-text-dimmed)] hover:bg-[var(--interactive-hover-bg)] hover:text-primary-500'}"
							title={r.primary ? 'Primary relay' : 'Set as primary relay'}
							aria-label={r.primary ? `Primary relay ${r.url}` : `Set ${r.url} as primary relay`}
						>
							<Icon name={r.primary ? 'i-lucide-radio' : 'i-lucide-circle'} class="size-3" />
							<span>PR</span>
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
							onclick={() => makeWritePrimaryRelay(r.url)}
							class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] font-semibold transition {r.writePrimary
								? 'bg-primary-500/10 text-primary-600'
								: 'text-[var(--ui-text-dimmed)] hover:bg-[var(--interactive-hover-bg)] hover:text-primary-500'}"
							title={r.writePrimary ? 'Preferred write relay' : 'Set as preferred write relay'}
							aria-label={r.writePrimary
								? `Preferred write relay ${r.url}`
								: `Set ${r.url} as preferred write relay`}
						>
							<Icon
								name={r.writePrimary ? 'i-lucide-send' : 'i-lucide-circle-dot'}
								class="size-3"
							/>
							<span>PW</span>
						</button>
						<button
							type="button"
							onclick={() => relays.remove(r.url)}
							class="grid size-7 place-items-center rounded-md text-[var(--ui-text-dimmed)] transition hover:bg-[var(--tone-error-bg)] hover:text-[var(--tone-error-text)]"
						>
							<Icon name="i-lucide-trash-2" class="size-4" />
						</button>
					</div>
				</div>
			</li>
		{/each}
	</ul>
</SectionCard>

<SectionCard
	title="Recommended relays"
	icon="i-lucide-sparkles"
	description="Popular, reliable relays — optionally merge your NIP-65 relay list, then query reachability and add the ones you want."
	class="mb-5"
>
	{#snippet actions()}
		<span class="text-[11px] text-[var(--ui-text-dimmed)]"
			>{recommendedNotAdded.length} available</span
		>
	{/snippet}
	<div class="mb-3 flex flex-wrap items-center gap-2">
		<Button
			color="neutral"
			variant="subtle"
			size="sm"
			icon={loadingNip65 ? 'i-lucide-loader-circle' : 'i-lucide-download'}
			onclick={loadNip65Recommendations}
			disabled={loadingNip65}
			class={loadingNip65 ? '[&_.iconify]:animate-spin' : ''}
			>{loadingNip65
				? 'Loading NIP-65…'
				: nip65Queried
					? 'Refresh NIP-65'
					: 'Load NIP-65 relays'}</Button
		>
		{#if recommendedNotAdded.length > 0}
			<Button
				color="neutral"
				variant="subtle"
				size="sm"
				icon={queryingRec ? 'i-lucide-loader-circle' : 'i-lucide-wifi'}
				onclick={queryRecommended}
				disabled={queryingRec}
				class={queryingRec ? '[&_.iconify]:animate-spin' : ''}
				>{queryingRec ? 'Querying…' : 'Query reachability'}</Button
			>
		{/if}
	</div>
	{#if recommendedNotAdded.length === 0}
		<p
			class="rounded-lg border border-dashed border-[var(--ui-border-muted)] px-3 py-4 text-center text-[12px] text-[var(--ui-text-dimmed)]"
		>
			You've added all recommended relays 🎉
		</p>
	{:else}
		<ul
			class="divide-y divide-[var(--ui-border-muted)] overflow-hidden rounded-lg border border-[var(--ui-border-muted)]"
		>
			{#each recPageSlice as rec (rec.url)}
				{@const h = recHealth[rec.url]}
				<li class="flex items-center gap-2.5 px-3 py-2.5">
					<span
						class="size-2 shrink-0 rounded-full {h?.status === 'ok'
							? 'bg-[var(--tone-success-text)]'
							: h?.status === 'fail'
								? 'bg-[var(--tone-error-text)]'
								: h?.status === 'connecting'
									? 'animate-pulse bg-primary-500'
									: 'bg-[var(--ui-text-dimmed)]'}"
					></span>
					<div class="min-w-0 flex-1 leading-tight">
						<div class="flex items-center gap-1.5">
							<span class="truncate text-[12.5px] font-bold">{rec.name}</span>
							{#if h?.status === 'ok' && h.latency != null}
								<span class="text-[10px] text-[var(--ui-text-dimmed)]">· {h.latency}ms</span>
							{/if}
						</div>
						<div class="truncate text-[10.5px] text-[var(--ui-text-dimmed)]">
							{rec.description} · <span class="font-mono">{rec.url}</span>
						</div>
					</div>
					<button
						type="button"
						onclick={() => addRecommended(rec.url)}
						class="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-[10.5px] font-semibold text-primary-500 transition hover:bg-primary-500/10"
					>
						<Icon name="i-lucide-plus" class="size-3.5" />Add
					</button>
				</li>
			{/each}
		</ul>

		<!-- pagination: prev · dots + page count · next (limit/offset) -->
		<div class="mt-3 flex items-center justify-between gap-2">
			<button
				type="button"
				disabled={recPage === 0}
				onclick={() => (recPage = Math.max(0, recPage - 1))}
				class="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-semibold transition {recPage ===
				0
					? 'cursor-not-allowed text-[var(--ui-text-dimmed)]'
					: 'text-primary-500 hover:bg-primary-500/10'}"
			>
				<Icon name="i-lucide-chevron-left" class="size-3.5" />Prev
			</button>
			<div class="flex items-center gap-1.5">
				{#each Array(recTotalPages).fill(0) as _, i (i)}
					<button
						type="button"
						onclick={() => (recPage = i)}
						aria-label="Go to page {i + 1}"
						class="size-1.5 rounded-full transition {i === recPage
							? 'scale-110 bg-primary-500'
							: 'bg-[var(--ui-border-accented)] hover:bg-[var(--ui-text-dimmed)]'}"
					></button>
				{/each}
				<span class="ml-1.5 text-[11px] font-medium text-[var(--ui-text-dimmed)] tabular-nums">
					{recPage + 1}/{recTotalPages}
				</span>
			</div>
			<button
				type="button"
				disabled={recPage >= recTotalPages - 1}
				onclick={() => (recPage = Math.min(recTotalPages - 1, recPage + 1))}
				class="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-semibold transition {recPage >=
				recTotalPages - 1
					? 'cursor-not-allowed text-[var(--ui-text-dimmed)]'
					: 'text-primary-500 hover:bg-primary-500/10'}"
			>
				Next<Icon name="i-lucide-chevron-right" class="size-3.5" />
			</button>
		</div>
	{/if}
</SectionCard>
