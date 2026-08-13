<script lang="ts">
	import { page } from '$app/state';
	import Icon from '$lib/components/ui/Icon.svelte';
	import HexAvatar from '$lib/components/ui/HexAvatar.svelte';
	import WalletCard from '$lib/components/shell/WalletCard.svelte';
	import { cn } from '$lib/utils/cn';

	/** A left-rail navigation entry. `page` is the SPA key when navigating in-app. */
	export type NavEntry = {
		to: string;
		label: string;
		icon: string;
		badge?: string | number;
		badgeTone?: 'accent' | 'warm';
		trailing?: 'relay';
		page?: string;
	};

	/** The signed-in account shown in the footer of the sidebar. */
	export type AccountChip = {
		name: string;
		npub: string;
		picture?: string | null;
		pubkey?: string;
		verified?: boolean;
	};

	/**
	 * Premium left sidebar: brand, primary navigation, a "New Note" action, the
	 * Lightning wallet card, and the account footer.
	 *
	 * Two navigation modes:
	 *   • Real router (default): each item is an `<a href>` and "active" matches
	 *     the current URL.
	 *   • In-app SPA: pass `onNavigate` + `activePage` and items call back with
	 *     their `page` key (used by the /pulse showcase).
	 */
	let {
		nav = [],
		account = null,
		balance = 12847,
		activePage,
		onNewNote,
		onNavigate,
		onDeposit,
		onWithdraw,
		onAccount,
		class: cls
	}: {
		nav?: NavEntry[];
		account?: AccountChip | null;
		balance?: number;
		activePage?: string;
		onNewNote?: () => void;
		onNavigate?: (page: string) => void;
		onDeposit?: () => void;
		onWithdraw?: () => void;
		onAccount?: () => void;
		class?: string;
	} = $props();

	function isActive(item: NavEntry) {
		if (activePage !== undefined) return (item.page ?? item.to) === activePage;
		const path = page.url.pathname;
		return item.to === '/' ? path === '/' : path.startsWith(item.to);
	}
</script>

<aside
	class={cn(
		'sticky top-0 flex h-screen flex-col border-r border-[var(--ui-border-muted)] p-3.5',
		cls
	)}
>
	<!-- Brand -->
	<a href="/" class="mb-6 flex items-center gap-2.5 px-3 pt-2" aria-label="Home">
		<img
			src="/icons/icon-192-192.png"
			alt=""
			class="size-7 rounded-[9px] shadow-[var(--glow-primary)]"
		/>
		<span
			class="bg-[linear-gradient(135deg,var(--ui-color-primary-500),var(--color-warm-500))] bg-clip-text text-2xl font-bold tracking-tight text-transparent"
		>
			BitOS
		</span>
	</a>

	<!-- Primary nav -->
	<nav class="flex flex-col gap-1 pl-3">
		{#each nav as item (item.to + item.label)}
			{@const active = isActive(item)}
			<a
				href={item.to}
				onclick={(e) => {
					if (onNavigate) {
						e.preventDefault();
						onNavigate(item.page ?? item.to);
					}
				}}
				aria-current={active ? 'page' : undefined}
				class={cn(
					'flex cursor-pointer items-center gap-4 rounded-xl px-4 py-3 text-[17px] font-medium transition-all hover:bg-[var(--interactive-hover-bg)]',
					active
						? 'bg-[color-mix(in_oklab,var(--ui-color-primary-500)_12%,transparent)] text-[var(--ui-color-primary-500)]'
						: 'text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]'
				)}
			>
				<Icon name={item.icon} class="size-5 shrink-0 text-center" />
				<span>{item.label}</span>
				<span class="ml-auto flex items-center gap-1">
					{#if item.badge !== undefined}
						<span
							class={cn(
								'rounded-full px-1.5 py-0.5 font-mono text-[11px] font-bold',
								item.badgeTone === 'warm'
									? 'bg-[var(--color-warm-500)] text-white'
									: 'bg-[var(--ui-color-primary-500)] text-black'
							)}
						>
							{item.badge}
						</span>
					{/if}
					{#if item.trailing === 'relay'}
						<span
							class="relay-pulse glow-success inline-block size-1.5 rounded-full bg-[var(--tone-success-text)]"
						></span>
					{/if}
				</span>
			</a>
		{/each}
	</nav>

	<!-- Primary action -->
	<div class="p-2 pb-3.5">
		<button
			type="button"
			onclick={onNewNote}
			class="glow-accent flex w-full items-center justify-center gap-2 rounded-full bg-[var(--ui-color-primary-500)] px-5 py-2.5 font-semibold text-[var(--ui-text-inverted)] transition-all hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-50"
		>
			<Icon name="i-lucide-zap" class="size-4" />
			New Note
		</button>
	</div>

	<WalletCard {balance} {onDeposit} {onWithdraw} />

	{#if account}
		<button
			type="button"
			onclick={onAccount}
			class="mt-auto rounded-xl p-2.5 text-left transition hover:bg-[var(--interactive-hover-bg)]"
		>
			<div class="flex items-center gap-2.5">
				<HexAvatar
					name={account.name}
					picture={account.picture}
					pubkey={account.pubkey ?? account.npub}
					verified={account.verified}
					size={36}
				/>
				<div class="min-w-0 flex-1">
					<div class="truncate text-sm font-semibold">{account.name}</div>
					<div class="truncate font-mono text-[11px] text-[var(--ui-text-muted)]">
						{account.npub}
					</div>
				</div>
				<Icon name="i-lucide-ellipsis" class="size-4 text-[var(--ui-text-muted)]" />
			</div>
		</button>
	{/if}
</aside>
