<script lang="ts">
	import { page } from '$app/state';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import { identity } from '$lib/nostr/identity.svelte';
	import { profiles } from '$lib/nostr/profiles.svelte';
	import { dms } from '$lib/nostr/dms.svelte';

	/** iOS-style bottom tab bar for mobile (hidden on lg+ where the rail is). */

	const tabs = [
		{ to: '/', label: 'Home', icon: 'i-lucide-house' },
		{ to: '/messages', label: 'Chats', icon: 'i-lucide-message-circle-more', badge: true },
		{ to: '/discover', label: 'Discover', icon: 'i-lucide-compass' },
		{ to: '/reels', label: 'Reels', icon: 'i-lucide-clapperboard' },
		{ to: '/profile', label: 'Profile', icon: 'i-lucide-user' }
	];

	function isActive(to: string) {
		const path = page.url.pathname;
		return to === '/' ? path === '/' : path.startsWith(to);
	}

	const me = $derived(identity.current);
	const displayName = $derived(
		me?.pk ? profiles.get(me.pk)?.display_name || profiles.get(me.pk)?.name || 'You' : ''
	);
	const unread = $derived(dms.unreadCount);
</script>

<nav
	class="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-[var(--ui-border-muted)] bg-[var(--surface-bg)] pb-[env(safe-area-inset-bottom)] lg:hidden"
	aria-label="Primary"
>
	{#each tabs as tab (tab.to)}
		{@const active = isActive(tab.to)}
		<a
			href={tab.to}
			class="relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10.5px] font-semibold transition-colors {active
				? 'text-primary-500'
				: 'text-[var(--ui-text-dimmed)]'}"
		>
			<span class="relative">
				<Icon name={tab.icon} class="size-[22px]" />
				{#if tab.badge && unread > 0}
					<span
						class="absolute -top-1 -right-2 grid size-4 place-items-center rounded-full bg-warm-500 text-[9px] font-bold text-white"
						>{unread > 9 ? '9+' : unread}</span
					>
				{/if}
			</span>
			<span>{tab.label}</span>
		</a>
	{/each}
	<a
		href="/settings"
		class="flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5"
		aria-label="Account"
	>
		{#if me}
			<Avatar pubkey={me.pk} name={displayName} picture={profiles.get(me.pk)?.picture} size={26} />
		{:else}
			<span
				class="grid size-[26px] place-items-center rounded-full bg-[var(--ui-bg-accented)] text-[var(--ui-text-dimmed)]"
			>
				<Icon name="i-lucide-user" class="size-4" />
			</span>
		{/if}
		<span class={isActive('/settings') ? 'text-primary-500' : 'text-[var(--ui-text-dimmed)]'}
			>Account</span
		>
	</a>
</nav>
