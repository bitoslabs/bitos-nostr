<script lang="ts">
	import Icon from './Icon.svelte';
	import { cn } from '$lib/utils/cn';

	/**
	 * Inline identity signal badges for account/profile rows, matching the
	 * feed note-card author header: ✓ badge-check in brand primary (NIP-05
	 * verified handle), ⚡ zap bolt in green (Lightning lud16/lud06). Hidden
	 * when neither is set.
	 */
	let {
		profile,
		showLightning = true,
		class: cls
	}: {
		profile?: { nip05?: string | null; lud16?: string | null; lud06?: string | null } | null;
		showLightning?: boolean;
		class?: string;
	} = $props();

	const nip05 = $derived(profile?.nip05?.trim() || '');
	const lightning = $derived(
		showLightning ? profile?.lud16?.trim() || profile?.lud06?.trim() || '' : ''
	);
</script>

{#if nip05 || lightning}
	<span class={cn('inline-flex shrink-0 items-center gap-1', cls)}>
		{#if nip05}
			<Icon
				name="i-lucide-badge-check"
				class="size-3.5 shrink-0 text-primary-500"
				title="NIP-05 verified: {nip05}"
			/>
		{/if}
		{#if lightning}
			<Icon
				name="i-lucide-zap"
				class="size-3.5 text-green-500"
				title="Lightning address: {lightning}"
			/>
		{/if}
	</span>
{/if}
