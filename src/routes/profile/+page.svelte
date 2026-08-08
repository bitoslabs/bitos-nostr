<script lang="ts">
	import ProfileView from '$lib/components/profile/ProfileView.svelte';
	import { identity } from '$lib/nostr/identity.svelte';

	const pubkey = $derived(identity.current?.pk ?? '');
</script>

{#if pubkey}
	<ProfileView {pubkey} />
{:else}
	<div class="h-full overflow-y-auto">
		<div class="post-card mx-auto mt-10 max-w-md py-16 text-center">
			<p class="text-[15px] font-semibold">No identity loaded</p>
			<p class="mt-1 text-[13px] text-[var(--ui-text-muted)]">
				Create or import a key to view your profile.
			</p>
			<a
				href="/welcome"
				class="mt-5 inline-flex h-10 items-center gap-2 rounded-full bg-primary-500 px-4 text-[13px] font-bold text-white shadow-[var(--glow-primary)] transition hover:bg-primary-600"
			>
				Get started
			</a>
		</div>
	</div>
{/if}
