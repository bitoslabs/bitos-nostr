<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	/**
	 * A row inside a Popover menu. Renders as a `<button>` (or `<a>` when
	 * `href` is given). Use the `tone` variant for destructive/accent actions.
	 * The `trailing` snippet is handy for checkmarks (active account) or
	 * keyboard shortcuts.
	 *
	 *   <MenuItem icon="i-lucide-link" onclick={copy}>Copy link</MenuItem>
	 *   <MenuItem tone="danger" icon="i-lucide-ban" onclick={block}>Block user</MenuItem>
	 */
	export const menuItem = tv({
		base: 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold transition-colors focus-brand disabled:pointer-events-none disabled:opacity-50',
		variants: {
			tone: {
				default:
					'text-[var(--ui-text-muted)] hover:bg-[var(--interactive-hover-bg)] hover:text-[var(--ui-text)]',
				danger: 'text-[var(--tone-error-text)] hover:bg-[var(--tone-error-bg)]',
				accent:
					'text-primary-600 dark:text-primary-400 hover:bg-primary-500/10'
			}
		},
		defaultVariants: { tone: 'default' }
	});

	export type MenuItemVariants = VariantProps<typeof menuItem>;
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils/cn';
	import Icon from './Icon.svelte';

	let {
		class: cls,
		tone = 'default',
		icon,
		iconClass = 'size-4 shrink-0',
		href,
		type = 'button',
		disabled = false,
		leading,
		trailing,
		children,
		...rest
	}: {
		class?: string;
		tone?: MenuItemVariants['tone'];
		icon?: string;
		iconClass?: string;
		href?: string;
		type?: HTMLButtonAttributes['type'];
		disabled?: boolean;
		leading?: Snippet;
		trailing?: Snippet;
		children?: Snippet;
	} & HTMLButtonAttributes &
		HTMLAnchorAttributes = $props();

	const computed = $derived(menuItem({ tone, class: cls }));
</script>

{#if href}
	<a {href} class={computed} {...rest}>
		{#if leading}{@render leading()}{:else if icon}<Icon name={icon} class={iconClass} />{/if}
		{#if children}<span class="min-w-0 flex-1 truncate">{@render children()}</span>{/if}
		{#if trailing}{@render trailing()}{/if}
	</a>
{:else}
	<button {type} {disabled} class={computed} {...rest}>
		{#if leading}{@render leading()}{:else if icon}<Icon name={icon} class={iconClass} />{/if}
		{#if children}<span class="min-w-0 flex-1 truncate">{@render children()}</span>{/if}
		{#if trailing}{@render trailing()}{/if}
	</button>
{/if}
