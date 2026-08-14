<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import { cn } from '$lib/utils/cn';
	import { formatCompact } from '$lib/utils/format';
	import { notifMeta, type AppNotification } from '$lib/components/premium/data';

	const toneClass = {
		accent:
			'text-[var(--ui-color-primary-500)] bg-[color-mix(in_oklab,var(--ui-color-primary-500)_12%,transparent)]',
		warm: 'text-[var(--tone-warning-text)] bg-[color-mix(in_oklab,var(--tone-warning-text)_12%,transparent)]',
		success:
			'text-[var(--tone-success-text)] bg-[color-mix(in_oklab,var(--tone-success-text)_12%,transparent)]',
		info: 'text-[var(--tone-info-text)] bg-[color-mix(in_oklab,var(--tone-info-text)_12%,transparent)]',
		neutral: 'text-[var(--ui-text-muted)] bg-[var(--interactive-hover-bg)]'
	} as const;

	/** A single grouped notification row. Pure presentation of one item. */
	let {
		notification,
		onClick
	}: { notification: AppNotification; onClick?: (n: AppNotification) => void } = $props();

	const meta = $derived(notifMeta[notification.type]);
	const main = $derived(notification.actors[0]);
	const extra = $derived(notification.actors.slice(1, 3));
</script>

<div
	role="button"
	tabindex="0"
	onclick={() => onClick?.(notification)}
	onkeydown={(e) => e.key === 'Enter' && onClick?.(notification)}
	class={cn(
		'flex cursor-pointer gap-3.5 border-b border-[var(--ui-border-muted)] p-3.5 px-4 transition-all hover:bg-[var(--interactive-hover-bg)]',
		notification.unread && 'bg-[color-mix(in_oklab,var(--ui-color-primary-500)_3%,transparent)]'
	)}
>
	<span class={cn('grid size-9 shrink-0 place-items-center rounded-full', toneClass[meta.tone])}>
		<Icon name={meta.icon} class="size-4" />
	</span>
	<div class="min-w-0 flex-1">
		<div class="mb-1.5 flex items-center gap-2">
			<div class="flex -space-x-2">
				<div class="relative">
					<div class="hex-clip bg-[var(--surface-bg)] p-[2px]">
						<Avatar
							pubkey={main.npub}
							name={main.name}
							picture={main.picture}
							size={28}
							shape="hex"
						/>
					</div>
					{#if main.verified}
						<span
							class="absolute -right-1 -bottom-1 grid place-items-center rounded-full bg-[var(--tone-success-text)] text-black ring-2 ring-[var(--surface-bg)]"
							style="width:13px;height:13px"
							aria-label="Verified"
							title="Verified"
						>
							<svg viewBox="0 0 24 24" class="size-[9px]" fill="currentColor" aria-hidden="true">
								<path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5Z" />
							</svg>
						</span>
					{/if}
				</div>
				{#each extra as a, i (a.npub)}
					<div
						class="hex-clip relative bg-[var(--surface-bg)] p-[2px] transition hover:z-10 hover:bg-primary-500/40"
						style="z-index:{3 - i}"
					>
						<Avatar pubkey={a.npub} name={a.name} picture={a.picture} size={28} shape="hex" />
					</div>
				{/each}
			</div>
			<span class="ml-auto text-xs text-[var(--ui-text-muted)]">{notification.time}</span>
		</div>
		<div class="text-sm leading-relaxed text-[var(--ui-text-muted)]">
			<span class="font-semibold text-[var(--ui-text)]">{main.name}</span>
			{#if notification.count > 1}
				<span> and {notification.count - 1} others</span>{/if}
			{notification.text}
			{#if notification.amount}
				<span class="font-mono font-semibold text-[var(--ui-color-primary-500)]"
					>· {formatCompact(notification.amount)} sats</span
				>{/if}
		</div>
		{#if notification.preview}
			<div
				class="mt-2 rounded-lg border border-[var(--ui-border-muted)] bg-[var(--interactive-hover-bg)] p-2.5 px-3 text-[13px] leading-relaxed text-[var(--ui-text-muted)]"
			>
				{notification.preview}
			</div>
		{/if}
	</div>
	{#if notification.unread}
		<span class="glow-accent mt-1.5 size-2 shrink-0 rounded-full bg-[var(--ui-color-primary-500)]"
		></span>
	{/if}
</div>
